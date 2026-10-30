// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

export const JourneyPermission = z.enum(['view_history', 'view_live_presence', 'view_location']);

export const FriendshipStatus = z.enum(['pending', 'accepted', 'revoked']);

export const Friendship = z.object({
  id: Id,
  requesterUserId: Id,
  addresseeUserId: Id,
  status: FriendshipStatus,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

export const CharacterPermission = z.object({
  id: Id,
  characterId: Id,
  granteeUserId: Id,
  permissions: z.array(JourneyPermission).min(1),
  createdAt: IsoTimestamp,
  revokedAt: IsoTimestamp.optional(),
});

export const ShareLink = z.object({
  id: Id,
  characterId: Id,
  token: z.string().min(1),
  permissions: z.array(JourneyPermission).min(1),
  expiresAt: IsoTimestamp.optional(),
  createdAt: IsoTimestamp,
  revokedAt: IsoTimestamp.optional(),
});

export type JourneyPermission = z.infer<typeof JourneyPermission>;
export type FriendshipStatus = z.infer<typeof FriendshipStatus>;
export type Friendship = z.infer<typeof Friendship>;
export type CharacterPermission = z.infer<typeof CharacterPermission>;
export type ShareLink = z.infer<typeof ShareLink>;