// The ledger: every state reached and every (state, action) edge with its outcome.
// Edges start as `untried` and become passed, failed or blocked. Edges left untried when
// the run stops (budget, repeat cap, depth cap) keep a reason.
import { appendFileSync, writeFileSync } from 'node:fs';
import { actionSignature } from './discover.mjs';

export class Ledger {
  constructor() { this.states = {}; this.edges = []; this.order = []; }

  hasState(key) { return key in this.states; }
  addState(key, info) { this.states[key] = { ...info, screenshots: {}, checks: {} }; this.order.push(key); return this.states[key]; }

  addEdge(from, action, status = 'untried', reason) {
    const e = { from, action, to: null, status, ...(reason ? { reason } : {}) };
    this.edges.push(e); return e;
  }

  /** Shortest-path first: the first open edge of the shallowest state. */
  nextOpen() {
    let best = null;
    for (const e of this.edges) {
      if (e.status !== 'untried' || e.closed) continue;
      const d = this.states[e.from].depth;
      if (!best || d < this.states[best.from].depth) best = e;
    }
    return best;
  }

  counts() {
    const c = { states: this.order.length, edges: this.edges.length, passed: 0, failed: 0, blocked: 0, untried: 0 };
    for (const e of this.edges) c[e.status]++;
    return c;
  }

  toJSON() {
    return {
      states: this.states,
      edges: this.edges.map(({ closed, emitted, ...e }) => e),
    };
  }
}

/** Merges per-state findings into one entry per (checkId, id), with every place it showed up. */
export class Findings {
  constructor() { this.byKey = new Map(); }
  add(checkId, finding, where) {
    const k = checkId + '\u0000' + finding.id;
    const existing = this.byKey.get(k);
    if (existing) { existing.occurrences.push(where); return false; }
    this.byKey.set(k, { checkId, ...finding, occurrences: [where] });
    return true;
  }
  list() { return [...this.byKey.values()]; }
}

/** events.jsonl writer plus human progress lines. Event types are a stable public format. */
export const EVENT_TYPES = Object.freeze(['run-start', 'state', 'edge', 'blocked', 'finding', 'run-end']);
export class EventLog {
  constructor(file, print = () => {}) { this.file = file; this.print = print; writeFileSync(file, ''); }
  emit(type, data) {
    if (!EVENT_TYPES.includes(type)) throw new Error('Unknown event type ' + type);
    const event = { type, t: new Date().toISOString(), ...data };
    appendFileSync(this.file, JSON.stringify(event) + '\n');
    this.print(event);
    return event;
  }
}

export { actionSignature };
