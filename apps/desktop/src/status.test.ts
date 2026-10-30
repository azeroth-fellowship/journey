// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { QueueState } from './queue';
import { formatSince, statusView } from './status';

const ev = { id: 'e' } as never;
const q = (status: QueueState['status'], counts: number[] = []): QueueState => ({
  status,
  uploadedEventIds: [],
  batches: counts.map((n, i) => ({
    batchId: `b${i}`,
    characterId: 'c',
    events: Array.from({ length: n }, () => ev),
    attempts: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  })),
});
const now = Date.parse('2026-01-01T01:00:00.000Z');

describe('statusView', () => {
  it('up to date', () => {
    expect(statusView(q('idle'), undefined, now, 30)).toMatchObject({ tone: 'ok', label: 'Up to date', eventsWaiting: 0, lastSync: 'Never' });
  });
  it('retrying counts events across batches', () => {
    expect(statusView(q('error', [5, 7]), '2026-01-01T00:58:00.000Z', now, 30)).toMatchObject({
      tone: 'retry',
      label: 'Retrying in 30 s · 12 events kept',
      lastSync: '2 min ago',
    });
  });
  it('paused flag wins over queue state', () => {
    expect(statusView(q('error', [3]), undefined, now, 30, true)).toMatchObject({ tone: 'paused', label: 'Paused', eventsWaiting: 3 });
  });
  it('paused', () => {
    expect(statusView(q('paused', [1]), undefined, now, 30)).toMatchObject({ tone: 'paused', label: 'Paused', eventsWaiting: 1 });
  });
});

describe('formatSince', () => {
  it('buckets', () => {
    expect(formatSince('2026-01-01T00:59:40.000Z', now)).toBe('Just now');
    expect(formatSince('2026-01-01T00:00:00.000Z', now)).toBe('1 h ago');
    expect(formatSince('2025-12-30T01:00:00.000Z', now)).toBe('2 d ago');
  });
});
