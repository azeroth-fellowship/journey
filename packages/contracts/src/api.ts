// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';
import { Character } from './characters';
import { EventType, JourneyEvent } from './events';
import { Session } from './sessions';

export const UploadBatchRequest = z.object({
  batchId: Id,
  characterId: Id,
  source: z.enum(['desktop', 'simulator', 'api']).optional(),
  events: z.array(JourneyEvent).min(1).max(5000),
  clientVersion: z.string().min(1).optional(),
  sentAt: IsoTimestamp,
});

export const UploadBatchResponse = z.object({
  batchId: Id,
  accepted: z.array(z.string()),
  duplicate: z.array(z.string()),
  rejected: z.array(
    z.object({
      id: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  serverTime: IsoTimestamp,
});

/** Aggregates over every event of a character (not just the returned page). */
export const JourneyTotals = z.object({
  sessions: z.number().int().nonnegative(),
  quests: z.number().int().nonnegative(),
  /** Distinct dungeons entered. */
  dungeons: z.number().int().nonnegative(),
  /** Distinct dungeons completed (see isDungeonCompleted). Optional so older payloads parse. */
  dungeonsCompleted: z.number().int().nonnegative().optional(),
  levelUps: z.number().int().nonnegative(),
  zones: z.number().int().nonnegative(),
  samples: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
});

export const SessionCounts = z.object({
  quests: z.number().int().nonnegative(),
  /** dungeon_entered events in the session. */
  dungeons: z.number().int().nonnegative(),
  levelUps: z.number().int().nonnegative(),
});

export const JOURNEY_DEFAULT_LIMIT = 200;
export const JOURNEY_MAX_LIMIT = 1000;
/** Upper bound for `routeSample`. */
export const ROUTE_SAMPLE_MAX = 1000;

/** Query string of the journey / events routes (all strings on the wire). `types` is comma-separated. */
export const JourneyPageQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(JOURNEY_MAX_LIMIT).default(JOURNEY_DEFAULT_LIMIT),
  order: z.enum(['asc', 'desc']).default('desc'),
  types: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(EventType).min(1))
    .optional(),
  routeSample: z.coerce.number().int().min(0).max(ROUTE_SAMPLE_MAX).optional(),
});

/**
 * GET /v1/characters/:id/journey?cursor&limit&order&routeSample
 * One page of events, NEWEST first by default (`order=asc` for oldest first). `nextCursor` is opaque and
 * null/absent on the last page; pass it back as `cursor` with the same `order`. The aggregate fields are
 * optional so older payloads still parse.
 */
export const CharacterJourneyResponse = z.object({
  character: Character,
  sessions: z.array(Session),
  events: z.array(JourneyEvent),
  nextCursor: z.string().min(1).nullable().optional(),
  /** Over all events, independent of paging. */
  totals: JourneyTotals.optional(),
  /** Per session id. */
  sessionCounts: z.record(z.string(), SessionCounts).optional(),
  /** Only with `routeSample=N`: at most N location/zone_changed events spread evenly over the whole journey, oldest first. */
  routeSample: z.array(JourneyEvent).optional(),
});

/** GET /v1/characters/:id/events?cursor&limit&order&types=a,b : same paging, events only. */
export const EventPageResponse = z.object({
  events: z.array(JourneyEvent),
  nextCursor: z.string().min(1).nullable().optional(),
});

/** GET /v1/characters (the caller's own). */
export const ListCharactersResponse = z.array(Character);

export const PresenceUpdate = z.object({
  characterId: Id,
  userId: Id,
  level: z.number().int().min(1).max(80).optional(),
  zone: z.string().min(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  lastEventAt: IsoTimestamp.optional(),
  isOnline: z.boolean(),
  expiresAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

export type CharacterJourneyResponse = z.infer<typeof CharacterJourneyResponse>;
export type EventPageResponse = z.infer<typeof EventPageResponse>;
export type JourneyTotals = z.infer<typeof JourneyTotals>;
export type SessionCounts = z.infer<typeof SessionCounts>;
export type UploadBatchRequest = z.infer<typeof UploadBatchRequest>;
export type UploadBatchResponse = z.infer<typeof UploadBatchResponse>;
export type PresenceUpdate = z.infer<typeof PresenceUpdate>;