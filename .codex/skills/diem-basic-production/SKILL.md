---
name: diem-basic-production
description: Research, write, verify, package, and refresh preauthored DIEM Basic educational Reels stored under content/diem-basic. Use when adding or revising beginner finance curriculum, checking official-source accuracy, rebuilding committed cover/Reel artifacts, reviewing a package before its scheduled publication, or turning performance evidence into the next bounded DIEM Basic batch. Do not use for real-time hot-news Reels.
---

# DIEM Basic Production

Create evergreen beginner-finance content before its publication date. Keep topic selection,
research, copy, design, approval, and artifact generation outside GitHub Actions so the
scheduled job only verifies and publishes immutable packages.

## Start here

1. Read `spec/mission.md`, the DIEM Basic amendment in `spec/spec.md`,
   `content/diem-basic/README.md`, and active DIEM Basic decisions/learnings.
2. Read `references/official-source-checklist.md` before researching.
3. Read `references/editorial-design-template.md` before drafting copy or visuals.
4. Use `$korean-editorial-humanizer` after claims are frozen and before approving any
   lesson or caption copy. Its fact-preserving Korean voice pass is mandatory.
5. Inspect `content/diem-basic/manifest.json` and the last two packages to preserve the
   series contract without copying a topic or visual motif.

## Workflow

### 1. Select a curriculum question

- Choose a question a beginner will repeatedly search, save, or revisit.
- Prefer stable concepts with a clear decision or distinction: tax wrapper, product
  structure, interest calculation, credit, insurance, pensions, housing finance.
- Reject one-off news, proposed policy without enacted rules, product promotion, stock
  picks, return promises, and topics whose useful answer cannot fit five short lesson cards.
- Record one learning objective and 3–5 keywords before researching.

### 2. Build an evidence map

- Use at least two official primary sources from different organizations.
- Prefer current law and regulator/exchange/central-bank source pages over news summaries.
- Write atomic claims first; map every claim to one or more source IDs.
- Separate stable definitions from time-sensitive figures or thresholds.
- Set a shorter `review.expiresAt` for tax, benefit, eligibility, rate, or regulatory numbers.
- If sources conflict or a proposal is not enacted, stop. Do not smooth uncertainty into
  a definite claim.

### 3. Write the editorial package

- Lesson Reel: exactly five scenes in this order: cover question, plain definition,
  mechanism/comparison, caution/misconception, one-line summary.
- Durations: exactly 3, 4, 5, 4, and 3 seconds (19 seconds total).
- Every non-cover scene must map to one or more verified claim IDs. A summary may only
  reuse verified claims; it must not introduce a new number or conclusion.
- Title: exactly two non-empty lines, at most 14 graphemes total, concrete and searchable.
- Caption: supplementary copy, exactly three sentences separated by blank lines; each at
  most 120 graphemes. Never leave the core lesson only in the caption.
- Lesson bodies and captions use natural Korean `해요체`. Begin from a reader's real
  question, remove editor stage directions, and read every line aloud. Do not preserve an
  awkward sentence shape merely because its facts are correct.
- Sentence 1: plain-language definition and exactly one fitting terminal emoji.
- Sentence 2: how it works or the most useful distinction; no emoji.
- Sentence 3: misconception, risk, or recheck condition and exactly one terminal emoji.
- Never give personalized investment, tax, legal, or credit approval advice.
- First comment: the first sentence emoji only.
- Reply: `@diem.magazine` plus exactly 15 unique hashtags. Store the parsed hashtag array.
- After rewriting, diff every name, number, condition, exception, and uncertainty marker
  against the mapped claims. Naturalness may not change factual scope.

### 4. Design without identity or rights risk

- Use `visual.kind=typographic` and `peoplePolicy=prohibited`.
- Express the concept through a project-owned object or structure diagram, not a face,
  generic stock portrait, article photo, web search, or AI-generated person.
- Use the education-only palette: warm paper `#F5F0E6`, navy `#111827`, cobalt
  `#315EFB`, mint `#24C68B`, and coral `#E85D4A` only for caution.
- Show `DIEM BASIC`, `경제기초 NN`, and `current / 05` on every card. Do not show a
  publication date, Economy, or Issue.
- Use project-owned flows, comparisons, formulas, timelines, and checklists to explain
  the lesson. Do not reuse the dark photographic hot-news cover.
- Reuse the layout system, but vary the information diagram by topic and scene.

### 5. Package and build

1. Copy `content/diem-basic/_template/content.template.json` into a numbered directory.
2. Fill `content.json` and a human-readable `brief.md`.
3. Add the ID and file to `content/diem-basic/manifest.json` in curriculum order.
4. Run `npm run diem:basic:build -- --id <content-id>`.
5. Confirm the build wrote five `cards/card-NN.png` files, byte-identical `cover.png`,
   `reel.mp4`, every artifact hash, and the content hash.

Never hand-edit hashes. Rebuild after any source, copy, visual, audio, or review change.

### 6. Verify before marking ready

- Open all five cards and visually check lesson order, hierarchy, safe margins, diagram
  legibility, educational palette, and absence of people/photos.
- Use `$visual-verdict` against the current DIEM/role-model references; require 90+ and
  persist the verdict under `.omx/state/diem-basic-visual/ralph-progress.json`.
- Use `ffprobe` to confirm 1080×1920 H.264 video, 30fps, AAC stereo, 48kHz, and exactly
  19 seconds.
- Run `npm test` and `node .codex-harness/scripts/verify-project.mjs`.
- Reopen every official URL immediately before the first scheduled publication if the
  package contains mutable figures.
- Keep the package `ready` only when all checks pass. Otherwise change it to
  `needs_refresh` and rebuild after correction.

### 7. Learn after publication

- Do not change the next package because of one Reel alone.
- After comparable 7-day insights exist, use `$diem-performance-loop` to compare saves,
  shares, retention, profile visits, and follows—not reach alone.
- Require repeated evidence before changing the title, motif, cadence, or curriculum.
- Add the next batch only after the current four have been reviewed as a cohort.

## GitHub Action boundary

The scheduled DIEM Basic job may load, validate hashes/freshness, publish, write the ledger,
and notify Slack. It must not call Groq, select news, search images, render a cover, mix
audio, or rewrite `content.json`.
