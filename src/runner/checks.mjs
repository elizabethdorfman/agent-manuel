// Runs every registered check on the current state at one viewport.
//
// Variants come in two shapes, both of which the runner supports:
//  - Setup variants, a plain { method, params, undo? }, with no `id`. They are applied around the
//    check's only pass: apply all, collect, undo all. Reflow's 320px override is one.
//  - Pass variants, { id, method, params, undo, ... }. The normal pass runs first, then one extra
//    pass per variant: apply, settle, collect, undo, analyze(collected, { ...ctx, variant }).
//    Typography's 200% text scale is one.
// An optional `gather(send, collected)` export runs right after a normal-pass collect, and
// its result is passed to analyze as ctx.extra.

const AUTO_UNDO = {
  'Emulation.setEmulatedMedia': { method: 'Emulation.setEmulatedMedia', params: { media: '', features: [] } },
  'Emulation.setCPUThrottlingRate': { method: 'Emulation.setCPUThrottlingRate', params: { rate: 1 } },
  'Emulation.setPageScaleFactor': { method: 'Emulation.setPageScaleFactor', params: { pageScaleFactor: 1 } },
  'Emulation.setEmulatedVisionDeficiency': { method: 'Emulation.setEmulatedVisionDeficiency', params: { type: 'none' } },
  'Emulation.setTouchEmulationEnabled': { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false } },
  'Emulation.setScrollbarsHidden': { method: 'Emulation.setScrollbarsHidden', params: { hidden: false } },
  'Emulation.setAutoDarkModeOverride': { method: 'Emulation.setAutoDarkModeOverride', params: {} },
  'Emulation.setDefaultBackgroundColorOverride': { method: 'Emulation.setDefaultBackgroundColorOverride', params: {} },
  'Emulation.setTimezoneOverride': { method: 'Emulation.setTimezoneOverride', params: { timezoneId: '' } },
  'Emulation.setLocaleOverride': { method: 'Emulation.setLocaleOverride', params: {} },
  // The viewport is restored after every variant, so a width override needs no undo entry.
  'Emulation.setDeviceMetricsOverride': null,
};

export function undoFor(variant) {
  if (variant.undo) return variant.undo;
  if (variant.method in AUTO_UNDO) return AUTO_UNDO[variant.method];
  throw new Error(`Variant ${variant.method} has no undo; add an "undo": { method, params } entry.`);
}

/** Splits a check's variants into setup variants (no id) and extra-pass variants (with id). */
export function planVariants(check) {
  const all = Array.isArray(check.variants) ? check.variants : [];
  return { setup: all.filter(v => v.id == null), passes: all.filter(v => v.id != null) };
}

/** Applies variants, runs fn, then undoes them in reverse order and restores the viewport. */
async function withVariants(page, variants, viewport, fn) {
  const undos = variants.map(undoFor); // throws before anything is applied if one has no undo
  let applied = 0;
  try {
    for (const v of variants) { await page.send(v.method, v.params ?? {}); applied++; }
    if (variants.length) await page.settle();
    return await fn();
  } finally {
    for (const u of undos.slice(0, applied).reverse()) if (u) await page.send(u.method, u.params ?? {}).catch(() => {});
    if (applied) { await page.setViewport(viewport).catch(() => {}); await page.settle(); }
  }
}

/**
 * Returns [{ checkId, name, findings, summary, error? }] for one viewport.
 * screenshot: the PNG Buffer for this state and viewport, passed to analyze as ctx.screenshot.
 */
export async function runChecks(page, checks, cfg, viewport, screenshot) {
  const results = [];
  const send = (method, params) => page.send(method, params);
  for (const check of checks) {
    const name = check.meta?.name ?? 'unknown', checkId = check.meta?.id ?? name;
    const config = cfg.checks?.[name] ?? {};
    const collect = () => page.evaluate(`(${check.collect.toString()})(${JSON.stringify(config)})`, { timeout: 30000 });
    const entry = { checkId, name, findings: [], summary: {} };
    const { setup, passes } = planVariants(check);
    try {
      const collected = await withVariants(page, setup, viewport, collect);
      const extra = typeof check.gather === 'function' ? await check.gather(send, collected) : undefined;
      const out = await check.analyze(collected, { viewport, config, screenshot, ...(extra ? { extra } : {}) });
      entry.checkId = out?.checkId ?? checkId;
      entry.findings.push(...(out?.findings ?? []));
      entry.summary = out?.summary ?? {};
      for (const variant of passes) {
        const vCollected = await withVariants(page, [variant], viewport, collect);
        const vOut = await check.analyze(vCollected, { viewport, config, screenshot, variant });
        entry.findings.push(...(vOut?.findings ?? []));
        entry.summary = { ...entry.summary, [variant.id]: vOut?.summary ?? {} };
      }
    } catch (e) {
      entry.error = e.message;
    }
    results.push(entry);
  }
  return results;
}
