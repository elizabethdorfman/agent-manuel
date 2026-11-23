import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {contrastRatio, relativeLuminance, isLargeText, requiredRatio, blend, parseColor} from '../src/checks/_lib/contrast-math.mjs';
import {decodePng} from '../src/checks/_lib/png.mjs';
import {analyze, measureRun, sampleBackground} from '../src/checks/contrast/index.mjs';

const near = (a, b, tol = 0.01) => assert(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('WCAG contrast ratio matches known values.', () => {
  near(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  near(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
  near(contrastRatio([119, 119, 119], [119, 119, 119]), 1);
  near(contrastRatio([0x75, 0x75, 0x75], [255, 255, 255]), 4.61);
  near(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255]), 4.48);
  near(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255]), 4.54);
  near(contrastRatio([0, 0, 255], [255, 255, 255]), 8.59);
  near(contrastRatio([255, 0, 0], [255, 255, 255]), 4.0);
  near(relativeLuminance([255, 255, 255]), 1, 1e-9);
  near(relativeLuminance([0, 0, 0]), 0, 1e-9);
});

test('Large-text rule: 24px, or 18.66px and bold.', () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(23.9, 400), false);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.67, 700), true);
  assert.equal(isLargeText(18.6, 700), false);
  assert.equal(isLargeText(19, 600), false);
  assert.equal(isLargeText(19, 900), true);
  assert.equal(isLargeText(16, 900), false);
  assert.equal(requiredRatio(16, 400), 4.5);
  assert.equal(requiredRatio(24, 400), 3);
  assert.equal(requiredRatio(18.66, 700), 3);
});

test('Alpha blending and colour parsing.', () => {
  assert.deepEqual(blend([0, 0, 0, 0.5], [255, 255, 255]), [127.5, 127.5, 127.5]);
  assert.deepEqual(blend([10, 20, 30], [255, 255, 255]), [10, 20, 30]);
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3, 1]);
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), [1, 2, 3, 0.5]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.equal(parseColor('oklch(50% 0.1 200)'), null);
});

// Builds a PNG with a different filter on each row, to exercise every unfilter path.
function encodePng(width, height, rgba, {type = 6} = {}) {
  const ch = {0: 1, 2: 3, 6: 4}[type];
  const px = (x, y) => { const i = (y * width + x) * 4; return type === 6 ? [...rgba.slice(i, i + 4)] : type === 2 ? [...rgba.slice(i, i + 3)] : [rgba[i]]; };
  const rows = [];
  let prev = new Uint8Array(width * ch);
  for (let y = 0; y < height; y++) {
    const cur = Uint8Array.from(Array.from({length: width}, (_, x) => px(x, y)).flat());
    const f = y % 5, out = new Uint8Array(cur.length + 1);
    out[0] = f;
    for (let i = 0; i < cur.length; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
      out[i + 1] = (cur[i] - pred) & 255;
    }
    rows.push(out); prev = cur;
  }
  const chunk = (kind, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(kind, 'latin1'), data, Buffer.alloc(4)]); // CRC is not checked by the decoder
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('PNG decoder round-trips RGBA, RGB and greyscale with all five filters.', () => {
  const w = 7, h = 10, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >> 3) * 11) & 255;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const rgba = decodePng(encodePng(w, h, data, {type: 6}));
  assert.equal(rgba.width, w); assert.equal(rgba.height, h);
  assert.deepEqual([...rgba.data], [...data]);
  const rgb = decodePng(encodePng(w, h, data, {type: 2}));
  assert.deepEqual([...rgb.data], [...data]);
  const grey = decodePng(encodePng(w, h, data, {type: 0}));
  for (let i = 0; i < w * h; i++) assert.deepEqual([...grey.data.slice(i * 4, i * 4 + 4)], [data[i * 4], data[i * 4], data[i * 4], 255]);
  assert.throws(() => decodePng(Buffer.from('nope')), /Not a PNG/);
});

/** A synthetic page image: 40×20 CSS px, background from a function, "glyphs" painted in a box. */
function page(bg, glyph = null) {
  const w = 40, h = 20, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = glyph && x >= 10 && x < 30 && y >= 6 && y < 14 && (x + y) % 2 ? glyph : bg(x, y);
    data.set([...c, 255], (y * w + x) * 4);
  }
  return encodePng(w, h, data);
}
const run = (color, extra = {}) => ({selector: '#t', tag: 'p', text: 'Sample', rect: {x: 0, y: 0, width: 40, height: 20},
  textRects: [{x: 10, y: 6, width: 20, height: 8}], occupied: [], backgroundBox: {x: 0, y: 0, width: 40, height: 20},
  color, opacity: 1, fontSize: 16, fontWeight: 400, ...extra});
const collected = r => ({viewport: {width: 40, height: 20}, capture: {x: 0, y: 0, width: 40, height: 20}, runs: [r], skipped: []});

test('Background sampling ignores glyph pixels and fails uniform low contrast.', () => {
  const shot = page(() => [255, 255, 255], [0xbb, 0xbb, 0xbb]);
  const r = analyze(collected(run([0xbb, 0xbb, 0xbb, 1])), {screenshot: shot});
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].status, 'fail');
  near(r.findings[0].measurements.ratio, 1.92);
  assert.equal(r.findings[0].measurements.backgroundColor, '#ffffff');
  assert.equal(r.findings[0].measurements.sampling, 'ring');
});

test('Gradient backgrounds are reviewed with min and max ratios; passing gradients are not.', () => {
  const light = analyze(collected(run([255, 255, 255, 1])), {screenshot: page(x => Array(3).fill(20 + x * 6))});
  assert.equal(light.findings[0].status, 'review');
  assert(light.findings[0].measurements.minRatio < 4.5 && light.findings[0].measurements.maxRatio > 4.5);
  const dark = analyze(collected(run([255, 255, 255, 1])), {screenshot: page(x => Array(3).fill(10 + x))});
  assert.equal(dark.findings.length, 0);
});

test('Text alpha and ancestor opacity are composited over the sampled background.', () => {
  const r = measureRun(run([0, 0, 0, 0.5], {opacity: 0.76}), [[255, 255, 255]]);
  near(r.alpha, 0.38);
  near(r.ratio, 2.68);
});

test('No screenshot: every run is skipped, nothing is guessed.', () => {
  const r = analyze(collected(run([0, 0, 0, 1])), {});
  assert.equal(r.findings.length, 0);
  assert.deepEqual(r.summary.skipped, {'no-screenshot': 1});
});

test('Device pixel ratio 2 screenshots map CSS px to the right pixels.', () => {
  const w = 80, h = 40, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([255, 255, 255, 255], i * 4);
  const img = decodePng(encodePng(w, h, data));
  const {samples, method} = sampleBackground(img, {x: 0, y: 0, width: 40}, run([0, 0, 0, 1]));
  assert.equal(method, 'ring');
  assert(samples.length > 100 && samples.every(p => p[0] === 255));
});
