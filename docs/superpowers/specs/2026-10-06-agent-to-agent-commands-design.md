# Agent-to-agent commands: find, message and read a live agent from wsh

Effort: effort:9a24ac55-5ea9-4b18-a171-5dc481160d0f

## Why

On 2026-10-06 an agent had review changes for a design agent whose run had finished but whose tab was
still open with its full context. `wsh` has no command that prompts an existing session (only the
cockpit composer does), so the agent started a second run. The user rejected that as waste. An agent
must be able to hand a follow-up to a live agent.

## What ships

Three commands under a new `wsh agents` group, three wshrpc commands behind them, and one skill rule.

```
wsh agents list [--all] [--json]
wsh agents send <tab> <text | --file path> [--wait] [--timeout 10m]
wsh agents read <tab> [--json]
```

`<tab>` is a tab id or any unique prefix of one, as `list` prints it. Only claude and pi sessions are
agents here; codex and opencode sessions are not listed and cannot be messaged.

## Decision 1: delivery path

**Reuse `orchestrate.SendToSession(blockId, text)` (`pkg/orchestrate/wake.go`). Build no second path.**

What the code shows:

- The cockpit composer does not choose between two paths. `agentcomposer.tsx` and `driveAgent`
  (`agentactions.ts`) only ever type through `ControllerInputCommand`.
- The choice already lives server-side, in `typeWake` / `overStream`: when the session's Claude mod
  holds an `AgentControlCommand` stream (`agentctl.Has(blockId)`), the text goes over it, with
  `MidTurn` set when the session is not at its prompt, so a working session takes it into the running
  turn and an idle one runs it as a prompt. Otherwise the text is bracketed-pasted into the terminal
  and submitted with Enter.
- That path already carries the engine's wakes, `wsh jarvis dag tell`, review notes and
  `steerRunLead`. `SendToSession` is its exported entry.

So: a claude session with the Arc mod gets the message over the stream; a claude session without a
stream and every pi session get it typed. Pi has no control stream, and its editor queues text typed
mid-turn, which is the same "queued if mid-turn" behavior.

One hazard on the typed path: a session with a question open in its terminal would take the pasted
text and its Enter as the answer (the reason `flushLocked` checks `leadAsking`). `send` therefore
refuses a target that is asking when it holds no control stream. Over the stream the message joins the
turn and the dialog is untouched, so that case is allowed.

## Decision 2: reply model

**`send` returns once the prompt is handed over. `read` returns the target's last answer. `send --wait`
is included, as a client-side loop over `read`.**

- `send` cannot return the answer cheaply: a turn can run for many minutes and may end in a question
  to the human.
- `read` takes the last assistant text from the target's transcript. The transcript path comes from
  the target's latest agent status (`AgentStatusData.TranscriptPath`), then the block's
  `agent:transcriptpath` meta, then `agentsessions.TranscriptForSession` from the status's cwd and
  session id.
- `--wait` is cheap because it needs nothing new on the server: `send` returns the server time it
  handed the prompt over, `read` returns the target's state and the transcript time of its last
  answer, and `wsh` polls `read` until the target is no longer working and its last answer is newer
  than the send. It then prints that answer. On timeout it exits nonzero and says the target is still
  working and how to read later. If the target ends up asking the user a question, it says so instead
  of waiting on.

## Decision 3: guardrails

**Sender shown in the transcript.** Every message is wrapped in one envelope, built in one place:

```
[Message from agent "<sender tab name>" (tab <sender tab id>), sent with wsh agents send. Not typed by the user. Its sender reads your reply with wsh agents read, so answer here and do not send one back.]
<text>
```

The header is plain text because that is the one form that reads the same over the stream, typed into
claude, and typed into pi. It also means a message can never start with a slash, so one agent cannot
run a command (`/clear`, `/compact`) in another's session. The sender is the tab of the block `wsh`
runs in; the server resolves its name, the caller cannot set it.

Agent messages must not be recorded as the human's words. `agentsessions.HumanPrompts` feeds the
"what the human told this worker" scan (`orchestrate/told.go`). A message over the stream is already
skipped (its origin is the plugin, not `human`); a typed one is not. `HumanPrompts` skips any prompt
that starts with the envelope's fixed prefix, for claude and pi.

**No loops: no send-back in the same turn** (user decision). After A messages B, B may not `send` to
A until B's turn has ended. An in-memory map in wavesrv records `B <- A` at send; an agent status of
idle or waiting for B's block clears it, from the agent-status event that already passes through
`EventPublishCommand`. A refused send says why and that the sender reads the reply itself. An agent may
not message its own tab. The lock is lost on a wavesrv restart, which is acceptable.

**Cross-project: allowed** (user decision). `send` and `read` take any live agent tab. `list` shows
the caller's project by default and every project with `--all`.

## Design

### `pkg/agentmsg` (new, no dependencies on the engine)

- `Envelope(senderName, senderTabId, text string) string` and `IsAgentMessage(text string) bool`,
  sharing one prefix constant.
- The send-back lock: `NoteSent(fromBlock, toBlock)`, `SendBackLocked(fromBlock, toBlock) bool`
  (true when `toBlock` messaged `fromBlock` and `fromBlock`'s turn has not ended), `TurnEnded(block)`.

### `pkg/agentsessions`

- `LastAnswer(path, runtime string) (text string, ts int64)`: the last assistant text of a claude or
  pi transcript and its transcript time; sidechain (subagent) records do not count; `""` when there is
  none or the runtime is another. Full text, not clipped.
- `HumanPrompts` skips agent messages, checked after the `<pasted_content>` wrapper is removed.

### wshrpc (`pkg/wshrpc/wshrpctypes_agents.go`, then `task generate`)

- `AgentsListCommand(ctx) (*CommandAgentsListRtnData, error)`: rows of
  `AgentInfo{tabid, name, projectpath, project, runid, harness, state}`.
- `AgentsSendCommand(ctx, CommandAgentsSendData{tab, text, fromoref}) (*CommandAgentsSendRtnData, error)`
  returning `{tabid, sentts, midturn}`.
- `AgentsReadCommand(ctx, CommandAgentsReadData{tab}) (*CommandAgentsReadRtnData, error)` returning
  `{tabid, state, answer, answerts}`.

### Server (`pkg/wshrpc/wshserver`)

The roster is one function, used by all three handlers:

- A row is a tab whose first block's shell is running and whose latest agent status (block or tab
  scope, the read `orchestrate.latestAgentStatus` already does, exported for this) names claude or pi.
- `state` is `asking` when the status says so or the ask registry holds an open ask for the block,
  `idle` for idle or waiting, `working` otherwise.
- `runid` is the run that lists the tab as a phase worker (`runHasWorkerTab`); `projectpath` is that
  run's project path, or the status's cwd for a session no run owns; `project` is the channel name
  for that path, or the path's last element.
- ponytail: a tab whose agent exited back to its shell keeps its last status and still reads as live;
  a typed send lands in the shell. Use the control stream or a session-end report as the liveness
  signal if that happens in practice.

`send` checks, in order, each with its own error: the tab resolves to exactly one roster row
("not a live agent session", or the candidates when a prefix is ambiguous); it is not the sender's own
tab; the send-back lock is open; the text is not empty; the target is not asking without a control
stream. It then records the lock, wraps the text and calls the delivery seam, a package variable
defaulting to `orchestrate.SendToSession`, so tests use a fake and no live session.

`read` resolves the tab the same way and returns the state with `LastAnswer` for its transcript.

`EventPublishCommand` calls `agentmsg.TurnEnded` for an agent status of idle or waiting.

### wsh (`cmd/wsh/cmd/wshcmd-agents.go`)

- `list`: a table of tab id (short), name, project, run (short id), harness, state; `--json` prints
  the rows. Without `--all` it keeps rows whose project path is inside the caller's project, resolved
  the way `wsh runs` resolves it; a caller outside any project sees every row.
- `send`: text from the argument or `--file`, never both, never empty. Prints what was delivered to
  whom and whether it joined a running turn. `--wait` as in Decision 2.
- `read`: prints the answer; with none, says the session has not answered yet. `--json` prints the
  reply data.

### Skill

`skills/cockpit-runs/SKILL.md` gains the rule: for follow-up work on something a finished run did,
find the run's agent with `wsh agents list`; when its tab is still live, `wsh agents send` it the
follow-up and `wsh agents read` the answer, and start a new run only when no live agent holds that
context. The description line names `wsh agents` so the skill is found for this.

## Errors

Every refusal is returned as the RPC error and printed by `wsh` as is. Delivery itself is
fire-and-forget, as it is for every other caller of `SendToSession`: a paste that fails after the
handler returned is logged by wavesrv, and the sender sees no answer arrive on `read`.

## Tests

- `pkg/agentmsg`: envelope round-trips through `IsAgentMessage`; lock set, refused, cleared by
  `TurnEnded`, and unaffected for another pair.
- `pkg/agentsessions`: `LastAnswer` for claude and pi fixtures (last text wins, sidechain ignored,
  none gives `""`); `HumanPrompts` drops an enveloped prompt, plain and inside `<pasted_content>`.
- `pkg/wshrpc/wshserver`: state mapping and row building from a scripted roster; each `send` refusal;
  a good send hands the enveloped text to the fake seam and records the lock; `read` returns the
  fixture's answer.
- `cmd/wsh/cmd`: list lines and project filter, text-or-file argument rules, and the wait loop's stop
  conditions with a scripted `read`.

## Out of scope

- A drawn transcript row for agent messages in the Claude view mod.
- Messaging codex or opencode sessions.
- Cockpit UI for agent messages.
- A persisted message log.
