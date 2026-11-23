/**
 * UI03 contrast: computed text colour vs the background pixels actually painted behind it.
 *
 * ── How the runner calls it ──────────────────────────────────────────────────────────
 *   const collected = await evaluate(`(${contrast.collect})({})`);
 *   const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true,
 *     clip: {...collected.capture, scale: 1}});            // {x:0, y:0, width: innerWidth, height: scrollHeight}
 *   const result = contrast.analyze(collected, {viewport, config, screenshot: Buffer.from(shot.data, 'base64')});
 *
 * The screenshot must be taken right after collect() in the same page state, and must cover
 * collected.capture (document coordinates from the top-left of the page). Its region is taken
 * from the PNG itself (png size / devicePixelRatio, from the top-left), which also holds when
 * the runner's screenshot is narrower than innerWidth. If it covers some other region, pass
 * ctx.screenshotClip = {x, y, width, height} in document CSS px.
 * Without a screenshot every run is skipped (summary.skipped.no-screenshot).
 *
 * Background: pixels in a 4px band around the text's line boxes (inside the block that holds
 * the text), excluding every text line box, image and control inside that block, so glyphs
 * are never sampled. Borders are never background: for controls and any block with a visible
 * border the block is inset by its border widths + 2px. Controls (inputs, textareas, selects)
 * are sampled across that whole inner box minus the measured text (run.sampleBox). If that band is too thin, the pixels inside the line boxes that are far
 * from the text colour are used instead.
 *
 * ctx.config (appConfig.checks.contrast): { uniformSpread: 1.15, minSamples: 16 }
 */
import {decodePng} from '../_lib/png.mjs';
import {contrastRatio, blend, isLargeText, requiredRatio} from '../_lib/contrast-math.mjs';
import {collectContrast} from './collect.mjs';

export const meta = {id: 'UI03', name: 'contrast', title: 'Text stands out from what is behind it.'};
export const collect = collectContrast;
export const variants = [];

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const slug = s => String(s).replace(/^#/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'page';
const decoded = new WeakMap();
const PAD = 4, MAX_SAMPLES = 5000;

const inside = (x, y, r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
const intersect = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return {x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y)};
};
const union = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return {x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y};
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

/** Reads background samples for one run. Returns {samples: [[r,g,b]...], method}. */
export function sampleBackground(img, clip, run) {
  const scale = img.width / clip.width;
  const px = (x, y) => {
    const ix = Math.floor((x - clip.x) * scale), iy = Math.floor((y - clip.y) * scale);
    if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) return null;
    const i = (iy * img.width + ix) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const shotRect = {x: clip.x, y: clip.y, width: img.width / scale, height: img.height / scale};
  const text = union(run.textRects);
  const around = run.sampleBox ?? {x: text.x - PAD, y: text.y - PAD, width: text.width + 2 * PAD, height: text.height + 2 * PAD};
  const area = intersect(intersect(around, run.backgroundBox), shotRect);
  if (!area.width || !area.height) return {samples: [], method: 'outside-screenshot'};
  const occupied = [...run.textRects, ...(run.occupied ?? [])];
  const step = Math.max(1 / scale, Math.sqrt(area.width * area.height / MAX_SAMPLES));
  const ring = [];
  for (let y = area.y + step / 2; y < area.y + area.height; y += step)
    for (let x = area.x + step / 2; x < area.x + area.width; x += step) {
      if (occupied.some(r => inside(x, y, r))) continue;
      const p = px(x, y); if (p) ring.push(p);
    }
  if (ring.length >= (run.minSamples ?? 16)) return {samples: ring, method: 'ring'};
  // Fallback: inside the line boxes, keep the pixels far from the text colour.
  const within = [];
  for (const r of run.textRects) {
    const a = intersect(r, shotRect);
    for (let y = a.y + step / 2; y < a.y + a.height; y += step)
      for (let x = a.x + step / 2; x < a.x + a.width; x += step) { const p = px(x, y); if (p) within.push(p); }
  }
  if (!within.length) return {samples: ring, method: 'ring'};
  const fg = run.color;
  const far = Math.max(...within.map(p => dist(p, fg)));
  return {samples: [...ring, ...within.filter(p => dist(p, fg) >= 0.6 * far)], method: 'inside-text-box'};
}

/** WCAG ratio statistics of a text colour against background samples. */
export function measureRun(run, samples, {uniformSpread = 1.15} = {}) {
  const alpha = (run.color[3] ?? 1) * (run.opacity ?? 1);
  const fg = [run.color[0], run.color[1], run.color[2], alpha];
  const ratios = samples.map(bg => contrastRatio(blend(fg, bg), bg)).sort((a, b) => a - b);
  const buckets = new Map();
  for (const p of samples) {
    const k = (p[0] >> 3) + ',' + (p[1] >> 3) + ',' + (p[2] >> 3);
    const b = buckets.get(k) ?? {n: 0, sum: [0, 0, 0]};
    b.n++; b.sum[0] += p[0]; b.sum[1] += p[1]; b.sum[2] += p[2];
    buckets.set(k, b);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  const modeColor = top.sum.map(v => Math.round(v / top.n));
  const modeShare = top.n / samples.length;
  const min = pct(ratios, 0.05), max = pct(ratios, 0.95), median = pct(ratios, 0.5);
  const uniform = modeShare >= 0.6 || max / min <= uniformSpread;
  const ratio = modeShare >= 0.6 ? contrastRatio(blend(fg, modeColor), modeColor) : median;
  return {ratio, min, max, median, uniform, modeColor, modeShare, effectiveText: blend(fg, modeColor).map(Math.round), alpha};
}

const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

export function analyze(collected, ctx = {}) {
  const config = {uniformSpread: 1.15, minSamples: 16, ...(ctx.config ?? {})};
  const findings = [], skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  for (const s of collected.skipped ?? []) skip(s.reason);
  let img = null;
  if (ctx.screenshot) {
    img = decoded.get(ctx.screenshot);
    if (!img) { img = decodePng(ctx.screenshot); if (typeof ctx.screenshot === 'object') decoded.set(ctx.screenshot, img); }
  }
  // A full-page screenshot starts at the page's top-left at the device pixel ratio, so its own
  // size gives the clip. Not innerWidth: under mobile emulation a page that overflows sideways
  // widens innerWidth (390 → 522) while the runner's screenshot stays viewport-wide.
  const dpr = collected.viewport?.dpr || 1;
  const clip = ctx.screenshotClip ?? (img ? {x: 0, y: 0, width: img.width / dpr, height: img.height / dpr} : collected.capture ?? {x: 0, y: 0, width: ctx.viewport?.width});
  let measured = 0;
  const results = [];
  for (const run of collected.runs ?? []) {
    if (!img) { skip('no-screenshot'); continue; }
    const {samples, method} = sampleBackground(img, clip, {...run, minSamples: config.minSamples});
    if (!samples.length) { skip(method === 'outside-screenshot' ? 'outside-screenshot' : 'no-samples'); continue; }
    measured++;
    const m = measureRun(run, samples, config);
    const large = isLargeText(run.fontSize, run.fontWeight), required = requiredRatio(run.fontSize, run.fontWeight);
    results.push({selector: run.selector, ratio: round(m.ratio), min: round(m.min), max: round(m.max), uniform: m.uniform, required});
    const measurements = {
      ratio: round(m.ratio), required, largeText: large, fontSize: run.fontSize, fontWeight: run.fontWeight,
      textColor: hex(run.color), textAlpha: round(m.alpha, 3), effectiveTextColor: hex(m.effectiveText), backgroundColor: hex(m.modeColor),
      uniformBackground: m.uniform, minRatio: round(m.min), maxRatio: round(m.max), medianRatio: round(m.median),
      backgroundShare: round(m.modeShare), samples: samples.length, sampling: method,
    };
    const what = `"${run.text.slice(0, 40)}${run.text.length > 40 ? '…' : ''}"`;
    const need = `${required}:1 for ${large ? 'large' : 'normal-size'} text`;
    if (m.uniform && m.ratio < required) {
      findings.push({
        id: `UI03-${slug(run.selector)}`, status: 'fail', severity: m.ratio < required - 1.5 ? 'high' : 'medium', selector: run.selector, rect: run.rect,
        message: `${what} has a contrast of ${round(m.ratio)}:1 against its background (${hex(m.effectiveText)} on ${hex(m.modeColor)}); it needs at least ${need}.`,
        measurements,
      });
    } else if (!m.uniform && m.min < required) {
      const everywhere = m.max < required;
      findings.push({
        id: `UI03-${slug(run.selector)}`, status: everywhere ? 'fail' : 'review', severity: everywhere ? 'high' : 'medium', selector: run.selector, rect: run.rect,
        message: everywhere
          ? `${what} sits on a varied background and is too faint everywhere: contrast ranges from ${round(m.min)}:1 to ${round(m.max)}:1, below ${need}.`
          : `${what} sits on a varied background (an image or gradient). Contrast ranges from ${round(m.min)}:1 to ${round(m.max)}:1, so parts of it fall below ${need}. Check it by eye.`,
        measurements,
      });
    }
  }
  return {
    checkId: meta.id, findings,
    summary: {runs: (collected.runs ?? []).length, measured, fail: findings.filter(f => f.status === 'fail').length, review: findings.filter(f => f.status === 'review').length, skipped, results},
  };
}
