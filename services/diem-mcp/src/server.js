const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const express = require('express');
const z = require('zod/v4');

const { DiemMcpCore } = require('./core');
const { GitHubAppClient } = require('./github-app');
const { MCP_INSTRUCTIONS } = require('./instructions');
const { OAuthStore, authorizationForm, isChatgptClientId, isChatgptRedirectUri } = require('./oauth');

const JSON_OBJECT = z.record(z.string(), z.unknown());
const REQUEST_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/u);

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function registerCoreTool(server, name, description, inputSchema, core, annotations) {
  server.registerTool(name, { description, inputSchema, annotations }, async input => toolResult(await core.call(name, input)));
}

function createDiemMcpServer(core) {
  const server = new McpServer(
    { name: 'diem-cloud-editorial', version: '0.1.0' },
    { capabilities: { logging: {} }, instructions: MCP_INSTRUCTIONS },
  );
  registerCoreTool(server, 'get_pending_candidate_pack', 'Read the latest unexpired, untrusted candidate pack. Read this before writing.', {
    category: z.enum(['any', 'economy', 'issue']).optional(),
    now: z.string().datetime({ offset: true }).optional(),
  }, core, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  registerCoreTool(server, 'get_editorial_context', 'Read recent DIEM editorial performance context. It cannot publish or change repository settings.', {
    days: z.number().int().min(1).max(14).optional(),
  }, core, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  registerCoreTool(server, 'write_canary_proof', 'Write one restricted canary JSON file and open a PR. It cannot write packages, workflows, settings, secrets, or Instagram content.', {
    requestId: REQUEST_ID,
    note: z.string().min(1).max(280).optional(),
  }, core, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  registerCoreTool(server, 'ingest_generated_image', 'Store one generated editorial image supplied inline by the same task. Only PNG, JPEG, or WebP data is accepted; remote URLs are never fetched.', {
    requestId: REQUEST_ID,
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    dataBase64: z.string().max(12_000_000).optional(),
  }, core, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  registerCoreTool(server, 'write_image_canary_proof', 'Write one generated-image handoff canary and manifest under the restricted canary path, then open a PR. It never publishes or writes packages, workflows, settings, or secrets.', {
    requestId: REQUEST_ID,
    assetId: z.string().min(1).max(96),
  }, core, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  registerCoreTool(server, 'submit_editorial_package', 'Validate and open one repository pull request for a DIEM editorial package. This never publishes to Instagram.', {
    requestId: REQUEST_ID,
    candidatePackSha256: SHA256,
    package: JSON_OBJECT,
    assetId: z.string().max(96).optional(),
  }, core, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  registerCoreTool(server, 'attach_image_to_package', 'Submit a package with its previously ingested generated image. This never publishes to Instagram.', {
    requestId: REQUEST_ID,
    candidatePackSha256: SHA256,
    package: JSON_OBJECT,
    assetId: z.string().min(1).max(96),
  }, core, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  registerCoreTool(server, 'get_package_status', 'Read package status from the repository. It cannot modify a package.', {
    packageId: REQUEST_ID,
  }, core, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  return server;
}

function createConnectivityCanaryServer() {
  const server = new McpServer(
    { name: 'diem-cloud-editorial-connectivity-canary', version: '0.1.0' },
    { capabilities: { logging: {} }, instructions: 'No-auth DIEM Oracle MCP connectivity canary. It returns only its fixed capability status. No repository data, write, image, publish, shell, or secret tool exists.' },
  );
  server.registerTool('get_mcp_canary_status', {
    description: 'Return the fixed, no-data connectivity-canary status. This tool cannot access or modify any system.',
    inputSchema: {},
  }, async () => toolResult({
    status: 'ready',
    mode: 'connectivity-canary',
    repositoryAccess: 'none',
    writeAccess: 'none',
    imageAccess: 'none',
    publishAccess: 'none',
  }));
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

function suppliedCredential(headers = {}) {
  const authorization = String(headers.authorization || '');
  const bearer = /^Bearer\s+(.+)$/iu.exec(authorization);
  if (bearer) return bearer[1];
  const apiKey = headers['x-api-key'];
  return typeof apiKey === 'string' ? apiKey : '';
}

function allowedHosts(hostname) {
  return [...new Set([hostname, '127.0.0.1', 'localhost'].filter(Boolean))];
}

function createOAuthConfig(environment = process.env) {
  const hostname = String(environment.MCP_PUBLIC_HOSTNAME || '').trim();
  const password = String(environment.MCP_AUTHORIZATION_PASSWORD || environment.MCP_BEARER_TOKEN || '');
  if (!hostname || !password) throw new Error('[DIEM MCP] MCP_PUBLIC_HOSTNAME and MCP_AUTHORIZATION_PASSWORD are required for OAuth.');
  return {
    issuer: `https://${hostname}`,
    resource: `https://${hostname}/mcp`,
    password,
    scopes: 'diem:read diem:write',
    store: new OAuthStore(path.join(environment.DIEM_MCP_ASSET_ROOT || '/var/lib/diem-mcp', 'oauth-state.json')),
  };
}

function oauthError(response, error, status = 400) {
  response.status(status).json({ error });
}

function mountOAuthRoutes(app, oauth) {
  app.use(express.urlencoded({ extended: false }));
  app.get('/.well-known/oauth-protected-resource', (_request, response) => response.json({
    resource: oauth.resource,
    authorization_servers: [oauth.issuer],
    scopes_supported: oauth.scopes.split(' '),
    resource_documentation: `${oauth.issuer}/mcp`,
  }));
  app.get('/.well-known/oauth-authorization-server', (_request, response) => response.json({
    issuer: oauth.issuer,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${oauth.issuer}/oauth/authorize`,
    token_endpoint: `${oauth.issuer}/oauth/token`,
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ['none'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: oauth.scopes.split(' '),
  }));
  app.get('/oauth/authorize', (request, response) => {
    const query = request.query || {};
    if (query.response_type !== 'code' || !isChatgptClientId(query.client_id) || !isChatgptRedirectUri(query.redirect_uri)
      || query.code_challenge_method !== 'S256' || !query.code_challenge || query.resource !== oauth.resource) {
      response.status(400).send('Invalid OAuth authorization request.');
      return;
    }
    response.type('html').send(authorizationForm(query));
  });
  app.post('/oauth/authorize', (request, response) => {
    const body = request.body || {};
    if (body.response_type !== 'code' || !isChatgptClientId(body.client_id) || !isChatgptRedirectUri(body.redirect_uri)
      || body.code_challenge_method !== 'S256' || !body.code_challenge || body.resource !== oauth.resource || !equalSecret(oauth.password, body.password)) {
      response.status(400).send('Authorization failed.');
      return;
    }
    const requestedScopes = String(body.scope || oauth.scopes).split(/\s+/u).filter(Boolean);
    const supported = new Set(oauth.scopes.split(' '));
    if (requestedScopes.some(scope => !supported.has(scope))) {
      response.status(400).send('Unsupported scope.');
      return;
    }
    const code = oauth.store.createCode({
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      resource: body.resource,
      scope: requestedScopes.join(' '),
    });
    const redirect = new URL(body.redirect_uri);
    redirect.searchParams.set('code', code);
    if (body.state) redirect.searchParams.set('state', body.state);
    redirect.searchParams.set('iss', oauth.issuer);
    response.redirect(302, redirect.toString());
  });
  app.post('/oauth/token', (request, response) => {
    const body = request.body || {};
    try {
      if (body.grant_type === 'authorization_code') {
        if (!isChatgptClientId(body.client_id) || !isChatgptRedirectUri(body.redirect_uri) || !body.code || !body.code_verifier || body.resource !== oauth.resource) {
          oauthError(response, 'invalid_request');
          return;
        }
        response.json(oauth.store.exchangeCode({ code: body.code, clientId: body.client_id, redirectUri: body.redirect_uri, codeVerifier: body.code_verifier, resource: body.resource }));
        return;
      }
      if (body.grant_type === 'refresh_token') {
        if (!isChatgptClientId(body.client_id) || !body.refresh_token || body.resource !== oauth.resource) {
          oauthError(response, 'invalid_request');
          return;
        }
        response.json(oauth.store.refresh({ refreshToken: body.refresh_token, clientId: body.client_id, resource: body.resource }));
        return;
      }
      oauthError(response, 'unsupported_grant_type');
    } catch (error) {
      oauthError(response, error.message === 'invalid_grant' ? 'invalid_grant' : 'invalid_request');
    }
  });
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
  const app = createMcpExpressApp({ host: environment.HOST || '0.0.0.0', allowedHosts: allowedHosts(hostname) });
  const oauth = createOAuthConfig(environment);
  mountOAuthRoutes(app, oauth);
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'diem-mcp', mode: 'active', transport: 'streamable-http' });
  });
  app.use('/mcp', (request, response, next) => {
    const credential = suppliedCredential(request.headers);
    const sharedSecretAuthenticated = equalSecret(bearerToken, credential);
    const oauthAuthenticated = Boolean(oauth.store.access(credential, { resource: oauth.resource }));
    if (!sharedSecretAuthenticated && !oauthAuthenticated) {
      response.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${oauth.issuer}/.well-known/oauth-protected-resource", scope="${oauth.scopes}"`).json({
        jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null,
      });
      return;
    }
    next();
  });
  attachStatelessTransport(app, () => createDiemMcpServer(core || createActiveCore(environment)));
  return app;
}

function createConnectivityCanaryApp({ environment = process.env } = {}) {
  const hostname = environment.MCP_PUBLIC_HOSTNAME;
  if (!hostname) throw new Error('[DIEM MCP] MCP_PUBLIC_HOSTNAME is required in canary_readonly mode.');
  const app = createMcpExpressApp({ host: environment.HOST || '0.0.0.0', allowedHosts: allowedHosts(hostname) });
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'diem-mcp', mode: 'connectivity-canary', transport: 'streamable-http', tools: ['get_mcp_canary_status'] });
  });
  attachStatelessTransport(app, () => createConnectivityCanaryServer());
  return app;
}

function runServer(environment = process.env) {
  if (!['active', 'canary_readonly'].includes(environment.DIEM_MCP_MODE)) {
    require('./mock-server');
    return;
  }
  const app = environment.DIEM_MCP_MODE === 'active'
    ? createActiveApp({ environment })
    : createConnectivityCanaryApp({ environment });
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
  createOAuthConfig,
  createConnectivityCanaryApp,
  createConnectivityCanaryServer,
  allowedHosts,
  equalSecret,
  mountOAuthRoutes,
  suppliedCredential,
  runServer,
};
