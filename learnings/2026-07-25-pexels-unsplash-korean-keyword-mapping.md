---
date: 2026-07-25
category: feature
source: manual
---

# Pexels/Unsplash API 한글 키워드 인덱싱 오염과 영문 시각 딕셔너리 최적화

## Situation

첫 실발행에서 "1400조 반도체"라는 경제 기사가 배포되었으나, 배경 이미지로 '반도체'와 무관한 일반 도시 풍경 및 운동장 사진이 렌더링되는 이슈가 발생했습니다.

## Action & Analysis

Pexels와 Unsplash API는 기본적으로 **영어(English) 인덱싱**에 최적화되어 있습니다. "반도체", "금리" 등의 특정 한글 경제 용어가 API 쿼리로 전송될 경우:
1. 매칭되는 정확한 이미지를 찾지 못하고 빈 결과(empty array)를 반환하거나,
2. 이미지 메타 태그에 한국 관련 단어(Korea, Seoul, 협력 등)가 무작위로 걸려든 전혀 상관없는 풍경 사진을 반환합니다.

이를 해결하기 위해 `image-selector.js` 내부에 `KOR_TO_ENG_VISUALS` 라는 정규식(Regex) 기반 매핑 딕셔너리를 신설했습니다. 주요 뉴스 핵심어(예: 반도체, AI, 증시, 환율 등)가 포착되면, 즉각 가장 시각적으로 관련성이 높은 최상급 영어 키워드(`semiconductor`, `stock market`, `data center` 등)로 치환하여 API 검색 쿼리 맨 앞에 주입합니다.

## Lesson Learned

글로벌 스톡 이미지 API 연동 시 한글을 그대로 패스스루(Pass-through)하면 검색 품질(Relevancy)이 급격히 저하됩니다. 도메인(경제/시사)에 특화된 한영 시각 맵핑 사전을 파이프라인 단에서 직접 제어하는 것이 AI의 이미지 연관성을 통제하는 가장 확실하고 안전한 방법입니다.
