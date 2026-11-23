// Check registry. The runner runs every module in `checks` on every new state, at every
// configured viewport. Each module follows the contract in docs/ARCHITECTURE.md.
//
// SCOPE (user decision, 2026-11-22): only alignment and visual hierarchy are active.
// The other checks are built and tested, but parked. Their tests still run so they keep working.
import * as alignment from './alignment/index.mjs';
import * as hierarchy from './hierarchy/index.mjs';

export const checks = [alignment, hierarchy];

// Parked, built and tested but not run yet:
//   ./typography/index.mjs (TY01)   ./contrast/index.mjs (UI03)
//   ./targets/index.mjs   (UI04)    ./reflow/index.mjs   (UI01)
