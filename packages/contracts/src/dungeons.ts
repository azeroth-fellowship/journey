// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';
import { CharacterClass, CharacterRace } from './characters';
import type { JourneyEvent } from './events';

// ---------------------------------------------------------------------------
// Dungeon catalog
// ---------------------------------------------------------------------------

export interface DungeonCatalogEntry {
  name: string;
  /** Names (as the client reports them in boss_killed.bossName) of the encounters that end the dungeon. Killing any one completes it. */
  finalBossNames?: string[];
  minLevel?: number;
}

/** dungeonId -> entry. Ids are the ones the addon emits (see apps/addon/src/main.wowlua, `dungeonIdOf`). */
export type DungeonCatalog = Record<string, DungeonCatalogEntry>;

/**
 * Intentionally EMPTY. WoW Forever's instance list, instance ids and boss names are not known until the client
 * releases (2026-11-04); filling this table (id -> name, final bosses, level) then is what makes "completed"
 * derivable without an explicit dungeon_completed event. Until then a dungeon counts as completed only when a
 * dungeon_completed event exists.
 */
export const DUNGEON_CATALOG: DungeonCatalog = {};

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const DungeonQuest = z.object({ questId: z.string().min(1), title: z.string().min(1) });

/** What one character has done in one dungeon, derived from its events. */
export const DungeonProgress = z.object({
  dungeonId: z.string().min(1),
  dungeonName: z.string().min(1),
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

/** Event types buildDungeonProgress reads (quest_completed only when it carries a dungeonId). */
export const DUNGEON_EVENT_TYPES = ['dungeon_entered', 'dungeon_left', 'boss_killed', 'dungeon_completed', 'quest_completed'] as const;

/**
 * Folds a character's events (any order) into per-dungeon progress, newest-visited dungeon first.
 * Events without a dungeonId and other event types are ignored.
 */
export function buildDungeonProgress(events: readonly JourneyEvent[], catalog: DungeonCatalog = DUNGEON_CATALOG): DungeonProgress[] {
  const byId = new Map<string, DungeonProgress>();
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const e of ordered) {
    if (e.type !== 'dungeon_entered' && e.type !== 'dungeon_left' && e.type !== 'boss_killed' && e.type !== 'dungeon_completed' && e.type !== 'quest_completed') continue;
    const p = e.payload;
    if (!p.dungeonId) continue;
    const name = p.dungeonName ?? catalog[p.dungeonId]?.name;
    let d = byId.get(p.dungeonId);
    if (!d) {
      d = { dungeonId: p.dungeonId, dungeonName: name ?? p.dungeonId, runs: 0, completions: 0, lastVisitedAt: e.occurredAt, bossesKilled: [], questsCompleted: [], completed: false };
      byId.set(p.dungeonId, d);
    }
    if (name) d.dungeonName = name;
    d.lastVisitedAt = e.occurredAt;
    if (e.type === 'dungeon_entered') d.runs++;
    else if (e.type === 'dungeon_completed') d.completions++;
    else if (e.type === 'boss_killed') {
      if (!d.bossesKilled.some((b) => norm(b) === norm(e.payload.bossName))) d.bossesKilled.push(e.payload.bossName);
    } else if (e.type === 'quest_completed') {
      if (!d.questsCompleted.some((q) => q.questId === e.payload.questId)) d.questsCompleted.push({ questId: e.payload.questId, title: e.payload.questName });
    }
  }
  return [...byId.values()]
    // one canonical timestamp format, whatever the store hands back
    .map((d) => ({ ...d, lastVisitedAt: new Date(d.lastVisitedAt).toISOString(), completed: isDungeonCompleted(d, catalog) }))
    .sort((a, b) => Date.parse(b.lastVisitedAt) - Date.parse(a.lastVisitedAt) || a.dungeonName.localeCompare(b.dungeonName));
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
