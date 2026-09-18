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

Allowed operations are candidate/context/visual-library reads, restricted
canary PR writes, package PR writes, generated-image canaries, and package
status. Daily editorial packages select one SHA-pinned asset from the reviewed
local visual library; they never upload or fetch an image URL. Workflow
changes, secret access, Instagram access, arbitrary fetches, file deletion,
and shell commands are intentionally absent.
