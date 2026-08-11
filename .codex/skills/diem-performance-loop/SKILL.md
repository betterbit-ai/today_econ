---
name: diem-performance-loop
description: Analyze DIEM Instagram Reel performance from GitHub publication ledgers, distinguish reach from saves, shares, retention, and follow conversion, identify repeated winner or underperformer patterns only after minimum samples, inspect editorial and image fallback failures, and turn evidence into bounded publishing improvements. Use after new Instagram insights arrive, during a weekly content review, when average Reel performance falls, when a viral Reel should be understood without overfitting, or when the user asks which DIEM topics, titles, images, or music to repeat or stop.
---

# DIEM Performance Loop

Use the repository ledger as the source of truth. Improve the median without
loosening DIEM's accuracy, rights, duplicate, person-safety, or editorial gates.

## Workflow

1. Read `spec/mission.md`, `spec/spec.md`, active decisions, and relevant learnings.
2. Check `git status`. When the user requests the latest remote state, update only
   with a safe fast-forward/rebase that preserves local work.
3. Refresh due Instagram evidence with the existing `collect_insights` GitHub
   Action or `node src/collect-insights.js` when credentials are available.
4. Run `node src/v2/index.js performance-report`.
5. Read `data/reports/diem-performance.md` and its JSON source, then inspect the
   referenced publication ledgers for the actual title, caption, image, audio,
   time, failures, and moderation state.
6. Compare `24h`, `72h`, and `7d` separately. Never mix observation windows.
7. Separate the funnel:
   - views/reach: discovery;
   - average watch time: retention;
   - shares/saves: reader utility;
   - profile views and follower delta: conversion, with account-level caveats.
8. Call a pattern a winner or underperformer only when its category has at least
   five comparable samples and the feature has at least three samples. Treat a
   single viral Reel as a hypothesis, not a rule.
9. Inspect operational quality alongside performance:
   - `no_candidate_passed_editorial_generation` and model/title-repair details;
   - typography fallback rate and provider/query rejection reasons;
   - deleted or corrected posts;
   - track and mood concentration.
10. Propose or implement one bounded change at a time. Add regression tests,
    record durable learnings/decisions, run the harness verification and review,
    then ship only when requested.

## Guardrails

- Never reward clickbait, unverified claims, wrong certainty, unrelated people,
  unsafe image rights, or recent duplicate topics/images because they got reach.
- Performance prior may reorder otherwise qualified candidates, but may not make
  a failed candidate pass a hard gate.
- Do not blacklist a topic from one poor post or clone a viral title mechanically.
- Do not interpret account follower growth as a single Reel's exact contribution.
- Missing metrics stay unavailable; do not coerce them to zero.
- Add music only after concentration exceeds the documented threshold or repeated
  evidence shows fatigue. Music is not assumed to cause reach.

## Deliverable

Report the comparable sample size, median, winners, underperformers, missing data,
image fallback rate, music concentration, changes made, verification evidence,
and remaining uncertainty. Link the Markdown report and affected ledger files.
