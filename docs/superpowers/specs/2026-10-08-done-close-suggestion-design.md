# Done → Close suggestion

When an agent you opened has finished its work, the cockpit offers to close it: a `✓ Close` chip on its sidebar row
and a `✓ Done · <tokens> — Close` button in its header. Today closing is the row's context menu or the header's X, and
finished agents pile up in the Active list.

## What counts as done

All of:

- the agent is **idle**;
- its **last turn ended on a git commit**: a `git commit` Bash call that did not fail, with no file edit after it in
  the same turn;
- you have **read** that turn (no unread finished turn for it);
- it is not asking anything, and it is not a run's worker (the engine closes those at merge).

Idle alone is not done: an agent idles after every reply. A commit is the clearest sign a piece of work is finished.

## Signal: `committed` on the idle status

- `wsh agent-hook` already reads the current turn of the transcript on every idle event to find its step
  (`readLastStep`). The same pass now decides `committed`: walking the turn's records, a Bash `tool_use` whose command
  runs `git commit` (not `--dry-run`) sets it; an `Edit`, `Write`, `MultiEdit` or `NotebookEdit` after it clears it;
  a `tool_result` marked `is_error` for that commit call clears it (a pre-commit hook that failed). A user record with
  human prose starts a new turn and clears it.
- `baseds.AgentStatusData` gains `committed bool` beside `step`; `task generate` carries it to the frontend.
- Like `step`, it is transient: every idle event carries it, so a later turn without a commit drops it, and a working
  agent never shows it.
- Claude only in this pass. pi can report it later through its extension.

## UI

- `doneSuggestion(agent, unreadCount)` (pure, `donesuggest.ts`, tested) is the one rule; the row chip and the header
  button both read it, so they show and hide together.
- **Row:** a `✓ Close` chip at the end of the second line, in place of the status dot; tokens and age stay. Its click
  stops at the chip (it does not select the row) and opens `confirmCloseSession`, the same confirm as Close agent.
  Hover: "Committed in its last turn: close this agent".
- **Header:** `✓ Done · 30.7M tok — Close` beside the X; the total is the session's tokens (`liveTokensAtom`, the row's
  figure), left out while unread. Same confirm on click.
- Colours from `@theme` tokens only (`text-success`, `border-success`).

## Testing

- Go: the turn walk — a commit, a `--dry-run`, a commit in an earlier turn, an edit after the commit, a failed commit,
  a turn with no Bash.
- Vitest: `doneSuggestion` for each condition.
- CDP: a fixture agent with `committed`, shot on its row and header (needs the dev app).
