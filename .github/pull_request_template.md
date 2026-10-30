## What and why

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## Checklist

- [ ] The PR title follows Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), the changelog is generated from it
- [ ] Tests added or updated (`*.test.ts` next to the source, `wowlua test` for the addon)
- [ ] `pnpm typecheck` and `pnpm test` pass locally
- [ ] New first-party source files carry the `SPDX-License-Identifier: GPL-3.0-only` header (`node scripts/add-spdx-headers.mjs`)
- [ ] Commits are signed off (`git commit -s`, see CONTRIBUTING.md)
- [ ] If `packages/contracts` changed: noted below whether it is a breaking change for the server

## Contract or API changes

<!-- Delete this section if nothing in packages/contracts changed. -->
