/**
 * RD01 in-page collectors.
 *
 * collectLayout() is new: it finds text that runs off the screen or out of its own box (R3)
 * and text whose centre is painted over by another element (R4). Self-contained and read-only.
 *
 * collectReadability is assembled from the SOURCE of three self-contained collectors
 * (contrast's, typography's and collectLayout), so the contrast and clipping logic is reused
 * as is, and the result is still one self-contained function the runner can serialize with
 * toString(). On the 200% text-scale pass (window.__agentManuelTextScale > 1) only the
 * clipping collector runs.
 */
import {collectContrast} from '../contrast/collect.mjs';
import {collectTypography} from '../typography/collect.mjs';

export function collectLayout(options = {}) {
  const maxRuns = options.maxRuns ?? 4000;
  const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
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
  const styles = new Map();
  const st = e => { if (!styles.has(e)) styles.set(e, getComputedStyle(e)); return styles.get(e); };
  const hidden = e => {
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      const s = st(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return true;
      if (/^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(s.clip.replaceAll(' ', ''))) return true;
      if (/(hidden|clip)/.test(s.overflow) && (p.offsetWidth <= 2 || p.offsetHeight <= 2) && s.display !== 'inline') return true;
    }
    return false;
  };
  const opacity = e => { let o = 1; for (let p = e; p && p !== document.documentElement; p = p.parentElement) o *= Number(st(p).opacity); return o; };
  // Below html/body: the nearest ancestor-or-self that clips or scrolls horizontally.
  const xContainer = e => {
    for (let p = e; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const v = st(p).overflowX;
      if (v !== 'visible') return { el: p, mode: /auto|scroll/.test(v) ? 'scroll' : 'clip' };
    }
    return null;
  };
  const ownBox = e => { for (let p = e; p && p !== document.documentElement; p = p.parentElement) if (st(p).display !== 'inline' && st(p).display !== 'contents') return p; return document.body; };
  const REPLACED = /^(IMG|VIDEO|CANVAS|IFRAME|SVG|svg|PICTURE|OBJECT|EMBED|INPUT|TEXTAREA|SELECT|BUTTON)$/;
  // True when the element visibly paints at (x, y): a fill, an image, a replaced element, or its own text there.
  const paintsAt = (c, x, y) => {
    if (opacity(c) < 0.05) return false;
    const s = st(c);
    if (s.visibility !== 'visible') return false;
    if (REPLACED.test(c.tagName) || c.closest('svg')) return true;
    const bg = s.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    if ((bg.length > 3 ? bg[3] : 1) >= 0.1 || s.backgroundImage !== 'none' || (s.backdropFilter && s.backdropFilter !== 'none')) return true;
    for (const n of c.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return true;
    }
    return false;
  };
  const describe = c => {
    const name = c.getAttribute('aria-label') || (c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + (name ? ' "' + name + '"' : '');
  };

  const CONTROL = 'input, textarea, select';
  const TEXT_INPUT = /^(text|email|password|search|tel|url|number|date|datetime-local|month|time|week|)$/;
  const overflows = [], covered = [], skipped = [];
  let runs = 0;
  for (const e of document.body.querySelectorAll('*')) {
    if (runs >= maxRuns) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|OPTGROUP)$/.test(e.tagName) || e.closest('svg')) continue;
    const isControl = e.matches(CONTROL);
    if (isControl && e.tagName === 'INPUT' && !TEXT_INPUT.test((e.getAttribute('type') || '').toLowerCase())) continue;
    const direct = isControl ? [] : [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!isControl && !direct.length) continue;
    if (hidden(e)) continue;
    const rects = (isControl ? [e.getBoundingClientRect()] : direct.flatMap(n => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()]; }))
      .filter(r => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) continue;
    runs++;
    const sel = selector(e);
    const text = (isControl ? (e.value || e.getAttribute('placeholder') || '') : direct.map(n => n.textContent).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 80);
    const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));

    // R3: off the screen, or out of its own box, horizontally. Text inside a clipping container
    // belongs to R2 (cut off), and text inside a horizontal scroller is reachable by scrolling.
    if (!isControl) {
      const container = xContainer(e);
      const fixed = st(e).position === 'fixed';
      const scrolled = fixed ? 0 : scrollX;
      if (!container) {
        const box = ownBox(e), b = box.getBoundingClientRect(), bs = st(box);
        const inner = { left: b.left + box.clientLeft, right: b.left + box.clientLeft + (box.clientWidth || b.width) };
        const offRight = right + scrolled - vw, offLeft = -(left + scrolled);
        const partlyVisible = right + scrolled > 0 && left + scrolled < vw;
        const spill = Math.max(right - inner.right, inner.left - left);
        if (partlyVisible && (offRight > 1 || offLeft > 1)) {
          overflows.push({ selector: sel, rect: docRect(e.getBoundingClientRect()), text, kind: 'off-screen',
            beyond: round(Math.max(offRight, offLeft)), side: offRight > 1 ? 'right' : 'left', textLeft: round(left + scrollX), textRight: round(right + scrollX), viewportWidth: vw });
        } else if (box !== document.body && spill > 1 && bs.overflowX === 'visible') {
          overflows.push({ selector: sel, rect: docRect(e.getBoundingClientRect()), text, kind: 'spills', container: selector(box),
            beyond: round(spill), textLeft: round(left + scrollX), textRight: round(right + scrollX), boxLeft: round(inner.left + scrollX), boxRight: round(inner.right + scrollX) });
        }
      }
    }

    // R4: something else paints over the centre of the text. Only on-screen text can be
    // hit-tested. Full-screen overlays (a modal's backdrop) are deliberate and skipped.
    const mid = rects[Math.floor(rects.length / 2)];
    const cx = isControl ? (rects[0].left + rects[0].right) / 2 : (Math.max(mid.left, 0) + Math.min(mid.right, vw)) / 2, cy = (mid.top + mid.bottom) / 2;
    if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
    if (st(e).pointerEvents === 'none') { skipped.push({ selector: sel, reason: 'pointer-events-none' }); continue; }
    const stack = document.elementsFromPoint(cx, cy);
    const at = stack.findIndex(c => c === e || e.contains(c) || c.contains(e));
    if (at < 0) { skipped.push({ selector: sel, reason: 'not-hit' }); continue; }
    const cover = stack.slice(0, at).find(c => !e.contains(c) && paintsAt(c, cx, cy));
    if (!cover) continue;
    const cr = cover.getBoundingClientRect();
    if (cr.width >= vw * 0.9 && cr.height >= vh * 0.9) { skipped.push({ selector: sel, reason: 'behind-overlay' }); continue; }
    covered.push({ selector: sel, rect: docRect(e.getBoundingClientRect()), text, cover: selector(cover), coverLabel: describe(cover),
      coverRect: docRect(cr), coverPosition: st(cover).position, point: { x: round(cx + scrollX), y: round(cy + scrollY) } });
  }
  return { viewport: { width: vw, height: vh }, scroll: { x: scrollX, y: scrollY }, overflows, covered, skipped };
}

const SOURCE = `function collectReadability(options = {}) {
  const textScale = Number(window.__agentManuelTextScale) || 1;
  const typography = (${collectTypography.toString()})({ maxRuns: 0, maxClipCandidates: options.maxClipCandidates });
  if (textScale > 1) return { textScale, clips: typography.clips, viewport: typography.viewport };
  const contrast = (${collectContrast.toString()})(options);
  const layout = (${collectLayout.toString()})(options);
  return { textScale, viewport: contrast.viewport, capture: contrast.capture, contrast, clips: typography.clips, overflows: layout.overflows, covered: layout.covered, skipped: layout.skipped };
}`;

/** One self-contained function: contrast + clipping + layout collectors, inlined by source. */
export const collectReadability = new Function(`return ${SOURCE}`)();
