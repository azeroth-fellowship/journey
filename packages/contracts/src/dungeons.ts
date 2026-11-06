// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';
import { CharacterClass, CharacterRace } from './characters';
import { InstanceKind, type JourneyEvent } from './events';
import foreverInstances from './data/forever-dungeons.json';

// ---------------------------------------------------------------------------
// Dungeon catalog
// ---------------------------------------------------------------------------

export interface CatalogQuest {
  questId: string;
  title: string;
  /** Minimum level to take the quest; null when unknown. */
  minLevel: number | null;
  faction: 'alliance' | 'horde' | 'both';
}

export interface DungeonCatalogEntry {
  name: string;
  /** "raid" for raids; absent or "dungeon" for 5-man instances. */
  kind?: InstanceKind;
  /** Names (as the client reports them in boss_killed.bossName) of the encounters that end the dungeon. Killing any one completes it. */
  finalBossNames?: string[];
  minLevel?: number;
  /** Wowhead's WoW: Forever zone id. Not the client's instance id. */
  wowheadZoneId?: number;
  /** Quests Wowhead files under this instance. May be empty while Wowhead has none. */
  quests?: CatalogQuest[];
}

/** dungeonId -> entry. Ids are the ones the addon emits (see apps/addon/src/main.wowlua, `dungeonIdOf`). */
export type DungeonCatalog = Record<string, DungeonCatalogEntry>;

/** One instance as stored in data/forever-dungeons.json (scraped from Wowhead's WoW: Forever pages). */
export interface ForeverInstance {
  id: string;
  wowheadZoneId: number;
  altWowheadZoneIds?: number[];
  /** The client's instance id (GetInstanceInfo, 8th result); null while not yet known. */
  instanceId: number | null;
  name: string;
  kind: InstanceKind;
  levelRange: [number, number] | null;
  players: number | null;
  quests: CatalogQuest[];
}

export const FOREVER_INSTANCES: readonly ForeverInstance[] = foreverInstances.dungeons as unknown as ForeverInstance[];

/** Same slug the addon uses for its "name:<slug>" fallback id, so instances without a known instance id still match. */
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');

/** The id the addon emits for an instance: its numeric instance id, else "name:<slug>". */
export function dungeonIdFor(i: Pick<ForeverInstance, 'instanceId' | 'name'>): string {
  return i.instanceId ? String(i.instanceId) : `name:${slug(i.name)}`;
}

/**
 * Built from data/forever-dungeons.json. Final bosses are still unknown, so "completed" comes from a dungeon_completed
 * event until `finalBossNames` is filled in. Entries whose instance id is not known yet are keyed "name:<slug>",
 * which is what the addon emits when the client gives no id; re-key them once the real ids have been seen in game.
 */
export const DUNGEON_CATALOG: DungeonCatalog = Object.fromEntries(
  FOREVER_INSTANCES.map((i): [string, DungeonCatalogEntry] => [
    dungeonIdFor(i),
    { name: i.name, kind: i.kind, ...(i.levelRange ? { minLevel: i.levelRange[0] } : {}), wowheadZoneId: i.wowheadZoneId, quests: i.quests },
  ]),
);

/** Every quest id the catalog lists, so a store can fetch quest turn-ins that carry no dungeon tag. */
export const CATALOG_QUEST_IDS: readonly string[] = [
  ...new Set(Object.values(DUNGEON_CATALOG).flatMap((d) => (d.quests ?? []).map((q) => q.questId))),
];

/** Horde races; every other race is Alliance. */
const HORDE_RACES: ReadonlySet<string> = new Set(['orc', 'undead', 'tauren', 'troll', 'blood_elf']);

export function factionOfRace(race: string): 'alliance' | 'horde' {
  return HORDE_RACES.has(race) ? 'horde' : 'alliance';
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const DungeonQuest = z.object({ questId: z.string().min(1), title: z.string().min(1) });

/** What one character has done in one dungeon, derived from its events. */
export const DungeonProgress = z.object({
  dungeonId: z.string().min(1),
  dungeonName: z.string().min(1),
  /** Raids are shown apart from dungeons; absent (older data) means dungeon. */
  kind: InstanceKind.optional(),
  /** dungeon_entered events. */
  runs: z.number().int().nonnegative(),
  /** dungeon_completed events (explicit signal from the client). */
  completions: z.number().int().nonnegative(),
  /** Newest event of any dungeon-related type for this dungeon. */
  lastVisitedAt: IsoTimestamp,
  /** Distinct boss names, in order of first kill. */
  bossesKilled: z.array(z.string().min(1)),
  /** Distinct quests turned in inside the dungeon, in order of first completion. */
  questsCompleted: z.array(DungeonQuest),
  completed: z.boolean(),
});

/** GET /v1/characters/:id/dungeons */
export const DungeonProgressResponse = z.object({
  characterId: Id,
  dungeons: z.array(DungeonProgress),
});

export type DungeonQuest = z.infer<typeof DungeonQuest>;
export type DungeonProgress = z.infer<typeof DungeonProgress>;
export type DungeonProgressResponse = z.infer<typeof DungeonProgressResponse>;

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Completed = the client said so (a dungeon_completed event) OR the catalog knows the dungeon's final bosses and
 * one of them was killed. Pure; the catalog defaults to DUNGEON_CATALOG.
 */
export function isDungeonCompleted(
  progress: Pick<DungeonProgress, 'dungeonId' | 'bossesKilled' | 'completions'>,
  catalog: DungeonCatalog = DUNGEON_CATALOG,
): boolean {
  if (progress.completions > 0) return true;
  const finals = catalog[progress.dungeonId]?.finalBossNames;
  if (!finals?.length) return false;
  const killed = new Set(progress.bossesKilled.map(norm));
  return finals.some((b) => killed.has(norm(b)));
}

/**
 * Raids are recorded and counted but not shown anywhere yet (they are not released). Flip to true to show them: the
 * web timeline, the Raids filter, the character page's Raids section and the public journey all read this.
 */
export const RAIDS_VISIBLE = false;

/** A dungeon progress row for a raid: its own kind, else what the catalog says. */
export function isRaidProgress(d: Pick<DungeonProgress, 'dungeonId' | 'kind'>, catalog: DungeonCatalog = DUNGEON_CATALOG): boolean {
  return (d.kind ?? catalog[d.dungeonId]?.kind) === 'raid';
}

/** The progress rows that may be shown: all of them, or without raids while RAIDS_VISIBLE is false. */
export function visibleDungeons<T extends Pick<DungeonProgress, 'dungeonId' | 'kind'>>(list: readonly T[], showRaids: boolean = RAIDS_VISIBLE): T[] {
  return showRaids ? [...list] : list.filter((d) => !isRaidProgress(d));
}

/** raid_* events, and boss kills inside a raid. */
export function isRaidEvent(e: JourneyEvent): boolean {
  if (e.type === 'raid_entered' || e.type === 'raid_left' || e.type === 'raid_completed') return true;
  return e.type === 'boss_killed' && e.payload.instanceKind === 'raid';
}

/** Event types buildDungeonProgress reads. Untagged quest_completed events count by quest id. */
export const DUNGEON_EVENT_TYPES = [
  'dungeon_entered', 'dungeon_left', 'dungeon_completed',
  'raid_entered', 'raid_left', 'raid_completed',
  'boss_killed', 'quest_completed',
] as const;

/**
 * Folds a character's events (any order) into per-dungeon progress, newest-visited dungeon first.
 * Events without a dungeonId and other event types are ignored.
 */
export function buildDungeonProgress(events: readonly JourneyEvent[], catalog: DungeonCatalog = DUNGEON_CATALOG): DungeonProgress[] {
  const byId = new Map<string, DungeonProgress>();
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  // Quests are usually handed in at a quest giver outside the instance, so they carry no dungeonId. They are
  // attributed by quest id to the catalog dungeons the character has visited.
  const untaggedQuests: { questId: string; title: string }[] = [];
  for (const e of ordered) {
    if (e.type === 'quest_completed' && !e.payload.dungeonId) {
      untaggedQuests.push({ questId: e.payload.questId, title: e.payload.questName });
      continue;
    }
    if (
      e.type !== 'dungeon_entered' && e.type !== 'dungeon_left' && e.type !== 'dungeon_completed' &&
      e.type !== 'raid_entered' && e.type !== 'raid_left' && e.type !== 'raid_completed' &&
      e.type !== 'boss_killed' && e.type !== 'quest_completed'
    ) continue;
    const p = e.payload;
    const raidEvent = e.type === 'raid_entered' || e.type === 'raid_left' || e.type === 'raid_completed';
    if (!p.dungeonId) continue;
    const name = p.dungeonName ?? catalog[p.dungeonId]?.name;
    let d = byId.get(p.dungeonId);
    if (!d) {
      d = { dungeonId: p.dungeonId, dungeonName: name ?? p.dungeonId, kind: raidEvent ? 'raid' : (p.instanceKind ?? catalog[p.dungeonId]?.kind ?? 'dungeon'), runs: 0, completions: 0, lastVisitedAt: e.occurredAt, bossesKilled: [], questsCompleted: [], completed: false };
      byId.set(p.dungeonId, d);
    }
    if (name) d.dungeonName = name;
    if (raidEvent) d.kind = 'raid';
    else if (p.instanceKind) d.kind = p.instanceKind;
    d.lastVisitedAt = e.occurredAt;
    if (e.type === 'dungeon_entered' || e.type === 'raid_entered') d.runs++;
    else if (e.type === 'dungeon_completed' || e.type === 'raid_completed') d.completions++;
    else if (e.type === 'boss_killed') {
      if (!d.bossesKilled.some((b) => norm(b) === norm(e.payload.bossName))) d.bossesKilled.push(e.payload.bossName);
    } else if (e.type === 'quest_completed') {
      if (!d.questsCompleted.some((q) => q.questId === e.payload.questId)) d.questsCompleted.push({ questId: e.payload.questId, title: e.payload.questName });
    }
  }
  if (untaggedQuests.length > 0) {
    for (const [dungeonId, d] of byId) {
      const listed = new Set((catalog[dungeonId]?.quests ?? []).map((q) => q.questId));
      for (const q of untaggedQuests) {
        if (listed.has(q.questId) && !d.questsCompleted.some((x) => x.questId === q.questId)) d.questsCompleted.push(q);
      }
    }
  }
  return [...byId.values()]
    // one canonical timestamp format, whatever the store hands back
    .map((d) => ({ ...d, lastVisitedAt: new Date(d.lastVisitedAt).toISOString(), completed: isDungeonCompleted(d, catalog) }))
    .sort((a, b) => Date.parse(b.lastVisitedAt) - Date.parse(a.lastVisitedAt) || a.dungeonName.localeCompare(b.dungeonName));
}

/** One catalog quest and whether the character has turned it in. */
export interface DungeonQuestStatus extends CatalogQuest {
  done: boolean;
}

/**
 * Every quest the catalog lists for a dungeon, each marked done when the character's events show it turned in
 * (anywhere, not only inside the dungeon: a quest id is a quest id). Empty for a dungeon the catalog does not know.
 */
export function dungeonQuestStatus(
  dungeonId: string,
  completedQuestIds: Iterable<string>,
  catalog: DungeonCatalog = DUNGEON_CATALOG,
  /** When given, quests for the other faction are left out. */
  faction?: 'alliance' | 'horde',
): DungeonQuestStatus[] {
  const done = new Set(completedQuestIds);
  return (catalog[dungeonId]?.quests ?? [])
    .filter((q) => !faction || q.faction === 'both' || q.faction === faction)
    .map((q) => ({ ...q, done: done.has(q.questId) }));
}

/** Ids of every quest a character has turned in, from its events (any dungeon or none). */
export function completedQuestIds(events: readonly JourneyEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) if (e.type === 'quest_completed') ids.add(e.payload.questId);
  return ids;
}

// ---------------------------------------------------------------------------
// Friends: "who can take me through this dungeon"
// ---------------------------------------------------------------------------

/** One friend character the caller holds view_history on, and what it has done in the asked-for dungeon (null = nothing recorded). */
export const FriendDungeonCharacter = z.object({
  id: Id,
  name: z.string().min(1),
  class: CharacterClass,
  race: CharacterRace,
  level: z.number().int().min(1).max(80),
  progress: DungeonProgress.nullable(),
});

export const FriendDungeonFriend = z.object({
  userId: Id,
  travellerName: z.string(),
  /** Only characters with view_history for the caller; empty means nothing shared. */
  characters: z.array(FriendDungeonCharacter),
});

/** GET /v1/friends/dungeons?dungeonId= */
export const FriendDungeonsResponse = z.object({
  dungeonId: z.string().min(1),
  friends: z.array(FriendDungeonFriend),
});

export const DungeonIndexEntry = z.object({
  dungeonId: z.string().min(1),
  dungeonName: z.string().min(1),
  /** The caller has progress in it. */
  mine: z.boolean(),
  /** How many visible friend characters have progress in it. */
  friendCharacters: z.number().int().nonnegative(),
});

/** GET /v1/friends/dungeons/index : dungeons known across the caller's own and friends' visible characters. */
export const DungeonIndexResponse = z.object({ dungeons: z.array(DungeonIndexEntry) });

export type FriendDungeonCharacter = z.infer<typeof FriendDungeonCharacter>;
export type FriendDungeonFriend = z.infer<typeof FriendDungeonFriend>;
export type FriendDungeonsResponse = z.infer<typeof FriendDungeonsResponse>;
export type DungeonIndexEntry = z.infer<typeof DungeonIndexEntry>;
export type DungeonIndexResponse = z.infer<typeof DungeonIndexResponse>;
