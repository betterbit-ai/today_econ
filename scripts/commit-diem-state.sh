#!/usr/bin/env bash
set -euo pipefail

intent="${1:-Preserve DIEM durable publication state}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A -- data/publications data/editorial-history.json

if git diff --cached --quiet; then
  echo "No durable DIEM state changed."
  exit 0
fi

git commit \
  -m "$intent" \
  -m "The intraday ledger remains the source of truth across hot-news selection, generation, publishing, and independent comment recovery.

Constraint: Durable state must be committed before and after external publishing
Confidence: high
Scope-risk: narrow
Directive: Do not commit .diem-cache media; retain only hashes and rights metadata
Tested: State schema and idempotent workflow tests
Not-tested: Live Instagram response for this run"
git pull --rebase origin "${GITHUB_REF_NAME:-main}"
git push origin "HEAD:${GITHUB_REF_NAME:-main}"
