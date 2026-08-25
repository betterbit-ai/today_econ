---
date: 2026-08-25
category: operations
source: production-ledger
---

# Vision 이미지 수 자체가 무료 TPM 한도를 넘길 수 있다

## Situation

2026-08-24 주거 기사에서 Qwen Vision이 상위 이미지 3장을 검수하려다 8,000
TPM 한도에 대해 8,651토큰을 요청해 413으로 실패했다. 기사 텍스트가 짧아도
이미지 입력 토큰이 요청량을 크게 만들 수 있었다.

## What we learned

Vision 검수의 입력 예산은 텍스트 길이만으로 관리할 수 없다. 무료 한도에서는
후보 3장보다 2장 비교가 안정적이며, 외부 모델 실패를 웹 이미지 무검수 통과로
완화해서는 안 된다.

## Next time

실제 이미지 shortlist는 2장으로 제한한다. 모델 오류·rate limit·불확실 판정은
주제 매칭 프로젝트 생성 자산으로 닫고, 같은 생성 자산도 7일 동안 반복하지 않는다.
