# Girl Math app configuration

This folder holds Girl Math–specific QA inputs. The core tool in `src/` must not depend on anything here.

- `onboarding-qa-playbook.pdf` is the onboarding QA playbook. It covers the branch map, the check catalog (UI, FL, PA and SV), observed failures and the bug report format. The source references are pinned to girl-math commit `3287fadfd7b0709fd99671ee6c3f4b2a06e4cdd2`.

Planned additions:

- `rules.json`: alignment rules (UI06) for the onboarding screens
- `flows.json`: onboarding states and expected transitions used to seed the coverage queue
- `fixtures/`: synthetic guest and account fixtures (never real credentials)

Captured artifacts go in `artifacts/`, which git ignores. Don't commit screenshots of real user content.
