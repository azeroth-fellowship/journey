// SPDX-License-Identifier: GPL-3.0-only
import type { JourneyEvent, UploadBatchResponse } from '@azeroth/contracts';
import { ApiClient } from '@azeroth/api-client';

export type UploadStatus = 'idle' | 'uploading' | 'error' | 'paused';

export interface QueuedBatch {
  batchId: string;
  characterId: string;
  events: JourneyEvent[];
  attempts: number;
  lastError?: string;
  createdAt: string;
}

export interface QueueState {
  batches: QueuedBatch[];
  status: UploadStatus;
  /** The most recent uploaded event ids only (a window of RECENT_IDS); older ones are covered by `uploadedThrough`. */
  uploadedEventIds: string[];
  /** Events uploaded over the device's lifetime (absent in states saved before the window existed). */
  uploadedCount?: number;
  /** Per character: the latest event (by time) the API has settled. Older events are not queued again. */
  uploadedThrough?: Record<string, UploadMark>;
}

export interface UploadMark {
  /** `occurredAt` of the newest settled event. */
  at: string;
  id: string;
}

/** How many recent event ids are remembered exactly (covers events sharing the mark's timestamp). */
export const RECENT_IDS = 200;

export const uploadedTotal = (s: QueueState): number => s.uploadedCount ?? s.uploadedEventIds.length;

/**
 * Whether sync may skip an event: it is among the recent ids, or strictly older than the character's mark.
 * Anything else is (re)sent; the API de-duplicates by event id, so forgetting costs bandwidth, never correctness.
 */
export function isSettled(s: QueueState, e: { id: string; characterId: string; occurredAt: string }, recent: ReadonlySet<string>): boolean {
  if (recent.has(e.id)) return true;
  const mark = s.uploadedThrough?.[e.characterId];
  return !!mark && Date.parse(e.occurredAt) < Date.parse(mark.at);
}

const STORAGE_KEY = 'azeroth.uploadQueue';

export class UploadQueue {
  private state: QueueState;
  private client: ApiClient;
  private persist: (s: QueueState) => void;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(client: ApiClient, initial?: QueueState, persist?: (s: QueueState) => void) {
    this.client = client;
    this.state = initial ?? { batches: [], status: 'idle', uploadedEventIds: [] };
    this.persist = persist ?? ((s) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    });
  }

  static load(client: ApiClient): UploadQueue {
    let initial: QueueState | undefined;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) initial = JSON.parse(raw) as QueueState;
    } catch { /* ignore */ }
    return new UploadQueue(client, initial);
  }

  getState(): QueueState {
    return this.state;
  }

  pause(): void { this.state.status = 'paused'; this.persistState(); }
  resume(): void { if (this.state.status === 'paused') this.state.status = 'idle'; this.persistState(); }

  enqueue(characterId: string, events: JourneyEvent[]): string {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const batch: QueuedBatch = {
      batchId,
      characterId,
      events,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    this.state.batches.push(batch);
    this.persistState();
    return batchId;
  }

  private persistState(): void {
    this.persist(this.state);
  }

  async flush(): Promise<void> {
    if (this.state.status === 'paused' || this.state.status === 'uploading') return;
    this.state.status = 'uploading';
    this.persistState();

    const remaining: QueuedBatch[] = [];
    for (const batch of this.state.batches) {
      try {
        const res: UploadBatchResponse = await this.client.uploadBatchWithRetry(
          { batchId: batch.batchId, characterId: batch.characterId, events: batch.events, sentAt: new Date().toISOString() },
          { maxAttempts: 3, baseDelayMs: 5 },
        );
        batch.attempts++;
        // Rejected events will never be accepted; counting them as done stops the next sync from re-queuing them forever.
        const uploaded = [...res.accepted, ...res.duplicate, ...res.rejected.map((r) => r.id)];
        const settled = new Set(uploaded);
        this.state.uploadedCount = uploadedTotal(this.state) + settled.size;
        this.state.uploadedEventIds = [...new Set([...this.state.uploadedEventIds, ...uploaded])].slice(-RECENT_IDS);
        const through = (this.state.uploadedThrough ??= {});
        for (const e of batch.events) {
          if (!settled.has(e.id)) continue;
          const mark = through[batch.characterId];
          if (!mark || Date.parse(e.occurredAt) >= Date.parse(mark.at)) through[batch.characterId] = { at: e.occurredAt, id: e.id };
        }
      } catch (err) {
        batch.attempts++;
        batch.lastError = err instanceof Error ? err.message : String(err);
        remaining.push(batch);
      }
    }
    this.state.batches = remaining;
    // pause() may have been called mid-flush; don't clobber it.
    if (this.state.status === 'uploading') this.state.status = remaining.length > 0 ? 'error' : 'idle';
    this.persistState();
  }

  startAutoFlush(intervalMs = 10000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, intervalMs);
  }

  stopAutoFlush(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}