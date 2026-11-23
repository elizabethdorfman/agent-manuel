/**
 * Stream B test harness (shared by the typography and contrast tests). It behaves like the
 * runner should: open the page at a viewport, settle, collect, gather CDP extras, take a
 * full-page screenshot, analyze; then for each variant apply → settle → collect → undo → analyze.
 */
import {readFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {launchBrowser} from '../src/cdp.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SETTLE = `new Promise(resolve => { const wait = () => { if (document.readyState === 'complete') document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))); else setTimeout(wait, 25); }; wait(); })`;

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (r.exceptionDetails) throw new Error('Page evaluation failed: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
}

export async function withBrowser(fn) {
  const browser = await launchBrowser();
  try { return await fn(browser); } finally { await browser.cleanup(); }
}

/** Runs one check against a fixture at one viewport. Returns {base, variants: {id: result}}. */
export async function runCheck(browser, check, fixture, {width, height, config = {}}) {
  const {targetId} = await browser.cdp.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await browser.cdp.send('Target.attachToTarget', {targetId, flatten: true});
  const send = (method, params) => browser.cdp.send(method, params, sessionId);
  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId); loaded.catch(() => {});
    const nav = await send('Page.navigate', {url: pathToFileURL(join(root, fixture)).href});
    if (nav.errorText) throw new Error('Navigation failed: ' + nav.errorText);
    await loaded;
    await evaluate(send, SETTLE);
    const viewport = {width, height};
    const collected = await evaluate(send, '(' + check.collect.toString() + ')({})');
    const extra = check.gather ? await check.gather(send, collected) : undefined;
    const size = await evaluate(send, '({width: innerWidth, height: Math.max(document.documentElement.scrollHeight, innerHeight)})');
    const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {x: 0, y: 0, width: size.width, height: size.height, scale: 1}});
    const screenshot = Buffer.from(shot.data, 'base64');
    const base = check.analyze(collected, {viewport, config, screenshot, extra});
    const out = {base, collected, variants: {}};
    for (const v of check.variants ?? []) {
      await send(v.method, v.params);
      await evaluate(send, SETTLE);
      const c = await evaluate(send, '(' + check.collect.toString() + ')({})');
      if (v.undo) await send(v.undo.method, v.undo.params);
      out.variants[v.id] = check.analyze(c, {viewport, config, variant: v});
    }
    return out;
  } finally {
    await browser.cdp.send('Target.closeTarget', {targetId}).catch(() => {});
  }
}

const RANK = {none: 0, review: 1, fail: 2};
/** Worst status of the findings that point at a selector (directly or via measurements.selectors). */
export function outcomes(findings, selectors) {
  const out = Object.fromEntries(selectors.map(s => [s, 'none']));
  for (const f of findings) {
    for (const s of new Set([f.selector, ...(f.measurements?.selectors ?? [])])) {
      if (s in out && RANK[f.status] > RANK[out[s]]) out[s] = f.status;
    }
  }
  return out;
}

export const readJson = async rel => JSON.parse(await readFile(join(root, rel), 'utf8'));
