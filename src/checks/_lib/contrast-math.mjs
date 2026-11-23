// WCAG 2.x colour maths. Colours are [r,g,b] or [r,g,b,a] with r,g,b in 0..255 and a in 0..1.

const channel=v=>{const s=v/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance([r,g,b]){return 0.2126*channel(r)+0.7152*channel(g)+0.0722*channel(b);}

/** WCAG contrast ratio between two opaque colours, 1 to 21. Order does not matter. */
export function contrastRatio(a,b) {
  const la=relativeLuminance(a),lb=relativeLuminance(b);
  return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);
}

/** Composites a colour with alpha over an opaque background. */
export function blend([r,g,b,a=1],[br,bg,bb]){return [r*a+br*(1-a),g*a+bg*(1-a),b*a+bb*(1-a)];}

/** WCAG large text: at least 24px, or at least 18.66px (14pt) and bold (700+). */
export function isLargeText(fontSizePx,fontWeight=400){return fontSizePx>=24||(fontSizePx>=18.66&&Number(fontWeight)>=700);}

/** The minimum ratio WCAG 1.4.3 (AA) requires for this text. */
export function requiredRatio(fontSizePx,fontWeight){return isLargeText(fontSizePx,fontWeight)?3:4.5;}

/** Parses the rgb()/rgba() strings getComputedStyle returns, plus hex. Returns [r,g,b,a] or null. */
export function parseColor(text) {
  if(!text)return null;
  const s=String(text).trim().toLowerCase();
  if(s==='transparent')return [0,0,0,0];
  let m=/^#([0-9a-f]{3,8})$/.exec(s);
  if(m){let h=m[1];if(h.length<=4)h=[...h].map(c=>c+c).join('');const n=[0,2,4,6].map(i=>parseInt(h.slice(i,i+2)||'ff',16));return [n[0],n[1],n[2],n[3]/255];}
  m=/^rgba?\(([^)]+)\)$/.exec(s);
  if(!m)return null;
  const parts=m[1].split(/[\s,\/]+/).filter(Boolean).map((p,i)=>p.endsWith('%')?Number(p.slice(0,-1))/100*(i<3?255:1):Number(p));
  if(parts.length<3||parts.some(Number.isNaN))return null;
  return [parts[0],parts[1],parts[2],parts[3]??1];
}
