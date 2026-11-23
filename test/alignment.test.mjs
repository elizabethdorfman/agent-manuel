import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAlignment} from '../src/analyze.mjs';
import {renderReport} from '../src/render.mjs';
const e=(id,x,y,extra={})=>({id,kind:'heading',groupId:'g1',rect:{x,y,width:200,height:30},style:{},...extra});
const snapshot=(elements,matches={})=>({elements,ruleMatches:matches,textRuns:[],groups:[],warnings:[],capture:{x:0,y:0,width:390,height:844},viewport:{width:390,height:844},page:{title:'Fixture',url:'file:///fixture.html'}});
test('Explicit geometry rules distinguish exact, tolerated and out-of-tolerance edges.',()=>{
  for(const [x,status] of [[10,'within-tolerance'],[12,'within-tolerance'],[12.01,'outside-tolerance'],[18,'outside-tolerance']]){
    const s=snapshot([e('a',10,10),e('b',x,80)],{r:[{selector:'#a',ids:['a']},{selector:'#b',ids:['b']}]});
    const a=analyzeAlignment(s,{rules:[{id:'r',axis:'left'}]});assert.equal(a.ruleResults[0].status,status);
  }
});
test('A missing rule target remains blocked instead of becoming a pass.',()=>{
  const s=snapshot([e('a',10,10)],{r:[{selector:'#a',ids:['a']},{selector:'#missing',ids:[]}]});
  assert.equal(analyzeAlignment(s,{rules:[{id:'r'}]}).ruleResults[0].status,'blocked');
});
test('Near-edge review does not compare unrelated groups or ancestor boxes.',()=>{
  const items=d=>[e('a',10,0),e('a2',10,50),e('b',18,100),e('c',18,150,{groupId:'g2'}),d];
  const a=analyzeAlignment(snapshot(items(e('d',15,210,{parentId:'a'}))));
  assert.deepEqual(a.candidates.map(c=>c.elementId),['b']);
  // Control: the same box without the ancestor link is flagged.
  assert.deepEqual(analyzeAlignment(snapshot(items(e('d',15,210)))).candidates.map(c=>c.elementId).sort(),['b','d']);
  assert.deepEqual(a.candidates[0].clusterIds,['a','a2']);
  assert(!a.candidates.some(c=>c.elementId==='c'),'different group');
  assert(!a.candidates.some(c=>c.elementId==='d'),'its ancestor cannot count toward the shared edge');
  assert.equal(a.status,'review-required');
});
test('Unmeasurable geometry cannot produce passing rule evidence.',()=>{
  const s=snapshot([e('a',10,10),e('b',NaN,80)],{r:[{ids:['a','b']}]});
  assert.equal(analyzeAlignment(s,{rules:[{id:'r'}]}).ruleResults[0].status,'blocked');
});
test('The report escapes page content and translates document coordinates into the capture.',()=>{
  const s=snapshot([e('a',20,210,{selector:'<script>alert(1)</script>'})]);s.page.title='<script>bad()</script>';s.capture.y=200;
  const html=renderReport(s,analyzeAlignment(s),'YWJj');
  assert(!html.includes('<script>bad()'));
  assert(html.includes('&lt;script&gt;bad()'));
  assert(html.includes('x="20" y="10"'));
  assert(!html.includes('<script>alert(1)</script>'));
});
test('An offset rule expects later selectors at reference + offset.',()=>{
  for(const [x,status,deviation] of [[18,'within-tolerance',0],[20,'within-tolerance',2],[21,'outside-tolerance',3],[10,'outside-tolerance',-8]]){
    const s=snapshot([e('a',10,10),e('b',x,80)],{r:[{selector:'#a',ids:['a']},{selector:'#b',ids:['b']}]});
    const r=analyzeAlignment(s,{rules:[{id:'r',axis:'left',offset:8}]}).ruleResults[0];
    assert.equal(r.status,status);assert.equal(r.expectedOffset,8);
    assert.equal(r.spread,Math.abs(deviation));assert.equal(r.maxDeviation,Math.abs(deviation));
    const target=r.measurements.find(m=>m.id==='b');
    assert.equal(target.role,'target');assert.equal(target.expected,18);assert.equal(target.deviation,deviation);
    assert.equal(r.measurements.find(m=>m.id==='a').role,'reference');
  }
  const s=snapshot([e('a',10,10),e('b',10,80)],{r:[{selector:'#a',ids:['a']},{selector:'#b',ids:['b']}]});
  assert.equal(analyzeAlignment(s,{rules:[{id:'r'}]}).ruleResults[0].expectedOffset,0);
  assert.throws(()=>analyzeAlignment(s,{rules:[{id:'r',offset:'8'}]}));
});
test('Offset rules work on vertical axes and with several later targets.',()=>{
  const s=snapshot([e('a',10,10),e('b',10,60),e('c',10,64)],{r:[{selector:'#a',ids:['a']},{selector:'.later',ids:['b','c']}]});
  const r=analyzeAlignment(s,{rules:[{id:'r',axis:'top',offset:50,tolerance:2}]}).ruleResults[0];
  assert.equal(r.status,'outside-tolerance');assert.equal(r.spread,4);
  assert.deepEqual(r.measurements.map(m=>m.deviation),[0,0,4]);
});
test('A candidate is one element just off a larger shared edge, reported once.',()=>{
  const items=[e('h',24,0),e('p',24,40),e('i',24,80),e('t',29,120),e('far',44,160),e('far2',44,200)];
  const a=analyzeAlignment(snapshot(items));
  assert.equal(a.candidates.length,1);
  const c=a.candidates[0];
  assert.equal(c.elementId,'t');assert.equal(c.clusterValue,24);assert.equal(c.clusterSize,3);assert.equal(c.delta,5);assert.equal(c.direction,'right');assert.equal(c.ownClusterSize,1);
  // A 20px indent is beyond `near`; an element exactly within tolerance is part of the edge.
  assert(!a.candidates.some(x=>['far','far2','h','p','i'].includes(x.elementId)));
  const tol=analyzeAlignment(snapshot([e('h',24,0),e('p',24,40),e('t',26,80)]));
  assert.equal(tol.candidates.length,0);
});
test('Two equal clusters do not flag each other, and a larger cluster does.',()=>{
  const pair=analyzeAlignment(snapshot([e('a',24,0),e('b',24,40),e('c',30,80),e('d',30,120)]));
  assert.equal(pair.candidates.length,0);
  const bigger=analyzeAlignment(snapshot([e('a',24,0),e('b',24,40),e('x',24,80),e('c',30,120),e('d',30,160)]));
  assert.deepEqual(bigger.candidates.map(c=>c.elementId).sort(),['c','d']);
});
test('Candidates skip rule targets and keep size, width and side-by-side exclusions.',()=>{
  const base=[e('a',24,0),e('b',24,40),e('c',24,80)];
  const ruled=snapshot([...base,e('t',29,120)],{r:[{selector:'#a',ids:['a']},{selector:'#t',ids:['t']}]});
  const a=analyzeAlignment(ruled,{rules:[{id:'r'}]});
  assert.equal(a.candidates.length,0);assert.equal(a.ruleResults[0].status,'outside-tolerance');
  const narrow=analyzeAlignment(snapshot([...base,e('n',29,120,{rect:{x:29,y:120,width:50,height:20}})]));
  assert.equal(narrow.candidates.length,0,'width below 60');
  const wide=analyzeAlignment(snapshot([...base,e('w',29,120,{rect:{x:29,y:120,width:340,height:20}})]));
  assert.equal(wide.candidates.length,0,'width ratio');
  const beside=analyzeAlignment(snapshot([...base.map((x,i)=>({...x,rect:{...x.rect,y:0}})),e('s',29,0)]));
  assert.equal(beside.candidates.length,0,'not vertically separated');
  const clipped=analyzeAlignment(snapshot([...base,e('k',29,120,{clipped:true}),e('m',29,160,{masked:true})]));
  assert.equal(clipped.candidates.length,0,'clipped or masked');
});
test('The report states expected offsets and describes candidates in plain language.',()=>{
  const s=snapshot([e('a',24,0,{selector:'#a'}),e('b',24,40,{selector:'#b'}),e('c',24,80,{selector:'#c'}),e('t',29,120,{selector:'#terms'}),e('h',32,160,{selector:'#hint'})],
    {'hint-indented-8px':[{selector:'#a',ids:['a']},{selector:'#hint',ids:['h']}]});
  const html=renderReport(s,analyzeAlignment(s,{rules:[{id:'hint-indented-8px',offset:8}]}),'YWJj');
  assert(html.includes('#terms</b> is 5 px right of the shared left edge at x=24 shared by 3 elements'));
  assert(html.includes('expected offset 8 CSS px'));
  assert(html.includes('#hint measured x=32, expected 32, deviation 0 CSS px'));
});
