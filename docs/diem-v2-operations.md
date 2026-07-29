# DIEM V2 운영·전환 가이드

## 자동 실행과 긴급 중단

- `DIEM Economy`: 경제 뉴스만 선별·준비·발행
- `DIEM Issue`: 시사 뉴스만 선별·준비·발행
- 두 액션은 24시간 동안 4시간마다, KST 01:00, 05:00, 09:00, 13:00,
  17:00, 21:00에 자동 실행됩니다.
- Actions 화면에서 수동 실행하면 별도 phase 선택 없이 해당 분야를 실제
  Instagram 발행까지 처리합니다.
- 적합한 핫뉴스가 없으면 `no_publish` 관측만 원장에 남기고 정상 종료합니다.
- 네이버 인기 목록을 읽지 못한 경우 RSS 후보는 장애 진단용으로만 기록하고,
  검증되지 않은 순위를 근거로 자동 발행하지 않습니다.
- 긴급 중단은 GitHub Actions 화면에서 두 워크플로를 비활성화합니다.

## 운영자가 직접 적용할 Instagram 항목

- 표시 이름: `DIEM | Daily Issue & Economy Magazine`
- 사용자 이름 1순위: `diem.magazine`
- 사용자 이름 폴백: `diem_magazine`
- 소개:

  `오늘을 놓치지 않는 경제·시사 브리핑`

  `지금 주목받는 경제·시사만 선별`

  `20·30 재테크 초보자를 위한 1분 매거진`

- 프로필 이미지: `assets/brand/diem-profile.png`

사용자 이름은 먼저 실제 확보 가능 여부를 앱에서 확인합니다. 변경 후
저장소 변수 `INSTAGRAM_USERNAME`도 같은 값으로 맞춰야 댓글의 계정 멘션과
중복 조정이 정확하게 동작합니다.

## GitHub Actions 설정

Secrets:

- `GROQ_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_TOKEN_ENCRYPTION_KEY` (기존 토큰 회전을 유지할 때)
- `PEXELS_API_KEY` (권장, 없으면 다음 폴백 사용)
- `UNSPLASH_ACCESS_KEY` (권장, 없으면 다음 폴백 사용)

Variables:

- `INSTAGRAM_USER_ID`
- `INSTAGRAM_USERNAME`

두 워크플로는 같은 concurrency group에서 직렬 실행됩니다. 각 실행은
이전 미완료 작업을 먼저 복구하고, 완료된 작업은 일일 원장 이력에 보존한
뒤 새 핫뉴스를 평가합니다. 토큰 주간 갱신과 인사이트 수집은 Economy
워크플로 안의 보조 작업으로 유지됩니다.

## Meta 사전 점검

- Instagram 전문 계정과 올바른 `INSTAGRAM_USER_ID`
- Reel 콘텐츠 발행 권한
- 댓글 읽기·작성·대댓글 권한
- 토큰 만료 여부

댓글 API가 계정 권한 또는 현재 연결 방식에서 지원되지 않으면 Reel은
성공 상태로 유지되고 댓글 단계만 `manual_action_required`가 됩니다.
Slack 상태 알림과 같은 발행 키의 GitHub Issue에서 수동 조치합니다.

## 원장 확인

각 날짜의 schema v3 단일 JSON에는 분야별 현재 실행과 같은 날 완료된
실행 이력이 함께 남습니다.

- 포털별 순위, 통합 점수, 분류와 탈락 이유
- 원문·확보된 추가 검증 URL, 주제 서명과 중복 판정
- 제목 후보·본문·댓글·해시태그
- 이미지 제작자·라이선스·원본 URL·선택 점수
- 음원 ID·라이선스·SHA-256
- Reel·댓글·대댓글 상태, 시도 횟수, 외부 ID와 오류

대용량 이미지와 MP4는 `.diem-cache/`와 최대 72시간의 임시 GitHub
Release에만 존재합니다. Git에는 텍스트 메타데이터와 해시만 남습니다.

## 알림 정책

Slack에는 본문·이미지·영상이 아니라 다음 상태만 전송됩니다.

- Reel 발행 완료
- 최초 실패와 재시도 예정
- 재시도 복구 성공
- 최종 실패와 수동 조치 필요
- 실제 발행 완료와 복구·오류 상태

`manual_action_required`와 비정상 실패는 안정적인 키로 GitHub Issue를
생성하거나 기존 Issue에 누적하고, 복구되면 닫습니다. 정기 감시에서
핫뉴스가 없었던 정상 `no_publish`는 알림과 Issue를 만들지 않습니다.

## 수동 검수 체크리스트

- 프로필을 원형으로 잘랐을 때 `DIEM`이 안전 영역 안에 있는가
- 경제·시사 표지 각 3건이 작은 모바일 화면에서 읽히는가
- 실제 기사 두 건의 숫자·날짜·인물과 독립 근거가 일치하는가
- 선택 이미지의 원본 링크와 상업적 이용 조건이 기록됐는가
- 경제 3곡·시사 3곡의 음량과 민감 주제 분위기가 적절한가
- 테스트 Reel이 정확히 7초이며 Carousel·Story가 생성되지 않는가
- 첫 댓글은 이모지 하나, 대댓글은 멘션과 12~15개 태그인가
- 같은 명령을 다시 실행해도 중복 Reel이 생기지 않는가
