const http = require('http');

const { MCP_INSTRUCTIONS } = require('./instructions');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify({ status: 'ok', service: 'diem-mcp-mock', transport: 'mock-only' })}\n`);
    return;
  }
  if (request.url === '/mcp') {
    response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify({
      error: 'MCP transport is not installed in the mock service.',
      instructions: MCP_INSTRUCTIONS,
    })}\n`);
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end('{"error":"not found"}\n');
});

server.listen(port, host, () => {
  process.stdout.write(`DIEM MCP mock listening on ${host}:${port}\n`);
});
