import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from '../src/cdp.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');

/** Derives one outcome per element from the tool's own output. */
function outcomeFor(selector,snapshot,alignment) {
  const ids=snapshot.elements.filter(e=>e.selector===selector).map(e=>e.id);
  if(alignment.candidates.some(c=>ids.includes(c.elementId)))return 'review-candidate';
  const verdicts=alignment.ruleResults.flatMap(r=>(r.measurements??[]).filter(m=>m.role==='target'&&ids.includes(m.id)).map(()=>r.status));
  if(verdicts.includes('outside-tolerance'))return 'outside-tolerance';
  if(verdicts.includes('blocked'))return 'blocked';
  if(verdicts.includes('within-tolerance'))return 'within-tolerance';
  return 'not-flagged';
}

test('The labelled signup fixture produces exactly the expected findings in real Chrome.',async t=>{
  const chrome=await findChrome();
  if(!chrome){t.skip('Chrome was not found; set CHROME_BIN to run the signup integration test.');return;}
  const expected=JSON.parse(await readFile(join(root,'examples/alignment-signup.expected.json'),'utf8'));
  const out=await mkdtemp(join(tmpdir(),'qa-signup-'));
  try {
    await promisify(execFile)(process.execPath,[join(root,'bin/alignment.mjs'),
      '--url',join(root,expected.fixture),'--rules',join(root,expected.rules),
      '--width',String(expected.viewport.width),'--height',String(expected.viewport.height),'--out',out],{cwd:root,timeout:60000});
    const {snapshot,alignment}=JSON.parse(await readFile(join(out,'evidence.json'),'utf8'));
    const labelled=Object.keys(expected.elements);

    // Every collected element with a DOM id is labelled, and every label was collected.
    const collected=snapshot.elements.map(e=>e.selector).filter(s=>s.startsWith('#'));
    assert.deepEqual([...collected].sort(),[...labelled].sort());

    // Rule verdicts match exactly.
    assert.deepEqual(Object.fromEntries(alignment.ruleResults.map(r=>[r.id,r.status])),expected.ruleStatuses);

    // Per-element outcomes match exactly: no misses and no false alarms.
    const actual=Object.fromEntries(labelled.map(s=>[s,outcomeFor(s,snapshot,alignment)]));
    assert.deepEqual(actual,Object.fromEntries(labelled.map(s=>[s,expected.elements[s].expected])));

    // Candidates only point at labelled accidental-undeclared elements.
    const flagged=alignment.candidates.map(c=>c.selector).sort();
    assert.deepEqual(flagged,labelled.filter(s=>expected.elements[s].expected==='review-candidate').sort());

    // Measured pixels match the planted offsets.
    for(const [selector,spec] of Object.entries(expected.elements)) {
      if(spec.deviation!==undefined) {
        const m=alignment.ruleResults.flatMap(r=>r.measurements??[]).find(m=>m.selector===selector&&m.role==='target');
        assert(Math.abs(m.deviation-spec.deviation)<=0.5,`${selector} deviation ${m.deviation}, expected ${spec.deviation}`);
      }
      if(spec.delta!==undefined) {
        const c=alignment.candidates.find(c=>c.selector===selector);
        assert(Math.abs(c.delta-spec.delta)<=0.5,`${selector} delta ${c.delta}, expected ${spec.delta}`);
        assert(Math.abs(c.clusterValue-spec.clusterValue)<=0.5);
      }
    }
    assert.equal(alignment.status,'review-required');
  } finally { await rm(out,{recursive:true,force:true}); }
});
