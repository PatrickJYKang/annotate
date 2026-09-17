import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export function parseByteRange(header, size) {
  if (!Number.isSafeInteger(size) || size < 1) return null;
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end, partial: true };
}

/** Loopback-only capability URLs. This server exposes no arbitrary paths or directory listings. */
export async function startMediaServer(store, { allowedOrigins = [] } = {}) {
  const secret = randomBytes(32).toString('hex');
  const origins = new Set(allowedOrigins);
  const files = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = request.headers.origin;
    if ((origin && !origins.has(origin)) || (!origin && request.headers['sec-fetch-site'] === 'cross-site')) {
      response.writeHead(403).end(); return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const match = /^\/media\/([a-f0-9]{64})\/([a-f0-9-]{36})$/.exec(request.url ?? '');
    if (!match || match[1] !== secret || !files.has(match[2])) { response.writeHead(404).end(); return; }
    try {
      const fileId = match[2];
      const info = await store.fileInfo(fileId);
      const range = parseByteRange(request.headers.range, info.size);
      response.setHeader('Accept-Ranges', 'bytes');
      if (info.size === 0 && !request.headers.range) {
        response.writeHead(200, { 'Content-Length': 0, 'Content-Type': 'application/octet-stream' }).end(); return;
      }
      if (!range) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end(); return; }
      const media = await store.openReadStream(fileId, range.start, range.end);
      const types = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4' };
      response.setHeader('Content-Type', types[info.name.split('.').at(-1)?.toLowerCase()] ?? 'application/octet-stream');
      response.setHeader('Content-Length', media.length);
      if (range.partial) response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${media.size}`);
      response.writeHead(range.partial ? 206 : 200);
      if (request.method === 'HEAD') { media.stream.destroy(); response.end(); return; }
      response.once('close', () => media.stream.destroy());
      await pipeline(media.stream, response);
    } catch {
      if (!response.headersSent) response.writeHead(404).end();
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    async register(projectId, relative) {
      const file = await store.authorizeFile(projectId, relative);
      files.add(file.id);
      return { id: file.id, url: `${origin}/media/${secret}/${file.id}` };
    },
    release(id) { files.delete(id); store.releaseFile(id); },
    async close() {
      for (const id of files) store.releaseFile(id);
      files.clear();
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
