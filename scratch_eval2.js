const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
require('dotenv').config({ path: '/Users/joelonsw/Desktop/오늘경제/.env' });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const NEW_SYSTEM_PROMPT = `DIEM 경제·시사 매거진의 수석 에디터다.
[규칙]
1. 인스타그램 릴스 시청자가 바로 이해할 수 있도록 쉽고 매끄러운 문장으로 작성하라.
2. 기사 원문에 포함된 사진/이미지 묘사(예: '건배하고 있다', '오른쪽부터 ~')나 언론사 이름(연합뉴스, 뉴시스 등), 기자 이름은 절대 포함하지 마라.
3. titleCandidates는 시청자의 이목을 끄는 직관적인 훅(Hook) 형태여야 한다. 단순 키워드 나열(예: '대통령 젠슨 24일 흐름정리')은 절대 금지한다. 각 title은 줄바꿈('\\n') 하나를 포함한 정확히 2줄, 공백 포함 14자 이하여야 한다.
4. sentences는 정확히 3개다. 각 문장은 120자 이하로 작성하며 서술어는 '~다', '~요' 등 자연스러운 문장 형태로 끝맺는다.
   - 1문장: 사건의 핵심 요약 및 훅
   - 2문장: 구체적인 사실, 수치 또는 전개
   - 3문장: 배경, 전망, 또는 시청자에게 미치는 영향
5. 문장 내용에 어울리는 이모지 2개를 생성하라 (first는 1문장 끝, third는 3문장 끝에 어울림). 문장 내부에는 이모지를 넣지 않는다.
6. 제공된 기사 외의 사실을 날조하지 않는다.
7. 오직 JSON 형식으로만 응답한다:
{"titleCandidates":[{"title":"첫줄\\n둘째줄","score":100} (x5)],"selectedTitleIndex":0,"sentences":["1문장","2문장","3문장"],"emojis":{"first":"🔥","third":"📉"},"topicTags":["#해시태그"]}
`;

function sourceText(article = {}) {
  return [
    article.title,
    article.summary,
    article.fullText,
    article.body,
    article.context,
    ...(article.verifiedFacts || article.facts || []),
  ].filter(Boolean).join(' ').replace(/\s+/gu, ' ').trim();
}

async function runEval() {
  const dataPath = '/Users/joelonsw/Desktop/오늘경제/data/publications/2026/07/2026-07-25.json';
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  
  const articles = [
    data.publications?.economy?.candidate,
    data.publications?.issue?.candidate,
    data.candidates.find(c => c.title.includes('대통령') || c.title.includes('젠슨')),
  ].filter(Boolean);

  const models = ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b'];

  for (let i = 0; i < Math.min(3, articles.length); i++) {
    const article = articles[i];
    console.log(`\n==================================================`);
    console.log(`📰 기사 [${i + 1}]: ${article.title}`);
    console.log(`==================================================`);
    
    const userPrompt = JSON.stringify({
      category: article.category || 'economy',
      title: article.title,
      source: sourceText(article).slice(0, 4000),
    });

    for (const model of models) {
      console.log(`\n🤖 모델: ${model}`);
      try {
        const response = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: NEW_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
        });
        const result = JSON.parse(response.choices[0].message.content);
        const title = result.titleCandidates[result.selectedTitleIndex]?.title || result.titleCandidates[0]?.title;
        console.log(`\n[커버 타이틀]`);
        console.log(title);
        console.log(`\n[게시글 본문]`);
        console.log(`${result.sentences[0]} ${result.emojis?.first || '✨'}`);
        console.log(`${result.sentences[1]}`);
        console.log(`${result.sentences[2]} ${result.emojis?.third || '🔍'}`);
      } catch (err) {
        console.error(`Error with ${model}:`, err.message);
      }
    }
  }
}

runEval();
