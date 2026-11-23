/**
 * TY01 in-page collector. Self-contained: no imports or closures, because the runner
 * serializes it with fn.toString() and evaluates it through CDP Runtime.evaluate.
 * Read-only: it measures layout and computed styles and changes nothing.
 */
export function collectTypography(options = {}) {
  const maxRuns = options.maxRuns ?? 4000;
  const maxClipCandidates = options.maxClipCandidates ?? 4000;
  const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
  const textScale = Number(window.__agentManuelTextScale) || 1;
  const docRect = r => ({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height });
  const round = v => Math.round(v * 100) / 100;
  const selector = e => {
    if (e === document.body) return 'body';
    if (e.id) return '#' + CSS.escape(e.id);
    const parts = [];
    for (let p = e; p && p !== document.body && p.parentElement; p = p.parentElement) {
      if (p.id) { parts.unshift('#' + CSS.escape(p.id)); return parts.join(' > '); }
      const n = [...p.parentElement.children].filter(s => s.tagName === p.tagName).indexOf(p) + 1;
      parts.unshift(p.tagName.toLowerCase() + ':nth-of-type(' + n + ')');
    }
    return 'body > ' + parts.join(' > ');
  };
  const hiddenCache = new Map();
  // True when the element or an ancestor hides it: display, visibility, opacity 0,
  // a zero clip rect, or a 1px "visually hidden" box.
  const hidden = e => {
    if (hiddenCache.has(e)) return hiddenCache.get(e);
    let out = false;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) out = true;
    else if (/^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(s.clip.replaceAll(' ', ''))) out = true;
    else if (/inset\(50%\)|inset\(100%\)/.test(s.clipPath)) out = true;
    else if (/(hidden|clip)/.test(s.overflow) && (e.offsetWidth <= 2 || e.offsetHeight <= 2) && s.display !== 'inline') out = true;
    else if (e.parentElement && e.parentElement !== document.documentElement) out = hidden(e.parentElement);
    hiddenCache.set(e, out);
    return out;
  };
  const textRects = node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
  };
  const firstFamily = list => (list.split(',')[0] || '').trim().replace(/^["']|["']$/g, '');
  const CONTROL = 'input, textarea, select';
  const TEXT_INPUT = /^(text|email|password|search|tel|url|number|date|datetime-local|month|time|week|)$/;

  const runs = [], runIndex = new Map(), blocks = [], paragraphs = [], clips = [];
  const all = [...document.body.querySelectorAll('*')];
  for (const e of all) {
    if (runs.length >= maxRuns) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|OPTGROUP|svg|SVG)$/.test(e.tagName) || e.closest('svg')) continue;
    const isControl = e.matches(CONTROL);
    if (isControl && e.tagName === 'INPUT' && !TEXT_INPUT.test((e.getAttribute('type') || '').toLowerCase())) continue;
    const direct = isControl ? [] : [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!isControl && !direct.length) continue;
    if (hidden(e)) continue;
    const rects = isControl ? [e.getBoundingClientRect()] : direct.flatMap(textRects);
    if (!rects.length || rects.every(r => r.width === 0 || r.height === 0)) continue;
    const s = getComputedStyle(e);
    const text = isControl ? (e.value || e.getAttribute('placeholder') || '') : direct.map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const fontSize = parseFloat(s.fontSize);
    const heights = rects.map(r => r.height).sort((a, b) => a - b);
    runs.push({
      index: runs.length, selector: selector(e), tag: e.tagName.toLowerCase(), kind: isControl ? 'control' : 'text',
      rect: docRect(e.getBoundingClientRect()), text: text.slice(0, 80), chars: text.length,
      fontSize, fontWeight: Number(s.fontWeight) || (s.fontWeight === 'bold' ? 700 : 400),
      fontFamily: s.fontFamily, firstFamily: firstFamily(s.fontFamily),
      lineHeight: s.lineHeight === 'normal' ? null : parseFloat(s.lineHeight),
      measuredLineHeight: round(heights[Math.floor(heights.length / 2)]),
      parentRun: null,
    });
    runIndex.set(e, runs.length - 1);
  }
  // Nearest ancestor that is itself a run, so Node can subtract child glyphs from
  // CSS.getPlatformFontsForNode, which reports an element's whole subtree.
  for (const [e, i] of runIndex) {
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement)
      if (runIndex.has(p)) { runs[i].parentRun = runIndex.get(p); break; }
  }

  // Body text blocks: p, li and label elements with visible text.
  for (const e of document.body.querySelectorAll('p, li, label')) {
    if (!e.textContent.trim() || hidden(e)) continue;
    const s = getComputedStyle(e);
    const nodes = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim() && !hidden(n.parentElement)) nodes.push(n);
    const rects = nodes.flatMap(textRects);
    if (!rects.length) continue;
    // Group fragments into line boxes by vertical overlap.
    const lines = [];
    for (const r of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
      const mid = r.top + r.height / 2;
      const line = lines.find(l => mid >= l.top && mid <= l.bottom);
      if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
      else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    const fontSize = parseFloat(s.fontSize);
    const chars = e.textContent.replace(/\s+/g, ' ').trim().length;
    const heights = rects.map(r => r.height).sort((a, b) => a - b);
    const block = {
      selector: selector(e), tag: e.tagName.toLowerCase(), rect: docRect(e.getBoundingClientRect()),
      fontSize, lineHeight: s.lineHeight === 'normal' ? null : parseFloat(s.lineHeight),
      measuredLineHeight: round(heights[Math.floor(heights.length / 2)]), lines: lines.length, chars,
      maxLineWidth: round(Math.max(...lines.map(l => l.right - l.left))),
      totalLineWidth: round(lines.reduce((sum, l) => sum + l.right - l.left, 0)),
    };
    blocks.push(block);
    if (block.tag === 'p') paragraphs.push(block);
  }

  // Clipped text: hidden/clip overflow that cuts off text inside it.
  let checked = 0;
  for (const e of all) {
    if (checked >= maxClipCandidates) break;
    if (e.matches(CONTROL) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|SVG)$/.test(e.tagName)) continue;
    const s = getComputedStyle(e);
    const clipX = /^(hidden|clip)$/.test(s.overflowX), clipY = /^(hidden|clip)$/.test(s.overflowY);
    const clamp = parseInt(s.webkitLineClamp || s.lineClamp, 10) || 0;
    if (!clipX && !clipY && !clamp) continue;
    if (!e.textContent.trim() || hidden(e)) continue;
    checked++;
    const overX = e.scrollWidth > e.clientWidth + 1, overY = e.scrollHeight > e.clientHeight + 1;
    if (!((clipX || clamp) && overX) && !((clipY || clamp) && overY)) continue;
    // Confirm it is text (not a decorative child) that crosses the clip edge.
    const box = e.getBoundingClientRect();
    const inner = { left: box.left + e.clientLeft, top: box.top + e.clientTop, right: box.left + e.clientLeft + e.clientWidth, bottom: box.top + e.clientTop + e.clientHeight };
    let beyondX = 0, beyondY = 0;
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      for (const r of textRects(n)) {
        beyondX = Math.max(beyondX, r.right - inner.right, inner.left - r.left);
        beyondY = Math.max(beyondY, r.bottom - inner.bottom, inner.top - r.top);
      }
    }
    const cutX = (clipX || clamp > 0) && overX && beyondX > 1;
    const cutY = (clipY || clamp > 0) && overY && beyondY > 1;
    if (!cutX && !cutY) continue;
    clips.push({
      selector: selector(e), tag: e.tagName.toLowerCase(), rect: docRect(box), text: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
      reason: clamp ? 'line-clamp' : (s.textOverflow === 'ellipsis' && cutX ? 'ellipsis' : 'overflow'),
      axis: cutX && cutY ? 'both' : cutX ? 'x' : 'y',
      scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight,
      overflowX: s.overflowX, overflowY: s.overflowY, textOverflow: s.textOverflow, lineClamp: clamp || null,
      beyondX: round(Math.max(0, beyondX)), beyondY: round(Math.max(0, beyondY)),
    });
  }

  const fontFaces = [];
  try { for (const f of document.fonts) fontFaces.push({ family: f.family.replace(/^["']|["']$/g, ''), status: f.status, weight: f.weight, style: f.style }); } catch {}
  return { viewport, textScale, runs, blocks, paragraphs, clips, fontFaces };
}
