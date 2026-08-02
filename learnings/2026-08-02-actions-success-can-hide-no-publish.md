---
date: 2026-08-02
category: pattern
source: harness-maintain
---

# Actions 성공과 콘텐츠 발행 성공을 분리해 관측한다

## Situation

DIEM Economy와 Issue Actions는 연속으로 `success`였지만 Instagram에는
27시간 넘게 새 Reel이 없었다. 실행 로그와 원장을 대조하니 API·인증
실패가 아니라 모든 후보가 분야 또는 신선도 기준에서 탈락한
`no_publish`였다. 기존 운영 알림은 정상 핫뉴스 폴링의 `no_publish`를
모두 숨겨 운영자가 이 차이를 알 수 없었다.

## What we learned

GitHub Actions의 결론은 프로세스가 오류 없이 끝났다는 뜻일 뿐, DIEM의
도메인 결과가 `published`라는 뜻이 아니다. 운영 건전성은 워크플로 결론이
아니라 일일 원장의 마지막 성공 Reel 시각, 현재 발행 상태와 후보 탈락
사유를 함께 계산해야 한다. 연속 실행의 현재 상태가 모두 `no_publish`면
상태 문자열 비교만으로는 새 관측을 감지할 수 없으므로
`publication_key`도 상태 전이 식별에 포함해야 한다.

## Next time

- 무발행 조사에서는 Actions 결론, 최신 실행 로그, 원장의 Reel
  `updatedAt`과 후보 탈락 사유를 함께 확인한다.
- 스케줄 워크플로의 성공률과 별도로 rolling 24-hour publication health를
  테스트하고 관측한다.
- 반복 상태 알림은 새 `publication_key`를 인식하되, 운영자 피로를 막기
  위해 별도의 cooldown을 둔다.
