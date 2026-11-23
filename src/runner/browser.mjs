// One page in its own fresh browser context: isolated cookies, storage and cache, so every
// branch starts as a brand-new guest. Safety hooks are installed before the first navigation:
// blocked request patterns, an off-origin document guard, auto-dismissed JS dialogs and
// closing of popups.
import { isAllowedUrl } from './safety.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Page {
  constructor(browser, cfg) {
    this.browser = browser; this.cdp = browser.cdp; this.cfg = cfg;
    this.inflight = new Set(); this.errors = []; this.offOrigin = []; this.jsDialogs = []; this.listeners = [];
    this.blockedHits = [];
  }

  /** Opens a fresh guest context and a page in it, with every safety hook live. */
  static async open(browser, cfg, viewport) {
    const page = new Page(browser, cfg);
    const { browserContextId } = await page.cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    page.contextId = browserContextId;
    const { targetId } = await page.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    page.targetId = targetId;
    const { sessionId } = await page.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    page.sessionId = sessionId;
    page.raw = ev => page.dispatch(ev);
    page.cdp.socket.addEventListener('message', page.raw);
    await page.install();
    await page.setViewport(viewport);
    return page;
  }

  send(method, params = {}) { return this.cdp.send(method, params, this.sessionId); }
  on(method, fn) { this.listeners.push([method, fn]); }
  dispatch(event) {
    let msg; try { msg = JSON.parse(String(event.data)); } catch { return; }
    if (msg.id || msg.sessionId !== this.sessionId) return;
    for (const [m, fn] of this.listeners) if (m === msg.method) { try { fn(msg.params); } catch { /* listener errors never break the run */ } }
  }

  async install() {
    const cfg = this.cfg;
    this.on('Network.requestWillBeSent', p => { if (!['WebSocket', 'EventSource'].includes(p.type)) this.inflight.add(p.requestId); });
    this.on('Network.loadingFinished', p => this.inflight.delete(p.requestId));
    this.on('Network.loadingFailed', p => { this.inflight.delete(p.requestId); if (p.blockedReason) this.blockedHits.push({ reason: p.blockedReason }); });
    this.on('Runtime.exceptionThrown', p => this.errors.push(p.exceptionDetails?.exception?.description?.split('\n')[0] ?? p.exceptionDetails?.text ?? 'Uncaught exception'));
    this.on('Page.javascriptDialogOpening', p => {
      // confirm("Delete?") and friends are always dismissed, never accepted.
      this.jsDialogs.push({ type: p.type, message: p.message });
      this.send('Page.handleJavaScriptDialog', { accept: p.type === 'alert' }).catch(() => {});
    });
    // Off-origin guard: any top-level or frame document request outside the app is failed
    // before it leaves the browser, whatever triggered it (link, form, script redirect).
    this.on('Fetch.requestPaused', p => {
      if (isAllowedUrl(p.request.url, cfg) || p.request.url.startsWith('data:')) this.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
      else { this.offOrigin.push(p.request.url); this.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
    });
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable'), this.send('DOM.enable'), this.send('Accessibility.enable')]);
    if (cfg.blockRequests.length) {
      try { await this.send('Network.setBlockedURLs', { urls: cfg.blockRequests }); }
      catch { await this.send('Network.setBlockedURLs', { urlPatterns: cfg.blockRequests.map(urlPattern => ({ urlPattern, block: true })) }); }
    }
    await this.send('Network.setCacheDisabled', { cacheDisabled: true });
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
  }

  async setViewport({ width, height }) {
    this.viewport = { width, height };
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  }

  async evaluate(expression, { timeout = 10000 } = {}) {
    let timer;
    const r = await Promise.race([
      this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Page script timed out.')), timeout); }),
    ]).finally(() => clearTimeout(timer));
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async url() { return (await this.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result.value; }

  async goto(url) {
    if (!isAllowedUrl(url, this.cfg)) throw new Error('Refusing to open off-origin URL ' + url);
    const nav = await this.send('Page.navigate', { url });
    if (nav.errorText) throw new Error('Navigation failed: ' + nav.errorText);
    await this.settle();
  }

  /** Waits for load, no requests in flight for settleMs, fonts and two frames. */
  async settle({ timeout = 10000 } = {}) {
    const start = Date.now(), quiet = this.cfg.settleMs; let quietSince = null;
    await sleep(60);
    while (Date.now() - start < timeout) {
      let ready = false;
      try { ready = (await this.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })).result?.value === 'complete'; } catch {}
      if (ready && this.inflight.size === 0) { quietSince ??= Date.now(); if (Date.now() - quietSince >= quiet) break; }
      else quietSince = null;
      await sleep(40);
    }
    try { await this.evaluate('Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,2000))]).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)))))', { timeout: 4000 }); } catch {}
  }

  /** Closes popups a click opened in this context, so nothing runs out of sight. */
  async closePopups() {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    const extra = targetInfos.filter(t => t.browserContextId === this.contextId && t.targetId !== this.targetId && t.type === 'page');
    for (const t of extra) await this.cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    return extra.map(t => t.url);
  }

  async screenshot({ fullPage = true, format = 'png', quality } = {}) {
    let clip;
    if (fullPage) {
      const size = await this.evaluate('({w:document.documentElement.clientWidth,h:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0,innerHeight)})');
      clip = { x: 0, y: 0, width: this.viewport.width, height: Math.min(size.h, 8000), scale: 1 };
    }
    const shot = await this.send('Page.captureScreenshot', { format, ...(quality ? { quality } : {}), ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    return Buffer.from(shot.data, 'base64');
  }

  async close() {
    this.cdp.socket.removeEventListener('message', this.raw);
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.contextId }).catch(() => {});
  }
}
