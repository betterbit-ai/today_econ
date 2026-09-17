const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { createRequire } = require('node:module');

const serviceRequire = createRequire(path.join(__dirname, '..', 'services', 'diem-mcp', 'package.json'));
const { Client } = serviceRequire('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = serviceRequire('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { DiemMcpCore, MockGitHubClient } = require('../services/diem-mcp/src/core');
const { allowedHosts, createActiveApp, createConnectivityCanaryApp, createConnectivityCanaryServer, createDiemMcpServer, equalSecret, suppliedCredential } = require('../services/diem-mcp/src/server');

test('registers the restricted MCP tool surface and uses constant-time bearer comparison', () => {
  const server = createDiemMcpServer(new DiemMcpCore({ githubClient: new MockGitHubClient() }));
  assert.deepEqual(Object.keys(server._registeredTools).sort(), [
    'attach_image_to_package',
    'get_editorial_context',
    'get_package_status',
    'get_pending_candidate_pack',
    'get_visual_library',
    'ingest_generated_image',
    'submit_editorial_package',
    'write_canary_proof',
    'write_image_canary_proof',
  ]);
  assert.deepEqual(server._registeredTools.write_canary_proof.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(equalSecret('secret', 'secret'), true);
  assert.equal(equalSecret('secret', 'different'), false);
  assert.equal(suppliedCredential({ authorization: 'Bearer secret' }), 'secret');
  assert.equal(suppliedCredential({ 'x-api-key': 'secret' }), 'secret');
  assert.equal(suppliedCredential({ authorization: 'Basic unrelated' }), '');
  assert.deepEqual(allowedHosts('mcp.example.test'), ['mcp.example.test', '127.0.0.1', 'localhost']);
  const canary = createConnectivityCanaryServer();
  assert.deepEqual(Object.keys(canary._registeredTools).sort(), ['get_mcp_canary_status']);
});

test('serves the real stateless Streamable HTTP transport only with a bearer credential', async t => {
  const core = new DiemMcpCore({ githubClient: new MockGitHubClient() });
  const app = createActiveApp({
    core,
    environment: { HOST: '127.0.0.1', MCP_PUBLIC_HOSTNAME: '127.0.0.1', MCP_BEARER_TOKEN: 'test-secret' },
  });
  const listener = http.createServer(app);
  const started = await new Promise(resolve => {
    listener.once('error', error => resolve({ error }));
    listener.listen(0, '127.0.0.1', () => resolve({ error: null }));
  });
  if (started.error) {
    if (started.error.code === 'EPERM') {
      t.skip('The managed test sandbox does not permit loopback listeners; this integration test is run in the approved local network lane.');
      return;
    }
    throw started.error;
  }
  const { port } = listener.address();
  const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
  try {
    const unauthorized = await fetch(endpoint, { method: 'POST', headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(unauthorized.status, 401);

    const client = new Client({ name: 'diem-mcp-transport-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: 'Bearer test-secret' } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.some(tool => tool.name === 'get_pending_candidate_pack'), true);
    const result = await client.callTool({ name: 'get_pending_candidate_pack', arguments: { category: 'economy' } });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.status, 'no_candidate_pack');
    await client.close();
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});

test('connectivity canary exposes one no-data tool even without a bearer token', async t => {
  const app = createConnectivityCanaryApp({ environment: { HOST: '127.0.0.1', MCP_PUBLIC_HOSTNAME: '127.0.0.1' } });
  const listener = http.createServer(app);
  const started = await new Promise(resolve => {
    listener.once('error', error => resolve({ error }));
    listener.listen(0, '127.0.0.1', () => resolve({ error: null }));
  });
  if (started.error) {
    if (started.error.code === 'EPERM') {
      t.skip('The managed test sandbox does not permit loopback listeners; this integration test is run in the approved local network lane.');
      return;
    }
    throw started.error;
  }
  const { port } = listener.address();
  try {
    const client = new Client({ name: 'diem-mcp-readonly-canary-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['get_mcp_canary_status']);
    const result = await client.callTool({ name: 'get_mcp_canary_status', arguments: {} });
    assert.deepEqual(result.structuredContent, {
      status: 'ready', mode: 'connectivity-canary', repositoryAccess: 'none', writeAccess: 'none', imageAccess: 'none', publishAccess: 'none',
    });
    await client.close();
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});
