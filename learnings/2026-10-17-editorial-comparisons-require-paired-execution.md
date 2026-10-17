---
date: 2026-10-17
category: evaluation
source: implementation
---

# A model comparison needs paired executions, not missing-data scores

Freeze both the article input hash and original publication reference. Use identical explicit prompts and the same validators with cross-model fallback disabled. Preserve failed drafts as well as accepted outputs so reviewers can distinguish model errors from over-strict validation and information lost during repair.

Missing OAuth, exhausted quota or a missing native runtime is unavailable evidence, not a zero-quality answer. A paired-completion count keeps two model denominators visible. Stop unavailable providers and keep a batch deadline so an evaluation cannot consume unlimited subscription usage or block publishing.

Subscription Claude uses the official native client, an empty working/config directory, an environment allowlist and no tools/MCP. A schema-valid or gate-passing draft still needs a bounded factual/editorial review before production provider changes. Preview and mocked tests cannot establish actual model superiority.

The first cloud build failed before model execution because the full suite also needs services/diem-mcp dependencies and neutral mock-publishing environment defaults. Reuse the diagnostic workflow's dependency installation and env-unset contract. Production Story switches and credential-source selection must not contaminate unit-test behavior; a CI environment failure is not model evidence.

Live run 39002322293 authenticated Sonnet successfully but Groq hit its 8000 TPM window on the first repair. Comparison-only Groq calls now wait 65 seconds after a successful response; reserve that wait plus the 120-second request timeout before the batch deadline. Keep the original incomplete run. Elapsed time includes throttling and cannot measure pure generation speed.

Paired run 39002555889 showed both sides of validator error: Groq's accepted presidential draft confused the photo date/setting with the actual X statement and changed a candidate's office; Claude's source-backed resale restriction and tax figures were rejected, encouraging number-free repairs. Always distinguish factual mistakes, validator false rejections, and information lost during repair. A higher pass rate alone is not editorial readiness.

Unexpected JSON shapes must be stored as capped text. Projecting an array or unrelated object to titleCandidates/sentences silently discards a failed draft. Preserve the evidence gap in past runs rather than filling it with a new generation.
