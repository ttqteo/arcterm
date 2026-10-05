# Arc

**A desktop cockpit for coding agents.** See what is running, answer what is blocked, and review what changed—without hopping between terminal windows.

Arc brings agent terminals, questions, task graphs, Git diffs, and run history into one workspace. Use it to supervise an individual agent or coordinate a larger change across parallel workers.

![Arc's Agent surface: project-grouped agents on the left, a live terminal in the center, and context and usage details on the right](docs/images/orchestrator-guide/22-agent-tree-executing.png)

_The Agent surface keeps the actual agent terminal at the center, with project, run, and usage context alongside it._

[App tour](#app-tour) · [How a run works](#how-a-run-works) · [Run from source](#run-from-source) · [Documentation](#documentation)

> **Personal project · Windows-only · Build from source.** There are no published releases, download page, or support channel. Contributions are not currently accepted.
>
> Screenshots are real dev-app captures from September 2026. Navigation and some controls have since changed; the Memory/Vault surface visible in older captures has been removed.

## Why Arc

Running more agents creates more work to supervise: which one needs a decision, which task is waiting on another, what actually landed, and whether it was verified. Arc puts that context next to the work rather than leaving it scattered across terminals and transcripts.

- **Watch and intervene.** Group agents by project, open their live terminals, inspect context and usage, and take control when needed.
- **Keep questions visible.** Agent questions and review requests surface in the cockpit instead of disappearing into terminal scrollback.
- **Coordinate larger changes.** Run a dependency-aware plan with parallel workers, worktree isolation, task reviews, merges, and verification.
- **Inspect the result.** Follow a run's timeline and outcomes, then read its Git changes in the same app.
- **Keep your tools.** Arc wraps existing coding-agent CLIs; it is not a replacement model or a separate coding harness. Orchestrator leads and workers run on **Claude Code or pi**.

## App tour

### Supervise agents

The **Cockpit** gives you an overview; **Agent** opens the selected agent's terminal. A run's workers are grouped under its lead, so you can move from the overall job to the task that needs attention.

The terminal is interactive—not just a transcript viewer. You can talk directly to a worker while keeping its run and task context in view.

Past conversations live in the same place: each project in the **Agent** sidebar lists its recent sessions under its live agents, an ended session opens as a readable transcript with **Resume**, and **Conversation History** shows them all.

### Answer decisions where they arise

**Jarvis** is the briefing and coordination surface: initiatives, runs, and work waiting on you. Open a run to see its task states, questions, timeline, and controls.

![A run waiting for a product decision, with the worker's question and answer options shown beside the briefing](docs/images/orchestrator-guide/15-question-for-you.png)

_An escalated worker question appears with the run it belongs to. Answer it and the worker can continue._

For orchestrated work, the lead handles questions it can resolve from the plan and forwards decisions that need you. Spec and plan review requests open a document-and-decisions dialog.

### Follow the task graph

The orchestrator's **DAG view** shows dependencies, task states, and a lifecycle timeline. It makes the difference between “waiting for another task” and “blocked on a failure” visible, with actions to retry, skip, escalate, or resolve a blocked merge.

![Arc's orchestrator task graph showing completed and running tasks, a dependent task, and the lifecycle timeline](docs/images/orchestrator-guide/17-dag.png)

_Task dependencies on the left; reviews, merges, verification, and attention events on the right._

Scheduling, worktrees, merges, and command execution belong to the deterministic engine. Agents handle implementation and judgment; you handle the decisions they cannot safely make.

### Review the changes

The **Diff** surface puts Git history, changed files, and the selected file's diff side by side. Inspect the working tree, changes since an agent's session started, a run's changes, or a comparison between two refs. Diff review is read-only; **Code** is the separate editing surface.

![Arc's Diff surface with a Git commit graph, changed-file list, and file diff in three panes](docs/images/diff-tab/three-panes-wide.png)

_History → files → diff, without leaving the cockpit._

### The rest of the workspace

| Surface   | What it is for                                                |
| --------- | ------------------------------------------------------------- |
| **Code**  | Browse and edit project files.                                |
| **Radar** | Inspect repository findings and turn them into work.          |
| **Usage** | Inspect token usage and estimated API-equivalent cost.        |
| **Setup** | Manage shared instructions and skills across agent harnesses. |

Search and commands are available through `Ctrl+P`; `Ctrl+N` opens **New agent**. See the [keyboard shortcuts](docs/keyboard-shortcuts.md) for surface navigation and context-specific controls.

## How a run works

Register a local repository through the project switcher, then open **+ Run** in Jarvis and choose the shape of the work:

| Starting point                         | Flow                           | What happens                                                                                                  |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| A small, well-defined change           | **Quick**                      | One fresh worker tackles the goal. No lead or task graph.                                                     |
| A goal that needs design decisions     | **Orchestrator → A goal**      | A lead works through the goal with you, then handles a bounded change itself or submits a plan to the engine. |
| An implementation plan already on disk | **Orchestrator → A plan file** | The engine reviews the plan before dispatching its tasks; a lead is launched when judgment is needed.         |

For a planned run:

1. **Review the plan.** A reviewer checks requirements, dependencies, file ownership, and verification before workers start.
2. **Execute the tasks.** The engine schedules dependency-ready work in isolated worktrees. Workers implement and report; reviewers check their changes.
3. **Merge and verify.** Completed lanes merge into the run's branch. Verification failures and conflicts go to the lead, or to you when necessary.
4. **Check the combined result.** The final stage runs the configured checks and records anything that could not be verified.
5. **Land the work.** By default, the run uses its own `wave/<runId>` branch and worktree, then merges back into the base branch on completion. If landing cannot proceed, the run is held with a reason.

The [orchestrator guide](docs/orchestrator-guide.md) covers setup, plan format, model routing, steering, recovery, and current rough edges.

## Run from source

### Prerequisites

The desktop app is currently built and packaged for **Windows**. Install:

- [Task](https://taskfile.dev/), used to orchestrate the build.
- [Node.js and npm](https://nodejs.org/).
- [Go](https://go.dev/dl/), matching the version required by [`go.mod`](go.mod).
- [Rust](https://rustup.rs/) and the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/), including C++ build tools and WebView2.
- [Zig](https://ziglang.org/download/), used for CGO cross/static linking.
- [Git for Windows](https://git-scm.com/downloads/win), including Git Bash for orchestrator plan commands.

To run agents, install and authenticate the coding-agent CLI you intend to use. Arc does not provide model access or credentials.

### Start the dev app

From the repository root:

```sh
task init   # install npm dependencies and tidy Go modules
task dev    # build the dev backend and launch Tauri + Vite
```

Vite serves the frontend on `localhost:5174` with hot reload. The native app starts its own Go backend; you do not need to launch it separately. Dev and packaged builds use separate app stores.

**Before launching:** Arc installs or refreshes agent integrations on startup. These include Claude Code hooks and, when installed, pi extensions and an OpenCode status plugin. They write to global harness configuration under your home directory. For a dev session that must leave those integrations untouched, set `ARC_DEV_NO_GLOBAL_INSTALL=1` before `task dev`.

Once open, register your repository and use **+ New agent** for an interactive session or **+ Run** in Jarvis for tracked work.

### Build an installer

```sh
task tauri:build
```

This syncs the app version, builds the backend binaries, and packages a Windows NSIS installer. `npm run build` runs the same task; a separate `task build:backend` is not required.

Build commands, test commands, data locations, and troubleshooting notes live in [AGENTS.md](AGENTS.md).

## Under the hood

Arc began as a fork of [Wave Terminal](https://github.com/wavetermdev/waveterm). It retains the terminal and `wshrpc` foundations, but replaces the Electron shell with Tauri and centers the interface on agent supervision rather than terminal multiplexing.

| Layer        | Stack                                                           | Responsibility                                                         |
| ------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Desktop host | Tauri / Rust · [`src-tauri/`](src-tauri/)                       | Native window, startup, and backend lifecycle.                         |
| Backend      | Go / SQLite · [`cmd/`](cmd/), [`pkg/`](pkg/)                    | Agent integration, persistent state, RPC, and the orchestrator engine. |
| Frontend     | React 19 / Vite / Tailwind 4 / jotai · [`frontend/`](frontend/) | Cockpit surfaces, live terminals, and review workflows.                |

The bundled `wsh` CLI lets agents report status, ask questions, inspect runs, and drive the cockpit. Many internal names still use Wave terminology.

## Documentation

- [Orchestrator guide](docs/orchestrator-guide.md) — launch, supervise, steer, and recover runs.
- [Diff walkthrough](docs/diff-tab.md) — Git history, review ranges, and comparisons.
- [Keyboard shortcuts](docs/keyboard-shortcuts.md) — navigation and commands.
- [Architecture](docs/reference/architecture.md) — desktop, backend, and frontend map.
- [Development reference](AGENTS.md) — build/test commands and gotchas.
- [Docs index](docs/README.md) — reference notes, design records, and issue trackers.

## License and attribution

[Apache-2.0](LICENSE), inherited from Wave Terminal. Upstream copyright is retained in [NOTICE](NOTICE); dependency licenses are listed in [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).
