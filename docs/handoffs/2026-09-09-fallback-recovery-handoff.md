# DIEM 웹 이미지·편집 품질 개선 작업 인수인계

- 작성일: 2026-09-09 KST
- 브랜치: `main`
- 기준 원격 커밋: `e32ec4a Retain Instagram growth evidence for editorial decisions`
- 상태: 구현·전체 검증·리뷰 완료, 커밋·푸시 대기
- 사용자 요청: 최근 발행물의 100% 폴백 이미지, 낮은 성과, 잘못된 이미지
  주제 매핑, 카테고리 이탈과 빈약한 제목을 모두 개선

## 확인된 운영 근거

2026-09-01~08 발행 26편은 웹 이미지 0편, 생성 폴백 25편,
DIEM 타이포그래피 1편이었다. 23편에 Vision 오류가 기록됐다.

- `json_validate_failed` 400: 19편
- 외부 이미지 URL 403: 3편
- 실제 문맥 부적합 정상 거부: 1편

이미지 공급원이 비어 있었던 것이 아니라 최종 Groq Vision 전송·JSON 검수
장애가 모든 웹 후보를 폴백으로 밀었다. 최근 24시간 정시 표본 20편의 조회수
중앙값은 218회였다.

## 이번 세션에서 구현한 내용

### Vision 복구

- `src/v2/groq.js`
  - Vision JSON mode 400 발생 시 response format을 제거한 plain JSON 요청 1회
  - 외부 이미지 401·403 발생 시 15초 제한으로 직접 다운로드
  - JPEG/PNG/WebP, 이미지당 최대 8MB만 Base64 data URL로 재검수
  - JSON fence나 앞뒤 설명이 섞여도 객체 부분을 파싱
- `src/v2/image-selector.js`
  - 첫 Vision 실패에서 검색을 끝내지 않고 다음 검색 의도로 이동
  - 기사당 Vision 검수를 최대 3개 의도로 제한

### 주요 사건 기반 이미지

- 저장된 `newsFrame.subject`, `eventKind`, `eventLabel`, 표지 제목을 이미지
  검색과 생성 폴백의 기준으로 사용
- 본문 후반의 직업·산업 단어가 폴백 주제를 바꾸지 못하게 함
- 전용 사건 추가:
  - `currency_move`: 원·엔 환율 → 외환 전광판/환전소, `markets`
  - `market_move`: KOSPI 제목이면 KOSPI 검색어 사용
  - `rescue_search`: 구조·수색 → 구조 장비/헬기, `weather`
  - `housing_policy`: 주거 이미지, `housing`
- 코스피 기사 본문 후반의 해외 화재가 생명·안전 BGM을 오작동시키지 않게
  `src/v2/music.js`의 민감 주제 범위를 제목·요약 중심으로 축소

### 편집·후보 품질

- 기내 난동, 개인 해고, 해외 대학 입학 홍보, 개인 희망퇴직 고민을 부수적인
  부동산·고용·교육 단어만으로 발행하지 않음
- 지역 생활 피처의 `노동자` 한 단어를 공공 노동정책으로 인정하지 않음
- 대통령 인사 지명과 공직 후보 윤리 논란은 Economy보다 Issue 우선
- 아파트·집값·재건축·데이터센터는 실제 Economy 판정 근거로 추가
- 실패한 사적 화제 다음의 정상 경제 후보로 넘어가는 planner 회귀 테스트 추가
- 제목 한 줄이 `보도`, `논란`, `상황`, `소식`뿐이면 거부하고 제목 재교정

## 추가·수정된 파일

- `spec/spec.md`
- `src/v2/editorial.js`
- `src/v2/groq.js`
- `src/v2/image-selector.js`
- `src/v2/music.js`
- `src/v2/text.js`
- `src/v2/topic.js`
- `test/v2-foundation.test.js`
- `test/v2-groq.test.js`
- `test/v2-media.test.js`
- `test/v2-planner.test.js`
- `test/v2-selection.test.js`
- `decisions/2026-09-09-recover-web-image-review-before-generated-fallback.md`
- `learnings/2026-09-09-all-fallbacks-can-be-a-review-transport-outage.md`

## 현재 검증 상태

- 중간 회귀 묶음은 한 차례 130/130 통과
- 이후 NFC 정규화 뒤 한 테스트가 실패했고, 해당 `general` event label의
  본문 후반 `지원` 누수를 수정함
- 수정 후 `node --test test/v2-foundation.test.js`: 33/33 통과
- 전체 프로젝트 검증은 아직 실행하지 않음
- 실 API Vision 호출과 Instagram 발행은 하지 않음

## 완료 증거

1. 회귀 테스트 130개 통과: Vision JSON 400 복구, Base64 403 복구,
   다음 검색 의도 이동, 기본 폴백 차단, 다음 후보 전환, 제목·카테고리
   회귀를 포함한다.
2. 전체 프로젝트 검증 통과: 349개 중 348개 통과, 기존 조건부 1개 스킵,
   `git diff --check` 통과.
3. 수정 파일과 새 문서가 모두 NFC로 정규화된 것을 확인했다.
4. 최근 26편 replay 결과: 저가치·카테고리 이탈 11편 사전 거부,
   `보도`형 제목 5편 재교정, 생성 이미지 주제 15편 재매핑,
   주제 미확정 8편은 기본 폴백 대신 다음 후보 전환 대상이 됐다.
5. 성과 리포트는 최근 7일 폴백률과 Vision JSON 검증 실패·이미지 접근
   실패·문맥 거부 분포를 기록한다.

## 남은 운영 관찰

- 다음 자동 발행에서 새 Vision 복구 경로의 실제 성공률을 확인한다.
- 실제 Groq 호출 또는 이미지 다운로드가 계속 실패하면 웹 이미지를 무검수로
  발행하지 말고, 리포트의 오류 분포를 근거로 원인을 다시 조정한다.

## 주의사항

- 현재 worktree 변경은 사용자의 작업으로 간주하고 초기화·되돌리면 안 된다.
- 기존 이미지 안전 게이트, 무관 인물·국가·정치 상징 차단, 최근 7일 이미지
  중복 금지는 완화하지 않는다.
- Vision 장애 시 검수되지 않은 웹 이미지를 발행하지 않는다.
- 분야별 하루 3편은 상한이지 목표가 아니다. 저가치 후보로 채우지 않는다.
- 실 Instagram 발행이나 GitHub Action 수동 실행은 검증 작업에 포함하지 않는다.

## 참고한 공식 문서

- Groq Images and Vision: https://console.groq.com/docs/vision
- Groq Structured Outputs: https://console.groq.com/docs/structured-outputs
