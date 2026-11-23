/** Node-side helpers shared by the Stream C checks (hierarchy, targets, reflow, alignment). */

/** Stable finding id fragment from a selector: '#email' -> 'email'. */
export const slug=selector=>String(selector??'page').replace(/^#/,'').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'page';

export const median=xs=>{
  if(!xs.length)return 0;
  const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
};

/** Median of values weighted by a positive weight (e.g. character count). */
export function weightedMedian(items) {
  const xs=items.filter(i=>i.weight>0&&Number.isFinite(i.value)).sort((a,b)=>a.value-b.value);
  if(!xs.length)return 0;
  const total=xs.reduce((s,i)=>s+i.weight,0);
  let acc=0;
  for(const i of xs){acc+=i.weight;if(acc>=total/2)return i.value;}
  return xs.at(-1).value;
}

export const round=(n,d=2)=>Number.isFinite(n)?Math.round(n*10**d)/10**d:n;

/** Parses 'rgb(a)' strings from getComputedStyle into {r,g,b,a}. */
export function parseColor(c) {
  const m=/rgba?\(([^)]+)\)/.exec(c??'');
  if(!m)return {r:0,g:0,b:0,a:0};
  const p=m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};
}

/** WCAG relative luminance of an opaque {r,g,b}. */
export function luminance({r,g,b}) {
  const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
}

/** Alpha-composites colour `top` over opaque `bottom`. */
export const blend=(top,bottom)=>({r:top.r*top.a+bottom.r*(1-top.a),g:top.g*top.a+bottom.g*(1-top.a),b:top.b*top.a+bottom.b*(1-top.a),a:1});

/** Severity order used to reduce several findings to one outcome. */
export const outcomeOf=findings=>findings.some(f=>f.status==='fail')?'fail':findings.length?'review':'none';

/**
 * Compares findings against a labelled expected file ({expected:{'#id':'fail'|'review'|'none'}, rules?:{'#id':[...]}}).
 * Returns {actual, actualRules, stray}: stray lists findings whose selector is not labelled.
 */
export function labelOutcomes(findings,expected) {
  const labels=Object.keys(expected.expected);
  const actual={},actualRules={};
  for(const id of labels){
    const mine=findings.filter(f=>f.selector===id);
    actual[id]=outcomeOf(mine);
    actualRules[id]=[...new Set(mine.map(f=>f.measurements?.rule).filter(Boolean))].sort();
  }
  const stray=findings.filter(f=>!labels.includes(f.selector)).map(f=>f.id);
  return {actual,actualRules,stray};
}
