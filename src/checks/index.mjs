// Check registry. The runner runs every module in `checks` on every new state, at every
// configured viewport. Each module follows the contract in docs/ARCHITECTURE.md:
//   export const meta = { id, name, title }
//   export function collect(options)   // runs in the page; self-contained and read-only
//   export function analyze(collected, ctx)   // runs in Node
//   export const variants = [{ method, params, undo? }]   // optional CDP calls applied before collect
// The runner applies all of a check's variants, collects, then undoes them in reverse order.
// Known Emulation.* methods are undone automatically; any other method needs an `undo`
// entry of the same { method, params } shape.
import * as alignment from './alignment/index.mjs';
import * as hierarchy from './hierarchy/index.mjs';
import * as targets from './targets/index.mjs';
import * as reflow from './reflow/index.mjs';

import * as typography from './typography/index.mjs';
import * as contrast from './contrast/index.mjs';

export const checks = [
  alignment, hierarchy, targets, reflow,
  typography, contrast,
];
