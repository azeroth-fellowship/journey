// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

export const Session = z.object({
  id: Id,
  characterId: Id,
  startedAt: IsoTimestamp,
  endedAt: IsoTimestamp.optional(),
  playtimeSeconds: z.number().int().nonnegative().optional(),
  startZone: z.string().min(1).optional(),
  endZone: z.string().min(1).optional(),
  startLevel: z.number().int().min(1).max(80).optional(),
  endLevel: z.number().int().min(1).max(80).optional(),
});

export type Session = z.infer<typeof Session>;