# Force Overwrite of Daily Ledger on Plan Phase

## Context
When regenerating a daily plan (e.g., via GitHub Actions `plan` phase), the orchestrator was using a shallow merge `updatePublication` to apply the newly selected candidate to the daily ledger (`data/publications/.../YYYY-MM-DD.json`). Because of this shallow merge, the `editorial`, `artifacts`, `reel`, and other execution states from a previous run were preserved. This caused subsequent `prepare` phases to skip generating the editorial, resulting in the re-publication of low-quality or obsolete assets even after deleting the old Reel and forcing a re-run.

## Decision
We updated `applyPlan` in `src/v2/orchestrator.js` to completely replace the publication state for a selected category, stripping away any old execution artifacts and ensuring a fresh `planned` state. We also set `force: true` as the default in `src/v2/index.js` for the `plan` command, and explicitly added `--force` to the `"diem:plan"` script in `package.json`. 

## Consequences
- Any execution of `npm run diem:plan` will unconditionally wipe any existing generation artifacts for that day from the JSON ledger, forcing a complete regeneration.
- Prevents accidental reuse of stale LLM responses when a pipeline is restarted.
- Fixes the bug where users were unable to regenerate content using new prompts or models on the same day.
