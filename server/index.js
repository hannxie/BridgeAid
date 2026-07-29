import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processChatRequest, ChatServiceError } from './services/chat-service.js';
import { createOpenAIChatProvider } from './services/openai-chat-provider.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

export function createRateLimiter({
  limit = Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE || 30),
  windowMs = 60_000,
  now = () => Date.now()
} = {}) {
  const clients = new Map();
  return function allow(clientId) {
    const time = now();
    const current = clients.get(clientId);
    if (!current || current.resetAt <= time) {
      clients.set(clientId, { count: 1, resetAt: time + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}

async function readJsonBody(request, maxBytes = 12_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new ChatServiceError('request_too_large', 'Request body is too large.', 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ChatServiceError('invalid_request', 'Request body must be valid JSON.', 400);
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = resolve(ROOT, relativePath);
  if (target !== ROOT && !target.startsWith(`${ROOT}${sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const fileStat = await stat(target);
    if (!fileStat.isFile()) throw new Error('not a file');
    const file = await readFile(target);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(file);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

export function createBridgeAidServer({
  provider = createOpenAIChatProvider(),
  rateLimiter = createRateLimiter()
} = {}) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method_not_allowed' } });
        return;
      }
      const clientId = request.socket.remoteAddress || 'unknown';
      if (!rateLimiter(clientId)) {
        sendJson(response, 429, { error: { code: 'rate_limited' } });
        return;
      }
      try {
        const body = await readJsonBody(request);
        const result = await processChatRequest(body, { provider });
        sendJson(response, 200, result);
      } catch (error) {
        const safeError = error instanceof ChatServiceError
          ? error
          : new ChatServiceError('api_unavailable', 'Chat request failed.', 503);
        // Do not log message bodies, quiz answers, helper notes, or provider payloads.
        console.warn('[BridgeAid chat]', {
          code: safeError.code,
          status: safeError.status
        });
        sendJson(response, safeError.status, { error: { code: safeError.code } });
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405);
      response.end('Method not allowed');
      return;
    }
    await serveStatic(request, response);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const server = createBridgeAidServer();
  server.listen(port, () => {
    console.info(`[BridgeAid] http://localhost:${port}`);
  });
}

