# ChatGPT Cloud + Oracle MCP 구현 진행 기록

- 시작일: 2026-09-15 KST
- 구현 브랜치: `codex/chatgpt-oracle-editorial`
- 기준 커밋: `60ac8eb1ed7d4faadfbdf5fececf2f8ba9a48989`
- 원격 기준: `74e443859dbaa5111e1189561006d28f04d3f9f2`
- canonical plan: `docs/implementation/chatgpt-oracle-cloud-editorial-plan.md`

## 완료: 단계 0

- 기존 `main`의 ahead 커밋과 미커밋 성과·인수인계 문서를 보존한 채 구현 브랜치로 전환했다.
- production workflow 파일은 수정하지 않았다.

## 완료: 단계 1 첫 슬라이스

- `src/v2/cloud-candidate-pack.js`
  - 포털 후보를 최대 15개로 제한한다.
  - 기존 deterministic 분류, 근거 확보, duplicate, performance prior를 재사용한다.
  - 원문을 `untrustedData: true`로 기록한다.
  - publication ledger와 Instagram을 변경하지 않는다.
- `node src/v2/index.js cloud-candidates --date YYYY-MM-DD --slot RUN_ID`
  - `data/cloud-editorial/inbox/` 아래에 후보 팩을 원자적으로 저장한다.
- `test/v2-cloud-candidate-pack.test.js` 추가.

## 완료: 단계 2 첫 슬라이스

- `src/v2/daily-content.js`
  - Daily Package hash, source claim, title/caption/frame, expiry, image policy를 검증한다.
  - package를 기존 publication ledger 형태로 stage한다.
  - Groq를 호출하지 않고 저장된 editorial로 cover와 7초 Reel을 준비한다.
  - `review.mode=shadow`는 prepare를 차단한다.
- `content/diem-daily/` template과 운영 설명 추가.
- `node src/v2/index.js daily-package-validate --package PATH` 추가.
- `test/v2-daily-content.test.js` 추가.

## 완료: 단계 3·9 mock 기반

- `services/diem-mcp/src/core.js`
  - 후보 팩 조회, package PR mock, 생성 이미지 ingest, status 조회의 제한된 도구
    계약을 구현했다.
  - 경로 allowlist, request ID idempotency, SHA, private URL 차단, MIME magic-byte
    검사를 테스트로 고정했다.
  - GitHub App/OAuth/Streamable HTTP transport는 아직 mock 밖의 단계 4 대상이다.
- `services/diem-mcp/src/github-app.js`
  - 외부 SDK 없이 GitHub App JWT, installation token, Git Data API branch/tree/
    commit/ref, PR 생성을 구현하고 mock fetch로 검증했다.
- `services/diem-mcp/src/request-store.js`
  - request ID 결과를 파일에 원자적으로 저장해 프로세스 재시작 뒤에도 같은
    package write가 새 commit을 만들지 않도록 했다.
- `deploy/oracle/`
  - non-root, read-only, capability-drop mock compose·Caddy·hardening·runbook을
    추가했다. mock `/mcp`는 의도적으로 503을 반환한다.
- `.codex/skills/diem-cloud-editorial/SKILL.md`
  - 웹 예약 작업이 따라야 할 후보·근거·이미지·제출 경계를 기록했다.
- `src/v2/cloud-editorial-state.js`
  - candidate pack 뒤 45분 package/no_publish 응답이 없을 때 한 번만 경고할
    상태 계약을 구현했다. 아직 Slack/workflow에 연결하지 않았다.

## 완료: Oracle mock 기동

- Oracle Linux 8 ARM VM에서 Docker 26.1.3과 Compose 2.27.0을 확인했다.
- 기존 Nginx가 80·443과 `talkwithme.r-e.kr`을 사용하므로 이를 변경하지 않았다.
- mock은 별도 Compose 프로젝트 `diem-mcp-mock`으로 `/home/opc/diem-mcp-mock-20260916`에
  배포했다.
- 포트는 `127.0.0.1:3000`에만 bind되어 외부에 공개되지 않는다.
- `/healthz`는 HTTP 200, 실제 transport 전 `/mcp`는 의도한 HTTP 503이다.
- detached startup 직후 health request는 listener 준비와 경합할 수 있어 healthcheck와
  bounded retry를 추가했다.

## 완료: MCP 공개 TLS 경계

- `mcp.talkwithme.r-e.kr` A 레코드가 Oracle 공인 IP로 해석되는 것을 확인했다.
- 기존 Nginx가 이미 80·443을 소유하므로 별도 Caddy를 사용하지 않고 mcp 전용
  Nginx server block을 추가했다.
- Let’s Encrypt 인증서가 발급됐고 2026-12-14까지 유효하다.
- 외부 검증 결과:
  - `https://mcp.talkwithme.r-e.kr/mcp` → HTTP 503, TLS 검증 성공
  - `https://mcp.talkwithme.r-e.kr/healthz` → HTTP 404
- 503은 실제 MCP transport가 아직 mock이라는 의도된 상태다. OAuth·Streamable
  HTTP·GitHub App capability gate 전에는 ChatGPT에 연결하지 않는다.

## 완료: 실제 MCP transport 코드 (아직 비활성)

- `@modelcontextprotocol/sdk` 1.30.0을 서비스 전용 의존성으로 추가했다.
- `services/diem-mcp/src/server.js`는 official stateless Streamable HTTP
  transport로 6개 제한 도구만 등록한다. `DIEM_MCP_MODE=active`와 hostname,
  Bearer credential, GitHub App 설정이 모두 없으면 시작하지 않으며, 기본은 mock
  503이다.
- `/mcp`에는 host allowlist와 constant-time Bearer 검증을 적용했고, health는
  localhost 전용 proxy 경계를 그대로 유지한다.
- 컨테이너용 경량 submission contract를 분리했다. GitHub Actions의 기존
  `daily-package-validate`가 저장소에서 더 엄격하게 재검증하므로, MCP가 단독으로
  발행할 수는 없다.
- `deploy/oracle/compose.active.yml`은 별도 canary overlay다. 기본 compose 명령은
  계속 mock으로 실행된다.
- 생성 이미지는 remote URL fetch를 허용하지 않고, 같은 ChatGPT 실행이 MCP에
  inline Base64 bytes로 넘긴 경우에만 받는다. ChatGPT UI가 이를 지원하지 않으면
  그 기능은 우회하지 않고 세 번째 capability gate를 실패 처리한다.
- 로컬 SDK client가 인증된 Streamable HTTP 초기화 → tool list → candidate pack
  read까지 통합 테스트로 통과했다. 아직 Oracle에서 active mode나 ChatGPT를
  연결하지 않았으므로 capability gate는 통과하지 않았다.
- 2026-09-16 Oracle에 해당 이미지까지 배포했다. 현재 container health는
  `healthy`, localhost와 공개 TLS endpoint의 `/mcp`는 모두 의도한 `503`이다.
  `compose.yml`에 프로젝트 이름을 고정해 다음 업데이트 때 Compose 이름 차이로
  3000 포트가 중복되는 문제도 방지했다.

## Mock 검증 증거

- `node --test test/diem-mcp.test.js test/v2-cloud-candidate-pack.test.js test/v2-daily-content.test.js test/v2-cloud-editorial-state.test.js` 통과.
- mock MCP는 localhost `/healthz`에서 HTTP 200을 반환하고, 아직 설치되지 않은
  Streamable HTTP transport의 `/mcp`에서는 의도적으로 HTTP 503을 반환한다.
- `docker compose -f deploy/oracle/compose.yml config`가 통과한다.

## 다음 차단점: 실제 단계 4 capability gate

실제 Oracle MCP 활성화와 ChatGPT gate 증명을 하려면 다음이 필요하다.

1. GitHub App 생성·단일 repo 설치 및 Oracle secret-file 배치 권한.
2. ChatGPT 웹의 개인 App 연결에서 쓸 approved credential/OAuth flow 설정.
3. ChatGPT 예약 task로 canary write를 실행할 수 있는지 확인.
4. ChatGPT ImageGen 결과를 같은 실행에서 MCP input으로 전달할 수 있는지 확인.

### 준비 완료: GitHub App gate artifact

- `deploy/oracle/github-app-manifest.json`에 App의 최소 권한을 고정했다.
- `deploy/oracle/github-app-setup.md`에 App 생성·한 저장소 설치·Oracle root-owned
  PEM 배치와 active-mode 환경값을 단계별로 기록했다.
- App 생성과 PEM 다운로드는 영구 credential 생성이므로 이 문서 준비만으로는
  gate가 통과한 것이 아니다.

### 준비 완료: no-auth connectivity connector canary

- `canary_readonly` MCP mode는 데이터도 읽지 않는다. 도구 목록은 고정 상태값을
  반환하는 `get_mcp_canary_status` 하나뿐이며 repository, package, image, PR,
  publish, shell 도구가 없다.
- 이 mode는 GitHub App 생성 전에도 ChatGPT custom MCP 등록 및 연결 gate를
  검증하기 위한 임시 경계다. read/write 권한·production으로 확장할 수 없다.

## 완료: GitHub Action 후보 팩 canary

- Draft branch에서 workflow run `34996267365`를 `operation=cloud_candidates`로
  수동 실행했다. `build-cloud-candidate-pack`만 성공했고, economy publish,
  basic publish, retry, moderation, insights job은 모두 `skipped`였다.
- 후보 팩은 branch commit `27748e5`의
  `data/cloud-editorial/inbox/2026/09/2026-09-16-34996267365.json`에만 저장됐다.
  이 작업은 Instagram 또는 Groq를 호출하지 않았다.

## 완료: Oracle connectivity canary 서버 측 검증

- Oracle에서 `compose.canary-readonly.yml`로 connectivity canary를 기동했고
  container health는 `healthy`다.
- 공개 `https://mcp.talkwithme.r-e.kr/mcp`의 standard MCP initialize,
  `tools/list`, `tools/call(get_mcp_canary_status)`를 TLS로 확인했다.
- 외부 tool list에는 `get_mcp_canary_status` 하나만 있으며 응답은
  `repositoryAccess/writeAccess/imageAccess/publishAccess = none`이다.
- 아직 **ChatGPT 계정 UI에서 이 endpoint를 custom app으로 등록해 호출한 증거는
  없다.** 이 작업이 단계 4-1의 남은 한 단계다.

## 완료: ChatGPT custom MCP read gate와 GitHub App identity

- ChatGPT personal Developer Mode를 활성화하고 no-auth `DIEM MCP Connectivity
  Canary`를 등록했다. ChatGPT chat에서 실제 `get_mcp_canary_status` 호출이
  성공했고 모든 접근 필드가 `none`으로 반환됐다.
- GitHub App `bb-diem-oracle-mcp` (App ID `4960810`)을 생성하고
  `betterbit-ai/today_econ` 한 저장소에만 설치했다 (Installation ID
  `162089846`). 권한은 metadata read, Contents read/write, Pull requests
  read/write뿐이다.
- PEM은 Oracle `/etc/diem-mcp/github-app.pem`에 설치됐고, non-root Docker
  process가 read-only mount를 읽을 수 있도록 host ownership을 `root:101`, mode
  `0640`으로 조정한다. state dir는 uid 100/gid 101 전용이다.

## 완료: ChatGPT OAuth + Oracle active transport

- ChatGPT의 authenticated MCP는 static API key가 아니라 OAuth 2.1
  authorization-code + PKCE를 요구한다는 공식 문서를 확인했다. static API-key
  personal app은 tool invocation에 사용하지 않고 OAuth app으로 교체했다.
- Oracle은 RFC 9728 protected-resource metadata, OAuth authorization-server
  metadata, PKCE `S256` authorization-code, refresh-token rotation을 제공한다.
  `authorization_response_iss_parameter_supported=true`를 광고해 ChatGPT의
  stable callback URL과 issuer identification을 맞췄다.
- ChatGPT `openai-connectors-oauth/1.0` token exchange가 `200`으로 완료됐고,
  Oracle에는 access token과 refresh token이 각각 하나씩 (값은 노출하지 않음)
  저장됐다. 이어진 authenticated MCP initialize/tool-list requests도 200으로
  확인됐다.
- Oracle active container는 `healthy`이며 anonymous `/mcp`는 401과
  `resource_metadata` challenge로 fail-closed한다. OAuth password는 static
  fallback key와 별도 random secret으로 회전했고, local temporary secret files는
  삭제했다.
- 아직 ChatGPT usage limit 때문에 authenticated candidate read의 UI 응답과
  cloud scheduled write canary를 다시 실행하지 못했다. 이 두 항목은 external
  capability gate의 남은 증거다. 기존 Instagram schedule은 여전히 변경하지
  않았다.

이 정보·권한이 오기 전에는 기존 scheduled publish를 절대 수정하지 않는다.
