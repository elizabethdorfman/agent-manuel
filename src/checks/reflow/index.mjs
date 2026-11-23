/**
 * UI01 reflow: at 320 CSS px wide the page must not scroll sideways (WCAG 1.4.10).
 *
 * R1 fail    document.documentElement.scrollWidth > innerWidth + 1. One finding per offending
 *            element: the deepest visible elements (or text) whose right edge is past innerWidth.
 *            Descendants of an overflow-x:auto|scroll container are allowed two-axis content.
 * R2 review  an element (or its text) clipped by an overflow:hidden|clip ancestor at 320px.
 *            Reported at the outermost clipped element under each clipping ancestor.
 *
 * ctx.config = { width?: 320 }   (the variant below is fixed at 320; config.width is informational)
 */
import {slug,round} from '../_lib/c-util.mjs';

export const meta={id:'UI01',name:'reflow',title:'The page fits a 320px-wide screen without sideways scrolling.'};

export const variants=[
  {method:'Emulation.setDeviceMetricsOverride',params:{width:320,height:640,deviceScaleFactor:1,mobile:false}},
];

/** Runs in the page. Self-contained and read-only. */
export function collect(options={}) {
  const maxReports=options.maxReports??200;
  const sel=e=>{
    if(e===document.body)return 'body';
    if(e===document.documentElement)return 'html';
    if(e.id)return '#'+CSS.escape(e.id);
    const parts=[];
    for(let p=e;p&&p!==document.body&&p.parentElement;p=p.parentElement){
      const n=[...p.parentElement.children].filter(s=>s.tagName===p.tagName).indexOf(p)+1;
      parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+n+')');
    }
    return 'body > '+parts.join(' > ');
  };
  const vw=innerWidth;
  const doc=r=>({x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height});
  const styles=new Map();const st=e=>{if(!styles.has(e))styles.set(e,getComputedStyle(e));return styles.get(e);};
  const shown=e=>{for(let p=e;p;p=p.parentElement){const s=st(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}return true;};
  // Nearest ancestor (excluding e) whose overflow is not visible on the given axis.
  const clipper=(e,axis)=>{
    for(let p=e.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){
      const v=st(p)[axis==='x'?'overflowX':'overflowY'];
      if(v!=='visible')return {el:p,mode:/auto|scroll/.test(v)?'scroll':'hidden'};
    }
    return null;
  };
  const scrollerX=e=>{for(let p=e.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement)if(/auto|scroll/.test(st(p).overflowX))return p;return null;};
  const all=[...document.body.querySelectorAll('*')].filter(e=>!/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(e.tagName));
  // The right edge of each element's own box and of its direct text, in document coordinates.
  const textRight=e=>{
    let right=-Infinity,rect=null;
    for(const n of e.childNodes){
      if(n.nodeType!==3||!n.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(n);
      for(const r of range.getClientRects()){if(r.width<1)continue;const x=r.right+scrollX;if(x>right){right=x;rect=r;}}
    }
    return {right,rect};
  };
  const info=new Map();
  for(const e of all){
    if(!shown(e))continue;
    const r=e.getBoundingClientRect();
    if(r.width<1&&r.height<1&&!e.childNodes.length)continue;
    const t=textRight(e);
    info.set(e,{r,boxRight:r.width>=1?r.right+scrollX:-Infinity,text:t});
  }
  const describe=(e,v,why)=>{
    const s=st(e);
    return {selector:sel(e),tag:e.tagName.toLowerCase(),rect:doc(v.r),right:round(Math.max(v.boxRight,v.text.right)),by:why,
      width:s.width,minWidth:s.minWidth,maxWidth:s.maxWidth,whiteSpace:s.whiteSpace,overflowWrap:s.overflowWrap,
      ...(e.getAttribute('width')?{widthAttribute:e.getAttribute('width')}:{}),
      ...(e.tagName==='IMG'?{naturalWidth:e.naturalWidth}:{})};
  };
  function round(n){return Math.round(n*100)/100;}

  // R1: deepest offenders.
  const scrollWidth=document.documentElement.scrollWidth;
  const offending=new Set();
  for(const [e,v] of info){
    if(scrollerX(e))continue;
    const c=clipper(e,'x');if(c&&c.mode==='hidden')continue; // clipped, not overflowing the page; see R2
    if(v.boxRight>vw+1||v.text.right>vw+1)offending.add(e);
  }
  const offenders=[];
  for(const e of offending){
    if([...offending].some(o=>o!==e&&e.contains(o)))continue;
    const v=info.get(e);
    offenders.push(describe(e,v,v.boxRight>vw+1?'box':'text'));
    if(offenders.length>=maxReports)break;
  }

  // R2: outermost clipped element under each overflow:hidden ancestor.
  const clippedSet=new Map();
  for(const [e,v] of info){
    if(v.r.width<=2&&v.r.height<=2)continue; // visually-hidden helpers
    for(const axis of ['x','y']){
      const c=clipper(e,axis);if(!c||c.mode!=='hidden')continue;
      if(c.el===document.body)continue;
      const cr=c.el.getBoundingClientRect();
      const s=st(c.el);
      const inner={left:cr.left+c.el.clientLeft,top:cr.top+c.el.clientTop,right:cr.left+c.el.clientLeft+c.el.clientWidth,bottom:cr.top+c.el.clientTop+c.el.clientHeight};
      if(cr.width<=2||cr.height<=2)continue;
      const tr=v.text.rect;
      const over=axis==='x'
        ?Math.max(inner.left-v.r.left,v.r.right-inner.right,tr?inner.left-tr.left:0,tr?tr.right-inner.right:0)
        :Math.max(inner.top-v.r.top,v.r.bottom-inner.bottom,tr?inner.top-tr.top:0,tr?tr.bottom-inner.bottom:0);
      if(over>1){clippedSet.set(e,{clipper:c.el,axis,over,overflow:s[axis==='x'?'overflowX':'overflowY']});break;}
    }
  }
  const clipped=[];
  for(const [e,c] of clippedSet){
    // Outermost: skip e when an ancestor below the same clipper is also clipped.
    let skip=false;for(let p=e.parentElement;p&&p!==c.clipper;p=p.parentElement)if(clippedSet.get(p)?.clipper===c.clipper){skip=true;break;}
    if(skip)continue;
    clipped.push({...describe(e,info.get(e),'clip'),clipper:sel(c.clipper),clipperRect:doc(c.clipper.getBoundingClientRect()),axis:c.axis,clippedBy:round(c.over),overflow:c.overflow,
      textOverflow:st(e).textOverflow});
    if(clipped.length>=maxReports)break;
  }
  return {schemaVersion:1,viewport:{width:innerWidth,height:innerHeight},url:location.origin+location.pathname,scrollWidth,innerWidth:vw,offenders,clipped};
}

export function analyze(collected,ctx={}) {
  const {scrollWidth,innerWidth}=collected;
  const findings=[];
  const overflow=scrollWidth>innerWidth+1;
  if(overflow){
    for(const o of collected.offenders)findings.push({id:`UI01-R1-${slug(o.selector)}`,status:'fail',severity:'high',selector:o.selector,rect:o.rect,
      message:`At ${innerWidth}px wide, ${o.by==='text'?'the text in this element':'this element'} reaches ${round(o.right,0)}px and pushes the page sideways (the page is ${scrollWidth}px wide).`,
      measurements:{rule:'R1',innerWidth,scrollWidth,right:o.right,by:o.by,width:o.width,minWidth:o.minWidth,maxWidth:o.maxWidth,whiteSpace:o.whiteSpace,overflowWrap:o.overflowWrap,
        ...(o.widthAttribute?{widthAttribute:o.widthAttribute}:{}),...(o.naturalWidth!==undefined?{naturalWidth:o.naturalWidth}:{})}});
    if(!collected.offenders.length)findings.push({id:'UI01-R1-page',status:'fail',severity:'high',selector:'html',rect:{x:0,y:0,width:scrollWidth,height:collected.viewport.height},
      message:`At ${innerWidth}px wide the page is ${scrollWidth}px wide, but no single visible element was found past the edge (pseudo-elements, shadows or fixed elements may cause it).`,
      measurements:{rule:'R1',innerWidth,scrollWidth}});
  }
  for(const c of collected.clipped)findings.push({id:`UI01-R2-${slug(c.selector)}`,status:'review',severity:'medium',selector:c.selector,rect:c.rect,
    message:`At ${innerWidth}px wide, ${round(c.clippedBy,0)}px of this element is cut off by ${c.clipper}${c.textOverflow==='ellipsis'?' (it ends in an ellipsis, which may be intended)':''}.`,
    measurements:{rule:'R2',innerWidth,clipper:c.clipper,axis:c.axis,clippedBy:c.clippedBy,overflow:c.overflow,width:c.width,minWidth:c.minWidth,textOverflow:c.textOverflow}});
  return {checkId:meta.id,findings,summary:{innerWidth,scrollWidth,overflows:overflow,offenders:overflow?collected.offenders.length:0,clipped:collected.clipped.length,
    fail:findings.filter(f=>f.status==='fail').length,review:findings.filter(f=>f.status==='review').length}};
}
