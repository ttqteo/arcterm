# Architecture reference

Extracted from the repo-root `AGENTS.md` so it is read on demand rather than loaded into every
agent turn. `AGENTS.md` keeps the rules and gotchas; this file is the descriptive map.

Three layers, all part of the running app.

### 1. Tauri shell — Rust (`src-tauri/`)

Thin native host that replaces the Electron main process. `main.rs` mints a per-launch UUID auth key and **spawns `wavesrv` as a child process**, passing `WAVETERM_AUTH_KEY`, `WAVETERM_APP_PATH`, `WAVETERM_DATA_HOME`, `WAVETERM_CONFIG_HOME` via env. It then **parses the `WAVESRV-ESTART` line off wavesrv's stderr** (`estart.rs`) to discover the dynamically-assigned websocket/web ports. The frontend reaches native code through five Tauri commands only (`init.rs`: `get_init`, `fe_log`; `commands.rs`: `set_window_init_status`, `open_external`; `canvas.rs`: `capture_webview`). The window is borderless (`decorations: false`) — the titlebar/app-bar is drawn in React.

Migration principle (from prior phases): don't re-port Electron-IPC-shaped contracts; build the Tauri-native primitive and let the old method die.

### 2. Go backend (`cmd/`, `pkg/`)

- **`wavesrv`** (`cmd/server`) — the main backend process: SQLite-backed object store, an HTTP server (`pkg/web`) for service calls, and a websocket for RPC.
- **`wsh`** (`cmd/wsh`) — the CLI helper binary (cobra-based) that ships inside terminals and gets copied to remote hosts; it talks back to `wavesrv` over wshrpc. `wavesrv` locates it via `WAVETERM_APP_PATH`. **Agents report into the cockpit through `wsh`**, so if it isn't on PATH in a spawned shell the cockpit stays empty.
- Other `cmd/*` are codegen (`generatets`, `generatego`, `generateschema`) and test harnesses.

**`pkg/wshrpc` is the spine** — the unified, typed RPC system spanning frontend ↔ wavesrv ↔ wsh ↔ remote. Nearly all cross-process behavior is a wshrpc command. `WshRpcInterface` (in `wshrpctypes.go`) is now **composed from per-domain interfaces** split across `wshrpctypes_*.go` (`_runs`, `_dag`, `_channels`, `_jarvis`, `_radar`, `_agents`, `_agentsync`, `_ask`, `_effort`, `_tasks`, `_ui`, `_projects`, `_blocks`, `_git`, `_file`, `_stream`, `_secrets`, `_notify`); `wshserver/wshserver_*.go` implements them file-per-domain, `wshclient` is the typed client, routing is by route IDs (`pkg/wshutil/wshrouter.go`).

Other core packages:

- **`pkg/service`** — HTTP-callable backend services (`clientservice`, `windowservice`, `workspaceservice`, `objectservice`, `blockservice`), reached from the FE via `callBackendService` (a `fetch`, used during early boot before the websocket is up).
- **`pkg/waveobj` + `pkg/wstore`** — the ORef-addressed object model (client/window/workspace/tab/layout/block, plus cockpit types like `Run`) persisted in SQLite and mirrored to the frontend.
- **`blockcontroller`** (terminal/block processes), `remote/fileshare` + `remote/connparse` (file ops over wsh connections), `filestore`, `secretstore`, `wconfig` (config + JSON schema).

Cockpit-specific backend domains (all newer than the Electron→Tauri migration):

- **Runs / Channels** (`wshrpctypes_runs.go`, `pkg/consult`) — the run model. A `Run` is a goal executed in phases (`quick` or `orchestrator`); `CreateRunCommand` spawns the first worker, `AdvanceRunCommand` completes a phase and spawns the next. `pkg/consult` runs one-shot headless CLI agents (claude, pi) behind the Channels "ask @runtime" gesture.
- **Orchestrator engine** (`pkg/orchestrate`, `wshrpctypes_dag.go`) — the deterministic DAG engine an orchestrator run's lead hands its plan to: worktrees, lanes, merges, Setup/Verify/Check/Final. `docs/guide/orchestrator.md` is the user-level guide (Vietnamese).
- **Radar** (`pkg/reporadar`) — the fix-sibling audit: a scan picks the recent fix commits, runs one read-only agent session per commit that reads the code for the same bug at sibling sites, and keeps the hits that name a real file, line and trigger. Findings can be turned into Runs and get the outcome written back.
- **Jarvis second brain** (`pkg/jarvis*`) — conversation backend plus dossiers (`jarvisdossier`), attribution (`jarvisattrib`), continuity (`jarviscontinuity`), capture-on-dispatch (`jarviscapture`), volunteered loose ends (`jarvisvolunteer`), and the one-off history importer (`jarvisbackfill`, CLI in `cmd/jarvisbackfill`). Recall, embeddings and proactive resurfacing were retired.
- **Wave Vault** (`pkg/wavevault`, `memroots`) — the durable-knowledge store Jarvis reads: `memroots` is the single registry of vault locations (`memory:vaultpath` is the root's source of truth, resolved in `wconfig`), `wavevault` the typed retriever over its collections (`tasks`, `decisions`, `attachments`, …). The vault also holds initiatives (`efforts/<oid>.json`, read and written only through `pkg/effortstore`), the Jarvis profile and the portable settings layer (`config/`), and syncs across machines when it has an `origin` remote (`wavevault.Sync`, the loop in `syncloop.go`, `wsh vault remote|sync|status`; spec `docs/superpowers/specs/2026-10-01-vault-sync-design.md`). The memory subsystem that also lived here — `memvault`, `memgarden`, `memdistill`, the Vault surface and the 17 `Memory*` RPCs — was removed; see `docs/deferred.md` for the recovery command.
- **Scanners** (`pkg/usagestats`, `pkg/agentsessions`, `pkg/gitinfo`, `pkg/bgagents`) — read-only readers over on-disk agent transcript JSONL, git state, and `claude agents --json` that feed the Usage and Files surfaces and the Agent surface's sidebar and Conversation History.
- **`pkg/agentask`** — the agent-cockpit ask protocol. Note that multi-answer is gated **server-side** in `encode.go`.

### 3. Frontend — React 19 + Vite + Tailwind 4 + jotai (`frontend/`)

The **Tauri cockpit (`frontend/tauri/main.tsx`) is the sole shipping frontend** (the Electron entry was removed in the Phase 5b teardown). Path aliases: `@/app`, `@/store`, `@/util`.

**Boot flow** (`frontend/tauri/main.tsx`):

1. `invoke("get_init")` → fetch `InitData` (endpoints, auth key, identity) from Rust.
2. `installTauriApi(init)` — builds `window.api`, the `HostApi` over Tauri `invoke`/`listen`.
3. `resolveBootIds()` — HTTP calls to the Go services to find the client/window/workspace/tab IDs (Electron used to supply these via IPC).
4. `bootWaveCore()` (`frontend/app/boot/boot-core.ts`) — connects the wshrpc **websocket** on the tab route, inits `GlobalModel` + jotai atoms, pins the client/window/tab/workspace objects via WOS, loads config.
5. Renders `<CockpitRoot/>`.

**The cockpit is one window with N surfaces, not tabs.** `CockpitRoot` (`frontend/app/cockpit/cockpit-root.tsx`) constructs a single long-lived `AgentsViewModel` (`view/agents/agentsviewmodel.ts` — the shared model that nearly every surface reads) and renders `CockpitShell` (`view/agents/cockpitshell.tsx`), which switches on `model.surfaceAtom`. `SURFACE_ORDER` (`view/agents/agents.tsx`) is cockpit, jarvis, agent, usage, code, files, radar — ordered to match the NavRail, whose core group (Cockpit, Jarvis, Agent, Usage) sits above its tools (Code, Diff, Radar), so `Ctrl+1..7` line up with what the user sees; `setup` and `settings` are `SurfaceKey`s deliberately outside that order. Past conversations are not a surface: the Agent surface's centre column has three modes in `centerModeAtom` (`view/agents/agentcenter.ts`) — the live terminal, one ended session's transcript, and Conversation History (the old Sessions master-detail) — and its sidebar is three collapsible sections, each a folder per project: Active (the live agents), Terminals (the plain shells), and Conversations (the ended sessions, newest folder first; `agentsidebarmodel.ts`, scanned after first paint, never at boot). The app bar's project switcher narrows all three to one project, while the centre keeps the agent you chose. Two consequences:

- **Only the Agent surface stays mounted** when off-screen (hidden via `display:none`, so its live xterm is never torn down and re-fitted at a stale size). Every other surface unmounts on switch — surface-local `useState` is lost, so persist anything survival-worthy in a per-entity jotai atom.
- Cross-surface concerns (pending-launch pruning, ask-draft reset, channel priming) live in the always-mounted shell, not in a surface.

Frontend structure:

- **`frontend/app/store/`** — the state + IPC core: jotai atoms (`global-atoms`, `global`), `GlobalModel`, the wshrpc client plumbing (`wshclient`, `wshclientapi` [generated], `wshrouter`, `wshrpcutil`, `tabrpcclient`), **WOS** (`wos.ts` — `loadAndPinWaveObject`, ORef objects mirrored from Go), `wps` (wave pub/sub events), and keybindings (`keybindings/` — matcher, dispatcher, g-leader chords; `keymodel.ts` is the older layer).
- **`frontend/app/cockpit/`** — window chrome + global overlays: `cockpit-root`, `app-bar`, `command-palette`, `hints-footer`, `shortcuts-cheatsheet`.
- **`frontend/app/view/agents/`** — by far the largest area (~350 files): the surfaces themselves plus their stores. It surfaces external Claude Code / pi agents driven by hooks/reporters that live **outside this repo** (under `~/.claude`); see `docs/agents/`.
- **`frontend/app/view/jarvis/`** — the Jarvis surface: the Brief, record and graph peeks, the run sheet, and the `openref.ts` cross-surface router, which splits each target into a load (proves it exists, writes nothing) and a select (writes the destination's selection, open only), so `peekTarget` can show the item view in the avatar popup (`petpeek.tsx`) without landing on it.
- Remaining `frontend/app/view/` entries: `orchestrate` (run and DAG UI), `code` (the Code surface), `codeeditor`, `term`.
- **`frontend/app/waveenv/`** — the DI seam: `WaveEnv` bundles rpc/atoms/wos/services so models can be constructed against a mock in tests.
- `frontend/app/element` (UI primitives), `frontend/app/modals` (the modal host).
