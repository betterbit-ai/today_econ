# DIEM MCP service

This service is the restricted Oracle-hosted bridge between ChatGPT cloud tasks
and the DIEM GitHub repository. It is deliberately not a remote shell.

The committed core has a mock GitHub adapter, a GitHub App installation-token
adapter, and an official SDK Streamable HTTP transport. The process is
mock-only unless `DIEM_MCP_MODE=active` plus its GitHub App, hostname, and
Bearer credential settings are all present. The active endpoint uses ChatGPT
OAuth 2.1 with PKCE; authenticated ChatGPT read/write canaries have succeeded.

Allowed operations are candidate/context/visual-library reads, restricted
canary PR writes, package PR writes, and package status. Daily editorial
packages must match a current unexpired candidate pack, including its computed
content hash and the selected article's source, evidence hash, and core news
frame; only `assisted` review mode is accepted. Packages select one SHA-pinned
asset from the reviewed local visual library. Image-byte ingest and image-canary
tools are not exposed to ChatGPT. Workflow
changes, secret access, Instagram access, arbitrary fetches, file deletion,
and shell commands are intentionally absent.
