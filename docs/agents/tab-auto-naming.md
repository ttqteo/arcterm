# Agent tab auto-naming — sidebar rows labeled by ai-title

Each agent's session row in the vertical nav auto-labels itself with the agent's
current **task summary** (Claude Code's `ai-title`) instead of the bare agent/tab
name. The label is **derived, never persisted** — a manual rename always wins and is
never overwritten.

`rowLabel` precedence (`frontend/app/view/agents/session-models/sessionviewmodel.ts`):

```
customLabel (manual rename, session:label)  ??  title (ai-title)  ??  agent name  ??  "session"
```

If rows show only the agent/tab name and never the task summary, **no title is
reaching Wave** — almost always the producer half (below), not the FE.

## Why the title rides the hook reporter, not the statusLine

Unlike usage (which has no hook and must ride the statusLine — see
[usage-reporting.md](./usage-reporting.md)), the title rides the **same
`agent:status` state event** that already carries state/detail/model. It is produced
by `wsh agent-hook` (in-repo, `cmd/wsh/cmd/wshcmd-agenthook.go`), wired into Claude
Code lifecycle hooks (`PreToolUse`, `Stop`, …) and auto-installed by the arcterm app.

The reporter already tail-reads the parent transcript to find the model; the title
extraction piggybacks on that same read. The ai-title is **not** in the hook payload —
it lives only in the transcript JSONL as `{"type":"ai-title","aiTitle":"…"}` records,
which Claude Code re-emits (and refines) roughly once per turn. The **last** one is
current.

## Data flow

```
Claude Code transcript JSONL   ({"type":"ai-title","aiTitle":"…"} near each turn's end)
        │
        ▼  cmd/wsh/cmd/wshcmd-agenthook.go : readLastTitle()  (tail ~64KB)
   agent-hook attaches the ai-title on parent STATE events (working / waiting / idle)
        │
        ▼  cmd/wsh/cmd/wshcmd-agenthook.go : agentHookRun() → publishAgentStatusData()
   publishes an `agent:status` WaveEvent  { state, …, title }
        │
        ▼  frontend/app/view/agents/session-models/agentstatusstore.ts : setupAgentStatusSubscription()
   data.state truthy  →  globalStore.set(getAgentStatusAtom(oref), data)   (stores whole payload incl. title)
        │
        ▼  frontend/app/view/agents/session-models/sessionsidebarmodel.ts : sessionSidebarViewModelAtom
   title = agentStatus?.title  →  SessionInput.title
        │
        ▼  sessionviewmodel.ts : rowLabel()   →   customLabel ?? title ?? agent
```

**The title must ride a state event.** `setupAgentStatusSubscription` only stores the
payload `if (data.state)` — a delta-only event (e.g. usage) is ignored for the row
atom. So `--title` is attached only in the reporter's parent-state branch (alongside
`--model`), never on subagent/usage deltas. All parent state events (working / waiting
/ idle) carry it, so the row keeps its label through the whole turn, including idle.

## Why a 64KB tail-read reliably catches the title

`--model` is safe to tail-read because `"model"` appears on every assistant turn. The
ai-title is emitted less often, so the worry was that in a long transcript the last one
sits above a 64KB tail window. Measured across real transcripts up to ~11MB, the **last
ai-title sits 193–24,525 bytes from EOF** — Claude emits it at the end of each turn, so
the existing 64KB tail comfortably catches it. `readLastTitle` parses per-line JSON
(titles are free text and may contain quotes, which a regex would truncate) and skips
the partial leading line a mid-file tail read produces.

## Reporter implementation (in-repo)

`cmd/wsh/cmd/wshcmd-agenthook.go` — two pure tail-readers (`readLastModel`,
`readLastTitle`, unit-tested in `wshcmd-agenthook_test.go`) plus the wiring in
`agentHookRun`'s parent-state branch:

```go
if em.AttachModelTitle && ev.TranscriptPath != "" {
    data.Model = readLastModel(ev.TranscriptPath)
    data.Title = readLastTitle(ev.TranscriptPath)
}
```

## Verifying

- `wsh agent-hook --help` — confirm the installed binary has the hook subcommand.
- Reporter logic on a real transcript is covered by `TestReadLastModelAndTitle` in
  `cmd/wsh/cmd/wshcmd-agenthook_test.go` (feeds a synthetic JSONL, asserts the last
  ai-title / model win).
- Live: with an agent active in a Wave block, its sidebar row relabels to the task
  summary within a turn (the next `PreToolUse`/`Stop` hook). A manual rename overrides
  it; clearing the rename reverts to the auto label.

## Behavior notes

- **Non-destructive.** `session:label` stays the user's manual override; the auto label
  is computed at render time and never written back.
- **Idle keeps the label.** The idle state event still carries `--title`, so a finished
  agent's row stays labeled with its last task summary.
- A fresh session before Claude has generated a title sends no `--title`; the row falls
  back to the agent/tab name until the first ai-title lands.
- In-repo wiring shipped in `1326371c`; the reporter `--title` passthrough (the producer
  half) is the piece that actually lights it up.
- **A session the Claude daemon hosts reports into the tab attached to it.** A session moved to the
  background runs under `claude --bg-pty-host …-pty-<key>` and keeps the environment of the terminal that
  first started the daemon, so its `WAVETERM_BLOCKID` names that terminal. `wsh agent-hook` and the mod's
  `wsh agentstatus` route its status, title included, and `wsh ask` its card, to the tab running
  `claude attach <key>`. With no tab attached the status is dropped and the ask falls back to the terminal
  prompt; the old tab is idled if it still shows the session working (`pkg/agentobserve/hosted.go`,
  `cmd/wsh/cmd/wshcmd-agenthosted.go`).
