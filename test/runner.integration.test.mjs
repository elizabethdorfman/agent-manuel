import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findChrome } from '../src/cdp.mjs';
import { run } from '../src/runner/index.mjs';
import { normalizePath } from '../src/runner/state.mjs';
import * as smoke from '../src/checks/_smoke/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'test/fixtures/runner');

/** Serves the fixture pages and records every request, so the test can prove what never happened. */
async function serve(handler) {
  const hits = [];
  const server = createServer(async (req, res) => { hits.push({ method: req.method, url: req.url }); await handler(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

async function startFixture() {
  const external = await serve((req, res) => { res.end('<h1>External</h1>'); });
  const app = await serve(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (/^[a-z]+\.html$/.test(file)) {
      const html = (await readFile(join(fixtures, file), 'utf8')).replaceAll('{{EXTERNAL}}', external.url);
      res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return;
    }
    if (path === '/analytics/track.js') { res.setHeader('content-type', 'text/javascript'); res.end('window.tracked=true'); return; }
    res.statusCode = 404; res.end('not found');
  });
  return { app, external, close: async () => { await app.close(); await external.close(); } };
}

const exists = p => access(p).then(() => true, () => false);

test('The runner explores the fixture app, enforces safety and writes every output file.', { timeout: 180000 }, async t => {
  if (!(await findChrome())) { t.skip('Chrome was not found; set CHROME_BIN to run the runner integration test.'); return; }
  const fx = await startFixture();
  const out = await mkdtemp(join(tmpdir(), 'qa-runner-'));
  try {
    const events = [];
    const result = await run({
      baseUrl: fx.app.url + '/',
      entry: ['/'],
      denyActions: ['/delete|log ?out/i'],
      denySubmitForms: ['/sign ?up|create account|register/i'],
      blockRequests: ['*analytics*'],
      viewports: [{ width: 390, height: 844 }, { width: 1280, height: 800 }],
      budget: { maxStates: 20, maxActions: 60, maxMinutes: 3 },
      settleMs: 120,
    }, { out, checks: [smoke], print: e => events.push(e) });

    assert.equal(result.status, 'complete', `run did not finish cleanly: ${result.reason}`);
    const ledger = JSON.parse(await readFile(join(out, 'ledger.json'), 'utf8'));
    const states = Object.values(ledger.states);

    // Reaches every page, plus the dialog state.
    const paths = new Set(states.map(s => normalizePath(s.url)));
    for (const p of ['/', '/form.html', '/thanks.html', '/settings.html']) assert(paths.has(p), `never reached ${p}; got ${[...paths]}`);
    assert(states.some(s => s.signature.dialog === 'help'), 'never opened the Help dialog');

    // Delete is blocked by denyActions and never clicked.
    const del = ledger.edges.find(e => e.action.name === 'Delete account');
    assert.equal(del.status, 'blocked');
    assert.match(del.reason, /denyActions/);
    assert(!fx.app.hits.some(h => h.url.startsWith('/api/delete')), 'Delete reached the server');

    // The sign-up form's generic "Continue" is blocked because of the form around it.
    const signup = ledger.edges.find(e => e.action.name === 'Continue');
    assert.equal(signup.status, 'blocked');
    assert.match(signup.reason, /denySubmitForms/);
    assert(!fx.app.hits.some(h => h.url.startsWith('/signup')), 'Sign-up form reached the server');

    // The external link is blocked and the external server is never contacted.
    const ext = ledger.edges.find(e => e.action.name === 'Partner site');
    assert.equal(ext.status, 'blocked');
    assert.match(ext.reason, /off the app origin/);
    assert.equal(fx.external.hits.length, 0, 'the external origin received a request');

    // A script redirect off the origin is stopped by the network guard and recorded as blocked.
    const redirect = ledger.edges.find(e => e.action.name === 'Visit partner');
    assert.equal(redirect.status, 'blocked', JSON.stringify(redirect));
    assert.match(redirect.reason, /navigate off the app origin/);
    assert.equal(fx.external.hits.length, 0, 'the redirect reached the external origin');

    // blockRequests: the analytics script never reached the server.
    assert(!fx.app.hits.some(h => h.url.startsWith('/analytics')), 'analytics request was not blocked');

    // Every typed value carried the marker: the contact form submitted QA-SYNTHETIC in every text field.
    const sent = fx.app.hits.find(h => h.url.startsWith('/thanks.html?'));
    assert(sent, 'contact form was never submitted');
    const q = new URL(sent.url, 'http://x').searchParams;
    for (const k of ['name', 'email', 'message']) assert.match(q.get(k), /QA-SYNTHETIC/, `${k} lacked the marker`);

    // Edge outcomes: no failures on this deterministic fixture, Back and reload were tried.
    assert.deepEqual(ledger.edges.filter(e => e.status === 'failed'), []);
    assert(ledger.edges.some(e => e.action.kind === 'back' && e.status === 'passed'));
    assert(ledger.edges.some(e => e.action.kind === 'reload' && e.status === 'passed' && e.to === e.from));
    assert.equal(ledger.edges.filter(e => e.status === 'untried').length, 0);

    // Output layout.
    for (const f of ['ledger.json', 'findings.json', 'events.jsonl', 'report.html']) assert(await exists(join(out, f)), `missing ${f}`);
    for (const [key, s] of Object.entries(ledger.states)) {
      assert.deepEqual(Object.keys(s.screenshots).sort(), ['1280x800', '390x844']);
      for (const vp of ['390x844', '1280x800']) assert(await exists(join(out, 'states', key, vp + '.png')), `missing screenshot ${key}/${vp}`);
      assert.equal(s.firstPath[0].kind, 'goto');
    }
    assert.equal((await readdir(join(out, 'states'))).length, states.length);

    // Checks ran: the stub check flags the title-less settings page, once, with a replay path.
    const findings = JSON.parse(await readFile(join(out, 'findings.json'), 'utf8'));
    const noTitle = findings.filter(f => f.id === 'SMOKE-no-title');
    assert.equal(noTitle.length, 1);
    assert(noTitle[0].occurrences.every(o => normalizePath(ledger.states[o.state].url) === '/settings.html'));
    assert.deepEqual(noTitle[0].occurrences[0].path, ledger.states[noTitle[0].occurrences[0].state].firstPath.map(s => s.label));

    // events.jsonl mirrors the live events, with stable types and run-start/run-end at the ends.
    const lines = (await readFile(join(out, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map(l => l.type), events.map(e => e.type));
    assert.equal(lines[0].type, 'run-start'); assert.equal(lines.at(-1).type, 'run-end');
    assert(lines.every(l => ['run-start', 'state', 'edge', 'blocked', 'finding', 'run-end'].includes(l.type)));
    assert.equal(lines.filter(l => l.type === 'state').length, states.length);
    assert.equal(lines.at(-1).counts.blocked, ledger.edges.filter(e => e.status === 'blocked').length);

    const html = await readFile(join(out, 'report.html'), 'utf8');
    assert.match(html, /data:image\/jpeg;base64,/);
    assert.match(html, /SMOKE-no-title/);
    assert.match(html, /Delete account/);
  } finally {
    await fx.close();
    await rm(out, { recursive: true, force: true });
  }
});

test('Budgets stop the run cleanly and the report is still written.', { timeout: 120000 }, async t => {
  if (!(await findChrome())) { t.skip('Chrome was not found.'); return; }
  const fx = await startFixture();
  const out = await mkdtemp(join(tmpdir(), 'qa-runner-budget-'));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [join(root, 'bin/agent-manuel.mjs'), 'run', '--url', fx.app.url + '/', '--max-states', '2', '--viewport', '390x844', '--out', out], { cwd: root, timeout: 90000 });
    assert.match(stdout, /done: budget \(reached maxStates \(2\)\)/);
    const ledger = JSON.parse(await readFile(join(out, 'ledger.json'), 'utf8'));
    assert.equal(Object.keys(ledger.states).length, 2);
    assert(ledger.edges.some(e => e.status === 'untried' && /run stopped/.test(e.reason)));
    assert(await exists(join(out, 'report.html')));
    const end = (await readFile(join(out, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(end.type, 'run-end'); assert.equal(end.status, 'budget');
    assert.equal(fx.external.hits.length, 0);
  } finally {
    await fx.close();
    await rm(out, { recursive: true, force: true });
  }
});
