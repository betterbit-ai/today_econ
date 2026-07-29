# 경제 뉴스 자동 인스타그램 카드 뉴스 제작 시스템 구축 계획 (2차)

> [!NOTE]
> 이 문서는 V1 구축 당시의 역사 기록입니다. 현재 자동 발행 구조와 액션은
> 루트 `README.md`와 `docs/diem-v2-operations.md`를 기준으로 확인하세요.

경제 뉴스 독해의 어려움을 해결하고, 인스타그램 업로드용 카드 뉴스(Reels/Carousel 대응, 1080x1920 세로형) 및 업로드용 멘트를 매일 자동으로 슬랙으로 전송하는 GitHub Actions 기반의 자동화 파이프라인을 구축합니다.

---

## User Review Required

> [!IMPORTANT]
> **1. 업그레이드된 LLM 도입 (Groq - openai/gpt-oss-120b)**
> - 사용자 피드백을 반영하여 성능이 아쉬운 Gemini 1.5 Flash 대신, **Groq API**를 사용해 대형 파라미터 모델인 **openai/gpt-oss-120b**를 텍스트 처리에 활용합니다.
> - Groq의 Developer Free Tier는 매우 빠르고 넉넉한 속도 제한을 무료로 제공하므로 비용은 여전히 **0원**입니다.
> - 뉴스 중복 배제, 복잡한 단어 순화, "그래서 나랑 무슨 상관이지?"에 대한 날카로운 분석을 최고 수준으로 도출합니다.
>
> **2. 이미지 생성 AI 도입 (Pollinations.ai - POLLINATIONS_API_KEY 연동)**
> - Hugging Face API의 속도 및 IP rate limit 우회를 위해, 안정적인 무료 이미지 생성 플랫폼인 **Pollinations.ai** API를 연동하여 고품질 일러스트(Text-to-Image)를 실시간 생성합니다.
> - 발급받은 `POLLINATIONS_API_KEY`를 `Authorization: Bearer [KEY]` 헤더에 실어 요청을 전송해 402/429 제한을 안전하게 우회합니다.
> - 생성된 고화질 이미지를 로컬에 다운로드하여 HTML 카드 레이아웃에 결합합니다.
>
> **3. 인스타그램 게시글 본문(멘트) 슬랙 전송**
> - 슬랙 메시지로 카드 뉴스 이미지 3장 + 복사하여 붙여넣기 간편한 **인스타그램용 본문 멘트(이모지, 핵심 질문, 해시태그 포함)**를 동봉해 전송합니다.
>
> **4. 승인 완료된 설정 적용**
> - **뉴스 출처**: 매일경제 경제 뉴스 RSS(`https://www.mk.co.kr/rss/30100041/`)를 단독/주요 출처로 선정.
> - **슬랙 가이드**: 프로젝트 루트에 슬랙 봇 토큰 생성 및 권한 설정(`files:write`, `chat:write`)에 대한 쉽고 명확한 가이드를 README에 기재합니다.

## Open Questions

> [!NOTE]
> - 현재 모든 질문과 피드백이 조율되었습니다. 추가 의견이 없으시면 아래의 구성원들에 기반해 개발을 진행합니다.

---

## Proposed Changes

### 1. Foundation & Configuration

#### [NEW] [package.json](file:///Users/joelonsw/Desktop/오늘경제/package.json)
필요한 의존성 정의:
- `groq-sdk`: Groq API 호출용 SDK
- `rss-parser`: RSS 피드 파싱
- `playwright`: HTML 템플릿을 고화질 PNG 이미지로 변환 (GitHub Actions에서 Chromium headless 실행)
- `@slack/web-api`: 슬랙 파일 업로드(filesUploadV2) 및 메시지 전송
- `dotenv`: 로컬 테스트용 환경변수 로드

#### [NEW] [config.js](file:///Users/joelonsw/Desktop/오늘경제/config.js)
RSS 피드 URL, 슬랙 채널 설정 및 환경변수 로딩 관리.

---

### 2. Core Modules (under `src/`)

#### [NEW] [crawler.js](file:///Users/joelonsw/Desktop/오늘경제/src/crawler.js)
매일경제 RSS 피드를 파싱하여 최근 뉴스 목록(제목, 내용 요약, 링크 등)을 정제해 반환합니다.

#### [NEW] [selector.js](file:///Users/joelonsw/Desktop/오늘경제/src/selector.js)
- `history.json`에 기록된 최근 7일 동안 다룬 뉴스 주제 리스트를 조회합니다.
- 오늘 수집된 뉴스 기사 목록과 히스토리를 Groq의 **openai/gpt-oss-120b**에 전달합니다.
- 최근 주제와 겹치지 않고, 인스타그램 유저들이 관심을 가질 만한 **가장 파급력 높은 뉴스 1개**를 정밀 선정합니다. (구조화된 JSON 응답 생성)

#### [NEW] [generator.js](file:///Users/joelonsw/Desktop/오늘경제/src/generator.js)
선택된 경제 뉴스 기사를 바탕으로 인스타그램 카드 원고와 이미지 프롬프트를 작성합니다. (JSON 형태로 생성)
- **Card 1**: 호기심을 유발하는 한 줄 제목 + 부제목 + FLUX용 세련된 이미지 생성 프롬프트 (영어)
- **Card 2 (무슨 일이야?)**: 어려운 용어를 쉬운 말로 정제한 핵심 요약 2~3줄 + FLUX용 일러스트 프롬프트
- **Card 3 (그래서 어쩌라고?)**: 독자의 생활이나 재테크에 미칠 실질적인 영향 + 대응 행동 요약 + FLUX용 일러스트 프롬프트
- **Instagram Caption**: 인스타그램용 친근한 말투의 줄글 멘트 (이모지, 핵심 질문, 해시태그 포함)

#### [NEW] [renderer.js](file:///Users/joelonsw/Desktop/오늘경제/src/renderer.js)
- **FLUX.1-schnell API 호출**: Hugging Face Inference API를 호출하여 세 장의 카드에 들어갈 고화질 일러스트 이미지를 생성하고 로컬 임시 폴더에 다운로드합니다.
- **HTML 템플릿 작성**: Pretendard 폰트, Glassmorphism 효과, 세련된 그라데이션 테두리 및 텍스트 레이아웃을 가진 1080x1920 세로형 HTML 코드를 구성하고 다운로드한 이미지를 배치합니다.
- **Playwright 캡처**: Playwright headless 브라우저를 실행해 HTML을 로드하고, 1080x1920 해상도의 스크린샷 3장(`slide1.png`, `slide2.png`, `slide3.png`)을 고품질 PNG 파일로 저장합니다.

#### [NEW] [slack.js](file:///Users/joelonsw/Desktop/오늘경제/src/slack.js)
- `@slack/web-api`의 `filesUploadV2` 메소드를 통해 렌더링된 PNG 이미지 3장을 슬랙 채널에 함께 업로드합니다.
- 동반 메시지로 복사해서 인스타에 붙여넣기 편리하도록 **인스타그램용 본문 멘트**를 동봉하여 전송합니다.

#### [NEW] [index.js](file:///Users/joelonsw/Desktop/오늘경제/src/index.js)
전체 파이프라인(크롤링 ➡️ LLM 뉴스 선정 ➡️ 원고/프롬프트 생성 ➡️ 이미지 생성 ➡️ Playwright 이미지 렌더링 ➡️ 슬랙 업로드 ➡️ 히스토리 갱신 및 Git Push)을 총괄합니다.

---

### 3. GitHub Actions CI/CD & Data Persistence

#### [NEW] [daily_news.yml](file:///Users/joelonsw/Desktop/오늘경제/.github/workflows/daily_news.yml)
- 매일 아침(예: 한국 시간 오전 8시) 자동으로 작동하는 GitHub Actions Cron Job입니다.
- 실행 환경에 Node.js 및 Playwright 브라우저를 셋업합니다.
- 필요한 API Key들(`GROQ_API_KEY`, `HF_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`)을 GitHub Secrets에서 주입합니다.
- 스크립트 실행이 정상적으로 끝나면, 새로 업데이트된 `history.json`을 repository에 자동으로 git commit 및 push 합니다.

---

## Verification Plan

### Automated Tests
1. **로컬 실행 테스트**: `.env`에 Groq Key, HF Token, Slack Token 등을 넣고 `node src/index.js`를 구동하여 슬랙 채널로 카드 이미지 3장과 본문이 도착하는지 최종 테스트합니다.
2. **시각적 레이아웃 검증**: Playwright로 렌더링된 세 장의 이미지를 열어 텍스트 잘림, 글자 크기, FLUX 이미지 배치 등이 어색하지 않고 모던하며 프리미엄한 감성으로 표현되는지 직접 확인합니다.

### Manual Verification
- 슬랙에 도달한 카드 이미지 3장과 본문을 모바일 기기로 다운로드하여 인스타그램 릴스/슬라이드 포스트로 직접 올려보며 모바일 화면 비율과 화질을 수동 검증합니다.
- 어려운 주식/시황 개념이 openai/gpt-oss-120b를 통해 비전문가 독자들도 이해하기 쉽도록 설명되었는지 검정합니다.
