/**
 * UI06 alignment: a contract wrapper around the existing collector (src/collect.mjs)
 * and analyzer (src/analyze.mjs). Neither is modified.
 *
 * ctx.config = { rules?: [...], tolerance?: 2, near?: 12 }  (the same rule format as examples/*.rules.json)
 * The runner must pass the same config object to collect(), because the collector resolves rule selectors in the page.
 */
import {collectEvidence} from '../../collect.mjs';
import {analyzeAlignment} from '../../analyze.mjs';
import {slug,round} from '../_lib/c-util.mjs';

export const meta={id:'UI06',name:'alignment',title:'Required edges line up.'};

// collectEvidence is already self-contained (no imports or closures), so it serializes with toString().
export const collect=collectEvidence;

export const variants=[];

export function analyze(collected,ctx={}) {
  const config=ctx.config??{};
  const rules=config.rules??[];
  const analysis=analyzeAlignment(collected,{rules,...(config.tolerance!==undefined?{tolerance:config.tolerance}:{}),...(config.near!==undefined?{near:config.near}:{})});
  const byId=new Map(collected.elements.map(e=>[e.id,e]));
  const findings=[];
  for(const r of analysis.ruleResults) {
    if(r.status!=='outside-tolerance')continue;
    // Each target off the expected edge by more than the tolerance is its own finding.
    let off=r.measurements.filter(m=>m.role==='target'&&Math.abs(m.deviation)>r.tolerance);
    // The spread can exceed tolerance without any single target doing so (e.g. references disagree):
    // then report the worst element.
    if(!off.length)off=[[...r.measurements].sort((a,b)=>Math.abs(b.deviation)-Math.abs(a.deviation))[0]];
    for(const m of off) {
      const el=byId.get(m.id);
      findings.push({
        id:`UI06-${slug(r.id)}-${slug(m.selector)}`,
        status:'fail',severity:'medium',selector:m.selector,rect:el?.rect,
        message:`This element is ${round(Math.abs(m.deviation),1)}px ${m.deviation<0?'left of':'right of'} the ${r.axis} edge it is supposed to share (rule "${r.id}", tolerance ${r.tolerance}px).`,
        measurements:{rule:r.id,axis:r.axis,value:round(m.value),expected:round(m.expected),deviation:round(m.deviation),tolerance:r.tolerance,spread:round(r.spread)},
      });
    }
  }
  for(const c of analysis.candidates) {
    const el=byId.get(c.elementId);
    findings.push({
      id:`UI06-candidate-${slug(c.selector)}`,
      status:'review',severity:'low',selector:c.selector,rect:el?.rect,
      message:`This element starts ${round(c.delta,1)}px ${c.direction==='right'?'right':'left'} of a left edge that ${c.clusterSize} nearby elements share. It may be a stray margin.`,
      measurements:{rule:'candidate',axis:'left',value:round(c.value),clusterValue:round(c.clusterValue),delta:round(c.delta),clusterSize:c.clusterSize},
    });
  }
  return {
    checkId:meta.id,findings,
    summary:{...analysis.summary,fail:findings.filter(f=>f.status==='fail').length,review:findings.filter(f=>f.status==='review').length,
      blockedRuleIds:analysis.ruleResults.filter(r=>r.status==='blocked').map(r=>r.id)},
  };
}
