/**
 * UI09 hierarchy: ranks every visible text element and button by visual weight,
 * then checks that the ranking agrees with the heading structure.
 *
 * weight = fontSize × weightFactor × contrastFactor × fillFactor
 *   weightFactor   <500 → 1, 500 → 1.1, 600 → 1.25, 700+ → 1.4
 *   contrastFactor 0.6 + 0.6 × |L(fg) − L(bg)|  (WCAG relative luminance, so 0.6–1.2)
 *                  For a filled button, fg is its fill and bg is the surface behind it.
 *   fillFactor     filled button 1.6, outlined button 1.15, anything else 1
 *
 * ctx.config = { titleSelector?: string }
 */
import {slug,round,median,weightedMedian,parseColor,luminance,blend} from '../_lib/c-util.mjs';

export const meta={id:'UI09',name:'hierarchy',title:'The most important thing looks most important.'};
export const variants=[];

/** Runs in the page. Self-contained and read-only. */
export function collect(options={}) {
  const maxItems=options.maxItems??3000;
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
  const docRect=r=>({x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height});
  const shown=e=>{
    for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}
    return true;
  };
  const transparent=c=>!c||c==='transparent'||/rgba\([^)]*,\s*0\)$/.test(c)||/\/\s*0\)$/.test(c);
  // The colour behind an element: the first ancestor (excluding the element itself) with a non-transparent background.
  const behind=e=>{
    for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p).backgroundColor;if(!transparent(c))return c;}
    return 'rgb(255, 255, 255)';
  };
  const ownBg=e=>{for(let p=e;p;p=p.parentElement){const c=getComputedStyle(p).backgroundColor;if(!transparent(c))return c;}return 'rgb(255, 255, 255)';};
  const BUTTON='button,input[type=submit],input[type=button],input[type=reset],[role=button]';
  const LINK='a[href],[role=link]';
  const isButtonLike=e=>{
    if(e.matches(BUTTON))return true;
    if(e.matches(LINK)){const s=getComputedStyle(e);return !transparent(s.backgroundColor)||parseFloat(s.borderTopWidth)>0&&parseFloat(s.borderBottomWidth)>0;}
    return false;
  };
  const fillOf=e=>{
    const s=getComputedStyle(e);
    if(!transparent(s.backgroundColor)&&s.backgroundColor!==behind(e))return 'filled';
    const borders=['Top','Right','Bottom','Left'].filter(k=>parseFloat(s['border'+k+'Width'])>0&&s['border'+k+'Style']!=='none'&&!transparent(s['border'+k+'Color']));
    if(borders.length>=4)return 'outlined';
    return 'none';
  };
  const headingLevel=e=>{
    if(/^H[1-6]$/.test(e.tagName))return Number(e.tagName[1]);
    if(e.getAttribute('role')==='heading')return Number(e.getAttribute('aria-level')??2);
    return 0;
  };
  const ownText=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,' ').trim();
  const lineCount=e=>{
    const range=document.createRange();range.selectNodeContents(e);
    const tops=[];
    for(const r of range.getClientRects()){if(r.width<1||r.height<1)continue;if(!tops.some(t=>Math.abs(t-r.top)<r.height/2))tops.push(r.top);}
    return tops.length;
  };
  const isBlock=d=>!/^inline/.test(d)&&d!=='contents';
  // "A block on its own": the nearest block-level box (self or ancestor) holds no other text.
  const standalone=e=>{
    let b=e;while(b&&b!==document.body&&!isBlock(getComputedStyle(b).display))b=b.parentElement;
    if(!b)return false;
    return (b.textContent??'').replace(/\s+/g,' ').trim()===(e.textContent??'').replace(/\s+/g,' ').trim();
  };
  const isSurface=e=>{
    if(e===document.body)return true;
    const s=getComputedStyle(e);
    if(!transparent(s.backgroundColor)&&s.backgroundColor!==behind(e))return true;
    return ['Top','Right','Bottom','Left'].every(k=>parseFloat(s['border'+k+'Width'])>0&&s['border'+k+'Style']!=='none');
  };

  const items=[];const seen=new Set();
  const push=(e,kind)=>{
    if(seen.has(e)||items.length>=maxItems)return;seen.add(e);
    const r=e.getBoundingClientRect();
    const level=headingLevel(e);
    const srOnly=r.width<=2||r.height<=2;
    if(!shown(e)||(!level&&(r.width<1||r.height<1)))return;
    const s=getComputedStyle(e);
    const fill=kind==='button'?fillOf(e):'none';
    items.push({
      selector:sel(e),tag:e.tagName.toLowerCase(),kind:level?'heading':kind,level,rect:docRect(r),srOnly,
      text:(kind==='button'?(e.innerText||e.value||e.getAttribute('aria-label')||''):(level?e.textContent:ownText(e))).replace(/\s+/g,' ').trim().slice(0,160),
      chars:(level?e.textContent:ownText(e)).replace(/\s+/g,' ').trim().length,
      fontSize:parseFloat(s.fontSize),fontWeight:Number(s.fontWeight)||400,
      color:s.color,background:fill==='filled'?s.backgroundColor:ownBg(e),behind:behind(e),fill,
      lines:lineCount(e),display:s.display,standalone:standalone(e),
      inControl:!!e.parentElement?.closest(BUTTON+','+LINK+',label,legend,th,dt,summary,caption,select,option'),
      isLabelish:/^(LABEL|LEGEND|TH|DT|SUMMARY|CAPTION|FIGCAPTION|OPTION)$/.test(e.tagName)||e.matches(LINK),
    });
  };
  const all=[...document.body.querySelectorAll('*')];
  const buttons=new Set();
  const insideButton=e=>{for(let p=e.parentElement;p;p=p.parentElement)if(buttons.has(p))return true;return false;};
  for(const e of all){
    if(/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|svg)$/.test(e.tagName))continue;
    if(insideButton(e))continue; // Text inside a button is part of the button.
    if(isButtonLike(e)){buttons.add(e);push(e,'button');continue;}
    if(headingLevel(e)){push(e,'heading');continue;}
    if(ownText(e))push(e,'text');
  }
  // Gaps around each heading, measured to the nearest content inside the same surface (card, panel or body).
  const CONTENT='img,svg,video,canvas,input,select,textarea,button,hr,iframe,[role=img]';
  for(const it of items){
    if(it.kind!=='heading'||it.srOnly)continue;
    const h=document.querySelector(it.selector);if(!h)continue;
    let surface=h.parentElement;while(surface&&!isSurface(surface))surface=surface.parentElement;
    surface??=document.body;
    const hr=h.getBoundingClientRect();
    let above=null,below=null;
    for(const c of surface.querySelectorAll('*')){
      if(c===h||c.contains(h)||h.contains(c))continue;
      if(!(c.matches(CONTENT)||isSurface(c)||ownText(c)))continue;
      const r=c.getBoundingClientRect();
      if(r.width<1||r.height<1||r.right<=hr.left||r.left>=hr.right||!shown(c))continue;
      if(r.bottom<=hr.top+1){const g=hr.top-r.bottom;if(above===null||g<above)above=g;}
      else if(r.top>=hr.bottom-1){const g=r.top-hr.bottom;if(below===null||g<below)below=g;}
    }
    it.gapAbove=above;it.gapBelow=below;it.surface=sel(surface);
  }
  let titleMatches=null;
  if(options.titleSelector){try{titleMatches=[...document.querySelectorAll(options.titleSelector)].map(sel);}catch{titleMatches=[];}}
  return {schemaVersion:1,viewport:{width:innerWidth,height:innerHeight},url:location.origin+location.pathname,items,titleMatches,truncated:items.length>=maxItems};
}

export const weightFactor=w=>w>=700?1.4:w>=600?1.25:w>=500?1.1:1;
export const FILL={filled:1.6,outlined:1.15,none:1};

/** contrastFactor for an item, from its collected colours. */
export function contrastFactor(it) {
  const page=blend(parseColor(it.behind),{r:255,g:255,b:255,a:1});
  const bg=blend(parseColor(it.background),page);
  // A filled button's weight comes mostly from its fill against the surface behind it.
  const fg=it.fill==='filled'?bg:blend(parseColor(it.color),bg);
  const against=it.fill==='filled'?page:bg;
  return 0.6+0.6*Math.abs(luminance(fg)-luminance(against));
}

/** A fill that reads as a primary action: not transparent, white or grey. */
export function isColouredFill(css) {
  const c=parseColor(css);if(c.a<0.5)return false;
  const max=Math.max(c.r,c.g,c.b)/255,min=Math.min(c.r,c.g,c.b)/255,l=(max+min)/2;
  const sat=max===min?0:(max-min)/(1-Math.abs(2*l-1));
  if(l>0.94)return false;                 // white / near white
  if(sat<0.12&&l>0.25)return false;       // grey (near-black still counts as a strong fill)
  return true;
}

export function analyze(collected,ctx={}) {
  const config=ctx.config??{};
  const items=collected.items.map(it=>{
    const cf=contrastFactor(it);
    return {...it,contrastFactor:cf,weight:it.fontSize*weightFactor(it.fontWeight)*cf*FILL[it.fill]};
  });
  const visible=items.filter(i=>!i.srOnly);
  const ranked=[...visible].sort((a,b)=>b.weight-a.weight);
  const ranking=ranked.map((i,k)=>({rank:k+1,selector:i.selector,rect:i.rect,weight:round(i.weight),fontSize:i.fontSize,fontWeight:i.fontWeight,
    fill:i.fill,contrastFactor:round(i.contrastFactor,3),kind:i.kind,level:i.level||undefined,text:i.text}));
  const rankOf=new Map(ranking.map(r=>[r.selector,r.rank]));
  const body=visible.filter(i=>i.kind==='text'&&!i.inControl&&!i.isLabelish);
  const bodyWeight=weightedMedian(body.map(i=>({value:i.weight,weight:i.chars})));
  const bodySize=weightedMedian(body.map(i=>({value:i.fontSize,weight:i.chars})));
  const headings=items.filter(i=>i.kind==='heading');
  const shownHeadings=headings.filter(i=>!i.srOnly);
  const findings=[];
  const add=(rule,status,severity,it,message,m={})=>findings.push({id:`UI09-${rule}-${slug(it.selector)}`,status,severity,selector:it.selector,rect:it.rect,message,
    measurements:{rule,weight:round(it.weight),rank:rankOf.get(it.selector),fontSize:it.fontSize,fontWeight:it.fontWeight,...m}});

  // H1: levels ranked. Compare each level with the next level present on the screen.
  const levels=[...new Set(shownHeadings.map(h=>h.level))].sort((a,b)=>a-b);
  const byLevel=l=>shownHeadings.filter(h=>h.level===l);
  const h1Fails=new Set();
  for(let k=0;k+1<levels.length;k++){
    const upper=byLevel(levels[k]),lower=byLevel(levels[k+1]);
    const weakest=upper.reduce((a,b)=>b.weight<a.weight?b:a);
    for(const h of lower){
      if(h.weight>=weakest.weight){
        h1Fails.add(h.selector);
        add('H1','fail','high',h,`This h${h.level} looks as heavy as or heavier than the h${weakest.level} "${weakest.text}", so the section order is visually upside down.`,
          {level:h.level,comparedWith:weakest.selector,comparedLevel:weakest.level,comparedWeight:round(weakest.weight),ratio:round(weakest.weight/h.weight,3)});
      } else if(weakest.weight/h.weight<1.15){
        // H2: steps distinguishable.
        add('H2','review','low',h,`This h${h.level} is only ${round((weakest.weight/h.weight-1)*100,0)}% lighter than the h${weakest.level} "${weakest.text}"; the two levels may be hard to tell apart.`,
          {level:h.level,comparedWith:weakest.selector,comparedLevel:weakest.level,comparedWeight:round(weakest.weight),ratio:round(weakest.weight/h.weight,3),minimumRatio:1.15});
      }
    }
  }
  for(const h of shownHeadings){
    if(bodyWeight&&h.weight<=bodyWeight&&!h1Fails.has(h.selector))
      add('H1','fail','high',h,`This heading carries no more visual weight than the body text around it, so it does not read as a heading.`,{level:h.level,bodyWeight:round(bodyWeight)});
  }

  // H3: title dominates. Filled buttons may outrank the title.
  const titleSet=new Set(collected.titleMatches??headings.filter(h=>h.level===1).map(h=>h.selector));
  // Only when the title is visible: a visually hidden h1 is a deliberate structural title.
  if(ranked.some(i=>titleSet.has(i.selector))){
    const top=ranked.find(i=>i.fill!=='filled');
    if(top&&!titleSet.has(top.selector)){
      const title=ranked.find(i=>titleSet.has(i.selector));
      add('H3','review','medium',top,`"${top.text}" outweighs the page title${title?` "${title.text}"`:''}, so it is the first thing the eye lands on.`,
        {titleSelector:title?.selector,titleWeight:title?round(title.weight):undefined,titleRank:title?rankOf.get(title.selector):undefined});
    }
  }

  // H4: fake headings.
  for(const i of visible){
    if(i.kind!=='text'||i.inControl||i.isLabelish||i.lines!==1||!i.standalone)continue;
    const big=bodySize&&i.fontSize>=1.25*bodySize, bold=i.fontWeight>=700;
    if(big||bold)add('H4','review','low',i,`"${i.text}" looks like a heading (${big?'large':'bold'}, on its own line) but is not marked up as one, so screen readers and the outline skip it.`,
      {bodyFontSize:bodySize,lines:i.lines,tag:i.tag});
  }

  // H5: structure.
  const h1s=headings.filter(h=>h.level===1);
  if(h1s.length===0)findings.push({id:'UI09-H5-no-h1',status:'fail',severity:'medium',selector:'body',
    rect:{x:0,y:0,width:collected.viewport.width,height:collected.viewport.height},message:'This screen has no h1, so it has no announced title.',measurements:{rule:'H5',h1Count:0}});
  for(const h of h1s.slice(1))add('H5','fail','medium',h,`This screen has ${h1s.length} h1 headings; there should be exactly one.`,{h1Count:h1s.length,level:1});
  let prev=1;
  for(const h of headings){ // collect() returns items in document order.
    if(h.level>prev+1)add('H5','fail','medium',h,`This h${h.level} skips a level (the previous heading is h${prev}).`,{level:h.level,previousLevel:prev});
    prev=h.level;
  }

  // H6: one primary.
  const coloured=visible.filter(i=>i.kind==='button'&&i.fill==='filled'&&isColouredFill(i.background));
  if(coloured.length>=2){
    const top=coloured.reduce((a,b)=>b.weight>a.weight?b:a);
    const same=coloured.filter(i=>i.background===top.background);
    if(same.length>=2)for(const i of same)add('H6','review','medium',i,`${same.length} buttons share the strongest filled style, so none of them clearly reads as the main action.`,
      {background:i.background,competing:same.map(s=>s.selector)});
  }

  // H7: proximity. A heading should sit closer to what it introduces than to what came before.
  for(const h of shownHeadings){
    if(h.gapAbove==null||h.gapBelow==null)continue;
    if(h.gapAbove<=h.gapBelow)add('H7','review','low',h,`This heading is ${round(h.gapAbove,0)}px from the content above and ${round(h.gapBelow,0)}px from the content below, so it does not clearly belong to its section.`,
      {gapAbove:round(h.gapAbove),gapBelow:round(h.gapBelow)});
  }

  return {checkId:meta.id,findings,
    summary:{items:visible.length,headings:headings.length,bodyWeight:round(bodyWeight),bodyFontSize:bodySize,
      fail:findings.filter(f=>f.status==='fail').length,review:findings.filter(f=>f.status==='review').length,ranking}};
}
