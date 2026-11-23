# The swarm: how Agent Manuel's agents coordinate

A run is one coordinated swarm, not a set of independent bots. Agreed on 2026-11-22.

## 1. A shared map

- Every agent reads and writes one ledger of states and edges: the map.
- **Claims:** before taking an untried edge, an agent claims it, as in `{edge, agentId, claimedAt}`. A claim expires if the agent dies or stalls.
- **Marks:** agents record hazards and dead ends on the map, for example `blocked: deny-listed`, `blocked: needs account` or `dead end`, so the others skip them.

## 2. Pay once, share the state

- **Checkpoints:** at milestone states, such as "editor with draft", "consent open" and "review loaded", the agent that reaches the state saves a snapshot: cookies, localStorage, sessionStorage and the URL. Other agents restore the nearest checkpoint instead of replaying from the entry URL.
- **Expensive actions run once per run.** An action flagged `costly` in the app config, such as clicking Allow on AI consent, is done by a single agent. Everyone else restores the checkpoint that agent made after it.
- A replay from scratch is still used when a checkpoint can't be restored faithfully, for example server-side session state. The runner records which method reached each state.

## 3. Roles

| Role | Job | MVP? |
|---|---|---|
| Scout | Claim untried edges and discover new states | Yes |
| Inspector | Run every registered check on each new state at each viewport | Yes |
| Verifier | Reproduce each finding from a fresh session or checkpoint before it is reported | Next |
| Trickster | Revisit states with odd inputs: blank, very long, double-click, Back, refresh mid-save, 320px | Next |
| Judge | AI review of markups and readability, citing measurements | After the OpenRouter key |

## 4. Agents share findings

- A finding tied to a component, matched by selector or style signature, triggers a request to check every other state that contains that component.
- Duplicate findings merge into one bug with a list of the states where it appears.
- A new edge found by any role, for example "refresh during consent lands on the editor", is added to the map for the scouts.

## 5. Coordinator

- Hands out claims, prioritizing unexplored states first and then states with the most findings.
- Enforces run-wide limits: the budget, `costly` actions once per run, the prod daily run cap and the deny-list.
- Ends the run when the map has no unclaimed edges or the budget is spent, then writes the report.

## 6. Events for the live landing page

`events.jsonl` gains `agentId` on every event, plus these event types: `claim`, `checkpoint-saved`, `checkpoint-restored`, `finding-merged` and `verify`. The landing page animates each agent as its own coloured trail on the map.

## Girl Math prod settings (agreed)

- Guest only. Saving drafts is allowed, with every input tagged `QA-SYNTHETIC`.
- Never clicked: publish, share, delete, payment or upgrade, log out, sign-up submit.
- Blocked requests: PostHog, Stripe and Google Analytics.
- At most 5 prod runs per day.
- AI consent "Allow": not decided yet. The options are once per run with a checkpoint, or stop at consent.
