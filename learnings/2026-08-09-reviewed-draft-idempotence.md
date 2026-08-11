---
date: 2026-08-09
category: architecture
source: manual
---

# Human approval must bind to immutable draft content

## Situation

DIEM needed a weekly educational series that could be generated automatically
but must never reach Instagram without operator review. Adding a third service,
database, or Slack inbound approval server would violate the operating model.

## What we learned

A GitHub Action dispatch is sufficient approval only when it names one exact
publication key and the approved durable content hash still matches. Preview
media can live in a public GitHub prerelease while the ledger stores rights,
source, artifact hashes, review state, and external publication results. Reel
success and Story or comment failures must remain independently recoverable.

## Next time

Fail closed on a wrong key, changed content, unreviewable state, or an already
published Reel. Keep initial approval separate from operational recovery, and
reconcile exact Instagram content before any retry that might otherwise create
a duplicate.
