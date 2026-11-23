# QA Evidence creates measurements for reviewers.

> **Where this is going:** this repo is the first building block of a branch-exploring QA runner. See [`docs/VISION.md`](docs/VISION.md) for the target system and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what exists today and what comes next.

This is the first standalone component of the external QA tool. It collects rendered browser geometry and builds alignment evidence for an AI agent or a person to review. The library contains no Girl Math-specific selectors or app dependencies. The supplied app-specific example is separate from its core code.

The first implementation supports alignment evidence for catalog check `UI06`. It does not implement the other 63 checks, the agent swarm, the shared path explorer or the OpenRouter model runner. The registry in `checks/catalog.json` keeps those checks visible as planned work.

## The report exposes what the page rendered.

- It draws measured element boxes around headings, text, images and controls, and offers a separate layer for text-line boxes.
- It draws observed shared-edge and centre guides within related containers.
- It measures explicitly supplied alignment relationships and records missing targets as blocked.
- It identifies nearby edges of similarly sized blocks as review candidates. It does not automatically call those candidates design bugs.
- It exports a screenshot, JSON evidence, a standalone annotated SVG and a self-contained HTML report with switchable annotation layers.

Element references and CSS selectors link the annotation back to the page. Coordinates are CSS pixels. A screenshot and its geometry must come from the same screen, scroll position and viewport. Intentional indentation, optical alignment, transforms and decorative artwork need visual review.

## Run the collector with a local Chrome installation.

Use Node.js 22 or newer and an installed Chrome or Chromium. No package installation or Playwright dependency is required.

```sh
node bin/alignment.mjs \
  --url https://your-app.example/onboarding \
  --width 390 --height 844 \
  --rules ./examples/rules.json \
  --out ./artifacts/onboarding
```

Replace the example rules with selectors from your own app. Omit `--rules` to collect general alignment evidence without asserting design relationships. Set `CHROME_BIN` or use `--chrome /absolute/path/to/chrome` when automatic executable discovery does not find Chrome.

The command launches a separate temporary browser profile. It does not reuse a signed-in profile or create a test account. Use a harness adapter to collect authenticated screens after normal login. The CLI uses Chrome's debugging protocol directly.

The browser runner retains Chrome's sandbox by default. `--no-sandbox` is an explicit option for a disposable environment that cannot use Chrome's sandbox; it does not resolve an environment that disallows sockets.

For the intentionally offset example page, run:

```sh
npm run demo
```

This fixture has one shared-edge rule that should be within tolerance and one deliberate 8 CSS pixel offset that should exceed its 2 CSS pixel tolerance. It also contains hidden, transparent and clipped text for collector checks.

## An existing agent harness can provide the capture.

Import `collectEvidence` from `src/collect.mjs` and evaluate its function source through the harness's supported read-only page-evaluation API. Pass the current screenshot beside the returned JSON. Do not replace your harness's supported browser controls with this library. The collector itself reads the DOM; it does not click, navigate, inject overlays or change page styles.

```js
import { collectEvidence } from './src/collect.mjs';
const expression = `(${collectEvidence.toString()})(${JSON.stringify({
  fullPage: false,
  rules: []
})})`;
// Evaluate expression using your harness's documented read-only DOM API.
// Capture that same viewport using the same harness.
```

The wrapper must await fonts and layout before taking the snapshot. The standalone runner waits for loading and fonts; a moving or asynchronously changing screen can still require recapture. Browser permissions, account setup, credentials and state replay remain the caller's responsibility.

Build an HTML report from an existing capture without launching another browser:

```sh
node bin/render.mjs \
  --evidence ./capture.json \
  --screenshot ./capture.jpg \
  --out ./artifacts/review
```

When rules are supplied at collection time, the JSON records the matching element IDs. Pass the same rules to the render command to evaluate them. The renderer cannot resolve a new selector from a screenshot or invent a missing DOM match.

## App configuration describes the intended relationships.

The core tool does not know that a headline must align with a photograph. Put that expectation in the app's configuration, and review it against the approved design.

```json
{
  "rules": [
    {
      "id": "story-column",
      "selectors": ["#headline", "#hero", "#save"],
      "axis": "left",
      "tolerance": 2
    }
  ]
}
```

Supported axes are `left`, `right`, `centerX`, `top`, `bottom` and `centerY`. Each supplied selector needs a visible target and the rule needs at least two distinct elements. Two CSS pixels is the initial configurable tolerance, not a universal design standard.

## The current validation has limits.

Five analysis and rendering tests pass, covering tolerance boundaries, missing targets, unrelated groups, nested elements, invalid geometry and escaping page content. A live read-only collection on Girl Math's signed-out journal editor recorded 10 element boxes and five text runs at 1363 by 936 CSS pixels. It produced no automatic nearby-edge candidates on that screen. No explicit design rule was supplied for that capture, so it is not an alignment pass.

On November 22, 2026, `npm run demo` completed against local Chrome on macOS at 390 by 844 CSS pixels. It recorded nine element boxes and seven text runs. The `approved-story-left-edge` rule was within tolerance with a spread of 0. The `deliberate-offset-example` rule was outside tolerance with a spread of 8, and the run produced five nearby-edge review candidates. The HTML layer-toggle interaction has not yet been exercised by hand.

## Treat the output as evidence with a defined scope.

The collector currently covers ordinary rendered DOM text and media boxes. It does not OCR text in pictures or canvas, traverse shadow roots or cross-origin frames, inspect pseudo-element text, or scroll to load all virtualized and lazy content. Complex masks and transformed text need manual review. Full-page capture has a height limit and does not represent horizontal content outside the current viewport.

Form values and editable text are excluded from JSON collection, but ordinary page text, labels and screenshots can contain private content. Use dedicated QA data and decide what can be shared before sending artifacts to a model provider. Keep account secrets and API keys in an ignored environment file, never in these artifacts.

The alignment report deliberately returns `review-required`. Individual explicit relationships return `within-tolerance`, `outside-tolerance` or `blocked`. An agent should cite element IDs and measurements, compare them with the intended layout, and decide whether a finding deserves a bug ticket. This tool does not certify readability, accessibility compliance or application coverage.

## Keep reusable code and app configuration separate.

Publish this package in the QA tool's own open-source repository. Each app can keep its own rules and approved references. App credentials, captured private content and generated run artifacts stay outside public source control. The core modules can later be called by a CLI, MCP server or API without moving them into the app.

## Run the tests.

```sh
npm test
```
