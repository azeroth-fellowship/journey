// SPDX-License-Identifier: GPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './index';

describe('ApiClient retry', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('retries on failure then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('network down');
      return new Response(JSON.stringify({ batchId: 'b', accepted: [], duplicate: [], rejected: [], serverTime: new Date().toISOString() }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new ApiClient({ baseUrl: 'http://example.com' });
    const req = { batchId: 'b', characterId: 'c', events: [], sentAt: new Date().toISOString() } as any;
    const promise = client.uploadBatchWithRetry(req, { maxAttempts: 3, baseDelayMs: 1 });
    // advance timers for retries
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.batchId).toBe('b');
    expect(calls).toBe(3);
  });

  it('throws after exhausting attempts', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: 'http://example.com' });
    const req = { batchId: 'b', characterId: 'c', events: [], sentAt: new Date().toISOString() } as any;
    const promise = client.uploadBatchWithRetry(req, { maxAttempts: 2, baseDelayMs: 1 });
    vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('boom');
  });
});