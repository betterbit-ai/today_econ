# Oracle MCP hardening checklist

The default deployment is mock-only. The image contains a fail-closed real
Streamable HTTP transport, but do not enable the active compose overlay until
the ChatGPT, GitHub App, and capability gates have passed.

Before production deployment:

1. Allow TCP 443 in both the OCI NSG/security list and the host firewall.
2. Restrict SSH to the administrator CIDR; do not expose the container port.
3. Keep the existing Nginx reverse proxy with a valid public TLS certificate.
   The compose service must bind only to `127.0.0.1:3000`.
4. Store the GitHub App private key and MCP authentication material outside Git,
   in OCI Vault or root-owned files. For this non-root container the PEM uses
   `root:101` and mode `0640`, allowing only its `diem` gid to read a read-only
   mount; keep every other secret at `0600`.
5. Install the GitHub App only on `betterbit-ai/today_econ` with Metadata read,
   Contents read/write, and Pull requests read/write. Do not grant Actions,
   Workflows, Administration, Secrets, or Instagram access.
6. Keep the container non-root, read-only, capability-free, and restartable.
   The only writable mount is the dedicated `DIEM_MCP_STATE_DIR`; create it
   with ownership matching the image's `diem` user before enabling active mode.
7. Add uptime checks for `/healthz`, redact secrets from logs, and retain audit
   logs for no more than 14 days.
