# DIEM 발행 확인과 문제 해결 안내

현재 GitHub 자동 발행은 저장소 Secret의 `INSTAGRAM_ACCESS_TOKEN`을 직접 사용한다. 새 토큰을 Secret에 저장하면 다음 실행부터 사용한다. 예전 공개 암호화 파일의 교체 승인은 현재 발행의 필수 조건이 아니다.

## 지금 사용자가 할 일

토큰 갱신은 이미 완료됐고 계정 ID와 `diem.magazine` 사용자명이 확인됐다. 같은 토큰을 다시 만들거나 채팅에 붙이지 않는다. 발행 작업 결과와 실제 계정 게시물을 확인한다.

## 경제 뉴스를 직접 실행하는 순서

1. [DIEM Economy Actions](https://github.com/betterbit-ai/today_econ/actions/workflows/diem_economy.yml)를 연다.
2. `Run workflow`를 누른다.
3. Branch는 `main`, operation은 `hot_news`를 선택한다. 다른 입력은 비운다.
4. 아래 `Run workflow`를 한 번 누른다.
5. 새 실행을 열어 기사 선정·원고/이미지 검수·영상 준비·Instagram 발행 단계를 확인한다.
6. 완료 뒤 [실제 Instagram 프로필](https://www.instagram.com/diem.magazine/)에서 새 Reel을 확인한다. 성공한 실행에는 원장에 media ID와 permalink가 남는다.

시사 뉴스는 [DIEM Issue Actions](https://github.com/betterbit-ai/today_econ/actions/workflows/diem_issue.yml)에서 `Run workflow` → `main` → `Run workflow` 순서다. 시사 workflow에는 operation 선택이 없다.

이 버튼은 테스트가 아니라 실제 발행 실행이다. 같은 실행을 연속으로 여러 번 누르지 않는다. 분야별 하루 1편 상한과 중복·품질 검사는 그대로 적용된다.

GitHub 수동 실행 절차의 공식 근거: [Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## 버튼을 누르지 않아도 돌아가는 시간

- 경제: 매일 01:00, 07:00, 13:00, 19:00 KST.
- 시사: 매일 04:00, 10:00, 16:00, 22:00 KST.
- 실제 시작은 GitHub 예약 실행 지연으로 늦어질 수 있다.
- 적합한 기사가 없거나 이미 하루 상한을 채웠으면 새 게시물이 없을 수 있다.

## 결과를 읽는 방법

| 보이는 결과 | 의미 | 다음 행동 |
|---|---|---|
| published + media ID/permalink | 실제 게시물 발행이 확인됨 | 링크로 제목·이미지·영상 확인 |
| no_publish | 실행됐지만 검수·신선도·일일 상한 등으로 발행하지 않음 | 아래 reason 확인; 같은 작업 반복 클릭 금지 |
| manual_action_required | 인증·권한 등 운영 확인 필요 | 오류 코드와 아래 표 확인 |
| pending/queued | 다른 작업 뒤에 대기 중 | 같은 원장을 동시에 바꾸지 않도록 순차 처리하므로 기다림 |
| GitHub 실행만 초록색 | 실행이 정상 종료됨 | 실제 발행 여부는 위 상태와 Instagram 링크로 따로 확인 |

## 안 됐을 때의 해결 순서

| 원인/문구 | 조치 |
|---|---|
| 401 / code 190 / session invalidated | Meta 앱에서 해당 계정을 재인증하고 새 토큰을 GitHub Secret `INSTAGRAM_ACCESS_TOKEN`에 저장한다. 토큰 원문은 채팅·로그에 넣지 않는다. 이후 operation `diagnose`로 읽기 접근을 확인한다. |
| permission / code 10·200 등 | 같은 앱·같은 계정의 콘텐츠 게시/댓글 권한을 확인한다. 단순 재시도보다 권한 승인과 새 토큰 확인이 먼저다. |
| no_candidate_passed_hotness_gate | 최신 인기·신선도 기준을 통과한 기사가 없음. 다음 후보 수집을 기다린다. |
| no_candidate_passed_daily_floor_gates | 장기 미발행 보충 모드에서도 편집 가치·인기·시의성 등을 모두 통과한 후보가 없음. 토큰 문제가 아니므로 기사별 탈락 사유를 점검한다. |
| recent_duplicate | 최근 게시물과 유사한 사건으로 판단됨. 원장의 기존 게시물과 대조하고, 실제로 다른 사건인지 개발 담당이 확인한다. 중복 검사를 끄고 재실행하지 않는다. |
| extraordinary_claim_unverified | 이례적인 수치·최대 기록 등에 필요한 독립 근거를 확보하지 못함. 추가 원문 근거가 확인되거나 다른 후보를 사용해야 한다. |
| image_context_unavailable / unmapped | 해당 사건에 맞는 검증된 이미지가 없음. 관련 자산을 검수·추가하거나 다음 후보를 사용한다. 무관 이미지를 강제로 붙이지 않는다. |
| unsupported numeric meaning | 숫자의 기간·분모·대상 등이 근거와 맞지 않음. 해당 문구를 근거대로 고치거나 불필요한 숫자를 제거해 재검증한다. |
| 429 / 5xx | 일시적 제한·서버 오류. 기존 제한된 재시도를 사용하고 무한 반복 실행하지 않는다. |

계정 재인증 후에도 문제가 있으면 토큰 대신 Action 링크와 오류 문구만 전달한다. 기사·이미지·문구 품질 문제는 개발/편집 담당이 수정한다.

## 인증 오류가 다시 나왔을 때만 하는 순서

지금은 새 토큰의 계정 연결이 검증돼 이 단계를 반복할 필요가 없다.

1. 실패한 실행을 열고 왼쪽 `publish-economy` 또는 `publish-issue`를 누른다.
2. 빨간 단계 또는 발행 결과의 오류 코드를 확인한다. 기사·이미지 검수 실패라면 토큰을 바꾸지 않는다.
3. 실제 `401 / 190`이면 기존 Meta 앱에서 `diem.magazine` 계정으로 정상 재인증한다. 권한 오류라면 앱의 Instagram 콘텐츠 게시 권한도 확인한다. 계정 조회 성공만으로 게시 권한까지 증명되지는 않는다.
4. 새 토큰을 얻었으면 [저장소 Actions Secrets](https://github.com/betterbit-ai/today_econ/settings/secrets/actions)를 연다.
5. `INSTAGRAM_ACCESS_TOKEN`의 수정 버튼을 누르고 Value에 새 토큰을 넣어 `Update secret`을 누른다. 항목이 없다면 `New repository secret`에서 같은 이름으로 만든다. `Variables` 탭에 저장하지 않는다.
6. [경제 Actions](https://github.com/betterbit-ai/today_econ/actions/workflows/diem_economy.yml) → `Run workflow` → `main` → operation `diagnose`로 한 번 실행한다. 이 작업은 실제 게시물을 올리지 않는다.
7. 계정 일치·접근 성공을 확인한 뒤 operation `hot_news`로 정상 발행을 실행한다.
8. 같은 오류가 남으면 Action 링크와 코드만 전달한다. 토큰 값을 보내지 않는다.

GitHub 설정 위치는 [공식 Secrets 안내](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)를 따른다. Instagram Login의 게시 권한은 Meta의 [Instagram API 안내](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)에 명시돼 있다.

## 별도로 남은 운영 항목

현재 유효한 Secret으로 자동 뉴스 발행은 진행하지만, Secret의 장기 자동 연장은 완료되지 않았다. 공개 암호화 파일 회전은 repository variable `INSTAGRAM_TOKEN_SOURCE=encrypted_vault`에 명시적으로 전환한 때만 실행된다. 이 저장 경로를 승인·검증하기 전에는 전환하지 않는다. 현재 토큰의 만료일은 발급 정보로 관리하고, 필요한 재발급은 같은 Secret을 갱신한다.
