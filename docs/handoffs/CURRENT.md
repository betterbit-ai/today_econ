# DIEM 현재 상태와 새 세션 시작점

- 갱신일: 2026-09-18 KST
- 활성 구현 브랜치: `codex/chatgpt-oracle-editorial` (PR #77 review/merge 전)
- 구현 브랜치는 원격과 동기화 상태이며 최신 상태는 `git log -1`로 확인한다.
- production Instagram workflow와 예약 발행은 변경하지 않았다.
- 상세 성과 진단: [`2026-09-15-performance-decline.md`](2026-09-15-performance-decline.md)
- 생성 보고서: [`../../data/reports/diem-performance.md`](../../data/reports/diem-performance.md)
- 활성 구현 계획: [`../implementation/chatgpt-oracle-cloud-editorial-plan.md`](../implementation/chatgpt-oracle-cloud-editorial-plan.md)
- 구현 진행 기록: [`../implementation/chatgpt-oracle-cloud-editorial-progress.md`](../implementation/chatgpt-oracle-cloud-editorial-progress.md)

## 새 세션에서 먼저 읽을 것

1. `spec/mission.md`: 누구에게 무엇을 제공하는지와 비목표
2. `spec/spec.md`: 현재 승인된 구현 계약과 수용 기준
3. 이 문서와 위 상세 성과 진단
4. 관련 `decisions/`와 `learnings/`
5. `git status --short --branch`로 원격·로컬 차이와 사용자 변경 확인

성과 작업에는 `.codex/skills/diem-performance-loop/SKILL.md`를 적용한다.
24h, 72h, 7d를 섞지 않고 `late_backfill`을 비교 표본에서 제외한다.

## 프로젝트 한눈에 보기

DIEM은 네이버 인기 경제·시사 후보를 수집하고, 분류·신선도·중복·편집·이미지
안전 게이트를 통과한 기사만 7초 Instagram Reel로 발행하는 GitHub Actions
파이프라인이다. 별도 DB 대신 날짜별 Git 원장을 단일 진실 원천으로 사용한다.

핵심 흐름은 다음과 같다.

`src/v2/index.js` → `planner.js`/`popular-news.js` → `topic.js`/`hotness.js` →
`editorial.js`/`quality-gate.js` → `image-selector.js`/`groq.js` →
`cover.js`/`reel.js` → `publisher.js`/`instagram.js` → 날짜별 publication 원장

운영과 측정의 기준 파일은 다음과 같다.

- 워크플로: `.github/workflows/diem_economy.yml`, `diem_issue.yml`
- 원장: `data/publications/YYYY/MM/YYYY-MM-DD.json`
- 인사이트 수집: `src/collect-insights.js`
- 성과 계산: `src/v2/performance-loop.js`
- 운영 보고서: `data/reports/diem-performance.{md,json}`
- 테스트: `test/v2-*.test.js`
- 전체 검증: `node .codex-harness/scripts/verify-project.mjs`

## 2026-09-18 클라우드 editorial 전환 상태

ChatGPT OAuth MCP의 일반 write와 cloud Scheduled write canary는 실제 GitHub PR까지
도달했다 (각각 PR #80, #81). 상시 권한 저장 뒤 새 cloud task가 browser interaction
없이 PR #82를 만들었고, 변경 파일은 canary JSON 한 개뿐이어서 무인 scheduled-write
gate도 통과했다. Oracle active service는 `mcp.talkwithme.r-e.kr`의 TLS endpoint에서
건강하며 GitHub App은 canary path만 쓰도록 제한돼 있다.

ChatGPT ImageGen 파일을 MCP로 보내는 기능은 실패했지만, 사용자는 검증된 9:16 이미지
라이브러리에서 ChatGPT가 매일 에셋 ID를 고르는 대안을 승인했다. 저장소에는 기존
43개 자산과 시각 검수된 OpenAI ImageGen 시장 배경 1개, 총 44개가 있다. Oracle
`get_visual_library`는 실제 ChatGPT MCP 호출에서 43개 main 자산을 읽었고, 새로운
44번째 자산은 PR #77이 main에 반영된 뒤 목록에 나타난다.

PR #77에는 Economy workflow의 별도 6시간 candidate-only cron과 수동 package
validate/prepare/publish Action이 추가됐다. production publisher cron 자체는 바뀌지
않았다. 현재 다음 단계는 PR review/merge, candidate pack 자동 생성 확인, ChatGPT
assisted package PR, 수동 prepare 검증 순이다. package PR merge와 Instagram publish는
각각 사람의 명시적 조치가 필요하다.

Oracle MCP는 이번 브랜치 코드로 재배포되어 `healthy`이며 OAuth 200/400 및 익명 MCP
401 경계를 다시 통과했다. ChatGPT v4 action refresh 뒤 `get_visual_library`를 호출해
main의 43개 자산 목록을 읽는 것도 확인했다. PR #77을 main에 반영하면 44번째
`markets-04-openai-01` 에셋이 목록에 추가된다.

## 2026-09-15 성과 판단

성과 하락은 확인됐다. 정시 수집된 24h 표본에서 2026-07-25~08-22 대비
2026-09-09~15 조회 중앙값은 Economy 787→176(-77.6%), Issue
1,607→176(-89.0%)이다. 도달과 평균 시청 시간도 함께 하락했고, 최근 정시
24h 표본 16편의 저장과 공유는 모두 0건이다. 최근 5편은 아직 24h 측정 전이거나
지표가 없어 비교에서 제외했다.

가장 강한 원인은 후보·카테고리·news frame·표지 제목의 품질 이탈이다.
최근 원장에는 고독사 기사를 건보료 개편으로, 중국 불륜 폭로를 주거 정책으로,
후티 해협 군사 기사를 Economy로, 연준 금리 기사를 Issue로 분류한 기록이 있다.
`분석 보고`, `비판`, `보도`, `확정`처럼 사건이 설명되지 않거나 전망을 확정으로
강화한 제목도 발행됐다.

이미지 문제도 크다. 최근 7일 21편 중 19편(90.48%)이 생성 폴백이며,
Vision 오류는 JSON 검증 10건, 이미지 접근 2건, 기타 2건이다. 2026-09-15
원장에는 기본 Vision 모델 `qwen/qwen3.6-27b`가 존재하지 않는다는 API 오류도
기록돼 있다. 다만 최근 웹 이미지 2편의 24h 조회 중앙값도 159.5여서 이미지
복구만으로 성과가 회복된다고 볼 수는 없다.

음악은 단일 트랙 20% 편중이 없고, 하루 게시 순서별 성과도 일관된 감소를
보이지 않는다. 따라서 현재 증거로 음악이나 발행 순서 하나를 주원인으로
단정하지 않는다. 높은 발행 상한은 약한 후보가 품질 게이트를 통과할 때 피해를
늘리는 증폭 요인으로 본다.

## 미배포 변경과 중요한 공백

로컬 커밋 `60ac8eb`은 Vision JSON 복구, URL 401·403 시 Base64 재검수,
최대 3개 검색 의도 재시도, 핵심 사건 기반 이미지 주제, 일부 저가치 후보와
빈 제목 차단을 구현하고 전체 테스트를 통과한 변경이다. 아직 `origin/main`에
없으므로 2026-09-09 이후 실제 게시물은 이 개선의 운영 효과를 반영하지 않는다.

이 커밋도 기본 Vision 모델 이름은 바꾸지 않는다. 모델 존재 여부를 공식 Groq
문서에서 확인해 지원 모델로 교체하는 별도 수정과 테스트가 필요하다. 또한 최근
원장의 새 오분류·확정성 오류를 fixture로 추가해야 한다.

## 다음 우선순위

1. 미배포 이미지·프레임 복구 커밋을 검토·배포한다.
2. 유효한 Groq Vision 모델로 설정·워크플로·테스트를 함께 교체한다.
3. 2026-09-09~15 오분류 사례를 회귀 fixture로 만들고, 불명확한 표지와
   전망→확정 강화를 fail-closed한다.
4. 품질이 안정될 때까지 일시적으로 하루 Economy 1편 + Issue 1편의 가장 강한
   후보만 발행하는 14일 실험을 검토한다. 발행 상한을 채우기 위해 게이트를
   낮추지 않는다.
5. 배포 후 최소 10편의 정시 24h와 72h 표본이 쌓이면 다시 분석한다. 현재 대비
   카테고리별 24h 조회 중앙값 +50%, 평균 시청 3.5초 이상, 저장 또는 공유가
   1건 이상인 게시물 비율 20% 이상, 품질 사고 0건을 회복 판단 기준으로 둔다.

## 주의사항

- 단일 바이럴이나 부진 게시물을 규칙으로 만들지 않는다.
- 팔로워 증분은 계정 구간 추정치이지 개별 Reel의 확정 기여가 아니다.
- 웹 이미지 안전 게이트, 권리, 무관 인물·국가·정치 상징 차단을 성과 때문에
  완화하지 않는다.
- 실제 발행, push, 워크플로 수동 실행은 사용자가 요청한 ship 범위에서만 한다.
