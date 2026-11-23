# Vision: a QA runner that explores every reachable branch and proves what it covered

The target system explores every distinct, reachable branch of an app journey on a preview build. It verifies each state it reaches against a check catalog and reports coverage and bugs with enough evidence for a coding agent to reproduce and fix them.

The source of this vision is the Girl Math Onboarding QA Playbook ([`apps/girl-math/onboarding-qa-playbook.pdf`](../apps/girl-math/onboarding-qa-playbook.pdf)). The core tool stays app-agnostic. Girl Math is the first app it is configured for.

## The loop

```
Discover ──▶ Branch ──▶ Verify ──▶ Report
states and   replay and  apply      coverage
actions      vary        checks     and bugs
```

1. **Seed entry states.** Pin the preview revision. Create fixtures such as a fresh guest, a returning guest, a disposable new account and a returning account. Seed expected branches from the app's route and flow definitions. Confirm each state through visible controls.
2. **Discover and branch.** At every new state, inspect the visible actions and the accessibility tree, then queue plausible next transitions. Replay the shortest known path in a fresh fixture, then take a different action or use a new input class.
3. **Verify and diagnose.** Apply the relevant catalog checks to each state. Confirm findings with screenshots, browser measurements and state traces. Tie each distinct defect to a commit-pinned file, or label the likely cause as a hypothesis.
4. **Report what was reached.** Record passed, failed, blocked and untried transitions. Include replay steps and evidence for each distinct bug. On the fixed preview, rerun the affected branches and nearby alternatives.

## What "all paths" means

A path is a sequence through meaningful product states. Loops, free text and device combinations make the number of possible sequences unbounded. Each run therefore targets all modeled, reachable transitions within a declared scope. It samples additional variations and reports exactly which ones it tried.

A closed queue proves coverage of the recorded model. It cannot prove that every unknown branch was discovered.

## Components

| Component | Responsibility | Status |
| --- | --- | --- |
| **Evidence collectors** (`src/collect.mjs`, …) | Read-only DOM and geometry capture, such as boxes, text runs, focus, hit areas and contrast | Alignment geometry exists |
| **Analyzers** (`src/analyze.mjs`, …) | Turn evidence into per-check results: `within-tolerance`, `outside-tolerance`, `blocked` or `review-required` | Alignment (UI06) exists |
| **Report renderer** (`src/render.mjs`) | Self-contained HTML and SVG evidence with switchable layers | Exists |
| **Browser driver** (`src/cdp.mjs`) | Chrome DevTools Protocol only, with no Playwright in the core harness | Minimal launcher exists |
| **State model** | A state key built from the visible view, auth class, capability flags and relevant fixture state, not from the URL alone | Planned |
| **Coverage ledger** | A queue keyed by (fixture, state, action), with a replay prefix for each state, equivalence marking and loop bounds | Planned |
| **Explorer** | A cheap model proposes or selects actions from a screenshot or accessibility snapshot. It prefers unfamiliar branches and records seeds and exact actions | Planned |
| **Fixtures** | Reset or reseed the preview before each independent branch, using synthetic data only | Planned |
| **Bug reporter** | One issue per fixable behavior, using the fields below | Planned |
| **App config** (`apps/<app>/`) | Routes, flows, alignment rules, approved tokens and fixtures | Girl Math playbook only |

### The state key must not collapse distinct views

A URL or step number alone is not enough. In Girl Math, the journal editor and the AI permission screen both use step 1. If the state key were only the step, the two views would merge, and the runner would miss the Back and focus bugs found there. The key therefore combines the visible view, auth class, capability flags and fixture state.

### Model role

The model helps choose and vary navigation. **The model's opinion alone cannot fail a check.** A failure needs a measurement, a trace or a deterministic assertion behind it.

## Check catalog

The checks are grouped into families, and each check has an ID. The procedures live in the playbook. Status lives in [`checks/catalog.json`](../checks/catalog.json).

- **UI01–UI08: rendered interface.** Reflow at 320px, text resize, contrast, target size, primary action, edge alignment, focus visibility and design consistency.
- **FL01–FL08: transitions and recovery.** Journal reachable, consent focus, Back, draft survival, exit and resume, validation, async states and retry.
- **PA01–PA08: permission and account.** Real choice, permission-gated review, existing choices, permission errors, login usability, sign-out and return, privacy communication and motion preferences.
- **SV01–SV08: first saved outcome.** Extraction accuracy, corrections, private and public separation, idempotent publishing, dream exit, dream reopen, outcome clarity and performance baseline.
- **UX, JT, DM, RB:** reserved in `catalog.json` for later playbook versions.

## Bug report format

| Field | Contents |
| --- | --- |
| Identity and impact | Check ID, title, severity, affected visitor and what the defect prevents |
| Build and setup | URL, revision (or unknown), route, browser, viewport, visitor state and fixture |
| Reproduction | Numbered actions, expected and actual results, and repeat count (for example, 2 of 2) |
| Evidence | Before and after screenshots, accessibility snapshot, focused element or measurement, and sanitized network evidence |
| Code and fix | Commit-pinned file, line and symbol. State whether the source *explains* the behavior or only *suggests* it. Include an acceptance test and nearby behavior to preserve |
| Verification | Targeted result, regression result, preview revision and anything still untested |

## Per-edge and per-build records

For each edge, record the state, fixture, action, expected and actual destinations, outcome and an evidence link.

For each build, summarize the reached states, the exercised edges out of the known in-scope edges, blocked or untried branches and newly discovered edges.

## Ground rules

- Use synthetic data on isolated previews. Keep credentials, tokens and story payloads out of artifacts.
- Run network evidence as route names, outcomes and boolean flags, such as whether a payload was present.
- Keep the core free of app-specific selectors. App knowledge lives in `apps/<app>/`.
- Reserve automatic code fixes for a later iteration, once reports reliably let an agent reproduce the bug.
