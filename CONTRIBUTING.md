# Contributing

Thanks for helping. This repository holds the open-source parts of Azeroth Journey: the WoW addon, the desktop companion
and the shared contracts and API client.

## Licensing: inbound = outbound, no CLA

Everything here is GPL-3.0-only. By submitting a contribution you agree that it is licensed under the same terms
(GPL-3.0-only). There is no CLA and no copyright assignment; you keep your copyright. Do not submit code you do not have
the right to license this way, and do not copy code from incompatible licenses. Please sign off commits with
`git commit -s` (Developer Certificate of Origin, <https://developercertificate.org>).

New first-party source files need the header `SPDX-License-Identifier: GPL-3.0-only`. Run
`node scripts/add-spdx-headers.mjs` to add it.

## Setup

Node 20+, pnpm 10+. For the companion's native part: Rust and the Tauri 2 prerequisites. For the addon: the `wowlua`
CLI (`npm i -g wowlua` or `cargo install wowlua`).

```bash
pnpm install
pnpm build:libs        # contracts and api-client build to dist/, the companion imports them from there
pnpm typecheck
pnpm test
```

Per package: `pnpm --filter @azeroth/desktop test`, `pnpm --filter @azeroth/contracts typecheck`, and so on.
Addon: `cd apps/addon && wowlua check && wowlua test`. Companion: `cd apps/desktop && cargo tauri dev`.

## Pull requests

- Keep changes focused; add or update tests (`*.test.ts` next to the source).
- `packages/contracts` is the source of truth for API and event shapes. Change it first; the server consumes it too, so
  breaking changes need discussion in an issue.
- Conventional commit messages: `feat:`, `fix:`, `docs:`, `chore:`. The release changelog is generated from them.
- CI must be green.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
