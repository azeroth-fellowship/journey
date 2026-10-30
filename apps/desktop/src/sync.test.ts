// SPDX-License-Identifier: GPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_IDS, UploadQueue, uploadedTotal } from './queue';
import { BATCH_SIZE, syncSavedVariables, type SyncApi, type SyncState, type SyncStore } from './sync';

const S = 'sess-A-B-2026-10-01T10:00:00Z';
const lua = (count: number) => `AzerothJourneyDB = {
	["events"] = {
${Array.from({ length: count }, (_, i) => `		{ ["id"] = "evt-${S}-${i + 1}", ["characterId"] = "A-B", ["sessionId"] = "${S}", ["occurredAt"] = "${new Date(Date.UTC(2026, 9, 1, 10, 0, i)).toISOString().replace('.000Z', 'Z')}", ["type"] = "location", ["payload"] = { ["zone"] = "Durotar" } },`).join('\n')}
	},
	["characters"] = { ["A-B"] = { ["name"] = "A", ["realm"] = "B", ["class"] = "MAGE", ["race"] = "Gnome" } },
}`;

describe('syncSavedVariables', () => {
  let saved: SyncState;
  let store: SyncStore;
  let api: { me: ReturnType<typeof vi.fn>; registerCharacter: ReturnType<typeof vi.fn>; upsertSession: ReturnType<typeof vi.fn> };
  let uploadBatchWithRetry: ReturnType<typeof vi.fn>;
  let queue: UploadQueue;

  const run = (text: string | string[] | Error = lua(3), deviceId = 'dev1') =>
    syncSavedVariables({
      readFiles: async () => { if (text instanceof Error) throw text; return Array.isArray(text) ? text : [text]; },
      api: api as unknown as SyncApi, queue, store, deviceId,
    });

  beforeEach(() => {
    saved = { characters: {}, sessions: {} };
    store = { load: () => structuredClone(saved), save: (s) => { saved = structuredClone(s); } };
    api = {
      me: vi.fn(async () => ({ user: { id: 'u1', travellerName: 'Wolf', createdAt: '2026-01-01T00:00:00.000Z' } })),
      registerCharacter: vi.fn(async () => {}),
      upsertSession: vi.fn(async () => {}),
    };
    uploadBatchWithRetry = vi.fn(async (req: { events: { id: string }[]; batchId: string }) => ({
      batchId: req.batchId, accepted: req.events.map((e) => e.id), duplicate: [], rejected: [], serverTime: new Date().toISOString(),
    }));
    queue = new UploadQueue({ uploadBatchWithRetry } as never, undefined, () => {});
  });

  it('registers the character, posts the session and queues the events under the scoped character id', async () => {
    const r = await run();
    expect(r).toMatchObject({ characters: 1, queued: 3, errors: [] });
    expect(api.registerCharacter).toHaveBeenCalledTimes(1);
    expect(api.registerCharacter.mock.calls[0]![0]).toMatchObject({ id: 'u1--A-B', userId: 'u1', name: 'A', class: 'mage', race: 'gnome' });
    expect(api.upsertSession).toHaveBeenCalledTimes(1);
    const batches = queue.getState().batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ characterId: 'u1--A-B' });
    expect(batches[0]!.events.map((e) => e.id)).toEqual([1, 2, 3].map((n) => `u1--evt-${S}-${n}`));
  });

  it('end to end: queued events are uploaded with the registered character id and counted as uploaded', async () => {
    await run();
    await queue.flush();
    expect(uploadBatchWithRetry).toHaveBeenCalledTimes(1);
    expect(uploadBatchWithRetry.mock.calls[0]![0]).toMatchObject({ characterId: 'u1--A-B' });
    expect(queue.getState().batches).toEqual([]);
    expect(queue.getState().uploadedEventIds).toHaveLength(3);
  });

  it('is idempotent: a second pass over the same file sends nothing, queued or uploaded', async () => {
    await run();
    expect((await run()).queued).toBe(0); // still queued, not yet uploaded
    await queue.flush();
    const again = await run();
    expect(again.queued).toBe(0);
    expect(api.registerCharacter).toHaveBeenCalledTimes(1);
    expect(api.upsertSession).toHaveBeenCalledTimes(1);
    expect(queue.getState().batches).toEqual([]);
    expect(api.me).toHaveBeenCalledTimes(1); // user id remembered
  });

  it('sends only the new events when the addon has written more, in batches', async () => {
    await run(lua(3));
    await queue.flush();
    const r = await run(lua(3 + BATCH_SIZE + 1));
    expect(r.queued).toBe(BATCH_SIZE + 1);
    expect(queue.getState().batches.map((b) => b.events.length)).toEqual([BATCH_SIZE, 1]);
    expect(api.registerCharacter).toHaveBeenCalledTimes(1); // unchanged identity is not re-registered
  });

  describe('bounded upload memory', () => {
    it('keeps a high-water mark and a short id window instead of every uploaded id', async () => {
      const n = RECENT_IDS + 60;
      await run(lua(n));
      await queue.flush();
      const s = queue.getState();
      expect(uploadedTotal(s)).toBe(n);
      expect(s.uploadedEventIds).toHaveLength(RECENT_IDS);
      expect(s.uploadedThrough?.['u1--A-B']).toMatchObject({ id: `u1--evt-${S}-${n}` });
      // old ids are no longer remembered, but the mark keeps them from being queued again
      expect(s.uploadedEventIds).not.toContain(`u1--evt-${S}-1`);
      const again = await run(lua(n));
      expect(again.queued).toBe(0);
      expect((await run(lua(n + 2))).queued).toBe(2);
    });

    it('forgetting everything re-sends once and the server de-duplicates (nothing is stored twice)', async () => {
      const serverSeen = new Set<string>();
      uploadBatchWithRetry.mockImplementation(async (req: { events: { id: string }[]; batchId: string }) => {
        const accepted: string[] = [], duplicate: string[] = [];
        for (const e of req.events) (serverSeen.has(e.id) ? duplicate : accepted).push(e.id), serverSeen.add(e.id);
        return { batchId: req.batchId, accepted, duplicate, rejected: [], serverTime: new Date().toISOString() };
      });
      await run(lua(10));
      await queue.flush();
      expect(serverSeen.size).toBe(10);

      // local memory wiped (cleared storage / new install): a fresh queue and sync state
      queue = new UploadQueue({ uploadBatchWithRetry } as never, undefined, () => {});
      saved = { characters: {}, sessions: {} };
      const r = await run(lua(12));
      expect(r.queued).toBe(12);
      await queue.flush();
      expect(serverSeen.size).toBe(12);
      expect(queue.getState().uploadedThrough?.['u1--A-B']?.id).toBe(`u1--evt-${S}-12`);
      expect((await run(lua(12))).queued).toBe(0);
    });

    it('states saved before the window existed still work', async () => {
      queue = new UploadQueue({ uploadBatchWithRetry } as never, { batches: [], status: 'idle', uploadedEventIds: [`u1--evt-${S}-1`, `u1--evt-${S}-2`] }, () => {});
      expect((await run(lua(3))).queued).toBe(1);
      expect(uploadedTotal(queue.getState())).toBe(2);
    });
  });

  it('does not queue events for a character the API would not accept, and retries next pass', async () => {
    api.registerCharacter.mockRejectedValueOnce(new Error('request failed: 503'));
    const first = await run();
    expect(first.queued).toBe(0);
    expect(first.errors[0]).toMatch(/Could not register A: .*503/);
    expect(queue.getState().batches).toEqual([]);
    expect((await run()).queued).toBe(3);
  });

  it('retries a failed session post without re-sending events', async () => {
    api.upsertSession.mockRejectedValueOnce(new Error('boom'));
    const first = await run();
    expect(first.queued).toBe(3);
    expect(first.errors).toHaveLength(1);
    const second = await run();
    expect(second.queued).toBe(0);
    expect(api.upsertSession).toHaveBeenCalledTimes(2);
    expect(second.errors).toEqual([]);
  });

  it('keeps events queued through upload failures (persistence/retry belongs to the queue)', async () => {
    uploadBatchWithRetry.mockRejectedValue(new Error('uploadBatch failed: 500'));
    await run();
    await queue.flush();
    expect(queue.getState().status).toBe('error');
    expect(queue.getState().batches[0]!.events).toHaveLength(3);
    expect((await run()).queued).toBe(0); // not duplicated while waiting
  });

  it('does not resend events the server rejected', async () => {
    uploadBatchWithRetry.mockImplementation(async (req: { events: { id: string }[]; batchId: string }) => ({
      batchId: req.batchId, accepted: [], duplicate: [], rejected: req.events.map((e) => ({ id: e.id, reason: 'character mismatch' })), serverTime: new Date().toISOString(),
    }));
    await run();
    await queue.flush();
    expect((await run()).queued).toBe(0);
  });

  it('reports unreadable files, an unidentifiable device and missing files without throwing', async () => {
    expect((await run(new Error('no WTF/Account folder'))).errors[0]).toMatch(/Could not read SavedVariables/);
    expect(await run([])).toMatchObject({ queued: 0, errors: [] });
    api.me.mockRejectedValueOnce(new Error('request failed: 401'));
    expect((await run()).errors[0]).toMatch(/identify this device/);
    expect(queue.getState().batches).toEqual([]);
  });

  it('ignores a corrupt file but still syncs a good one next to it', async () => {
    const r = await run(['AzerothJourneyDB = { events = {{{', lua(2)]);
    expect(r.queued).toBe(2);
  });

  it('starts over when the device changes (account reset)', async () => {
    await run();
    api.me.mockResolvedValueOnce({ user: { id: 'u2', travellerName: 'New', createdAt: '2026-01-01T00:00:00.000Z' } });
    const r = await run(lua(3), 'dev2');
    expect(r.queued).toBe(3);
    expect(api.registerCharacter.mock.calls[1]![0]).toMatchObject({ id: 'u2--A-B' });
  });
});
