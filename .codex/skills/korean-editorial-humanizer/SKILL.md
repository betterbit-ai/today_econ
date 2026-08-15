---
name: korean-editorial-humanizer
description: Rewrite or review Korean editorial copy so it sounds like a Korean editor wrote it rather than a translated or AI-generated draft, while preserving every verified fact. Use for DIEM Basic lesson cards, captions, hooks, summaries, social copy, and other short Korean explanatory writing when the text has stiff abstract nouns, unnatural word order, repeated formal endings, editor announcements, slogan-like contrasts, or mechanically balanced sentences. Do not use to invent facts, loosen legal or financial qualifications, or turn news into casual opinion.
---

# Korean Editorial Humanizer

Turn verified information into Korean that a real reader would naturally say or expect to
read. Preserve the factual frame, but do not preserve an awkward sentence shape.

## Required reference

Read `references/diem-korean-voice.md` before editing DIEM copy. It contains the series
voice, rejection patterns, and approved before/after examples.

## Workflow

### 1. Freeze the facts

- List every name, number, date, condition, comparison, uncertainty marker, and source-backed
  conclusion that must survive.
- Treat claim IDs and their meanings as immutable. A smoother sentence may be shorter, but
  it may not become broader, more certain, or more dramatic.
- Never add a fact, example, consequence, quote, or recommendation merely to make the copy
  feel vivid.

### 2. Name the reader's real question

- Ask what a Korean beginner would actually wonder before reading the explanation.
- For a DIEM Basic cover, prefer one direct question such as “절세 계좌라는데, 어떤
  세금을 줄여준다는 걸까요?”
- Do not manufacture curiosity with vague mystery, fake candor, or clickbait. The question
  must point to the lesson's verified answer.

### 3. Rewrite in Korean, not translated logic

- Use friendly `해요체` for DIEM Basic lesson bodies and captions. Keep titles short and
  nominal when that is clearer.
- Put the familiar topic first and the new information later. Split a long abstract sentence
  when a Korean speaker would pause.
- Prefer concrete verbs: `합쳐요`, `넘겨요`, `다시 계산돼요`, `따져봐야 해요`.
- Replace editorial stage directions such as “먼저 봅니다” or “오해부터 바로잡습니다”
  with the information or question itself.
- Allow ordinary repetition when it is the clearest word. Do not cycle through synonyms to
  sound polished.
- Keep one main idea per card. Not every card needs a question, punchline, or command.

### 4. Read it aloud

Read every line at normal speaking speed and revise it if any of these are true:

- a Korean speaker would need to reorder the sentence mentally;
- the subject is needlessly repeated;
- three or more lines have the same grammatical ending or rhythm;
- abstract nouns carry the meaning that a simple verb could carry;
- the line sounds like an editor describing what the content will do;
- the wording is correct but no person would choose it in conversation or a magazine.

### 5. Run the fact diff

Compare the rewrite against the frozen fact list and mapped claims.

- Confirm every retained number has the same unit, scope, date, and condition.
- Confirm negation, exceptions, and uncertainty survived.
- Remove any implication that is not directly supported.
- If natural wording would require an unsupported detail, keep the plain verified version.

### 6. Run a second AI-tell audit

Ignore the first draft's wording and ask: “어느 부분이 한국인이 쓴 문장보다 번역문이나
생성형 AI 문장처럼 들리는가?” Rewrite once more. Pay special attention to symmetrical
contrasts, abstract summaries, generic imperatives, and repeated `~합니다` endings.

## DIEM output contract

- Cover: a concrete searchable title plus one natural reader question or immediate answer.
- Definition/mechanism/caution/summary: one idea each, friendly but not slangy.
- Caption: exactly three fact-preserving sentences when the package contract requires it;
  humanization does not override emoji, length, or line-break rules.
- Claims, source mappings, title limits, hashtags, and media hashes remain governed by the
  calling production skill.
- After changing packaged copy, rebuild all derived cards, cover, Reel, and hashes. Never
  hand-edit derived artifacts.

## Method note

This workflow adopts the no-fabrication, voice-calibration, and draft-audit-final ideas from
the MIT-licensed `blader/humanizer` skill, but the Korean voice rules and DIEM examples are
project-specific. The general skill is useful for detecting AI patterns; it is not a Korean
editorial style guide by itself.
