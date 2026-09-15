---
date: 2026-09-16
scope: tech
status: active
source: production-server inspection
---

# MCP는 기존 Nginx의 전용 서브도메인으로 공개한다

## Decision

DIEM MCP의 공개 주소는 `https://mcp.talkwithme.r-e.kr/mcp`로 고정한다.
Oracle VM에서 이미 80·443을 소유한 Nginx에 mcp 전용 server block을 추가하고,
`/mcp`만 localhost `127.0.0.1:3000`으로 프록시한다. 공개 `/healthz`와 기타
경로는 404로 닫는다.

## Context and constraints

- Oracle Linux 8 VM의 기존 Nginx가 `talkwithme.r-e.kr`과 80·443을 이미
  운영 중이다.
- 별도 Caddy가 80·443에 bind하면 기존 서비스와 포트·인증서 충돌이 난다.
- `mcp.talkwithme.r-e.kr` A 레코드는 Oracle 공인 IP로 해석되고, Let’s Encrypt
  webroot challenge로 2026-12-14까지 유효한 별도 인증서를 발급했다.
- mock MCP는 localhost에서만 기동하므로 외부 접근은 Nginx의 정확한 `/mcp`
  location을 통해서만 가능하다.

## Alternatives considered

- 기존 `talkwithme.r-e.kr/mcp` 경로 공유: 기존 앱 라우팅·향후 보안 정책과
  섞일 수 있어 기각.
- Caddy를 병행해 80·443 직접 bind: 현재 Nginx와 충돌하므로 기각.
- Oracle IP 주소를 ChatGPT에 직접 연결: HTTPS 인증서와 안정적 hostname이 없어
  기각.

## Revisit when

- 서버를 별도 VM이나 load balancer로 옮기거나, talkwithme 도메인 운영을
  중단할 때.
- 실제 Streamable HTTP MCP와 OAuth를 활성화할 때 Nginx의 request size,
  timeout, rate limit을 실제 트래픽 기준으로 다시 검토한다.
