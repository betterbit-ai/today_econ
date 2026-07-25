# DIEM V2 운영·전환 가이드

## 안전한 전환 순서

1. 저장소 변수 `DIEM_PIPELINE_ENABLED`를 `false`로 둡니다.
2. GitHub Actions에서 `DIEM V2 Daily Reels`를 `plan`으로 수동 실행해
   일일 원장과 후보 탈락 이유를 확인합니다.
3. `economy`, `issue`를 각각 `publish_instagram=false`로 실행해 표지,
   7초 영상, 본문, 이미지 권리 기록과 음원을 검수합니다.
4. Meta 테스트 미디어에서 Reel 1건과 이모지 댓글·해시태그 대댓글을
   실제로 확인합니다.
5. 아래 계정 변경을 Instagram 앱에서 적용합니다.
6. 하루 예약 실행을 관찰한 뒤 `DIEM_PIPELINE_ENABLED=true`로 전환합니다.

V2가 불안정하면 `DIEM_PIPELINE_ENABLED=false`로 즉시 중단합니다. 기존
V1 수동 워크플로와 데이터는 삭제하지 않으며, V2 원장도 감사 기록으로
남깁니다.

## 운영자가 직접 적용할 Instagram 항목

- 표시 이름: `DIEM | Daily Issue & Economy Magazine`
- 사용자 이름 1순위: `diem.magazine`
- 사용자 이름 폴백: `diem_magazine`
- 소개:

  `하루 두 번, 돈과 세상을 이해하는 가장 짧은 방법.`

  `경제 1개, 시사 1개를 쉽고 정확하게 전합니다.`

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
- `DIEM_PIPELINE_ENABLED` (`false` → 검수 후 `true`)

워크플로는 같은 concurrency group에서 직렬 실행됩니다. 18:30 KST에는
두 분야 큐를 함께 고정하고 경제를 처리하며, 21:00 KST에는 같은 원장을
읽어 시사를 처리합니다. 수동 `retry-all`은 완료된 단계는 건너뜁니다.

## Meta 사전 점검

- Instagram 전문 계정과 올바른 `INSTAGRAM_USER_ID`
- Reel 콘텐츠 발행 권한
- 댓글 읽기·작성·대댓글 권한
- 토큰 만료 여부

댓글 API가 계정 권한 또는 현재 연결 방식에서 지원되지 않으면 Reel은
성공 상태로 유지되고 댓글 단계만 `manual_action_required`가 됩니다.
Slack 상태 알림과 같은 발행 키의 GitHub Issue에서 수동 조치합니다.

## 원장 확인

각 날짜의 단일 JSON에는 다음이 남습니다.

- 포털별 순위, 통합 점수, 분류와 탈락 이유
- 원문·독립 교차 검증 URL, 주제 서명과 중복 판정
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
- 품질 기준을 만족한 후보가 없어 발행 생략

`manual_action_required`와 `no_publish`는 안정적인 키로 GitHub Issue를
생성하거나 기존 Issue에 누적하고, 복구되면 닫습니다.

## 수동 검수 체크리스트

- 프로필을 원형으로 잘랐을 때 `DIEM`이 안전 영역 안에 있는가
- 경제·시사 표지 각 3건이 작은 모바일 화면에서 읽히는가
- 실제 기사 두 건의 숫자·날짜·인물과 독립 근거가 일치하는가
- 선택 이미지의 원본 링크와 상업적 이용 조건이 기록됐는가
- 경제 3곡·시사 3곡의 음량과 민감 주제 분위기가 적절한가
- 테스트 Reel이 정확히 7초이며 Carousel·Story가 생성되지 않는가
- 첫 댓글은 이모지 하나, 대댓글은 멘션과 12~15개 태그인가
- 같은 명령을 다시 실행해도 중복 Reel이 생기지 않는가
