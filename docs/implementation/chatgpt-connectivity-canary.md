# ChatGPT connectivity canary: operator step

Oracle is now ready at `https://mcp.talkwithme.r-e.kr/mcp`. Until this gate is
recorded, it is a no-auth, no-data service with exactly one tool:
`get_mcp_canary_status`. It cannot read a repository, create a PR, generate or
upload an image, publish content, run a command, or access a secret.

## What the ChatGPT account holder does

1. In ChatGPT web, open **Settings → Apps** or the custom-app / Developer Mode
   creation flow available to the account.
2. Add a no-auth custom MCP app using this exact endpoint:
   `https://mcp.talkwithme.r-e.kr/mcp`
3. Start a normal web ChatGPT conversation with that app selected, then request:
   `Call get_mcp_canary_status and show the complete JSON result.`
4. Confirm that the tool list contains only `get_mcp_canary_status` and that the
   result says every access field is `none`.
5. Attach a screenshot or paste the result into this task. Do not paste a
   password, API key, bearer token, GitHub PEM, or any other credential.

## Expected result

```json
{
  "status": "ready",
  "mode": "connectivity-canary",
  "repositoryAccess": "none",
  "writeAccess": "none",
  "imageAccess": "none",
  "publishAccess": "none"
}
```

## After success

Return Oracle to default mock mode, retain the screenshot/result as the Step
4-1 evidence, then create the repository-scoped GitHub App using
`deploy/oracle/github-app-setup.md`. The authenticated write canary is a
separate gate; never reuse this no-auth app for writing.
