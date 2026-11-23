# Persona journeys: product-design and UX review (draft)

The measured checks answer whether each screen is built right: alignment (UI06) and visual hierarchy (UI09). Persona journeys answer whether the product works for a real person trying to do something.

## How a journey runs

1. **Pick a persona and a goal**, for example "Maya, first time on her phone, wants to log today's coffee and see where her money went."
2. **The AI plays the persona.** At each screen it gets the screenshot, the measured text and buttons (the same packet as the checks), and the persona's goal and patience. Then:
   - **Before acting**, it writes what it *expects* to happen: "I think 'Review my amounts' will show my $6 coffee."
   - **It picks one action** from the controls on the screen. The explorer's safety rules still apply, so deny-listed actions can't be chosen.
   - **After the screen changes**, it says whether it got what it expected.
3. **The computer records each step:** the screen, the action, the expectation and the outcome, any backtracks and dead ends, and the alignment and hierarchy results for that screen.
4. **The journey ends** when the persona reaches the goal, gives up (patience runs out), or hits a blocked boundary, for example "AI consent: blocked by prod rules".

## What gets measured (hard numbers)

| Metric | Meaning |
|---|---|
| Goal reached? | yes, no, or blocked at a named step |
| Steps vs the shortest known path | extra steps mean friction |
| Backtracks and dead ends | Back presses, and screens with no useful next action |
| Expectation misses | Steps where the outcome didn't match what the persona expected. **This is the main signal of confusing UX** |
| Time to first value | Steps until the persona sees something useful about their money |

## What the AI judges (review findings, citing steps)

- **Clarity:** at each step, was the next action obvious? Which words confused the persona?
- **Copy:** jargon, vague labels, buttons whose label doesn't match what they do (for example "Leave the journal" going to sign-in).
- **Trust and privacy:** can the persona say what's private and what becomes public, and what AI does with their story? (PA07)
- **Product design:**
  - Is value shown before a commitment (account, consent)?
  - Does the number of steps match the payoff?
  - Is the tone consistent?
  - Are there dead ends?
- **Heuristics:** Nielsen's 10, applied to each step.

Every finding must cite a step number, a screen and an element. Any finding without those is dropped. These are **review** findings: insights for a person to judge, never automatic failures.

## Draft personas for Girl Math (guest flow)

| Persona | Goal | What it stresses |
|---|---|---|
| **Maya**, first-timer, phone, skims | Log today's coffee and see the total | Time to value, clear next step |
| **Priya**, privacy-cautious | Understand what's shared before allowing AI; she declines first | Consent clarity, decline path, what "public story" means |
| **Lee**, in a hurry, small 320px phone, one hand | Get through the intro fast | Skip, reachable buttons, overlays in the way |
| **Sam**, returning (later; needs test accounts) | Find yesterday's draft or story | Resume and sign-in return |
| **Jo**, keyboard only (later, with flow checks) | Finish the journal without a mouse | Focus order (FL02) |

## The report: per journey, then per screen

- **A storyboard:** a screenshot at each step, the persona's expectation versus what happened, and markers where it hesitated.
- **The metrics table** above.
- **Findings**, each tied to a step and a screen.
- **Each screen's alignment and hierarchy results**, still reported per screen in isolation.

## Needs

- The OpenRouter key, for a vision model that plays the persona and judges.
- Prod limits stay in force: guest only, no AI consent, no publishing. A blocked step is recorded as the end of a journey, not worked around.
