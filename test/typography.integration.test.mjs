import test from 'node:test';
import assert from 'node:assert/strict';
import {findChrome} from '../src/cdp.mjs';
import * as typography from '../src/checks/typography/index.mjs';
import {withBrowser, runCheck, outcomes, readJson} from './typography-harness.mjs';

test('The labelled typography fixture produces exactly the expected findings in real Chrome.', async t => {
  if (!await findChrome()) { t.skip('Chrome was not found; set CHROME_BIN to run the typography integration test.'); return; }
  const expected = await readJson('examples/checks/typography.expected.json');
  const labelled = Object.keys(expected.elements);
  await withBrowser(async browser => {
    for (const viewport of expected.viewports) {
      const w = String(viewport.width);
      const want = Object.fromEntries(labelled.map(s => {
        const e = expected.elements[s].expected;
        return [s, typeof e === 'string' ? e : e[w]];
      }));
      const {base, collected, variants} = await runCheck(browser, typography, expected.fixture, viewport);
      assert.equal(base.summary.fontsMeasured, true, 'gatherFonts supplied rendered fonts');

      // Every labelled element that renders text was collected; nothing unlabelled carries an id.
      const ids = new Set([...collected.runs, ...collected.blocks].map(r => r.selector).filter(s => /^#[\w-]+$/.test(s)));
      for (const s of ids) assert(labelled.includes(s), `${s} is collected but not labelled`);

      // No finding points at anything unlabelled, apart from page-level ones on body.
      for (const f of base.findings) {
        for (const s of [f.selector, ...(f.measurements?.selectors ?? [])]) assert(s === 'body' || labelled.includes(s), `${f.id} points at unlabelled ${s}`);
        assert(f.id.startsWith('TY01-') && f.rect && f.message, `${f.id} follows the contract`);
      }
      assert.deepEqual(outcomes(base.findings, labelled), want, `per-element outcomes at ${w}px`);

      // Page-level findings.
      const pageIds = base.findings.filter(f => f.selector === 'body').map(f => f.id);
      for (const [id, status] of Object.entries(expected.page)) assert.equal(pageIds.includes(id), status !== 'none', `${id} at ${w}px`);
      assert(pageIds.every(id => id in expected.page), 'no unexpected page-level findings');

      // Measured numbers match the planted values.
      for (const [s, spec] of Object.entries(expected.elements)) {
        const status = want[s];
        if (status === 'none') continue;
        const f = base.findings.find(f => f.selector === s || f.measurements?.selectors?.includes(s));
        if (spec.rule) assert(f.id.startsWith(`TY01-${spec.rule}-`), `${s} flagged by ${spec.rule}, got ${f.id}`);
        if (spec.fontSize !== undefined) assert.equal(f.measurements.fontSize, spec.fontSize, `${s} font size`);
        if (spec.ratio !== undefined) assert(Math.abs(f.measurements.ratio - spec.ratio) <= 0.01, `${s} ratio ${f.measurements.ratio}`);
      }
      const fallback = base.findings.find(f => f.selector === '#fallback');
      assert.equal(fallback.measurements.firstDeclared, 'Agent Manuel Missing Font');
      assert.equal(fallback.measurements.rendered, 'Arial');
      assert.equal(base.findings.find(f => f.selector === '#webfont-failed').measurements.webFontStatus, 'error');

      // 200% text-scale variant: clipping only, ids suffixed -200.
      for (const [id, vexp] of Object.entries(expected.variants)) {
        const v = variants[id];
        assert(v, `variant ${id} ran`);
        for (const f of v.findings) {
          assert(f.id.endsWith('-200') && f.id.startsWith('TY01-clipped-'), `${f.id} is a -200 clipping finding`);
          assert(labelled.includes(f.selector), `${f.id} points at labelled element`);
        }
        const vwant = Object.fromEntries(labelled.map(s => [s, vexp[s] ?? 'none']));
        assert.deepEqual(outcomes(v.findings, labelled), vwant, `variant ${id} outcomes at ${w}px`);
      }
    }
  });
});
