/**
 * RD01 readability: can a person read this text? One user-facing check, four rules. Every
 * finding carries measurements.rule.
 *
 *   R1 contrast  WCAG 1.4.3: 4.5:1 for normal text, 3:1 for large. The contrast check (UI03)
 *                is reused as is; a varied background (photo, gradient) stays `review`.
 *   R2 cut-off   Text clipped by hidden overflow, an ellipsis or a line clamp: typography's
 *                (TY01) clipping rule. Also run at 200% text scale (ids end in "-200").
 *   R3 overflow  Text running off the screen horizontally, or out of its own box without being
 *                clipped. Text inside an overflow-x:auto|scroll container is exempt (it scrolls).
 *   R4 covered   Another element paints over the centre of the text (document.elementsFromPoint).
 *                Reported once, as covered; no contrast finding is made for covered text,
 *                because its sampled "background" is the thing on top of it.
 *
 * ── How the runner calls it (src/runner/checks.mjs) ──────────────────────────────────
 *   collected = evaluate(`(${readability.collect})(config)`)        // normal pass
 *   analyze(collected, {viewport, config, screenshot})              // full-page PNG for R1
 *   then the 200% text-scale variant: apply, collect, undo, analyze(c, {..., variant})
 *
 * ctx.config (appConfig.checks.readability): { contrast?: {...UI03 config} }
 */
import * as contrast from '../contrast/index.mjs';
import * as typography from '../typography/index.mjs';
import {collectReadability} from './collect.mjs';

export const meta = {id: 'RD01', name: 'readability', title: 'Text can be read: enough contrast, not cut off, not off the screen, not covered.'};
export const collect = collectReadability;
// The 200% text-scale pass, shared with typography (id "text-200", suffix "-200").
export const variants = typography.variants;

const slug = s => String(s).replace(/^#/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'page';
const quote = t => `"${t.slice(0, 40)}${t.length > 40 ? '…' : ''}"`;
const ROOTS = new Set(['body', 'html']);

/** R2 through typography's clipping rule, re-labelled. */
function cutOff(collected, variant) {
  const clips = (collected.clips ?? []).filter(c => !ROOTS.has(c.selector));
  const out = typography.analyze({clips, runs: [], blocks: [], paragraphs: [], fontFaces: [], textScale: collected.textScale}, {variant});
  return out.findings.filter(f => f.id.startsWith('TY01-clipped-')).map(f => ({
    ...f, id: f.id.replace('TY01-clipped-', 'RD01-cut-off-'),
    measurements: {rule: 'cut-off', ...f.measurements},
  }));
}

export function analyze(collected, ctx = {}) {
  const variant = ctx.variant ?? (collected.textScale > 1 ? variants.find(v => v.textScale === collected.textScale) ?? {id: 'text-scale', suffix: '-' + collected.textScale * 100, textScale: collected.textScale} : null);
  if (variant) {
    const findings = cutOff(collected, variant);
    return {checkId: meta.id, variant: variant.id, findings, summary: {cutOff: findings.length, textScale: collected.textScale}};
  }
  const findings = [];

  // R4 first: covered text is reported once, and suppresses R1 for the same element.
  const covered = new Set();
  for (const c of collected.covered ?? []) {
    covered.add(c.selector);
    findings.push({
      id: `RD01-covered-${slug(c.selector)}`, status: 'fail', severity: 'high', selector: c.selector, rect: c.rect,
      message: `${quote(c.text)} is covered by ${c.coverLabel}, so it cannot be read.`,
      measurements: {rule: 'covered', coveredBy: c.cover, coveredByLabel: c.coverLabel, coverRect: c.coverRect, coverPosition: c.coverPosition, point: c.point},
    });
  }

  // R1: contrast, reused.
  const r1 = contrast.analyze(collected.contrast ?? {runs: []}, {...ctx, config: ctx.config?.contrast ?? {}});
  for (const f of r1.findings) {
    if (covered.has(f.selector)) continue;
    findings.push({...f, id: f.id.replace(/^UI03-/, 'RD01-contrast-'), measurements: {rule: 'contrast', ...f.measurements}});
  }

  // R2: cut off.
  findings.push(...cutOff(collected, null));

  // R3: overflow.
  for (const o of collected.overflows ?? []) {
    const {selector, rect, text, ...numbers} = o;
    const offScreen = o.kind === 'off-screen';
    findings.push({
      id: `RD01-overflow-${slug(o.selector)}`, status: 'fail', severity: offScreen ? 'high' : 'medium', selector: o.selector, rect: o.rect,
      message: offScreen
        ? `${quote(o.text)} runs ${Math.round(o.beyond)}px off the ${o.side} edge of the ${o.viewportWidth}px-wide screen, so the end of it cannot be read.`
        : `${quote(o.text)} spills ${Math.round(o.beyond)}px outside its box and can run into what is next to it.`,
      measurements: {rule: 'overflow', ...numbers},
    });
  }

  const count = rule => findings.filter(f => f.measurements.rule === rule).length;
  return {
    checkId: meta.id, findings,
    summary: {
      fail: findings.filter(f => f.status === 'fail').length, review: findings.filter(f => f.status === 'review').length,
      contrast: count('contrast'), cutOff: count('cut-off'), overflow: count('overflow'), covered: count('covered'),
      contrastSuppressedByCover: r1.findings.filter(f => covered.has(f.selector)).map(f => f.selector),
      results: r1.summary.results, skipped: {...r1.summary.skipped, layout: collected.skipped ?? []},
    },
  };
}
