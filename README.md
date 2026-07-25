# DIEM — Daily Issue & Economy Magazine

DIEM은 재테크 초보자가 오늘의 경제 뉴스 1건과 시사 뉴스 1건을 짧게
이해할 수 있도록 매일 두 편의 7초 Instagram Reel을 만드는 데일리
매거진 파이프라인입니다.

- 채널: `@diem.magazine` (`diem_magazine`은 사용자 이름 폴백)
- 소개: `하루 두 번, 돈과 세상을 이해하는 가장 짧은 방법. 경제 1개,
  시사 1개를 쉽고 정확하게 전합니다.`
- 발행: 18:30 KST 경제, 21:00 KST 시사
- 저장: 별도 DB 없이 GitHub 일일 원장과 파생 인덱스
- 원칙: 인기 순서를 따르되 독립 교차 검증·7일 중복·권리·형식 게이트를
  통과하지 못하면 억지로 발행하지 않습니다.

제품 방향은 [`spec/mission.md`](spec/mission.md), 실행 계약과 수용 기준은
[`spec/spec.md`](spec/spec.md), 실제 설정·전환 절차는
[`docs/diem-v2-operations.md`](docs/diem-v2-operations.md)에 있습니다.

## V2 흐름

1. 네이버·다음 당일 인기 뉴스 최대 50건씩을 통합하고, 양쪽 실패 시
   기존 RSS를 명시적 폴백으로 사용합니다.
2. 경제·시사 후보를 분류하고 독립 기사 교차 검증과 최근 7일 주제
   중복 판정을 통과한 최상위 1건씩을 같은 일일 큐에 고정합니다.
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
npm run diem:plan
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

V2 예약은 저장소 변수 `DIEM_PIPELINE_ENABLED=true`일 때만 동작합니다.
전환 전에는 false로 두고 수동 dry-run을 수행합니다. 기존 V1 코드는
보존되어 있으며, `.github/workflows/daily_news.yml`은 예약 없이 수동
롤백 용도로만 남아 있습니다.
