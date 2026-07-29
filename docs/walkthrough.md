# 경제 뉴스 자동 카드 뉴스 제작 시스템 구축 결과 보고 (Walkthrough)

> [!NOTE]
> 이 문서는 V1 결과 기록입니다. 현재 DIEM V2의 동작과 GitHub Actions는
> 루트 `README.md`와 `docs/diem-v2-operations.md`를 기준으로 확인하세요.

경제 뉴스의 해독성을 높이고 인스타그램 카드 뉴스 제작을 무인화하는 자동화 파이프라인 시스템을 안정적으로 구축 완료했습니다.

---

## 🛠️ 구현된 작업 요약

1.  **의존성 및 환경 구축**: `package.json` 패키지 구성 및 Playwright Chromium 설치 완료.
2.  **뉴스 크롤러 (`src/crawler.js`)**: 매일경제 경제 뉴스 RSS 피드에서 최신 기사들을 안전하게 파싱 및 반환.
3.  **LLM 뉴스 셀렉터 (`src/selector.js`)**: 지난 7일간 다룬 뉴스 내역(`history.json`)을 기반으로 중복 뉴스(예: 일일 증시 소폭 등락 등)를 걸러내고, 오늘 다룰 최고 가치의 핵심 뉴스 1개를 **openai/gpt-oss-120b** 모델로 정밀 판별.
4.  **원고 및 프롬프트 생성기 (`src/generator.js`)**: 뉴스 내용을 일반 독자 눈높이에 맞춰 순화하고 어려운 단어를 괄호로 설명. 또한 **Pollinations.ai**용 이미지 묘사 프롬프트(영어) 및 이모지가 가득한 인스타그램 본문 멘트를 완벽한 JSON 구조로 생성.
5.  **카드 뉴스 이미지 렌더러 (`src/renderer.js`)**:
    *   `POLLINATIONS_API_KEY` 인증 토큰을 Bearer 헤더에 실어 Pollinations.ai API를 호출하여 고품질 일러스트를 획득 (IP 공유 큐 제한 및 402/429 우회).
    *   Pretendard 폰트와 모던 Dark Glassmorphism 디자인의 1080x1920 해상도 HTML 템플릿에 AI 일러스트와 텍스트를 결합.
    *   Playwright 헤드리스 브라우저가 HTML을 구동하여 초고화질 스크린샷 3장(`slide_1.png`, `slide_2.png`, `slide_3.png`)을 생성.
6.  **슬랙 파일 업로더 (`src/slack.js`)**: `@slack/web-api`의 최신 `filesUploadV2` API를 이용해 이미지 3장과 복사 가능한 게시글 본문 멘트를 슬랙 채널에 동시 업로드.
7.  ** GitHub Actions 자동 크론 및 데이터 저장소 (`daily_news.yml`)**: 매일 아침 8시 KST에 구동되며, 구동 완료 후 변경된 `history.json`을 repository에 자동으로 git commit & push하여 중복 검사용 누적 데이터 영구화.
8.  **가이드 문서 (`README.md`)**: 로컬 실행법 및 각 API Key, 슬랙 봇 권한(Scopes) 발급 가이드 작성 완료.

---

## 🧪 실시간 카드 뉴스 및 일러스트 연동 결과

최종 디테일 보정 후 실시간 경제 뉴스("중동전쟁 삼중고")를 크롤링하여 **Hugging Face FLUX.1** 이미지 모델과 함께 정상 구동한 실제 인스타그램 업로드용 카드 뉴스(Ivory 테마)입니다. 개선된 레이아웃(여백 제거, 폰트 확대)과 AI 삽화가 정상 결합되었습니다.

```carousel
![Live Slide 1: Title](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/live_1.png)
<!-- slide -->
![Live Slide 2: Fact](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/live_2.png)
<!-- slide -->
![Live Slide 3: Action](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/live_3.png)
```

## 🧪 로컬 시각적 렌더링 테스트 결과 (디자인 테마별 시연)

모의 데이터로 로컬 테스트 스크립트(`test-render.js`)를 실행하여 3대 테마(Obsidian, Ivory, Cyber)의 이미지 렌더링 및 텍스트 배치가 정상 동작함을 완벽히 확인했습니다.

### 1️⃣ Luminous Obsidian 테마 (거시경제/증시 시황)
```carousel
![Obsidian Card 1: Title](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/obsidian_1.png)
<!-- slide -->
![Obsidian Card 2: Fact](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/obsidian_2.png)
<!-- slide -->
![Obsidian Card 3: Action](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/obsidian_3.png)
```

### 2️⃣ Gilded Ivory 테마 (실생활 경제/부동산/정책)
```carousel
![Ivory Card 1: Title](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/ivory_1.png)
<!-- slide -->
![Ivory Card 2: Fact](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/ivory_2.png)
<!-- slide -->
![Ivory Card 3: Action](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/ivory_3.png)
```

### 3️⃣ Cyber-State Protocol 테마 (빅테크/IT/AI/코인)
```carousel
![Cyber Card 1: Title](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/cyber_1.png)
<!-- slide -->
![Cyber Card 2: Fact](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/cyber_2.png)
<!-- slide -->
![Cyber Card 3: Action](/Users/joelonsw/.gemini/antigravity/brain/256322d0-59bf-45f4-8b7d-fa71427658fa/cyber_3.png)
```

### 레이아웃 디자인 특징
*   **고급스러운 다크 & 라이트 테마**: 인스타그램 슬라이드 포스트 및 모바일 디스플레이 환경에 부합하도록 슬림한 세로형 9:16 비율에 맞춘 3대 프리미엄 카드 뉴스 디자인을 구축했습니다.
*   **스마트 테마 및 강조 색상 동적 매칭**: openai/gpt-oss-120b 모델이 판단한 기사 내용 카테고리(거시금융/실생활/IT빅테크)에 맞춰 적절한 템플릿 테마와 강조 색상(Theme Color)을 실시간 매핑하여 최적의 비주얼을 자율 생성합니다.
*   **말풍선 및 캐릭터 일러스트**: 카드 상단이나 하단에 위치한 AI 생성 일러스트 위에 위트 넘치는 캐릭터 리액션 말풍선을 오버레이하여, 딱딱할 수 있는 경제 뉴스를 친근하고 재미있게 전환합니다.
*   **가독성 극대화**: 줄글을 기피하는 인스타 유저를 위해 핵심 경제 용어 설명(괄호식)과 짧은 문장 위주로 가독성을 대폭 끌어올렸습니다.
