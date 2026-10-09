# Agent sleep: an idle agent gives its RAM back and resumes on demand — design

Status: design settled 2026-10-09; not yet planned.

## Problem

On an 8 GB Mac every agent arcterm runs costs RAM whether it works or not. An idle Claude Code agent (its
turn finished, waiting on the person) keeps its process alive at 170–340 MB (the Consumers panel,
`docs/superpowers/specs/2026-10-08-consumers-panel-design.md`, measured 232–337 MB each). Agents the person
has stopped looking at pile up: on 2026-10-09 the panel showed three idle agents holding ~690 MB together.

Today the only way to get that RAM back is **Stop**: the process ends, the row leaves the sidebar, and the
person must find the conversation in Conversation History and press **Resume →** to go on. That is too
heavy for an agent the person means to come back to, and it is a manual chore they forget.

## Goals

- An idle agent idle for 30 minutes is put to sleep: its process ends and its RAM is freed, but its row,
  its terminal output and its conversation stay where they were.
- When free RAM runs low, the longest-idle agent sleeps early, one per minute.
- The person can also put an agent to sleep by hand, and wakes it with **Wake** or by sending it a message;
  it resumes the same conversation (`--resume`).
- Nothing that is still working is ever slept, including an agent that only looks idle.

Out of scope: sleeping a run's lead or workers (the engine owns them), sleeping codex (it cannot resume),
waking on a keystroke typed straight into a sleeping terminal, and trimming the cockpit's own WebContent
footprint.

## Decisions

1. **Two triggers.** wavesrv checks once a minute.
   - **By time:** an eligible agent idle for at least the **After idle for** setting (default 30 minutes)
     sleeps, whatever the free RAM.
   - **By RAM:** when free RAM is below 1 GiB, the eligible agent idle longest sleeps even before the time
     is up, one per check, so a drop never sleeps more agents than it needs.

2. **Eligibility: every condition holds.** One pure Go function decides, from the roster, process facts,
   the time, the settings and free RAM, which agents to sleep this check.
   1. State `idle` (never `working` or `asking`), for at least the setting's minutes (the time trigger) or
      at least one minute (the RAM trigger).
   2. No Claude background task, subagent or other child process alive under it: killing `claude` would
      kill them too.
   3. Its process tree's CPU near zero over the last 5 minutes. This catches a hook that reported idle
      by mistake, or a state stuck at idle.
   4. Not the lead or a worker of a run.
   5. A harness that resumes: claude, pi, opencode, agy.
   6. A known session id, so `--resume` has something to reopen.
   7. Not the agent the person is looking at (the focused agent, or a pane showing in the Agent grid).

   When nothing is eligible nothing sleeps; the Low RAM card (`pkg/memgate`) works as before.

3. **Sleeping lives in wavesrv,** which already holds the roster, the process-tree RAM (`pkg/memusage`) and
   the terminal controllers, so the timer runs on any surface. To sleep an agent it:
   1. writes `agent:sleeping` (with the time it slept and the RAM it freed) into the block's meta, after
      making sure `cmd:args` carries `--resume <session>` (the resume store, `agentresumestore.ts`,
      already bakes it);
   2. destroys the block's controller. The terminal's stored output stays.

   The roster reads `agent:sleeping` and reports the agent as **sleeping**, not ended: the row stays and
   offers no Close.

4. **Waking: `AgentsWakeCommand`.** It clears `agent:sleeping` and restarts the block with
   `--resume`, the sequence `restartOnAccount` (`claudeaccount.ts`) already uses. It runs from:
   - **Wake** on the card over the terminal and in the Consumers panel;
   - a message sent to a sleeping agent from the composer, `wsh agents send` or Jarvis. The message waits
     until the agent reports ready, then is delivered; if it is not ready in 60 seconds the message is kept
     in the composer and an error says so.

   Selecting a sleeping agent does not wake it: looking costs no RAM and no tokens.

5. **A restart does not wake.** `shouldRelaunch` (`agentresumestore.ts`) gains `agent:sleeping`, as it
   already skips a blocked or finished run's workers, so reopening arcterm leaves sleeping agents asleep.

6. **Manual Sleep.** **Sleep** in the Consumers panel row and the agent's right-click menu. It skips the
   time and the not-looking-at-it conditions (the person chose it) but keeps the background-task check:
   with one alive, it asks before stopping it.

7. **Settings → Agents.** **Sleep idle agents** (on/off, default on) and **After idle for** (minutes,
   default 30). Both are `wconfig` settings, so `task generate` runs after adding them.

## UI

- **Sidebar row:** a small moon in place of the state dot, and the age reads `sleeping 2h`. The name keeps
  its usual color: the row must not read as disabled.
- **Terminal pane:** the old output stays, under a card: **Sleeping since 14:20 · freed 330 MB** with
  **Wake**. The composer stays enabled.
- **Consumers panel:** sleeping agents in a **Sleeping** group at the bottom, RAM `—`, with **Wake** and
  **Stop**. Awake rows get **Sleep** beside **→ Sonnet**.
- **Toast:** one per check that slept anything: `Put 2 agents to sleep · freed 520 MB`.

Colors, radii and motion follow `DESIGN.md` tokens.

## Errors

- **Resume fails** (the session file is gone, another account is active): the card says why and offers
  **Start fresh** (relaunch without `--resume`) or **Close**.
- **The process will not die:** the agent is not marked sleeping; the next check tries again, and the
  failure is logged.
- **A message to a sleeping agent times out:** it stays in the composer, with an error toast.

## Testing

- **Go:** the eligibility function, one case per condition and per trigger; sleeping writes the meta and
  destroys the controller; waking clears it and restarts with `--resume`.
- **vitest:** `shouldRelaunch` leaves a sleeping block alone; the row, card and panel models show the
  sleeping state.
- **CDP scenario `agent-sleep`:** a fixture with one sleeping agent; screenshots of its row, its terminal
  card and the Consumers panel.
- **By hand on the Mac:** an agent idle 30 minutes sleeps, Activity Monitor shows its RAM gone, and **Wake**
  continues the same conversation.
