# DIEM — Daily Issue & Economy Magazine

DIEM은 재테크 초보자가 지금 주목받는 경제·시사 뉴스를 짧게 이해하도록,
검증된 핫뉴스가 있을 때만 7초 Instagram Reel을 만드는 데일리 매거진
파이프라인입니다.

- 채널: `@diem.magazine` (`diem_magazine`은 사용자 이름 폴백)
- 소개: `오늘을 놓치지 않는 경제·시사 브리핑. 20·30 재테크 초보자를
  위한 1분 매거진.`
- 감시: `DIEM Economy`와 `DIEM Issue`가 KST 01·05·09·13·17·21시에 독립 실행
- 발행: 현재 인기·게시 시각·편집 가치 기준을 통과한 분야만 발행
- 저장: 별도 DB 없이 GitHub 일일 원장과 파생 인덱스
- 원칙: 인기 순서를 따르되 기사 근거·7일 중복·권리·형식 게이트를
  통과하지 못하면 억지로 발행하지 않습니다.

제품 방향은 [`spec/mission.md`](spec/mission.md), 실행 계약과 수용 기준은
[`spec/spec.md`](spec/spec.md), 실제 설정·전환 절차는
[`docs/diem-v2-operations.md`](docs/diem-v2-operations.md)에 있습니다.

## V2 흐름

1. 현재 네이버 인기 뉴스 최대 50건을 수집하고, 수집 실패 시 기존 RSS는
   장애 진단 자료로만 기록하며 자동 발행하지 않습니다.
2. 선택한 분야 후보만 분류해 인기 순위·게시 후 경과 시간·편집 가치와
   최근 7일 주제 중복 판정을 통과한 최상위 핫뉴스를 고릅니다.
3. 14자 이하 2줄 타이틀, 권리 확인 웹 이미지 또는 무사진 표지,
   정확히 3문장인 본문과 댓글 체인을 생성합니다.
4. 저장소에 포함된 DIEM 자체 제작 음원 6곡 중 분야별 1곡을 골라
   1080×1920 H.264/AAC 단일 표지 Reel을 만듭니다.
5. Reel·첫 댓글·해시태그 대댓글을 독립 상태로 발행하고 재실행 전에
   Instagram과 조정하여 중복을 막습니다.

## 로컬 실행

```bash
npm ci
npx playwright install chromium
python3 -m pip install -r requirements-v2.txt

npm run diem:similarity
node src/v2/index.js select --category economy --slot local-test
npm run diem:prepare -- --category economy
node src/v2/index.js publish --category economy
```

`PUBLISH_INSTAGRAM=false`가 기본이므로 마지막 명령도 실제 게시하지 않고
준비 상태를 보존합니다. 실제 게시에는 환경 변수 설정 후
`PUBLISH_INSTAGRAM=true`를 명시해야 합니다.

```bash
npm test
node .codex-harness/scripts/verify-project.mjs
```

## 데이터와 롤백

- 원장: `data/publications/YYYY/MM/YYYY-MM-DD.json`
- 재생성 가능한 7일 인덱스: `data/editorial-history.json`
- 임시 렌더·다운로드: `.diem-cache/` (Git 제외)
- 프로필: `assets/brand/diem-profile.png`
- 자체 음원: `assets/audio/diem/`

예약 실행에는 별도 활성화 변수가 필요하지 않습니다. GitHub Actions의
`DIEM Economy` 또는 `DIEM Issue`를 수동 실행해도 선택한 분야의 선별부터
실제 발행까지 동일하게 진행됩니다. 발행을 긴급 중단하려면 해당 두
워크플로를 GitHub Actions 화면에서 비활성화합니다.
