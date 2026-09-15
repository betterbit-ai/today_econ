---
date: 2026-09-16
scope: tech
status: active
source: user-requested architecture
---

# Oracle MCP는 제한된 편집 패키지 브리지로만 운영한다

## Decision

Oracle Cloud의 DIEM MCP는 ChatGPT 클라우드 예약 작업과 GitHub 저장형 Daily
Package 사이의 제한된 브리지로 둔다. 범용 셸, 임의 파일 조작, workflow 수정,
secret 조회, Instagram API 호출을 제공하지 않는다.

초기 서비스 코어는 다음 도구 계약만 가진다: 후보 팩 조회, 최근 편집 맥락 조회,
편집 패키지 제출, 생성 이미지 입력, 이미지 연결, 패키지 상태 조회. 모든 write는
request ID idempotency, 서버 측 경로 allowlist, package validator, GitHub PR을
거친다.

## Context and constraints

- Mac이 꺼져도 동작해야 하므로 로컬 Docker와 터널은 요구사항에 맞지 않는다.
- ChatGPT 예약 작업은 편집 판단을 맡지만 Instagram token과 production publish
  권한을 가져서는 안 된다.
- 현재 생산 pipeline은 GitHub 원장과 GitHub Actions에 발행 상태·재시도·성과를
  보존한다.
- 원격 MCP가 침해되거나 기사 본문에 prompt injection이 섞여도 workflow, source,
  secrets, host shell까지 영향을 넓히면 안 된다.
- ImageGen 결과의 실제 파일 전달 능력은 아직 해당 ChatGPT 계정에서 증명되지
  않았으므로, transport/OAuth/배포 이전에는 mock core와 test-only assets로만
  계약을 검증한다.

## Alternatives considered

- Mac의 Docker MCP와 Cloudflare Tunnel: Mac 절전·전원 상태에 의존하므로 기각.
- Oracle에 범용 shell MCP 노출: 유출·prompt injection 시 피해 범위가 너무 커서 기각.
- ChatGPT가 GitHub와 Instagram을 직접 모두 제어: secret 분리와 final validation
  경계가 사라지므로 기각.
- GitHub Actions에서 ChatGPT Pro 모델을 API처럼 호출: 구독을 API credential로
  사용할 수 없고 별도 비용 경로가 되므로 기각.
- Groq 자동 fallback: 현재 품질 하락 문제를 장애 시 다시 유입시키므로 기각.

## Revisit when

- 웹 ChatGPT 예약 작업의 실제 MCP 권한·OAuth 흐름과 ImageGen handoff PoC가
  모두 통과할 때 실제 transport를 배포한다.
- 도구 추가가 필요하면 먼저 해당 권한이 package workflow에 꼭 필요한지,
  path allowlist와 GitHub App permission으로 피해 범위를 제한할 수 있는지
  검토하고 이 결정을 갱신한다.
