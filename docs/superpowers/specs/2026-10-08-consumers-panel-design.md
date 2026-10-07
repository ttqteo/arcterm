# Consumers panel: what is eating RAM and tokens, and stopping it — design

Status: design settled 2026-10-08.

## Problem

On an 8 GB Mac, macOS's memory monitors show `wave-tauri` at nearly 3 GB, and the person cannot tell what
inside it is heavy. Measured with `footprint` on 2026-10-08, that 2.7 GB was six Claude Code agents
(232–337 MB each, 1.8 GB together), the WebKit WebContent process that draws the cockpit (684 MB, then
778 MB), `wavesrv` (121 MB), WebKit's GPU process (62 MB) and the host (47 MB). Nothing in arcterm says so:
the app bar's RAM chip (`workercapacitychip.tsx`) shows only the machine's free RAM, and `pkg/workercap`
samples run workers' RSS only to size the worker cap.

Tokens have the same blind spot. A run whose workers were meant to run Sonnet but were launched on Opus
burns the plan's 5-hour quota fast, and the person finds out from the quota meter after the fact. Each
agent's model and session totals are known (`AgentVM.model`, the rail's Session section), but no view ranks
agents by how fast they are spending now, and no control acts on the one that is.

## Goals

- Click the RAM chip: a panel lists every agent arcterm runs, heaviest first, with its RAM, its model and
  its tokens of the last 10 minutes; arcterm's own processes (interface, server, host) are listed below.
- Click the plan-usage meters: the same panel, ranked by tokens.
- From a row: **Stop** the agent (a run worker included), or switch a Claude agent on Opus **→ Sonnet**.
- Hovering the RAM chip keeps today's tooltip.

Out of scope: apps outside arcterm (Chrome and the rest; the person chose arcterm's own processes only), a
Quit for other apps, per-agent RAM history or charts, alerts pushed while the panel is closed, picking the
worker model at run launch (a separate fix), and reducing the WebContent footprint itself (scrollback is
the likely cause; a separate investigation).

## Decisions

1. **One panel, two entry points.** `ConsumersPanel` is a popover dropped from the app bar, built on the
   in-house popover primitive (`frontend/app/element/`), shadows and colors from DESIGN.md tokens only.
   Clicking `WorkerCapacityChip` opens it sorted by RAM; clicking the plan-usage meters (`usagemeters.tsx`)
   opens it sorted by tokens. The meters' click opened the Usage surface until now; the panel's footer
   carries an **Open Usage** link so that destination stays one click away. `Esc`, a click outside, or a
   second click on the opener closes it.

2. **Rows.** Header: free RAM of total (`1.3 GB free of 8 GB`), the plan's 5-hour use, and a **RAM | Tokens**
   sort toggle. One row per agent: its state dot (the rail's colors), name, project, model, RAM, and tokens
   of the last 10 minutes with their estimated cost. Run workers are grouped under a `Run <short id>` header
   row. Below the agents, arcterm's own: **Interface**, **Server**, **Host**, read-only. A click on an agent's
   name opens it through the router (`openTarget`, `frontend/app/view/jarvis/openref.ts`).

3. **Warnings.** A Claude agent on Opus shows its model label in the warning tone. The agent with the most
   tokens in the window gets a ⚠ when that count passes 500K. Both are computed in the pure model
   (decision 10), with the threshold as one named constant.

4. **One RPC: `GetConsumersCommand`.** It takes no arguments and returns the machine's total and free RAM,
   one entry per live agent block (block id, RAM bytes, and the window's tokens split by model and by class:
   input, output, cache read, cache write), and arcterm's own processes (interface, server, host bytes). A
   value that could not be read is absent, never zero. The panel polls it every 5 s while it is open and
   never while it is closed. The 5-hour quota comes from the usage the agents already report
   (`AgentUsage.FiveHourPct`), not from this RPC.

5. **RAM is measured in `wavesrv`, in a new `pkg/memusage`.**
   - *An agent* is its block's process tree: the shell pid from `blockcontroller.GetBlockControllerPid` and
     every descendant. The tree walk in `pkg/orchestrate/liveness.go` (`processTree`) moves to
     `pkg/memusage` and both use it.
   - *One walk per poll.* The process list is read once per call and turned into a pid → children index;
     every agent's tree comes from that index. On darwin `Children()` reads every process, so walking per
     agent would read the table once per agent.
   - *The figure.* On darwin, the physical footprint from `proc_pid_rusage(RUSAGE_INFO_V2).ri_phys_footprint`
     through cgo (`wavesrv` already builds with CGO on darwin): it is what Activity Monitor and the person's
     monitor show, and it counts compressed memory that RSS misses. A probe on 2026-10-08 read it for the
     user's own processes without privileges. Elsewhere, gopsutil's RSS (the working set on Windows).
   - *Server* is `wavesrv` itself; *host* is its parent (the Tauri host spawns it).
   - *Interface.* On darwin the WebKit WebContent, GPU and Networking processes are XPC services, not the
     host's children; they are the processes whose responsible pid
     (`responsibility_get_pid_responsible_for_pid`, the call Activity Monitor groups by) is the host, minus
     the host itself and any process already counted in an agent's or the server's tree. The 2026-10-08 probe
     returned the host's pid for all three. On Windows, WebView2's processes are the host's descendants
     outside `wavesrv`'s tree. If the call is missing or fails, Interface is absent.

6. **Tokens are read from transcripts, incrementally.** Each agent's transcript path is the one its status
   already carries. A per-path reader keeps its byte offset and a 10-minute ring of (timestamp, model,
   token classes) records; each poll reads only what was appended, parses it with the record parser
   `usagestats.TranscriptUsage` uses (so the panel counts what the rail counts), and drops records older
   than the window. A truncated or replaced file (size below the offset) is re-read from the start. Readers
   for transcripts no agent names any more are dropped. Cost is computed in the frontend with
   `usagepricing.ts`, as the rail does, so the two never disagree.

7. **Stop, for an agent you opened, is the existing close.** The row's Stop calls `confirmCloseSession`
   (`agentactions.ts`): the same confirm as the header's Close; ending the session frees its memory, and
   the conversation stays in Conversation History. For a run's lead, that confirm already offers the whole
   run or the lead only.

8. **Stop, for a run worker, is a new engine action `stop`.** Closing a worker's tab is not enough: the
   engine reads a running task whose worker is gone as Stalled and launches a fresh worker
   (`engine.go`, `workerControllerGone`), possibly on the same model, and `skip` refuses a running task
   (`skippable`). `stop` joins the dag actions behind the existing dag-action RPC (`wshserver_dag.go`, next
   to retry, skip and escalate) and `wsh jarvis dag stop`: in one step it marks a running, stalled or
   reviewing task Cancelled and closes its worker's tab, so no tick relaunches it. Tasks that depend on it
   wait until the person retries or skips it in the run. The row's confirm says so: *"Stop worker t-3 of
   run 85548d0b? Its task stops and is not retried; tasks after it wait until you Retry or Skip it in the
   run."* A task in any other state is refused with the engine's reason, shown in a toast.

9. **→ Sonnet sends `/model sonnet` into the session.** Shown only on a Claude agent whose model is Opus;
   pi agents have Stop only. It goes through the existing prompt path into the session, whose Claude mod
   runs a leading-slash line as a slash command (`deliver` in `claude/arc-mod/hooks/control-core.ts`), so the
   agent keeps its progress. No confirm; a toast says it was sent, and the model label changes with the
   agent's next status. Whether `/model` applies inside a running turn is verified in the plan's first task;
   if it only applies from the next turn, the toast says "from the next turn". Re-running a worker's task on
   Sonnet (the existing `escalate`) is not added unless that check shows the in-session switch cannot help a
   long worker turn.

10. **Pure model, thin view.** `frontend/app/view/agents/consumers.ts` joins the RPC with the roster
    (`agentsAtom`: name, project, state, model, run), sorts by RAM or tokens, groups workers by run, sets the
    warnings and which actions each row offers. `consumers.test.ts` covers it. `consumerspanel.tsx` only draws;
    `consumersstore.ts` holds the poll, started by the open panel and stopped when it closes.

11. **Errors.** A failed poll keeps the last reading, dimmed, with one line: *"Couldn't read usage · last at
    12:03"*; the next poll retries. A missing value shows "—" in its cell and leaves the row. A failed Stop or
    → Sonnet shows a toast with the reason and changes nothing in the row.

## Testing

- **Go, `pkg/memusage`:** table tests over a fake process table: a tree's sum; one walk serving every
  agent; Interface by responsible pid, excluding agent and server trees; a missing footprint or
  responsible-pid call leaving the value absent. The token reader: appended records counted, records past
  the window dropped, a truncated file re-read, a forgotten path's reader dropped.
- **Go, `pkg/orchestrate`:** `stop` on a running task makes it Cancelled and closes its worker's tab; the next
  tick does not relaunch it; a stalled and a reviewing task stop too; done, pending and skipped tasks are
  refused.
- **Vitest, `consumers.test.ts`:** the join with the roster; both sorts; grouping under runs; the Opus and
  burn warnings; Stop on every agent row and → Sonnet only on Claude-on-Opus; absent values staying absent.
- **CDP:** a `consumers-popover` scenario in `scripts/cdp/scenarios.mjs` opens the panel over fixture data.
  It runs on Windows; on a Mac the plan's Final guards it as AGENTS.md says (WKWebView answers no CDP).
- **By hand on the Mac:** the panel's numbers against Activity Monitor; Stop on an idle agent; `/model
  sonnet` sent to an agent mid-turn (decision 9's check).
