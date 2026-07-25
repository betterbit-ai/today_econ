# Relaxing Title and Caption Length Limits

## Context
Our AI-generated Instagram reels were suffering from severely poor text quality. 
1. **Titles**: The `validateTitle` constraint enforced a maximum of 14 graphemes including spaces. For economic news with large numbers (e.g. "9천500억 달러"), this forced the LLM into generating ungrammatical fragments (e.g. "청와대 국내 / 9 500") just to fit the limit.
2. **Captions**: The `ensureSentence` function enforced a hard maximum of 120 graphemes per sentence. If the LLM exceeded this, the function brutally truncated the sentence at a space and appended a period, resulting in broken grammar (e.g., "... 반도체 분야."). 
3. **Boilerplate**: The LLM frequently included journalistic boilerplate like "[자료사진]" because the prompt lacked an explicit instruction to filter them.

## Decision
1. **Title Length**: Increased the maximum grapheme limit from 14 to 24 in `src/v2/text.js` (`validateTitle`) and updated the prompt rules in `src/v2/editorial.js`.
2. **Caption Sentence Length**: Increased the recommended maximum from 120 to 160 graphemes in the prompt and `validateCaption`. 
3. **Truncation Logic**: Completely removed the hard-truncation logic from `ensureSentence` in `src/v2/editorial.js`. The function now only strips trailing punctuation and appends the necessary emojis.
4. **Boilerplate Filter**: Added an explicit rule to `modelPrompt` to reject boilerplate like "[자료사진]" and "[단독]".

## Consequences
- The LLM now has enough room (24 characters) to write meaningful, grammatically intact two-line hooks for titles.
- Captions will no longer be randomly cut off mid-sentence, preserving context and readability.
- Journalistic placeholders will be reliably stripped from the final output.
