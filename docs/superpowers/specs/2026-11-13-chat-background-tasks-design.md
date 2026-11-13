# Background work in the chat box

**Date:** 2026-11-13
**Prototype:** `.superpowers/design/chat-background-tasks/project/B-status-line.dc.html` (gitignored; the board for
the chosen design)

## Why

A command an agent starts in the background, such as a release build, keeps running after the agent's turn ends. Today
it shows only in the Agent tree (nested under its agent, "running · 2m") and in the `/tasks` card. Someone reading the
Chat has to look away to the sidebar to know it is still running. The chat box should say so where they are looking.

## What shows

The box shows an agent's **running** work of three kinds:

- **background shell commands** (Bash with `run_in_background`),
- **Monitors**,
- **background subagents**: only a subagent spawned to run in the background (async), which keeps running after the
  turn. A foreground `Agent`/`Task` call the agent is waiting on inside its turn does not count, so a fan-out of
  subagents in a turn never makes the line come and go.

The data mostly exists: `backgroundTasksByIdAtom` (shells and Monitors, read from the transcript tail) and
`subagentsByIdAtom` (subagents), both in `frontend/app/view/agents/subagentsstore.ts`. `SubagentVM` does not carry
whether a spawn was async: `SubagentSpawn.async` is read in `resolveState` (`subagentcorrelate.ts`) and dropped. The
build carries it, and the subagent file's start time (`SubagentFileInfo.startedatms`, which "started most recently"
needs), through `correlateSubagents` into `SubagentVM`, with tests; the pure model counts a subagent only when it is
async and `state === "working"`.

## Where: a status line inside the box

When the agent has anything running, the chat box (`chatcomposer.tsx`) has one status line at its top, above the editor,
in the same pattern as the queued-message line (`data-chat-hold`, `chatcomposer.tsx:774`): a dot, truncating text, a
control at the right edge. With nothing running there is no line, and the box keeps its usual height. The box's height
already springs to its content (`contentH`), so the line appearing, opening and leaving animates the same way.

### Collapsed

The line names the running task that started most recently:

- a pulsing green dot (`bg-working pulse-dot`),
- its name: a shell command in mono (`task.label`), a Monitor by its description (`task.label`), a subagent by its type
  (`s.type`),
- how long it has run: `backgroundTaskSubline` (`monitortasks.ts`) for a shell or Monitor, and for a subagent its kind
  and model ("subagent · haiku"),
- "and N more" when other work is running,
- a chevron at the right edge that opens the list.

The whole line is the press target for opening.

### Open

The line unfolds into a list inside the box, and the box grows:

- a header row: "N running in the background" and a chevron that folds it again,
- one row per running item: a kind icon (shell, Monitor, subagent), its name, its second line (as in the collapsed line)
  and **Stop** for a shell or a Monitor when it can be stopped. Stopping uses the same condition and call as the peek
  (`bgTaskStoppable`, `bgSessionLive`, `stopBackgroundTask`: Windows only, live session).
- A press on a shell or Monitor row opens `BackgroundTaskPeek` (`backgroundtaskpeek.tsx`) anchored to that row, with
  Output, and Events for a Monitor. A press on a subagent row opens its conversation (`focusSubagentAtom`, as the
  `/tasks` card does in `chatlocalcards.tsx`).

Whether the list is open is remembered per agent (a per-agent jotai atom, since the box can unmount with its surface).

### With a queued message

When the box also shows the queued-message line (`data-chat-hold`), both show: the queued-message line first, because it
asks the person to act, then the background line.

### When a task ends

An item that is no longer running (completed, failed, stopped) leaves the line and the list at once. When nothing is
left, the line folds away and the box returns to its height. The Chat's own TASK completed card in the conversation
already reports how it ended.

### Asleep

A sleeping agent (`agent.sleeping != null`) has exited its Claude Code session, and its background work stopped with
it, so the box shows no line.

## Left to the builder

- The choice of the item the collapsed line names, its words, and the "and N more" count live in a pure model (e.g.
  `frontend/app/view/agents/chatbgtasks.ts`) with a vitest file beside it. Reuse `monitortasks.ts`. The component in
  the composer stays thin.
- `BackgroundTaskPeek` takes a placement so it can open above the row (today it is `right-start` beside the tree).
- Agent's call: `monitorPeekAtom` is shared with the Agent tree, whose `BackgroundTaskRows` draws a peek for any task
  the atom names. `MonitorPeekRef` gains an origin (`"tree"` or `"chat"`): a chat-row press sets `"chat"` and only the
  composer draws that peek; the tree and the `/tasks` card keep `"tree"` and behave as today.
- Agent's call: the composer only reads `backgroundTasksByIdAtom` and `subagentsByIdAtom`. `useSubagentTracking`
  already loads them for the whole roster from the shell and polls while anything runs.
- A CDP scenario in `scripts/cdp/scenarios.mjs` arranges an agent with a running background shell, a Monitor and a
  working subagent through the existing fixture helpers (`scripts/cdp/agent-page-fixtures.mjs` `writeTranscript` and
  `writeSubagent`, as `scenarios-agent-streams.mjs` already does), and shoots the collapsed line and the open list.
- One `CHANGELOG.md` line under `Added`.
- UI copy is English, as the rest of Chat.

## Out of scope

- Ended tasks in the box (the TASK completed card covers them).
- Any change to the Agent tree, the `/tasks` card or the peek's contents.
