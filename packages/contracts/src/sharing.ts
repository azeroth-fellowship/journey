// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';
import { CharacterClass, CharacterRace, ProfileVisibility } from './characters';
import {
  BossKilledPayload,
  DungeonCompletedPayload,
  DungeonEnteredPayload,
  DungeonLeftPayload,
  LevelUpPayload,
  QuestCompletedPayload,
  SessionEndedPayload,
  SessionStartedPayload,
  ZoneChangedPayload,
} from './events';

// ---------------------------------------------------------------------------
// Owner-only sharing settings (/v1/characters/:id/sharing)
// ---------------------------------------------------------------------------

/** What a chosen friend may see. "history+live" = view_history + view_live_presence + view_location. */
export const SharingScope = z.enum(['history', 'history+live']);

export const SharingGrant = z.object({
  userId: Id,
  travellerName: z.string(),
  scope: SharingScope,
});

export const SharingFriend = z.object({
  userId: Id,
  travellerName: z.string(),
});

export const SharingSettings = z.object({
  characterId: Id,
  visibility: ProfileVisibility,
  /** Only ever true while visibility is "friends". Separate from history. */
  liveLocation: z.boolean(),
  /** Present only while visibility is "public". Secret: it is the whole access check of the public page. */
  publicSlug: z.string().min(1).nullable(),
  /** People with access (only populated while visibility is "friends"). */
  grants: z.array(SharingGrant),
  /** Accepted friends who have no grant yet. */
  friends: z.array(SharingFriend),
});

export const UpdateSharingRequest = z
  .object({ visibility: ProfileVisibility.optional(), liveLocation: z.boolean().optional() })
  .refine((v) => v.visibility !== undefined || v.liveLocation !== undefined, { message: 'nothing to update' });

export const SetGrantRequest = z.object({ scope: SharingScope });

// ---------------------------------------------------------------------------
// Public journey (GET /public/journeys/:slug, no auth)
// Deliberately a separate shape from JourneyEvent/Character: it can only carry what a public page may show.
// No live location, no exact (x/y) samples, no presence, no internal character/user ids.
// ---------------------------------------------------------------------------

/** Zone-level only: x/y are stripped. */
export const PublicLocationPayload = z.object({ zone: z.string().min(1) }).strict();

const PublicEventBase = z.object({ id: Id, sessionId: Id, occurredAt: IsoTimestamp });

export const PublicJourneyEvent = z.discriminatedUnion('type', [
  PublicEventBase.extend({ type: z.literal('session_started'), payload: SessionStartedPayload }),
  PublicEventBase.extend({ type: z.literal('session_ended'), payload: SessionEndedPayload }),
  PublicEventBase.extend({ type: z.literal('level_up'), payload: LevelUpPayload }),
  PublicEventBase.extend({ type: z.literal('quest_completed'), payload: QuestCompletedPayload }),
  PublicEventBase.extend({ type: z.literal('zone_changed'), payload: ZoneChangedPayload }),
  PublicEventBase.extend({ type: z.literal('location'), payload: PublicLocationPayload }),
  PublicEventBase.extend({ type: z.literal('dungeon_entered'), payload: DungeonEnteredPayload }),
  PublicEventBase.extend({ type: z.literal('dungeon_completed'), payload: DungeonCompletedPayload }),
  PublicEventBase.extend({ type: z.literal('dungeon_left'), payload: DungeonLeftPayload }),
  PublicEventBase.extend({ type: z.literal('boss_killed'), payload: BossKilledPayload }),
]);

export const PublicSession = z.object({
  /** 1-based chronological number as a string; matches PublicJourneyEvent.sessionId. */
  id: Id,
  startedAt: IsoTimestamp,
  endedAt: IsoTimestamp.optional(),
  playtimeSeconds: z.number().int().nonnegative().optional(),
  startZone: z.string().min(1).optional(),
  endZone: z.string().min(1).optional(),
  startLevel: z.number().int().min(1).max(80).optional(),
  endLevel: z.number().int().min(1).max(80).optional(),
  /** Over the whole session, even when `events` is capped. */
  quests: z.number().int().nonnegative().optional(),
  dungeons: z.number().int().nonnegative().optional(),
  levelUps: z.number().int().nonnegative().optional(),
});

export const PublicDungeonSummary = z.object({
  dungeonName: z.string().min(1),
  completed: z.boolean(),
  bossesKilled: z.number().int().nonnegative(),
  quests: z.array(z.string().min(1)),
});

export const PublicJourney = z.object({
  character: z.object({
    name: z.string().min(1),
    class: CharacterClass,
    race: CharacterRace,
    level: z.number().int().min(1).max(80),
  }),
  totals: z.object({
    sessions: z.number().int().nonnegative(),
    quests: z.number().int().nonnegative(),
    /** Distinct dungeons entered. */
    dungeons: z.number().int().nonnegative(),
    dungeonsCompleted: z.number().int().nonnegative().optional(),
    levelUps: z.number().int().nonnegative(),
    zones: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
  }),
  sessions: z.array(PublicSession),
  /** Per dungeon: names, completed flag and boss kills only (no quest ids, no timestamps). */
  dungeons: z.array(PublicDungeonSummary).optional(),
  /** The latest entries (see `entryLimit`) plus a thin sample of zone-level location events, oldest first. */
  events: z.array(PublicJourneyEvent),
  /** True when older entries exist beyond `events`; totals still cover everything. */
  truncated: z.boolean().optional(),
  /** The cap on non-location entries, for the "showing the latest N entries" note. */
  entryLimit: z.number().int().positive().optional(),
});

export type SharingScope = z.infer<typeof SharingScope>;
export type SharingGrant = z.infer<typeof SharingGrant>;
export type SharingFriend = z.infer<typeof SharingFriend>;
export type SharingSettings = z.infer<typeof SharingSettings>;
export type UpdateSharingRequest = z.infer<typeof UpdateSharingRequest>;
export type SetGrantRequest = z.infer<typeof SetGrantRequest>;
export type PublicJourneyEvent = z.infer<typeof PublicJourneyEvent>;
export type PublicDungeonSummary = z.infer<typeof PublicDungeonSummary>;
export type PublicSession = z.infer<typeof PublicSession>;
export type PublicJourney = z.infer<typeof PublicJourney>;
