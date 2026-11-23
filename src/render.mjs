const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderReport(snapshot,analysis,pngBase64) {
  const mime=pngBase64.startsWith('/9j/')?'image/jpeg':'image/png';
  const c=snapshot.capture,byId=new Map(snapshot.elements.map(e=>[e.id,e]));
  const box=(r,attrs)=>`<rect x="${r.x-c.x}" y="${r.y-c.y}" width="${r.width}" height="${r.height}" ${attrs}/>`;
  const color={heading:'#d00066',image:'#007eaa','background-image':'#007eaa',control:'#aa5100',text:'#7741aa','rule-target':'#505050'};
  const boxes=snapshot.elements.map(e=>`<g><title>${esc(e.id+' '+e.kind+' '+e.selector)}</title>${box(e.rect,`fill="none" stroke="${color[e.kind]??'#505050'}" stroke-width="1"`)}<text x="${e.rect.x-c.x+2}" y="${Math.max(10,e.rect.y-c.y-3)}" fill="${color[e.kind]??'#505050'}" font-size="9">${esc(e.id)}</text></g>`).join('');
  const runs=(snapshot.textRuns??[]).flatMap(t=>t.rects.map(b=>`<g><title>${esc(t.id+' '+t.text)}</title>${box(b.rect,'fill="#8844cc" fill-opacity=".06" stroke="#8844cc" stroke-width=".6"')}</g>`)).join('');
  const guides=analysis.guides.map(g=>{
    const es=g.targetIds.map(id=>byId.get(id)).filter(Boolean);if(es.length<2)return '';
    const v=g.value,vertical=['left','right','centerX'].includes(g.axis);
    const lo=Math.min(...es.map(e=>vertical?e.rect.y:e.rect.x));
    const hi=Math.max(...es.map(e=>vertical?e.rect.y+e.rect.height:e.rect.x+e.rect.width));
    return `<g><title>${esc(g.id+' '+g.axis+' '+v.toFixed(2)+' CSS px')}</title><line x1="${vertical?v-c.x:lo-c.x}" y1="${vertical?lo-c.y:v-c.y}" x2="${vertical?v-c.x:hi-c.x}" y2="${vertical?hi-c.y:v-c.y}" stroke="#007b42" stroke-dasharray="4 3" stroke-width="1"/></g>`;
  }).join('');
  const targets=new Set(analysis.candidates.flatMap(x=>x.targetIds));
  analysis.ruleResults.filter(r=>r.status==='outside-tolerance').forEach(r=>r.targetIds.forEach(id=>targets.add(id)));
  const flags=[...targets].map(id=>byId.get(id)).filter(Boolean).map(e=>box(e.rect,'fill="#ffb000" fill-opacity=".12" stroke="#c04f00" stroke-width="2"')).join('');
  const rules=analysis.ruleResults.map(r=>`<li><b>${esc(r.id)}</b>: ${esc(r.status)}${r.spread!==undefined?`, spread ${r.spread.toFixed(2)} CSS px, tolerance ${r.tolerance} CSS px`:''}. ${esc(r.reason)}</li>`).join('');
  const candidates=analysis.candidates.map(r=>`<li><b>${esc(r.targetIds.join(' / '))}</b>: ${r.delta.toFixed(2)} CSS px between left edges. ${esc(r.reason)}</li>`).join('');
  const rows=snapshot.elements.map(e=>`<tr><td>${esc(e.id)}</td><td>${esc(e.kind)}</td><td><code>${esc(e.selector)}</code></td><td>${[e.rect.x,e.rect.y,e.rect.width,e.rect.height].map(n=>n.toFixed(2)).join(', ')}</td><td>${e.clipped?'Clipped. ':''}${e.masked?'Mask needs review. ':''}${esc(e.label)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alignment evidence</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#242424;background:#faf8fc}h1{color:#401934}fieldset{position:sticky;top:0;z-index:1;background:white;border:1px solid #ccc;padding:12px}label{display:inline-block;margin-right:18px}svg{display:block;width:100%;height:auto;background:white}main{max-width:1400px;margin:auto}.frame{max-width:100%;border:1px solid #ccc;background:#eee}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;text-align:left;border-bottom:1px solid #ccc;overflow-wrap:anywhere}code{white-space:normal}.note{background:#fff1cd;padding:12px}li{margin-bottom:8px}a{color:#713557}</style>
<main><h1>Alignment evidence needs a reviewer.</h1><p>This report describes ${esc(snapshot.page.title)} at ${esc(snapshot.page.url)}. The viewport is ${snapshot.viewport.width} by ${snapshot.viewport.height} CSS pixels. Boxes and guides are measurements; they do not establish design intent.</p>
<p>${analysis.summary.elementCount} element boxes and ${analysis.summary.textRunCount} DOM text runs were recorded. ${analysis.summary.ruleViolations} supplied rules exceeded tolerance, ${analysis.summary.blockedRules} rules were blocked and ${analysis.summary.reviewCandidates} automatic pairs need review.</p>
<fieldset><legend>Choose which evidence to show.</legend><label><input type="checkbox" data-layer="boxes" checked>Show element boxes.</label><label><input type="checkbox" data-layer="text">Show text-line boxes.</label><label><input type="checkbox" data-layer="guides" checked>Show alignment guides.</label><label><input type="checkbox" data-layer="flags" checked>Show review candidates.</label></fieldset>
<p>Pink boxes identify headings, blue boxes identify images, purple boxes identify text and brown boxes identify controls. Hover over a box or guide for its reference.</p>
<div class="frame"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.width} ${c.height}" role="img" aria-label="Page screenshot with switchable alignment annotations"><image href="data:${mime};base64,${pngBase64}" x="0" y="0" width="${c.width}" height="${c.height}"/><g id="boxes">${boxes}</g><g id="text" style="display:none">${runs}</g><g id="guides">${guides}</g><g id="flags">${flags}</g></svg></div>
<h2>The supplied alignment rules produced these results.</h2><ul>${rules||'<li>No explicit alignment rules were supplied.</li>'}</ul>
<h2>These automatic candidates need design review.</h2><ul>${candidates||'<li>No nearby-edge candidates were generated. This is not an alignment pass.</li>'}</ul>
<h2>The evidence has these limits.</h2><ul>${[...snapshot.warnings,...analysis.warnings].map(s=>`<li>${esc(s)}</li>`).join('')}</ul>
<p class="note">This tool does not judge readability, compare against an approved design automatically, run OCR or prove that every app state was reached. Input values are excluded from the JSON collector, but screenshots and ordinary page text can still contain private information.</p>
<h2>The element inventory supports follow-up checks.</h2><table><thead><tr><th>Reference</th><th>Kind</th><th>Selector</th><th>x, y, width, height in CSS pixels</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></main>
<script>document.querySelectorAll('[data-layer]').forEach(input=>input.addEventListener('change',()=>{document.getElementById(input.dataset.layer).style.display=input.checked?'':'none'}));</script></html>`;
}
