# Desktop Companion (Tauri)

Tauri + React + TypeScript companion. Licensed GPL-3.0-only; see `THIRD_PARTY_NOTICES.md`.

## Prerequisites

```bash
cargo install tauri-cli   # or: npm i -g @tauri-apps/cli
```

## Commands (from apps/desktop)

```bash
pnpm typecheck
pnpm test
pnpm tauri dev          # run desktop app (requires tauri-cli)
pnpm tauri build
```

## Implemented so far

- `src/queue.ts` — upload queue with retry, pause/resume, persistence across restarts, auto-flush. Tested.
- `src-tauri/` — Tauri v2 scaffold with `ping` and `read_saved_variables_dir` commands.