# DIEM Oracle MCP runbook

## Mock verification

From the repository root:

```bash
docker compose -f deploy/oracle/compose.yml config
docker compose -f deploy/oracle/compose.yml up --build -d
for attempt in 1 2 3 4 5; do
  curl --fail --silent http://127.0.0.1:3000/healthz && break
  sleep 2
done
docker compose -f deploy/oracle/compose.yml down
```

The default mock `/mcp` endpoint intentionally returns `503`. That proves the
health and network boundary only; it is not a ChatGPT connector.

The first request immediately after `up -d` can race the Node listener. Always
wait for `/healthz` rather than treating a single early connection reset as a
container failure.

## Existing-Nginx subdomain setup

When `mcp.<domain>` points to the Oracle public IP and Nginx already owns
80/443, copy `nginx-mcp-http.conf` to `/etc/nginx/conf.d/diem-mcp.conf`, test
and reload Nginx, then issue a certificate with the webroot challenge. Replace
the file with `nginx-mcp-https.conf` only after the certificate exists, and test
Nginx again before reloading. The public proxy exposes only `/mcp`; `/healthz`
remains localhost-only.

The active production hostname is `mcp.talkwithme.r-e.kr`. Its Nginx config is
intentionally separate from the existing `talkwithme.r-e.kr` server block.

## Active transport canary (after, never before, the gates)

The image includes the official MCP SDK's stateless Streamable HTTP transport,
but its default process stays in `mock` mode. It starts real transport only
with the explicit `compose.active.yml` overlay and all of the following:

- a repository-scoped GitHub App configuration;
- a root-owned GitHub App PEM file mounted read-only;
- a high-entropy `MCP_BEARER_TOKEN` kept outside Git;
- a host state directory owned by the container's `diem` user for idempotency
  results and short-lived image assets.

Create an untracked `.env` next to the deployed compose files from
`env.example`, then set `GITHUB_APP_PRIVATE_KEY_HOST_PATH` and
`DIEM_MCP_STATE_DIR` to absolute Oracle paths. Do not put either secret in the
repository. On the current Oracle image, prepare the state directory with
`sudo install -d -m 0700 -o 100 -g 101 "$DIEM_MCP_STATE_DIR"` (the container's
non-root `diem` UID/GID). Use this command only for a canary after the checklist
below:

```bash
docker compose -f compose.yml -f compose.active.yml config
docker compose -f compose.yml -f compose.active.yml up --build -d
curl --fail --silent http://127.0.0.1:3000/healthz
```

The real endpoint accepts only `POST /mcp` with the expected host header and
`Authorization: Bearer …`; it has no shell, publish, workflow, or secret tool.
The current persistent credential is a transport preflight, not evidence that
ChatGPT scheduled tasks can authenticate. Do not call the capability gate
passed until ChatGPT itself has completed an authenticated tool call.

## Read-only ChatGPT connector canary

Before creating a GitHub App, `compose.canary-readonly.yml` can prove that a
ChatGPT custom MCP app reaches Oracle. It exposes exactly one fixed
`get_mcp_canary_status` result and has no repository connection, credential,
image, package, PR, shell, or publish tool:

```bash
docker compose -f compose.yml -f compose.canary-readonly.yml config
docker compose -f compose.yml -f compose.canary-readonly.yml up --build -d
curl --fail --silent http://127.0.0.1:3000/healthz
```

Connect `https://mcp.talkwithme.r-e.kr/mcp` in ChatGPT as a no-auth custom app,
call `get_mcp_canary_status`, record the one-tool list and result, then return
the service to default mock mode. This no-auth exposure contains no data and
must never be used for the write path.

For the exact GitHub App creation and Oracle secret placement sequence, use
`github-app-setup.md`. The manifest is deliberately minimal: Contents and Pull
requests write access on `betterbit-ai/today_econ` only, no webhook and no
organization-wide installation.

## Production gate

Do not replace the mock service until all conditions below are evidenced:

- Streamable HTTP MCP transport is implemented with the official SDK and is
  protected by an approved ChatGPT-compatible credential flow.
- GitHub App is restricted to the one DIEM repository.
- A web scheduled-task canary writes only the permitted canary path.
- ImageGen handoff is either proven or explicitly disabled.
- Existing production publishing schedules remain unchanged until those gates
  have passed.
