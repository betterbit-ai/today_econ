---
date: 2026-08-09
category: bug
source: manual
---

# Published media identity must be the analytics source of truth

## Situation

The V2 publisher persisted Instagram Reel IDs in daily publication ledgers, but
the analytics collector still read only the legacy posts file. New Reels could
publish successfully and remain permanently invisible to 24-hour and seven-day
measurement. Unsupported metrics were also at risk of looking like zero.

## What we learned

Measurement registration must be derived from the same durable record that
declares external publication success. Missing permission, unsupported metrics,
and a true numeric zero are different states. Account follower changes overlap
multiple posts and can only be labeled as a window-level estimate, never exact
single-Reel attribution.

## Next time

Derive measurement targets from current and archived V2 ledger publications.
Persist supported values and explicit unavailable reasons separately, retry a
bounded number of times, and compare medians plus sample counts instead of only
the best viral result.
