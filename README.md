# Agent Manuel does your manual testing.

Agent Manuel is a QA runner in progress. The goal is to explore every screen and state of an app, check each one with real browser measurements and an AI judge, and report what it reached and what's broken. Today it ships its first piece: alignment evidence (check UI06), described below.

> **Where this is going:** this repo is the first building block of a branch-exploring QA runner. See [`docs/VISION.md`](docs/VISION.md) for the target system and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what exists today and what comes next.

This is the first standalone component of the external QA tool. It collects rendered browser geometry and builds alignment evidence for an AI agent or a person to review. The library contains no Girl Math-specific selectors or app dependencies. The supplied app-specific example is separate from its core code.

The first implementation supports alignment evidence for catalog check `UI06`. It does not implement the other 63 checks, the agent swarm, the shared path explorer or the OpenRouter model runner. The registry in `checks/catalog.json` keeps those checks visible as planned work.

## The report exposes what the page rendered.

- It draws measured element boxes around headings, text, images and controls, and offers a separate layer for text-line boxes.
- It draws observed shared-edge and centre guides within related containers.
- It measures explicitly supplied alignment relationships and records missing targets as blocked.
- It flags an element as a review candidate when it sits just off a left edge shared by more elements in its alignment group. It does not automatically call those candidates design bugs, and it does not repeat elements that a supplied rule already measures.
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

Two example pages are included.

```sh
npm run demo
npm run demo:signup
```

`npm run demo` runs `examples/alignment.html`, a minimal fixture. Its `broken-on-purpose-check` rule targets a block that was moved 8 CSS pixels on purpose to prove that a violation is detected; it should exceed its 2 CSS pixel tolerance. The `approved-story-left-edge` rule should be within tolerance. The page also contains hidden, transparent and clipped text for collector checks.

`npm run demo:signup` runs `examples/alignment-signup.html`, a 390 by 844 signup screen with a main column at x=24. It mixes intentional design offsets with planted bugs, and `examples/alignment-signup.expected.json` labels every element:

- Aligned: the headline, intro, field labels, password input, "or" line and Apple button.
- Deliberate and ignored without configuration: a bulleted list indented 20 pixels, which is beyond the 12 pixel near limit, and a pull-quote and a card, which are separate alignment groups (`figure` and `section`).
- Deliberate and declared: a password hint indented exactly 8 pixels. Geometry alone would treat it as a near miss, so `hint-indented-8px` declares an `offset` of 8.
- Accidental and declared: the email input is 4 pixels left of the column and the "Create account" button is 7 pixels left. Their rules report `outside-tolerance`.
- Accidental and undeclared: the terms paragraph is 5 pixels right of the column and has no rule. It is caught only by the automatic candidates.

The report is written to `artifacts/signup/report.html`.

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

Declare an intentional offset with `offset` in CSS pixels. The first selector's targets are the reference, and targets of later selectors are expected at the reference plus the offset on the rule's axis. The result records `expectedOffset`, each target's measured value, expected value and deviation, and a `spread` measured after the expected offset is removed. Without `offset`, every target is expected on the same line.

```json
{ "id": "hint-indented-8px", "selectors": ["#password", "#password-hint"], "axis": "left", "offset": 8, "tolerance": 2 }
```

Automatic candidates cover relationships that no rule declares. Within one alignment group, the analyzer clusters left edges that sit within the tolerance of each other. It flags an element once when it is more than the tolerance and at most 12 CSS pixels (`near`) from a cluster that is larger than the element's own cluster. Only similarly sized, vertically separated, unclipped and unnested blocks at least 60 pixels wide count toward that cluster.

## The current validation has limits.

`npm test` runs 11 analysis and rendering unit tests and one Chrome integration test. The unit tests cover tolerance boundaries, offset rules, missing targets, unrelated groups, nested elements, candidate cluster sizes, rule-target exclusion, invalid geometry and escaping page content. The integration test runs the CLI on the signup fixture and requires the rule verdicts, the per-element outcomes and the candidate list to match `examples/alignment-signup.expected.json` exactly. It is skipped with a message when Chrome cannot be found.

On November 22, 2026, `npm run demo:signup` completed against local Chrome on macOS at 390 by 844 CSS pixels. It recorded 18 element boxes and 16 text runs. `password-on-column` and `hint-indented-8px` were within tolerance with a deviation of 0. `email-on-column` was outside tolerance with a deviation of -4 pixels, and `create-button-on-column` was outside tolerance with a deviation of -7 pixels. The only automatic candidate was `#terms`, 5 pixels right of the left edge at x=24 shared by five elements. No aligned or deliberately offset element was flagged.

On the same day, `npm run demo` recorded nine element boxes and seven text runs. `approved-story-left-edge` was within tolerance with a spread of 0 and `broken-on-purpose-check` was outside tolerance with a spread of 8. It produced no automatic candidates, because the offset block is already measured by a rule and the indented artwork is in a separate group.

These fixtures were designed together with the analyzer, so they show that the logic works as described; they do not measure its accuracy on real apps. An intentional offset smaller than 12 pixels that has no rule will be flagged, and an accidental offset larger than 12 pixels, or one in an element that has its own large cluster, will not. A live read-only collection on Girl Math's signed-out journal editor, made with an earlier version of the candidate logic, recorded 10 element boxes and five text runs at 1363 by 936 CSS pixels and produced no candidates. No explicit design rule was supplied for that capture, so it is not an alignment pass. The HTML layer-toggle interaction has not yet been exercised by hand.

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
