import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {findChrome, launchBrowser} from '../src/cdp.mjs';
import {Page} from '../src/runner/browser.mjs';
import {normalizeConfig} from '../src/runner/safety.mjs';
import {runChecks} from '../src/runner/checks.mjs';
import {checks} from '../src/checks/index.mjs';
import * as readability from '../src/checks/readability/index.mjs';
import {root, readJson} from './typography-harness.mjs';

const RANK = {none: 0, review: 1, fail: 2};
const perWidth = (v, w) => (v && typeof v === 'object' && !Array.isArray(v) ? v[w] : v);

test('Readability is registered instead of contrast.', () => {
  assert.deepEqual(checks.map(c => c.meta.name), ['alignment', 'hierarchy', 'readability']);
  assert.equal(readability.meta.id, 'RD01');
  assert(!/\bimport\b|\brequire\(/.test(readability.collect.toString()), 'collect is self-contained');
});

// Runs the check exactly as the runner does: a runner Page, its full-page screenshot, then
// runChecks (normal pass + the 200% text-scale pass).
test('The labelled readability fixture produces exactly the expected findings in real Chrome.', {timeout: 120000}, async t => {
  if (!await findChrome()) { t.skip('Chrome was not found; set CHROME_BIN to run the readability integration test.'); return; }
  const expected = await readJson('examples/checks/readability.expected.json');
  const labels = Object.keys(expected.elements);
  const url = pathToFileURL(join(root, expected.fixture)).href;
  const cfg = normalizeConfig({baseUrl: url, entry: [url], settleMs: 50});
  const labelOf = sel => labels.find(id => sel === id || sel.startsWith(id + ' > '));
  const browser = await launchBrowser();
  try {
    for (const viewport of expected.viewports) {
      const w = String(viewport.width);
      const page = await Page.open(browser, cfg, viewport);
      try {
        await page.goto(url);
        const png = await page.screenshot({fullPage: true});
        const [entry] = await runChecks(page, [readability], cfg, viewport, png);
        assert.equal(entry.error, undefined, `no error at ${w}px`);
        assert.equal(entry.checkId, 'RD01');

        for (const f of entry.findings) {
          assert(labelOf(f.selector), `${f.id} points at unlabelled ${f.selector} (${w}px)`);
          assert(f.id.startsWith('RD01-') && f.rect && f.message && f.measurements?.rule, `${f.id} follows the contract`);
        }
        const isVariant = f => f.id.endsWith('-200');
        const outcome = fs => {
          const out = Object.fromEntries(labels.map(id => [id, 'none']));
          for (const f of fs) { const id = labelOf(f.selector); if (RANK[f.status] > RANK[out[id]]) out[id] = f.status; }
          return out;
        };
        const base = entry.findings.filter(f => !isVariant(f)), scaled = entry.findings.filter(isVariant);

        assert.deepEqual(outcome(base), Object.fromEntries(labels.map(id => [id, perWidth(expected.elements[id].expected, w)])), `outcomes at ${w}px`);
        for (const [id, spec] of Object.entries(expected.elements)) {
          const mine = base.filter(f => labelOf(f.selector) === id);
          assert.deepEqual([...new Set(mine.map(f => f.measurements.rule))].sort(), [...(perWidth(spec.rules, w) ?? [])].sort(), `${id} rules at ${w}px`);
          assert.equal(mine.length, new Set(mine.map(f => f.measurements.rule)).size, `${id} is reported at most once per rule`);
          if (spec.kind && mine.length) assert.equal(mine[0].measurements.kind, spec.kind, `${id} overflow kind`);
          if (spec.coveredBy) assert.equal(mine[0].measurements.coveredBy, spec.coveredBy, `${id} covered by`);
          const measured = entry.summary.results.find(r => r.selector === id);
          if (spec.ratio !== undefined) assert(Math.abs(measured.ratio - spec.ratio) <= 0.05, `${id} ratio ${measured.ratio}, expected ${spec.ratio}`);
          if (spec.ratioBetween) assert(measured.ratio >= spec.ratioBetween[0] && measured.ratio <= spec.ratioBetween[1], `${id} ratio ${measured.ratio}`);
        }
        // The covered paragraph would have failed contrast too; readability reports it once.
        assert.deepEqual(entry.summary.contrastSuppressedByCover, ['#covered'], 'contrast finding under the cover is suppressed');

        const vexp = expected.variants['text-200'];
        assert(entry.summary['text-200'], 'the 200% pass ran');
        assert.deepEqual(outcome(scaled), Object.fromEntries(labels.map(id => [id, vexp[id] ?? 'none'])), `200% outcomes at ${w}px`);
        for (const f of scaled) assert(f.id.startsWith('RD01-cut-off-') && f.measurements.rule === 'cut-off', `${f.id} is a cut-off finding`);
      } finally { await page.close(); }
    }
  } finally { await browser.cleanup(); }
});
