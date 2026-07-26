---
date: 2026-07-27
scope: feature
status: active
source: production-incident
related:
  - 2026-07-26-fail-closed-editorial-guardrails
  - 2026-07-26-editorial-value-and-claim-state-gates
---

# 원고 생성 실패는 규칙 기반 발행이 아니라 다음 후보 전환으로 처리한다

## Decision

DIEM V2 자동 발행은 선정 후보의 LLM 제목·본문 생성이나 검증이 실패하면
deterministic fallback 원고를 발행하지 않고, 같은 분야의 다음 인기 후보를
다시 평가해 준비한다.

## Context and constraints

자동차보험 적자 기사처럼 기사 자체는 충분히 흥미롭고 DIEM 경제 주제로
다룰 만해도, LLM이 숫자 검증이나 JSON 형식 검증에서 실패할 수 있다.
이때 원문-only deterministic fallback이 방송사 제보 푸터, 앵커/리포트
표식, 붙은 문장 조각을 본문으로 오인하면 기사 선정 품질과 무관하게
발행물 신뢰가 무너진다.

DIEM은 별도 DB와 상시 유료 인프라 없이 GitHub 원장을 상태의 원본으로
쓴다. 따라서 후보 전환과 실패 이유도 원장 후보 목록과 publication 상태에
남겨야 하며, 경제와 시사 분야는 서로 독립적으로 계속되어야 한다.

## Alternatives considered

- deterministic fallback을 더 정교하게 만들기: 발행 지속성은 좋아지지만,
  원문 추출 오염이나 문장 파편을 완전히 제거했다고 보장하기 어렵고
  신뢰도 사고의 하방 위험이 너무 크다.
- 같은 후보를 `retry_pending`으로 남기기: 일시적 API 장애에는 유용하지만,
  콘텐츠 검증 실패를 반복 재시도하면 같은 낮은 품질 후보에 갇힐 수 있다.
- LLM reranking으로 후보 순서를 다시 매기기: 주관적 품질 개선에는 도움이
  될 수 있으나, 현재 스펙의 인기 순서 유지 원칙과 무료 모델 한도에 맞지
  않는다.

## Revisit when

- 발행 전 사람 승인 큐가 생겨 실패 후보를 수동 편집으로 살릴 수 있을 때
- 별도 검수 모델이나 더 안정적인 생성 모델을 도입해 자동 fallback의
  신뢰도를 실측으로 입증할 수 있을 때
- 후보 소진으로 `no_publish`가 과도하게 늘어나 발행 지속성보다 품질
  보존의 비용이 더 커졌다고 판단될 때
