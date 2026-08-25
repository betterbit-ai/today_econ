---
date: 2026-08-25
scope: project
status: active
source: production-incident
---

# JSON 전송 실패와 기사 품질 실패를 분리한다

## Decision

선정 시 인기·신선도·편집가치를 통과한 기사는 Groq JSON mode의
`json_validate_failed`만으로 버리지 않는다. 같은 모델의 plain-JSON 회수를 한 번,
본문 구조 복구를 한 번 허용한 뒤 기존 검증을 다시 적용한다.

당시에는 신선했지만 편집 전송 장애로 `no_publish`가 된 기록은 publication key를
지정해 48시간 안에 한 번 더 파이프라인에 태울 수 있다. 원본 실패 기록은 보존하고
새 publication key를 만들며, 분야별 일일 2편 예산은 우회하지 않는다.

## Context

현대차 노사 잠정합의와 유시민 대통령 비판 기사는 각각 편집가치 80점·75점,
핫 점수 93.67점·89.58점으로 통과했지만 모델 JSON 구조 또는 Groq 서버 JSON
검증 실패로 발행되지 않았다. 이는 기사 가치 문제가 아니라 응답 운반 실패였다.

## Rejected

- 모든 모델 실패에 deterministic 원고 발행: 과거 사진 설명·방송 푸터 사고를 반복한다.
- 48시간이 지난 기사도 publication key로 강제 발행: 시의성을 우회한다.
- JSON 가드를 제거: 파싱 불가능하거나 잘린 결과가 다음 단계로 유입된다.

## Directive

복구 출력도 숫자, 확정 상태, 원문 복사, 제목, 이미지 가드를 모두 통과해야 한다.
복구 횟수를 늘려 발행률을 맞추지 않는다.
