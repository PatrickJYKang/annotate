import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ServiceSupervisor } from '../core/service-supervisor.mjs';

function service(supervisor, id) {
  let origin;
  let pid;
  supervisor.on('log', (event) => {
    if (event.id !== id) return;
    const match = /ready:(\d+):(\d+)/.exec(event.text);
    if (match) { origin = `http://127.0.0.1:${match[1]}`; pid = Number(match[2]); }
  });
  return {
    descriptor: {
      id, command: process.execPath,
      args: ['-e', `const http=require('node:http'); const s=http.createServer((q,r)=>r.end('${id}')); s.listen(0,'127.0.0.1',()=>console.log('ready:'+s.address().port+':'+process.pid));`],
      ready: async (signal) => origin && (await (await fetch(origin, { signal })).text()) === id,
    },
    get origin() { return origin; },
    get pid() { return pid; },
  };
}

test('starts real child services, waits for readiness, and shuts down its owned process trees', async () => {
  const supervisor = new ServiceSupervisor();
  const first = service(supervisor, 'web');
  const second = service(supervisor, 'sidecar');
  const progress = [];
  supervisor.on('progress', (event) => progress.push(event));
  try {
    await supervisor.start([first.descriptor, second.descriptor], { timeoutMs: 5000, pollMs: 10 });
    assert.equal(await (await fetch(first.origin)).text(), 'web');
    assert.equal(progress.filter((event) => event.phase === 'ready').length, 2);
  } finally { await supervisor.stop(); }
  await assert.rejects(fetch(first.origin));
  await assert.rejects(fetch(second.origin));
});

test('startup failure tears down already-started services', async () => {
  const supervisor = new ServiceSupervisor();
  const first = service(supervisor, 'web');
  await assert.rejects(supervisor.start([
    first.descriptor,
    { id: 'broken', command: process.execPath, args: ['-e', 'process.exit(7)'], ready: async () => false },
  ], { timeoutMs: 5000, pollMs: 10 }), /before becoming ready/);
  await assert.rejects(fetch(first.origin));
});

test('a runtime crash closes other owned services and reports the failure', async () => {
  const supervisor = new ServiceSupervisor();
  const first = service(supervisor, 'web');
  const second = service(supervisor, 'sidecar');
  await supervisor.start([first.descriptor, second.descriptor], { timeoutMs: 5000, pollMs: 10 });
  const failed = once(supervisor, 'failure');
  process.kill(second.pid, 'SIGTERM');
  assert.equal((await failed)[0].id, 'sidecar');
  await supervisor.stop();
  await assert.rejects(fetch(first.origin));
});

test('startup is bounded even when a readiness probe never settles', async () => {
  const supervisor = new ServiceSupervisor();
  const first = service(supervisor, 'web');
  await assert.rejects(supervisor.start([{ ...first.descriptor, ready: () => new Promise(() => {}) }], { timeoutMs: 100, pollMs: 10 }), /startup deadline/);
  if (first.origin) await assert.rejects(fetch(first.origin));
});

test('a canceled startup does not spawn services', async () => {
  const supervisor = new ServiceSupervisor();
  const controller = new AbortController();
  controller.abort();
  const logs = [];
  supervisor.on('log', (event) => logs.push(event));
  await assert.rejects(supervisor.start([service(supervisor, 'web').descriptor], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(logs.length, 0);
});
