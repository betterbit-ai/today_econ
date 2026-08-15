# DIEM V2 운영·전환 가이드

## 자동 실행과 긴급 중단

- `DIEM Economy`: 경제 뉴스만 선별·준비·발행
- `DIEM Issue`: 시사 뉴스만 선별·준비·발행
- 두 액션은 6시간 간격으로 교차 실행됩니다. Economy는 KST 01:00, 07:00,
  13:00, 19:00이고 Issue는 KST 04:00, 10:00, 16:00, 22:00입니다.
- Issue를 수동 실행하면 시사 핫뉴스를 실제 Instagram 발행까지 처리합니다.
- Economy 수동 실행에서는 `hot_news`, `publish_basic`, `retry_basic`,
  `record_moderation`, `collect_insights` 중 하나를 고릅니다. 기본값 `hot_news`는 경제 핫뉴스를
  실제 발행까지 처리합니다.
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

## DIEM Basic 사전 제작 큐

DIEM Basic은 실시간 뉴스 파이프라인과 분리합니다. 주제·원고·공식 출처·5장
교육 카드·음원·최종 19초 Reel을 먼저 검수해 `content/diem-basic/`에 저장하고, 매주 일요일
KST 09:30에 Economy Action이 다음 `ready` 패키지를 한 편 발행합니다.

예약 Action은 패키지의 검토 기한, 콘텐츠 해시, 카드 5장·표지·Reel SHA-256을 확인하고
업로드만 합니다. Groq 호출, 뉴스 선정, 웹 이미지 검색, Playwright 렌더링,
ffmpeg 음원 합성이나 원고 변경은 하지 않습니다. 패키지가 만료됐거나 파일이
달라졌거나 남은 `ready` 패키지가 없으면 발행을 닫고 정확한 사유와 Action
링크를 Slack으로 보냅니다.

수동 실행은 Actions > `DIEM Economy` > Run workflow에서 처리합니다.

1. 다음 편 발행: `operation=publish_basic`, `content_id`는 비웁니다.
2. 특정 편 발행: `operation=publish_basic`, manifest에 있는 `content_id`를
   입력합니다. 이미 발행된 ID는 거부됩니다.
3. 독립 단계 복구: Reel은 발행됐지만 Story·댓글·대댓글만 실패했다면
   `operation=retry_basic`과 원장의 `publication_key`를 입력합니다.

새 편 제작과 갱신은 `.codex/skills/diem-basic-production/SKILL.md`를 따릅니다.
`npm run diem:basic:build -- --id <content-id>`로 카드 5장·표지·Reel과 해시를 다시
만든 후 테스트를 통과시켜야 `ready`로 유지할 수 있습니다.

운영자가 Instagram에서 게시물을 삭제하거나 정정했다면
`operation=record_moderation`에 해당 `publication_key`, 조치와 사유를 입력해
4주 리포트가 삭제·정정 건수뿐 아니라 이유까지 보존하도록 합니다.

첫 실험은 승인 발행 4편으로 제한됩니다. 7일 성과까지 모이면
`data/reports/diem-basic-experiment.md`와 JSON 리포트가 완성되고 Slack에
요약이 전송됩니다. 실험 중에는 광고 안내 게시물, 브랜드 아웃바운드와
Gifts 운영을 시작하지 않습니다.

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
- 이미지 제작자·라이선스·원본 URL·선택 점수·무관 인물 검사·7일 중복 근거
- 음원 ID·라이선스·SHA-256
- Reel·댓글·대댓글 상태, 시도 횟수, 외부 ID와 오류

핫뉴스 대용량 이미지와 MP4는 `.diem-cache/`와 최대 72시간의 임시 GitHub
Release에만 존재합니다. DIEM Basic은 예외로 검수 완료된 `cover.png`와
`reel.mp4`까지 Git에 저장해 예약 Action의 결과가 바뀌지 않게 합니다.

## 알림 정책

핫뉴스 Slack에는 본문·이미지·영상이 아니라 다음 상태만 전송됩니다.

- Reel 발행 완료
- 최초 실패와 재시도 예정
- 재시도 복구 성공
- 최종 실패와 수동 조치 필요
- 실제 발행 완료와 복구·오류 상태

`manual_action_required`와 비정상 실패는 안정적인 키로 GitHub Issue를
생성하거나 기존 Issue에 누적하고, 복구되면 닫습니다. 정기 감시에서
핫뉴스가 없었던 정상 `no_publish`는 알림과 Issue를 만들지 않습니다.
DIEM Basic 예약 발행이 실패하면 만료, 해시 불일치, 큐 고갈, Instagram 단계
오류를 구분해 Slack에 보냅니다.

## 수동 검수 체크리스트

- 프로필을 원형으로 잘랐을 때 `DIEM`이 안전 영역 안에 있는가
- 경제·시사 표지 각 3건이 작은 모바일 화면에서 읽히는가
- 실제 기사 두 건의 숫자·날짜·인물과 독립 근거가 일치하는가
- 선택 이미지의 원본 링크와 상업적 이용 조건이 기록됐는가
- 경제 3곡·시사 3곡의 음량과 민감 주제 분위기가 적절한가
- 테스트 Reel이 정확히 7초이며 Carousel·Story가 생성되지 않는가
- 첫 댓글은 이모지 하나, 대댓글은 멘션과 12~15개 태그인가
- 같은 명령을 다시 실행해도 중복 Reel이 생기지 않는가
