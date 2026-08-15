---
date: 2026-08-14
scope: feature
status: superseded
source: harness-implement
superseded_by: 2026-08-15-diem-basic-five-card-lessons.md
---

# DIEM Basic은 검증된 완성 패키지를 Git에서 발행한다

## Decision

DIEM Basic의 주제 선정, 공식 자료 조사, 원고, 프로젝트 원본 표지, 음원 합성과
검수는 발행일 전에 완료한다. GitHub Actions는 Git에 저장된 다음 `ready`
패키지의 검토 기한과 콘텐츠·표지·Reel 해시를 검증하고 Instagram 발행과
원장·Slack 상태 기록만 수행한다.

## Context and constraints

- 교육 콘텐츠는 실시간 기사보다 커리큘럼 질문과 설명 순서가 먼저다.
- 세법·규제 수치를 자동 요약하면 제안과 현행 제도, 근거 시점이 섞일 수 있다.
- 별도 DB와 상시 유료 인프라 없이 Git을 데이터베이스로 사용한다.
- 웹 이미지와 인물 사진의 무관 인물·저작권·신뢰 리스크를 교육 시리즈에서는
  감수할 이유가 없다.
- 예약 실행마다 LLM·웹 검색·렌더링 결과가 달라지면 사전 검수의 의미가 사라진다.

따라서 `content/diem-basic/`의 JSON, 사람이 읽는 brief, 최종 PNG·MP4와
SHA-256을 하나의 발행 단위로 본다. 사람 얼굴은 금지하고 주제별 프로젝트 원본
다이어그램을 사용한다. 변경 가능한 사실에는 재검토 기한을 두고 만료 시
실패-폐쇄한다.

## Alternatives considered

- 최근 발행 뉴스에서 매주 LLM으로 개념 생성: 뉴스성 사건과 교육 가치가
  일치하지 않고 품질·사실 검증이 발행 직전으로 밀려 기각했다.
- Action에서 원고만 고정하고 표지·Reel을 다시 렌더링: 결과와 런타임 의존성이
  달라질 수 있어 “발행만” 경계를 만족하지 못해 기각했다.
- Slack 승인 후 임시 Release를 발행 원본으로 사용: 승인 단위는 안전하지만
  장기 커리큘럼 자산과 제작법을 Git에 축적하기 어렵고 운영 단계가 늘어 기각했다.
- 별도 CMS·DB: 현재 4편 실험 규모와 무상 인프라 원칙에 비해 과도해 기각했다.

## Revisit when

- 첫 4편 모두 7일 성과가 모이고 다음 배치를 승인할 때
- Git 저장소의 미디어 크기가 운영상 부담이 될 때
- Instagram 발행 API가 비공개 저장소 파일을 직접 안정적으로 소비할 수 있을 때
- 교육 형식이 1장 7초 Reel에서 여러 장 또는 음성 설명으로 바뀔 때
