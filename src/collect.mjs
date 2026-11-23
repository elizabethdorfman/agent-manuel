/** Read-only DOM collector. Its source can also run in an existing browser harness. */
export function collectEvidence(options = {}) {
  const maxElements = options.maxElements ?? 6000;
  const maxTextRuns = options.maxTextRuns ?? 12000;
  const maxHeight = options.maxHeight ?? 12000;
  const fullPage = options.fullPage !== false;
  const viewport = { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio };
  const capture = { x: scrollX, y: fullPage ? 0 : scrollY, width: innerWidth,
    height: fullPage ? Math.min(Math.max(document.documentElement.scrollHeight, innerHeight), maxHeight) : innerHeight };
  const elements = [], textRuns = [], groups = [], warnings = [];
  const ids = new Map(), groupIds = new Map();
  const all = [...document.body.querySelectorAll('*')];
  const groupSelector = '[data-qa-align-group], form, section, article, fieldset, figure, main, header, nav, aside, [role="dialog"]';
  const rect = r => ({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height });
  const intersect = (a,b) => {
    const x = Math.max(a.x,b.x), y = Math.max(a.y,b.y);
    return { x, y, width: Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x), height: Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y) };
  };
  const selector = e => {
    if (e===document.body) return 'body';
    if (e.id) return '#' + CSS.escape(e.id);
    const parts = [];
    for (let p = e; p && p !== document.body; p = p.parentElement) {
      const n = [...p.parentElement.children].filter(s => s.tagName === p.tagName).indexOf(p)+1;
      parts.unshift(p.tagName.toLowerCase() + ':nth-of-type(' + n + ')');
    }
    return 'body > ' + parts.join(' > ');
  };
  const visibility = (e, initial) => {
    let visible = intersect(initial, capture);
    let opacity = 1;
    for (let p=e; p; p=p.parentElement) {
      const s=getComputedStyle(p);
      if (s.display==='none' || s.visibility==='hidden' || s.visibility==='collapse') return null;
      opacity *= Number(s.opacity);
      if (!opacity) return null;
      if (/^rect\(0(?:px)?,?\s*0(?:px)?,?\s*0(?:px)?,?\s*0(?:px)?\)$/.test(s.clip.replaceAll(' ',''))) return null;
      if (p!==e && p!==document.body && p!==document.documentElement) {
        const pr=rect(p.getBoundingClientRect());
        const clipX=/(hidden|clip|auto|scroll)/.test(s.overflowX);
        const clipY=/(hidden|clip|auto|scroll)/.test(s.overflowY);
        if (clipX || clipY) visible=intersect(visible,{
          x:clipX ? pr.x+p.clientLeft : capture.x,
          y:clipY ? pr.y+p.clientTop : capture.y,
          width:clipX ? p.clientWidth : capture.width,
          height:clipY ? p.clientHeight : capture.height
        });
      }
    }
    return visible.width>0 && visible.height>0 ? visible : null;
  };
  function group(e) {
    const g=e.parentElement?.closest(groupSelector) ?? document.body;
    if (!groupIds.has(g)) {
      const id='g'+String(groups.length+1).padStart(3,'0'); groupIds.set(g,id);
      groups.push({ id, selector:selector(g), rect:rect(g.getBoundingClientRect()) });
    }
    return groupIds.get(g);
  }
  function add(e,kind) {
    if (ids.has(e)) return ids.get(e);
    if (elements.length>=maxElements) return null;
    const box=rect(e.getBoundingClientRect()), visibleRect=visibility(e,box);
    if (!visibleRect) return null;
    const s=getComputedStyle(e), id='e'+String(elements.length+1).padStart(4,'0'); ids.set(e,id);
    const label=e.getAttribute('aria-label') ?? e.getAttribute('alt') ?? e.getAttribute('placeholder') ?? '';
    elements.push({ id,kind,tag:e.tagName.toLowerCase(),selector:selector(e),groupId:group(e),rect:box,visibleRect,
      label:label.slice(0,240),display:s.display,parentId:null,
      style:{ fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,
        textAlign:s.textAlign,color:s.color,backgroundColor:s.backgroundColor,transform:s.transform },
      ...(e.tagName==='IMG'?{ image:{loaded:e.complete&&e.naturalWidth>0,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight} }:{}),
      clipped:visibleRect.width+0.5<box.width || visibleRect.height+0.5<box.height,
      masked:s.clipPath!=='none' || s.maskImage!=='none'
    });
    return id;
  }
  const ruleMatches={};
  for (const rule of options.rules ?? []) {
    ruleMatches[rule.id]=[];
    for (const sel of rule.selectors ?? []) {
      try { ruleMatches[rule.id].push({ selector:sel,ids:[...document.querySelectorAll(sel)].map(e=>add(e,'rule-target')).filter(Boolean) }); }
      catch { ruleMatches[rule.id].push({selector:sel,ids:[],error:'Invalid CSS selector.'}); }
    }
  }
  for (const e of all) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|OPTION|TEMPLATE)$/.test(e.tagName)) continue;
    let kind=null;
    if (/^H[1-6]$/.test(e.tagName) || e.getAttribute('role')==='heading') kind='heading';
    else if (e.tagName==='IMG' || e.tagName==='VIDEO' || e.tagName==='CANVAS') kind='image';
    else if (e.tagName==='svg' && e.parentElement?.closest('svg')===null) kind='image';
    else if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.tagName) || /^(button|textbox)$/.test(e.getAttribute('role')??'')) kind='control';
    else if (/^(P|LABEL|LI|SUMMARY|FIGCAPTION|A)$/.test(e.tagName)) kind='text';
    else if (getComputedStyle(e).backgroundImage!=='none') kind='background-image';
    if (kind) {
      const id=add(e,kind);
      if (id && kind!=='rule-target') elements.find(x=>x.id===id).kind=kind;
    }
  }
  function* textNodes(root) {
    for (const child of root.childNodes ?? []) {
      if (child.nodeType===3) yield child;
      else if (child.nodeType===1) yield* textNodes(child);
    }
  }
  for (const node of textNodes(document.body)) {
    if (textRuns.length>=maxTextRuns) { warnings.push('Text inventory reached its configured limit.');break; }
    const e=node.parentElement;
    if (!e || e.closest('script,style,noscript,textarea,option,[contenteditable]:not([contenteditable="false"])') || !node.textContent.trim()) continue;
    // Form field values and editable content are deliberately not read.
    const range=document.createRange();range.selectNodeContents(node);
    const boxes=[...range.getClientRects()].map(rect).map(b=>({rect:b,visibleRect:visibility(e,b)})).filter(b=>b.visibleRect);
    if (!boxes.length) continue;
    const ownerId=add(e,'text');
    if (!ownerId) continue;
    const s=getComputedStyle(e);
    textRuns.push({id:'t'+String(textRuns.length+1).padStart(4,'0'),ownerId,
      text:node.textContent.trim().slice(0,1000),rects:boxes,
      style:{fontSize:s.fontSize,fontFamily:s.fontFamily,fontWeight:s.fontWeight,color:s.color}});
  }
  for (const [node,id] of ids) {
    const item=elements.find(e=>e.id===id);
    for(let p=node.parentElement;p;p=p.parentElement) if(ids.has(p)) {item.parentId=ids.get(p);break;}
  }
  if(elements.length>=maxElements) warnings.push('Element inventory reached its configured limit.');
  if(fullPage && document.documentElement.scrollHeight>maxHeight) warnings.push('Page height exceeded the capture limit.');
  if(document.documentElement.scrollWidth>innerWidth) warnings.push('The document is wider than the viewport; the capture shows only its current horizontal window.');
  warnings.push('DOM geometry is evidence, not proof of intended alignment. Transforms, masks, optical alignment and artwork need visual review.');
  warnings.push('Only rendered DOM text and media boxes are inventoried. Text inside images, canvas, pseudo-elements, shadow roots and cross-origin frames needs a separate collector. Lazy or virtualized content may not be loaded.');
  return {schemaVersion:1,capturedAt:new Date().toISOString(),page:{title:document.title,url:location.origin+location.pathname},viewport,capture,elements,textRuns,groups,ruleMatches,warnings};
}
