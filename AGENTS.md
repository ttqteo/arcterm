# AGENTS.md

Guidance for AI coding agents working in this repository — the single project instruction file,
read by both Pi and Claude Code (which loads `AGENTS.md` for a project that has no `CLAUDE.md`).
Personal working-style conventions are projected into every harness by arcterm (`~/.claude/CLAUDE.md`,
`~/.pi/agent/AGENTS.md`) and are not repeated here.

This file keeps the rules. The how and the why behind them are in `docs/reference/dev-workflow.md` (build, release,
tests, mods, job queue, worktrees, CDP, changelog markup, engine plans) and `docs/reference/architecture.md`: read the
section you need before working in that area.

## Project status

arcterm — an agent cockpit for driving and supervising coding agents. It began as a fork of Wave Terminal (the code
still uses Wave names: `wavesrv`, `wsh`, `waveobj`); `main` is the Tauri build (the Electron shell is on
`legacy/electron`). The upstream docs are gone: trust the Taskfile and this file for run/build flow; `docs/README.md`
maps what remains. Packaging targets Windows (NSIS) and macOS on Apple silicon (`.app` + `.dmg`, self-signed
`arcterm_local_mac`). On an 8 GB Mac prefix the Vite build and `task check:ts` with
`NODE_OPTIONS=--max-old-space-size=4096`.

## Build & dev commands

Builds run through [Task](https://taskfile.dev) (`Taskfile.yml`), chaining Go, Rust and npm steps.

| Command | What it does |
|---|---|
| `task init` | First-time setup: `npm install` + `go mod tidy`. |
| `task dev` | The main way to run: dev backend (wavesrv + host wsh), syncs `pi/` artifacts and the version, then `cargo tauri dev` (Vite on `:5174`, HMR). |
| `task build:backend` | Release backend into `dist/bin/` (wavesrv + wsh for the host's bundle). |
| `task build:backend:quickdev:windows` | Rebuilds only `wavesrv`: the fast loop for Go server changes. |
| `task generate` | Regenerates TS + Go bindings. **Run after changing any wshrpc / waveobj / wconfig type.** |
| `task check:ts` | Typecheck the frontend, then the Claude Code mods under `claude/`. ~2 min: give it a longer timeout. |
| `npm test` / `npx vitest run <file>` / `-t "<name>"` | Frontend unit tests. |
| `go test ./pkg/x -run '^TestName$'` | One Go test. A whole package: `ARC_VERIFY_CHANGED=<file of changed paths> node scripts/verify.mjs ./pkg/x` (batches; needed for `pkg/orchestrate`). On Windows prefix with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust tests. |
| `task tauri:build` | Production build of a **commit** (not the working tree) into `releases/`, which keeps the newest 3 installers. Commit first. **An agent that builds for the person to install passes `BUMP=auto` unasked** and commits the bump; never a patch, major only by hand. Bump rules and the 120-line changelog split: dev-workflow "Release builds". |
| `task install` | Installs the last build over the running arcterm, closing it and **every agent in it**: an agent never runs it. Build, check the installer landed in `releases/`, finish the rest, then end the turn with the installer path and `! task install` for the person to type. |
| `task check:version` | Fail if `package.json`'s version drifted from the Tauri sites (`package.json` is the source of truth). |

### Gotchas

- **`npx tsc` stack-overflows on this repo.** Use `task check:ts`. Its baseline is clean: any error it reports is yours.
- **Never hand-edit generated files, including merge conflicts.** `task generate` writes
  `frontend/app/store/wshclientapi.ts`, `services.ts`, `frontend/types/gotypes.d.ts`, `waveevent.d.ts`,
  `pkg/wshrpc/wshclient/wshclient.go` and `pkg/{waveobj,wconfig}/metaconsts.go`: edit the Go definitions, regenerate.
- **Edit sources, never their copies:** `pi/` (not `cmd/wsh/cmd/pi-*-extension.ts` / `arc-theme.json`);
  `claude/arc-mod/`, `claude/arc-view-mod/`, `claude/skim-mod/` (not `~/.arc/claude-*` or the `ttqteo/claude-skim`
  repo); `skills/` (not the vault, `~/.arc/claude-mod/skills` or `~/.claude/skills`). Mod rules (no `setTimeout`, wait
  with `$.clock`; every gating hook names its `.catch`; `claude plugin validate claude/arc-mod`): dev-workflow
  "Claude Code mods".
- **App icons come from `node scripts/gen-app-icon.mjs`**, never `cargo tauri icon` (it blurs the pixel-art mark).
- **A new registered `waveobj` type needs a SQL migration** in `db/migrations-wstore/NNNNNN.{up,down}.sql`.
- **Lint and format only the paths you touched** (`npx eslint <paths>`, `npx prettier --check <paths>`): HEAD is not
  formatter-clean, `npx eslint .` walks the worktree copies, and never `--write` the tree. Never run prettier on
  `scripts/*.mjs` (hand-formatted 4-space files).
- **On Windows:** run builds and long scripts through Bash, not PowerShell 5.1 (it turns stderr into errors and strips
  JSON quotes); write files with the Write tool and edit with Edit, not heredocs or `sed -i`. **Stop the dev app by
  PID, never by image name**: it shares `wave-tauri.exe` / `wavesrv.x64.exe` with the person's arcterm (dev-workflow
  "Stopping the dev app").
- **A heavy shell command waits its turn** in wavesrv's job queue (`wsh jobslot`, `pkg/jobqueue`), and **a subagent or
  workflow spawn waits on a Token burn card** (`wsh tokengate`). Either can come back "Not run: …": that is the
  person's call. Don't retry it; carry on and report it skipped (or do the work in the session).
- **Say what a fan-out will cost before starting it.** Cost grows as context × tool calls × agents, almost all cache
  reads. Before several subagents, a workflow or real agents (an engine run, demo agents), estimate and ask, or take the
  cheap path. Never launch real agents only to stage screenshots without asking. A subagent that reads a lot of code to
  write gets split: a research subagent returns `path:line` facts, a fresh writer works from them
  (`docs/agents/subagent-briefs.md`). A subagent that only collects runs on haiku. Why: dev-workflow "Subagent cost".
- **Worktrees:** `task worktree:prepare` junctions the main checkout's `node_modules`, `src-tauri/target`, `dist/bin`;
  remove one only with `task worktree:cleanup -- <path>` (a recursive delete follows the junctions into the main
  checkout). A second dev app beside the main one: dev-workflow "Worktrees".
- CGO backend builds need **zig**.

### Verifying UI

There are no jsdom render tests: verify rendered UI on the live dev app over CDP (`task verify:ui -- <scenario...>`,
`scripts/cdp/scenarios.mjs`; `node scripts/cdp-shot.mjs` for one shot; on a Mac `task dev:browser` first, since
WKWebView has no CDP). Setup, ports and fixtures: dev-workflow "Visual verification".

- **One live pass, when the UI work is done: the `arc:ux-check` skill.** Its last step runs the view's scenario (end
  state) and `motion-trace` (motion) on the same dev app; there is no separate check per commit. If it could not run,
  say exactly what was not verified.
- **An agent an Arc run started (`ARC_RUN_AGENT` is set) runs no CDP:** the run's Final is its only live pass. The
  agent writes or updates the scenario Final runs, does ux-check's code steps, and adds a `- [ ]` line to
  `docs/hand-checks.md` for each motion it could not watch.

## Working rules

- **Before deleting a file, grep every import of it**, including `import type` and re-exports.
- **"Housekeeping" or "cleanup" means removing code and files**, not only updating docs.
- **Commits and PR bodies carry no attribution:** no `Co-Authored-By` trailer and no "Generated with …" line, even
  when a harness reminder asks for one.
- **Monitoring an orchestrator run means observe and log only.** Do not intervene or draft interventions unless asked.
- **An answer the person gives you for a run or another agent goes to it at once** (`wsh agents send`, or the run's
  ask), and you confirm it arrived.
- **Before you tell a lead or another agent about a bug, check the claim in the source**, reading what a field means
  where it is set.
- **Rewriting `main`'s history strands every other branch on the old hashes.** Clean up merged worktrees and branches
  first (`task worktree:cleanup`), or rewrite them in the same pass (`-- --branches`). To check a branch, match its
  commit subjects against `main`, not `git merge-base --is-ancestor` or `git cherry`.

## Architecture

Three layers, all part of the running app. **Full map: `docs/reference/architecture.md`**: read it before working in
an area you don't already know.

- **Tauri shell — Rust (`src-tauri/`)**: a thin native host. Spawns `wavesrv`, reads its ports from the
  `WAVESRV-ESTART` stderr line, runs `wsh install-agent-hooks` on every launch; borderless window, titlebar drawn in
  React; Sidecar is a second window (`src-tauri/src/sidecar.rs`).
- **Go backend (`cmd/`, `pkg/`)**: `wavesrv` (SQLite object store + HTTP + websocket RPC) and `wsh` (CLI helper in
  terminals). Agents report into and drive the cockpit through `wsh`. The managed hook list is
  `cmd/wsh/cmd/wshcmd-installhooks.go`; hooks point at `~/.arc/bin/`, not PATH.
- **Frontend — React 19 + Vite + Tailwind 4 + jotai (`frontend/`)**: `frontend/tauri/main.tsx` is the sole entry. The
  cockpit is **one window with N surfaces, not tabs**; surface orders are `surfaceorder.ts` (`files` renders as
  "Diff"). Finished things (conversations, canvases, councils, boards) live on Library, routed through
  `librarystore.ts`.

Load-bearing rules:

- **`pkg/wshrpc` is the spine**: nearly all cross-process behavior is a wshrpc command (`wshrpctypes_*.go`).
- **Don't re-port Electron-IPC-shaped contracts**: build the Tauri-native primitive and let the old method die.
- **Only the Agent surface stays mounted** off-screen. Every other surface unmounts on switch, so persist
  survival-worthy state in a per-entity jotai atom; cross-surface concerns live in the always-mounted shell.
- **The Agent surface's terminal stack is one always-rendered CSS grid** (a deliberate exception to DESIGN.md; don't
  turn it into flex). Never re-parent a pane or render the stack conditionally: that remounts the xterm and replays the
  TUI. Keep tracks `minmax(0, 1fr)`, cells `min-w-0 min-h-0`, nothing animating a cell's size. Details, and the
  `focusIdAtom`, sidebar tree, tool and service rules: architecture.md "Agent surface rules".
- **Opening an item on another surface goes through the one router**, `frontend/app/view/jarvis/openref.ts`
  (`openAddress`, `openTarget`). Don't hand-roll set-selection-then-`surfaceAtom`.
- **Keybindings** are defined in `frontend/app/store/keybindings/bindings.ts`, but each surface activates its own with
  `useKeybindings(...)`. `docs/keyboard-shortcuts.md` mirrors them.
- **`pkg/orchestrate`** is the deterministic DAG engine behind orchestrator runs; UI in `frontend/app/view/orchestrate`.
  Older specs describe a removed model; `docs/guide/orchestrator.md` is current.

### Frontend conventions

- **Testable logic is extracted, not rendered:** a pure `foo.ts` with `foo.test.ts` beside it, consumed by a thin
  `foo.tsx`. No jsdom render or snapshot tests; "does it render" is the CDP `surface-smoke` scenario.
- **UI design work follows `DESIGN.md`**: read it before planning or styling new UI. Mockups are `.dc.html` canvases
  from the `arc:design` skill under the gitignored `.superpowers/design/<topic>/`, never committed.
- **Colors come from `@theme` tokens in `frontend/tailwindsetup.css`**, never raw hex/rgba: runtime themes override
  those tokens, so a hardcoded color opts out of every theme (`pi/themes/arc.json` is the exception).
- Prefer Tailwind over new SCSS.

## Design docs

- Specs and plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`, named `YYYY-MM-DD-<topic>[-design].md`.
  Specs are kept; a plan is deleted once it ships. Briefs (`docs/superpowers/briefs/`) are kept only while something
  live cites them.
- Live trackers: `docs/open-issues.md` and `docs/orchestrator-redesign-flaws.md`; deferred items and placeholder data:
  `docs/deferred.md`; agent integration notes: `docs/agents/`.
- **A decision to re-measure on a date** also goes into an initiative chunk with that due day
  (`wsh effort chunk add <effort> "Re-measure: <what>" --due <date>`, plus a note saying what decides it).
- **`CHANGELOG.md`:** a change a user would notice adds one line under `Added`, `Changed` or `Fixed` in its top section,
  in the same commit, written for the user. Internals stay out. A new feature with UI the person would open to try is
  `<!-- big -->` and needs its `<!-- shot: … -->` (`whatsnew.test.ts` checks); `try:`, shots and the Unreleased
  heading: dev-workflow "CHANGELOG markup".
- **A finished plan offers the engine first**: the `arc:handoff` skill holds the four choices, their order and which
  one is recommended. A handoff written for a new session names the chosen method in these words.
- **Plans the engine runs** follow `jarvis.PlanFormat` (`pkg/jarvis/plan.go`). For this repo: Verify is
  `node scripts/verify.mjs <go package patterns>`, a plan touching the frontend puts `task check:ts` in its Check,
  Final is `node scripts/cdp/final-verify.mjs [scenario...]`, and every UI the plan changes needs a named scenario step
  that shows it. Header lines, Setup, Final exit codes and task headings: dev-workflow "Engine plans for this repo".

<!-- arc:council-decisions:begin. arcterm writes this block from each council's Memory: change a council's Memory, not these lines. -->
## Council decisions

What this project's councils settled, newest first. Where two councils differ, the newer one stands. Each council's report is the file named under it.

### 2026-11-19 · arcterm's council feature itself, after a while of real use (rounds, seats, report, memory, Token burn gate, docs/council)
Report: `docs/council/2026-11-19-arcterm-s-council-feature-itself-after-a-while-of-real-use-r.md`

- Agreed: Khối Council decisions trong AGENTS.md chỉ giữ luật và điều đã loại, không gắn Agreed cho việc chưa làm; việc còn phải làm thành chunk có hạn.
- Agreed: Cite check khớp tên file viết trần trong các đường dẫn đầy đủ mà báo cáo đã trích, không quét đĩa; file không khớp thì đưa vào nhóm chưa kiểm.
- Agreed: Run facts đếm cả cache read (Input + CacheRead + CacheCreation + Output, pkg/consult/consult.go:150), cùng đơn vị với đồng hồ 5 giờ.
- Ruled out: Không ước tính chi phí council bằng trung vị của ba lần chạy. (why: Mới có ba điểm đo, và 8,7M là số của thiết kế đầu nên kéo lệch kết quả; nên lấy số lượt gọi nhân chi phí mỗi lượt từ các council xong gần nhất.)

### 2026-11-19 · Chat's suggested replies (chatsuggest): the fix for slow and meaningless reply chips
Report: `docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md`

- Agreed: Chưa bỏ chip ok nào trước khi đo; chỉ xét bỏ ở câu A hay B không nghiêng bên nào, sau khi có số.
- Agreed: Lượt hỏi mà mod đang ở một reply khác không chạy headless (27/27 lượt như vậy trong log mod chưa từng begin).
- Agreed: Mod cắt cuộc gọi haiku ở 5 s và gửi end --failed ngay; wavesrv vẫn chờ 10 s.
- Agreed: Mỗi chip bấm ghi một dòng 'pick' trong waveapp.log (source model/rule/fallback, vị trí, loại câu hỏi yesno/open/none, đuôi reply), và dòng via= có question=.
- Agreed: Đường mod chạy thật trên 1.7.0: 8/8 lượt 'mod end taken' 0,9–1,5 s sau begin (log 17:09–17:16, 2026-11-19).

### 2026-11-17 · Sidecar: the second window that shows the agents on another screen (wall of agent cards)
Report: `docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md`

- Agreed: Tường không được trông giống cockpit, và phải dễ nhìn.
- Agreed: Agent đang hỏi luôn hiện trên tường bất kể bộ lọc project hay lane Background; agent bị ẩn vẫn ẩn.
- Agreed: Tường xếp thẻ theo trạng thái: hỏi, working, review, idle, asleep; trong nhóm hỏi agent chờ lâu nhất đứng đầu, trong working agent chạy lâu nhất đứng đầu (sidecarsnapshot.ts STATE_ORDER).
- Agreed: Snapshot chở được việc chờ bạn ở Jarvis: attentionAtom (attentionstore.ts, danh sách do pkg/jarvis/attention.go tính và poll) đã có gate, run chờ xác nhận hoặc land, escalation, chunk đến hạn; bridge Sidecar chỉ cần subscribe, hiện chưa đọc.
- Agreed: Phím 1–9 gửi kèm key của ask, và bị từ chối khi ask đã đổi.
- Agreed: Cửa sổ phủ kín một màn hình scale cao hiện tường dù dưới 1100 CSS px.
<!-- arc:council-decisions:end -->
