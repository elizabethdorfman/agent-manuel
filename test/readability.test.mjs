import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, variants} from '../src/checks/readability/index.mjs';

const rect = {x: 0, y: 0, width: 100, height: 20};
const clip = sel => ({selector: sel, tag: 'span', rect, text: 'A long label', reason: 'ellipsis', axis: 'x', scrollWidth: 200, clientWidth: 100, scrollHeight: 20, clientHeight: 20, overflowX: 'hidden', overflowY: 'visible', textOverflow: 'ellipsis', lineClamp: null, beyondX: 100, beyondY: 0});

test('Readability labels each rule, and covered text is reported once.', () => {
  const out = analyze({
    contrast: {runs: [], skipped: []},
    clips: [clip('#label'), clip('body')],
    overflows: [{selector: '#url', rect, text: 'https://example.com/x', kind: 'off-screen', beyond: 40, side: 'right', viewportWidth: 390}],
    covered: [{selector: '#p', rect, text: 'Under the video', cover: '#video', coverLabel: 'video#video', coverRect: rect, coverPosition: 'fixed', point: {x: 5, y: 5}}],
  }, {viewport: {width: 390, height: 844}});
  assert.deepEqual(out.findings.map(f => [f.id, f.measurements.rule]).sort(), [
    ['RD01-covered-p', 'covered'], ['RD01-cut-off-label', 'cut-off'], ['RD01-overflow-url', 'overflow'],
  ], 'page-level (body) clipping is not reported as cut-off text');
  assert.match(out.findings.find(f => f.measurements.rule === 'covered').message, /covered by video#video/);
  assert(!('selector' in out.findings.find(f => f.measurements.rule === 'overflow').measurements));
});

test('The 200% pass reports cut-off text only, with -200 ids.', () => {
  const out = analyze({textScale: 2, clips: [clip('#badge')]}, {variant: variants[0]});
  assert.deepEqual(out.findings.map(f => f.id), ['RD01-cut-off-badge-200']);
  assert.equal(out.findings[0].measurements.textScale, 2);
});
