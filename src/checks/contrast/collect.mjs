/**
 * UI03 in-page collector. Self-contained: no imports or closures (serialized with toString()).
 * Read-only. For each visible text run it records the computed text colour (resolved to sRGB
 * through a detached canvas, so any CSS colour syntax works), the cumulative opacity, the
 * text's line boxes and the box its background comes from. Pixels are read later, in Node,
 * from the screenshot.
 */
export function collectContrast(options = {}) {
  const maxRuns = options.maxRuns ?? 4000;
  const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
  const capture = { x: 0, y: 0, width: innerWidth, height: Math.max(document.documentElement.scrollHeight, innerHeight) };
  const docRect = r => ({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height });
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
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = css => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = '#000'; g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return d[3] ? [Math.round(d[0] * 255 / d[3]), Math.round(d[1] * 255 / d[3]), Math.round(d[2] * 255 / d[3]), Math.round(d[3] / 255 * 1000) / 1000] : [0, 0, 0, 0];
  };
  // Returns null when hidden, otherwise the product of ancestor opacities.
  const opacityOf = e => {
    let opacity = 1;
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return null;
      opacity *= Number(s.opacity);
      if (opacity < 0.01) return null;
      if (/^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(s.clip.replaceAll(' ', ''))) return null;
      if (/(hidden|clip)/.test(s.overflow) && (p.offsetWidth <= 2 || p.offsetHeight <= 2) && s.display !== 'inline') return null;
    }
    return opacity;
  };
  const bgBox = e => {
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display !== 'inline' && p.getBoundingClientRect().width > 0) return p;
    }
    return document.body;
  };
  // Everything inside a background block that is not background: text line boxes, images, controls.
  const occupiedCache = new Map();
  const occupiedIn = box => {
    if (occupiedCache.has(box)) return occupiedCache.get(box);
    const out = [];
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n && out.length < 600; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        for (const q of r.getClientRects()) if (q.width > 0 && q.height > 0) out.push(docRect(q));
      } else if (/^(IMG|SVG|svg|VIDEO|CANVAS|PICTURE|IFRAME|INPUT|TEXTAREA|SELECT|BUTTON)$/.test(n.tagName)) {
        const q = n.getBoundingClientRect(); if (q.width > 0 && q.height > 0) out.push(docRect(q));
      }
    }
    occupiedCache.set(box, out);
    return out;
  };
  const CONTROL = 'input, textarea, select';
  const TEXT_INPUT = /^(text|email|password|search|tel|url|number|date|datetime-local|month|time|week|)$/;
  const runs = [], skipped = [];
  for (const e of document.body.querySelectorAll('*')) {
    if (runs.length >= maxRuns) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|OPTGROUP)$/.test(e.tagName) || e.closest('svg')) continue;
    const isControl = e.matches(CONTROL);
    if (isControl && e.tagName === 'INPUT' && !TEXT_INPUT.test((e.getAttribute('type') || '').toLowerCase())) continue;
    const direct = isControl ? [] : [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!isControl && !direct.length) continue;
    const sel = selector(e);
    const opacity = opacityOf(e);
    if (opacity === null) { skipped.push({ selector: sel, reason: 'hidden' }); continue; }
    const disabledControl = e.closest(':disabled, [aria-disabled="true"], [inert]');
    if (disabledControl) { skipped.push({ selector: sel, reason: 'disabled' }); continue; }
    const s = getComputedStyle(e);
    let text, color, rects;
    if (isControl) {
      const usePlaceholder = !e.value && e.getAttribute('placeholder');
      text = e.value || e.getAttribute('placeholder') || '';
      if (!text.trim()) { skipped.push({ selector: sel, reason: 'empty' }); continue; }
      color = rgba(usePlaceholder ? getComputedStyle(e, '::placeholder').color : (s.webkitTextFillColor || s.color));
      const b = e.getBoundingClientRect();
      const pl = parseFloat(s.paddingLeft) + e.clientLeft, pt = parseFloat(s.paddingTop) + e.clientTop;
      const pr = parseFloat(s.paddingRight) + (b.width - e.clientWidth - e.clientLeft), pb = parseFloat(s.paddingBottom) + (b.height - e.clientHeight - e.clientTop);
      rects = [{ left: b.left + pl, top: b.top + pt, width: Math.max(0, b.width - pl - pr), height: Math.max(0, b.height - pt - pb) }];
    } else {
      text = direct.map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
      color = rgba(s.webkitTextFillColor || s.color);
      rects = direct.flatMap(n => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()]; });
    }
    rects = rects.filter(r => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) { skipped.push({ selector: sel, reason: 'no-box' }); continue; }
    if (color[3] < 0.01) { skipped.push({ selector: sel, reason: /text/.test(s.backgroundClip + s.webkitBackgroundClip) ? 'gradient-text' : 'transparent-text' }); continue; }
    const box = bgBox(e), bb = box.getBoundingClientRect();
    const own = rects.map(docRect), around = { x: Math.min(...own.map(r => r.x)) - 4, y: Math.min(...own.map(r => r.y)) - 4 };
    around.right = Math.max(...own.map(r => r.x + r.width)) + 4; around.bottom = Math.max(...own.map(r => r.y + r.height)) + 4;
    const occupied = (box === e && isControl) ? [] : occupiedIn(box).filter(r => r.x < around.right && r.x + r.width > around.x && r.y < around.bottom && r.y + r.height > around.y && !(isControl && r.x <= own[0].x && r.y <= own[0].y && r.x + r.width >= own[0].x + own[0].width && r.y + r.height >= own[0].y + own[0].height));
    runs.push({
      selector: sel, tag: e.tagName.toLowerCase(), kind: isControl ? 'control' : 'text', text: text.slice(0, 80),
      rect: docRect(e.getBoundingClientRect()), textRects: own, occupied, backgroundBox: docRect(bb),
      color, opacity: Math.round(opacity * 1000) / 1000,
      fontSize: parseFloat(s.fontSize), fontWeight: Number(s.fontWeight) || (s.fontWeight === 'bold' ? 700 : 400),
      textShadow: s.textShadow !== 'none' ? s.textShadow : null
    });
  }
  return { viewport, capture, runs, skipped };
}
