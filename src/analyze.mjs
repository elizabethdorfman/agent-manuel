const finiteRect = r => r && ['x','y','width','height'].every(k=>Number.isFinite(r[k])) && r.width>0 && r.height>0;
export function coordinate(e,axis) {
  const r=e.rect;
  return ({left:r.x,right:r.x+r.width,centerX:r.x+r.width/2,top:r.y,bottom:r.y+r.height,centerY:r.y+r.height/2})[axis];
}
export function analyzeAlignment(snapshot,options={}) {
  const tolerance=options.tolerance ?? 2,near=options.near ?? 12;
  if(!Number.isFinite(tolerance)||tolerance<0||!Number.isFinite(near)||near<tolerance) throw new Error('Use nonnegative tolerance and near >= tolerance.');
  const elements=snapshot.elements.filter(e=>finiteRect(e.rect));
  const byId=new Map(elements.map(e=>[e.id,e]));
  const results=[],guides=[],candidates=[];
  for(const rule of options.rules??[]) {
    const axis=rule.axis??'left', t=rule.tolerance??tolerance;
    if(!['left','right','centerX','top','bottom','centerY'].includes(axis)||!Number.isFinite(t)||t<0) throw new Error('Invalid rule axis or tolerance.');
    const matches=snapshot.ruleMatches?.[rule.id]??[];
    const ids=[...new Set(matches.flatMap(m=>m.ids??[]))];
    const targets=ids.map(id=>byId.get(id)).filter(Boolean);
    if(!matches.length||matches.some(m=>m.error||!m.ids?.length)||targets.length<2) {
      results.push({id:rule.id,status:'blocked',reason:'Every selector needs a visible target, and at least two distinct targets are required.',targetIds:ids});continue;
    }
    const values=targets.map(e=>coordinate(e,axis)),spread=Math.max(...values)-Math.min(...values);
    results.push({id:rule.id,status:spread<=t?'within-tolerance':'outside-tolerance',axis,tolerance:t,spread,targetIds:ids,values,
      reason:'This compares the supplied relationship only. It does not infer design intent.'});
    guides.push({id:'rule-'+rule.id,axis,value:Math.min(...values),targetIds:ids,source:'explicit-rule'});
  }
  const isAncestor=(a,b)=>{
    const seen=new Set();let p=b.parentId;
    while(p&&!seen.has(p)){if(p===a.id)return true;seen.add(p);p=byId.get(p)?.parentId;}
    return false;
  };
  const anchors=elements.filter(e=>e.rect.width>=60&&!e.clipped&&!e.masked &&
    (['heading','image','control','rule-target','background-image'].includes(e.kind) ||
      e.kind==='text' && !e.display?.startsWith('inline') && !elements.some(c=>c.parentId===e.id)));
  const grouped=new Map();for(const e of anchors) {const k=e.groupId??'root';if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(e);}
  for(const [groupId,items] of grouped) {
    for(const axis of ['left','right','centerX']) {
      const sorted=items.map(e=>({e,value:coordinate(e,axis)})).sort((a,b)=>a.value-b.value);
      for(let i=0;i<sorted.length;) {
        let j=i+1;while(j<sorted.length&&sorted[j].value-sorted[i].value<=tolerance)j++;
        const cluster=sorted.slice(i,j);
        if(cluster.length>=2) guides.push({id:'guide-'+guides.length,groupId,axis,value:cluster.reduce((s,x)=>s+x.value,0)/cluster.length,targetIds:cluster.map(x=>x.e.id),source:'observed-cluster'});
        i=j;
      }
    }
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++) {
      const a=items[i],b=items[j];if(isAncestor(a,b)||isAncestor(b,a))continue;
      const ratio=a.rect.width/b.rect.width;
      if(ratio<.75||ratio>1.3334) continue;
      // Compare vertically separated blocks, not side-by-side cards or inline children.
      if(!(a.rect.y+a.rect.height<=b.rect.y+1||b.rect.y+b.rect.height<=a.rect.y+1))continue;
      const leftGap=Math.abs(a.rect.x-b.rect.x),rightGap=Math.abs(coordinate(a,'right')-coordinate(b,'right'));
      if(leftGap>tolerance&&leftGap<=near) candidates.push({id:'candidate-'+candidates.length,status:'review',groupId,axis:'left',delta:leftGap,rightDelta:rightGap,targetIds:[a.id,b.id],reason:'Nearby edges of similarly sized blocks differ. Indentation, padding or intentional placement may explain this.'});
    }
  }
  return {checkId:'UI06',status:'review-required',tolerance,near,ruleResults:results,guides,candidates,
    summary:{elementCount:elements.length,textRunCount:snapshot.textRuns?.length??0,ruleViolations:results.filter(r=>r.status==='outside-tolerance').length,blockedRules:results.filter(r=>r.status==='blocked').length,reviewCandidates:candidates.length},
    warnings:['No whole-page alignment pass is inferred. Automatic candidates are review leads, not confirmed bugs. Missing targets remain blocked.']};
}
