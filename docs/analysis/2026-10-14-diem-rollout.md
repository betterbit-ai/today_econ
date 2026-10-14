# DIEM 복구 배포와 검증 기록

기준: 승인된 자동 운영 복구 계획. 분석 기준 문서는 `2026-10-13-diem-recovery.md`, 실행 항목은 `2026-10-13-diem-checklist.md`를 유지한다.

## 변경 묶음 1

- 최신 main `f1b9bdd253680727c2b3570c4311637f647b5046` 기반 작업용 worktree에 로컬 v3 두 커밋을 통합했다. 이후 main의 자동 원장 갱신도 배포 전에 합친다.
- 발행·재조정·댓글 오류를 동일 분류로 처리한다. 401·403·권한·접근 제한은 운영 확인 상태로 종료하고 429·5xx는 기존 재시도를 유지한다. 구조화 근거에는 HTTP 상태·code·subcode·메시지·trace ID만 남긴다.
- 계정 GET 조회, production Models API 확인, 실제 이미지 두 장 검수 5회로 구성된 수동 읽기 진단 Action을 추가한다. 게시물·댓글·Slack·원장을 생성하지 않는다.
- 이미지의 확정 사건과 자산 주제를 마지막 품질 gate까지 대조한다. 잘못된 역사/교통 매핑과 AI/ISA 문자열 오탐을 차단한다. 적합한 자산이 없는 후보는 발행하지 않는다.
- 제목 숫자를 원문의 값·단위·분모·기간·비교·조건에 연결하고 주장 상태 강화를 막는다. 독립 리뷰에서 나온 비교 표현 동의어와 지출/지원 금액의 의미 혼동도 회귀 검사에 포함한다.
- 부분 인사이트를 재수집하되 최초 관측과 관측 이력을 보존한다. 정시 창의 한 관측만 선택해 보고하며 서로 다른 시각의 값을 합치지 않는다. 뉴스·Basic·창·reach·views를 분리한다.
- explain은 계속 비활성이다. flash-only 회복 보고에서 explain 목표는 비적용으로 표시한다.

## 검증과 운영 증거

최종 로컬 전체 harness는 454건 중 453 통과, 1 skip, 0 실패와 diff-check 통과를 확인했다. 독립 리뷰에서 제목 의미·고정 회귀 사례·unknown/early 측정 문제를 수정하고 최종 Green을 받았다. 로컬 Node.js 25 검증은 production Node.js 20의 검증을 대신하지 않으므로 진단 Action에서 전체 harness를 다시 실행한다.

2026-10-14 19:43 KST에 최신 main `9bab59c0`의 원장을 다시 읽었다. 경제 `diem:2026-10-14:economy:38492439627`과 시사 `diem:2026-10-14:issue:38517383435` 모두 실제 media ID 없이 `retry_pending`이다. API 오류는 401이며, 계정 비밀번호 변경 또는 보안 사유로 세션이 무효화됐다는 메시지다. 성공으로 표시된 Actions 실행이 실제 발행 성공을 뜻하지 않는 사례다.

**아직 D0를 정하지 않는다.** 계정 읽기 접근과 실제 정상 예약 발행이 확인돼야 운영 복구 완료로 판단한다. 정상 계정 UI와 API 인증 결과를 별도로 기록한다.

코드 통합 커밋은 `5ca56ec9`, 최신 원장 보존 merge는 `282fe21d`다. merge 후 publication/cloud 데이터는 origin/main `9bab59c0`와 동일함을 diff로 확인했다. 보고서만 재생성했다. 통합 후 전체 harness도 454건 중 453 통과·1 skip·0 실패다. 첫 실행의 stdin helper 2초 시간 제한 실패는 단독 재현에서는 통과했고, 전체 재실행도 통과했다.

2026-10-14 19:53~19:58 KST 로컬 읽기 진단에서 Models API와 실제 `qwen/qwen3.8-27b` 요청을 확인했다. 프로젝트 소유 `finance-01`/`finance-02` 픽셀을 실제로 전송한 5회 모두 `finance-01`을 승인했다. 실행 ID는 `local-recovery-2026-10-14:vision:1`~`:5`이며 연속 성공은 5다. 원본 증거는 로컬 `.diem-cache/diagnostics/local-report.json`에 보관한다. 로컬 Instagram 토큰은 없어 계정 조회는 실패했으므로 진단 전체 결과는 failed다. 이 결과는 **production 자격 증명 검증을 대신하지 않는다.**

공개 범위에 대한 첫 푸시의 자동 승인 검토 거절 이후, 사용자가 “배포하고 마저 쭉 진행해줘”로 명시 승인했다. 브랜치를 푸시하고 [PR #155](https://github.com/betterbit-ai/today_econ/pull/155)를 정상 merge했다. 코드 배포 main SHA는 `7a2cb7c4e60f26eac934b1f490edf7fbd85e132d`, 병합 시각은 2026-10-14 20:24:57 KST다. 새 자동 후보 팩도 merge에서 보존했다.

첫 production 진단 [38555933792](https://github.com/betterbit-ai/today_econ/actions/runs/38555933792)는 Node 20 검사에 운영 Story 비활성 설정이 전달돼 모의 Story 테스트 7건이 실패하고 실제 요청은 실행되지 않았다. `fe11c179`에서 검사 subprocess의 운영 자격 증명·Story 설정을 제거했다. production 진단 단계의 원래 자격 증명과 발행 비활성은 그대로 유지한다. 회귀·전체 검사와 독립 Green을 확인했다.

수정 후 [production 진단 38556283382](https://github.com/betterbit-ai/today_econ/actions/runs/38556283382)는 Node 20 전체 harness를 통과했다. 실행 SHA는 `fe11c1793cd52181609cf6586433f6509059f891`이며 배포 main과 source/config/test/workflow 차이가 없음을 확인했다. 계정·Models API·실제 Vision 결과는 진단 artifact로 별도 기록한다.

최종 production 진단(20:24~20:29 KST): Models API `qwen/qwen3.8-27b` 접근 성공, 실제 두 이미지 검수 5회 연속 성공. 실행 ID는 `38556283382:vision:1`~`:5`이며 모두 `finance-01`을 선택했다. 계정 조회는 HTTP 401 / code 190 / subcode 0으로 실패했고 disposition은 `manual_action_required`다. 메시지는 비밀번호 변경 또는 보안 사유의 세션 무효화이며 trace ID는 `AqH2uUbqztQeqG-CkcrpwYq`다. 진단 전체 Action은 이 인증 실패를 숨기지 않고 failure로 종료했다. 게시물·댓글·Slack·원장 변경은 실행하지 않았다.

production Node 20 검사는 454건 중 451 통과·3 skip·0 실패이며 diff-check도 통과했다. 로컬의 453 통과·1 skip과 환경별 skip 수를 구분한다.

진단 artifact 이름은 `diem-diagnostics-38556283382`(14일 보존), 내려받은 로컬 원본은 `/tmp/diem-production-38556283382/report.json`이다. 장기 보존할 비밀값 없는 핵심 결과는 `data/reports/2026-10-14-diem-recovery-verification.json`에 기록한다. production Vision 증거는 explain 분류·초안 증거를 대신하지 않는다. 다음 작업의 구체 조건과 Basic 수정 사항은 `2026-10-14-next-slices-brief.md`에 준비했다.

## 인증 조치의 정확한 범위

기존 계정 소유자가 정상 연결/인증 절차로 유효한 Instagram 토큰을 다시 발급해야 한다. 무효화된 토큰을 주간 refresh로 되살렸다고 판단하지 않는다. 토큰은 채팅·PR·로그에 붙이지 않고 기존 비밀값 저장 경로로 전달한다.

`resolveInstagramToken()`은 암호화 키가 있으면 `data/instagram-token.enc`를 먼저 사용하고 환경의 `INSTAGRAM_ACCESS_TOKEN`은 그 다음이다. 현재 vault 기록 시각은 `2026-10-11T23:46:45.920Z`다. GitHub Secret만 변경해도 이전 vault가 계속 우선할 수 있으므로, 운영 담당이 기존 `writeEncryptedToken` 경로로 새 유효 토큰과 vault를 함께 맞춰야 한다. 암호화 키와 원문 토큰은 공개 저장소에 넣지 않는다.

인증 후 진단 Action에서 계정 ID 일치와 접근 성공을 확인하고, 다음 정상 예약 발행 한 편의 실제 결과로 마무리한다. 과거 실패 원장을 소급 수정해 발행 성공으로 바꾸지 않는다.

## 후속 실행 조건

1. 변경 묶음 1: 전체 검사·독립 리뷰·Node 20 진단 → main 반영 → 정상 예약 발행의 media ID·permalink·analytics schema3·실행 SHA 연결.
2. 변경 묶음 2: 위 증거가 갖춰진 뒤 검증된 사실 한 줄 표지 실험 구현. 32자·두 줄·44px·안전 영역·6초, 기사 ID 해시 배정, 분야별 정시 24h 10편 전 우열 판정 보류.
3. 변경 묶음 3: 기존 네 주제의 새 ID와 원본 연결, 두 공식 기관의 출처, 5장·19초, 자연스러운 문장·카드·실제 음원 청취·해시 검수를 통과한 패키지만 ready로 표시. 고정 게시물/하이라이트 적용은 별도 계정 UI 증거로 확인.

계정 소유자의 인증이 필요한 경우 콘텐츠 실험의 활성화와 실제 발행 검증만 대기한다. 원장 소급 변환·테스트 게시물 반복 발행·무관 자산 선택으로 성공 증거를 만들지 않는다.
