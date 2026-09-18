---
date: 2026-09-16
category: pattern
source: harness-implement
---

# Oracle MCP health must be retried after detached container startup

## Situation

The DIEM MCP mock container started successfully on Oracle Cloud and Docker
reported it as running, but the first localhost health request made immediately
after `docker compose up -d` received a connection reset. A subsequent state and
log check showed the Node listener was still completing startup; the next health
request returned HTTP 200 and `/mcp` returned its intended mock HTTP 503.

## What we learned

Detached Docker startup completion does not prove that the application listener
is ready. A one-shot health request immediately after `up -d` can produce a
false deployment failure even for a healthy process. The deployment contract
needs an application healthcheck and bounded retry before interpreting failure.

## Next time

Use the Compose healthcheck and retry `/healthz` for a bounded interval before
checking logs or rolling back. Keep the mock endpoint on localhost until the
Streamable HTTP, OAuth, DNS, and ChatGPT capability gates are complete.

## Follow-up: pin the Compose project name

An update run from the deployment directory inferred `oracle` as its Compose
project name while the existing mock used `diem-mcp-mock`. Docker therefore
refused the new container because both projects requested `127.0.0.1:3000`.
The existing container stayed running, and the unused created container was
removed before restarting the known project. `deploy/oracle/compose.yml` now
sets `name: diem-mcp-mock`; always run deployment commands against that named
project so a bad working directory cannot create a second localhost bind.

## Follow-up: active updates must retain the overlay

An image-canary deployment rebuilt the service with only `compose.yml`. That
base file deliberately defaults to `DIEM_MCP_MODE=mock`, so the container stayed
healthy while `/oauth/token` disappeared. A ChatGPT cloud task then failed its
refresh-token request with HTTP 404; container health alone did not detect the
regression.

For any update to an already-active Oracle MCP, always run both
`compose.yml` and `compose.active.yml`. Verify `DIEM_MCP_MODE=active`, OAuth
metadata HTTP 200, invalid token grant HTTP 400, and anonymous `/mcp` HTTP 401
before scheduling a capability run.
