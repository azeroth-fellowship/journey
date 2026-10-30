// SPDX-License-Identifier: GPL-3.0-only
import { JourneyEvent, type Character, type CharacterClass, type CharacterRace, type Session } from '@azeroth/contracts';
import { luaArray, parseLuaFile, type LuaTable, type LuaValue } from './lua';

/** Name of the global the addon saves (apps/addon/src/main.wowlua). */
export const SAVED_VARIABLE = 'AzerothJourneyDB';

// WoW class/race tokens (UnitClass / UnitRace second return) -> contract enums.
const CLASSES: Record<string, CharacterClass> = {
  WARRIOR: 'warrior', PALADIN: 'paladin', HUNTER: 'hunter', ROGUE: 'rogue', PRIEST: 'priest', SHAMAN: 'shaman',
  MAGE: 'mage', WARLOCK: 'warlock', MONK: 'monk', DRUID: 'druid', DEATHKNIGHT: 'death_knight',
};
const RACES: Record<string, CharacterRace> = {
  Human: 'human', Orc: 'orc', Dwarf: 'dwarf', NightElf: 'night_elf', Scourge: 'undead', Tauren: 'tauren',
  Gnome: 'gnome', Troll: 'troll', BloodElf: 'blood_elf', Draenei: 'draenei',
};
// The API requires a class and race. The contract lists only those above, so anything else (or an addon build that
// does not record them yet) is registered with these placeholders; the journey itself is unaffected.
const FALLBACK_CLASS: CharacterClass = 'warrior';
const FALLBACK_RACE: CharacterRace = 'human';

export interface Mapped {
  characters: Character[];
  /** Valid, de-duplicated by id, oldest first. */
  events: JourneyEvent[];
  sessions: Session[];
  /** Entries that were not usable events (wrong shape, unknown type); never uploaded. */
  skipped: number;
  /** A file ended mid-way; its last event was dropped as possibly incomplete. */
  truncated: boolean;
}

/**
 * The addon identifies a character as "Name-Realm" and ids events/sessions from that, which two players could share.
 * The API's ids are global, so every id is prefixed with the owning user's id. This is deterministic, so re-reading
 * the same file always yields the same ids (that is what makes de-duplication and retries safe).
 */
export const scoped = (userId: string, id: string): string => `${userId}--${id}`;

const isTable = (v: LuaValue | undefined): v is LuaTable => typeof v === 'object' && v !== null;
const str = (v: LuaValue | undefined): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Drops nils and out-of-range coordinates so one bad field does not cost the whole event. */
function cleanPayload(type: string, raw: LuaValue | undefined): Record<string, LuaValue> {
  const out: Record<string, LuaValue> = {};
  if (isTable(raw)) for (const [k, v] of Object.entries(raw)) if (v !== null && v !== undefined) out[k] = v;
  if (type === 'location') {
    for (const axis of ['x', 'y']) {
      const v = out[axis];
      if (v !== undefined && (typeof v !== 'number' || v < 0 || v > 1)) delete out[axis];
    }
    if (out.x === 0 && out.y === 0) { delete out.x; delete out.y; } // GetPlayerMapPosition's "no position"
  }
  // Ids the contract wants as strings; a numeric one (instance id, encounter id) must not cost the event.
  for (const k of ['questId', 'dungeonId', 'encounterId']) if (typeof out[k] === 'number') out[k] = String(out[k]);
  return out;
}

function toEvent(userId: string, raw: LuaValue): JourneyEvent | undefined {
  if (!isTable(raw)) return undefined;
  const id = str(raw.id), characterId = str(raw.characterId), sessionId = str(raw.sessionId), type = str(raw.type);
  if (!id || !characterId || !sessionId || !type) return undefined;
  const parsed = JourneyEvent.safeParse({
    id: scoped(userId, id),
    characterId: scoped(userId, characterId),
    sessionId: scoped(userId, sessionId),
    occurredAt: raw.occurredAt,
    type,
    source: 'addon',
    payload: cleanPayload(type, raw.payload),
  });
  return parsed.success ? parsed.data : undefined;
}

const byTime = (a: { occurredAt: string }, b: { occurredAt: string }) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt);

function levelOf(e: JourneyEvent): number | undefined {
  if (e.type === 'level_up') return e.payload.toLevel;
  if (e.type === 'session_started' || e.type === 'session_ended') return e.payload.level;
  return undefined;
}
function zoneOf(e: JourneyEvent): string | undefined {
  if (e.type === 'zone_changed') return e.payload.toZone;
  if (e.type === 'location' || e.type === 'session_started' || e.type === 'session_ended') return e.payload.zone;
  return undefined;
}
function lastDefined<T>(events: JourneyEvent[], pick: (e: JourneyEvent) => T | undefined): T | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const v = pick(events[i]!);
    if (v !== undefined) return v;
  }
  return undefined;
}

function buildSessions(events: JourneyEvent[]): Session[] {
  const groups = new Map<string, JourneyEvent[]>();
  for (const e of events) groups.set(e.sessionId, [...(groups.get(e.sessionId) ?? []), e]);
  return [...groups].map(([id, evs]) => {
    const start = evs.find((e) => e.type === 'session_started');
    const end = evs.find((e) => e.type === 'session_ended');
    const startedAt = (start ?? evs[0]!).occurredAt;
    const session: Session = { id, characterId: evs[0]!.characterId, startedAt };
    if (end) {
      session.endedAt = end.occurredAt;
      const secs = Math.round((Date.parse(end.occurredAt) - Date.parse(startedAt)) / 1000);
      if (secs >= 0) session.playtimeSeconds = secs;
    }
    const startZone = start && zoneOf(start);
    const endZone = end && zoneOf(end);
    const startLevel = start && levelOf(start);
    const endLevel = lastDefined(evs, levelOf);
    if (startZone) session.startZone = startZone;
    if (endZone) session.endZone = endZone;
    if (startLevel) session.startLevel = startLevel;
    if (endLevel) session.endLevel = endLevel;
    return session;
  });
}

function buildCharacter(userId: string, key: string, events: JourneyEvent[], meta: LuaTable | undefined): Character {
  const dash = key.indexOf('-'); // names never contain '-', realm names can
  const name = str(meta?.name) ?? (dash > 0 ? key.slice(0, dash) : key);
  const realm = str(meta?.realm) ?? (dash > 0 ? key.slice(dash + 1) : undefined);
  const metaLevel = typeof meta?.level === 'number' ? meta.level : 1;
  const level = Math.min(80, Math.max(1, Math.trunc(lastDefined(events, levelOf) ?? metaLevel)));
  const zone = lastDefined(events, zoneOf);
  const first = events[0]?.occurredAt ?? new Date(0).toISOString();
  const last = events[events.length - 1]?.occurredAt ?? first;
  const c: Character = {
    id: scoped(userId, key),
    userId,
    name,
    race: RACES[str(meta?.race) ?? ''] ?? FALLBACK_RACE,
    class: CLASSES[(str(meta?.class) ?? '').toUpperCase()] ?? FALLBACK_CLASS,
    level,
    visibility: 'private',
    createdAt: first,
    updatedAt: last,
    lastSeenAt: last,
  };
  if (realm) c.realm = realm;
  if (zone) c.zone = zone;
  return c;
}

/** SavedVariables file texts -> what to register and upload. Never throws on bad input. */
export function mapSavedVariables(texts: string[], userId: string): Mapped {
  const events = new Map<string, JourneyEvent>();
  const meta = new Map<string, LuaTable>();
  let skipped = 0;
  let truncated = false;

  for (const text of texts) {
    const file = parseLuaFile(text);
    const db = file.globals[SAVED_VARIABLE];
    if (!isTable(db)) continue;
    let raws = luaArray(db.events);
    if (file.truncated) { truncated = true; raws = raws.slice(0, -1); }
    for (const raw of raws) {
      const e = toEvent(userId, raw);
      if (!e) { skipped++; continue; }
      if (!events.has(e.id)) events.set(e.id, e);
    }
    if (isTable(db.characters)) for (const [k, v] of Object.entries(db.characters)) if (isTable(v)) meta.set(k, v);
  }

  const sorted = [...events.values()].sort(byTime);
  const perChar = new Map<string, JourneyEvent[]>();
  for (const e of sorted) perChar.set(e.characterId, [...(perChar.get(e.characterId) ?? []), e]);
  const prefix = scoped(userId, '');
  const characters = [...perChar].map(([id, evs]) => {
    const key = id.slice(prefix.length);
    return buildCharacter(userId, key, evs, meta.get(key));
  });
  return { characters, events: sorted, sessions: buildSessions(sorted), skipped, truncated };
}
