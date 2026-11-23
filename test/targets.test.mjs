import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from '../src/cdp.mjs';
import * as targets from '../src/checks/targets/index.mjs';
import {runCheck} from '../src/checks/_lib/c-browser.mjs';
import {labelOutcomes} from '../src/checks/_lib/c-util.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const t=(selector,x,y,w,h,extra={})=>({selector,tag:'button',name:selector,rect:{x,y,width:w,height:h},hitRect:{x,y,width:w,height:h},mergedLabels:[],
  primary:false,filled:false,inlineInSentence:false,centre:{state:'clear'},corners:[],...extra});
const run=list=>targets.analyze({viewport:{width:390,height:844},targets:list},{});
const rulesOf=out=>Object.fromEntries(Object.entries(Object.groupBy(out.findings,f=>f.selector)).map(([k,v])=>[k,v.map(f=>f.measurements.rule).sort()]));

test('T1: an undersized target fails only when its 24px circle hits a neighbour.',()=>{
  // 16px target 2px from a 48px one: centre-to-rect distance 10 < 12.
  assert.deepEqual(rulesOf(run([t('#a',0,0,16,16),t('#b',18,0,48,48)])),{'#a':['T1']});
  // Same target 4px away: distance exactly 12, which does not intersect.
  assert.deepEqual(rulesOf(run([t('#a',0,0,16,16),t('#b',20,0,48,48)])),{});
  // Two undersized targets whose circles overlap both fail; spaced 24px apart (centre to centre) both pass.
  assert.deepEqual(rulesOf(run([t('#a',0,0,16,16),t('#b',20,0,16,16)])),{'#a':['T1'],'#b':['T1']});
  assert.deepEqual(rulesOf(run([t('#a',0,0,16,16),t('#b',24,0,16,16)])),{});
  // Inline links in a sentence are exempt even when crowded.
  assert.deepEqual(rulesOf(run([t('#a',0,0,40,16,{tag:'a',inlineInSentence:true}),t('#b',0,18,40,16,{tag:'a',inlineInSentence:true})])),{});
  // A target exactly 24x24 is fine.
  assert.deepEqual(rulesOf(run([t('#a',0,0,24,24),t('#b',24,0,24,24)])),{});
});

test('T2: a primary control under 44px in either dimension is review; non-primary is not.',()=>{
  assert.deepEqual(rulesOf(run([t('#a',0,0,300,40,{primary:true}),t('#b',0,100,43,60,{primary:true}),t('#c',0,200,300,36),t('#d',0,300,300,48,{primary:true})])),
    {'#a':['T2'],'#b':['T2']});
  // A failing undersized primary is reported once, as T1.
  assert.deepEqual(rulesOf(run([t('#a',0,0,16,16,{primary:true}),t('#b',18,0,48,48)])),{'#a':['T1']});
  // An undersized primary saved by the spacing exception is still a T2 lead.
  assert.deepEqual(rulesOf(run([t('#a',0,0,20,20,{primary:true})])),{'#a':['T2']});
});

test('T3: a covered centre fails; offscreen and ancestor hits are not failures.',()=>{
  const out=run([t('#a',0,0,300,48,{centre:{state:'covered',by:'#veil'}}),t('#b',0,100,300,48,{centre:{state:'offscreen'}}),t('#c',0,200,300,48,{centre:{state:'ancestor',by:'#card'}})]);
  assert.deepEqual(rulesOf(out),{'#a':['T3']});
  assert.equal(out.findings[0].measurements.coveredBy,'#veil');
  assert.equal(out.summary.offscreenNotProbed,1);
});

test('Labels widen the hit area before sizing.',()=>{
  const cb=t('#agree',0,0,16,16,{hitRect:{x:0,y:0,width:160,height:32},mergedLabels:['#agree-label']});
  assert.deepEqual(rulesOf(run([cb,t('#b',0,34,300,48)])),{});
});

test('The labelled targets fixture matches its expected file exactly in real Chrome.',async c=>{
  if(!await findChrome()){c.skip('Chrome was not found; set CHROME_BIN to run this test.');return;}
  const expected=JSON.parse(await readFile(join(root,'examples/checks/targets.expected.json'),'utf8'));
  const {result,collected}=await runCheck(targets,{url:join(root,expected.fixture),...expected.viewport});
  const {actual,actualRules,stray}=labelOutcomes(result.findings,expected);
  assert.deepEqual(stray,[],'no findings on unlabelled elements');
  assert.deepEqual(actual,expected.expected);
  for(const [id,rules] of Object.entries(actualRules))assert.deepEqual(rules,expected.rules[id]??[],id+' rules');
  for(const [id,m] of Object.entries(expected.measurements)){
    const f=result.findings.find(f=>f.selector===id);
    for(const [k,v] of Object.entries(m))assert.equal(typeof v==='number'?Math.round(f.measurements[k]):f.measurements[k],v,`${id} ${k}`);
  }
  for(const [id,h] of Object.entries(expected.hitAreas)){
    const target=collected.targets.find(x=>x.selector===id);
    assert.deepEqual(target.mergedLabels,h.mergedLabels);
    if(h.minHeight)assert.ok(target.hitRect.height>=h.minHeight&&target.rect.height<h.minHeight,`${id} hit area grows past ${h.minHeight}px`);
  }
  assert.equal(result.summary.inlineExempt,1);
  assert.equal(result.summary.spacingException,1);
});
