# 2026-10-15 Instagram 재인증 점검

사용자가 GitHub 토큰 갱신을 완료했다고 알렸다. 비밀값을 읽거나 출력하지 않고 Secrets 이름·갱신 시각만 확인했다. `INSTAGRAM_ACCESS_TOKEN` 갱신은 2026-10-15 00:12:34 KST다.

기존 `resolveInstagramToken()`은 암호화 키가 있으면 `data/instagram-token.enc`를 먼저 읽는다. Secret 갱신만으로 기존 vault가 교체되는 것은 아니다.

## 새 Secret을 독립 검증하는 읽기 진단

`DIEM Economy`의 수동 입력 `diagnose_new_token`은 해당 진단 subprocess에서만 `INSTAGRAM_TOKEN_ENCRYPTION_KEY`를 unset한다. 토큰 resolver는 새 환경 Secret을 선택한다. 기존 `diagnose`와 자동 발행·주간 갱신은 기존 vault-first 동작을 유지한다.

이 모드는 게시물·댓글·Slack·원장·vault를 변경하지 않는다. 출력과 artifact에 원문 토큰·암호화 키를 넣지 않는다. 실제 계정 읽기와 Models API·두 이미지 Vision 검수 5회를 실행한다.

코드: `fee34c4c2ad1cd7277a8be807ce913f8edad1c00`, PR #161. 로컬 harness 455건 중 454 통과·1 skip·0 실패, 독립 보안 리뷰 Green. production 실행은 [38660367364](https://github.com/betterbit-ai/today_econ/actions/runs/38660367364)다. 최종 결과는 artifact 확인 후 이 문서에 기록한다.

PR #161은 main `e55ac73ed3d24a6855c4f7ce8c942aa88d83d81a`에 반영했다. 첫 새 Secret 진단의 Node 20 전체 검사는 455건 중 452 통과·3 skip·0 실패였고 Models API·실제 Vision 5회도 성공했다. Instagram API는 401을 반환하지 않았으나 진단이 응답의 `id`만 비교해 connected account mismatch로 판정했다. 이 결과만으로 새 토큰이 다른 계정 것이라고 판단하지 않는다.

기존 `src/check-instagram.js`와 공식 Instagram Login 필드 의미에 맞춰 `GET /me`에서 `user_id`를 우선 비교하고 설정된 사용자명도 함께 대조하도록 수정했다. `id`는 앱 범위 식별자일 수 있다. 실제 불일치는 manual_action_required로 남기고 선택된 계정 ID·앱 범위 ID·사용자명만 기록한다. 두 실패 회귀 후 수정, 전체 harness 457건 중 456 통과·1 skip·0 실패와 독립 Green을 확인했다. 수정 후 실제 새 Secret 일치는 다시 production 진단으로 확인해야 한다.

## 암호화 파일 갱신의 승인 경계

새 Secret으로 기대 계정 ID·사용자명을 확인하고 기존 AES-256-GCM 도구로 암호화 파일만 교체하는 수동 복구 Action을 준비하려 했으나, 자동 승인 검토가 공개 저장소의 credential 파일 갱신 경로에 대한 명시적 승인을 요구해 거절했다. 코드·Action 추가와 해당 파일 갱신은 실행하지 않았다. 사용자에게 `betterbit-ai/today_econ`의 `data/instagram-token.enc`를 암호화된 형태로 갱신하는 범위를 제시해 승인을 요청했다. 응답 전 동일한 파일 갱신을 다른 도구·명령으로 우회하지 않는다.

승인 후에는 새 Secret의 계정 읽기 검증 성공 → 암호화 임시 파일 작성·복호화 확인 → atomic replace → 암호화 파일만 커밋 → 기존 `diagnose`로 production 경로 확인 → 다음 정상 예약 발행의 media ID/permalink/schema3 확인 순서로 진행한다. 계정 ID·사용자명 불일치나 인증 실패면 기존 vault를 보존한다.

이 기록만으로 D0·실제 발행 복구·첫 화면/Basic 실험 시작을 표시하지 않는다.
