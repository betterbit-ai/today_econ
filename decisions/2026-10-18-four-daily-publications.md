---
date: 2026-10-18
scope: feature
status: active
source: user
---

# Permit two economy and two issue publications per KST day

## Decision

The user explicitly chooses four account publications total, split economy two and issue two, and requests seeing a real Claude publication today. Set the category cap to two in runtime defaults and both workflows. This supersedes only the one-per-category cap in earlier recovery decisions. Keep the existing staggered six-hour polling, quality gates, duplicate protection, Opus pin, and automatic operation. Four is a ceiling, not a quota. Shared publisher checks the category budget before a new upload, including preauthored Basic; reconciliation and independent post-publication recovery remain available. Basic sandboxes preserve the current news slot for counting, and new Basic publications use the actual day ledger. Only positively unattempted historical drafts may move to a new day; ambiguous or attempted records must reconcile first.

## Context and constraints

The two already published articles today used GPT-OSS before the Opus deployment. Raising the cap permits a second different quality article per category without rewriting historic records. Use the normal current-news Action for the real attempt. No archived fixture publication and no bypass of image review or factual safeguards.

## Alternatives considered

- Four per category: user explicitly rejected in favor of four total.
- Increase polling frequency or force four weak stories: unnecessary and contrary to the mission.
- Only raise the selection cap: direct ready/Basic publishing also needs a final budget check.

## Revisit when

Observe actual Opus publications, subscription usage, candidate skips and quality incidents. Restore one per category if volume exceeds available quality or subscription capacity.
