# Dev workflow reference

The details behind the short rules in `AGENTS.md`: packaging, release builds, tests, the Claude mods, the job queue,
worktrees, visual verification, the changelog markup and engine plans for this repo. `AGENTS.md` keeps the rule; this
file keeps the how and the why.

## Packaging

Tauri packaging targets **Windows** (`cargo tauri build` → NSIS; bundles `wavesrv.x64.exe` + `wsh-*-windows.x64.exe`)
and **macOS on Apple silicon** (`src-tauri/tauri.macos.conf.json`, merged over `tauri.conf.json` on a Mac → `.app` +
`.dmg`, signed with the self-signed certificate `arcterm_local_mac` in the login keychain, not notarized: a fixed
identity keeps the permissions macOS grants arcterm (Screen Recording…) across installs, which an ad-hoc signature, a
new cdhash each build, loses; `APPLE_SIGNING_IDENTITY=-` signs ad-hoc on a Mac without it; bundles `wavesrv.arm64` +
`wsh-*-darwin.arm64`, macOS 13+).

`task build:backend` builds into `dist/bin/`: `wavesrv` (stripped windows x64 on Windows; arm64 + amd64 on a Mac) and
`wsh` for the one target the host's bundle ships — windows x64 on Windows, darwin arm64 on a Mac; on a Mac also
`apple-translate.arm64`, Quick translate's Apple Translation helper (`swiftc`, `pkg/translate/apple/`).

The upstream Electron-era docs were deleted on 2026-07-31 (`BUILD.md`, `CONTRIBUTING.md`, `RELEASES.md`, `SECURITY.md`,
`CODE_OF_CONDUCT.md`, the Docusaurus site under `docs/`, `aiprompts/`); the Electron shell lives on the
`legacy/electron` branch.

## Release builds (`task tauri:build`)

`task tauri:build` (alias `build:app`, and what `npm run build` runs) builds a **commit**, not the working tree
(`scripts/release-build.mjs`): it checks HEAD out into `.worktrees/release-build` (junctioning `node_modules`,
`src-tauri/target`, `dist/bin`), so edits other agents make in the checkout meanwhile stay out; syncs the version,
builds the backend, then `cargo tauri build`, and copies the installer (`.exe`, or `.dmg` on a Mac) into the gitignored
`releases/` with the commit in its name (`arcterm_0.15.11_5900060a2_x64-setup.exe`). Commit what you want in the build
first. `FROM=<commit>` builds another commit; `FROM=tree` builds the checkout with its uncommitted edits (named
`<commit>-dirty`).

**Bumping.** It does not bump by default (`BUMP=none`); for a release pass `BUMP=auto` (or `patch|minor|major`) and
commit the bump. An agent that builds for the person to install passes `BUMP=auto` unasked (`--bump auto --dry-run` on
`scripts/release-build.mjs` previews the pick).

- `auto` reads the built commit's `CHANGELOG.md` Unreleased lines (`scripts/release-bump.mjs`). It makes a minor
  release when the Unreleased section holds 60 lines or more (`MIN_RELEASE_LINES`), whatever their sections, or 5
  `<!-- big -->` lines (What's new's cards are full), and builds with no bump otherwise, the lines (a big one too)
  waiting in Unreleased for the next minor. It never picks a patch (the person's standing ask, 2026-11-19, raised from
  one big line or 20 lines on 2026-11-22 after 1.7.0 to 1.14.0 came out in four days).
- Major is always by hand, for a release that breaks something for the person (a feature removed, a config or
  `wsh`/hook contract changed without migrating). A hand-picked bump smaller than the lines call for stops the build
  unless `FORCE=1`.
- An Unreleased section of 120 lines or more is split into even minor releases first (also the person's ask):
  `node scripts/changelog-split.mjs` (`--dry-run` to preview) cuts its lines by when each landed into dated minor
  releases of at least 60, leaves the newest part Unreleased and moves `package.json` and its sites to the last version
  it wrote; commit `CHANGELOG.md` and those files, then build with `BUMP=auto`.
- After a bump, commit it (`package.json`, `package-lock.json`, the synced version sites, `CHANGELOG.md`'s dated
  heading) before the install line. A bumped build tags its commit `v<version>` (local, never pushed).

Task resolves the global `VERSION` var once per `task` process: bumping and building in the same invocation would stamp
the Go binaries (and the `wsh-<version>-*` filenames) with the pre-bump version. That is why `tauri:build` shells out to
`tauri:build:post-bump` instead of using a nested `task:` call, and why the callee can't be marked `internal`.

## Installing a build (`task install`)

It installs the last `tauri:build` over the installed arcterm and reopens it: on Windows the installer with no pages
(`/P /UPDATE /R`), started through `wsh detach` from a terminal inside arcterm so arcterm's job does not kill it with
the app it closes; on a Mac `scripts/install-mac.mjs`, which quits arcterm, swaps in the built `arcterm.app` under
`/Applications` and reopens it from a detached process (so it works from a terminal inside arcterm; log in
`$TMPDIR/arcterm-install.log`, `--dry-run` to preview).

It closes the running arcterm and every agent in it, so an agent never runs it, even when asked to "build and
install": build, check the installer landed in `releases/`, finish the rest (commit, notes, what to try), then end the
turn with the installer path and `! task install` for the person to type.

## Go tests

On Windows prefix `go test` with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash), or every test that opens
the sqlite store panics with cgo off (`goTestEnv` in `scripts/verify.mjs` sets the same).

For a whole package, list your changed paths in a file (`git diff --name-only main > <file>`) and run
`ARC_VERIFY_CHANGED=<that file> node scripts/verify.mjs ./pkg/x ./pkg/y`: it tests only the packages those paths can
break and deals a large package's tests into batches of 20 (`BATCH_TESTS`), each its own process, 4 at a time.
`pkg/orchestrate` is ~1,250 tests, none parallel, adding up to ~1,300 s (2026-11-23): one plain `go test` process cannot
finish it inside go's 10-minute alarm, and this way takes 6 to 9 min. Keep go's default 10-minute timeout: it is per
process, and a batch takes ~20 s, so a run that reaches it holds a hung test, and the timeout's goroutine dump names it.
Before batches, a quarter of the package (~320 s) per process tripped it on a loaded machine with no test hung.

## Dev data and logs

- The dev app keeps its store, config, and WebView2 profile in `%LOCALAPPDATA%\dev.arc.app-dev\{data,config,EBWebView}`
  (isolated from a packaged install, which uses `dev.arc.app`). `task dev:cleardata` / `dev:clearconfig` clear `data` /
  `config`; stop the dev app first. Delete `EBWebView` by hand.
- The Tauri host writes wavesrv's stderr (including panic stacks), frontend `fe-log` lines, and its own `[tauri]` lines,
  timestamped, to `waveapp.log` in the data dir: `%LOCALAPPDATA%\dev.arc.app\data\` packaged, `dev.arc.app-dev\data\`
  dev. Past 10 MB it rolls to `waveapp.1.log` (one backup). `[tauri] wavesrv stderr closed` marks a backend exit.
- `npm run cockpit:fixtures -- <scenario>` injects a fixture roster into the dev app: it writes the scenario (source:
  `scripts/cockpit-fixtures/`) to `public/cockpit-fixtures/active.json`; reload the app to load it. `--clear` returns to
  live data; no argument lists scenarios.

## Stopping the dev app on Windows

The dev app and the user's packaged arcterm share the image names `wave-tauri.exe` and `wavesrv.x64.exe`, so
`taskkill /IM wave-tauri.exe` also kills the running arcterm, and every agent inside it (run 700db496 lost a worker's
uncommitted edits this way). List `Get-Process wave-tauri,wavesrv.x64 | Select Id,Path`, and stop only the PID whose path
is in a repo checkout (`src-tauri\target`, `dist\bin`), never one under `AppData\Local\arcterm` (or `AppData\Local\Arc`,
where installs from before the rename live).

## Claude Code mods

`claude/arc-mod/` is the Claude Code mod `wsh` embeds, straight from that folder (`claude/mods.go`, package `claude`;
there is no copy to keep in step). `wsh install-agent-hooks` writes it, minus tests, `testdata/` and
`.claude-plugin/types/` (`claude.Shipped`), to `~/.arc/claude-mod` and lists that folder in
`env.CLAUDE_CODE_PLUGIN_DIRS` of `~/.claude/settings.json`, so every claude launch loads it.

- Check it with `claude plugin validate claude/arc-mod`; `task check:ts` typechecks it (and the two below) with Claude
  Code's own strict options, against the `claude-code` types Claude Code writes beside the installed copy
  (`~/.arc/claude-mod/.claude-plugin/types/`, skipped with a note until a claude launch has written them), tests left
  to vitest. Its pure logic is in `hooks/*-core.ts`, tested by vitest.
- A mod has no `setTimeout` or other Node or DOM globals: wait with `$.clock`.
- A hook that fails is skipped (fails open), so every gating hook in `register.ts` names its choice with a `.catch`:
  `passOn` where arcterm's trouble must not hold the person's work, a refusal or an ask for a guard (the shell's
  `refusal`, the foreign-repo edit check, an `@mention`); `claude plugin validate` lists one without it.
- `claude/arc-view-mod/` (installed to `~/.arc/claude-view-mod`) draws the transcript rows of prompts the arc mod
  submits, and must stay its own plugin because Claude Code never runs a plugin's `ui.render` hook on a row that plugin
  raised. `claude plugin test` does not apply that rule, so judge a drawn row in a live session.
- `claude/skim-mod/` (installed to `~/.arc/claude-skim-mod`) holds the highlighted must-read sentences and `/skim`. It
  is also published on its own as `ttqteo/claude-skim`; `node scripts/publish-skim.mjs` copies it there, so edit
  `claude/skim-mod/`, never that repo.

## Skills

arcterm's own skills live in `skills/` (runs, cockpit, design, detach, doc-review, handoff, initiatives, brainstorm,
learn, notes, council, steps, ux-check, visual), embedded into `wavesrv` by `skills/skills.go`. Every agent-sync apply
(each agent launch) seeds them into the vault's skills root, which then projects them into each harness's skills dir,
except Claude's: it gets them in the installed arc mod (`~/.arc/claude-mod/skills/`, additions included), which lists
them as `arc:<skill>`. A skill's `.arc/` delta directory in the vault is kept. `pi/skills/arc-dev` belongs to the pi
package and stays there.

## App icon

`src-tauri/icons/icon.ico`, `icon.icns` and `icon.png` are generated by `node scripts/gen-app-icon.mjs`, which draws
every frame pixel-exact from the mark's grid. Don't regenerate them with `cargo tauri icon`: that downscales
`public/logos/arcterm.png` and blurs the pixel-art mark at taskbar sizes. Tauri takes the ICO's first frame as the
window icon, so the host replaces it with the exe's resource icons (`use_resource_window_icons` in
`src-tauri/src/main.rs`).

## Heavy commands and the job queue

Before every Bash command an agent runs, the Claude mod and the pi tools extension call `wsh jobslot`; a heavy one (a
build, the typecheck, a whole test suite, `npm install`; dev servers excluded) waits in wavesrv's queue
(`pkg/jobqueue`) until its RAM fits, and holds its slot while it runs. A single test file or `-run` filter is light and
never queues.

- Modes: `jobs:mode` `auto` (default) waits for RAM; `slots` also caps them at `jobs:slots` at once; `off` never waits;
  `jobs:pauseuntil` is off for a while. On macOS "fits" reads the OS memory pressure, on Windows the commit charge
  against the RAM.
- A `wsh protect` job goes ahead of the queue, starts once no heavy job runs, and holds every other heavy one back,
  engine steps included, whatever the mode, until its command exits.
- A heavy Claude command run with `run_in_background` waits inside its own shell instead (the mod puts
  `wsh jobslot --hold-parent` in front of it), and wavesrv holds the slot until that shell exits; the permission check
  still reads the command as written. The engine's Verify, Final and heavy Setup queue too.
- The commands and their RAM estimates are one table in `pkg/memgate/memgate.go`, the fallback: wavesrv measures each
  Claude Bash command's process-tree peak (`pkg/jobmeter`), keeps the last 5 per command pattern and project in
  `jobpeaks.json` in the data dir (`pkg/jobpeaks`) and admits the next run on the largest × 1.2, so a measured peak
  replaces the table's number; an unknown command (`make build`) measured at 1 GB or more queues too, which wavesrv
  tells `wsh jobslot` through `~/.arc/jobslot-learned.json` (written only by a wavesrv that installs the global hooks,
  not a dev app).

## Subagent cost: what the rules come from

- On 2026-10-08 a docs rewrite with four research subagents and a few real Claude agents staged for screenshots took
  the account from ~20M to ~220M tokens in an hour. ~200M of it went to subagents that `cat` whole files, then made ~140
  calls on a 400–566k context. Hence the research/writer split; the briefs are in `docs/agents/subagent-briefs.md`.
- The 2026-10-10 read-only survey of 21 Notion database schemas took sonnet ~207k tokens over 48 calls: a haiku job.
  A subagent whose job is to gather, not judge (list or fetch things, grep and report `path:line`, check a list against
  a source, the research half of the split) runs on haiku and returns raw facts. Design, review, root-cause debugging,
  writing code or prose, and any agent holding write tools where a slip is costly stay on sonnet or better.

## Worktrees

`task worktree:prepare` (run inside the worktree) junctions `node_modules`, `src-tauri/target`, `dist/bin` from the main
checkout so `task dev` there is fast instead of a cold npm+cargo install. `npm:install` (behind `task dev` and
`task check:ts`) skips the install when `node_modules` is a link, so both are safe in a junctioned worktree, an engine
run's included; a real `npm install` there would replace the junction with a full copy.

Remove with `task worktree:cleanup -- <path>`: it deletes the junction links first, never a real directory (a recursive
delete can follow a junction into the main checkout and wipe its `node_modules`), then runs `git worktree remove` and
`git branch -d`.

To run a worktree dev app beside the main one it needs its own everything: CDP port and WebView2 profile
(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9223"`, `WEBVIEW2_USER_DATA_FOLDER`), Vite port
(`task dev -- --config <json>` setting `build.devUrl` and a `beforeDevCommand` with `--port N --strictPort`), store
(`ARC_DEV_DATA_DIR`, a short path: wavesrv binds `data\wave.sock` under it, and Windows caps a unix socket path at 108
bytes), and its own `CARGO_TARGET_DIR` and `dist/bin` instead of the junctions, which a build writes through into the
main checkout. `ARC_DEV_NO_GLOBAL_INSTALL=1` keeps it from installing its hooks and `~/.arc/bin/wsh` over yours, and
keeps its wavesrv on a vault in its own data dir with no agent sync into your harnesses (`browser-app.mjs` always sets
it). `scripts/cdp/final-verify.mjs` does all of it and runs the scenarios itself, but only with an out dir: by hand,
`ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs <scenario...>` (without it, it exits 3 "ARC_FINAL_OUT is not
set"). Against a worktree app you started yourself, `CDP_PORT=<port> task verify:ui -- <scenario...>`.

## Visual verification

There is no jsdom/render-test harness for the cockpit: verify rendered UI by screenshotting the live dev app over the
Chrome DevTools Protocol. Tauri renders through WebView2 (Chromium/Edge on Windows), which speaks CDP.

- **Enable:** `src-tauri/src/main.rs` sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, gated by
  `#[cfg(debug_assertions)]` (compiled out of `cargo tauri build`, never ships).
- **Capture:** `node scripts/cdp-shot.mjs [out.png] [port]` discovers the page target (port defaults to `9222`; it
  ignores `CDP_PORT`) and writes a PNG (the page is the Vite app inside WebView2, `http://localhost:5174/`). The same
  attach pattern drives full CDP (`Runtime.evaluate` to read the DOM / jotai atoms, `Input.dispatchKeyEvent` for keys).
  `claude-in-chrome` MCP can't attach (needs Chrome + extension): use raw CDP.
- **On a Mac:** WKWebView answers no CDP. `task dev:browser` runs the cockpit in headless Chrome on CDP `:9222` (vite
  `:5180`; `-- --headed` to watch) with its own store (`~/Library/Application Support/dev.arc.app-browser`), then
  `task verify:ui -- <name>` as usual (on node 20, which has no global WebSocket, run
  `node --experimental-websocket scripts/cdp/verify.mjs <name>` instead; Final already passes the flag). It is
  Chromium, like WebView2, not WebKit, and has no Tauri host: a WebKit-only bug, or a scenario marked `host: true`,
  needs the real app.
- **Scenario harness:** `task verify:ui -- <name...>` (→ `scripts/cdp/verify.mjs`) runs each scenario in
  `scripts/cdp/scenarios.mjs` as arrange → goto → shot → assert → teardown, prints a PASS/FAIL table, writes a contact
  sheet to `cdp-shots/index.html`, and exits nonzero on failure. With no names it runs every scenario. Shared attach
  logic is in `scripts/cdp/attach.mjs`.
- **A scenario that needs a run with a DAG** follows `docs/reference/cdp-run-fixtures.md`.
- **Test data:** `node scripts/inject-live-agents.mjs <scenario>` (see that script's header).
- **Motion:** `node scripts/cdp/motion-trace.mjs` watches a change frame by frame (a change drawn in one frame prints as
  a `SNAP`). On 2026-11-23 a board's turns column shipped with no fold motion, and the fold added for it left the column
  stuck 32px wide when Collapse came mid-slide; only the frame trace showed it.

## CHANGELOG markup

The app shows `CHANGELOG.md`'s lines as What's new. The top section stays `Unreleased` until its build, when the bump
replaces that word with the build date; if the top section already has a date, open a new `## Unreleased` above it.

- A line about something the user can open ends with `<!-- try: <global binding id> -->` for its Try it button.
- A new feature worth opening the app to try ends with `<!-- big -->`, which makes it one of its release's (at most 5)
  cards (the file's header says how). A new feature with UI the person would open to try is big: don't leave it
  unmarked to skip its picture, since a big line is also what makes the next build a minor.
- A big line ends with its picture, `<!-- shot: <file> -->`, or with `<!-- shot: none -->` when there is nothing to
  picture (a `wsh` command, a behaviour); `whatsnew.test.ts` fails one with neither, in Unreleased and from 1.9.0 on.
- Make the picture from the dev app with the feature on screen: `node scripts/whatsnew-shot.mjs <topic> [--selector
  <css>]` (`CDP_PORT` for a worktree app) writes `public/whatsnew/<next minor>-<topic>.webp`, 2:1 and under 120 KB, and
  prints the comment; in the scenario that shows the feature, `await h.whatsnewShot("<topic>", { selector })` does the
  same, so a Final run leaves it in the run's tree.
- A merge conflict in it keeps both sides' lines.

## Engine plans for this repo

Plans the engine runs (`wsh runs start --plan <file>`, or + Run → Orchestrator → A plan file; a lead hands its own plan
over with `wsh jarvis dag submit --plan`) follow `jarvis.PlanFormat` (`pkg/jarvis/plan.go`; the guide is
`docs/guide/plan-format.md`).

- **Header lines:** optional `**Verify:**`, `**Setup:**`, `**Check:**` and `**Final:**` commands in backticks before
  the first task, which run in a POSIX shell (Git Bash on Windows), and an optional `**Prototype:**` design-canvas path
  (not in backticks; absolute, since `.superpowers/` is gitignored and a run's worktree has no copy).
- **Setup:** a plan with no Setup line runs the project's checked-in `.arc/setup` (one command) instead; this repo's
  junctions the main checkout's `node_modules`, `src-tauri/target` and `dist/bin`. With neither, the engine junctions
  the main checkout's installed `node_modules` into each tree where the manifests match (`pkg/orchestrate/linkdeps.go`).
- **Verify** for this repo is `node scripts/verify.mjs <go package patterns>`: at each merge it tests only what the
  merge changed (the engine's `ARC_VERIFY_CHANGED`), and in the final stage everything the patterns name plus the
  frontend typecheck and vitest. A merge never typechecks (one tsc is 80 to 120 s and holds the next merge), so a plan
  whose tasks touch the frontend also puts `task check:ts` in its Check.
- **Final** runs once on the merged result with `ARC_FINAL_OUT` set: exit 0 passes, exit 3 means it could not verify
  (its last output line says why), anything else fails; for this repo it is
  `node scripts/cdp/final-verify.mjs [scenario...]`. On a Mac the same Final runs the scenarios in headless Chrome
  (`final-verify.mjs` starts `task dev:browser`, `scripts/cdp/browser-app.mjs`, a browser build of the cockpit with
  Tauri's modules swapped for the stand-ins in `frontend/tauri/browsershim/`). A scenario marked `host: true` drives
  the Tauri host itself and is skipped there, which ends that Final unverified; WebKit-only behaviour stays a hand
  check. Don't add a `uname -s` guard to a Final.
- **Scenarios:** name a scenario (`scripts/cdp/scenarios.mjs`) for each UI the plan changes, and have each task that
  builds a view, visual state or interaction name the step that shows it, adding the step if none does (opening the
  surface it sits on does not count; with a Prototype, every board in its folder needs one). Final starts its own dev
  app, runs only the named scenarios (a name no scenario has fails it before the app starts) and stops the app, and the
  final verifier judges only their screenshots, so a UI no scenario opens goes unverified.
- **Tasks** are `### Task N: <title>` (or `##`) headings numbered 1, 2, 3…, with, as a task's first line, an optional
  `**Depends on:**` — `none`, or `Task 1, Task 3`; left out, the task runs after the previous one, so a plan with no
  Depends lines is serial. The engine runs tasks with nothing between them at the same time, so split a plan by what
  can proceed independently: the Depends lines set its width.
- At submit an engine plan reviewer checks the plan against the spec before any worker starts; a failed review goes
  back to the lead to revise and resubmit.
- Engine runs land on `wave/<runId>` (`--landing checkout` opts out) and the engine merges the branch back into the
  base with `--no-ff` when the run completes, holding it with a reason when it cannot; `docs/guide/orchestrator.md` has
  the details.
