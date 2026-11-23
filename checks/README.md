# The registry tracks the 64 catalog checks.

Each entry identifies one check from the existing playbook and whether a reusable evidence tool has been implemented. Only `UI06` currently has an evidence implementation. The other entries are planned and must remain unrun until their procedures are actually exercised.

Implementation status is different from a test result. `evidence-available` means that a tool can collect supporting evidence, not that an app passed the check. The alignment tool still requires an agent or person to interpret the measurements against the intended design.

Later evidence tools should use the same collection, analysis and report interface. They can add font and contrast measurements, hit-area maps, focus sequences, saved-data comparisons and journey traces without making the browser's exploration deterministic.
