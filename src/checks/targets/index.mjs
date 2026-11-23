/**
 * UI04 tap targets: the effective hit area of every visible interactive element.
 *
 * T1 fail    hit area under 24×24 CSS px, unless the WCAG 2.5.8 spacing exception applies
 *            (a 24px circle centred on the target touches no other target, and no other
 *            undersized target's circle) or it is an inline link inside a sentence.
 * T2 review  a primary control (a button, or a filled control) under 44px in either dimension.
 * T3 fail    the centre point is covered by another element (elementFromPoint).
 *
 * ctx.config = { minSize?: 24, primarySize?: 44 }
 */
import {slug,round} from '../_lib/c-util.mjs';

export const meta={id:'UI04',name:'targets',title:'Every control is big enough to tap.'};
export const variants=[];

/** Runs in the page. Self-contained and read-only. */
export function collect(options={}) {
  const maxTargets=options.maxTargets??2000;
  const sel=e=>{
    if(e===document.body)return 'body';
    if(e.id)return '#'+CSS.escape(e.id);
    const parts=[];
    for(let p=e;p&&p!==document.body&&p.parentElement;p=p.parentElement){
      const n=[...p.parentElement.children].filter(s=>s.tagName===p.tagName).indexOf(p)+1;
      parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+n+')');
    }
    return 'body > '+parts.join(' > ');
  };
  const INTERACTIVE='button,a[href],input:not([type=hidden]),select,textarea,label[for],[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[onclick]';
  const NESTING='button,a[href],[role=button],[role=link]';
  const BUTTON='button,input[type=submit],input[type=button],input[type=reset],input[type=image],[role=button]';
  const NOT_PRIMARY='input:not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),select,textarea,[role=checkbox],[role=radio],label';
  const shown=e=>{
    const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;
    for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}
    return true;
  };
  const transparent=c=>!c||c==='transparent'||/rgba\([^)]*,\s*0\)$/.test(c);
  const behind=e=>{for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p).backgroundColor;if(!transparent(c))return c;}return 'rgb(255, 255, 255)';};
  const filled=e=>{const c=getComputedStyle(e).backgroundColor;return !transparent(c)&&c!==behind(e);};
  const box=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom});
  const gap=(a,b)=>Math.hypot(Math.max(0,a.left-b.right,b.left-a.right),Math.max(0,a.top-b.bottom,b.top-a.bottom));
  const union=(a,b)=>({left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)});
  const isBlock=d=>!/^inline/.test(d)&&d!=='contents';
  const words=t=>(t??'').replace(/[^\p{L}\p{N}]+/gu,'');
  // An inline link with other words around it in the same block: a link inside a sentence.
  const inSentence=e=>{
    if(!e.matches('a[href],[role=link]')||!/^inline($|\s)/.test(getComputedStyle(e).display))return false;
    let b=e.parentElement;while(b&&b!==document.body&&!isBlock(getComputedStyle(b).display))b=b.parentElement;
    if(!b)return false;
    let rest=b.textContent;
    for(const l of b.querySelectorAll('a[href],[role=link]'))rest=rest.replace(l.textContent,' ');
    return words(rest).length>=2;
  };
  const candidates=[...document.querySelectorAll(INTERACTIVE)].filter(e=>!e.disabled&&shown(e));
  const set=new Set(candidates);
  const targets=[];
  for(const e of candidates){
    if(targets.length>=maxTargets)break;
    if(e.parentElement?.closest(NESTING)&&set.has(e.parentElement.closest(NESTING)))continue; // nested inside another control
    const labels=e.labels?[...e.labels].filter(shown):[];
    // A label[for] whose control is visible is part of that control's hit area, not its own target.
    if(e.tagName==='LABEL'&&e.control&&set.has(e.control))continue;
    const own=box(e.getBoundingClientRect());
    let hit=own;const merged=[];
    for(const l of labels){
      const lr=box(l.getBoundingClientRect());
      if(l.contains(e)||gap(hit,lr)<=8){hit=union(hit,lr);merged.push(sel(l));}
    }
    const owns=n=>n&&(n===e||e.contains(n)||labels.some(l=>l===n||l.contains(n))||(e.control&&(e.control===n||e.control.contains(n))));
    const probe=(x,y)=>{
      if(x<0||y<0||x>=innerWidth||y>=innerHeight)return {state:'offscreen'};
      const n=document.elementFromPoint(x,y);
      if(owns(n))return {state:'clear'};
      if(n&&n.contains(e))return {state:'ancestor',by:sel(n)};
      return {state:'covered',by:n?sel(n):null};
    };
    const cx=(own.left+own.right)/2,cy=(own.top+own.bottom)/2,inset=2;
    const s=getComputedStyle(e);
    targets.push({
      selector:sel(e),tag:e.tagName.toLowerCase(),type:e.getAttribute('type')??undefined,role:e.getAttribute('role')??undefined,
      name:(e.getAttribute('aria-label')||e.innerText||e.value||'').replace(/\s+/g,' ').trim().slice(0,80),
      rect:{x:own.left+scrollX,y:own.top+scrollY,width:own.right-own.left,height:own.bottom-own.top},
      hitRect:{x:hit.left+scrollX,y:hit.top+scrollY,width:hit.right-hit.left,height:hit.bottom-hit.top},
      mergedLabels:merged,
      primary:!e.matches(NOT_PRIMARY)&&(e.matches(BUTTON)||filled(e)),filled:filled(e),
      inlineInSentence:inSentence(e),display:s.display,
      centre:probe(cx,cy),
      corners:[probe(own.left+inset,own.top+inset),probe(own.right-inset,own.top+inset),probe(own.left+inset,own.bottom-inset),probe(own.right-inset,own.bottom-inset)],
    });
  }
  return {schemaVersion:1,viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},url:location.origin+location.pathname,targets,truncated:targets.length>=maxTargets};
}

const centreOf=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
const distToRect=(p,r)=>Math.hypot(Math.max(0,r.x-p.x,p.x-(r.x+r.width)),Math.max(0,r.y-p.y,p.y-(r.y+r.height)));

/**
 * WCAG 2.5.8 spacing exception for an undersized target: its 24px circle must not
 * intersect any other target, nor the 24px circle of another undersized target.
 * Returns the nearest conflicting neighbour, or null when the exception applies.
 */
export function spacingConflict(t,all,min=24) {
  const c=centreOf(t.hitRect),radius=min/2;let worst=null;
  for(const o of all){
    if(o===t)continue;
    const undersized=o.hitRect.width<min||o.hitRect.height<min;
    const d=undersized?Math.hypot(c.x-centreOf(o.hitRect).x,c.y-centreOf(o.hitRect).y)-radius:distToRect(c,o.hitRect);
    if(d<radius&&(!worst||d<worst.distance))worst={selector:o.selector,distance:round(d+(undersized?radius:0)),undersized};
  }
  return worst;
}

export function analyze(collected,ctx={}) {
  const min=ctx.config?.minSize??24,primary=ctx.config?.primarySize??44;
  const all=collected.targets;
  const findings=[];
  const add=(rule,status,severity,t,message,m={})=>findings.push({id:`UI04-${rule}-${slug(t.selector)}`,status,severity,selector:t.selector,rect:t.hitRect,message,
    measurements:{rule,width:round(t.hitRect.width),height:round(t.hitRect.height),elementWidth:round(t.rect.width),elementHeight:round(t.rect.height),...m}});
  let exempted=0,spaced=0;
  for(const t of all){
    const w=t.hitRect.width,h=t.hitRect.height;
    const small=w<min||h<min;
    let t1=false;
    if(small){
      if(t.inlineInSentence)exempted++;
      else {
        const conflict=spacingConflict(t,all,min);
        if(conflict){t1=true;add('T1','fail','high',t,`"${t.name||t.selector}" is ${round(w,0)}×${round(h,0)}px, smaller than the ${min}×${min}px minimum, and sits too close to ${conflict.selector} to count as safely spaced.`,{minimum:min,nearest:conflict.selector,nearestDistance:conflict.distance});}
        else spaced++;
      }
    }
    if(!t1&&t.primary&&(w<primary||h<primary))
      add('T2','review','low',t,`"${t.name||t.selector}" is a main control but only ${round(w,0)}×${round(h,0)}px; ${primary}px in each direction is comfortable for thumbs.`,{recommended:primary,spacingException:small||undefined});
    if(t.centre.state==='covered')
      add('T3','fail','high',t,`The middle of "${t.name||t.selector}" is covered by ${t.centre.by??'another element'}, so a tap there will not reach it.`,
        {coveredBy:t.centre.by,coveredCorners:t.corners.filter(c=>c.state==='covered').length});
  }
  return {checkId:meta.id,findings,summary:{targets:all.length,inlineExempt:exempted,spacingException:spaced,
    offscreenNotProbed:all.filter(t=>t.centre.state==='offscreen').length,
    fail:findings.filter(f=>f.status==='fail').length,review:findings.filter(f=>f.status==='review').length}};
}
