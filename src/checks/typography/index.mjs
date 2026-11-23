/**
 * TY01 typography: rendered vs declared font, family/size/weight counts, minimum sizes,
 * body line height, line length and clipped text, plus a 200% text-scale clipping pass.
 *
 * ── How the runner calls it ──────────────────────────────────────────────────────────
 *   const collected = await evaluate(`(${typography.collect})(${JSON.stringify(options)})`);
 *   const extra     = await typography.gather(send, collected);   // == { fonts: await gatherFonts(send, collected) }
 *   const result    = typography.analyze(collected, { viewport, config, extra });
 *
 * `send(method, params)` is a CDP sender already bound to the page's session, for example
 * `(m, p) => browser.cdp.send(m, p, sessionId)`. Call gather() right after collect(), while the
 * page is in the same state, because it resolves the collector's selectors with DOM.querySelector.
 * gatherFonts enables the DOM and CSS domains (DOM.enable, CSS.enable) and leaves them enabled.
 * Without ctx.extra.fonts the analyzer still runs, but skips the rendered-font rule and counts
 * declared families instead (summary.fontsMeasured = false).
 *
 * ── Variant ──────────────────────────────────────────────────────────────────────────
 * variants[0] is a 200% text scale. Each variant is { id, suffix, method, params, undo }:
 * after the normal pass, the runner sends {method, params}, settles, runs collect() again,
 * sends undo.method/undo.params, then calls analyze(collected, { ...ctx, variant }). The variant
 * pass re-checks clipping only and suffixes ids with "-200". gather() is not needed for it.
 * The collector also reads window.__agentManuelTextScale, so analyze() detects the variant pass
 * even if ctx.variant is not passed.
 *
 * ctx.config (appConfig.checks.typography):
 *   { maxFamilies: 2, maxSizes: 8, maxWeights: 4, approvedFamilies?: string[], approvedSizes?: number[] }
 */
import {collectTypography} from './collect.mjs';

export const meta = {id: 'TY01', name: 'typography', title: 'Text renders in the intended font, at a readable size, and is not cut off.'};

export const collect = collectTypography;

const APPLY_200 = `(() => {
  if (window.__agentManuelTextScaleUndo) return 'already';
  const els = [...document.querySelectorAll('*')];
  const before = els.map(e => { const s = getComputedStyle(e); return [e, s.fontSize, s.lineHeight]; });
  const undo = [];
  for (const [e, fs, lh] of before) {
    if (!e.style) continue;
    undo.push([e, e.style.getPropertyValue('font-size'), e.style.getPropertyPriority('font-size'), e.style.getPropertyValue('line-height'), e.style.getPropertyPriority('line-height')]);
    e.style.setProperty('font-size', (parseFloat(fs) * 2) + 'px', 'important');
    if (/px$/.test(lh)) e.style.setProperty('line-height', (parseFloat(lh) * 2) + 'px', 'important');
  }
  window.__agentManuelTextScaleUndo = undo;
  window.__agentManuelTextScale = 2;
  return 'applied';
})()`;
const UNDO_200 = `(() => {
  for (const [e, fs, fsp, lh, lhp] of window.__agentManuelTextScaleUndo || []) {
    fs ? e.style.setProperty('font-size', fs, fsp) : e.style.removeProperty('font-size');
    lh ? e.style.setProperty('line-height', lh, lhp) : e.style.removeProperty('line-height');
  }
  delete window.__agentManuelTextScaleUndo; delete window.__agentManuelTextScale;
  return 'undone';
})()`;

export const variants = [{
  id: 'text-200', suffix: '-200', textScale: 2,
  method: 'Runtime.evaluate', params: {expression: APPLY_200, returnByValue: true},
  undo: {method: 'Runtime.evaluate', params: {expression: UNDO_200, returnByValue: true}},
}];

/**
 * Asks Chrome which fonts actually painted each collected run (CSS.getPlatformFontsForNode).
 * @param send (method, params) => Promise, bound to the page session.
 * @param collected the object collect() returned.
 * @returns {Promise<{bySelector: Record<string, {familyName, postScriptName, isCustomFont, glyphCount}[]>, errors: number}>}
 */
export async function gatherFonts(send, collected, {max = 2000} = {}) {
  await send('DOM.enable');
  await send('CSS.enable');
  const {root} = await send('DOM.getDocument', {depth: 0});
  const bySelector = {};
  let errors = 0;
  for (const run of (collected?.runs ?? []).slice(0, max)) {
    try {
      const {nodeId} = await send('DOM.querySelector', {nodeId: root.nodeId, selector: run.selector});
      if (!nodeId) { errors++; continue; }
      let {fonts} = await send('CSS.getPlatformFontsForNode', {nodeId});
      // Textareas (and some inputs) paint inside a user-agent shadow root: ask its elements.
      if (!fonts.length && run.kind === 'control') fonts = await shadowFonts(send, nodeId);
      bySelector[run.selector] = fonts;
    } catch { errors++; }
  }
  return {bySelector, errors};
}

async function shadowFonts(send, nodeId) {
  const {node} = await send('DOM.describeNode', {nodeId, depth: -1, pierce: true});
  const ids = [];
  const walk = n => { if (n.nodeType === 1 && n !== node) ids.push(n.backendNodeId); for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c); };
  walk(node);
  if (!ids.length) return [];
  const {nodeIds} = await send('DOM.pushNodesByBackendIdsToFrontend', {backendNodeIds: ids});
  const merged = new Map();
  for (const id of nodeIds) {
    if (!id) continue;
    const {fonts} = await send('CSS.getPlatformFontsForNode', {nodeId: id});
    for (const f of fonts) {
      const k = f.postScriptName + '|' + f.familyName;
      merged.set(k, {...f, glyphCount: Math.max(merged.get(k)?.glyphCount ?? 0, f.glyphCount)});
    }
  }
  return [...merged.values()];
}

/** Generic hook form of gatherFonts: the runner can call check.gather?.(send, collected) for any check. */
export async function gather(send, collected) { return {fonts: await gatherFonts(send, collected)}; }

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|-apple-system|blinkmacsystemfont|inherit|initial)$/i;
const EMOJI = /emoji|symbol/i;
const MONO = /mono|courier|menlo|monaco|consolas|inconsolata/i;
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const slug = s => String(s).replace(/^#/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'page';
const isMono = run => /monospace/i.test(run.fontFamily) || MONO.test(run.firstFamily);

/** Fonts painted by the run's own text: its subtree minus its child runs. */
function ownFonts(run, runs, bySelector) {
  const self = bySelector[run.selector];
  if (!self) return null;
  const counts = new Map(self.map(f => [f.postScriptName + '|' + f.familyName, {...f}]));
  for (const child of runs) {
    if (child.parentRun !== run.index) continue;
    for (const f of bySelector[child.selector] ?? []) {
      const k = f.postScriptName + '|' + f.familyName, c = counts.get(k);
      if (c) c.glyphCount -= f.glyphCount;
    }
  }
  return [...counts.values()].filter(f => f.glyphCount > 0);
}

export function analyze(collected, ctx = {}) {
  const config = {maxFamilies: 2, maxSizes: 8, maxWeights: 4, ...(ctx.config ?? {})};
  const viewport = ctx.viewport ?? collected.viewport ?? {width: 1280, height: 800};
  const variant = ctx.variant ?? (collected.textScale > 1 ? variants.find(v => v.textScale === collected.textScale) ?? {suffix: '-' + collected.textScale * 100} : null);
  const findings = [];
  const add = f => findings.push(f);

  // Clipping runs in both passes.
  const suffix = variant?.suffix ?? '';
  for (const c of collected.clips ?? []) {
    const how = c.reason === 'ellipsis' ? 'is cut off with "…"' : c.reason === 'line-clamp' ? `is cut off after ${c.lineClamp} line${c.lineClamp > 1 ? 's' : ''}` : 'is cut off by its container';
    add({
      id: `TY01-clipped-${slug(c.selector)}${suffix}`, status: 'fail', severity: 'high', selector: c.selector, rect: c.rect,
      message: `The text "${c.text.slice(0, 40)}${c.text.length > 40 ? '…' : ''}" ${how}${variant ? ' when text is enlarged to 200%' : ''}, so part of it cannot be read.`,
      measurements: {reason: c.reason, axis: c.axis, scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, scrollHeight: c.scrollHeight, clientHeight: c.clientHeight, hiddenX: c.beyondX, hiddenY: c.beyondY, overflowX: c.overflowX, overflowY: c.overflowY, textOverflow: c.textOverflow, lineClamp: c.lineClamp, ...(variant ? {textScale: variant.textScale ?? collected.textScale} : {})},
    });
  }
  if (variant) return {checkId: meta.id, variant: variant.id ?? 'text-scale', findings, summary: {clipped: findings.length, textScale: collected.textScale}};

  const runs = collected.runs ?? [];
  const bySelector = ctx.extra?.fonts?.bySelector ?? null;
  const loadedFaces = new Set((collected.fontFaces ?? []).filter(f => f.status === 'loaded').map(f => norm(f.family)));

  // 1. Rendered font vs first declared family (grouped by declared → rendered pair).
  const families = new Map(), fallbacks = new Map();
  for (const run of runs) {
    const own = bySelector ? ownFonts(run, runs, bySelector) : null;
    const painted = own?.filter(f => !EMOJI.test(f.familyName)).sort((a, b) => b.glyphCount - a.glyphCount) ?? [];
    const dominant = painted[0];
    if (!isMono(run)) {
      const family = dominant ? dominant.familyName : bySelector ? null : run.firstFamily;
      if (family) families.set(family, (families.get(family) ?? 0) + 1);
    }
    if (!dominant || GENERIC.test(run.firstFamily) || !run.firstFamily) continue;
    const want = norm(run.firstFamily);
    const ok = norm(dominant.familyName) === want || norm(dominant.postScriptName).startsWith(want) || loadedFaces.has(want);
    if (ok) continue;
    const key = run.firstFamily + '→' + dominant.familyName;
    if (!fallbacks.has(key)) fallbacks.set(key, {run, dominant, selectors: []});
    fallbacks.get(key).selectors.push(run.selector);
  }
  for (const {run, dominant, selectors} of fallbacks.values()) {
    const face = (collected.fontFaces ?? []).find(f => norm(f.family) === norm(run.firstFamily));
    add({
      id: `TY01-fallback-${slug(run.firstFamily)}-${slug(dominant.familyName)}`, status: 'fail', severity: 'medium', selector: run.selector, rect: run.rect,
      message: `This text asks for the font "${run.firstFamily}" but the browser drew it in "${dominant.familyName}" instead${face ? ` (the web font ${face.status === 'error' ? 'failed to load' : 'did not load'})` : ' (that font is not available)'}${selectors.length > 1 ? `; ${selectors.length} text elements are affected` : ''}.`,
      measurements: {declared: run.fontFamily, firstDeclared: run.firstFamily, rendered: dominant.familyName, postScriptName: dominant.postScriptName, glyphs: dominant.glyphCount, webFontStatus: face?.status ?? null, count: selectors.length, selectors: selectors.slice(0, 50)},
    });
  }

  // 2. Minimum sizes.
  for (const run of runs) {
    if (run.kind === 'control' && run.fontSize < 16) add({
      id: `TY01-input-size-${slug(run.selector)}`, status: 'fail', severity: 'medium', selector: run.selector, rect: run.rect,
      message: `This ${run.tag} uses ${round(run.fontSize, 1)}px text. Below 16px, iPhones zoom the whole page when someone taps into it.`,
      measurements: {fontSize: run.fontSize, minimum: 16},
    });
    else if (run.kind === 'text' && run.fontSize < 12) add({
      id: `TY01-tiny-${slug(run.selector)}`, status: 'fail', severity: 'high', selector: run.selector, rect: run.rect,
      message: `"${run.text.slice(0, 40)}" is ${round(run.fontSize, 1)}px, which is too small for most people to read. Use at least 12px.`,
      measurements: {fontSize: run.fontSize, minimum: 12},
    });
  }

  // 3. Body text: small at mobile widths, line height.
  for (const b of collected.blocks ?? []) {
    if (viewport.width <= 480 && b.fontSize >= 12 && b.fontSize < 16) add({
      id: `TY01-small-body-${slug(b.selector)}`, status: 'review', severity: 'low', selector: b.selector, rect: b.rect,
      message: `This ${b.tag} text is ${round(b.fontSize, 1)}px on a ${viewport.width}px-wide screen. Body text on phones is easier to read at 16px; check that the smaller size is intended.`,
      measurements: {fontSize: b.fontSize, recommended: 16, viewportWidth: viewport.width},
    });
    const lh = b.lineHeight ?? b.measuredLineHeight;
    const ratio = lh / b.fontSize;
    if (Number.isFinite(ratio) && (ratio < 1.3 || ratio > 1.8)) add({
      id: `TY01-line-height-${slug(b.selector)}`, status: 'review', severity: 'low', selector: b.selector, rect: b.rect,
      message: `The lines in this ${b.tag} are spaced at ${round(ratio, 2)}× the text size; ${ratio < 1.3 ? 'tight spacing makes lines run together' : 'loose spacing makes lines feel disconnected'}. Between 1.3× and 1.8× is easiest to read.`,
      measurements: {fontSize: b.fontSize, lineHeight: round(lh), ratio: round(ratio), source: b.lineHeight == null ? 'measured (line-height: normal)' : 'computed', min: 1.3, max: 1.8},
    });
  }

  // 4. Line length in paragraphs: characters that fit on the widest line.
  for (const p of collected.paragraphs ?? []) {
    if (!p.chars || !p.totalLineWidth) continue;
    const perLine = p.maxLineWidth / (p.totalLineWidth / p.chars);
    if (perLine > 80) add({
      id: `TY01-line-length-${slug(p.selector)}`, status: 'review', severity: 'low', selector: p.selector, rect: p.rect,
      message: `Lines in this paragraph hold about ${Math.round(perLine)} characters. Above 80, readers lose their place moving to the next line.`,
      measurements: {charsPerLine: round(perLine, 1), maximum: 80, lines: p.lines, chars: p.chars, maxLineWidth: p.maxLineWidth},
    });
  }

  // 5. Page-level counts.
  const pageRect = {x: 0, y: 0, width: viewport.width, height: viewport.height};
  const sizes = [...new Set(runs.map(r => round(r.fontSize, 1)))].sort((a, b) => a - b);
  const weights = [...new Set(runs.map(r => r.fontWeight))].sort((a, b) => a - b);
  const familyList = [...families.keys()].sort();
  if (familyList.length > config.maxFamilies) add({
    id: 'TY01-family-count', status: 'fail', severity: 'low', selector: 'body', rect: pageRect,
    message: `This screen draws text in ${familyList.length} different fonts (${familyList.join(', ')}); the limit is ${config.maxFamilies}, not counting code fonts.`,
    measurements: {families: familyList, count: familyList.length, maximum: config.maxFamilies, measured: !!bySelector},
  });
  if (sizes.length > config.maxSizes) add({
    id: 'TY01-size-count', status: 'review', severity: 'low', selector: 'body', rect: pageRect,
    message: `This screen uses ${sizes.length} different text sizes (${sizes.join(', ')}px). More than ${config.maxSizes} usually means the type scale has drifted.`,
    measurements: {sizes, count: sizes.length, maximum: config.maxSizes},
  });
  if (weights.length > config.maxWeights) add({
    id: 'TY01-weight-count', status: 'review', severity: 'low', selector: 'body', rect: pageRect,
    message: `This screen uses ${weights.length} different font weights (${weights.join(', ')}). More than ${config.maxWeights} usually means styles have drifted.`,
    measurements: {weights, count: weights.length, maximum: config.maxWeights},
  });

  // 6. Optional design-system allow-lists.
  if (Array.isArray(config.approvedFamilies)) {
    const approved = new Set(config.approvedFamilies.map(norm));
    for (const family of familyList) if (!approved.has(norm(family))) {
      const run = runs.find(r => !isMono(r) && (bySelector ? ownFonts(r, runs, bySelector)?.some(f => f.familyName === family) : r.firstFamily === family));
      add({
        id: `TY01-unapproved-family-${slug(family)}`, status: 'review', severity: 'low', selector: run?.selector ?? 'body', rect: run?.rect ?? pageRect,
        message: `Text is drawn in "${family}", which is not one of the approved fonts (${config.approvedFamilies.join(', ')}).`,
        measurements: {family, approved: config.approvedFamilies, elements: families.get(family)},
      });
    }
  }
  if (Array.isArray(config.approvedSizes)) {
    for (const size of sizes) if (!config.approvedSizes.some(a => Math.abs(a - size) <= 0.5)) {
      const hits = runs.filter(r => round(r.fontSize, 1) === size);
      add({
        id: `TY01-unapproved-size-${String(size).replace('.', '_')}`, status: 'review', severity: 'low', selector: hits[0].selector, rect: hits[0].rect,
        message: `${hits.length} text element${hits.length > 1 ? 's use' : ' uses'} ${size}px, which is not on the approved size scale (${config.approvedSizes.join(', ')}px).`,
        measurements: {fontSize: size, approved: config.approvedSizes, count: hits.length, selectors: hits.slice(0, 50).map(r => r.selector)},
      });
    }
  }

  return {
    checkId: meta.id, findings,
    summary: {
      runs: runs.length, fail: findings.filter(f => f.status === 'fail').length, review: findings.filter(f => f.status === 'review').length,
      fontsMeasured: !!bySelector, families: familyList, sizes, weights, clipped: (collected.clips ?? []).length,
    },
  };
}
