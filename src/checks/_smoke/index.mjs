// Stub check owned by the runner (Stream A). It proves the run loop end to end: collect runs
// in the page, analyze runs in Node, and a missing or empty <title> becomes a finding.
export const meta = { id: 'SMOKE', name: '_smoke', title: 'Every screen has a page title.' };

export function collect() {
  return { title: document.title, h1: (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 120) };
}

export function analyze(collected) {
  const findings = [];
  if (!collected.title.trim()) findings.push({
    id: 'SMOKE-no-title', status: 'review', severity: 'low', selector: 'title', rect: null,
    message: 'This screen has no page title, so the browser tab and screen readers have nothing to announce.',
    measurements: { title: collected.title, h1: collected.h1 },
  });
  return { checkId: meta.id, findings, summary: { title: collected.title, findings: findings.length } };
}

export const variants = [];
