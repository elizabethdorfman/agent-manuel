// Check registry. The runner runs every module in `checks` on every new state, at every
// configured viewport. Each module follows the contract in docs/ARCHITECTURE.md.
//
// SCOPE (user decision, 2026-11-22): three checks are active: alignment (UI06), visual
// hierarchy (UI09) and readability (RD01 = contrast + cut-off + overflow + covered).
// Readability reuses the contrast (UI03) and typography (TY01) clipping logic, so those two
// stay as parked modules. The other checks are built and tested, but parked. Their tests
// still run so they keep working.
import * as alignment from './alignment/index.mjs';
import * as hierarchy from './hierarchy/index.mjs';
import * as readability from './readability/index.mjs';

export const checks = [alignment, hierarchy, readability];

// Parked, built and tested but not run yet:
//   ./contrast/index.mjs   (UI03)    used by readability (R1)
//   ./typography/index.mjs (TY01)    its clipping rule is used by readability (R2)
//   ./targets/index.mjs    (UI04)    ./reflow/index.mjs   (UI01)
