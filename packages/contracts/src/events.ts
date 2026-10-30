// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp, EventSource } from './common';

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export const SessionStartedPayload = z.object({
  zone: z.string().min(1).optional(),
  level: z.number().int().min(1).max(80).optional(),
});

export const SessionEndedPayload = z.object({
  reason: z.enum(['logout', 'disconnect', 'timeout', 'manual']).optional(),
  playtimeSeconds: z.number().int().nonnegative().optional(),
  zone: z.string().min(1).optional(),
  level: z.number().int().min(1).max(80).optional(),
});

export const LevelUpPayload = z.object({
  fromLevel: z.number().int().min(1).max(80),
  toLevel: z.number().int().min(1).max(80),
  zone: z.string().min(1).optional(),
});

export const QuestCompletedPayload = z.object({
  questId: z.string().min(1),
  questName: z.string().min(1),
  zone: z.string().min(1).optional(),
  xpGained: z.number().int().nonnegative().optional(),
  /** Set when the quest was turned in while inside an instance (same id scheme as dungeon_entered). */
  dungeonId: z.string().min(1).optional(),
  dungeonName: z.string().min(1).optional(),
});

export const ZoneChangedPayload = z.object({
  fromZone: z.string().min(1).optional(),
  toZone: z.string().min(1),
});

export const LocationPayload = z.object({
  zone: z.string().min(1),
  /** Normalized 0..1 position within `zone` (left to right), as from GetPlayerMapPosition. */
  x: z.number().min(0).max(1).optional(),
  /** Normalized 0..1 position within `zone` (top to bottom). */
  y: z.number().min(0).max(1).optional(),
  /** @deprecated Unused legacy field; positions are zone-local. Kept so old events still parse. */
  mapId: z.number().int().optional(),
});

export const DungeonEnteredPayload = z.object({
  dungeonId: z.string().min(1),
  dungeonName: z.string().min(1),
  difficulty: z.string().min(1).optional(),
  partySize: z.number().int().positive().optional(),
});

export const DungeonLeftPayload = z.object({
  dungeonId: z.string().min(1),
  dungeonName: z.string().min(1),
  /** Time since the matching dungeon_entered, when the addon knew it. */
  durationSeconds: z.number().int().nonnegative().optional(),
});

export const BossKilledPayload = z.object({
  dungeonId: z.string().min(1),
  dungeonName: z.string().min(1).optional(),
  bossName: z.string().min(1),
  encounterId: z.string().min(1).optional(),
});

/** Emitted only when the client gives an explicit completion signal; see dungeons.ts for the fallback. */
export const DungeonCompletedPayload = z.object({
  dungeonId: z.string().min(1),
  dungeonName: z.string().min(1),
  difficulty: z.string().min(1).optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  /** Legacy (simulator-era) field; absent means success. */
  success: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Event type enum
// ---------------------------------------------------------------------------

export const EventType = z.enum([
  'session_started',
  'session_ended',
  'level_up',
  'quest_completed',
  'zone_changed',
  'location',
  'dungeon_entered',
  'dungeon_completed',
  'dungeon_left',
  'boss_killed',
]);

export type EventType = z.infer<typeof EventType>;

// ---------------------------------------------------------------------------
// Journey event (discriminated union on `type`)
// ---------------------------------------------------------------------------

const EventBase = z.object({
  id: Id,
  characterId: Id,
  sessionId: Id,
  occurredAt: IsoTimestamp,
  source: EventSource.optional(),
});

export const JourneyEvent = z.discriminatedUnion('type', [
  EventBase.extend({ type: z.literal('session_started'), payload: SessionStartedPayload }),
  EventBase.extend({ type: z.literal('session_ended'), payload: SessionEndedPayload }),
  EventBase.extend({ type: z.literal('level_up'), payload: LevelUpPayload }),
  EventBase.extend({ type: z.literal('quest_completed'), payload: QuestCompletedPayload }),
  EventBase.extend({ type: z.literal('zone_changed'), payload: ZoneChangedPayload }),
  EventBase.extend({ type: z.literal('location'), payload: LocationPayload }),
  EventBase.extend({ type: z.literal('dungeon_entered'), payload: DungeonEnteredPayload }),
  EventBase.extend({ type: z.literal('dungeon_completed'), payload: DungeonCompletedPayload }),
  EventBase.extend({ type: z.literal('dungeon_left'), payload: DungeonLeftPayload }),
  EventBase.extend({ type: z.literal('boss_killed'), payload: BossKilledPayload }),
]);

export type JourneyEvent = z.infer<typeof JourneyEvent>;

// Convenience: payload type lookup
export type JourneyEventPayload<T extends EventType> = Extract<JourneyEvent, { type: T }>['payload'];