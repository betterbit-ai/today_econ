const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const z = require('zod/v4');

const { DiemMcpCore } = require('./core');
const { GitHubAppClient, PublicGitHubReadClient } = require('./github-app');
const { MCP_INSTRUCTIONS } = require('./instructions');

const JSON_OBJECT = z.record(z.string(), z.unknown());
const REQUEST_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/u);

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function registerCoreTool(server, name, description, inputSchema, core) {
  server.registerTool(name, { description, inputSchema }, async input => toolResult(await core.call(name, input)));
}

function createDiemMcpServer(core) {
  const server = new McpServer(
    { name: 'diem-cloud-editorial', version: '0.1.0' },
    { capabilities: { logging: {} }, instructions: MCP_INSTRUCTIONS },
  );
  registerCoreTool(server, 'get_pending_candidate_pack', 'Read the latest unexpired, untrusted candidate pack. Read this before writing.', {
    category: z.enum(['any', 'economy', 'issue']).optional(),
    now: z.string().datetime({ offset: true }).optional(),
  }, core);
  registerCoreTool(server, 'get_editorial_context', 'Read recent DIEM editorial performance context. It cannot publish or change repository settings.', {
    days: z.number().int().min(1).max(14).optional(),
  }, core);
  registerCoreTool(server, 'ingest_generated_image', 'Store one generated editorial image supplied inline by the same task. Only PNG, JPEG, or WebP data is accepted; remote URLs are never fetched.', {
    requestId: REQUEST_ID,
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    dataBase64: z.string().max(12_000_000).optional(),
  }, core);
  registerCoreTool(server, 'submit_editorial_package', 'Validate and open one repository pull request for a DIEM editorial package. This never publishes to Instagram.', {
    requestId: REQUEST_ID,
    candidatePackSha256: SHA256,
    package: JSON_OBJECT,
    assetId: z.string().max(96).optional(),
  }, core);
  registerCoreTool(server, 'attach_image_to_package', 'Submit a package with its previously ingested generated image. This never publishes to Instagram.', {
    requestId: REQUEST_ID,
    candidatePackSha256: SHA256,
    package: JSON_OBJECT,
    assetId: z.string().min(1).max(96),
  }, core);
  registerCoreTool(server, 'get_package_status', 'Read package status from the repository. It cannot modify a package.', {
    packageId: REQUEST_ID,
  }, core);
  return server;
}

function createReadOnlyCanaryServer(core) {
  const server = new McpServer(
    { name: 'diem-cloud-editorial-readonly-canary', version: '0.1.0' },
    { capabilities: { logging: {} }, instructions: 'Read-only DIEM Oracle MCP canary. It exposes untrusted candidate data only. No write, image, publish, shell, or secret tool exists.' },
  );
  registerCoreTool(server, 'get_pending_candidate_pack', 'Read the latest unexpired, untrusted candidate pack from the fixed canary branch. No write is possible.', {
    category: z.enum(['any', 'economy', 'issue']).optional(),
    now: z.string().datetime({ offset: true }).optional(),
  }, core);
  registerCoreTool(server, 'get_editorial_context', 'Read public DIEM editorial performance context from the fixed canary branch. No write is possible.', {
    days: z.number().int().min(1).max(14).optional(),
  }, core);
  return server;
}

function readSecretFile(filePath, label) {
  if (!filePath) throw new Error(`[DIEM MCP] ${label} file path is required.`);
  const resolved = path.resolve(filePath);
  const value = fs.readFileSync(resolved, 'utf8').trim();
  if (!value) throw new Error(`[DIEM MCP] ${label} file is empty.`);
  return value;
}

function equalSecret(expected, actual) {
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(actual));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createActiveCore(environment = process.env) {
  const privateKey = readSecretFile(environment.GITHUB_APP_PRIVATE_KEY_FILE, 'GitHub App private key');
  const githubClient = new GitHubAppClient({
    owner: environment.GITHUB_REPOSITORY_OWNER,
    repo: environment.GITHUB_REPOSITORY_NAME,
    appId: environment.GITHUB_APP_ID,
    installationId: environment.GITHUB_APP_INSTALLATION_ID,
    privateKey,
    defaultBranch: environment.GITHUB_DEFAULT_BRANCH || 'main',
  });
  return new DiemMcpCore({
    githubClient,
    assetRoot: environment.DIEM_MCP_ASSET_ROOT || '/var/lib/diem-mcp',
  });
}

function createReadOnlyCanaryCore(environment = process.env) {
  const ref = String(environment.GITHUB_CANARY_REF || '').trim();
  if (!ref || ref === 'main' || ref === environment.GITHUB_DEFAULT_BRANCH) {
    throw new Error('[DIEM MCP] GITHUB_CANARY_REF must name a non-default canary branch.');
  }
  return new DiemMcpCore({
    githubClient: new PublicGitHubReadClient({
      owner: environment.GITHUB_REPOSITORY_OWNER,
      repo: environment.GITHUB_REPOSITORY_NAME,
      ref,
    }),
  });
}

function attachStatelessTransport(app, serverFactory) {
  app.post('/mcp', async (request, response) => {
    const server = serverFactory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      response.on('close', () => Promise.allSettled([transport.close(), server.close()]));
    } catch (error) {
      process.stderr.write(`[DIEM MCP] MCP request error: ${error.message}\n`);
      if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });
  app.all('/mcp', (_request, response) => response.status(405).json({
    jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null,
  }));
}

function createActiveApp({ core, environment = process.env } = {}) {
  const hostname = environment.MCP_PUBLIC_HOSTNAME;
  const bearerToken = environment.MCP_BEARER_TOKEN;
  if (!hostname || !bearerToken) throw new Error('[DIEM MCP] MCP_PUBLIC_HOSTNAME and MCP_BEARER_TOKEN are required in active mode.');
  const app = createMcpExpressApp({ host: environment.HOST || '0.0.0.0', allowedHosts: [hostname] });
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'diem-mcp', mode: 'active', transport: 'streamable-http' });
  });
  app.use('/mcp', (request, response, next) => {
    const match = /^Bearer\s+(.+)$/iu.exec(request.headers.authorization || '');
    if (!match || !equalSecret(bearerToken, match[1])) {
      response.status(401).set('WWW-Authenticate', 'Bearer').json({
        jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null,
      });
      return;
    }
    next();
  });
  attachStatelessTransport(app, () => createDiemMcpServer(core || createActiveCore(environment)));
  return app;
}

function createReadOnlyCanaryApp({ core, environment = process.env } = {}) {
  const hostname = environment.MCP_PUBLIC_HOSTNAME;
  if (!hostname) throw new Error('[DIEM MCP] MCP_PUBLIC_HOSTNAME is required in canary_readonly mode.');
  const canaryCore = core || createReadOnlyCanaryCore(environment);
  const app = createMcpExpressApp({ host: environment.HOST || '0.0.0.0', allowedHosts: [hostname] });
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'diem-mcp', mode: 'canary-readonly', transport: 'streamable-http', tools: ['get_pending_candidate_pack', 'get_editorial_context'] });
  });
  attachStatelessTransport(app, () => createReadOnlyCanaryServer(canaryCore));
  return app;
}

function runServer(environment = process.env) {
  if (!['active', 'canary_readonly'].includes(environment.DIEM_MCP_MODE)) {
    require('./mock-server');
    return;
  }
  const app = environment.DIEM_MCP_MODE === 'active'
    ? createActiveApp({ environment })
    : createReadOnlyCanaryApp({ environment });
  const port = Number(environment.PORT || 3000);
  const host = environment.HOST || '127.0.0.1';
  app.listen(port, host, error => {
    if (error) throw error;
    process.stdout.write(`DIEM MCP Streamable HTTP server listening on ${host}:${port}\n`);
  });
}

if (require.main === module) runServer();

module.exports = {
  createActiveApp,
  createActiveCore,
  createDiemMcpServer,
  createReadOnlyCanaryApp,
  createReadOnlyCanaryCore,
  createReadOnlyCanaryServer,
  equalSecret,
  runServer,
};
