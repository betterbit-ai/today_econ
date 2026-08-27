---
date: 2026-08-27
scope: project
status: active
source: user
related:
  - 2026-07-30-public-interest-visual-role-and-story-state.md
---

# 자동 원본 Story 대신 Instagram의 Reel 공유를 수동 안내한다

## Decision

운영 GitHub Actions에서는 자동 Story 컨테이너 발행을 끈다. Reel 성공 후 Slack에
원본 Reel permalink를 보내고, 운영자가 Instagram 앱에서 `공유 → 스토리에 추가`를
실행한다. 기존 Story API 구현은 보존해 Meta가 연결형 발행을 지원하거나 운영자가
독립 Story로 되돌릴 때 재활성화할 수 있게 한다.

## Context

현재 API 경로는 Reel의 MP4를 새 `STORIES` 컨테이너로 업로드한다. 따라서 화면은
같아도 기존 Reel과 연결된 공유 Story가 아니며 탭해도 Reel로 이동하지 않는다.
Meta 공식 Content Publishing 요청에는 Story 링크 스티커나 기존 Reel 첨부
파라미터가 없어 서버 자동화만으로 동일한 동작을 만들 수 없다.

## Rejected

- Story 요청에 비공식 `link` 파라미터 추가: 공식 계약이 아니며 실패·무시될 수 있다.
- 화면에 Reel URL만 인쇄: Story 텍스트는 클릭 가능한 링크가 아니다.
- Instagram UI를 GitHub Actions에서 자동 조작: 로그인·2FA·UI 변경에 취약하고 계정 위험이 크다.

## Directive

수동 안내 링크는 반드시 발행 성공한 Reel permalink를 사용한다. 자동 Story 코드를
삭제하지 말고 환경 변수로만 비활성화하며, 반복 안내로 GitHub Issue를 만들지 않는다.
