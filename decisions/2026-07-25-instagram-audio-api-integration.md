---
date: 2026-07-25
scope: project
status: active
source: manual
---

# 인스타그램 Audio API 연동 (기존 라이브러리 음원 첨부)

## Decision

* **인스타그램 Audio API (`ig_audio`) 통합**: DIEM V2의 배포 스크립트(`src/instagram.js`, `src/v2/publisher.js`)에 Instagram Graph API의 오디오 검색 및 첨부 기능을 내장했습니다.
* **로컬 오디오(FFmpeg) 대신 소셜 오디오(Instagram Music) 채택**: 로컬에서 생성한 AI 음악을 릴스 영상에 병합(burn)하는 대신, 원본 릴스는 무음(Silent)으로 업로드하되 인스타그램 플랫폼의 자체 라이브러리 음악을 `audioConfiguration` 파라미터를 통해 첨부합니다.

## Rationale

기존의 로컬 오디오 렌더링 방식은 단조롭고 부자연스럽다는 피드백이 있었습니다. 레퍼런스(예: onebitemoneyclub)처럼 실제 트렌딩 음원(Tony Dark Eyes - Fire 등)을 API 단에서 직접 첨부함으로써,
1. 음원 저작권 문제 없이 가장 유명하고 적절한 상용 음악을 사용할 수 있습니다.
2. 해당 음원을 클릭하여 유입되는 트래픽(오디오 페이지 노출)을 기대할 수 있어 바이럴 및 도달률(Reach) 확장에 유리합니다.
3. 영상 렌더링 속도와 파일 크기를 줄일 수 있습니다.
