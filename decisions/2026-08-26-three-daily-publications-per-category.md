---
date: 2026-08-26
scope: project
status: active
source: user
supersedes:
  - 2026-08-25-generated-fallback-library-and-four-post-cap.md
---

# 경제와 시사를 각각 하루 세 편까지 허용한다

## Decision

6시간 간격의 Economy·Issue 폴링은 유지하고, 일반 뉴스의 KST 일일 상한을
분야별 2편에서 3편으로 올린다. 품질 기준을 낮춰 여섯 편을 채우지는 않는다.

## Context

분야별 2편 상한은 이미지 품질 사고를 줄이는 기간에는 유효했지만, 생성 이미지
라이브러리와 fail-closed 경로를 보강한 뒤에는 좋은 후보가 있어도 너무 일찍
예산이 닫혀 계정 발행량이 급감했다.

## Rejected

- 상한 없이 모든 6시간 폴링을 발행: 하루 최대 8편까지 늘어 피드 과밀 위험이 있다.
- 품질 점수를 낮춰 3편을 강제: 발행량을 위해 채널 신뢰를 희생한다.

## Directive

3편은 최대치일 뿐 목표량이 아니다. 네 번째 뉴스는 같은 KST 날짜에 반드시
차단하고, 발행량이 다시 과도해지면 성과·삭제율을 함께 보고 재조정한다.
