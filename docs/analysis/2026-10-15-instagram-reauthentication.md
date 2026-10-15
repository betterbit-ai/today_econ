# 2026-10-15 Instagram 재인증 점검

## 10월 16일 현재 상태

10월 15일 밤 예약 시사 실행 [38733095776](https://github.com/betterbit-ai/today_econ/actions/runs/38733095776)의 실제 업로드에서 HTTP 401 / code 190 / 세션 무효화가 반환됐다. `repository_secret` 경로이며 공개 vault 교체 여부와 무관하다. Reel attempts 1 / externalId null / manual_action_required다. 이전 읽기 진단 성공은 이후 토큰의 유효성을 보장하지 않는다. Secret 저장 시각은 여전히 10월 15일 00:12:34 KST다.

현재 읽기 진단은 [38763680621](https://github.com/betterbit-ai/today_econ/actions/runs/38763680621)로 다시 실행한다. 인증이 실패하면 계정 소유자의 정상 Meta 재연결과 GitHub Secret 갱신이 필요하다. 실제 업로드 성공 전 D0와 실험 활성화는 보류한다. 단계별 조치는 [발행 안내](../diem-publishing-quickstart-ko.md)를 따른다.

사용자가 GitHub 토큰 갱신을 완료했다고 알렸다. 비밀값을 읽거나 출력하지 않고 Secrets 이름·갱신 시각만 확인했다. `INSTAGRAM_ACCESS_TOKEN` 갱신은 2026-10-15 00:12:34 KST다.

기존 `resolveInstagramToken()`은 암호화 키가 있으면 `data/instagram-token.enc`를 먼저 읽는다. Secret 갱신만으로 기존 vault가 교체되는 것은 아니다.

## 새 Secret을 독립 검증하는 읽기 진단

`DIEM Economy`의 수동 입력 `diagnose_new_token`은 해당 진단 subprocess에서만 `INSTAGRAM_TOKEN_ENCRYPTION_KEY`를 unset한다. 토큰 resolver는 새 환경 Secret을 선택한다. 기존 `diagnose`와 자동 발행·주간 갱신은 기존 vault-first 동작을 유지한다.

이 모드는 게시물·댓글·Slack·원장·vault를 변경하지 않는다. 출력과 artifact에 원문 토큰·암호화 키를 넣지 않는다. 실제 계정 읽기와 Models API·두 이미지 Vision 검수 5회를 실행한다.

코드: `fee34c4c2ad1cd7277a8be807ce913f8edad1c00`, PR #161. 로컬 harness 455건 중 454 통과·1 skip·0 실패, 독립 보안 리뷰 Green. production 실행은 [38660367364](https://github.com/betterbit-ai/today_econ/actions/runs/38660367364)다. 최종 결과는 artifact 확인 후 이 문서에 기록한다.

PR #161은 main `e55ac73ed3d24a6855c4f7ce8c942aa88d83d81a`에 반영했다. 첫 새 Secret 진단의 Node 20 전체 검사는 455건 중 452 통과·3 skip·0 실패였고 Models API·실제 Vision 5회도 성공했다. Instagram API는 401을 반환하지 않았으나 진단이 응답의 `id`만 비교해 connected account mismatch로 판정했다. 이 결과만으로 새 토큰이 다른 계정 것이라고 판단하지 않는다.

기존 `src/check-instagram.js`와 공식 Instagram Login 필드 의미에 맞춰 `GET /me`에서 `user_id`를 우선 비교하고 설정된 사용자명도 함께 대조하도록 수정했다. `id`는 앱 범위 식별자일 수 있다. 실제 불일치는 manual_action_required로 남기고 선택된 계정 ID·앱 범위 ID·사용자명만 기록한다. 두 실패 회귀 후 수정, 전체 harness 457건 중 456 통과·1 skip·0 실패와 독립 Green을 확인했다. 수정 후 실제 새 Secret 일치는 다시 production 진단으로 확인해야 한다.

수정은 [PR #162](https://github.com/betterbit-ai/today_econ/pull/162), main `ef7942caa4ccb17739eb4a44e10554bd191aeaf3`에 반영했다. 최종 [진단 38661135531](https://github.com/betterbit-ai/today_econ/actions/runs/38661135531)은 전체 success다. 새 Secret의 전문 계정 ID `17841433257606150`과 사용자명 `diem.magazine`이 설정과 일치한다. 앱 범위 ID는 `26918123124531303`으로 서로 달랐다. 기존 401 세션 무효화는 새 Secret에서 발생하지 않았다.

production Node 20 전체 검사는 457건 중 454 통과·3 skip·0 실패다. Models API `qwen/qwen3.8-27b`와 실제 두 이미지 검수도 5회 연속 성공했으며 실행 ID는 `38661135531:vision:1`~`:5`다. 첫 실패와 최종 성공을 함께 `data/reports/2026-10-15-instagram-reauthentication.json`에 보존한다. raw 토큰·암호화 키·전체 API 응답은 포함하지 않는다.

**새 Secret의 재인증은 확인됐지만 production vault는 교체하지 않았다.** `data/instagram-token.enc`가 기존 `855434ad` 이후 변경되지 않았음을 확인했다. 기존 자동 발행은 계속 vault-first이므로 이 진단만으로 자동 발행 복구나 D0를 선언하지 않는다. 공개 암호화 파일 갱신 승인이 남아 있다.

## 암호화 파일 갱신의 승인 경계

새 Secret으로 기대 계정 ID·사용자명을 확인하고 기존 AES-256-GCM 도구로 암호화 파일만 교체하는 수동 복구 Action을 준비하려 했으나, 자동 승인 검토가 공개 저장소의 credential 파일 갱신 경로에 대한 명시적 승인을 요구해 거절했다. 코드·Action 추가와 해당 파일 갱신은 실행하지 않았다. 사용자에게 `betterbit-ai/today_econ`의 `data/instagram-token.enc`를 암호화된 형태로 갱신하는 범위를 제시해 승인을 요청했다. 응답 전 동일한 파일 갱신을 다른 도구·명령으로 우회하지 않는다.

승인 후에는 새 Secret의 계정 읽기 검증 성공 → 암호화 임시 파일 작성·복호화 확인 → atomic replace → 암호화 파일만 커밋 → 기존 `diagnose`로 production 경로 확인 → 다음 정상 예약 발행의 media ID/permalink/schema3 확인 순서로 진행한다. 계정 ID·사용자명 불일치나 인증 실패면 기존 vault를 보존한다.

이 기록만으로 D0·실제 발행 복구·첫 화면/Basic 실험 시작을 표시하지 않는다.

## 현재 진행: 공개 파일 교체와 발행을 분리

사용자가 발행 진행을 재요청해 기존 daily-package와 같은 Secret 직접 사용 방식을 자동 운영에도 적용한다. 공개 vault 갱신 승인이 있어야만 현재 발행할 수 있다는 이전 안내를 정정한다. 공개 파일은 보존하고 새로운 credential 값은 여기에 쓰지 않는다.

`INSTAGRAM_TOKEN_SOURCE=repository_secret`은 검증된 환경 Secret을 직접 읽는다. 양 workflow는 이 모드를 기본으로 사용한다. 기존 encrypted_vault 모드는 명시적 설정에서만 유지하고 그때만 주간 암호화 회전을 실행한다. Secret 모드 refresh는 API·파일 작업 전 skipped로 종료한다. 장기 토큰 자동 연장은 별도 미완료이며 현재 발행 복구와 구분한다.

공개 암호화 파일 갱신에 대한 이전 승인 질문은 이 발행 경로의 필수 조건이 아니다. 새 Secret으로 일반 핫뉴스 발행을 실행하고 콘텐츠 검수·실제 Reel 결과를 기록한다. 품질 gate를 우회하거나 테스트 게시물을 만들지 않는다.

## Secret 직접 사용과 실발행 전 회귀 확인

[진단 38689473718](https://github.com/betterbit-ai/today_econ/actions/runs/38689473718)에서 실제 요청 경로 `repository_secret`, 기대 계정·사용자명 일치, Models API와 실제 이미지 두 장 검수 5회 연속 성공을 확인했다. 진단 SHA는 `6794e266ff16d074879a4899e77cac800e2c3710`이고 같은 코드가 PR #165 / main `15020436569e9c4070287d58224e976c6cbc0a8b`에 반영됐다.

첫 정상 경제 실행 [38689576201](https://github.com/betterbit-ai/today_econ/actions/runs/38689576201)은 결혼상담 일침을 소득 통계 때문에 경제로 선정했고, `결정사`를 `확정사`로 바꿔 확정 사건으로 해석했다. 게시 단계 전에 취소했다. 외부 발행 시도·media ID는 없다. 이 미발행 이력과 후보 원장은 보존한다.

PR #166 / main `4cb72a4d41c40ffb33a34710e40f652593352d50`에서 해당 관계일침 제외와 약어 경계 회귀를 수정했다. 미시도 planned 상태만 사유를 남겨 보관 후 새 후보를 선정한다. 외부 ID·시도·모호한 상태는 기존 복구 경로를 유지한다. 로컬 harness 466건 중 465 통과·1 skip·0 실패, 독립 관련 검사 33건 통과·Green이다.

[38691409601](https://github.com/betterbit-ai/today_econ/actions/runs/38691409601)의 production Node 20 전체 검사도 통과했다. 변경이 없는 Vision의 반복 점검을 기다리느라 정상 발행을 지연시키지 않도록, 전체 검사 통과 후 이 읽기 전용 실행을 취소했다. 이 실행을 Vision 5회 완료 증거로 사용하지 않으며 위 `38689473718`의 완료 증거를 유지한다.

정상 재실행은 [38691494873](https://github.com/betterbit-ai/today_econ/actions/runs/38691494873), 실행 SHA `4cb72a4d41c40ffb33a34710e40f652593352d50`다. 실제 Reel이 확인되기 전에는 발행 성공이나 D0를 선언하지 않는다.

이 실행은 `no_candidate_passed_daily_floor_gates`로 미발행 종료했다. 48후보 중 본문 확인 제한 19건, 원문 접근 실패 9건 등이 있었다. 제한에 걸린 19건은 모두 기존 인기도 하한 50 미만이어서, 검토 순서 변경만으로 이번 발행이 살아난다고 판단하지 않았다.

별도 정상 시사 실행 [38692313650](https://github.com/betterbit-ai/today_econ/actions/runs/38692313650)은 `no_candidate_passed_preparation`으로 종료했다. 비급여 진료비 기사는 숫자·의미 근거 검수, 정치 발언 후보는 관련 이미지 부재로 탈락했다. 두 실행 모두 Reel attempts 0 / externalId null이며 실제 업로드 API 검증 증거는 아니다.

경제의 광범위 지수 급락 기사를 동일 원문으로 재현한 결과, 실제 시장 관측에 대한 구체 사건 점수가 없고 부수 커뮤니티 반응 때문에 감점돼 편집 가치 35로 탈락했다. 이를 전망·가정·소문·개별종목과 구분하는 제한된 관측 근거 보완을 회귀 검사 후 배포한다. 인기·시의성·일일 floor·숫자·이미지 하한은 유지한다.

관측 보완은 PR #168 / main `b48af4864e6a86d8490d7d542175950f0ce70a25`에 배포됐다. 최종 전체 harness 473건 중 472 통과·1 skip·0 실패, 독립 Green이다. 정상 경제 실행 [38693618229](https://github.com/betterbit-ai/today_econ/actions/runs/38693618229)도 `no_candidate_passed_daily_floor_gates`로 종료했다. 지수 급락 후보는 편집 검사를 통과했으나 `recent_duplicate`에서 제외됐고, 다른 후보는 원문 접근·근거·인기도 등의 기준을 넘지 못했다. Reel attempts 0 / externalId null이다. 이 실행을 실제 발행 복구나 D0의 증거로 사용하지 않는다.
