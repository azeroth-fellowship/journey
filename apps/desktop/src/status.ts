// SPDX-License-Identifier: GPL-3.0-only
import type { QueueState } from './queue';

export type StatusTone = 'ok' | 'retry' | 'paused';

export interface StatusView {
  tone: StatusTone;
  label: string;
  eventsWaiting: number;
  lastSync: string;
}

export const eventsWaiting = (q: QueueState): number => q.batches.reduce((n, b) => n + b.events.length, 0);

export function formatSince(iso: string | undefined, nowMs: number): string {
  if (!iso) return 'Never';
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** `retryInSeconds` is supplied by the caller (the queue does not track its next attempt). */
export function statusView(q: QueueState, lastSyncAt: string | undefined, nowMs: number, retryInSeconds: number, paused = false): StatusView {
  const waiting = eventsWaiting(q);
  const lastSync = formatSince(lastSyncAt, nowMs);
  if (paused || q.status === 'paused') return { tone: 'paused', label: 'Paused', eventsWaiting: waiting, lastSync };
  if (q.status === 'error') {
    return { tone: 'retry', label: `Retrying in ${retryInSeconds} s · ${waiting} events kept`, eventsWaiting: waiting, lastSync };
  }
  return { tone: 'ok', label: 'Up to date', eventsWaiting: waiting, lastSync };
}
