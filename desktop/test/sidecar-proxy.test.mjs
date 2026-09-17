import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startSidecarProxy } from '../core/sidecar-proxy.mjs';

test('renderer proxy hides trusted paths and limits CV/streaming to window-owned video refs', async (t) => {
  const calls = [];
  const upstream = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    calls.push({ path: request.url, token: request.headers.authorization, body: Buffer.concat(parts).toString() });
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write('{"progress":0.5}\n');
    response.end('{"done":true}\n');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:9100';
  const proxy = await startSidecarProxy({ upstream: `http://127.0.0.1:${upstream.address().port}`, token: 'private-token', rendererOrigin: origin });
  const first = proxy.connect(), second = proxy.connect();
  t.after(async () => {
    await first.close(); await second.close(); await proxy.close();
    await new Promise((resolve) => { upstream.close(resolve); upstream.closeAllConnections(); });
  });
  first.addRef('1234567890abcdef');
  const request = (connection, route, body, headers = {}) => fetch(`${connection.runtime.sidecar.baseUrl}${route}`, {
    method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
    headers: { Origin: origin, Authorization: `Bearer ${connection.runtime.sidecar.token}`, 'Content-Type': 'application/json', ...headers },
  });
  assert.notEqual(first.runtime.sidecar.token, 'private-token');
  assert.equal((await request(first, '/health')).status, 200);
  assert.equal((await request(first, '/health', null, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request(first, '/health', null, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request(first, '/native/register', { path: '/private/source.mp4' })).status, 403);
  assert.equal((await request(first, '/export', { videoRef: '1234567890abcdef' })).status, 403);
  assert.equal((await request(second, '/track', { videoRef: '1234567890abcdef' })).status, 403);
  assert.equal((await request(first, '/homography', { videoRef: '1234567890abcdef', videoPath: '/private/file' })).status, 403);
  const result = await request(first, '/track/stream', { videoRef: '1234567890abcdef', startMs: 0, endMs: 1000 });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), '{"progress":0.5}\n{"done":true}\n');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].token, 'Bearer private-token');
  const homography = await request(first, '/homography/stream', { videoRef: '1234567890abcdef', startMs: 0, endMs: 1000 });
  assert.equal(homography.status, 200);
  assert.equal(await homography.text(), '{"progress":0.5}\n{"done":true}\n');
  assert.equal((await request(second, '/homography/stream', { videoRef: '1234567890abcdef' })).status, 403);
  assert.equal((await request(first, '/homography/stream', { videoRef: '1234567890abcdef', videoPath: '/private/file' })).status, 403);
  await first.close();
  assert.equal((await request(first, '/health')).status, 401);
});
