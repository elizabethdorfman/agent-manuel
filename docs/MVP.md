# MVP: visit every screen and check each one

> **Scope for now (2026-11-22):** only two checks are active, **alignment (UI06)** and **visual hierarchy (UI09)**. Typography, contrast, tap targets and reflow are built and tested, but parked. Next: product-design and UX review through **persona journeys** (see docs/PERSONAS.md). The explorer navigates just to reach each screen, then each screen is checked and reported on its own. Flow checks (does Back return to the editor, does focus land in the right place, does a draft survive a refresh) are planned next, but they don't produce findings yet.

**Goal:** point the tool at a preview URL. It reaches every screen and state it can, checks each one, and returns one report showing what it reached and what's wrong.

## 1. Explore: reach every screen and state

- Start from a fresh guest session at the entry URL.
- On each screen, list every action the visitor can take: buttons, links, form fields, Back and reload. The list comes from the accessibility tree and clickable elements.
- A cheap AI model fills forms with realistic synthetic input, for example a valid story, a blank entry or a very long entry. It also chooses which untried action to take next.
- A **state** is identified by what is on screen: heading, visible controls and dialog. The URL is not enough, because the Girl Math editor and consent screen share step 1.
- Every (state, action) pair is recorded in a ledger. To try a new branch, the explorer starts a fresh session and replays the shortest known path to that state, then takes a different action.
- Exploration stops when no untried actions are left, or when the step or time budget runs out.
- **Out of scope for the MVP:** signed-in flows, real accounts and payments. These are listed as "blocked" in the report.

## 2. Check every new state

On each newly reached state, the tool captures the screen at 390px and at 1280px wide, then runs these checks:

| Check | What the computer measures |
|---|---|
| UI06 alignment | Shared edges and near-misses (exists) |
| UI09 hierarchy | Visual-weight ranking of each element |
| Typography | Rendered font vs declared font, minimum size, line height, clipped text |
| UI03 contrast | Text colour vs the background pixels behind the text |
| UI04 tap targets | Clickable area of each control vs 24px and 44px |
| UI01 reflow | Horizontal overflow at 320px |

## 3. Ask the AI: "is anything unreadable?"

For each state, one AI call receives:

- the screenshot plus the markups (alignment, hierarchy, squint view)
- **every piece of text and every button**, each with its ID and the measured facts: font size, weight, colour, background colour, contrast ratio and whether it is clipped
- a cropped image of each text element

The question: *"Is any text or button hard to read or unreadable? For each one, give its ID and the reason: too small, low contrast, over an image, cut off, overlapping, or confusing wording."*

The computer then checks each answer against the measurements. A finding that cites the wrong element or wrong numbers is dropped. The AI can surface problems the rules miss, such as text over a busy photo, but every finding must point to a real element.

## 4. Report

- **Coverage:** every state reached, as a map with a screenshot of each. Each edge is marked passed, failed, blocked or untried.
- **Findings:** each problem appears once, even if several screens show it. Each finding includes the check ID, screenshot crop, measurements, the AI's reason if there is one, and replay steps to reach that screen.

## Done when

- [ ] On Girl Math's guest onboarding preview it reaches intro → editor → consent → review, plus Back, decline and reload branches. Login is reported as blocked.
- [ ] Every reached state has check results and an AI readability verdict.
- [ ] Labelled test pages prove each check catches its planted problems with no false alarms. One page has deliberately unreadable text for the AI pass.
- [ ] The report replays every finding.
