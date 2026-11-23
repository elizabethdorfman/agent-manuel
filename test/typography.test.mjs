import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, variants, meta} from '../src/checks/typography/index.mjs';

let n = 0;
const run = (o = {}) => ({index: n++, selector: '#r' + n, tag: 'span', kind: 'text', rect: {x: 0, y: 0, width: 10, height: 10}, text: 'Text', chars: 4,
  fontSize: 16, fontWeight: 400, fontFamily: 'Inter, sans-serif', firstFamily: 'Inter', lineHeight: 24, measuredLineHeight: 19, parentRun: null, ...o});
const page = (runs, o = {}) => ({viewport: {width: 1280, height: 800}, textScale: 1, runs, blocks: [], paragraphs: [], clips: [], fontFaces: [], ...o});
const fonts = map => ({fonts: {bySelector: map, errors: 0}});
const f = (familyName, glyphCount, postScriptName = familyName.replace(/\s/g, '')) => ({familyName, postScriptName, isCustomFont: false, glyphCount});

test('Fallback: fails when the first declared family is not what painted; generic and loaded faces pass.', () => {
  const a = run({firstFamily: 'Inter', fontFamily: 'Inter, Arial'});
  const b = run({firstFamily: 'system-ui', fontFamily: 'system-ui'});
  const c = run({firstFamily: 'Brand', fontFamily: 'Brand, serif'});
  const d = run({firstFamily: 'Helvetica Neue', fontFamily: '"Helvetica Neue"'});
  const r = analyze(page([a, b, c, d], {fontFaces: [{family: 'Brand', status: 'loaded'}]}), {extra: fonts({[a.selector]: [f('Arial', 9)], [b.selector]: [f('.SF NS', 9)], [c.selector]: [f('Inter', 9)], [d.selector]: [f('Helvetica Neue', 9, 'HelveticaNeue-Medium')]})});
  const fallbacks = r.findings.filter(x => x.id.startsWith('TY01-fallback-'));
  assert.deepEqual(fallbacks.map(x => x.selector), [a.selector]);
  assert.equal(fallbacks[0].measurements.rendered, 'Arial');
});

test('Fallback: a child run with another font does not count against its parent.', () => {
  const parent = run({firstFamily: 'Georgia', fontFamily: 'Georgia'});
  const child = run({firstFamily: 'Arial', fontFamily: 'Arial', parentRun: parent.index});
  const r = analyze(page([parent, child]), {extra: fonts({[parent.selector]: [f('Georgia', 5), f('Arial', 40)], [child.selector]: [f('Arial', 40)]})});
  assert.equal(r.findings.filter(x => x.id.startsWith('TY01-fallback-')).length, 0);
});

test('Fallback: emoji glyphs are ignored when picking the painted font.', () => {
  const a = run({firstFamily: 'Arial', fontFamily: 'Arial'});
  const r = analyze(page([a]), {extra: fonts({[a.selector]: [f('Apple Color Emoji', 30), f('Arial', 3)]})});
  assert.equal(r.findings.length, 0);
});

test('Family count fails above maxFamilies, excluding monospace; respects config.', () => {
  const runs = ['A', 'B', 'C'].map(x => run({firstFamily: x, fontFamily: x}));
  runs.push(run({firstFamily: 'Menlo', fontFamily: 'Menlo, monospace'}));
  const extra = fonts(Object.fromEntries(runs.map(r => [r.selector, [f(r.firstFamily, 5)]])));
  const r = analyze(page(runs), {extra});
  const count = r.findings.find(x => x.id === 'TY01-family-count');
  assert.equal(count.status, 'fail');
  assert.deepEqual(count.measurements.families, ['A', 'B', 'C']);
  assert.equal(analyze(page(runs), {extra, config: {maxFamilies: 3}}).findings.some(x => x.id === 'TY01-family-count'), false);
});

test('Without gathered fonts, families are counted from declarations and the fallback rule is skipped.', () => {
  const r = analyze(page([run({firstFamily: 'A'}), run({firstFamily: 'B'}), run({firstFamily: 'C'})]));
  assert.equal(r.summary.fontsMeasured, false);
  assert(r.findings.some(x => x.id === 'TY01-family-count'));
  assert(!r.findings.some(x => x.id.startsWith('TY01-fallback-')));
});

test('Size count reviews above 8, weight count above 4.', () => {
  const sizes = [12, 13, 14, 15, 16, 18, 20, 24].map(s => run({fontSize: s, firstFamily: 'system-ui'}));
  assert(!analyze(page(sizes)).findings.some(x => x.id === 'TY01-size-count'));
  const r = analyze(page([...sizes, run({fontSize: 32, firstFamily: 'system-ui'})]));
  assert.equal(r.findings.find(x => x.id === 'TY01-size-count').status, 'review');
  const weights = [300, 400, 500, 600].map(w => run({fontWeight: w, firstFamily: 'system-ui'}));
  assert(!analyze(page(weights)).findings.some(x => x.id === 'TY01-weight-count'));
  assert.equal(analyze(page([...weights, run({fontWeight: 700, firstFamily: 'system-ui'})])).findings.find(x => x.id === 'TY01-weight-count').status, 'review');
});

test('Minimum sizes: inputs under 16px fail, text under 12px fails, 12px passes.', () => {
  const input = run({kind: 'control', tag: 'input', fontSize: 15.5, firstFamily: 'system-ui'});
  const tiny = run({fontSize: 11.5, firstFamily: 'system-ui'});
  const ok = run({fontSize: 12, firstFamily: 'system-ui'});
  const r = analyze(page([input, tiny, ok]));
  assert.deepEqual(r.findings.map(x => [x.selector, x.status]).sort(), [[input.selector, 'fail'], [tiny.selector, 'fail']].sort());
});

test('Body text: small at ≤480px is a review; line height outside 1.3–1.8 is a review; line length over 80 is a review.', () => {
  const block = (o) => ({selector: '#b' + (n++), tag: 'p', rect: {x: 0, y: 0, width: 1, height: 1}, fontSize: 16, lineHeight: 24, measuredLineHeight: 19, lines: 2, chars: 100, maxLineWidth: 400, totalLineWidth: 800, ...o});
  const small = block({fontSize: 14, lineHeight: 21}), loose = block({lineHeight: 30}), normal = block({lineHeight: null, measuredLineHeight: 18.4}), fine = block({});
  const long = block({chars: 200, maxLineWidth: 900, totalLineWidth: 1800});
  const mobile = analyze(page([], {blocks: [small, loose, normal, fine], paragraphs: [long]}), {viewport: {width: 390, height: 844}});
  const ids = mobile.findings.map(x => x.id).sort();
  assert.deepEqual(ids, [`TY01-line-height-${loose.selector.slice(1)}`, `TY01-line-height-${normal.selector.slice(1)}`, `TY01-line-length-${long.selector.slice(1)}`, `TY01-small-body-${small.selector.slice(1)}`].sort());
  assert(mobile.findings.every(x => x.status === 'review'));
  const desktop = analyze(page([], {blocks: [small]}), {viewport: {width: 1280, height: 800}});
  assert.equal(desktop.findings.length, 0);
});

test('Approved families and sizes: anything outside the lists is a review.', () => {
  const a = run({firstFamily: 'Inter'}), b = run({firstFamily: 'Comic Sans MS', fontSize: 15});
  const r = analyze(page([a, b]), {config: {approvedFamilies: ['Inter'], approvedSizes: [16]}});
  assert.deepEqual(r.findings.map(x => [x.id, x.status]).sort(), [['TY01-unapproved-family-comic-sans-ms', 'review'], ['TY01-unapproved-size-15', 'review']]);
});

test('The 200% variant re-checks clipping only and suffixes ids with -200.', () => {
  assert.equal(meta.id, 'TY01');
  assert.equal(variants[0].suffix, '-200');
  assert.equal(variants[0].method, 'Runtime.evaluate');
  const clip = {selector: '#c', rect: {x: 0, y: 0, width: 1, height: 1}, text: 'Cut', reason: 'overflow', axis: 'y', scrollWidth: 10, clientWidth: 10, scrollHeight: 40, clientHeight: 20, beyondX: 0, beyondY: 20};
  const data = page([run({fontSize: 8})], {clips: [clip], textScale: 2});
  const r = analyze(data, {variant: variants[0]});
  assert.deepEqual(r.findings.map(x => x.id), ['TY01-clipped-c-200']);
  const viaMarker = analyze(data);
  assert.deepEqual(viaMarker.findings.map(x => x.id), ['TY01-clipped-c-200']);
});
