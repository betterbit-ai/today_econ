---
date: 2026-10-06
scope: editorial-pipeline
status: active
source: user
supersedes:
  - 2026-09-29-discovery-first-content-funnel.md
---

# explain과 성과 학습을 증거 기반 v3 gate 뒤에 둔다

## Decision

분류·장면·Vision의 세 capability gate가 증명되기 전에는 모든 일반 뉴스를
flash로 운영한다. explain 재개 후에도 카테고리별 3일 간격과 5편 canary 상한을
강제한다. 신규 성과의 대표 지표는 reach이고, views는 대체값으로 쓰지 않는다.
daily package와 editorial, analytics는 v3로 올리며 v1·v2는 읽기 전용으로 남긴다.

## Context

최근 성과 하락 구간에는 콘텐츠 전략보다 부분일치 분류, 근거 없는 장면 역할,
폐기된 Vision 모델, views/reach 혼용이 먼저 발행 품질과 측정을 오염시켰다. 형식
실험을 확대하기 전에 파이프라인 사고를 0으로 만드는 것이 필요하다.

## Rejected

- 환경변수 하나로 explain 즉시 재개: 증거 없는 재발 위험이 있다.
- Vision 장애 시 메타데이터만으로 웹 이미지 발행: 실제 이미지 의미를 보증하지
  못한다.
- 구버전 성과를 v3로 소급 변환: 당시 분류·이미지·포맷 계약을 재현할 수 없다.

## Directive

`EXPLAIN_REELS_ENABLED=true`만으로 gate를 우회하지 않는다. 세 표본 ID 배열과
무사고 결과가 있는 증거 파일을 요구한다. 품질 사고가 한 건이라도 있으면 즉시
flash-only로 되돌린다.
