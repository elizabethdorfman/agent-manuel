import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from '../src/cdp.mjs';
import * as alignment from '../src/checks/alignment/index.mjs';
import {runCheck} from '../src/checks/_lib/c-browser.mjs';
import {outcomeOf} from '../src/checks/_lib/c-util.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const VERDICT={'outside-tolerance':'fail','review-candidate':'review','within-tolerance':'none','not-flagged':'none'};

test('Alignment module meets the contract shape.',()=>{
  assert.deepEqual(alignment.meta,{id:'UI06',name:'alignment',title:'Required edges line up.'});
  assert.equal(typeof alignment.collect,'function');
  assert.deepEqual(alignment.variants,[]);
  // collect must serialize as a standalone function expression.
  assert.doesNotThrow(()=>new Function('return ('+alignment.collect.toString()+')'));
});

test('Alignment analyze maps rule failures to fail and candidates to review.',()=>{
  const el=(id,selector,x,y)=>({id,selector,kind:'heading',groupId:'g1',parentId:null,display:'block',clipped:false,masked:false,rect:{x,y,width:200,height:30}});
  const snapshot={elements:[el('e1','#a',24,0),el('e2','#b',20,50),el('e3','#c',24,100),el('e4','#d',24,150),el('e5','#e',29,200)],
    ruleMatches:{r1:[{selector:'#a',ids:['e1']},{selector:'#b',ids:['e2']}],r2:[{selector:'#a',ids:['e1']},{selector:'#missing',ids:[]}]},textRuns:[],groups:[]};
  const out=alignment.analyze(snapshot,{config:{rules:[{id:'r1',selectors:['#a','#b']},{id:'r2',selectors:['#a','#missing']}]}});
  assert.equal(out.checkId,'UI06');
  const byId=Object.fromEntries(out.findings.map(f=>[f.id,f]));
  assert.equal(byId['UI06-r1-b'].status,'fail');
  assert.equal(byId['UI06-r1-b'].measurements.deviation,-4);
  assert.equal(byId['UI06-candidate-e'].status,'review');
  assert.deepEqual(out.summary.blockedRuleIds,['r2']);
  assert.equal(out.findings.length,2);
});

test('Alignment module reproduces the labelled signup verdicts in real Chrome.',async t=>{
  if(!await findChrome()){t.skip('Chrome was not found; set CHROME_BIN to run this test.');return;}
  const expected=JSON.parse(await readFile(join(root,'examples/alignment-signup.expected.json'),'utf8'));
  const {rules}=JSON.parse(await readFile(join(root,expected.rules),'utf8'));
  const {result}=await runCheck(alignment,{url:join(root,expected.fixture),...expected.viewport,config:{rules}});
  const labels=Object.keys(expected.elements);
  const actual=Object.fromEntries(labels.map(s=>[s,outcomeOf(result.findings.filter(f=>f.selector===s))]));
  assert.deepEqual(actual,Object.fromEntries(labels.map(s=>[s,VERDICT[expected.elements[s].expected]])));
  // No finding points outside the labelled set.
  assert.deepEqual(result.findings.filter(f=>!labels.includes(f.selector)),[]);
  for(const f of result.findings){assert.ok(f.rect&&f.rect.width>0,'every finding has a rect');assert.ok(f.message);}
  const dev=Object.fromEntries(result.findings.filter(f=>f.status==='fail').map(f=>[f.selector,f.measurements.deviation]));
  assert.deepEqual(dev,{'#email':-4,'#create-account':-7});
});
