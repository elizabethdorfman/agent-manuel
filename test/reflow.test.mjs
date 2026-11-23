import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome,launchBrowser} from '../src/cdp.mjs';
import * as reflow from '../src/checks/reflow/index.mjs';
import {runCheck,openPage,runCheckOnPage,evaluate} from '../src/checks/_lib/c-browser.mjs';
import {labelOutcomes} from '../src/checks/_lib/c-util.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const rulesOf=out=>Object.fromEntries(Object.entries(Object.groupBy(out.findings,f=>f.selector)).map(([k,v])=>[k,v.map(f=>f.measurements.rule).sort()]));
const off=(selector,extra={})=>({selector,tag:'div',rect:{x:0,y:0,width:400,height:20},right:400,by:'box',width:'400px',minWidth:'0px',maxWidth:'none',...extra});

test('The reflow variant sets a 320px viewport.',()=>{
  assert.deepEqual(reflow.variants,[{method:'Emulation.setDeviceMetricsOverride',params:{width:320,height:640,deviceScaleFactor:1,mobile:false}}]);
});

test('R1 fails only when the document is wider than the viewport.',()=>{
  const base={viewport:{width:320,height:640},innerWidth:320,clipped:[]};
  assert.deepEqual(rulesOf(reflow.analyze({...base,scrollWidth:321,offenders:[off('#a')]})),{},'1px slack');
  assert.deepEqual(rulesOf(reflow.analyze({...base,scrollWidth:400,offenders:[off('#a'),off('#b',{by:'text'})]})),{'#a':['R1'],'#b':['R1']});
  const ghost=reflow.analyze({...base,scrollWidth:400,offenders:[]});
  assert.deepEqual(rulesOf(ghost),{html:['R1']},'overflow with no element found still fails, on the page');
});

test('R2 clipped elements are review, independent of R1.',()=>{
  const out=reflow.analyze({viewport:{width:320,height:640},innerWidth:320,scrollWidth:320,offenders:[],
    clipped:[{...off('#row'),clipper:'#card',axis:'x',clippedBy:40,overflow:'hidden',textOverflow:'clip'},{...off('#name'),clipper:'#cell',axis:'x',clippedBy:10,overflow:'hidden',textOverflow:'ellipsis'}]});
  assert.deepEqual(rulesOf(out),{'#row':['R2'],'#name':['R2']});
  assert.match(out.findings[1].message,/ellipsis/);
});

test('The labelled reflow fixture matches its expected file exactly in real Chrome.',async c=>{
  if(!await findChrome()){c.skip('Chrome was not found; set CHROME_BIN to run this test.');return;}
  const expected=JSON.parse(await readFile(join(root,'examples/checks/reflow.expected.json'),'utf8'));
  const {result}=await runCheck(reflow,{url:join(root,expected.fixture),...expected.viewport});
  assert.equal(result.summary.innerWidth,expected.checkedWidth);
  const {actual,actualRules,stray}=labelOutcomes(result.findings,expected);
  assert.deepEqual(stray,[],'no findings on unlabelled elements');
  assert.deepEqual(actual,expected.expected);
  for(const [id,rules] of Object.entries(actualRules))assert.deepEqual(rules,expected.rules[id]??[],id+' rules');
  for(const [id,m] of Object.entries(expected.measurements)){
    const f=result.findings.find(f=>f.selector===id);
    for(const [k,v] of Object.entries(m))assert.equal(f.measurements[k],v,`${id} ${k}`);
  }
});

test('A page whose only wide content scrolls inside overflow-x:auto passes, and the viewport is restored.',async c=>{
  if(!await findChrome()){c.skip('Chrome was not found; set CHROME_BIN to run this test.');return;}
  const html=`<!doctype html><meta charset=utf-8><body style="margin:0"><div id=s style="overflow-x:auto"><table style="width:900px"><tr><td>wide</td></tr></table></div><p>Fine.</p>`;
  const browser=await launchBrowser();
  try {
    const page=await openPage(browser,{url:'data:text/html,'+encodeURIComponent(html),width:390,height:844});
    const {result}=await runCheckOnPage(page,reflow);
    assert.deepEqual(result.findings,[]);
    assert.equal(result.summary.innerWidth,320);
    assert.equal(await evaluate(page.send,'innerWidth'),390,'variant undone');
  } finally { await browser.cleanup(); }
});
