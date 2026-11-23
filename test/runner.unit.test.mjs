import test from 'node:test';
import assert from 'node:assert/strict';
import { stateKey, normalizePath, normalizeText } from '../src/runner/state.mjs';
import { inputClass } from '../src/runner/inputs.mjs';
import { Ledger, Findings, EventLog, EVENT_TYPES } from '../src/runner/ledger.mjs';
import { undoFor, planVariants } from '../src/runner/checks.mjs';
import { actionLabel, actionRecord, actionSignature } from '../src/runner/discover.mjs';
import { checks } from '../src/checks/index.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const snap = (o = {}) => ({ url: 'https://a.test/start', headings: ['How was your day?'], controls: [{ role: 'button', name: 'continue' }, { role: 'textbox', name: 'tell me about your day' }], dialog: null, ...o });

test('State key: equivalent screens collapse, different screens split.', () => {
  const k = s => stateKey(s).key;
  assert.equal(k(snap()), k(snap({ url: 'https://a.test/start?utm=1#x' })), 'query and hash ignored');
  assert.equal(k(snap()), k(snap({ controls: [...snap().controls].reverse() })), 'control order ignored');
  assert.equal(k(snap()), k(snap({ headings: ['  how WAS your   day? '] })), 'case and whitespace ignored');
  assert.equal(k(snap({ headings: ['3 items'] })), k(snap({ headings: ['12 items'] })), 'counters collapse');
  assert.equal(k(snap({ controls: [{ role: 'button', name: 'remove' }] })), k(snap({ controls: [{ role: 'button', name: 'remove' }, { role: 'button', name: 'remove' }] })), 'repeated list rows collapse');
  assert.equal(k(snap({ url: 'https://a.test/entry/123' })), k(snap({ url: 'https://a.test/entry/456' })), 'numeric ids collapse');
  assert.equal(k(snap({ url: 'https://a.test/p/3f9a1c2e-1b2c-4d5e-8f90-1234567890ab' })), k(snap({ url: 'https://a.test/p/aaaaaaaa-1b2c-4d5e-8f90-1234567890ab' })), 'uuids collapse');
  // The Girl Math case: same URL, different screen.
  assert.notEqual(k(snap()), k(snap({ headings: ['allow ai?'], controls: [{ role: 'button', name: 'allow' }] })));
  assert.notEqual(k(snap()), k(snap({ dialog: 'Help' })), 'an open dialog is a different state');
  assert.notEqual(k(snap()), k(snap({ url: 'https://a.test/other' })));
  assert.notEqual(k(snap()), k(snap({ controls: [{ role: 'link', name: 'continue' }, snap().controls[1]] })), 'role matters');
  assert.equal(normalizePath('https://a.test/'), '/');
  assert.equal(normalizePath('https://a.test/board/'), '/board');
  assert.equal(normalizePath('https://a.test/board/stories'), '/board/stories', 'words are not ids');
  assert.equal(normalizePath('file:///x/y/index.html'), '/');
  assert.equal(normalizeText('Café  “Hi” 4,500.25'), 'café "hi" #');
});

test('Input classes come from type, autocomplete and label.', () => {
  const cases = [
    [{ inputType: 'email' }, 'email'], [{ inputType: 'text', autocomplete: 'email' }, 'email'], [{ inputType: 'text', name: 'Email address' }, 'email'],
    [{ inputType: 'password' }, 'password'], [{ inputType: 'number' }, 'number'], [{ inputType: 'date' }, 'date'],
    [{ inputType: 'tel' }, 'phone'], [{ inputType: 'url' }, 'url'], [{ inputType: 'search' }, 'search'],
    [{ inputType: 'text', name: 'your name' }, 'name'], [{ inputType: 'text', autocomplete: 'given-name' }, 'name'],
    [{ inputType: 'textarea', tag: 'textarea', name: 'anything' }, 'story'], [{ inputType: 'text', name: 'tell me about your day' }, 'story'],
    [{ inputType: 'text', name: 'Zip code' }, 'postal'], [{ inputType: 'text', name: 'item 1' }, 'text'],
  ];
  for (const [f, cls] of cases) assert.equal(inputClass(f), cls, JSON.stringify(f));
});

test('Ledger picks the shallowest open edge first and counts outcomes.', () => {
  const l = new Ledger();
  l.addState('a', { depth: 0 }); l.addState('b', { depth: 1 });
  const deep = l.addEdge('b', { kind: 'reload' });
  const shallow = l.addEdge('a', { kind: 'reload' });
  l.addEdge('a', { kind: 'click', name: 'Delete' }, 'blocked', 'denyActions');
  assert.equal(l.nextOpen(), shallow);
  shallow.status = 'passed';
  assert.equal(l.nextOpen(), deep);
  deep.closed = true;
  assert.equal(l.nextOpen(), null);
  assert.deepEqual(l.counts(), { states: 2, edges: 3, passed: 1, failed: 0, blocked: 1, untried: 1 });
  assert(!('closed' in JSON.parse(JSON.stringify(l)).edges[0]));
});

test('Findings are merged across screens into one entry with every occurrence.', () => {
  const f = new Findings();
  assert.equal(f.add('UI03', { id: 'UI03-x', message: 'm' }, { state: 'a' }), true);
  assert.equal(f.add('UI03', { id: 'UI03-x', message: 'm' }, { state: 'b' }), false);
  assert.equal(f.add('UI04', { id: 'UI03-x', message: 'm' }, { state: 'a' }), true, 'same id under another check is separate');
  assert.deepEqual(f.list()[0].occurrences.map(o => o.state), ['a', 'b']);
});

test('Event log writes JSON lines and only accepts the stable event types.', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-events-'));
  try {
    const seen = []; const log = new EventLog(join(dir, 'events.jsonl'), e => seen.push(e));
    log.emit('run-start', { baseUrl: 'x' }); log.emit('run-end', { status: 'complete' });
    assert.throws(() => log.emit('something-else', {}));
    const lines = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map(l => l.type), ['run-start', 'run-end']);
    assert(lines.every(l => typeof l.t === 'string'));
    assert.equal(seen.length, 2);
    assert.deepEqual(EVENT_TYPES, ['run-start', 'state', 'edge', 'blocked', 'finding', 'run-end']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Check variants are undone: known Emulation calls automatically, anything else needs an undo.', () => {
  assert.deepEqual(undoFor({ method: 'Emulation.setEmulatedMedia', params: { media: 'print' } }), { method: 'Emulation.setEmulatedMedia', params: { media: '', features: [] } });
  assert.equal(undoFor({ method: 'Emulation.setDeviceMetricsOverride', params: { width: 320 } }), null, 'viewport is restored by the runner');
  const own = { method: 'Runtime.evaluate', params: { expression: 'a' }, undo: { method: 'Runtime.evaluate', params: { expression: 'b' } } };
  assert.equal(undoFor(own), own.undo);
  assert.throws(() => undoFor({ method: 'Page.setFontSizes', params: {} }), /no undo/);
});

test('Registered checks follow the module contract.', () => {
  assert(checks.length >= 1);
  for (const c of checks) {
    assert.equal(typeof c.meta?.id, 'string'); assert.equal(typeof c.meta?.name, 'string');
    assert.equal(typeof c.collect, 'function'); assert.equal(typeof c.analyze, 'function');
    assert(c.variants === undefined || Array.isArray(c.variants));
  }
});

test('Action records keep only what replays in a fresh context.', () => {
  const a = { kind: 'click', role: 'button', name: 'Open help', nth: 1, backendNodeId: 42, form: {}, href: null };
  assert.deepEqual(actionRecord(a), { kind: 'click', label: 'click button "Open help" #2', role: 'button', name: 'Open help', nth: 1 });
  assert.equal(actionSignature(actionRecord(a)), actionSignature(a));
  assert.equal(actionLabel({ kind: 'back' }), 'browser Back');
});

test('Variants without an id set up the only pass; variants with an id add a pass after the normal one.', () => {
  const setup = { method: 'Emulation.setDeviceMetricsOverride', params: { width: 320 } };
  const pass = { id: 'text-200', method: 'Runtime.evaluate', params: {}, undo: { method: 'Runtime.evaluate', params: {} } };
  assert.deepEqual(planVariants({ variants: [setup, pass] }), { setup: [setup], passes: [pass] });
  assert.deepEqual(planVariants({}), { setup: [], passes: [] });
});
