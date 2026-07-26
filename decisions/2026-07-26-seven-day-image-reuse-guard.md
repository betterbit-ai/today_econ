---
date: 2026-07-26
scope: feature
status: active
source: production-incident
related:
  - 2026-07-25-local-similarity-and-rights-safe-media
  - 2026-07-25-github-first-diem-publishing
---

# 최근 7일 배경 이미지는 원장 기반 식별자로 재사용을 막는다

## Decision

DIEM V2는 이미지 후보를 선택할 때 최근 7일 GitHub 원장에 기록된 이미지의
`id`, `originalUrl`, `downloadUrl`, `localSha256`를 비교해 같은 이미지를
제외한다. 선택된 이미지는 검색어 안에서 몇 번째 후보였는지와 재사용
가드 결과를 함께 기록한다.

## Context and constraints

정부·정책성 이슈는 검색어가 `government parliament policy law`처럼
반복되기 쉽고, Pexels/Unsplash의 상위 후보도 안정적으로 반복될 수 있다.
기존 구현은 상위 5개 후보 중 랜덤으로 고르는 방식이라, 확률적으로는
가능하지만 실제 릴스 피드에서는 같은 배경이 이틀 연속 쓰여 브랜드
신선도가 떨어졌다.

프로젝트는 별도 DB 없이 GitHub 원장을 진실의 원본으로 사용한다. 따라서
이미지 중복 방지도 외부 상태 저장소가 아니라 기존 일일 원장과 재생성 가능한
히스토리 객체에서 해결한다.

## Alternatives considered

- 랜덤 후보 수를 5개에서 더 늘리기: 반복 확률은 낮아지지만 같은 이미지가
  다시 선택되는 것을 결정적으로 막지 못한다.
- 키워드별 최근 이미지 캐시 파일을 별도로 만들기: 구현은 명확하지만
  원장과 파생 캐시의 정합성 관리가 추가되어 채택하지 않았다.
- 다운로드한 이미지 해시만 비교하기: 가장 정확하지만 다운로드 전에는
  차단할 수 없어 API 호출과 처리 시간이 낭비된다.

## Revisit when

- 검수된 분야별 로컬 이미지 풀을 별도로 운영하게 될 때
- 이미지 공급처가 같은 사진에 불안정한 id나 URL을 반환하는 문제가 반복될 때
- 최근 7일 제한이 너무 빡빡해 typographic fallback이 과도하게 늘어날 때
