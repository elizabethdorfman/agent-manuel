# Architecture contract for the MVP

Parallel work streams build against this contract. Change it only through the main thread, so all the streams stay in sync.

## Layout

```
src/
  cdp.mjs                 Chrome launcher (exists)
  runner/                 Stream A: explorer, ledger, replay, safety, run loop
  checks/
    index.mjs             Registry: export const checks = [alignment, typography, ...]
    alignment/            Port of src/collect.mjs + src/analyze.mjs (Stream C)
    typography/  contrast/            (Stream B)
    readability/          RD01: contrast + cut-off + overflow + covered, built on contrast/ and typography/
    hierarchy/   targets/   reflow/   (Stream C)
  judge/                  AI judge (later: needs the OpenRouter key)
  report/                 Run report (Stream A builds a minimal one)
apps/<app>/config.json    Per-app config (Girl Math: Stream A)
examples/demo-app/        Multi-screen app with planted bugs (Stream D)
```

## Check module

Each check lives at `src/checks/<name>/index.mjs` and exports the following.

```js
export const meta = { id: 'UI06', name: 'alignment', title: 'Required edges line up.' };

// Runs INSIDE the page. It must be self-contained: no imports or closures, because it is
// serialized with fn.toString() and evaluated through CDP Runtime.evaluate.
// It is read-only: no clicks, no style changes and no navigation.
export function collect(options) { return { /* JSON-serializable measurements */ }; }

// Runs in Node.
export function analyze(collected, ctx) {
  // ctx = { viewport:{width,height}, config: appConfig.checks?.[meta.name] ?? {}, screenshot?: Buffer }
  return {
    checkId: meta.id,
    findings: [{
      id: 'UI06-email-left',           // stable across runs for the same issue
      status: 'fail' | 'review',       // fail = a measured rule was broken; review = a lead for the AI or a person
      severity: 'high' | 'medium' | 'low',
      selector: '#email',              // primary element
      rect: { x, y, width, height },   // CSS px in document coordinates, used to draw the markup
      message: 'Plain-language sentence a non-engineer understands.',
      measurements: { /* the numbers that justify it */ },
    }],
    summary: { /* counts */ },
  };
}

// Variants, as implemented by src/runner/checks.mjs:
//  - a variant WITH an `id` is an EXTRA pass after the normal pass (typography's "-200" text scale), with ctx.variant set;
//  - variants WITHOUT an `id` are setup applied around the check's single pass (reflow's 320px viewport).
// A variant may carry `undo: {method, params}`; the runner applies it and then always re-applies the base viewport.
// Optional hook: export async function gather(send, collected) -> ctx.extra. CDP-side data (typography's fonts)
// is gathered right after collect, in the same page state.
// ctx.screenshot is a full-page PNG Buffer covering collected.capture when the check needs pixels (contrast).
// Optional: the browser actions the check needs before collect, for example a 200% text scale.
// Return a list of { method, params } CDP calls. The runner applies them, collects, then undoes them.
// The runner MUST restore the viewport and emulation afterwards: re-apply the state's base viewport,
// because variants carry no undo of their own.
export const variants = [];

// The runner passes the check's app config to BOTH collect(options) (as options.config) and analyze (as ctx.config).
// Alignment needs its rule selectors inside the page, and hierarchy needs titleSelector.
// See src/checks/_lib/c-browser.mjs for a reference harness that does all of this.
```

Every check must have the following:

- A **labelled fixture** at `examples/checks/<name>.html`. It contains planted problems and deliberate non-problems, each element with an `id`.
- An **expected file** at `examples/checks/<name>.expected.json` that maps each id to `fail`, `review` or `none`.
- A **test** proving `analyze(collect)` on that fixture matches the expected file exactly: no misses and no false alarms. Use the real-Chrome integration pattern in `test/signup.integration.test.mjs`. Skip the test cleanly if Chrome is missing.

## Runner (Stream A)

- **State key:** a hash of the normalized visible heading text, the sorted list of visible interactive controls (role plus accessible name), any open dialog, and the URL path. Query strings and ids in paths are normalized.
- **Actions:** buttons, links (same origin only), form fields (fill with a synthetic input class), browser Back and reload. They come from the CDP accessibility tree (`Accessibility.getFullAXTree`) and from `DOM` hit-testing for visibility.
- **Ledger:** `{ states: {key: {firstPath, screenshots, url}}, edges: [{from, action, to, status: passed|failed|blocked|untried, reason}] }`.
- **Replay:** every new branch starts in a fresh browser context. The runner replays the shortest known action path to the state, then takes one untried action.
- **Budget:** a maximum number of states, maximum actions and maximum minutes. When the budget runs out, the run stops cleanly and still writes the report.
- **Each new state:** for each viewport in the config (default 390×844 and 1280×800), run every registered check, save a screenshot and record the findings.
- **Output:** `artifacts/runs/<timestamp>/` with `ledger.json`, `states/<key>/` and `report.html`. Each state folder holds `<viewport>.png` and that state's own `findings.json`.
- **Each screen is analyzed in isolation (user decision, 2026-11-22).** Findings belong to exactly one state, and the report has one section per state: its screenshot, then its findings. Do NOT merge or deduplicate findings across states for now; the same issue on two screens appears twice, once under each screen. A run-level `findings.json` may exist only as a flat index that keeps the `state` field on every entry.

## Safety, which applies to every run and especially prod

App config holds the following, and the runner enforces it before every action.

```json
{
  "baseUrl": "https://www.coolgirlmath.com",
  "entry": ["/"],
  "sameOriginOnly": true,
  "denyActions": ["/publish|share|delete|pay|subscribe|upgrade|checkout|log ?out|sign ?out/i"],
  "denySubmitForms": ["/sign ?up|create account|register/i"],
  "blockRequests": ["*posthog*", "*stripe.com*", "*google-analytics*"],
  "allowAiConsent": false,
  "budget": { "maxStates": 40, "maxActions": 200, "maxMinutes": 15 },
  "syntheticInputs": { "story": "Bought a $4.50 latte and saved $20 for a trip. QA-SYNTHETIC" }
}
```

- An action matching a deny pattern is recorded as a `blocked` edge with its reason, and never clicked.
- `blockRequests` is applied with CDP `Network.setBlockedURLs`, so bot traffic never reaches analytics or payments.
- Every synthetic input contains the marker `QA-SYNTHETIC`, so any data that does land can be found and deleted.
- Sessions are guest-only and use a fresh profile. The runner never reuses a signed-in profile.
