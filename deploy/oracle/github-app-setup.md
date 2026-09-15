# GitHub App setup: DIEM Oracle MCP

This is a one-repository, pull-request-only machine identity. It must not be
replaced with a personal access token or a GitHub Action token stored on Oracle.

## Before creating the App

1. Replace `REPLACE_WITH_UNIQUE_DIEM_EDITORIAL_MCP_NAME` in
   `github-app-manifest.json` with a globally unique name. Do not commit the
   chosen name if it identifies a private environment.
2. Sign in to the GitHub owner account for `betterbit-ai/today_econ`.
3. Confirm that creating a GitHub App and downloading its PEM key is intended.
   The PEM is a long-lived credential and must never enter Git, ChatGPT task
   text, shell history, or a Slack message.

## Create and install

1. Open GitHub **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Import the manifest values manually. Disable webhooks. The App needs only
   **Contents: Read and write** and **Pull requests: Read and write**.
3. Create the App, generate one private key, and download the PEM once.
4. Install it on **Only select repositories**, then select exactly
   `betterbit-ai/today_econ`. Do not grant organization-wide access.
5. Record the App ID and Installation ID. The installation ID appears in the
   installation URL; do not record either value in task prompts.

## Place secrets on Oracle

Run only on Oracle, replacing the placeholder source path with the downloaded
PEM's temporary location. The directory is root-owned; the container sees the
PEM read-only.

```bash
sudo install -d -m 0700 -o root -g root /etc/diem-mcp
sudo install -m 0600 -o root -g root /PATH/TO/DOWNLOADED.pem /etc/diem-mcp/github-app.pem
sudo install -d -m 0700 -o 100 -g 101 /var/lib/diem-mcp
```

Create `/home/opc/diem-mcp-mock-20260916/.env` with mode `0600`. It is never
committed:

```dotenv
MCP_PUBLIC_HOSTNAME=mcp.talkwithme.r-e.kr
MCP_BEARER_TOKEN=GENERATE_A_32_BYTE_OR_LONGER_RANDOM_VALUE
GITHUB_REPOSITORY_OWNER=betterbit-ai
GITHUB_REPOSITORY_NAME=today_econ
GITHUB_DEFAULT_BRANCH=main
GITHUB_APP_ID=APP_ID_FROM_GITHUB
GITHUB_APP_INSTALLATION_ID=INSTALLATION_ID_FROM_GITHUB
GITHUB_APP_PRIVATE_KEY_HOST_PATH=/etc/diem-mcp/github-app.pem
DIEM_MCP_STATE_DIR=/var/lib/diem-mcp
```

Generate the bearer value locally on Oracle without printing it to a terminal
record that will be shared:

```bash
openssl rand -base64 48
```

## Canary boundary

Do not merge the draft PR or enable `compose.active.yml` as part of this setup.
First use the exact token only to prove an authenticated `get_pending_candidate_pack`
read against a disposable canary. A GitHub write is permitted only after that
read is recorded in the capability-gate log. Existing Instagram schedules remain
unchanged throughout this procedure.
