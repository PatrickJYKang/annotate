import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function authorized(value, token) {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(value ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Renderer never receives the upstream token or permission to use path-based routes. */
export async function startSidecarProxy({ upstream, token, rendererOrigin }) {
  const sessions = new Map();
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && origin !== rendererOrigin) { response.writeHead(403).end(); return; }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE' }).end(); return;
    }
    const match = /^\/session\/([a-f0-9-]{36})(\/[^?]*)$/.exec(request.url ?? '');
    const session = match && sessions.get(match[1]);
    if (!session || !authorized(request.headers.authorization, session.token)) { response.writeHead(401).end(); return; }
    const route = match[2];
    const controller = new AbortController();
    session.pending.add(controller);
    response.once('close', () => { if (!response.writableFinished) controller.abort(); });
    try {
      let body;
      const allowedPost = ['/track', '/track/stream', '/track/detect', '/homography', '/homography/stream'].includes(route);
      const deleteRef = /^\/video\/([a-f0-9]{16})$/.exec(route);
      if (request.method === 'POST' && allowedPost) {
        const parts = [];
        let length = 0;
        for await (const part of request) {
          length += part.length;
          if (length > 4 * 1024 * 1024) throw new Error('Request too large.');
          parts.push(part);
        }
        const data = JSON.parse(Buffer.concat(parts).toString());
        if (!data || typeof data !== 'object' || !session.refs.has(data.videoRef) || Object.keys(data).some((key) => /path|root|directory/i.test(key))) {
          response.writeHead(403).end(); return;
        }
        body = JSON.stringify(data);
      } else if (request.method === 'DELETE' && deleteRef && session.refs.has(deleteRef[1])) {
        session.refs.delete(deleteRef[1]);
      } else if (!(request.method === 'GET' && route === '/health')) { response.writeHead(403).end(); return; }
      const result = await fetch(`${upstream}${route}`, {
        method: request.method, body, signal: controller.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      });
      response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') ?? 'application/json' });
      if (result.body) await pipeline(Readable.fromWeb(result.body), response);
      else response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502).end('Local service request failed.');
      else response.destroy();
    } finally { session.pending.delete(controller); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    connect() {
      const id = randomUUID();
      const session = { token: randomBytes(32).toString('hex'), refs: new Set(), pending: new Set() };
      sessions.set(id, session);
      return {
        runtime: { version: 1, host: 'desktop', sidecar: { baseUrl: `${origin}/session/${id}`, token: session.token } },
        addRef: (ref) => session.refs.add(ref),
        removeRef: (ref) => session.refs.delete(ref),
        async close() {
          if (!sessions.has(id)) return;
          sessions.delete(id);
          for (const job of session.pending) job.abort();
          await Promise.all([...session.refs].map((ref) => fetch(`${upstream}/video/${ref}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})));
        },
      };
    },
    async close() {
      for (const session of sessions.values()) for (const job of session.pending) job.abort();
      sessions.clear();
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}
