import test from 'node:test';
import assert from 'node:assert/strict';
import {findChrome} from '../src/cdp.mjs';
import * as contrast from '../src/checks/contrast/index.mjs';
import {withBrowser, runCheck, outcomes, readJson} from './typography-harness.mjs';

test('The labelled contrast fixture produces exactly the expected findings in real Chrome.', async t => {
  if (!await findChrome()) { t.skip('Chrome was not found; set CHROME_BIN to run the contrast integration test.'); return; }
  const expected = await readJson('examples/checks/contrast.expected.json');
  const labelled = Object.keys(expected.elements);
  await withBrowser(async browser => {
    for (const viewport of expected.viewports) {
      const {base, collected} = await runCheck(browser, contrast, expected.fixture, viewport);
      const measured = new Map(base.summary.results.map(r => [r.selector, r]));
      const skipped = new Map(collected.skipped.map(s => [s.selector, s.reason]));

      // Every collected run is labelled, and every labelled element was measured or skipped as labelled.
      for (const r of collected.runs) assert(labelled.includes(r.selector), `${r.selector} collected but not labelled`);
      for (const [s, spec] of Object.entries(expected.elements)) {
        if (spec.skipped) assert.equal(skipped.get(s), spec.skipped, `${s} skipped as ${spec.skipped}`);
        else assert(measured.has(s), `${s} was measured`);
      }
      for (const f of base.findings) assert(labelled.includes(f.selector) && f.id.startsWith('UI03-') && f.rect && f.message, `${f.id} follows the contract`);
      assert.deepEqual(outcomes(base.findings, labelled), Object.fromEntries(labelled.map(s => [s, expected.elements[s].expected])), `outcomes at ${viewport.width}px`);

      for (const [s, spec] of Object.entries(expected.elements)) {
        const m = measured.get(s);
        if (spec.ratio !== undefined) assert(Math.abs(m.ratio - spec.ratio) <= 0.05, `${s} ratio ${m.ratio}, expected ${spec.ratio}`);
        if (spec.minBelow !== undefined) {
          const f = base.findings.find(f => f.selector === s);
          assert.equal(f.measurements.uniformBackground, false, `${s} background is non-uniform`);
          assert(f.measurements.minRatio < spec.minBelow && f.measurements.maxRatio > spec.maxAbove, `${s} range ${f.measurements.minRatio}–${f.measurements.maxRatio}`);
        }
      }
    }
  });
});
