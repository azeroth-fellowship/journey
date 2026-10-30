// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';
import { CharacterClass, CharacterRace } from './characters';
import { JourneyEvent } from './events';

// ---------------------------------------------------------------------------
// Friends (all routes are authenticated; the acting user always comes from the session)
// ---------------------------------------------------------------------------

/** POST /v1/friend-requests. Looked up case-insensitively; the shape is deliberately loose so a bad name is not distinguishable from an unknown one. */
export const SendFriendRequest = z.object({ travellerName: z.string().trim().min(1).max(64) });

/** The one answer to POST /v1/friend-requests (202): identical whether or not the traveller exists or is already a friend. */
export const FriendRequestSentResponse = z.object({ status: z.literal('sent') });

export const FriendUser = z.object({ userId: Id, travellerName: z.string() });

/** GET /v1/friends */
export const Friend = FriendUser.extend({ since: IsoTimestamp });
export const ListFriendsResponse = z.array(Friend);

/** GET /v1/friend-requests */
export const FriendRequestsResponse = z.object({
  incoming: z.array(z.object({ id: Id, from: FriendUser, createdAt: IsoTimestamp })),
  outgoing: z.array(z.object({ id: Id, to: FriendUser, createdAt: IsoTimestamp })),
});

/** What the caller's grants on one friend character allow. */
export const FriendCharacterAccess = z.object({
  history: z.boolean(),
  livePresence: z.boolean(),
  location: z.boolean(),
});

export const FriendCharacterActivity = z.object({
  id: Id,
  name: z.string().min(1),
  class: CharacterClass,
  race: CharacterRace,
  level: z.number().int().min(1).max(80),
  access: FriendCharacterAccess,
  /** Newest first, at most 5; empty without view_history. Raw location samples are never included. */
  events: z.array(JourneyEvent),
  /** Only with view_live_presence. Expiry is already applied to isOnline. */
  presence: z
    .object({
      isOnline: z.boolean(),
      zone: z.string().min(1).optional(),
      level: z.number().int().min(1).max(80).optional(),
      updatedAt: IsoTimestamp,
    })
    .nullable(),
  /** Only with view_location (and a presence record carrying a position). x/y are zone-relative 0..1. */
  location: z.object({ zone: z.string().min(1).optional(), x: z.number(), y: z.number() }).nullable(),
});

export const FriendActivity = FriendUser.extend({
  since: IsoTimestamp,
  /** Only characters the caller holds at least one permission on; empty means "nothing shared yet". */
  characters: z.array(FriendCharacterActivity),
});

/** GET /v1/friends/activity */
export const FriendActivityResponse = z.array(FriendActivity);

export type SendFriendRequest = z.infer<typeof SendFriendRequest>;
export type FriendRequestSentResponse = z.infer<typeof FriendRequestSentResponse>;
export type FriendUser = z.infer<typeof FriendUser>;
export type Friend = z.infer<typeof Friend>;
export type ListFriendsResponse = z.infer<typeof ListFriendsResponse>;
export type FriendRequestsResponse = z.infer<typeof FriendRequestsResponse>;
export type FriendCharacterActivity = z.infer<typeof FriendCharacterActivity>;
export type FriendActivity = z.infer<typeof FriendActivity>;
export type FriendActivityResponse = z.infer<typeof FriendActivityResponse>;
