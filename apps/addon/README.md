# WoW Addon (wowlua)

WoW Forever addon that captures journey events and persists them to SavedVariables. Built with [wowlua](https://wowlua.dev/) (camelot flavor).

## Prerequisites

```bash
cargo install wowlua   # or: npm i -g wowlua
```

## Commands

```bash
cd apps/addon
wowlua check          # type-check
wowlua test           # run emulated-client tests
wowlua dev            # build + install into WoW + watch
wowlua build --release
```

## Layout

- `wowlua.json` — manifest (camelot flavor)
- `src/main.wowlua` — event capture + SavedVariables persistence
- `tests/main.test.wowlua` — smoke tests
- `locales/enUS.json` — translations

## Output

`AzerothJourneyDB` is written to `WTF/Account/<account>/SavedVariables/AzerothJourney.lua` on `/reload` or logout. The companion (`apps/desktop/src/savedvars`) reads `characters` (name, realm, class and race tokens, level) and `events` (`id`, `characterId` as "Name-Realm", `sessionId`, `occurredAt`, `type`, `source`, `payload`). Build output goes to `dist/` (git-ignored); release builds come from `wowlua build --release`.

## Testing without WoW

The companion's tests (`pnpm --filter @azeroth/desktop test`) parse a fixture shaped like this output. Update the fixture when the addon's event shape changes.

## Dungeon events

`dungeon_entered` / `dungeon_left` come from `IsInInstance` + `GetInstanceInfo` (checked on `PLAYER_ENTERING_WORLD` and `ZONE_CHANGED_NEW_AREA`; dungeons and raids only). `dungeonId` is the instance id as a string (`"36"`), or `name:<slugged name>` when the client reports none. `boss_killed` uses `BOSS_KILL` / `ENCOUNTER_END`, with an experimental combat-log fallback for clients without encounter events. `quest_completed` inside an instance carries `dungeonId` / `dungeonName`. `dungeon_completed` is emitted only on an explicit client signal (`LFG_COMPLETION_REWARD`, a guess); otherwise completion is derived by the API from boss kills once `DUNGEON_CATALOG` (packages/contracts/src/dungeons.ts) is filled. None of this has run in the real client yet.
