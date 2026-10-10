# AGENTS.md

Guidance for AI coding agents working in this repository — the single project instruction file,
read by both Pi and Claude Code (which loads `AGENTS.md` for a project that has no `CLAUDE.md`).

Personal working-style conventions are projected into every harness by arcterm (`~/.claude/CLAUDE.md`,
`~/.pi/agent/AGENTS.md`) and apply here too; they are not repeated in this file.

## Project status

arcterm — an agent cockpit for driving and supervising coding agents. It began as a fork of Wave Terminal (the code still uses Wave names: `wavesrv`, `wsh`, `waveobj`); the desktop shell was **migrated from Electron to Tauri**. `main` is the Tauri build; the original Electron shell was removed from `main` and preserved on the `legacy/electron` branch.

Consequences that matter while working here:

- The upstream Electron-era docs are **gone** (2026-07-31 cleanup): `BUILD.md`, `CONTRIBUTING.md`, `RELEASES.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, the whole Docusaurus site under `docs/`, and `aiprompts/` were deleted; `README.md` was rewritten for arcterm. Trust the Taskfile and this file for run/build flow. `docs/README.md` maps what remains.
- Tauri packaging targets **Windows** (`cargo tauri build` → NSIS; bundles `wavesrv.x64.exe` + `wsh-*-windows.x64.exe`) and **macOS on Apple silicon** (`src-tauri/tauri.macos.conf.json`, merged over `tauri.conf.json` on a Mac → `.app` + `.dmg`, ad-hoc signed, not notarized; bundles `wavesrv.arm64` + `wsh-*-darwin.arm64`, macOS 13+). On an 8 GB Mac the Vite build and `task check:ts` exhaust Node's default heap: prefix them with `NODE_OPTIONS=--max-old-space-size=4096`.

## Build & dev commands

The build is orchestrated by [Task](https://taskfile.dev) (`Taskfile.yml`), a `make` replacement. Tasks chain Go, Rust, and npm steps.

| Command | What it does |
|---|---|
| `task init` | First-time setup: `npm install` + `go mod tidy`. |
| `task dev` (alias of `task tauri:dev`) | The main way to run. Builds the dev-host backend only (wavesrv + host wsh), syncs `pi/` artifacts and the version, then `cargo tauri dev` (Vite dev server on `:5174`, HMR). |
| `task build:backend` | Release backend build into `dist/bin/`: `wavesrv` (stripped windows x64 on Windows; arm64 + amd64 on a Mac) and `wsh` for the one target the host's bundle ships — windows x64 on Windows, darwin arm64 on a Mac. |
| `task build:backend:quickdev:windows` | Rebuilds only `wavesrv` (no wsh, no generate) — the fast loop for Go server changes. |
| `task generate` | Regenerates TS + Go bindings from Go source. **Run after changing any wshrpc / waveobj / wconfig type.** |
| `task check:ts` | Typecheck the frontend (see the tsc gotcha below). |
| `npm test` / `npx vitest` | Frontend unit tests (vitest). |
| `task tauri:build` (alias `build:app`, and what `npm run build` now runs) | Production build: syncs the version into every version site, builds the backend, then `cargo tauri build`, and copies the installer (`.exe`, or `.dmg` on a Mac) into the gitignored `releases/` at the repo root. It does not bump by default (`BUMP=none`); for a release pass `BUMP=patch\|minor\|major` and commit the bump. |
| `task install` | Install the last `tauri:build` over the installed arcterm and reopen it: on Windows the installer with no pages (`/P /UPDATE /R`); on a Mac `scripts/install-mac.mjs`, which quits arcterm, swaps in the built `arcterm.app` under `/Applications` and reopens it from a detached process (so it works from a terminal inside arcterm; log in `$TMPDIR/arcterm-install.log`, `--dry-run` to preview). It closes the running arcterm and every agent in it, so an agent never runs it on its own. |
| `task check:version` | Fail if `package.json`'s version has drifted from `src-tauri/tauri.conf.json` or `src-tauri/Cargo.toml`. `package.json` is the single source of truth; `scripts/sync-tauri-version.mjs` holds the list of sites. |
| `npm run cockpit:fixtures -- <scenario>` | Inject a fixture roster into the dev app: writes the scenario (source: `scripts/cockpit-fixtures/`) to `public/cockpit-fixtures/active.json`; reload the app to load it. `--clear` returns to live data; no argument lists scenarios. |

Other useful commands:

- **Single frontend test:** `npx vitest run frontend/app/view/agents/projectname.test.ts`, or filter by name: `npx vitest run -t "handles backslash paths"`.
- **Go tests:** one test is `go test ./pkg/x -run '^TestName$'`. For a whole package, list your changed paths in a file and run `ARC_VERIFY_CHANGED=<that file> node scripts/verify.mjs ./pkg/x ./pkg/y` (`git diff --name-only main > <file>`): it tests only the packages those paths can break and deals a large package's tests across 4 processes. `pkg/orchestrate` is ~760 tests and ~6,000 git launches: 4 to 7 min as plain `go test`, under 2 min this way. Keep go's default 10-minute timeout: a run that reaches it holds a hung test, and the timeout's goroutine dump names it.
- **Rust tests:** `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Lint / format:** flat ESLint config (`eslint.config.js`) + Prettier (`prettier.config.cjs`), but **no Task/npm wrapper** — run `npx eslint` and `npx prettier --check` directly, **on paths**: `npx eslint .` also walks the worktree copies under `.worktrees/` and `.claude/worktrees/`.
- **HEAD is not formatter-clean** (`gofmt -l pkg cmd` lists ~50 files; prettier fails in places too). Check only the files you touched; never `--write` the tree. Never run prettier on `scripts/*.mjs` — `.editorconfig` omits `.mjs`, so prettier reindents those hand-formatted 4-space files to 2.
- **Clear dev data:** the dev app keeps its store, config, and WebView2 profile in `%LOCALAPPDATA%\dev.arc.app-dev\{data,config,EBWebView}` (isolated from a packaged install, which uses `dev.arc.app`). `task dev:cleardata` / `dev:clearconfig` clear `data` / `config`; stop the dev app first. Delete `EBWebView` by hand.
- **Logs:** the Tauri host writes wavesrv's stderr (including panic stacks), frontend `fe-log` lines, and its own `[tauri]` lines, timestamped, to `waveapp.log` in the data dir: `%LOCALAPPDATA%\dev.arc.app\data\` packaged, `dev.arc.app-dev\data\` dev. Past 10 MB it rolls to `waveapp.1.log` (one backup). `[tauri] wavesrv stderr closed` marks a backend exit.

### Gotchas

- **`npx tsc` stack-overflows on this repo.** Typecheck with `task check:ts` (it runs `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`). It takes ~2 minutes — give the command a longer timeout than the 2-minute default. The baseline is clean (exit 0) — any error it reports is yours.
- **Task resolves the global `VERSION` var once per `task` process.** Bumping the version and building in the same invocation stamps the Go binaries (and the `wsh-<version>-*` filenames) with the *pre-bump* version. That is why `tauri:build` shells out to `tauri:build:post-bump` instead of using a nested `task:` call — and why the callee can't be marked `internal`.
- **Never hand-edit generated files, including merge conflicts.** Go is the source of truth for the wire protocol and object types; `task generate` writes `frontend/app/store/wshclientapi.ts`, `frontend/app/store/services.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`, and `pkg/{waveobj,wconfig}/metaconsts.go`. Edit the Go definitions, then regenerate.
- **`pi/` is the source for the pi artifacts `wsh` embeds.** `task sync:piartifacts` (run by every dev and backend build) copies `pi/extensions/*` and `pi/themes/arc.json` over `cmd/wsh/cmd/pi-*-extension.ts` and `cmd/wsh/cmd/arc-theme.json` — edit `pi/`, never the copies.
- **`claude/arc-mod/` is the source for the Claude Code mod `wsh` embeds.** `task sync:claudemod` (run by every dev and backend build) copies it, minus tests, to `cmd/wsh/cmd/claude-mod/` — edit `claude/`, never the copy. `wsh install-agent-hooks` writes it to `~/.arc/claude-mod` and lists that folder in `env.CLAUDE_CODE_PLUGIN_DIRS` of `~/.claude/settings.json`, so every claude launch loads it. Check it with `claude plugin validate claude/arc-mod`; its pure logic is in `hooks/*-core.ts`, tested by vitest. `claude/arc-view-mod/` is a second mod that travels the same way (embed `claude-view-mod`, installed to `~/.arc/claude-view-mod`): it draws the transcript rows of prompts the arc mod submits, and must stay its own plugin because Claude Code never runs a plugin's `ui.render` hook on a row that plugin raised. `claude plugin test` does not apply that rule, so judge a drawn row in a live session.
- **arcterm's own skills live in `skills/`** (cockpit-runs, cockpit-ui, design-local, effort-tracking), embedded into `wavesrv` by `skills/skills.go`. Every agent-sync apply (each agent launch) seeds them into the vault's skills root, which then projects them into each harness's skills dir — edit `skills/`, never the vault or `~/.claude/skills` copies, which the next launch overwrites. A skill's `.arc/` delta directory in the vault is kept. `pi/skills/arc-dev` belongs to the pi package and stays there.
- **`src-tauri/icons/icon.ico`, `icon.icns` and `icon.png` are generated by `node scripts/gen-app-icon.mjs`**,
  which draws every frame pixel-exact from the mark's grid. Don't regenerate it with `cargo tauri icon`: that downscales
  `public/logos/arcterm.png` and blurs the pixel-art mark at taskbar sizes. Tauri takes the ICO's first
  frame as the window icon, so the host replaces it with the exe's resource icons
  (`use_resource_window_icons` in `src-tauri/src/main.rs`).
- **A new registered `waveobj` type needs a SQL migration** in `db/migrations-wstore/NNNNNN.{up,down}.sql`, or it fails at runtime with "no such table".
- **Stop the dev app by PID, never by image name.** The dev app and the user's packaged arcterm share the
  image names `wave-tauri.exe` and `wavesrv.x64.exe`, so `taskkill /IM wave-tauri.exe` also kills the
  running arcterm — and every agent inside it (run 700db496 lost a worker's uncommitted edits this way).
  List `Get-Process wave-tauri,wavesrv.x64 | Select Id,Path`, and stop only the PID whose path is in a
  repo checkout (`src-tauri\target`, `dist\bin`), never one under `AppData\Local\arcterm` (or
  `AppData\Local\Arc`, where installs from before the rename live).
- **A heavy shell command waits its turn, and can come back "Not run: …".** Before every Bash command an agent
  runs, the Claude mod and the pi tools extension call `wsh jobslot`; a heavy one (a build, the typecheck, a whole test
  suite, `npm install`; dev servers excluded) waits in wavesrv's queue (`pkg/jobqueue`) until its RAM fits (by default,
  `jobs:mode` `auto`; `slots` also caps them at `jobs:slots` at once, `off` never waits, and `jobs:pauseuntil` is off
  for a while; on macOS "fits" reads the OS memory pressure), and holds its slot while it runs. The engine's Verify,
  Final and heavy Setup queue too. A command the person skipped from the Jobs popover comes back "Not run: …": don't
  retry it — carry on and report it skipped. The commands and their RAM estimates are one table in
  `pkg/memgate/memgate.go`; a single test file or `-run` filter is light and never queues.
- **Say what a fan-out will cost before starting it.** Token cost grows as context size × tool calls × agents,
  and almost all of it is cache reads: on 2026-10-08 a docs rewrite with four research subagents and a few real Claude
  agents staged for screenshots took the account from ~20M to ~220M tokens in an hour. Before you launch several
  subagents, a workflow, or real agents (demo agents, an engine run), give a rough estimate and ask, or take the cheap
  path: one agent, narrow reads, existing docs. Never launch real agents only to stage screenshots without asking. The
  5-hour meter is in the app bar: when it climbs fast mid-task, say so and offer to stop.
- **A subagent that reads a lot of code to write something gets split in two.** A research subagent reads and returns
  a short fact sheet with `path:line` for each fact; a fresh writing subagent works from the sheet and reads no code;
  one page per writer. The 2026-10-08 rewrite's ~200M went to subagents that `cat` whole files, then made ~140 calls
  on a 400–566k context. Paste the briefs in `docs/agents/subagent-briefs.md` into the prompts.
- CGO backend builds use the **zig** compiler for cross/static linking (required dependency, see `Taskfile.yml` `build:server:*`).
- **Worktrees (Windows):** `task worktree:prepare` (run inside the worktree) junctions `node_modules`,
  `src-tauri/target`, `dist/bin` from the main checkout so `task dev` there is fast instead of a cold
  npm+cargo install. It does not copy `.task/checksum/npm-install`, so the first `task dev` in a worktree
  runs a real `npm install` that replaces the `node_modules` junction — copy that checksum file from the
  main checkout first. Remove with `task worktree:cleanup -- <path>` — it deletes the junction links
  first, never a real directory (a recursive delete can follow a junction into the main checkout and
  wipe its `node_modules`), then runs `git worktree remove` and `git branch -d`. To run a worktree dev app beside the main one it needs its own everything:
  CDP port and WebView2 profile (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9223"`,
  `WEBVIEW2_USER_DATA_FOLDER`), Vite port (`task dev -- --config <json>` setting `build.devUrl` and a
  `beforeDevCommand` with `--port N --strictPort`), store (`ARC_DEV_DATA_DIR`, a short path: wavesrv binds
  `data\wave.sock` under it, and Windows caps a unix socket path at 108 bytes), and its own `CARGO_TARGET_DIR`
  and `dist/bin` instead of the junctions, which a build writes through into the main checkout.
  `ARC_DEV_NO_GLOBAL_INSTALL=1` keeps it from installing its hooks and `~/.arc/bin/wsh` over yours.
  `scripts/cdp/final-verify.mjs` does all of it; then `CDP_PORT=<port> task verify:ui`.

### Visual verification (dev)

There is no jsdom/render-test harness for the cockpit — verify rendered UI by screenshotting the **live dev app** over the Chrome DevTools Protocol. Tauri renders through WebView2 (Chromium/Edge on Windows), which speaks CDP.

- **Enable:** `src-tauri/src/main.rs` sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, gated by `#[cfg(debug_assertions)]` (compiled out of `cargo tauri build` — never ships).
- **Capture:** `node scripts/cdp-shot.mjs [out.png] [port]` — discovers the page target (port defaults to `9222`; it ignores `CDP_PORT`) and writes a PNG (the page is the Vite app inside WebView2, `http://localhost:5174/`). The same attach pattern drives full CDP (`Runtime.evaluate` to read the DOM / jotai atoms, `Input.dispatchKeyEvent` for keys). `claude-in-chrome` MCP can't attach (needs Chrome + extension) — use raw CDP.
- **Scenario harness:** `task verify:ui -- <name...>` (→ `scripts/cdp/verify.mjs`) runs each scenario in `scripts/cdp/scenarios.mjs` as arrange → goto → shot → assert → teardown, prints a PASS/FAIL table, writes a contact sheet to `cdp-shots/index.html`, and exits nonzero on failure. With no names it runs every scenario. Prefer this over ad-hoc `cdp-shot.mjs` when a repeatable check exists; shared attach logic is in `scripts/cdp/attach.mjs`.
- **A scenario that needs a run with a DAG** follows `docs/reference/cdp-run-fixtures.md`: the arrange, seed and teardown helpers already exist in `scenarios.mjs`.
- **Inject test data first** if you need a populated cockpit: `node scripts/inject-live-agents.mjs <scenario>` (see that script's header).

## Architecture

Three layers, all part of the running app. **Full map: `docs/reference/architecture.md`** — read it
before working in an area you don't already know.

- **Tauri shell — Rust (`src-tauri/`)** — thin native host replacing the Electron main process. Mints
  a per-launch auth key, spawns `wavesrv` as a child, parses its `WAVESRV-ESTART` stderr line for the
  dynamic ports, and runs `wsh install-agent-hooks` on every launch. Eight Tauri commands only (listed in
  `docs/reference/architecture.md`); the window is borderless and the titlebar is drawn in React.
- **Go backend (`cmd/`, `pkg/`)** — `wavesrv` (SQLite object store + HTTP + websocket RPC) and `wsh`
  (CLI helper shipped into terminals). **Agents report into and drive the cockpit through `wsh`**
  (`wsh agent-hook`, `wsh ask`; `wsh runs`, `wsh agents`, `wsh ui`, `wsh effort`). The launch-time
  `install-agent-hooks` writes the Claude Code hooks into
  `~/.claude/settings.json` and the pi/opencode extensions, all pointing at a fixed copy under
  `~/.arc/bin/` — not PATH. The managed hook list is `cmd/wsh/cmd/wshcmd-installhooks.go`.
- **Frontend — React 19 + Vite + Tailwind 4 + jotai (`frontend/`)** — `frontend/tauri/main.tsx` is the
  sole shipping entry. The cockpit is **one window with N surfaces, not tabs**. Surface keys are not
  their labels: `files` renders as "Diff"; the order is
  `SURFACE_ORDER` in `frontend/app/view/agents/agents.tsx`. Past conversations are not a surface: Conversation History and an
  ended session's transcript are centre modes of Agent (`centerModeAtom`, `view/agents/agentcenter.ts`; open them with
  `showHistory` / `showSession`, and `showTerminal` whenever a route chooses an agent).

Load-bearing rules:

- **`pkg/wshrpc` is the spine** — the typed RPC system spanning frontend ↔ wavesrv ↔ wsh ↔ remote.
  Nearly all cross-process behavior is a wshrpc command, composed from per-domain `wshrpctypes_*.go`.
- **Don't re-port Electron-IPC-shaped contracts** — build the Tauri-native primitive and let the old
  method die.
- **Only the Agent surface stays mounted** when off-screen (so its live xterm is never torn down and
  re-fitted at a stale size). Every other surface unmounts on switch — surface-local `useState` is
  lost, so persist anything survival-worthy in a per-entity jotai atom. Cross-surface concerns live in
  the always-mounted shell, not in a surface.
- **The Agent surface's terminal stack is one CSS grid parent that is always rendered, never conditionally.** It is a
  deliberate exception to DESIGN.md's "grid only for card grids" (a 2x2 of live terminals, not a card grid): don't "fix"
  it back to flex. Every agent and terminal that has a block keeps its cell wrapper under it with a stable `key`, and its
  `CockpitFocusPane` once mounted stays mounted until its terminal closes; `panemounts.ts` mounts the app's own agents
  and terminals the first time they show (so the first load does not replay them all at once), and one opened later at
  once. `agentgrid.ts` / `gridstore.ts` only decide which panes show and where (inline `gridRow`/`gridColumn`; the rest
  `hidden`), and only agents can be cells. Re-parenting a pane or rendering the stack conditionally remounts the xterm
  and replays the TUI. Panes refit through `term.tsx`'s ResizeObserver, so keep the tracks `minmax(0, 1fr)`, the cells
  `min-w-0 min-h-0`, and nothing animating a cell's size.
- **`focusIdAtom` stays the one "selected agent".** `AgentSurface` reconciles the saved grid against it, so every route
  that selects an agent obeys one rule; the grid never overrides a focused agent, it is only the fallback when nothing is
  in focus.
- **Opening an item on another surface goes through the one router**, `frontend/app/view/jarvis/openref.ts`
  (`openAddress` for a string, `openTarget` for an id): it loads the target, writes the destination's
  selection, then switches surface. Don't hand-roll set-selection-then-`surfaceAtom`.
- **Keybindings:** every binding is defined in `frontend/app/store/keybindings/bindings.ts` (a
  `build<Surface>Bindings()` per surface, plus global), but each surface activates its own with
  `useKeybindings(...)` in its component body — there is no central activation point.
  `docs/keyboard-shortcuts.md` mirrors the bindings.
- **`pkg/orchestrate`** is the deterministic DAG engine behind orchestrator runs (worktrees, lanes,
  merges, Setup/Verify); UI in `frontend/app/view/orchestrate`. The plan gate, task cap, adaptive
  orchestration, and pipeline mode are gone; leads are claude + pi, and task workers are claude, pi, agy and codex —
  older specs still describe the removed model; `docs/guide/orchestrator.md` is current.

### Frontend conventions

- **Testable logic is extracted, not rendered.** The pattern throughout `frontend/app/view/*` and `frontend/app/cockpit/` is a pure `foo.ts` (derive/model/reducer) with a `foo.test.ts` beside it, consumed by a thin `foo.tsx`. There are deliberately **no jsdom render/snapshot tests** — "does it render" is covered by the CDP `surface-smoke` scenario. When wiring is risky, extract it to a model and unit-test that.
- **UI design work follows `DESIGN.md` (repo root)** — design tokens, typography, layout, motion,
  and the do's and don'ts. Read it before planning or styling new UI. Mockups are `.dc.html`
  canvases made with the `design-local` skill under the gitignored `.superpowers/design/<topic>/`,
  never committed (DESIGN.md "Mockups").
- **Colors come from `@theme` tokens in `frontend/tailwindsetup.css`** — never raw hex/rgba in components. Runtime theming (`view/agents/themes.ts` + `themestore.ts`) works by overriding those same `--color-*` custom properties on `document.documentElement`, so a hardcoded color silently opts out of every theme. `pi/themes/arc.json` is the exception — it is a TUI theme file.
- Prefer Tailwind over new SCSS.

## Design docs

- Specs and plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`, named `YYYY-MM-DD-<topic>[-design].md`. Specs are kept; a plan is deleted once it ships (git history keeps it). Briefs (`docs/superpowers/briefs/`) are kept only while something live cites them.
- Live issue trackers: `docs/open-issues.md` (the single "what's left" list) and `docs/orchestrator-redesign-flaws.md` (the orchestrator engine). `docs/README.md` maps the rest of `docs/`.
- Deliberately-deferred items and fabricated placeholder data: `docs/deferred.md`.
- **`CHANGELOG.md` (repo root):** a change a user would notice adds one line under `Added`, `Changed` or `Fixed` in its top section, in the same commit, written for the user rather than copied from the commit subject. Internals (tests, specs, plans, build scripts) stay out. The top section stays `Unreleased` until its build, when the bump replaces that word with the build date; if the top section already has a date, open a new `## Unreleased` above it.
- Agent-cockpit integration notes (hooks, ask protocol, usage reporting): `docs/agents/`.
- **Plans the engine runs** (`wsh runs start --plan <file>`, or + Run → Orchestrator → A plan file; a lead hands its own plan over with `wsh jarvis dag submit --plan`) follow `jarvis.PlanFormat` (`pkg/jarvis/plan.go`): optional `**Verify:**`, `**Setup:**`, `**Check:**` and `**Final:**` commands in backticks before the first task, which run in a POSIX shell (Git Bash on Windows), and an optional `**Prototype:**` design-canvas path (not in backticks; absolute, since `.superpowers/` is gitignored and a run's worktree has no copy). A plan with no Setup line runs the project's checked-in `.arc/setup` (one command) instead; this repo's junctions the main checkout's `node_modules`, `src-tauri/target` and `dist/bin`. Final runs once on the merged result with `ARC_FINAL_OUT` set: exit 0 passes, exit 3 means it could not verify (its last output line says why), anything else fails; for this repo it is `node scripts/cdp/final-verify.mjs [scenario...]`. A plan run on a Mac keeps a Final but guards it: WKWebView answers no CDP, so plain `final-verify` builds a whole dev app and waits ~10 minutes only to report unverified, and the plan reviewer fails a plan with no Final. Use `if [ "$(uname -s)" = Darwin ]; then echo "unverified: <scenario> needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs <scenario>`, which still runs the scenarios on Windows. Name a scenario (`scripts/cdp/scenarios.mjs`) for each UI the plan changes, and have each task that builds a view, visual state or interaction name the step that shows it, adding the step if none does (opening the surface it sits on does not count; with a Prototype, every board in its folder needs one): Final starts its own dev app, runs only the named scenarios and stops the app, and the final verifier judges only their screenshots, so a UI no scenario opens goes unverified. For this repo, Verify is `node scripts/verify.mjs <go package patterns>`: at each merge it tests only what the merge changed (the engine's `ARC_VERIFY_CHANGED`), and in the final stage everything the patterns name plus vitest. Tasks are `### Task N: <title>` (or `##`) headings numbered 1, 2, 3…, with, as a task's first line, an optional `**Depends on:**` — `none`, or `Task 1, Task 3`; left out, the task runs after the previous one, so a plan with no Depends lines is serial. The engine runs tasks with nothing between them at the same time, so split a plan by what can proceed independently — the Depends lines are what set its width. At submit an engine plan reviewer checks the plan against the spec before any worker starts; a failed review goes back to the lead to revise and resubmit.
- **Engine runs land on `wave/<runId>`** (`--landing checkout` opts out) and the engine merges the branch back into the base with `--no-ff` when the run completes, holding it with a reason when it cannot; `docs/guide/orchestrator.md` has the details.
