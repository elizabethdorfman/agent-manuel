const finiteRect = r => r && ['x','y','width','height'].every(k=>Number.isFinite(r[k])) && r.width>0 && r.height>0;
const AXES=['left','right','centerX','top','bottom','centerY'];
const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
export function coordinate(e,axis) {
  const r=e.rect;
  return ({left:r.x,right:r.x+r.width,centerX:r.x+r.width/2,top:r.y,bottom:r.y+r.height,centerY:r.y+r.height/2})[axis];
}
/** Groups sorted values into runs whose members sit within `tolerance` of the run's first value. */
function clusterValues(items,tolerance) {
  const sorted=[...items].sort((a,b)=>a.value-b.value),clusters=[];
  for(let i=0;i<sorted.length;) {
    let j=i+1;while(j<sorted.length&&sorted[j].value-sorted[i].value<=tolerance)j++;
    const members=sorted.slice(i,j);
    clusters.push({value:mean(members.map(m=>m.value)),members});
    i=j;
  }
  return clusters;
}
export function analyzeAlignment(snapshot,options={}) {
  const tolerance=options.tolerance ?? 2,near=options.near ?? 12;
  if(!Number.isFinite(tolerance)||tolerance<0||!Number.isFinite(near)||near<tolerance) throw new Error('Use nonnegative tolerance and near >= tolerance.');
  const elements=snapshot.elements.filter(e=>finiteRect(e.rect));
  const byId=new Map(elements.map(e=>[e.id,e]));
  const results=[],guides=[],candidates=[],ruleTargetIds=new Set();
  for(const rule of options.rules??[]) {
    const axis=rule.axis??'left', t=rule.tolerance??tolerance, offset=rule.offset??0;
    if(!AXES.includes(axis)||!Number.isFinite(t)||t<0) throw new Error('Invalid rule axis or tolerance.');
    if(!Number.isFinite(offset)) throw new Error('Rule offset must be a finite number of CSS pixels.');
    const matches=snapshot.ruleMatches?.[rule.id]??[];
    const ids=[...new Set(matches.flatMap(m=>m.ids??[]))];
    ids.forEach(id=>ruleTargetIds.add(id));
    const targets=ids.map(id=>byId.get(id)).filter(Boolean);
    if(!matches.length||matches.some(m=>m.error||!m.ids?.length)||targets.length<2) {
      results.push({id:rule.id,status:'blocked',reason:'Every selector needs a visible target, and at least two distinct targets are required.',targetIds:ids,...(offset?{expectedOffset:offset}:{})});continue;
    }
    // The first selector's targets are the reference; later selectors are expected at reference + offset.
    const referenceIds=new Set((matches[0].ids??[]).filter(id=>byId.has(id)));
    const measurements=targets.map(e=>{
      const role=referenceIds.has(e.id)?'reference':'target',value=coordinate(e,axis);
      return {id:e.id,selector:e.selector,role,value,adjusted:role==='reference'?value:value-offset};
    });
    const referenceValue=mean(measurements.filter(m=>m.role==='reference').map(m=>m.adjusted));
    for(const m of measurements){m.expected=m.role==='reference'?referenceValue:referenceValue+offset;m.deviation=m.value-m.expected;delete m.adjusted;}
    const adjusted=measurements.map(m=>m.role==='reference'?m.value:m.value-offset);
    // spread is measured after removing the expected offset, so a correctly offset target has spread 0.
    const spread=Math.max(...adjusted)-Math.min(...adjusted);
    const maxDeviation=Math.max(...measurements.filter(m=>m.role==='target').map(m=>Math.abs(m.deviation)),0);
    results.push({id:rule.id,status:spread<=t?'within-tolerance':'outside-tolerance',axis,tolerance:t,expectedOffset:offset,spread,maxDeviation,
      referenceValue,targetIds:ids,values:measurements.map(m=>m.value),measurements,
      reason:'This compares the supplied relationship only. It does not infer design intent.'});
    guides.push({id:'rule-'+rule.id,axis,value:referenceValue,targetIds:ids,source:'explicit-rule'});
    if(offset) guides.push({id:'rule-'+rule.id+'-expected',axis,value:referenceValue+offset,targetIds:ids,source:'explicit-rule-offset'});
  }
  const isAncestor=(a,b)=>{
    const seen=new Set();let p=b.parentId;
    while(p&&!seen.has(p)){if(p===a.id)return true;seen.add(p);p=byId.get(p)?.parentId;}
    return false;
  };
  // Similar width, not nested, and vertically separated (not side-by-side cards or inline children).
  const comparable=(a,b)=>{
    if(a.id===b.id||isAncestor(a,b)||isAncestor(b,a))return false;
    const ratio=a.rect.width/b.rect.width;
    if(ratio<.75||ratio>1.3334)return false;
    return a.rect.y+a.rect.height<=b.rect.y+1||b.rect.y+b.rect.height<=a.rect.y+1;
  };
  const anchors=elements.filter(e=>e.rect.width>=60&&!e.clipped&&!e.masked &&
    (['heading','image','control','rule-target','background-image'].includes(e.kind) ||
      e.kind==='text' && !e.display?.startsWith('inline') && !elements.some(c=>c.parentId===e.id)));
  const grouped=new Map();for(const e of anchors) {const k=e.groupId??'root';if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(e);}
  for(const [groupId,items] of grouped) {
    for(const axis of ['left','right','centerX']) {
      for(const cluster of clusterValues(items.map(e=>({e,value:coordinate(e,axis)})),tolerance))
        if(cluster.members.length>=2) guides.push({id:'guide-'+guides.length,groupId,axis,value:cluster.value,targetIds:cluster.members.map(x=>x.e.id),source:'observed-cluster'});
    }
    // Per-element left-edge candidates: an element just off a larger shared edge in its own group.
    const clusters=clusterValues(items.map(e=>({e,value:e.rect.x})),tolerance);
    const shared=clusters.filter(c=>c.members.length>=2);
    for(const own of clusters) for(const {e} of own.members) {
      if(ruleTargetIds.has(e.id))continue; // Supplied rules own declared relationships.
      let best=null;
      for(const c of shared) {
        if(c===own)continue;
        const peers=c.members.map(m=>m.e).filter(p=>comparable(e,p));
        if(peers.length<2||peers.length<=own.members.length)continue;
        const delta=Math.abs(e.rect.x-c.value);
        if(delta<=tolerance||delta>near)continue;
        if(!best||delta<best.delta)best={c,peers,delta};
      }
      if(!best)continue;
      candidates.push({id:'candidate-'+candidates.length,status:'review',groupId,axis:'left',elementId:e.id,selector:e.selector,value:e.rect.x,
        clusterValue:best.c.value,clusterSize:best.peers.length,clusterIds:best.peers.map(p=>p.id),ownClusterSize:own.members.length,
        delta:best.delta,direction:e.rect.x>best.c.value?'right':'left',targetIds:[e.id],
        reason:'This element sits just off a left edge shared by more elements in its group. Indentation, padding or intentional placement may explain this.'});
    }
  }
  return {checkId:'UI06',status:'review-required',tolerance,near,ruleResults:results,guides,candidates,
    summary:{elementCount:elements.length,textRunCount:snapshot.textRuns?.length??0,ruleViolations:results.filter(r=>r.status==='outside-tolerance').length,blockedRules:results.filter(r=>r.status==='blocked').length,reviewCandidates:candidates.length},
    warnings:['No whole-page alignment pass is inferred. Automatic candidates are review leads, not confirmed bugs. Elements targeted by a supplied rule are not repeated as automatic candidates. Missing targets remain blocked.']};
}
