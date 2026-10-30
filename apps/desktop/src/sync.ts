// SPDX-License-Identifier: GPL-3.0-only
import type { Character, JourneyEvent, MeResponse, Session } from '@azeroth/contracts';
import { mapSavedVariables } from './savedvars/map';
import { isSettled, type UploadQueue } from './queue';

/** Events per upload batch (the API accepts up to 5000; smaller batches retry cheaply). */
export const BATCH_SIZE = 500;

/** What has already been told to the API, so each sync only sends what changed. */
export interface SyncState {
  /** The device this state belongs to; a different device (account reset) starts from scratch. */
  deviceId?: string;
  userId?: string;
  /** character id -> signature of the last registered values */
  characters: Record<string, string>;
  /** session id -> signature of the last posted values */
  sessions: Record<string, string>;
}

export interface SyncStore {
  load(): SyncState;
  save(s: SyncState): void;
}

export interface SyncApi {
  me(): Promise<MeResponse>;
  registerCharacter(c: Character): Promise<void>;
  upsertSession(s: Session): Promise<void>;
}

export interface SyncResult {
  /** Characters seen in the file(s). */
  characters: number;
  /** Events newly queued for upload this round. */
  queued: number;
  skipped: number;
  /** Per-step failures; those steps are retried on the next round. */
  errors: string[];
}

const STORAGE_KEY = 'azeroth.syncState';

export const localSyncStore: SyncStore = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { characters: {}, sessions: {}, ...(JSON.parse(raw) as Partial<SyncState>) };
    } catch { /* corrupt: start over; the API de-duplicates */ }
    return { characters: {}, sessions: {} };
  },
  save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  },
};

const characterSignature = (c: Character) => [c.name, c.realm, c.race, c.class, c.level, c.zone].join('|');
const sessionSignature = (s: Session) => [s.endedAt, s.playtimeSeconds, s.endZone, s.endLevel].join('|');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One pass of capture -> upload: parse the addon's SavedVariables, register characters, post sessions and queue the
 * events the API has not seen. The queue (persisted, retried) does the actual upload. Safe to repeat: ids are
 * deterministic and already-known events are skipped, so overlapping or interrupted passes never double-send.
 */
export async function syncSavedVariables(deps: {
  readFiles: () => Promise<string[]>;
  api: SyncApi;
  queue: UploadQueue;
  deviceId: string;
  store?: SyncStore;
}): Promise<SyncResult> {
  const store = deps.store ?? localSyncStore;
  const result: SyncResult = { characters: 0, queued: 0, skipped: 0, errors: [] };

  let texts: string[];
  try { texts = await deps.readFiles(); }
  catch (e) { result.errors.push(`Could not read SavedVariables: ${message(e)}`); return result; }
  if (texts.length === 0) return result;

  let state = store.load();
  if (state.deviceId !== deps.deviceId) state = { deviceId: deps.deviceId, characters: {}, sessions: {} };
  if (!state.userId) {
    try { state.userId = (await deps.api.me()).user.id; }
    catch (e) { result.errors.push(`Could not identify this device: ${message(e)}`); return result; }
    store.save(state);
  }

  const mapped = mapSavedVariables(texts, state.userId);
  result.characters = mapped.characters.length;
  result.skipped = mapped.skipped;

  const q = deps.queue.getState();
  const known = new Set(q.uploadedEventIds);
  for (const b of q.batches) for (const e of b.events) known.add(e.id);

  for (const character of mapped.characters) {
    const fresh = mapped.events.filter((e) => e.characterId === character.id && !isSettled(q, e, known));
    const sessions = mapped.sessions.filter((s) => s.characterId === character.id && state.sessions[s.id] !== sessionSignature(s));
    if (fresh.length === 0 && sessions.length === 0 && state.characters[character.id]) continue;

    try {
      if (state.characters[character.id] !== characterSignature(character)) {
        await deps.api.registerCharacter(character);
        state.characters[character.id] = characterSignature(character);
      }
    } catch (e) {
      result.errors.push(`Could not register ${character.name}: ${message(e)}`);
      continue; // no character, no upload: the API would refuse the batch
    }
    for (const s of sessions) {
      try {
        await deps.api.upsertSession(s);
        state.sessions[s.id] = sessionSignature(s);
      } catch (e) {
        result.errors.push(`Could not save a session of ${character.name}: ${message(e)}`);
      }
    }
    for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
      deps.queue.enqueue(character.id, fresh.slice(i, i + BATCH_SIZE) as JourneyEvent[]);
    }
    result.queued += fresh.length;
    store.save(state);
  }
  store.save(state);
  return result;
}
