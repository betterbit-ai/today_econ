---
date: 2026-09-18
category: tool
source: manual
---

# ChatGPT reads can work while public editorial writes remain safety-blocked

## Situation

The DIEM OAuth MCP v4 worked in a fresh ChatGPT web chat: category-scoped
candidate reads and visual-library reads returned data. A first
`submit_editorial_package` attempt was rejected because editorial fields were
not nested under `editorial`. After correcting the package shape, ChatGPT
reported that its public-write safety inspection blocked the request before it
received a successful MCP result. The GitHub PR list and `diem/editorial/*`
branch list confirmed that no package PR or orphaned branch was created.

## What we learned

- A successful read or low-risk canary write does not prove that ChatGPT will
  authorize an unattended public editorial package write.
- `get_pending_candidate_pack(category=any)` can exceed the ChatGPT tool-output
  budget. Request `economy` and `issue` separately.
- Have the MCP compute the derived package `integrity.contentSha256`; the model
  should not need to hash its final JSON.
- The public-write safety refusal is upstream of Oracle. Repeating the write
  through GitHub CLI/API or another tool would bypass that boundary.

## Next time

Do not create the recurring Scheduled task until a normal manual ChatGPT web
package submission succeeds through an explicitly supported authorization
path. If the public-write safety inspection blocks it again, stop and ask the
user whether to redesign the handoff. Keep the package PR human-reviewed and
never let ChatGPT call the Instagram publish Action.
