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
  const a=analyzeAlignment(snapshot([e('a',10,10),e('b',18,80),e('c',18,140,{groupId:'g2'}),e('d',18,210,{parentId:'a'})]));
  assert(a.candidates.some(c=>c.targetIds.join(',')==='a,b'));
  assert(!a.candidates.some(c=>c.targetIds.includes('c')));
  assert(!a.candidates.some(c=>c.targetIds.join(',')==='a,d'));
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
