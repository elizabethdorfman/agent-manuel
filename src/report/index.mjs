// Minimal self-contained run report: coverage counts, a grid of state screenshots (embedded as
// JPEG thumbnails) and findings grouped by check, each with its replay path.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function renderRunReport({ out, ledger, order, findings, meta }) {
  const counts = { states: order.length, passed: 0, failed: 0, blocked: 0, untried: 0 };
  for (const e of ledger.edges) counts[e.status]++;
  const thumbs = {};
  for (const key of order) {
    const t = ledger.states[key].thumb;
    if (t) try { thumbs[key] = 'data:image/jpeg;base64,' + (await readFile(join(out, t))).toString('base64'); } catch {}
  }
  const grouped = new Map();
  for (const f of findings) { if (!grouped.has(f.checkId)) grouped.set(f.checkId, []); grouped.get(f.checkId).push(f); }
  const checkTitle = id => meta.checks?.find(c => c?.id === id)?.title ?? '';
  const stateName = k => ledger.states[k]?.label ?? k;
  const edgesFrom = k => ledger.edges.filter(e => e.from === k);
  const path = steps => `<ol class="path">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;

  const stateCards = order.map((key, i) => {
    const s = ledger.states[key];
    const shots = Object.entries(s.screenshots).map(([vp, file]) => `<a href="${esc(file)}">${esc(vp)}</a>`).join(' · ');
    const edges = edgesFrom(key).map(e => `<li class="${e.status}"><b>${e.status}</b> ${esc(e.action.label)}${e.to && e.to !== key ? ` → ${esc(stateName(e.to))}` : e.to === key ? ' → same state' : ''}${e.reason ? ` <i>${esc(e.reason)}</i>` : ''}</li>`).join('');
    return `<article class="state" id="s-${esc(key)}"><div class="shot">${thumbs[key] ? `<img src="${thumbs[key]}" alt="Screenshot of ${esc(s.label)}">` : ''}</div>
      <h3>${i + 1}. ${esc(s.label)}</h3><p class="meta"><code>${esc(key)}</code> · depth ${s.depth} · ${shots}</p>
      <details><summary>Replay path and edges</summary>${path(s.firstPath.map(p => p.label))}<ul class="edges">${edges}</ul></details></article>`;
  }).join('\n');

  const findingSections = [...grouped].map(([checkId, list]) => `<section class="check"><h3>${esc(checkId)} <span>${esc(checkTitle(checkId))}</span></h3>
    ${list.map(f => `<div class="finding ${esc(f.status)}"><p><b>${esc(f.status)}</b> · ${esc(f.severity)} · <code>${esc(f.id)}</code>${f.selector ? ` · <code>${esc(f.selector)}</code>` : ''}</p>
      <p>${esc(f.message)}</p>
      <p class="meta">Seen on ${f.occurrences.length} screen${f.occurrences.length === 1 ? '' : 's'}: ${[...new Set(f.occurrences.map(o => `<a href="#s-${esc(o.state)}">${esc(stateName(o.state))}</a> @ ${esc(o.viewport)}`))].join(', ')}</p>
      <details><summary>Replay steps</summary>${path(f.occurrences[0].path)}${f.measurements ? `<pre>${esc(JSON.stringify(f.measurements, null, 2))}</pre>` : ''}</details></div>`).join('')}</section>`).join('\n') || '<p>No findings.</p>';

  const blocked = ledger.edges.filter(e => e.status === 'blocked');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Manuel run · ${esc(meta.baseUrl)}</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:0;padding:24px;color:#1b1b1f;background:#f6f6f4}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px}h3{font-size:15px;margin:8px 0 4px}h3 span{font-weight:400;color:#555}
.meta{color:#555;font-size:13px;margin:2px 0}.counts{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.counts div{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 14px;min-width:90px}.counts b{display:block;font-size:22px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.state{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px}.shot{height:300px;overflow:hidden;border-radius:4px;background:#eee}
.shot img{width:100%;display:block}.edges{padding-left:16px;font-size:13px}.edges i{color:#666}
.passed b{color:#17703a}.failed b{color:#b3261e}.blocked b{color:#8a5a00}.untried b{color:#666}
.finding{background:#fff;border:1px solid #ddd;border-left:4px solid #999;border-radius:6px;padding:8px 12px;margin:8px 0}
.finding.fail{border-left-color:#b3261e}.finding.review{border-left-color:#c58b00}.finding p{margin:4px 0}
pre{background:#f1f1ee;padding:8px;overflow:auto;font-size:12px}.path{font-size:13px;margin:4px 0;padding-left:20px}code{font-size:12px}
</style></head><body>
<h1>Agent Manuel run</h1>
<p class="meta">${esc(meta.baseUrl)} · started ${esc(meta.startedAt)} · ${(meta.durationMs / 1000).toFixed(1)} s · viewports ${esc(meta.viewports.join(', '))}</p>
<p class="meta">Status: <b>${esc(meta.status)}</b> (${esc(meta.reason)}) · ${meta.actions} actions taken</p>
<div class="counts"><div><b>${counts.states}</b>states</div><div><b>${counts.passed}</b>edges passed</div><div><b>${counts.failed}</b>failed</div><div><b>${counts.blocked}</b>blocked</div><div><b>${counts.untried}</b>untried</div><div><b>${findings.length}</b>findings</div></div>
<h2>Findings by check</h2>${findingSections}
<h2>States reached</h2><div class="grid">${stateCards}</div>
<h2>Blocked actions</h2>${blocked.length ? `<ul class="edges">${blocked.map(e => `<li class="blocked"><b>blocked</b> ${esc(e.action.label)} on ${esc(stateName(e.from))} <i>${esc(e.reason)}</i></li>`).join('')}</ul>` : '<p>None.</p>'}
</body></html>
`;
}
