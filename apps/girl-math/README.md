# Girl Math app configuration

This folder holds Girl Math–specific QA inputs. The core tool in `src/` must not depend on anything here.

- `config.json` holds the guest-only, prod-safe exploration settings for coolgirlmath.com.
- The onboarding QA playbook (branch map, check catalog, observed failures, bug report format) is kept privately, because it references Girl Math's private source.

Planned additions:

- `rules.json`: alignment rules (UI06) for the onboarding screens
- `flows.json`: onboarding states and expected transitions used to seed the coverage queue
- `fixtures/`: synthetic guest and account fixtures (never real credentials)

Captured artifacts go in `artifacts/`, which git ignores. Don't commit screenshots of real user content.
