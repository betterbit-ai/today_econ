---
date: 2026-10-18
category: bug
source: harness-implement
---

# Keep rejected copy before diagnosing numeric validation

## Situation

The initial live Opus run rejected NPU-related numeric paraphrases, but only the errors and numbers remained. Human inspection of the source found a reproducible lexical-focus limitation: adding NPU to the company phrase could fail even though adjacent prose explains the device. The exact live rejected drafts were missing, so their individual validity could not be determined.

## What we learned

A number occurring somewhere in the article is not enough evidence for its subject, period, comparison or denominator. Conversely, a lexical-focus rule can overblock a legitimate paraphrase. Do not globally ignore acronyms or merge adjacent sentences to force throughput. First preserve the numeric owner's exact source-clause phrase in generation and retain bounded rejected copy. Final caption assembly is a separate failure boundary and also needs evidence. JSON parse errors may echo raw input, and existing error snippets can leak a value even when a new snapshot is redacted.

## Next time

Inspect only field-allowlisted, byte-bounded, redacted rejected snapshots alongside the source hash; never treat them as approved copy. Sanitize linked errors before saving, and use fixed parse errors. Require both positive and owner/period/denominator-swapping negative controls before a narrow numeric validator change. Track measured comparison results separately from a prompt change; retain historical failures as they happened.
