# Dev servers in the agent rail

**Spec:** `docs/superpowers/specs/2026-10-07-rail-dev-servers-design.md` — the authority wherever this plan is
shorter; the two agree on every interface below.
**Verify:** `node scripts/verify.mjs ./pkg/devservers/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs rail-servers agent-rail-sections`

Every frontend task follows DESIGN.md: colours only through `--color-*` tokens / Tailwind theme classes, pure logic
in a `.ts` with a `.test.ts` beside it, no jsdom render tests. Never hand-edit generated files
(`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`): change
the Go types and run `task generate`. Check formatting only on files you touched (`gofmt -l <file>`,
`npx prettier --check <file>`); never `--write` the tree, never prettier `scripts/*.mjs`.

### Task 1: `pkg/devservers` — find and stop a project's listening processes
**Depends on:** none

Create the package `pkg/devservers` (Go). It has a pure core, tested without real ports, and a thin OS layer over
gopsutil v4 (`github.com/shirou/gopsutil/v4`, already in `go.mod`; use its `net` and `process` subpackages).

**`pkg/devservers/devservers.go` (pure, no gopsutil import):**

```go
// Proc is one process as a sweep read it.
type Proc struct {
	Pid      int32
	Ppid     int32
	Name     string
	Cmdline  string
	Cwd      string
	CreateMs int64
}

// Listener is one listening TCP socket.
type Listener struct {
	Pid  int32
	Port uint32
}

// Server is one listening process the rail lists. One PID on several ports is one Server.
type Server struct {
	Pid             int32  `json:"pid"`
	CreateMs        int64  `json:"createms"`
	Ports           []int  `json:"ports"`
	Name            string `json:"name"`
	Cmdline         string `json:"cmdline"`
	Cwd             string `json:"cwd"`
	ByAgent         bool   `json:"byagent"`
	LauncherCmdline string `json:"launchercmdline,omitempty"`
}

// Select picks the servers that belong to an agent: a listener whose cwd is inside root, or one that descends from
// agentPid (0: no agent process known). procs must hold every listener's process and its ancestors as far as they
// could be read.
func Select(root string, agentPid int32, procs map[int32]Proc, listeners []Listener) []Server
```

Rules for `Select`:
- Group `listeners` by PID; ports sorted ascending, de-duplicated. A PID missing from `procs` is skipped. PID 0 is
  skipped.
- The ancestor chain is the process, then each `Ppid` up through `procs`, stopping at a PID not in `procs`, at PID 0,
  at a repeat (loop guard) or after 32 hops.
- `ByAgent` = `agentPid != 0` and the chain (excluding the process itself) contains `agentPid`.
- `LauncherCmdline` = the `Cmdline` of the chain member whose `Ppid == agentPid`, only when `ByAgent`.
- `inProject` = `root != ""`, `Cwd != ""`, and `within(root, Cwd)`, where `within` compares paths after turning
  `\` into `/`, trimming a trailing `/`, and lowercasing both (Windows and macOS filesystems are case-insensitive);
  true for equal paths or a `root + "/"` prefix.
- Keep a process when `inProject || ByAgent`, except: the agent process itself, and any process whose name is
  `claude` / `claude.exe` (case-insensitive) — a Claude Code process may listen for IDE integration and is never a
  dev server.
- Output sorted by first port ascending. Return an empty (non-nil) slice when nothing matches.

Also in this file, `func CheckStop(listedCreateMs, actualCreateMs int64) error`: nil when they are equal, otherwise
an error reading "the process is no longer the server that was listed (its PID was reused)".

**`pkg/devservers/devservers_os.go`:**

- `func List(ctx context.Context, cwd, blockId string) ([]Server, error)`:
  1. `net.ConnectionsWithContext(ctx, "tcp")`; keep `Status == "LISTEN"` with `Pid > 0` as `Listener{Pid, Laddr.Port}`.
     An error here is returned.
  2. If `blockId != ""`, `agentobserve.EnumerateAgents()` and pick the entry whose `BlockID ==
     agentobserve.NormalizeBlockID(blockId)`: its `Pid` is `agentPid`; when `cwd == ""` its `Cwd` is the root.
     An enumerate error is ignored (no agent attribution, still list by cwd).
  3. Build `procs` by reading each listener PID and walking `Ppid` up to 32 hops with
     `process.NewProcessWithContext`; read `Name`, `Cmdline`, `Cwd`, `CreateTime`, `Ppid`, ignoring per-field
     errors (a field that fails stays empty — a process whose cwd can't be read simply isn't `inProject`). Cache by
     PID so shared ancestors are read once.
  4. `return Select(root, agentPid, procs, listeners), nil`.
- `func Stop(ctx context.Context, pid int32, createMs int64) error`: open the process (error: "process <pid> is not
  running"), `CheckStop(createMs, actual)`, then collect the process and every descendant (breadth-first over
  `Children()`, as `processTree` in `pkg/orchestrate/liveness.go` does) and kill them deepest first, the listener
  last. Return the listener's kill error, if any. Never touch ancestors.

**Tests, `pkg/devservers/devservers_test.go`** (table tests over `Select` and `CheckStop`, no OS calls):
- a listener with cwd inside root (mixed `\`/`/` and case) is kept, `ByAgent` false, no launcher;
- a listener outside root that descends from the agent via `bash` is kept, `ByAgent` true, `LauncherCmdline` = the
  bash process's cmdline;
- a listener outside root and not a descendant is dropped;
- `root` = `D:\w\site` does not match cwd `D:\w\site-old` (prefix needs the separator);
- one PID on ports 24678 and 4321 is one Server with `Ports` `[4321, 24678]`;
- `claude.exe` listening in the project is dropped; the agent PID itself is dropped;
- a Ppid loop terminates;
- output order is by first port;
- `CheckStop` equal → nil, different → error.

Run `go test ./pkg/devservers/...` — all pass. `gofmt -l pkg/devservers` prints nothing. Commit.

### Task 2: wshrpc commands `ListDevServers` and `StopDevServer`
**Depends on:** Task 1

Create `pkg/wshrpc/wshrpctypes_devservers.go`, modelled on `wshrpctypes_git.go`:

```go
// DevServerCommands lists and stops the processes listening in an agent's project (the agent rail's Servers).
type DevServerCommands interface {
	ListDevServersCommand(ctx context.Context, data CommandListDevServersData) (*CommandListDevServersRtnData, error)
	StopDevServerCommand(ctx context.Context, data CommandStopDevServerData) error
}

type CommandListDevServersData struct {
	Cwd     string `json:"cwd,omitempty"`     // the project root; "" falls back to the agent process's cwd
	BlockId string `json:"blockid,omitempty"` // the agent's block, for "started by this agent"
}

type CommandListDevServersRtnData struct {
	Servers []devservers.Server `json:"servers"`
}

type CommandStopDevServerData struct {
	Pid      int32 `json:"pid"`
	CreateMs int64 `json:"createms"`
}
```

Add `DevServerCommands` to `WshRpcInterface` in `pkg/wshrpc/wshrpctypes.go` (after `GitCommands`). Implement both in
a new `pkg/wshrpc/wshserver/wshserver_devservers.go` (modelled on `wshserver_git.go`) as thin calls to
`devservers.List` / `devservers.Stop`; a nil result list becomes an empty slice.

Run `task generate`, then confirm `RpcApi.ListDevServersCommand` and `RpcApi.StopDevServerCommand` exist in
`frontend/app/store/wshclientapi.ts` and `DevServer`-shaped types (`CommandListDevServersRtnData`, the server type)
in `frontend/types/gotypes.d.ts`. `go build ./...` and `go test ./pkg/wshrpc/...` pass. Commit the Go files and
every regenerated file together.

### Task 3: `devserversmodel.ts` — labels, log matching, uptime
**Depends on:** none

Create `frontend/app/view/agents/devserversmodel.ts` (pure: no React, no atoms, no RPC) and
`devserversmodel.test.ts` beside it. Define the row type locally so this task does not wait on Task 2 — it is the
JSON shape of the Go `devservers.Server`:

```ts
export interface DevServerRow {
    pid: number;
    createms: number;
    ports: number[];
    name: string;
    cmdline: string;
    cwd: string;
    byagent: boolean;
    launchercmdline?: string;
}
```

Exports:
- `serverLabel(row: DevServerRow): string` — the command line shortened. Tokenize on whitespace keeping
  double-quoted runs together (strip the quotes). Drop a first token whose basename without extension is an
  interpreter (`node`, `bun`, `deno`, `python`, `python3`, `ruby`). Replace the next token, if it is a path
  (contains `/` or `\`), by its basename without extension, except when that basename is `cli`, `index`, `bin`,
  `main` or `run`: then walk up the path past `bin`/`dist`/`lib`/`src` directories and use the first other directory
  name (so `…\next\dist\bin\next` → `next`, `…\vite\bin\vite.js` → `vite`, `…\astro\astro.js` → `astro`). Keep the
  remaining tokens as they are. Empty cmdline → `row.name`. Cap at 60 characters with a trailing `…`.
- `serverUrl(port: number): string` → `http://localhost:<port>`.
- `portsLabel(ports: number[]): string` → `":4321 :24678"`.
- `ownerLabel(row: DevServerRow): string` → `"this agent"` when `byagent`, else `"already running"`.
- `uptimeLabel(createms: number, now: number): string` → `"45s"`, `"12m"`, `"2h 14m"`, `"3d 4h"` (floor; a
  negative span reads `"0s"`).
- `copyText(row: DevServerRow): string` → `` `PID ${pid}\n${cmdline}` ``.
- `matchLogTask<T extends { command?: string; status: string; outputFile?: string }>(row: DevServerRow, tasks:
  T[]): T | undefined` — only when `row.byagent` and `row.launchercmdline`: the first task with `status ===
  "running"`, an `outputFile`, and a `command` that is a substring of the launcher command line once both are
  normalized (remove `"`, `'` and `\`, collapse whitespace runs to one space, trim). It takes the
  `BackgroundTask` shape structurally so it needs no import from `transcriptprojection.ts`.
- `pollMs(railVisible: boolean): number` → `5000` when the rail is visible, else `30000`.

Tests cover each export, with these label cases at least: `node C:\w\site\node_modules\astro\astro.js dev` → `astro
dev`; `"C:\Program Files\nodejs\node.exe" "D:\w\app\node_modules\next\dist\bin\next" dev` → `next dev`;
`node /w/app/node_modules/vite/bin/vite.js --port 5174` → `vite --port 5174`; `python -m http.server 8000` →
`-m http.server 8000`; empty cmdline → name; a 200-char cmdline is cut to 60 with `…`. Log-matching cases: a
running task whose command appears inside `bash -c "pnpm dev --port 4321"` matches; a completed one does not; an
`already running` row never matches; quote and backslash differences still match.

`npx vitest run frontend/app/view/agents/devserversmodel.test.ts` passes. Commit.

### Task 4: the `servers` stat and section slot
**Depends on:** none

The rail's shape gains a counted list, `servers`, directly before `bgtasks`.

- `frontend/app/view/agents/agentrailsections.ts`: add `"servers"` to `AgentRailStatId` and a `servers: number`
  field to `AgentRailInput` (comment: listening processes in the agent's project); `planRailStats` returns
  `{ id: "servers", count: i.servers }` between `uploads` and `bgtasks`. Nothing else changes: `planAgentRail` lists
  it exactly when its count is above zero, like the other lists. Update the header comment's list of lists.
- `frontend/app/view/agents/agentrailsections.test.ts`: add `servers: 0` to `base`; extend "keeps the counted
  sections in the strip's order" with `servers: 2` so `servers` lands between `uploads` and `bgtasks`; add a test
  that `planRailStats(base)` ids are `["subagents", "files", "artifacts", "uploads", "servers", "bgtasks"]` and that
  `servers: 0` is not in `planAgentRail`'s ids.
- `frontend/app/view/agents/agentrailpanel.tsx`: `STAT_ICON.servers = Server` (lucide `Server` icon) and
  `STAT_LABEL.servers = "Servers"`.
- `frontend/app/view/agents/agentdetailsrail.tsx`: so it still typechecks before Task 5, pass `servers: 0` in
  `railInput`, add `servers: "Servers"` to the section labels, `servers: RAIL_ICON.server` to `ICON`, and a
  `servers: () => null` placeholder in `CONTENT` (Task 5 replaces it). Add `server: <Server {...iconProps} />` to
  `RAIL_ICON` in `railicons.tsx`.
- `scripts/cdp/scenarios.mjs`: `RAIL_STATS_ORDER` becomes `["subagents", "files", "artifacts", "uploads", "servers",
  "bgtasks"]`, and the two step texts that list the strip ("…Artifacts, Uploads, Background tasks in order…", in
  `agent-rail-sections` and the tree-rail scenario) name Servers before Background tasks.

`npx vitest run frontend/app/view/agents/agentrailsections.test.ts` passes. `task check:ts` (allow 4+ minutes)
exits 0. Commit.

### Task 5: the Servers section — polling store and rows
**Depends on:** Task 2, Task 3, Task 4

**Store, `frontend/app/view/agents/devserversstore.ts`:**

- `devServersAtom`: a jotai atom `Record<string, { servers: DevServerRow[]; failed: boolean }>` keyed by agent id.
- `useDevServers(agentId: string, cwd: string | null, blockId: string | undefined, railVisible: boolean)`: a hook
  that, while `cwd` or `blockId` is set, calls `RpcApi.ListDevServersCommand(TabRpcClient, { cwd: cwd ?? undefined,
  blockid: blockId })` at once and then every `pollMs(railVisible)`, skipping a tick while `document.hidden`. A
  success writes `{ servers, failed: false }`; a failure keeps the last `servers` and sets `failed: true`. It clears
  its timer on unmount and when its inputs change, and ignores a reply that arrives after that (a stale agent).
  Returns the agent's entry or `{ servers: [], failed: false }`.
- `stopDevServer(row: DevServerRow)`: `RpcApi.StopDevServerCommand(TabRpcClient, { pid: row.pid, createms:
  row.createms })`, then drops the row from the atom so it leaves at once (the next poll confirms).

**Rail, `frontend/app/view/agents/agentdetailsrail.tsx`:**

- Call `useDevServers(agent.id, railState?.cwd ?? null, agent.blockId, railVisible)` (read `railVisibleAtom`).
  For a subagent interior or an ended session pass no cwd and no block id, so nothing polls.
- `railInput.servers = servers.length`.
- Replace the `servers` placeholder with a `DevServerRow` list component (in a new
  `frontend/app/view/agents/railservers.tsx`, like `railuploads.tsx`), each row `data-dev-server={pid}`, laid out as
  the spec's decision 7 and styled like `BackgroundTaskRow` (`bg-surface-raised`, 11.5px label, 10.5px mono meta,
  6px dot `bg-success`):
  - line 1: dot, `portsLabel` where each port is its own button calling `getApi().openExternal(serverUrl(port))`
    (`data-dev-server-port={port}`), `serverLabel(row)` with `title={row.cmdline}`, and `uptimeLabel(row.createms,
    now)` right-aligned;
  - line 2: `PID {pid} · {ownerLabel(row)}`;
  - actions on hover/focus at the row's right, icon buttons with `title`s: Log (only when `matchLogTask(row,
    bgTasks)` returns a task: open its `outputFile` with `openFileInPanel` exactly as the `bgtasks` section does,
    `live: "on"`), Copy (`navigator.clipboard.writeText(copyText(row))`), Stop (first click shows "Stop?" for 3 s,
    a second click within that calls `stopDevServer`; `data-dev-server-stop`).
  - When `failed` is true, one muted line above the rows: "Could not read listening ports".
- `CHANGELOG.md`: under the top section's `### Added` (it is `## Unreleased`; if it has since been dated, open a new
  `## Unreleased` with `### Added` above it), one line: "The agent rail lists the servers listening in the agent's project — port, command, who
  started it and for how long — with open, log, copy and stop."
- Update the spec's decision 5 to read "while the rail is visible" instead of "while the Servers section is open"
  (the section's open state lives inside `CollapsibleRail`; rail visibility is `railVisibleAtom`).

`task check:ts` exits 0; `npx vitest run frontend/app/view/agents/` passes. Commit.

### Task 6: CDP scenario `rail-servers`
**Depends on:** Task 5

Add a scenario `rail-servers` to `scripts/cdp/scenarios.mjs` (register it in `SCENARIOS`), modelled on
`agent-rail-sections` (fixture roster in `TREE_RAIL_FIXTURE`, rail visibility and section keys saved and restored,
`ahReload`, `polishWaitFor`, `uireveal`, `teardownFixtureRun`). It shows what Task 5 built:

- **arrange:** make a temp project dir (`mkdtempSync(join(tmpdir(), "verify-rail-servers-"))`); write a transcript
  `session.jsonl` in it whose first line is `{"type":"user","cwd":"<project dir>","message":{"role":"user",
  "content":"verify rail servers"}}` (the rail resolves an agent's cwd from its transcript, `agentcwd.ts`); spawn
  `process.execPath -e "<script>"` with `cwd` = the project dir, where the script creates an `http` server on port 0
  at `127.0.0.1` and prints its port; read the port from the child's stdout; write a one-agent fixture roster
  (`agent: "claude"`, a fixture `blockId`, `transcriptPath` = the transcript); set the rail visible, clear the
  section key, reload, go to `agent`, `uireveal` the agent.
- **assert:**
  1. the strip's `servers` stat counts 1 (`[data-rail-stat="servers"]`, `data-count="1"`) — wait up to 12 s for the
     first poll;
  2. the `servers` section lists one row with `data-dev-server` = the child's PID, a
     `[data-dev-server-port="<port>"]` button, and the text `already running` (the fixture has no claude process, so
     the row is matched by cwd);
  3. shot `cdp-shots/rail-servers.png`;
  4. clicking Stop twice (`[data-dev-server-stop]`) ends the child process (poll `process.kill(pid, 0)` throwing)
     and the row leaves within 8 s.
- **teardown:** kill the child if still alive, remove the fixture, restore the rail keys, remove the temp dir.

Run `CDP_PORT=<port> task verify:ui -- rail-servers agent-rail-sections` against a dev app if one is running for
you; otherwise the plan's Final runs them. Commit.
