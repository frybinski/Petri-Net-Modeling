import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJobPool, type JobPool, type PoolOptions } from '../src/api/pool';
import { ApiError } from '../src/errors';
import { silentLogger } from '../src/logger';
import { SERVER_ROOT } from './helpers';

const WORKER = join(SERVER_ROOT, 'test', 'fixtures', 'workers', 'echo.mjs');

let pool: JobPool | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

function make(options: Partial<PoolOptions> = {}): JobPool {
  pool = createJobPool({
    workerFile: WORKER,
    size: 2,
    timeoutMs: 5000,
    memoryMb: 128,
    maxQueue: 2,
    logger: silentLogger,
    ...options,
  });
  return pool;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Expected the job to fail');
}

describe('the job pool', () => {
  it('runs a job in a thread and returns its result', async () => {
    const p = make();
    expect(await p.run('echo', { a: [1, 2, { b: 3 }] })).toEqual({ a: [1, 2, { b: 3 }] });
    expect(p.stats()).toMatchObject({ size: 2, running: 0, queued: 0, threads: 1 });
  });

  it('runs as many jobs at once as there are threads, and queues the rest in order', async () => {
    const p = make({ size: 2, maxQueue: 5 });
    const order: number[] = [];
    const started = Date.now();
    const jobs = [0, 1, 2, 3].map((n) =>
      p.run('sleep', { ms: 300 }).then(() => {
        order.push(n);
        return Date.now() - started;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(p.stats()).toMatchObject({ running: 2, queued: 2 });
    const times = await Promise.all(jobs);
    expect(order.slice(0, 2).sort()).toEqual([0, 1]);
    expect(order.slice(2).sort()).toEqual([2, 3]);
    // Two waves of 300 ms, not four.
    expect(times[2]).toBeGreaterThanOrEqual(580);
    expect(Math.max(...times)).toBeLessThan(1500);
  });

  it('refuses a job when the queue is full, with 503 and Retry-After', async () => {
    const p = make({ size: 1, maxQueue: 1 });
    const first = p.run('sleep', { ms: 300 });
    const second = p.run('sleep', { ms: 10 });
    const third = await failure(p.run('echo', {}));
    expect(third).toMatchObject({ status: 503, code: 'busy' });
    expect(third.headers['Retry-After']).toBe('5');
    await Promise.all([first, second]);
  });

  it('ends a job that runs too long, answers 504 and goes on with a new thread', async () => {
    const p = make({ size: 1, timeoutMs: 300 });
    const started = Date.now();
    const error = await failure(p.run('spin', {}));
    expect(error).toMatchObject({ status: 504, code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(p.stats().running).toBe(0);
    expect(await p.run('echo', { again: true })).toEqual({ again: true });
  });

  it('lets a job ask for a shorter limit', async () => {
    const p = make({ size: 1, timeoutMs: 5000 });
    const error = await failure(p.run('spin', {}, { timeoutMs: 150 }));
    expect(error.status).toBe(504);
  });

  it('starts the next waiting job after one was stopped', async () => {
    const p = make({ size: 1, timeoutMs: 300, maxQueue: 2 });
    const stuck = p.run('spin', {});
    const next = p.run('echo', { n: 2 });
    expect((await failure(stuck)).status).toBe(504);
    expect(await next).toEqual({ n: 2 });
  });

  it('stops a job whose caller went away', async () => {
    const p = make({ size: 1 });
    const controller = new AbortController();
    const job = p.run('spin', {}, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(p.stats().running).toBe(1);
    controller.abort(new Error('client gone'));
    await expect(job).rejects.toThrow('client gone');
    expect(p.stats().running).toBe(0);
    expect(await p.run('echo', { ok: 1 })).toEqual({ ok: 1 });
  });

  it('drops a waiting job whose caller went away', async () => {
    const p = make({ size: 1, maxQueue: 3 });
    const running = p.run('sleep', { ms: 200 });
    const controller = new AbortController();
    const waiting = p.run('echo', {}, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(p.stats().queued).toBe(1);
    controller.abort(new Error('gone'));
    await expect(waiting).rejects.toThrow('gone');
    expect(p.stats().queued).toBe(0);
    await running;
  });

  it('does not start a job whose signal is already aborted', async () => {
    const p = make();
    const controller = new AbortController();
    controller.abort(new Error('early'));
    await expect(p.run('echo', {}, { signal: controller.signal })).rejects.toThrow('early');
    expect(p.stats().threads).toBe(0);
  });

  it('ends a job that needs more memory than the limit with 422', async () => {
    const p = make({ size: 1, memoryMb: 64, timeoutMs: 20_000 });
    const error = await failure(p.run('alloc', {}));
    expect(error).toMatchObject({ status: 422, code: 'resource_limit' });
    expect(error.message).toContain('64 MB');
    expect(await p.run('echo', { fine: true })).toEqual({ fine: true });
  });

  it('answers 500 for a thread that crashes and starts a new one', async () => {
    const p = make({ size: 1 });
    const error = await failure(p.run('crash', {}));
    expect(error).toMatchObject({ status: 500, code: 'internal' });
    expect(error.message).not.toContain('boom');
    expect(await p.run('echo', { alive: 1 })).toEqual({ alive: 1 });
  });

  it('passes on a failure that the job reports', async () => {
    const p = make();
    const error = await failure(p.run('fail', {}));
    expect(error).toMatchObject({ status: 422, code: 'unprocessable', message: 'nope' });
  });

  it('gives the thread no environment, so no key', async () => {
    process.env['PNM_TEST_SECRET_FOR_POOL'] = 'must-not-reach-the-thread';
    try {
      const p = make();
      const result = await p.run<{ names: string[] }>('env', {});
      expect(result.names).not.toContain('PNM_TEST_SECRET_FOR_POOL');
      expect(result.names).toEqual([]);
    } finally {
      delete process.env['PNM_TEST_SECRET_FOR_POOL'];
    }
  });

  it('ends idle threads and starts them again when needed', async () => {
    const p = make({ idleMs: 100 });
    await p.run('echo', {});
    expect(p.stats().threads).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(p.stats().threads).toBe(0);
    expect(await p.run('echo', { back: true })).toEqual({ back: true });
  });

  it('rejects running and waiting jobs when it is closed', async () => {
    const p = make({ size: 1, maxQueue: 2 });
    const running = failure(p.run('spin', {}));
    const waiting = failure(p.run('echo', {}));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await p.close();
    expect((await running).status).toBe(503);
    expect((await waiting).status).toBe(503);
    expect((await failure(p.run('echo', {}))).status).toBe(503);
  });
});
