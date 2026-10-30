// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS, describeUpdate, FLUSH_TIMEOUT_MS, progressPercent, UpdateController, type UpdateDeps, type UpdateHandle } from './update';

const handle = (over: Partial<UpdateHandle> = {}): UpdateHandle => ({
  version: '0.2.0',
  body: ' Fixes things. ',
  downloadAndInstall: vi.fn(async (cb) => {
    cb({ event: 'Started', data: { contentLength: 200 } });
    cb({ event: 'Progress', data: { chunkLength: 50 } });
    cb({ event: 'Progress', data: { chunkLength: 150 } });
    cb({ event: 'Finished' });
  }),
  ...over,
});

const deps = (over: Partial<UpdateDeps> = {}): UpdateDeps => ({
  isEnabled: vi.fn(async () => true),
  check: vi.fn(async () => null),
  relaunch: vi.fn(async () => {}),
  beforeInstall: vi.fn(async () => {}),
  ...over,
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('UpdateController', () => {
  it('is disabled when the build has no updater config, and never checks', async () => {
    const d = deps({ isEnabled: async () => false });
    const c = new UpdateController(d);
    await c.start();
    expect(c.getState()).toEqual({ kind: 'disabled' });
    await c.check(true);
    expect(d.check).not.toHaveBeenCalled();
  });

  it('checks on start and reports up to date', async () => {
    const d = deps();
    const c = new UpdateController(d, () => 123);
    await c.start();
    c.stop();
    expect(d.check).toHaveBeenCalledTimes(1);
    expect(c.getState()).toEqual({ kind: 'idle', upToDate: true, checkedAt: 123 });
  });

  it('reports an available update with trimmed notes', async () => {
    const c = new UpdateController(deps({ check: async () => handle() }));
    await c.start();
    c.stop();
    expect(c.getState()).toEqual({ kind: 'available', version: '0.2.0', notes: 'Fixes things.' });
  });

  it('re-checks every 6 hours', async () => {
    const d = deps();
    const c = new UpdateController(d);
    await c.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    c.stop();
    expect(d.check).toHaveBeenCalledTimes(3);
  });

  it('defers automatic checks while blocked, then runs one when unblocked; manual checks still run', async () => {
    const d = deps();
    const c = new UpdateController(d);
    c.setBlocked(true);
    await c.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(d.check).not.toHaveBeenCalled();
    await c.check(true);
    expect(d.check).toHaveBeenCalledTimes(1);
    c.setBlocked(false);
    await vi.advanceTimersByTimeAsync(0);
    c.stop();
    expect(d.check).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed background check quiet but shows a failed manual check, and retry re-checks', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    const c = new UpdateController(deps({ check }));
    await c.check(false);
    expect(c.getState()).toMatchObject({ kind: 'idle', lastError: 'offline' });
    await c.check(true);
    expect(c.getState()).toEqual({ kind: 'error', during: 'check', message: 'offline' });
    await c.retry();
    expect(c.getState()).toMatchObject({ kind: 'idle', upToDate: true });
  });

  it('flushes the queue, downloads with progress, then relaunches', async () => {
    const order: string[] = [];
    const h = handle({
      downloadAndInstall: vi.fn(async (cb) => {
        order.push('download');
        cb({ event: 'Started', data: { contentLength: 200 } });
        cb({ event: 'Progress', data: { chunkLength: 50 } });
      }),
    });
    const d = deps({
      check: async () => h,
      beforeInstall: async () => { order.push('flush'); },
      relaunch: async () => { order.push('relaunch'); },
    });
    const c = new UpdateController(d);
    await c.check(true);
    const seen: number[] = [];
    c.subscribe(() => {
      const s = c.getState();
      if (s.kind === 'installing') {
        const p = progressPercent(s);
        if (p !== null) seen.push(p);
      }
    });
    await c.install();
    expect(order).toEqual(['flush', 'download', 'relaunch']);
    expect(seen).toContain(25);
    expect(c.getState()).toMatchObject({ kind: 'installing', stage: 'restarting' });
  });

  it('still installs when the pre-install flush fails or hangs', async () => {
    const failing = new UpdateController(deps({ check: async () => handle(), beforeInstall: async () => { throw new Error('boom'); } }));
    await failing.check(true);
    await failing.install();
    expect(failing.getState()).toMatchObject({ kind: 'installing', stage: 'restarting' });

    const d = deps({ check: async () => handle(), beforeInstall: () => new Promise(() => {}) });
    const hanging = new UpdateController(d);
    await hanging.check(true);
    const p = hanging.install();
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS);
    await p;
    expect(d.relaunch).toHaveBeenCalled();
  });

  it('shows an install error and retries the install without re-checking', async () => {
    const downloadAndInstall = vi.fn().mockRejectedValueOnce(new Error('signature mismatch')).mockResolvedValueOnce(undefined);
    const d = deps({ check: vi.fn(async () => handle({ downloadAndInstall })) });
    const c = new UpdateController(d);
    await c.check(true);
    await c.install();
    expect(c.getState()).toEqual({ kind: 'error', during: 'install', message: 'signature mismatch', version: '0.2.0' });
    expect(d.relaunch).not.toHaveBeenCalled();
    await c.retry();
    expect(d.check).toHaveBeenCalledTimes(1);
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });

  it('will not install while blocked', async () => {
    const d = deps({ check: async () => handle() });
    const c = new UpdateController(d);
    await c.check(true);
    c.setBlocked(true);
    await c.install();
    expect(c.getState().kind).toBe('available');
    expect(d.relaunch).not.toHaveBeenCalled();
  });
});

describe('progressPercent', () => {
  it('is null without a known size or outside the download stage', () => {
    expect(progressPercent({ kind: 'installing', version: '1', stage: 'downloading', downloaded: 5 })).toBeNull();
    expect(progressPercent({ kind: 'installing', version: '1', stage: 'flushing', downloaded: 0, total: 10 })).toBeNull();
    expect(progressPercent({ kind: 'installing', version: '1', stage: 'downloading', downloaded: 20, total: 10 })).toBe(100);
  });
});

describe('describeUpdate', () => {
  it('describes each state', () => {
    expect(describeUpdate({ kind: 'disabled' })).toMatch(/off/);
    expect(describeUpdate({ kind: 'available', version: '1.2.3', notes: '' })).toBe('Update 1.2.3 available.');
    expect(describeUpdate({ kind: 'error', during: 'check', message: 'x' })).toBe('Update check failed: x');
    expect(describeUpdate({ kind: 'idle', upToDate: true })).toBe('You are up to date.');
    expect(describeUpdate({ kind: 'idle', upToDate: false, lastError: 'offline' })).toBe('Last check failed: offline');
  });
});
