# DIEM MCP service

This service is the restricted Oracle-hosted bridge between ChatGPT cloud tasks
and the DIEM GitHub repository. It is deliberately not a remote shell.

The committed core has a mock GitHub adapter, a GitHub App installation-token
adapter, and an official SDK Streamable HTTP transport. The process is
mock-only unless `DIEM_MCP_MODE=active` plus its GitHub App, hostname, and
Bearer credential settings are all present. The active endpoint is intentionally
fail-closed and still needs a proven ChatGPT-compatible credential flow before
it can satisfy the Step 4 capability gate in
`docs/implementation/chatgpt-oracle-cloud-editorial-plan.md`.

Allowed operations are candidate/context reads, a restricted canary PR write,
a package PR write, generated image ingest, asset attachment, and package
status. `write_image_canary_proof` writes only an ingested image and manifest
under `data/cloud-editorial/canary/`; it exists solely to prove an ImageGen byte
handoff before editorial image packages are enabled. Workflow changes, secret
access, Instagram access, arbitrary fetches, file deletion, and shell commands
are intentionally absent. Generated image handoff accepts inline image bytes
only; the service never follows a model-supplied image URL.
