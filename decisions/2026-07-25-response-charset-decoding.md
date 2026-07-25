---
date: 2026-07-25
scope: project
status: active
source: production-incident
---

# HTTP 응답의 Content-Type charset에 따른 디코딩

## Decision

`popular-news.js`의 `fetchHtml`에서 HTTP 응답을 읽을 때
`response.text()` 대신 `Content-Type` 헤더의 `charset` 값을 감지하여
적절한 `TextDecoder`로 디코딩한다.

- `charset`이 없거나 `utf-8`이면 기존 `response.text()` 사용
- `euc-kr` 등 비UTF-8이면 `response.arrayBuffer()` +
  `new TextDecoder(charset)` 사용

## Context and constraints

네이버 뉴스 랭킹 페이지는 `charset=EUC-KR`을 반환한다. Node.js
Fetch API의 `response.text()`는 항상 UTF-8로 디코딩하므로 한글이
깨져 카테고리 분류가 전부 실패했다.

`iconv-lite` 같은 외부 라이브러리 대신 Node.js 내장 `TextDecoder`를
사용한다. `TextDecoder`는 WHATWG Encoding 표준의 모든 레거시
인코딩(EUC-KR, ISO-8859-1, Shift_JIS 등)을 지원한다.

## Alternatives considered

- `iconv-lite` 패키지 도입: 더 넓은 인코딩 지원이 가능하지만,
  현재 필요한 EUC-KR은 TextDecoder로 충분히 처리되며 불필요한
  의존성 추가를 피하기 위해 채택하지 않았다.
- HTML `<meta charset>` 파싱으로 인코딩 감지: HTTP 헤더보다
  우선순위가 낮고, cheerio 로드 전에 디코딩이 필요하므로
  Content-Type 헤더만 사용하기로 했다.

## Revisit when

- 네이버가 UTF-8으로 전환하면 detectCharset 로직은 유지하되
  불필요한 분기가 될 수 있다.
- Content-Type 헤더에 charset이 없고 HTML meta에만 있는 사이트를
  크롤링해야 할 때 2단계 감지가 필요해질 수 있다.
