// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { luaArray, parseLuaFile } from './lua';
import { mapSavedVariables, scoped } from './map';

const U = 'user1';
const S1 = 'sess-Thrall-Area 52-2026-10-01T10:00:00Z';

/** Shaped like a real WoW-written SavedVariables file (tabs, trailing commas, `-- [n]` index comments). */
const FIXTURE = `
AzerothJourneyDB = {
	["events"] = {
		{
			["id"] = "evt-${S1}-1",
			["characterId"] = "Thrall-Area 52",
			["sessionId"] = "${S1}",
			["occurredAt"] = "2026-10-01T10:00:00Z",
			["type"] = "session_started",
			["source"] = "addon",
			["payload"] = {
				["zone"] = "Durotar",
				["level"] = 12,
			},
		}, -- [1]
		{
			["id"] = "evt-${S1}-2",
			["characterId"] = "Thrall-Area 52",
			["sessionId"] = "${S1}",
			["occurredAt"] = "2026-10-01T10:01:00Z",
			["type"] = "location",
			["source"] = "addon",
			["payload"] = {
				["zone"] = "Durotar",
				["x"] = 0.5123,
				["y"] = 0.25,
			},
		}, -- [2]
		{
			["id"] = "evt-${S1}-3",
			["characterId"] = "Thrall-Area 52",
			["sessionId"] = "${S1}",
			["occurredAt"] = "2026-10-01T10:05:00Z",
			["type"] = "quest_completed",
			["source"] = "addon",
			["payload"] = {
				["questId"] = 4641,
				["questName"] = "Quest 4641",
				["zone"] = "Durotar",
				["xpGained"] = 350,
			},
		}, -- [3]
		{
			["id"] = "evt-${S1}-4",
			["characterId"] = "Thrall-Area 52",
			["sessionId"] = "${S1}",
			["occurredAt"] = "2026-10-01T10:30:00Z",
			["type"] = "level_up",
			["source"] = "addon",
			["payload"] = {
				["fromLevel"] = 12,
				["toLevel"] = 13,
				["zone"] = "Orgrimmar",
			},
		}, -- [4]
		{
			["id"] = "evt-${S1}-5",
			["characterId"] = "Thrall-Area 52",
			["sessionId"] = "${S1}",
			["occurredAt"] = "2026-10-01T10:45:00Z",
			["type"] = "session_ended",
			["source"] = "addon",
			["payload"] = {
				["reason"] = "logout",
				["zone"] = "Orgrimmar",
				["level"] = 13,
			},
		}, -- [5]
	},
	["characters"] = {
		["Thrall-Area 52"] = {
			["name"] = "Thrall",
			["realm"] = "Area 52",
			["class"] = "SHAMAN",
			["race"] = "Orc",
			["level"] = 13,
		},
	},
	["sessions"] = {
	},
	["version"] = 1,
}
`;

describe('parseLuaFile', () => {
  it('reads nested tables, numbers, booleans, nil and both key styles', () => {
    const f = parseLuaFile(`X = { a = 1, ["b c"] = "x", [9] = true, -2.5e1, nil, { "n" }, } -- tail\nY = "s"`);
    expect(f.truncated).toBe(false);
    expect(f.globals.Y).toBe('s');
    const x = f.globals.X as Record<string, unknown>;
    expect(x.a).toBe(1);
    expect(x['b c']).toBe('x');
    expect(x['9']).toBe(true);
    expect(x['1']).toBe(-25);
  });

  it('decodes string escapes, long strings and skips comments', () => {
    const f = parseLuaFile(`--[[ header\n]] V = { "a\\nb\\"c\\\\d\\65\\x42", [[long\nstring]], -- c\n 'q' }`);
    expect(luaArray(f.globals.V)).toEqual(['a\nb"c\\dAB', 'long\nstring', 'q']);
  });

  it('keeps what it could read from a file cut off mid-table', () => {
    const f = parseLuaFile(FIXTURE.slice(0, FIXTURE.indexOf('evt-' + S1 + '-3') + 30));
    expect(f.truncated).toBe(true);
    const db = f.globals.AzerothJourneyDB as Record<string, unknown>;
    expect(luaArray(db.events as never).length).toBeGreaterThanOrEqual(2);
  });

  it('survives garbage, empty input and binary noise without throwing', () => {
    for (const text of ['', '   ', 'not lua at all', 'X = ', 'X = {', 'X = { [ = 3 }', '\u0000\u0001\u0002', 'X = {{{{{{', 'X = "unterminated']) {
      expect(() => parseLuaFile(text)).not.toThrow();
    }
    expect(parseLuaFile('').truncated).toBe(false);
    expect(parseLuaFile('X = {').truncated).toBe(true);
  });
});

describe('mapSavedVariables dungeon events', () => {
  const ev = (n: number, at: string, type: string, payload: string) => `
		{
			["id"] = "evt-${S1}-${n}",
			["characterId"] = "Thrall-Area 52",
			["sessionId"] = "${S1}",
			["occurredAt"] = "2026-10-01T${at}Z",
			["type"] = "${type}",
			["source"] = "addon",
			["payload"] = { ${payload} },
		}, -- [${n}]`;
  const text = `AzerothJourneyDB = { ["events"] = {${[
    ev(1, '10:00:00', 'dungeon_entered', '["dungeonId"] = 36, ["dungeonName"] = "Deadmines", ["difficulty"] = "normal", ["partySize"] = 3'),
    ev(2, '10:05:00', 'boss_killed', '["dungeonId"] = "36", ["dungeonName"] = "Deadmines", ["bossName"] = "Gilnid", ["encounterId"] = 593'),
    ev(3, '10:06:00', 'quest_completed', '["questId"] = 7, ["questName"] = "Oh Brother...", ["dungeonId"] = "36", ["dungeonName"] = "Deadmines"'),
    ev(4, '10:10:00', 'dungeon_completed', '["dungeonId"] = "36", ["dungeonName"] = "Deadmines"'),
    ev(5, '10:20:00', 'dungeon_left', '["dungeonId"] = "36", ["dungeonName"] = "Deadmines", ["durationSeconds"] = 1200'),
    ev(6, '10:21:00', 'boss_killed', '["dungeonId"] = "36"'),
  ].join('')}
}, ["characters"] = {} }`;

  it('maps entered/boss/quest/completed/left, coercing numeric ids, and skips an invalid one', () => {
    const m = mapSavedVariables([text], U);
    expect(m.events.map((e) => e.type)).toEqual(['dungeon_entered', 'boss_killed', 'quest_completed', 'dungeon_completed', 'dungeon_left']);
    expect(m.skipped).toBe(1); // boss_killed without bossName
    expect(m.events[0]!.payload).toMatchObject({ dungeonId: '36', partySize: 3 });
    expect(m.events[1]!.payload).toMatchObject({ bossName: 'Gilnid', encounterId: '593' });
    expect(m.events[2]!.payload).toMatchObject({ questId: '7', dungeonId: '36' });
  });
});

describe('mapSavedVariables', () => {
  const m = mapSavedVariables([FIXTURE], U);

  it('maps events to valid contract events with user-scoped ids', () => {
    expect(m.events).toHaveLength(5);
    expect(m.skipped).toBe(0);
    expect(m.truncated).toBe(false);
    const q = m.events.find((e) => e.type === 'quest_completed')!;
    expect(q).toMatchObject({ id: scoped(U, `evt-${S1}-3`), characterId: scoped(U, 'Thrall-Area 52'), sessionId: scoped(U, S1) });
    expect(q.type === 'quest_completed' && q.payload.questId).toBe('4641'); // number -> string
  });

  it('builds the character from the addon identity and the latest events', () => {
    expect(m.characters).toHaveLength(1);
    expect(m.characters[0]).toMatchObject({
      id: scoped(U, 'Thrall-Area 52'), userId: U, name: 'Thrall', realm: 'Area 52', class: 'shaman', race: 'orc', level: 13, zone: 'Orgrimmar', visibility: 'private',
    });
  });

  it('derives sessions with times, zones and levels', () => {
    expect(m.sessions).toEqual([
      {
        id: scoped(U, S1), characterId: scoped(U, 'Thrall-Area 52'), startedAt: '2026-10-01T10:00:00Z', endedAt: '2026-10-01T10:45:00Z',
        playtimeSeconds: 2700, startZone: 'Durotar', endZone: 'Orgrimmar', startLevel: 12, endLevel: 13,
      },
    ]);
  });

  it('is deterministic and de-duplicates by event id, also across files', () => {
    const again = mapSavedVariables([FIXTURE, FIXTURE], U);
    expect(again.events.map((e) => e.id)).toEqual(m.events.map((e) => e.id));
    expect(mapSavedVariables([FIXTURE], 'other').events[0]!.id).not.toBe(m.events[0]!.id);
  });

  it('skips unusable entries but keeps the good ones', () => {
    const bad = FIXTURE.replace('["type"] = "location"', '["type"] = "teleported"').replace('["occurredAt"] = "2026-10-01T10:05:00Z"', '["occurredAt"] = "yesterday"');
    const r = mapSavedVariables([bad], U);
    expect(r.skipped).toBe(2);
    expect(r.events).toHaveLength(3);
  });

  it('drops out-of-range or unknown coordinates instead of the event', () => {
    const r = mapSavedVariables([FIXTURE.replace('0.5123', '7.5')], U);
    const loc = r.events.find((e) => e.type === 'location')!;
    expect(loc.type === 'location' && loc.payload).toEqual({ zone: 'Durotar', y: 0.25 });
  });

  it('falls back when the addon recorded no identity, reading name and realm from the id', () => {
    const noMeta = FIXTURE.replace(/\["characters"\] = \{[\s\S]*?\n\t\},\n/, '');
    const c = mapSavedVariables([noMeta], U).characters[0]!;
    expect(c).toMatchObject({ name: 'Thrall', realm: 'Area 52', class: 'warrior', race: 'human', level: 13 });
  });

  it('drops the last event of a truncated file (it may be incomplete)', () => {
    const cut = FIXTURE.slice(0, FIXTURE.indexOf('["characters"]'));
    const r = mapSavedVariables([cut], U);
    expect(r.truncated).toBe(true);
    expect(r.events).toHaveLength(4);
  });

  it('tolerates files without the addon table or with corrupt content', () => {
    for (const t of ['', 'Other = {}', 'AzerothJourneyDB = 5', 'AzerothJourneyDB = { events = "x" }', 'garbage {{{']) {
      const r = mapSavedVariables([t], U);
      expect(r.events).toEqual([]);
      expect(r.characters).toEqual([]);
    }
  });
});
