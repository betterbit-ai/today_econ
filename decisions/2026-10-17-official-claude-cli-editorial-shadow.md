---
date: 2026-10-17
scope: editorial-evaluation
status: active
source: user
---

# Compare subscription Claude through its official CLI without publishing

The user approved a reviewable Claude Pro / Sonnet comparison. Run pinned official Claude Code CLI in an isolated subprocess on a read-only Actions job. Reuse generateEditorial validation with fallback disabled. This supports the same bounded repair calls as Groq without splitting each request across Action steps or introducing a model API proxy. Official docs support OAuth CI/script authentication and programmatic structured output: https://code.claude.com/docs/en/authentication and https://code.claude.com/docs/en/cli-reference .

Use a clean temporary cwd/config, no tools or MCP, explicit OAuth-only environment and time/request limits. Never hand the model publishing credentials. No credential means no model calls. A fixed ten-article manifest records original ledger references and input hashes. Report actual execution and missing authentication separately; never treat mocked/historical results as live comparisons.

Rejected: direct Sonnet API (separate billing), subscription OAuth in a generic REST adapter (wrong authentication boundary), production provider replacement before evidence, and separate Action steps for every editorial repair (duplicates orchestration). No new npm application dependency; CLI 2.1.302 is installed only in evaluation runtime. Roll back by not invoking the manual comparison operation. Reconsider production integration only after paired comparisons and human review.
