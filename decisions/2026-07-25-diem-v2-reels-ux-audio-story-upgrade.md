---
date: 2026-07-25
scope: project
status: active
source: manual
---

# DIEM V2 릴스 UX, 오디오, 스토리 배포 자동화 개편

## Decision

* **커버 타이포그래피 및 레이아웃 강화**: GitHub Actions(`ubuntu-latest`) 환경에 한글 폰트가 내장되어 있지 않아 Playwright 렌더링 시 밋밋한 시스템 폰트가 사용되던 문제를 해결하기 위해, `cover.js` HTML `<head>`에 Pretendard CDN(`@import`)을 강제 주입했습니다. 
* **오디오(배경 음악) 일시 무음 처리**: 인스타그램 업로드 시 중복되고 단조로운 기본 음악이 삽입되는 것을 막기 위해, `publisher.js`에서 오디오 트랙 믹싱 옵션(`music`)을 강제로 `null`로 할당하여 'Silent AAC' 릴스를 생성하도록 정책을 변경했습니다.
* **인스타그램 스토리 동시 게시**: 생성된 릴스를 더욱 적극적으로 배포하기 위해, 릴스 게시(media_type: 'REELS')가 성공하면 즉각 동일한 비디오 URL을 사용하여 `media_type: 'STORIES'` 엔드포인트로 스토리에 추가 발행하도록 `publisher.js`를 수정했습니다.

## Rationale

첫 라이브 게시 결과, 가독성이 낮고 브랜딩이 약하며 배경 음악이 부자연스럽다는 피드백을 수용하여 사용자 경험을 대폭 상향시켰습니다. 스토리 동시 배포를 통해 추가적인 노력 없이 노출도를 극대화할 수 있습니다.
