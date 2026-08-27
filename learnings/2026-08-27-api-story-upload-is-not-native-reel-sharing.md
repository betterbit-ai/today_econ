---
date: 2026-08-27
category: platform
source: Meta Instagram API
---

# Story 영상 재업로드는 Reel을 Story에 공유한 것이 아니다

## Situation

DIEM은 Reel 영상 URL을 `media_type=STORIES`로 다시 발행했다. Story는 정상적으로
보였지만 독립 미디어여서 원본 Reel로 이동할 수 없었다.

## What we learned

Meta Content Publishing API의 Story 발행은 공개 이미지·영상으로 새 Story
컨테이너를 만드는 기능이다. Instagram 앱의 `Reel 공유 → 스토리에 추가`가 만드는
원본 미디어 연결과 링크 스티커는 공식 서버 발행 파라미터로 제공되지 않는다.

## Next time

플랫폼 API가 제공하지 않는 상호작용을 화면 모양만으로 모방하지 않는다. 원본
Reel 연결이 필요하면 Slack permalink로 네이티브 공유를 안내하고, API 계약이
확장될 때 기존 Story 발행 코드를 다시 평가한다.
