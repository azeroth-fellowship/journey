# Releasing

One page for maintainers of the public repository (`azeroth-fellowship/journey`). The server images are released from the private server repository and are not covered here. The workflows have never run yet; treat the first run of each as a rehearsal (use `dry_run`, below).

## Versions and tags

Each component is versioned on its own and released by pushing its own tag.

| Component | Tag | Version lives in | Workflow |
| --- | --- | --- | --- |
| Companion (`apps/desktop`) | `companion-v<semver>` | `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (kept equal by a script) | `release-companion.yml` |
| Addon (`apps/addon`) | `addon-v<semver>` | `wowlua.json` -> `package.version` | `release-addon.yml` |

A semver with a pre-release part (`0.2.0-rc.1`) makes a GitHub pre-release. Pre-releases are never offered by the in-app updater (see below).


Both release workflows can also be started by hand (Actions -> Run workflow) with an existing `tag` and `dry_run`. A dry run builds everything and attaches the output as workflow artifacts; it creates no release and publishes nothing.

## Companion release

1. `node apps/desktop/scripts/bump-companion-version.mjs 0.2.0` (or `pnpm --filter @azeroth/desktop version:set 0.2.0`). Updates `package.json`, `tauri.conf.json`, `Cargo.toml` and the `azeroth-desktop` entry in `Cargo.lock`.
2. Commit (`chore(desktop): release 0.2.0`), then `git tag companion-v0.2.0 && git push origin main companion-v0.2.0`.
3. The workflow:
   - `verify`: tag format; tag equals the version in all three files; repository variables and the signing secret are set; the updater public key is not the placeholder. Fails early with a message saying which.
   - `build` (matrix): Windows is required. Linux and macOS are experimental (`continue-on-error`, unsigned, untested) and never block the release. Builds the workspace dependencies, then runs `tauri-action` with `--config src-tauri/tauri.release.generated.conf.json`. That file is `tauri.release.conf.json` with the repo filled in; it turns on `createUpdaterArtifacts` and adds the updater key and feed URL. Uploads the NSIS installer, its `.sig`, and `latest.json` to a **draft** release whose notes are the changelog (conventional commits touching `apps/desktop` since the previous `companion-v*` tag).
   - `publish`: only after Windows succeeded, un-drafts the release (and marks it Latest unless it is a pre-release).
4. Smoke test: install the previous version, wait for or click "Check for updates" in Diagnostics, confirm it offers the new one and restarts into it.

### How users get it

The installer is a per-user NSIS setup (no admin prompt) that registers the `azeroth-journey://` scheme and installs the WebView2 bootstrapper if missing. A first install is a manual download from the Releases page.

Installed builds check `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` on start and every 6 hours (not while an approve-sign-in window is open). GitHub's `latest` is the newest published, non-draft, non-pre-release release; `latest.json` is part of it, so **the updater feed is just GitHub Releases**. When a newer signed version exists the status window shows "Update X available - release notes - Install and restart". Clicking it flushes the upload queue (unless syncing is paused; the queue is stored locally either way), downloads, verifies the signature against the public key compiled into the app, installs (Windows `passive` mode) and relaunches. Diagnostics shows the app version and has a manual "Check for updates".

Dev builds and plain `cargo check` have no updater config: the plugin is not registered, a line is logged, and the update UI stays hidden.

### Rollback / yanking

- Do not delete the git tag. On GitHub, edit the bad release and tick "Set as a pre-release" (or delete the release). `releases/latest` then resolves to the previous release, so nobody new is offered the bad one.
- Installed clients never downgrade (the updater only moves to a higher version). To fix people already on the bad version, release a **higher** version (`0.2.1`) containing the revert.
- If only `latest.json` is wrong, edit/replace that asset on the release.

## Addon release

1. Set `package.version` in `apps/addon/wowlua.json` (for example `0.2.0`). Check `flavors` and the `.toc` Interface number still match the live client.
2. Commit, then `git tag addon-v0.2.0 && git push origin main addon-v0.2.0`.
3. The workflow installs wowlua, runs `wowlua check && wowlua test`, builds with `wowlua build --release`, verifies the built `.toc` (`## Version:` equals the tag, `## SavedVariables: AzerothJourneyDB`, `## Interface:`), zips the folder as `AzerothJourney-0.2.0.zip` with `AzerothJourney/` at the zip root, creates the GitHub Release with the changelog (commits touching `apps/addon` since the previous `addon-v*` tag) and then, if configured, uploads to CurseForge and Wago.io. Unset publishing credentials only produce a notice in the log.

Notes on wowlua behaviour (observed with 0.13.6, from the output of `wowlua build --release`):
- Without a `v<version>` tag at HEAD (or with a dirty tree) wowlua stamps `## Version: 0.1.0-alpha+<sha>`. It does not recognise `addon-v...` tags, so the workflow creates a throwaway local `v<version>` tag before building. It is never pushed. Do not push a `v*` tag for this.
- The workflow assumes the CLI is available as the npm package `wowlua` (documented install `npm i -g wowlua`; fallback `cargo install wowlua`). Not verified on a Linux runner.
- wowlua has its own `package` / `publish` commands with `publish.targets` in `wowlua.json`. The workflow uses plain upload APIs instead, as requested; switching later is possible.

### CurseForge and Wago

Both are optional and independent.

CurseForge (`wow.curseforge.com/api/projects/<id>/upload-file`):
- Secret `CF_API_KEY` (an API token from your CurseForge account's API tokens page).
- Variable `CURSEFORGE_PROJECT_ID` (numeric id, on the project's overview page).
- Variable `CURSEFORGE_GAME_VERSION_IDS`: comma-separated numeric ids, e.g. `12345,12346`. Look them up with `curl -H "X-Api-Token: $CF_API_KEY" https://wow.curseforge.com/api/game/versions` and pick the entries for the game version(s) you support (the list also has `/api/game/version-types`). Ids differ per game flavor and version. **WoW Forever (flavor `camelot`, Interface 16001) may not exist in that list yet**; if it is missing the upload cannot be targeted correctly. Leave the variable unset (the step skips with a warning) and upload by hand until CurseForge adds it.

Wago.io (`addons.wago.io/api/projects/<id>/version`):
- Secret `WAGO_API_TOKEN` (Wago account -> API keys), variable `WAGO_PROJECT_ID`.
- Wago requires at least one supported game patch in the metadata. Set the optional variable `WAGO_EXTRA_METADATA` to a JSON object such as `{"supported_retail_patch":"12.0.0"}`. Which key (if any) fits WoW Forever is **unknown**; check Wago's API docs. The upload request shape follows Wago's documented API but has not been exercised.

## One-time setup checklist

Companion:
1. Generate the updater signing key (keep it safe; if it is lost, installed apps can never update and everyone must reinstall):
   `cargo tauri signer generate -w ~/.tauri/azeroth-companion.key` (choose a password; needs `cargo install tauri-cli --version "^2"`).
2. Paste the **public** key (the `.key.pub` file's content) into `apps/desktop/src-tauri/tauri.release.conf.json` -> `plugins.updater.pubkey` and commit it. The private key is never committed.
3. Repository secrets (Settings -> Secrets and variables -> Actions of the public repo; they are not inherited from the old repo): `TAURI_SIGNING_PRIVATE_KEY` (the private key file's content) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Repository variables: `COMPANION_API_URL` (public API base URL, becomes `VITE_API_URL`) and `COMPANION_WEB_URL` (website URL, becomes `VITE_WEB_URL` and `AZEROTH_WEB_URL`). The build fails if either is missing, so a release cannot ship pointing at localhost.
5. The update feed repo is taken from `GITHUB_REPOSITORY` in CI. For local release builds set `RELEASE_REPO` at the top of `apps/desktop/scripts/prepare-release-config.mjs`. The public key must never change, or installed apps stop updating.
6. Settings -> Actions -> General: workflow permissions may stay read-only (the release jobs request `contents: write` themselves).
7. Windows code signing (Authenticode) is not set up: users will see a SmartScreen warning. Separate from updater signing.

Addon (only if publishing beyond GitHub):
1. Create the CurseForge project (author dashboard -> Create project -> World of Warcraft -> Addons), note its numeric id, create an API token, work out the game version ids (above).
2. Create the Wago addon project, note its id, create an API key.
3. Add the secrets/variables listed above. Do a `dry_run` first, then a real `addon-v` tag.
