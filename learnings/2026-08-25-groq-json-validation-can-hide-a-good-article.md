---
date: 2026-08-25
category: operations
source: production-ledger
---

# Groq JSON 검증 실패는 빈 모델 응답으로 보일 수 있다

## Situation

두 개의 고품질 후보에서 Groq가 HTTP 400 `json_validate_failed`와 빈
`failed_generation`을 반환했다. 다른 후보에서는 120B가 객체를 반환했지만
`sentences` 배열이 없어 전체 기사가 탈락했다.

## What we learned

서버 JSON mode는 모델 초안을 검증 전에 폐기할 수 있어 기사 자체의 편집 가능성을
판단할 증거가 아니다. 반대로 JSON mode를 무조건 끄면 잘린 응답이 늘 수 있다.

## Next time

JSON mode를 기본으로 유지하되 이 오류에만 plain-JSON 회수를 한 번 사용한다.
구조가 깨졌다면 source와 news frame을 잠근 짧은 복구 프롬프트를 한 번 사용하고,
검증 실패 시 다음 모델·후보로 이동한다.
