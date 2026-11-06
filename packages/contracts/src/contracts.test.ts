// SPDX-License-Identifier: GPL-3.0-only
import { describe, it, expect } from 'vitest';
import { RAIDS_VISIBLE, isRaidEvent, visibleDungeons, FOREVER_INSTANCES, DUNGEON_CATALOG, dungeonIdFor, dungeonQuestStatus, completedQuestIds, JourneyEvent, UploadBatchRequest, Character, DungeonProgressResponse, buildDungeonProgress, isDungeonCompleted } from './index';

describe('JourneyEvent schema', () => {
  it('parses a level_up event', () => {
    const event = {
      id: 'evt-1',
      characterId: 'char-1',
      sessionId: 'sess-1',
      occurredAt: '2026-10-29T12:00:00.000Z',
      type: 'level_up',
      payload: { fromLevel: 5, toLevel: 6, zone: 'Elwynn Forest' },
    };
    const parsed = JourneyEvent.parse(event);
    expect(parsed.type).toBe('level_up');
  });

  it('rejects unknown event type', () => {
    const event = {
      id: 'evt-2',
      characterId: 'char-1',
      sessionId: 'sess-1',
      occurredAt: '2026-10-29T12:00:00.000Z',
      type: 'death',
      payload: {},
    };
    expect(() => JourneyEvent.parse(event)).toThrow();
  });

  it('rejects mismatched payload', () => {
    const event = {
      id: 'evt-3',
      characterId: 'char-1',
      sessionId: 'sess-1',
      occurredAt: '2026-10-29T12:00:00.000Z',
      type: 'quest_completed',
      payload: { questId: 'q-1' }, // missing questName
    };
    expect(() => JourneyEvent.parse(event)).toThrow();
  });
});

describe('UploadBatchRequest schema', () => {
  it('parses a valid batch', () => {
    const batch = {
      batchId: 'batch-1',
      characterId: 'char-1',
      events: [
        {
          id: 'evt-1',
          characterId: 'char-1',
          sessionId: 'sess-1',
          occurredAt: '2026-10-29T12:00:00.000Z',
          type: 'session_started',
          payload: { zone: 'Stormwind', level: 1 },
        },
      ],
      sentAt: '2026-10-29T12:00:01.000Z',
    };
    const parsed = UploadBatchRequest.parse(batch);
    expect(parsed.events).toHaveLength(1);
  });
});

describe('Character schema', () => {
  it('defaults visibility to private', () => {
    const c = Character.parse({
      id: 'char-1',
      userId: 'user-1',
      name: 'Arthas',
      race: 'human',
      class: 'death_knight',
      level: 80,
      createdAt: '2026-10-29T12:00:00.000Z',
      updatedAt: '2026-10-29T12:00:00.000Z',
    });
    expect(c.visibility).toBe('private');
  });
});
describe('dungeon events and progress', () => {
  const base = { characterId: 'c', sessionId: 's' };
  const ev = (id: string, at: string, type: string, payload: unknown) => JourneyEvent.parse({ ...base, id, occurredAt: `2026-10-29T${at}.000Z`, type, payload });
  const events = [
    ev('1', '10:00:00', 'dungeon_entered', { dungeonId: 'i-1', dungeonName: 'Deadmines', partySize: 3 }),
    ev('2', '10:05:00', 'boss_killed', { dungeonId: 'i-1', bossName: 'Rhahk\'Zor' }),
    ev('3', '10:06:00', 'boss_killed', { dungeonId: 'i-1', bossName: "rhahk'zor" }),
    ev('4', '10:10:00', 'quest_completed', { questId: '55', questName: 'Red Silk Bandanas', dungeonId: 'i-1' }),
    ev('5', '10:11:00', 'quest_completed', { questId: '56', questName: 'Elsewhere' }),
    ev('6', '10:20:00', 'dungeon_left', { dungeonId: 'i-1', dungeonName: 'Deadmines', durationSeconds: 1200 }),
    ev('7', '11:00:00', 'dungeon_entered', { dungeonId: 'i-2', dungeonName: 'Wailing Caverns' }),
    ev('8', '12:00:00', 'dungeon_entered', { dungeonId: 'i-1', dungeonName: 'Deadmines' }),
  ];

  it('still parses the old dungeon_completed shape and the new ones', () => {
    expect(() => ev('x', '10:00:00', 'dungeon_completed', { dungeonId: 'd', dungeonName: 'D', success: true })).not.toThrow();
    expect(() => ev('x', '10:00:00', 'dungeon_completed', { dungeonId: 'd', dungeonName: 'D' })).not.toThrow();
    expect(() => ev('x', '10:00:00', 'boss_killed', { dungeonId: 'd' })).toThrow();
  });

  it('folds events into per-dungeon progress, newest first', () => {
    const p = buildDungeonProgress(events);
    expect(p.map((d) => d.dungeonId)).toEqual(['i-1', 'i-2']);
    expect(p[0]).toMatchObject({ dungeonName: 'Deadmines', runs: 2, bossesKilled: ["Rhahk'Zor"], questsCompleted: [{ questId: '55', title: 'Red Silk Bandanas' }], completed: false, lastVisitedAt: '2026-10-29T12:00:00.000Z' });
    expect(DungeonProgressResponse.parse({ characterId: 'c', dungeons: p }).dungeons).toHaveLength(2);
  });

  it('isDungeonCompleted: event or catalog final boss', () => {
    const p = { dungeonId: 'i-1', bossesKilled: ["Rhahk'Zor"], completions: 0 };
    expect(isDungeonCompleted(p, {})).toBe(false);
    expect(isDungeonCompleted({ ...p, completions: 1 }, {})).toBe(true);
    expect(isDungeonCompleted(p, { 'i-1': { name: 'Deadmines', finalBossNames: ['Edwin VanCleef'] } })).toBe(false);
    expect(isDungeonCompleted(p, { 'i-1': { name: 'Deadmines', finalBossNames: ["RHAHK'ZOR"] } })).toBe(true);
    expect(isDungeonCompleted(p, { 'i-1': { name: 'Deadmines' } })).toBe(false);
    expect(buildDungeonProgress(events, { 'i-1': { name: 'Deadmines', finalBossNames: ["Rhahk'Zor"] } })[0]!.completed).toBe(true);
  });
});

describe('forever dungeon catalog', () => {
  const ev = (id: string, at: string, type: string, payload: unknown) =>
    JourneyEvent.parse({ characterId: 'c', sessionId: 's', id, occurredAt: `2026-10-29T${at}.000Z`, type, payload });
  it('has unique dungeon ids and well-formed quests', () => {
    const ids = FOREVER_INSTANCES.map(dungeonIdFor);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of FOREVER_INSTANCES) {
      expect(['dungeon', 'raid']).toContain(i.kind);
      expect(new Set(i.quests.map((q) => q.questId)).size).toBe(i.quests.length);
      for (const q of i.quests) expect(q.questId).toMatch(/^\d+$/);
    }
  });

  it('keys by client instance id, else the addon name slug, and splits raids from dungeons', () => {
    expect(DUNGEON_CATALOG['36']).toMatchObject({ name: 'The Deadmines', kind: 'dungeon' });
    expect(DUNGEON_CATALOG['409']).toMatchObject({ name: 'Molten Core', kind: 'raid' });
    expect(DUNGEON_CATALOG['name:the-drowned-city']?.quests?.length).toBeGreaterThan(0);
  });

  it('marks which of a dungeon\'s quests a character has turned in', () => {
    const events = [
      ev('1', '10:00:00', 'quest_completed', { questId: '166', questName: 'The Defias Brotherhood' }),
      ev('2', '10:01:00', 'quest_completed', { questId: '999999', questName: 'Elsewhere' }),
    ];
    const status = dungeonQuestStatus('36', completedQuestIds(events));
    expect(status.find((q) => q.questId === '166')?.done).toBe(true);
    expect(status.filter((q) => q.done)).toHaveLength(1);
    expect(dungeonQuestStatus('nope', [])).toEqual([]);
  });

  it('folds raid events into raid progress', () => {
    const p = buildDungeonProgress([
      ev('1', '10:00:00', 'raid_entered', { dungeonId: '409', dungeonName: 'Molten Core' }),
      ev('2', '10:30:00', 'boss_killed', { dungeonId: '409', bossName: 'Lucifron' }),
      ev('3', '11:00:00', 'raid_completed', { dungeonId: '409', dungeonName: 'Molten Core' }),
      ev('4', '11:05:00', 'raid_left', { dungeonId: '409', dungeonName: 'Molten Core', durationSeconds: 3900 }),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'raid', runs: 1, completions: 1, completed: true, bossesKilled: ['Lucifron'] });
  });

  it('hides raids while RAIDS_VISIBLE is false, but keeps counting them', () => {
    expect(RAIDS_VISIBLE).toBe(false);
    const rows = [
      { dungeonId: '36', kind: 'dungeon' as const },
      { dungeonId: '409', kind: 'raid' as const },
      { dungeonId: '533' }, // no kind on the row: the catalog says Naxxramas is a raid
      { dungeonId: 'unknown' },
    ];
    expect(visibleDungeons(rows).map((d) => d.dungeonId)).toEqual(['36', 'unknown']);
    expect(visibleDungeons(rows, true)).toHaveLength(4);
    expect(isRaidEvent(ev('1', '10:00:00', 'raid_entered', { dungeonId: '409', dungeonName: 'Molten Core' }))).toBe(true);
    expect(isRaidEvent(ev('2', '10:00:00', 'boss_killed', { dungeonId: '409', bossName: 'Lucifron', instanceKind: 'raid' }))).toBe(true);
    expect(isRaidEvent(ev('3', '10:00:00', 'boss_killed', { dungeonId: '36', bossName: 'VanCleef', instanceKind: 'dungeon' }))).toBe(false);
    expect(isRaidEvent(ev('4', '10:00:00', 'dungeon_entered', { dungeonId: '36', dungeonName: 'The Deadmines' }))).toBe(false);
  });

  it('carries the instance kind from events into progress', () => {
    const p = buildDungeonProgress([ev('1', '10:00:00', 'dungeon_entered', { dungeonId: '409', dungeonName: 'Molten Core', instanceKind: 'raid' })]);
    expect(p[0]?.kind).toBe('raid');
    expect(buildDungeonProgress([ev('1', '10:00:00', 'dungeon_entered', { dungeonId: '409', dungeonName: 'Molten Core' })])[0]?.kind).toBe('raid');
  });
});
