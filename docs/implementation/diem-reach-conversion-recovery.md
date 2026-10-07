# DIEM 도달·전환 회복 구현·운영 가이드

## 현재 안전 상태

- `EXPLAIN_REELS_ENABLED=false`가 기본값이며 두 production Action에도 고정돼 있다.
- Economy·Issue 예약 시각, 음악, 카테고리별 하루 1편 제한은 바꾸지 않았다.
- explain은 환경변수만 `true`로 바꿔서는 열리지 않는다. 아래 세 capability gate의
  증거 파일이 모두 통과해야 한다.
- 기존 daily package v1·v2는 검증·조회만 가능하다. 신규 제출·준비·발행은 v3만
  가능하다.

## 구현된 보호 장치

1. `주택가`, `주거침입`을 주거 정책으로 보지 않는다.
2. `공원`, `병원`, `원정`의 `원`을 금액으로 보지 않는다. 숫자+원 단위 또는
   명시적 금융 용어만 money signal이다.
3. 지역 폭행·패싸움·경찰 추적은 전국적 제도·공적 인물·대규모 피해 근거가 없으면
   Economy와 Issue 모두 거절한다.
4. explain은 서로 다른 세 claim과 원문 span으로 `what_happened`,
   `reader_impact`, `what_to_watch`가 각각 증명될 때만 후보가 된다.
5. Vision은 `qwen/qwen3.8-27b` 활성 상태를 먼저 확인하고, 두 이미지 한 묶음을
   한 번만 검토한다. 실패하면 미검수 웹 이미지를 발행하지 않는다.
6. 대표 성과는 24시간 `reach`다. 누락된 reach를 views로 대체하지 않는다.

## 평상시 운영

```bash
npm test
npm run diem:explain-gates
node src/v2/index.js performance-report
```

`diem:explain-gates`가 `passed: false`이면 정상적인 안전 상태다. 이 상태에서는
모든 정상 뉴스가 flash로만 준비되고, 복잡한 기사를 안전하게 요약하지 못하면 다음
후보 또는 `no_publish`로 끝난다.

## explain capability gate 증명

예시는 `docs/implementation/diem-explain-capability-gates.example.json`에 있다.
검증 완료 후에만 실제 파일
`data/reports/diem-explain-capability-gates.json`을 만든다. 숫자만 채우지 말고 각
표본의 고유 ID를 배열에 기록해야 한다.

### 1. 분류 shadow 40건

최근 후보 40건을 현재 분류기로 다시 평가하고 사람이 원문과 대조한다.

- category 오분류 0건
- eventKind 오분류 0건
- 지역 개인 범죄의 Economy·Issue 유입 0건
- `classificationShadow.reviewed=40`
- `classificationShadow.sampleIds`에 서로 다른 40개 후보 ID
- 사고가 하나라도 있으면 `incidents`를 올리고 explain을 열지 않는다.

### 2. explain 초안 10건

발행하지 않는 shadow 초안 10건에서 각 장면의 claim ID와 source span을 원문에
대조한다.

- 세 역할의 의미 오류 0건
- claim 중복 0건
- source span 불일치 0건
- `explainDrafts.reviewed=10`
- `explainDrafts.sampleIds`에 서로 다른 10개 초안 ID

### 3. 실제 Vision shadow 5회

동일한 production 자격 증명과 모델로 실제 2장 검수를 5회 연속 실행한다.

- `model_not_found=0`
- `transportErrors=0`
- `consecutiveSuccesses=5`
- `successfulRunIds`에 서로 다른 5개 실행 ID

증거 파일을 만든 다음 다음 명령이 `passed: true`인지 확인한다.

```bash
npm run diem:explain-gates
```

그 뒤에만 별도 배포 변경에서 `EXPLAIN_REELS_ENABLED=true`를 검토한다. 코드가
카테고리별 3일에 최대 1편, 카테고리별 누적 5편의 canary 상한을 강제한다.
분류·장면·이미지 사고가 한 건이라도 증거 또는 원장에 기록되면 자동으로 다시
차단한다.

## 성과 판정

신규 전략 v3의 정시 24시간 표본만 최종 목표에 사용한다.

- Economy reach 중앙값 300 이상, 최소 10편
- Issue reach 중앙값 300 이상, 최소 10편
- flash 시청 비율 50% 이상, 최소 10편
- explain 시청 비율 40% 이상, 최소 5편
- 저장 또는 공유가 한 번 이상인 게시물 비율 20% 이상, 최소 20편
- 중복 제거 계정 스냅샷의 14일 팔로워 순증
- 품질 사고 0건

표본이 부족하면 리포트의 결론은 `insufficient_data`다. 구버전 표본은 보고에는
보이지만 목표 판정과 prior 학습에는 쓰지 않는다.

## 프로필 전환 자산

`content/profile-funnel`에 업로드 가능한 1080×1350 PNG 3개가 있다. SVG를
수정하면 다음 명령으로 PNG를 다시 만든다.

```bash
npm run diem:profile-funnel:export
```

Instagram의 게시물 고정과 하이라이트 생성은 Graph API가 제공하지 않는 계정 UI
작업이므로 `content/profile-funnel/README.md` 체크리스트대로 실계정에서 확인한다.
코드 배포 완료와 실계정 적용 완료를 같은 상태로 기록하지 않는다.

## 롤백

1. GitHub Actions의 `EXPLAIN_REELS_ENABLED`를 `false`로 유지 또는 복원한다.
2. 증거 파일의 `qualityIncidents`를 1 이상으로 기록한다.
3. 미검수 웹 이미지로 우회하지 않는다. 검수된 라이브러리가 없으면
   `no_publish`로 종료한다.
4. 성과 prior가 의심되면 리포트는 유지하고 표본 하한 미달 상태로 prior 0을
   유지한다.
