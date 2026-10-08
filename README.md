# arcterm

**A desktop cockpit for coding agents.** See what is running, answer what is blocked, and review what changed, without hopping between terminal windows.

arcterm brings agent terminals, questions, task graphs, Git diffs and run history into one window. Use it to supervise a single agent or to run a larger change across parallel workers.

![The Agent surface with demo agents grouped by project in the sidebar, a live terminal in the center and the details rail on the right](docs/guide/images/agent-overview.png)

[What it does](#what-it-does) · [Surfaces](#surfaces) · [How a run works](#how-a-run-works) · [Run from source](#run-from-source) · [Documentation](#documentation)

> **Personal project · Build from source.** Runs on **Windows** and **macOS on Apple silicon** (13 or later). There are no published releases, download page or support channel, and contributions are not currently accepted.
>
> The user guide under [`docs/guide/`](docs/guide/README.md) is written in Vietnamese.

## What it does

Running more agents means more to supervise: which one needs a decision, which task is waiting on another, what actually landed, and whether it was verified. arcterm puts that context next to the work.

- **Watch and intervene.** Agents are grouped by project. Open a live terminal, read its context and usage, and type into it.
- **Keep questions visible.** Agent questions and review requests surface on the Cockpit, in Jarvis and in notifications instead of scrolling past in a terminal.
- **Coordinate larger changes.** Run a dependency-aware plan with parallel workers in isolated worktrees, with task reviews, merges, verification and a final check of the combined result.
- **Inspect the result.** Follow a run's timeline, then read its Git changes in the same app.
- **Keep your tools.** arcterm wraps the coding-agent CLIs you already have: **Claude Code**, **pi**, **Antigravity** (`agy`), **Codex** and **OpenCode**. It provides no model or account. Orchestrator leads run on Claude Code or pi; plan task workers on Claude Code, pi or Antigravity.

## Surfaces

The cockpit is one window with several surfaces on its nav rail. `Ctrl+P` (`Cmd+P` on macOS) searches everything; `Ctrl+N` opens **New** for an agent or a run.

| Surface | What it is for | Guide |
|---|---|---|
| **Cockpit** | Every agent as a card, the **Needs you** strip, answers in place | [cockpit.md](docs/guide/cockpit.md) |
| **Jarvis** | The brief: initiatives, runs, what is waiting on you, run defaults | [jarvis.md](docs/guide/jarvis.md) |
| **Agent** | Each agent's real terminal, a grid of up to four, conversation history | [agent.md](docs/guide/agent.md) |
| **Usage** | 5-hour and weekly quota, tokens, estimated cost | [usage.md](docs/guide/usage.md) |
| **Code** | Browse and edit project files | [code.md](docs/guide/code.md) |
| **Diff** | Git history, changed files and diffs, line review | [diff.md](docs/guide/diff.md) |
| **Radar** | Findings from auditing bug-fix commits, turned into runs | [radar.md](docs/guide/radar.md) |
| **Setup** | Instructions and skills shared across every harness | [setup.md](docs/guide/setup.md) |
| **Settings** | Claude accounts, run routes, appearance, terminal | [settings.md](docs/guide/settings.md) |

## How a run works

Register a repository through the project switcher on the app bar, then open **New** and pick a run:

| You have | Choose | What runs |
|---|---|---|
| A small change you can say in a sentence | **Quick run** | One fresh worker. No lead, no task graph. |
| A goal that still needs design decisions | **Orchestrate → goal** | A lead works through the goal with you, then does it itself or hands the engine a plan. |
| A plan already written | **Orchestrate → plan file** | The engine reviews the plan and runs its tasks; a lead is woken only when something needs judgment. |

For a planned run:

1. **Plan review.** A reviewer checks the plan against its spec before any worker starts.
2. **Tasks.** The engine dispatches dependency-ready tasks into isolated worktrees; a reviewer checks each one.
3. **Merge and verify.** Each finished lane merges into the run's branch and runs the plan's Verify command. Conflicts and failures go to the lead, and to you when the lead should not decide.
4. **Final stage.** The combined result runs the plan's checks and a final verifier, and records what could not be verified.
5. **Land.** The run works on its own `wave/<runId>` branch and merges back into the base branch when it completes, or holds with a reason.

Code does the mechanics (scheduling, worktrees, merges, commands); agents do the implementation and the judgment; you get the decisions they cannot safely make. The [orchestrator guide](docs/guide/orchestrator.md) and the [plan format](docs/guide/plan-format.md) cover routes, steering, recovery and landing.

## Run from source

### Prerequisites

| | Windows | macOS (Apple silicon, 13+) |
|---|---|---|
| [Task](https://taskfile.dev), [Node.js and npm](https://nodejs.org/) | yes | yes |
| [Go](https://go.dev/dl/), the version in [`go.mod`](go.mod) | yes | yes |
| [Rust](https://rustup.rs/) and `cargo tauri` (tauri-cli 2.x) | yes | yes |
| C compiler for CGO | [Zig](https://ziglang.org/download/) | Xcode Command Line Tools |
| [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) | C++ build tools, WebView2 | Xcode Command Line Tools |
| Git | [Git for Windows](https://git-scm.com/downloads/win) with Git Bash (plan commands run in a POSIX shell) | built in |

Install and sign in to the agent CLIs you want to use; arcterm lists only the ones it finds.

### Start the dev app

```sh
task init   # npm install + go mod tidy
task dev    # build the backend for this machine, then Tauri + Vite
```

Vite serves the frontend on `localhost:5174` with hot reload, and the app starts its own Go backend. The dev app keeps its data apart from an installed build. On an 8 GB Mac, prefix Vite builds and `task check:ts` with `NODE_OPTIONS=--max-old-space-size=4096`.

**Before launching:** on every start arcterm installs or refreshes its agent integrations: Claude Code hooks and the arcterm Claude mod, and, when present, pi extensions, an OpenCode status plugin and Antigravity hooks. They write to harness configuration under your home directory ([agent integration](docs/guide/agent-integration.md)). To leave them untouched in a dev session, set `ARC_DEV_NO_GLOBAL_INSTALL=1` before `task dev`.

### Build and install

```sh
task tauri:build   # sync the version, build the backend, cargo tauri build
task install       # install that build over arcterm and reopen it
```

On Windows this produces an NSIS installer; on a Mac an ad-hoc signed `.app` and `.dmg` (not notarized). `task install` closes the running arcterm and every agent in it.

Build and test commands, data locations and gotchas are in [AGENTS.md](AGENTS.md). Setup in more detail: [getting started](docs/guide/getting-started.md).

## Under the hood

arcterm began as a fork of [Wave Terminal](https://github.com/wavetermdev/waveterm). It keeps the terminal and `wshrpc` foundations, replaces the Electron shell with Tauri, and centers the interface on supervising agents. Many internal names still use Wave's (`wavesrv`, `wsh`, `waveobj`).

| Layer | Stack | Responsibility |
|---|---|---|
| Desktop host | Tauri / Rust · [`src-tauri/`](src-tauri/) | Native window, startup, backend lifecycle |
| Backend | Go / SQLite · [`cmd/`](cmd/), [`pkg/`](pkg/) | Agent integration, persistent state, RPC, the orchestrator engine |
| Frontend | React 19 / Vite / Tailwind 4 / jotai · [`frontend/`](frontend/) | Cockpit surfaces, live terminals, review |

The bundled `wsh` CLI is how agents report status, ask questions, start and inspect runs, and drive the cockpit.

## Documentation

- [User guide](docs/guide/README.md) (Vietnamese) — every surface, runs, the plan format, agent integration.
- [Keyboard shortcuts](docs/keyboard-shortcuts.md)
- [Architecture](docs/reference/architecture.md) — desktop, backend and frontend map.
- [AGENTS.md](AGENTS.md) — development reference: build, test, gotchas.
- [Docs index](docs/README.md) — reference notes, design records, issue trackers.
- [Changelog](CHANGELOG.md)

## License and attribution

[Apache-2.0](LICENSE), inherited from Wave Terminal. Upstream copyright is retained in [NOTICE](NOTICE); dependency licenses are listed in [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).
