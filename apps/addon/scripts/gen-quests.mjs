#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Rewrites the BACKFILL_QUESTS table in src/main.wowlua from the dungeon catalog
// (packages/contracts/src/data/forever-dungeons.json). The addon uses it to find quests a character finished before
// the addon was installed.
//
//   node apps/addon/scripts/gen-quests.mjs          rewrite the block
//   node apps/addon/scripts/gen-quests.mjs --check  exit 1 when the block is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, '../../../packages/contracts/src/data/forever-dungeons.json'), 'utf8'));
const target = join(here, '../src/main.wowlua');
const BEGIN = '-- BEGIN GENERATED QUESTS (apps/addon/scripts/gen-quests.mjs)';
const END = '-- END GENERATED QUESTS';

const titles = new Map();
for (const d of catalog.dungeons) for (const q of d.quests) if (!titles.has(q.questId)) titles.set(q.questId, q.title);
const lua = (s) => `"${s.replace(/[\u0000-\u001f]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const ids = [...titles.keys()].sort((a, b) => Number(a) - Number(b));
const block = [BEGIN, 'local BACKFILL_QUESTS: any = {', ...ids.map((id) => `  [${id}] = ${lua(titles.get(id))},`), '}', END].join('\n');

const src = readFileSync(target, 'utf8');
const start = src.indexOf(BEGIN);
const end = src.indexOf(END);
if (start < 0 || end < 0) { console.error('markers not found in main.wowlua'); process.exit(1); }
const next = src.slice(0, start) + block + src.slice(end + END.length);
if (process.argv.includes('--check')) {
  if (next !== src) { console.error('BACKFILL_QUESTS is out of date: run node apps/addon/scripts/gen-quests.mjs'); process.exit(1); }
} else {
  writeFileSync(target, next);
  console.log(`BACKFILL_QUESTS: ${ids.length} quests`);
}
