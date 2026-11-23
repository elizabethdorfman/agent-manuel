import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from '../src/cdp.mjs';
import * as hierarchy from '../src/checks/hierarchy/index.mjs';
import {runCheck} from '../src/checks/_lib/c-browser.mjs';
import {labelOutcomes} from '../src/checks/_lib/c-util.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const DARK='rgb(34, 34, 34)',WHITE='rgb(255, 255, 255)';
let y=0;
const item=(selector,extra={})=>({selector,tag:'p',kind:'text',level:0,rect:{x:0,y:(y+=40),width:300,height:24},srOnly:false,text:selector,chars:40,
  fontSize:16,fontWeight:400,color:DARK,background:WHITE,behind:WHITE,fill:'none',lines:1,display:'block',standalone:false,inControl:false,isLabelish:false,...extra});
const h=(selector,level,fontSize,fontWeight,extra={})=>item(selector,{tag:'h'+level,kind:'heading',level,fontSize,fontWeight,chars:8,...extra});
const run=(items,config={})=>hierarchy.analyze({viewport:{width:390,height:844},items,titleMatches:null},{config});
const rulesOf=out=>Object.fromEntries(Object.entries(Object.groupBy(out.findings,f=>f.selector)).map(([k,v])=>[k,v.map(f=>f.measurements.rule).sort()]));

test('Weight factors follow the spec.',()=>{
  assert.deepEqual([400,500,600,700,900].map(hierarchy.weightFactor),[1,1.1,1.25,1.4,1.4]);
  assert.deepEqual(hierarchy.FILL,{filled:1.6,outlined:1.15,none:1});
  const black=hierarchy.contrastFactor(item('#a',{color:'rgb(0, 0, 0)'}));
  const same=hierarchy.contrastFactor(item('#b',{color:WHITE}));
  assert.ok(Math.abs(black-1.2)<1e-9&&Math.abs(same-0.6)<1e-9);
  assert.equal(hierarchy.isColouredFill('rgb(91, 42, 134)'),true);
  assert.equal(hierarchy.isColouredFill('rgb(17, 17, 17)'),true,'near-black is a strong fill');
  assert.equal(hierarchy.isColouredFill('rgb(230, 230, 230)'),false);
  assert.equal(hierarchy.isColouredFill('rgb(255, 255, 255)'),false);
  assert.equal(hierarchy.isColouredFill('rgba(0, 0, 0, 0)'),false);
});

test('A clean page produces a ranking and no findings.',()=>{
  const out=run([h('#t',1,32,700),item('#p1'),h('#s',2,22,700,{gapAbove:24,gapBelow:8}),item('#p2'),h('#ss',3,17,600,{gapAbove:20,gapBelow:6}),item('#p3')]);
  assert.deepEqual(out.findings,[]);
  assert.deepEqual(out.summary.ranking.map(r=>r.selector),['#t','#s','#ss','#p1','#p2','#p3']);
  assert.deepEqual(Object.keys(out.summary.ranking[0]).sort(),['contrastFactor','fill','fontSize','fontWeight','kind','level','rank','rect','selector','text','weight']);
});

test('H1/H2: inverted levels fail, nearly-equal levels are review.',()=>{
  const out=run([h('#t',1,32,700),h('#a',2,20,600),h('#b',3,24,700),h('#c',2,21,600),item('#p')]);
  assert.deepEqual(rulesOf(out),{'#b':['H1']});
  const near=run([h('#t',1,32,700),h('#a',2,20,600),h('#b',3,18,600),item('#p')]);
  assert.deepEqual(rulesOf(near),{'#b':['H2']});
  const flat=run([h('#t',1,32,700),h('#a',2,16,400),item('#p')]);
  assert.deepEqual(rulesOf(flat),{'#a':['H1']},'a heading no heavier than body text fails');
});

test('H3: something outweighing the title is review; a filled button may.',()=>{
  const out=run([h('#t',1,20,600),item('#promo',{fontSize:40,fontWeight:700,lines:2}),item('#p')]);
  assert.deepEqual(rulesOf(out),{'#promo':['H3']});
  const btn=run([h('#t',1,24,700),item('#cta',{kind:'button',tag:'button',fill:'filled',background:'rgb(91, 42, 134)',fontSize:24,fontWeight:700}),item('#p')]);
  assert.deepEqual(rulesOf(btn),{});
  // config.titleSelector is resolved in the page; analyze reads titleMatches.
  const withTitle=hierarchy.analyze({viewport:{width:390,height:844},items:[h('#t',1,20,600),item('#hero',{fontSize:40,fontWeight:700,lines:2}),item('#p')],titleMatches:['#hero']},{});
  assert.deepEqual(rulesOf(withTitle),{});
});

test('H4: standalone single-line bold or large text is a fake heading; inline, links and labels are not.',()=>{
  const out=run([h('#t',1,32,700),item('#p',{chars:400}),
    item('#fake',{fontWeight:700,standalone:true}),item('#big',{fontSize:20,standalone:true}),
    item('#inline',{fontWeight:700,standalone:false}),item('#two-lines',{fontWeight:700,standalone:true,lines:2}),
    item('#link',{tag:'a',fontWeight:700,standalone:true,isLabelish:true}),item('#label',{tag:'label',fontWeight:700,standalone:true,isLabelish:true}),
    item('#in-button',{fontWeight:700,standalone:true,inControl:true})]);
  assert.deepEqual(rulesOf(out),{'#fake':['H4'],'#big':['H4']});
});

test('H5: missing, duplicate and skipped levels fail; hidden-visually headings still count.',()=>{
  assert.deepEqual(rulesOf(run([h('#a',2,24,700),item('#p')])),{body:['H5']});
  assert.deepEqual(rulesOf(run([h('#a',1,32,700),h('#b',1,32,700),item('#p')])),{'#b':['H5']});
  assert.deepEqual(rulesOf(run([h('#a',1,32,700),h('#b',3,18,700),item('#p')])),{'#b':['H5']});
  assert.deepEqual(rulesOf(run([h('#sr',1,16,400,{srOnly:true}),h('#b',2,24,700),item('#p')])),{});
});

test('H6: two buttons with the same strong fill compete; grey and outlined do not.',()=>{
  const b=(s,bg,fill='filled')=>item(s,{kind:'button',tag:'button',fill,background:bg});
  assert.deepEqual(rulesOf(run([h('#t',1,32,700),b('#x','rgb(91, 42, 134)'),b('#y','rgb(91, 42, 134)'),item('#p')])),{'#x':['H6'],'#y':['H6']});
  assert.deepEqual(rulesOf(run([h('#t',1,32,700),b('#x','rgb(91, 42, 134)'),b('#y','rgb(230, 230, 230)'),b('#z',WHITE,'outlined'),item('#p')])),{});
});

test('H7: a heading closer to the content above than below is review.',()=>{
  const out=run([h('#t',1,32,700),item('#p'),h('#s',2,22,700,{gapAbove:8,gapBelow:24}),h('#e',2,22,700,{gapAbove:12,gapBelow:12}),h('#ok',2,22,700,{gapAbove:20,gapBelow:12}),h('#first',2,22,700,{gapAbove:null,gapBelow:4})]);
  assert.deepEqual(rulesOf(out),{'#s':['H7'],'#e':['H7']});
});

test('The labelled hierarchy fixture matches its expected file exactly in real Chrome.',async t=>{
  if(!await findChrome()){t.skip('Chrome was not found; set CHROME_BIN to run this test.');return;}
  const expected=JSON.parse(await readFile(join(root,'examples/checks/hierarchy.expected.json'),'utf8'));
  const {result}=await runCheck(hierarchy,{url:join(root,expected.fixture),...expected.viewport});
  const {actual,actualRules,stray}=labelOutcomes(result.findings,expected);
  assert.deepEqual(stray,[],'no findings on unlabelled elements');
  assert.deepEqual(actual,expected.expected);
  for(const [id,rules] of Object.entries(actualRules))assert.deepEqual(rules,expected.rules[id]??[],id+' rules');
  assert.equal(result.summary.ranking[0].selector,expected.topRanked);
  const ranks=result.summary.ranking.map(r=>r.rank);
  assert.deepEqual(ranks,ranks.map((_,i)=>i+1));
  for(const f of result.findings){assert.ok(f.rect.width>0);assert.match(f.id,/^UI09-H\d-/);}
});
