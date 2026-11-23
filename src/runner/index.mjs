// The run loop: breadth-first exploration over untried edges. Every edge runs in a fresh
// guest browser context that replays the shortest known path to its state, then takes the
// one untried action. Each new state is checked at every viewport and screenshotted.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../cdp.mjs';
import { Page } from './browser.mjs';
import { observe, perform, actionRecord, actionLabel, actionSignature } from './discover.mjs';
import { stateKey, stateLabel } from './state.mjs';
import { runChecks } from './checks.mjs';
import { Ledger, Findings, EventLog } from './ledger.mjs';
import { checkAction, isAllowedUrl, normalizeConfig } from './safety.mjs';
import { renderRunReport } from '../report/index.mjs';

export { normalizeConfig };
export const viewportName = v => `${v.width}x${v.height}`;

/**
 * cfg: a raw or normalized app config.
 * opts: { out, checks, chromePath, noSandbox, print(event), signal }
 * Resolves to { out, status, reason, counts }.
 */
export async function run(rawCfg, opts) {
  const cfg = rawCfg.safety ? rawCfg : normalizeConfig(rawCfg);
  const checks = opts.checks ?? (await import('../checks/index.mjs')).checks;
  const out = opts.out;
  await mkdir(join(out, 'states'), { recursive: true });
  const ledger = new Ledger(), findings = new Findings();
  const events = new EventLog(join(out, 'events.jsonl'), opts.print);
  const started = Date.now();
  const explore = cfg.viewports[0];
  let actions = 0, status = 'running', reason = '';
  const repeats = new Map();

  events.emit('run-start', {
    out, baseUrl: cfg.baseUrl, entry: cfg.entry, viewports: cfg.viewports.map(viewportName),
    checks: checks.map(c => c.meta?.id), budget: cfg.budget,
    safety: { sameOriginOnly: cfg.sameOriginOnly, denyActions: cfg.denyActions, denySubmitForms: cfg.denySubmitForms, blockRequests: cfg.blockRequests, allowAiConsent: cfg.allowAiConsent },
  });

  const browser = await launchBrowser({ chromePath: opts.chromePath, noSandbox: opts.noSandbox });
  const write = async () => {
    await writeFile(join(out, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
    await writeFile(join(out, 'findings.json'), JSON.stringify(findings.list(), null, 2) + '\n');
  };

  /** Records a newly reached state: checks and screenshots per viewport, then its edges. */
  async function visit(page, path, seen) {
    const { key, signature } = stateKey(seen);
    if (ledger.hasState(key)) return { key, isNew: false };
    const depth = path.length - 1;
    const state = ledger.addState(key, { label: stateLabel(seen), url: seen.url, depth, firstPath: path.map(actionRecord), signature });
    const dir = join(out, 'states', key); await mkdir(dir, { recursive: true });
    for (const vp of cfg.viewports) {
      await page.setViewport(vp); await page.settle();
      const png = await page.screenshot({ fullPage: true });
      const file = `states/${key}/${viewportName(vp)}.png`;
      await writeFile(join(out, file), png); state.screenshots[viewportName(vp)] = file;
      if (vp === explore) { await writeFile(join(dir, 'thumb.jpg'), await page.screenshot({ fullPage: false, format: 'jpeg', quality: 60 })); state.thumb = `states/${key}/thumb.jpg`; }
      const results = await runChecks(page, checks, cfg, vp, png);
      state.checks[viewportName(vp)] = results.map(r => ({ checkId: r.checkId, summary: r.summary, findings: r.findings.length, ...(r.error ? { error: r.error } : {}) }));
      for (const r of results) for (const f of r.findings) {
        const where = { state: key, viewport: viewportName(vp), path: state.firstPath.map(s => s.label) };
        if (findings.add(r.checkId, f, where)) events.emit('finding', { checkId: r.checkId, id: f.id, status: f.status, severity: f.severity, message: f.message, selector: f.selector, state: key, viewport: where.viewport });
      }
    }
    await page.setViewport(explore); await page.settle();
    events.emit('state', { key, label: state.label, url: seen.url, depth, path: state.firstPath.map(s => s.label), screenshots: state.screenshots, index: ledger.order.length });

    // Edges out of this state. Safety decides up front; it is checked again before acting.
    const offered = [...seen.actions];
    if (depth > 0) offered.push({ kind: 'back' });
    offered.push({ kind: 'reload' });
    for (const a of offered) {
      const verdict = checkAction(a, cfg, seen.url);
      const edge = ledger.addEdge(key, actionRecord(a), verdict.allowed ? 'untried' : 'blocked', verdict.allowed ? undefined : verdict.reason);
      if (!verdict.allowed) events.emit('blocked', { from: key, action: edge.action, rule: verdict.rule, reason: verdict.reason });
    }
    await write();
    return { key, isNew: true };
  }

  /** Fresh context → replay → callback. The context is always disposed. */
  async function inFreshContext(fn) {
    const page = await Page.open(browser, cfg, explore);
    try { return await fn(page); } finally { await page.close(); }
  }

  async function replay(page, path) {
    for (const step of path) {
      const r = await perform(page, step, cfg);
      if (r.status !== 'passed') throw new Error(`replay stopped at ${step.label}: ${r.reason}`);
    }
  }

  const emitEdge = (edge, newState) => {
    edge.emitted = true;
    events.emit('edge', { from: edge.from, to: edge.to, newState, action: edge.action, status: edge.status, ...(edge.reason ? { reason: edge.reason } : {}), ...(edge.filled ? { filled: edge.filled.length } : {}) });
  };

  const stop = () => { status = 'stopped'; reason = 'interrupted'; };
  opts.signal?.addEventListener('abort', stop);

  try {
    // Roots: one state per entry path.
    for (const entry of cfg.entry) {
      const step = { kind: 'goto', url: new URL(entry, cfg.baseUrl).href };
      step.label = actionLabel(step);
      try { await inFreshContext(async page => { await perform(page, step, cfg); await visit(page, [step], await observe(page)); }); }
      catch (e) { events.emit('edge', { from: null, to: null, action: actionRecord(step), status: 'failed', reason: e.message }); }
    }

    while (status === 'running') {
      if (opts.signal?.aborted) { stop(); break; }
      if (ledger.order.length >= cfg.budget.maxStates) { status = 'budget'; reason = `reached maxStates (${cfg.budget.maxStates})`; break; }
      if (actions >= cfg.budget.maxActions) { status = 'budget'; reason = `reached maxActions (${cfg.budget.maxActions})`; break; }
      if (Date.now() - started >= cfg.budget.maxMinutes * 60000) { status = 'budget'; reason = `reached maxMinutes (${cfg.budget.maxMinutes})`; break; }
      const edge = ledger.nextOpen();
      if (!edge) { status = 'complete'; reason = 'no untried actions left'; break; }
      const from = ledger.states[edge.from];

      // Loop bounding: the same control on many screens is tried a capped number of times,
      // and paths deeper than maxDepth are not extended.
      const sig = actionSignature(edge.action);
      if (!['back', 'reload'].includes(edge.action.kind) && (repeats.get(sig) ?? 0) >= cfg.maxEdgeRepeats) { edge.closed = true; edge.reason = `repeat cap: "${edge.action.label}" already tried ${cfg.maxEdgeRepeats} times`; continue; }
      if (from.depth >= cfg.maxDepth) { edge.closed = true; edge.reason = `depth cap (${cfg.maxDepth})`; continue; }
      repeats.set(sig, (repeats.get(sig) ?? 0) + 1);
      actions++;

      try {
        await inFreshContext(async page => {
          await replay(page, from.firstPath);
          const at = await observe(page);
          const here = stateKey(at).key;
          if (here !== edge.from) { edge.status = 'failed'; edge.reason = `replay reached a different state (${here}); the app may not be deterministic`; return; }
          const r = await perform(page, edge.action, cfg, at);
          const popups = await page.closePopups();
          edge.status = r.status;
          if (r.reason) edge.reason = r.reason;
          if (r.filled?.length) edge.filled = r.filled;
          if (r.status === 'blocked') { events.emit('blocked', { from: edge.from, action: edge.action, rule: r.rule, reason: r.reason }); return; }
          if (r.status === 'failed') return;
          const after = await observe(page);
          if (page.offOrigin.length) edge.offOriginBlocked = [...new Set(page.offOrigin)];
          if (popups.length) edge.popupsClosed = popups;
          if (page.jsDialogs.length) edge.jsDialogs = page.jsDialogs;
          if (!isAllowedUrl(after.url, cfg)) {
            if (page.offOrigin.length) {
              // A script or redirect tried to leave the app; the network guard stopped the request.
              edge.status = 'blocked'; edge.rule = 'off-origin-navigation';
              edge.reason = `tried to navigate off the app origin to ${page.offOrigin[0]}; the request was stopped`;
              events.emit('blocked', { from: edge.from, action: edge.action, rule: edge.rule, reason: edge.reason });
            } else { edge.status = 'failed'; edge.reason = `left the app origin (${after.url})`; }
            return;
          }
          if (page.errors.length) { edge.status = 'failed'; edge.reason = 'uncaught page error: ' + page.errors[0]; }
          // The edge event goes out before the state it leads to, so a live view can draw the arrow first.
          edge.to = stateKey(after).key;
          emitEdge(edge, !ledger.hasState(edge.to));
          await visit(page, [...from.firstPath, edge.action], after);
        });
      } catch (e) {
        if (!edge.emitted) { edge.status = 'failed'; edge.reason = e.message; }
        else edge.visitError = e.message;
      }
      if (edge.status !== 'blocked' && !edge.emitted) emitEdge(edge, false);
    }
  } catch (e) {
    status = 'error'; reason = e.message;
  } finally {
    if (status === 'running') { status = 'error'; reason = 'stopped unexpectedly'; }
    opts.signal?.removeEventListener('abort', stop);
    await browser.cleanup().catch(() => {});
  }

  for (const e of ledger.edges) if (e.status === 'untried' && !e.reason) e.reason = status === 'complete' ? 'not reached' : `run stopped: ${reason}`;
  const counts = ledger.counts();
  const meta = { baseUrl: cfg.baseUrl, entry: cfg.entry, viewports: cfg.viewports.map(viewportName), status, reason, actions, durationMs: Date.now() - started, startedAt: new Date(started).toISOString(), checks: checks.map(c => c.meta) };
  await write();
  await writeFile(join(out, 'report.html'), await renderRunReport({ out, ledger: ledger.toJSON(), order: ledger.order, findings: findings.list(), meta }));
  events.emit('run-end', { status, reason, counts, findings: findings.list().length, actions, durationMs: meta.durationMs, out });
  return { out, status, reason, counts };
}
