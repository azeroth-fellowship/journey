// SPDX-License-Identifier: GPL-3.0-only
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UploadQueue } from './queue';
import type { JourneyEvent } from '@azeroth/contracts';

const ev = (id: string): JourneyEvent => ({
  id,
  characterId: 'c1',
  sessionId: 's1',
  occurredAt: '2026-10-01T00:00:00.000Z',
  type: 'location',
  payload: { zone: 'Stormwind' },
} as JourneyEvent);

describe('UploadQueue', () => {
  let persisted: any;
  let client: any;

  beforeEach(() => {
    persisted = null;
    client = { uploadBatchWithRetry: vi.fn() };
  });

  it('enqueues and persists', () => {
    const q = new UploadQueue(client, undefined, (s) => { persisted = s; });
    const id = q.enqueue('c1', [ev('e1'), ev('e2')]);
    expect(id).toBeTruthy();
    expect(q.getState().batches.length).toBe(1);
    expect(persisted.batches.length).toBe(1);
  });

  it('flush uploads and clears on success', async () => {
    client.uploadBatchWithRetry.mockResolvedValue({ batchId: 'b', accepted: ['e1', 'e2'], duplicate: [], rejected: [], serverTime: new Date().toISOString() });
    const q = new UploadQueue(client, undefined, () => {});
    q.enqueue('c1', [ev('e1'), ev('e2')]);
    await q.flush();
    expect(q.getState().batches.length).toBe(0);
    expect(q.getState().uploadedEventIds).toContain('e1');
    expect(q.getState().status).toBe('idle');
  });

  it('keeps batch on failure and marks error', async () => {
    client.uploadBatchWithRetry.mockRejectedValue(new Error('network down'));
    const q = new UploadQueue(client, undefined, () => {});
    q.enqueue('c1', [ev('e1')]);
    await q.flush();
    expect(q.getState().batches.length).toBe(1);
    expect(q.getState().batches[0]!.lastError).toBe('network down');
    expect(q.getState().status).toBe('error');
  });

  it('respects pause', async () => {
    const q = new UploadQueue(client, undefined, () => {});
    q.enqueue('c1', [ev('e1')]);
    q.pause();
    await q.flush();
    expect(client.uploadBatchWithRetry).not.toHaveBeenCalled();
    expect(q.getState().status).toBe('paused');
  });

  it('dedups uploaded ids across batches', async () => {
    client.uploadBatchWithRetry.mockResolvedValue({ batchId: 'b', accepted: ['e1'], duplicate: ['e2'], rejected: [], serverTime: new Date().toISOString() });
    const q = new UploadQueue(client, undefined, () => {});
    q.enqueue('c1', [ev('e1'), ev('e2')]);
    await q.flush();
    expect(new Set(q.getState().uploadedEventIds)).toEqual(new Set(['e1', 'e2']));
  });

  it('restores from persisted state', () => {
    const initial = { batches: [{ batchId: 'b0', characterId: 'c1', events: [ev('e9')], attempts: 1, createdAt: new Date().toISOString() }], status: 'error' as const, uploadedEventIds: [] };
    const q = new UploadQueue(client, initial, () => {});
    expect(q.getState().batches.length).toBe(1);
    expect(q.getState().status).toBe('error');
  });
});