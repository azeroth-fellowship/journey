// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

export const CharacterClass = z.enum([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'monk',
  'druid',
  'death_knight',
]);

export const CharacterRace = z.enum([
  'human',
  'orc',
  'dwarf',
  'night_elf',
  'undead',
  'tauren',
  'gnome',
  'troll',
  'blood_elf',
  'draenei',
]);

export const CharacterGender = z.enum(['male', 'female']);

/** One profession as the addon reports it. `skillLine` is the client's stable id; `icon` is whatever the client gave. */
export const Profession = z.object({
  name: z.string().min(1),
  rank: z.number().int().min(0),
  max: z.number().int().min(0),
  skillLine: z.number().int().optional(),
});

export const ProfileVisibility = z.enum(['private', 'friends', 'public']);

export const Character = z.object({
  id: Id,
  userId: Id,
  name: z.string().min(1),
  realm: z.string().min(1).optional(),
  race: CharacterRace,
  class: CharacterClass,
  level: z.number().int().min(1).max(80),
  gender: CharacterGender.optional(),
  professions: z.array(Profession).max(16).optional(),
  zone: z.string().min(1).optional(),
  visibility: ProfileVisibility.default('private'),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  lastSeenAt: IsoTimestamp.optional(),
});

export type Character = z.infer<typeof Character>;
export type CharacterClass = z.infer<typeof CharacterClass>;
export type CharacterGender = z.infer<typeof CharacterGender>;
export type Profession = z.infer<typeof Profession>;
export type CharacterRace = z.infer<typeof CharacterRace>;
export type ProfileVisibility = z.infer<typeof ProfileVisibility>;