# Instagram Login의 두 ID를 구분한다

새 Secret으로 API 응답을 받았는데도 복구 진단이 connected account mismatch로 실패했다. 진단은 `id`만 요청해 설정된 전문 계정 ID와 비교했다. Instagram Login의 `id`는 앱 범위 ID일 수 있고 `user_id`는 전문 계정 ID다.

기존 `src/check-instagram.js`는 이미 `user_id || id`를 사용했다. 진단도 GET `/me`에서 두 필드를 요청하고 `user_id`를 우선해 비교하며 사용자명까지 확인하도록 맞췄다. 실제 불일치는 운영 확인 상태로 분리한다. 선택된 ID·사용자명만 남기고 전체 응답이나 비밀값을 기록하지 않는다.

새 토큰이 401을 반환하지 않았다는 것만으로 계정 일치나 발행 권한을 확정하지 않는다. 진단 코드의 ID 해석 오류도 먼저 배제한다. 전문 계정 ID 일치, 사용자명 일치, 실제 정상 발행을 서로 다른 증거로 확인한다.

회귀: 앱 범위 ID와 전문 계정 ID가 달라도 후자가 설정과 같으면 통과; 계정 ID 또는 사용자명이 다르면 manual_action_required; 응답의 access_token 같은 추가 필드는 결과에 포함되지 않는다.

근거: [Meta Instagram Login 시작 가이드의 필드 정의](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started), 기존 연결 점검 코드, 두 실패 회귀 후 수정과 실제 production 진단.
