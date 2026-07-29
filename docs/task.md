# 태스크 리스트

> [!NOTE]
> 이 문서는 V1 완료 기록입니다. 현재 운영 액션은 `DIEM Economy`와
> `DIEM Issue` 두 개뿐이며 상세 절차는 `docs/diem-v2-operations.md`에 있습니다.

- [x] **초기 설정 및 패키지 초기화**
  - [x] `package.json` 생성 및 필요한 패키지(`groq-sdk`, `rss-parser`, `playwright`, `@slack/web-api`, `dotenv`) 설치
  - [x] `.env.example` 및 `config.js` 작성
  - [x] Playwright 브라우저 의존성(Chromium) 설치 검증
- [x] **뉴스 크롤러 개발 (`src/crawler.js`)**
  - [x] 매일경제 RSS 피드 파싱 기능 구현
  - [x] 파싱 결과를 일정한 형식(제목, 본문 일부, 링크)으로 정제
- [x] **뉴스 분석 및 선정 모듈 개발 (`src/selector.js`)**
  - [x] `history.json` 파일 생성 및 최근 기록 로드 기능 구현
  - [x] Groq openai/gpt-oss-120b를 사용한 뉴스 비교 및 당일 대표 뉴스 선정 로직 구현
- [x] **카드 뉴스 원고 및 이미지 프롬프트 생성 모듈 개발 (`src/generator.js`)**
  - [x] 카드 3장에 맞는 텍스트(쉬운 용어 설명 포함) 생성 로직 구현
  - [x] FLUX.1-schnell 전용 이미지 생성 영어 프롬프트 작성 로직 구현
  - [x] 인스타그램 게시글 본문 멘트(해시태그, 이모지 포함) 생성 로직 구현
- [x] **Google Stitch 디자인 템플릿 통합 & 고도화**
  - [x] Stitch가 생성한 3대 프리미엄 테마(Obsidian, Ivory, Cyber)를 보관하는 `src/templates.js` 생성 및 말풍선 융합
  - [x] LLM이 뉴스 성격에 맞는 템플릿 테마(`template_theme`)를 선정하도록 `src/generator.js` 수정
  - [x] `src/renderer.js`에서 동적 템플릿 선택 및 Playwright 렌더링 로직 연동
  - [x] `test-render.js`를 수정하여 3가지 테마가 한 번에 렌더링(Obsidian, Ivory, Cyber 각각 1장씩)되도록 테스트 구성
  - [x] 로컬 테스트 실행 및 3대 테마 렌더링 성공 여부 검증
  - [x] 생성된 이미지로 `walkthrough.md` 업데이트 및 `docs/` 폴더에 동기화 복사
- [x] **슬랙 전송 모듈 개발 (`src/slack.js`)**
  - [x] `@slack/web-api`의 `filesUploadV2`를 활용한 이미지 업로드 구현
  - [x] 인스타그램 복사용 줄글 멘트 메시지 전송 기능 구현
- [x] **전체 파이프라인 통합 및 진입점 작성 (`src/index.js`)**
  - [x] 크롤러, 분석기, 렌더러, 슬랙 모듈을 유기적으로 호출하는 메인 로직 작성
  - [x] 완료 후 `history.json`에 뉴스 제목 추가 및 과거 기록 정리(7일 유지) 로직 구현
- [x] **GitHub Actions 워크플로우 설정 (`.github/workflows/daily_news.yml`)**
  - [x] 매일 한국시간 아침 8시에 작동하는 크론잡 작성
  - [x] Secrets 주입 및 Playwright 설치 명령어 구성
  - [x] 실행 후 `history.json` 변경 사항 자동 Commit & Push 설정
- [x] **설정 문서 및 가이드 작성 (`README.md`)**
  - [x] 로컬 실행 방법 기재
  - [x] Groq, Hugging Face Token 발급 가이드 기재
  - [x] Slack Bot 토큰 발급 및 Scopes 설정 가이드 기재
