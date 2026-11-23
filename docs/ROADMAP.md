# Roadmap

See [VISION.md](VISION.md) for the target system.

## Today (v0.1): the alignment evidence tool

- [x] CDP Chrome launcher with no Playwright, using a temporary profile with the sandbox on by default
- [x] Read-only DOM geometry collector covering element boxes and text runs
- [x] UI06 alignment analysis using explicit rules and observed-edge review candidates
- [x] HTML and SVG report with switchable layers
- [x] Unit tests (5 passing)
- [x] `npm run demo` passed against local Chrome on 2026-11-22. The aligned rule was within tolerance with a spread of 0px. The deliberate offset was flagged at 8px.
- [ ] Exercise the HTML layer toggles by hand

## Milestone 1: evidence for the first-round checks

The playbook's smallest useful first version applies **UI01, UI04, UI05, FL01–FL04, PA01 and PA02** wherever they apply.

- [ ] UI01 reflow: horizontal overflow at 320px, with the offending boxes
- [ ] UI04 target size: label and control hit areas plus hit tests, against 24px (WCAG) and 44px (app primary target)
- [ ] UI05 primary action: scroll into view plus a real click at 320 and 390px
- [ ] UI07 / FL02 focus trace: active element and Tab/Shift+Tab sequence
- [ ] UI03 contrast: computed colors for foreground and background, plus the ratio
- [ ] axe-core run on each reached state, keeping `incomplete` results for manual review
- [ ] Sanitized network recorder that keeps route names, outcomes and payload-present flags

## Milestone 2: the state model and coverage ledger

- [ ] State key from the visible view, auth class, capability flags and fixture state
- [ ] Queue keyed by (fixture, state, action), with replay prefixes and equivalence and loop bounds
- [ ] Fixture reset and reseed hooks for each app
- [ ] Per-edge records and a per-build coverage summary
- [ ] Seed expected branches from app route and flow definitions (`apps/<app>/flows.json`)

## Milestone 3: model-driven exploration

- [ ] Cheap-model action proposer using a screenshot or a11y snapshot plus a goal, with a seed and exact actions logged
- [ ] Variation strategies: reorder actions, choose a different valid action, or use a new input class
- [ ] Pairwise coverage for lower-risk dimensions such as width, motion and network speed
- [ ] Compare scripted coverage with model exploration, tracking branches, reproducible findings, false alarms and cost

## Milestone 4: reports a coding agent can use

- [ ] Bug report generator using the six-field format
- [ ] Commit-pinned source linking that separates *explains* from *suggests*
- [ ] Rerun of affected and nearby branches on the fixed preview

## Later

- Signed-in journeys: sign-in return, review corrections and first save (needs preview credentials and fixtures)
- SV checks: saved outcome, publishing and dreams
- Visual baselines for approved static states
- Native iOS as a separate target
- Automatic fix proposals

## Known gaps

- `checks/catalog.json` lists 64 IDs, including UX, JT, DM and RB families from playbook v4. The attached playbook PDF defines only UI, FL, PA and SV, which is 32 checks. The other families need their procedures written down.
