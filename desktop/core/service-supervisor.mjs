import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Owns explicit runtime executables; never invokes npm, Bash, or a command shell. */
export class ServiceSupervisor extends EventEmitter {
  #children = [];
  #controller = new AbortController();
  #stopping;
  #started = false;
  #ready = false;

  async start(services, { signal, timeoutMs = 60000, pollMs = 100 } = {}) {
    if (this.#started) throw new Error('This service supervisor has already started.');
    this.#started = true;
    const abort = () => this.#controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      for (const [index, service] of services.entries()) {
        this.#controller.signal.throwIfAborted();
        if (!path.isAbsolute(service.command) || typeof service.ready !== 'function') throw new Error('Services require an absolute executable and a readiness check.');
        this.emit('progress', { id: service.id, phase: 'starting', completed: index, total: services.length });
        const child = spawn(service.command, service.args ?? [], {
          cwd: service.cwd,
          env: service.env ?? process.env,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const record = { child, id: service.id, exited: false, closed: false, error: null, close: null };
        record.close = new Promise((resolve) => child.once('close', () => { record.closed = true; resolve(); }));
        this.#children.push(record);
        for (const stream of ['stdout', 'stderr']) {
          child[stream].on('data', (data) => this.emit('log', { id: service.id, stream, text: data.toString().slice(-16384) }));
        }
        child.once('error', (error) => { record.error = error; });
        child.once('exit', (code, exitSignal) => {
          record.exited = true;
          if (this.#ready && !this.#stopping) {
            this.emit('failure', { id: service.id, code, signal: exitSignal });
            void this.stop();
          }
        });
        const deadline = Date.now() + timeoutMs;
        while (true) {
          this.#controller.signal.throwIfAborted();
          if (record.error || record.exited) throw new Error(`${service.id} exited before becoming ready.`);
          if (Date.now() >= deadline) throw new Error(`${service.id} did not become ready before the startup deadline.`);
          const checkAbort = new AbortController();
          const cancelCheck = () => checkAbort.abort();
          this.#controller.signal.addEventListener('abort', cancelCheck, { once: true });
          let timer;
          let ready;
          try {
            // A broken health check must not make startup uncancellable or unbounded.
            ready = await Promise.race([
              Promise.resolve().then(() => service.ready(checkAbort.signal)).catch(() => false),
              new Promise((resolve) => { timer = setTimeout(() => { checkAbort.abort(); resolve(false); }, Math.min(1000, deadline - Date.now())); }),
            ]);
          } finally {
            clearTimeout(timer);
            this.#controller.signal.removeEventListener('abort', cancelCheck);
          }
          if (ready && !record.exited && !record.error) break;
          await delay(pollMs, undefined, { signal: this.#controller.signal });
        }
        this.emit('progress', { id: service.id, phase: 'ready', completed: index + 1, total: services.length });
      }
      this.#ready = true;
      if (this.#children.some((record) => record.exited || record.error)) throw new Error('A service exited during startup.');
    } catch (error) {
      await this.stop();
      throw error;
    } finally { signal?.removeEventListener('abort', abort); }
  }

  stop({ graceMs = 2000 } = {}) {
    this.#stopping ??= this.#stop(graceMs);
    return this.#stopping;
  }

  async #stop(graceMs) {
    this.#controller.abort();
    for (const record of [...this.#children].reverse()) {
      const { child } = record;
      if (record.closed || !child.pid) continue;
      if (process.platform === 'win32') {
        const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
        await new Promise((resolve) => {
          const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.once('error', resolve);
          killer.once('close', resolve);
        });
      } else {
        const kill = (signal) => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
        kill('SIGTERM');
        let timer;
        await Promise.race([record.close, new Promise((resolve) => { timer = setTimeout(resolve, graceMs); })]);
        clearTimeout(timer);
        if (!record.closed) kill('SIGKILL');
      }
      await record.close;
      this.emit('progress', { id: record.id, phase: 'stopped' });
    }
  }
}
