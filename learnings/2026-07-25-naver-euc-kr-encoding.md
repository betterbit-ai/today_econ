---
date: 2026-07-25
category: bug
source: production-incident
---

# 네이버 뉴스 랭킹 페이지 EUC-KR 인코딩 이슈

## Situation

DIEM V2 파이프라인의 첫 GitHub Actions 프로덕션 실행에서 50개 뉴스
후보 전부가 `category_not_allowed`로 탈락했다. 네이버 랭킹 페이지
(`https://news.naver.com/main/ranking/popularDay.naver`)는
`Content-Type: text/html;charset=EUC-KR`과
`<meta charset="euc-kr">`을 반환한다.

Node.js Fetch API의 `response.text()`는 무조건 UTF-8로 디코딩하므로,
한글 제목이 `���ֺ���` 형태로 깨진다. 깨진 제목은 `topic.js`의
`ECONOMY_INCLUDE`/`ISSUE_INCLUDE` 정규식에 매칭되지 않아 모든 기사가
분류 불가로 탈락했다.

다음(Daum) 랭킹 페이지는 UTF-8이므로 해당 없다.

## What we learned

- Node.js `fetch`의 `response.text()`는 항상 UTF-8 디코딩이다.
  `Content-Type` 헤더의 charset을 따르지 않는다.
- 한국 포털 사이트(네이버)는 레거시 `EUC-KR` 인코딩을 사용하는
  페이지가 여전히 존재한다.
- `response.arrayBuffer()` + `TextDecoder(charset)`로 올바르게
  디코딩할 수 있다. `TextDecoder`는 Node.js 내장이므로 외부
  의존성이 필요 없다.

## Next time

- 외부 웹페이지를 크롤링할 때 `response.text()`를 사용하기 전에
  `Content-Type` 헤더의 charset을 반드시 확인할 것.
- 특히 한국 레거시 사이트는 EUC-KR 가능성을 항상 고려할 것.
- 파이프라인 첫 실행 시 크롤링된 데이터의 한글 출력을 로그에서
  직접 확인하는 연기(smoke) 테스트를 포함할 것.
