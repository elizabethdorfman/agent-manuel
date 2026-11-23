#!/usr/bin/env node
// agent-manuel run --app apps/<app>/config.json [options]
// agent-manuel run --url <url-or-html-file> [options]
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run } from '../src/runner/index.mjs';
import { normalizeConfig, DEFAULT_SAFETY } from '../src/runner/safety.mjs';

const USAGE = `Usage:
  agent-manuel run --app <config.json> [options]
  agent-manuel run --url <url or local .html file> [options]

Options:
  --max-states N      stop after N states (default from config, else 40)
  --max-actions N     stop after N actions (default 200)
  --max-minutes N     stop after N minutes (default 15)
  --viewport WxH      viewport to check at; repeat for several (default 390x844 and 1280x800)
  --out DIR           output folder (default artifacts/runs/<timestamp>)
  --chrome PATH       Chrome executable (or set CHROME_BIN)
  --no-sandbox        pass --no-sandbox to Chrome (containers only)
  --quiet             no progress lines; events.jsonl is still written
  --json              print events as JSON lines instead of progress lines`;

const [command, ...rest] = process.argv.slice(2);
if (command !== 'run') { console.error(USAGE); process.exit(command ? 2 : 0); }
const opts = { viewport: [] };
const flags = new Set(['--no-sandbox', '--quiet', '--json']);
const valued = new Set(['--app', '--url', '--max-states', '--max-actions', '--max-minutes', '--viewport', '--out', '--chrome']);
for (let i = 0; i < rest.length; i++) {
  const k = rest[i];
  if (flags.has(k)) { opts[k.slice(2)] = true; continue; }
  if (!valued.has(k) || rest[i + 1] === undefined) { console.error('Unknown or incomplete argument: ' + k + '\n\n' + USAGE); process.exit(2); }
  const v = rest[++i];
  if (k === '--viewport') opts.viewport.push(v); else opts[k.slice(2)] = v;
}
if (!!opts.app === !!opts.url) { console.error('Give exactly one of --app or --url.\n\n' + USAGE); process.exit(2); }

let raw;
if (opts.app) raw = JSON.parse(await readFile(resolve(opts.app), 'utf8'));
else {
  const target = /^https?:\/\//.test(opts.url) ? new URL(opts.url) : pathToFileURL(resolve(opts.url));
  if (target.protocol === 'file:' && !existsSync(target)) { console.error('File not found: ' + opts.url); process.exit(2); }
  const base = target.protocol === 'file:' ? new URL('./', target).href : target.origin + '/';
  raw = { baseUrl: base, entry: [target.protocol === 'file:' ? target.href : target.pathname + target.search], ...structuredClone(DEFAULT_SAFETY) };
}
raw.budget = { ...(raw.budget ?? {}) };
for (const [flag, key] of [['max-states', 'maxStates'], ['max-actions', 'maxActions'], ['max-minutes', 'maxMinutes']]) if (opts[flag] !== undefined) raw.budget[key] = Number(opts[flag]);
if (opts.viewport.length) raw.viewports = opts.viewport.map(v => { const m = /^(\d+)x(\d+)$/.exec(v); if (!m) { console.error('Viewport must look like 390x844: ' + v); process.exit(2); } return { width: +m[1], height: +m[2] }; });

let cfg;
try { cfg = normalizeConfig(raw); } catch (e) { console.error('Config error: ' + e.message); process.exit(2); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
const out = resolve(opts.out ?? `artifacts/runs/${stamp}`);

const short = a => a?.label ?? '';
const print = opts.quiet ? () => {} : opts.json ? e => console.log(JSON.stringify(e)) : e => {
  switch (e.type) {
    case 'run-start': console.log(`agent-manuel: exploring ${e.baseUrl} (entry ${e.entry.join(', ')}) at ${e.viewports.join(', ')}; checks ${e.checks.join(', ')}\n  out ${e.out}`); break;
    case 'state': console.log(`  [state ${e.index}] ${e.label}  ${e.key}  (depth ${e.depth})`); break;
    case 'edge': console.log(`    ${e.status.padEnd(7)} ${short(e.action)}${e.reason ? ' — ' + e.reason : ''}`); break;
    case 'blocked': console.log(`    blocked ${short(e.action)} — ${e.reason}`); break;
    case 'finding': console.log(`    finding ${e.checkId} ${e.status}/${e.severity}: ${e.message} [${e.viewport}]`); break;
    case 'run-end': { const c = e.counts; console.log(`done: ${e.status} (${e.reason}). ${c.states} states; edges ${c.passed} passed, ${c.failed} failed, ${c.blocked} blocked, ${c.untried} untried; ${e.findings} findings.\n  report ${e.out}/report.html`); break; }
  }
};

const ac = new AbortController();
process.once('SIGINT', () => { console.error('\nStopping after the current action; the report will still be written.'); ac.abort(); });
const result = await run(cfg, { out, chromePath: opts.chrome, noSandbox: opts['no-sandbox'], print, signal: ac.signal });
process.exitCode = result.status === 'error' ? 1 : 0;
