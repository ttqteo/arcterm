# Quota guard — design

Status: design settled 2026-10-07.

## Problem

When a provider's rate-limit window runs low, arcterm only says so quietly. Jarvis's pet turns "tired"
above 60% (a slower walk and a sweat drop, `petcondition.ts`), which looks the same at 61% and at 95%,
looks the same as a full RAM, and has to be opened to be read. Nothing raises a toast. The engine knows
nothing about quota: a run keeps spawning workers until Claude refuses mid-turn, and a worker that hits
the limit sits at its prompt until liveness calls it hung (`TurnEndedGrace`, `liveness.go`) and wakes the
lead, which usually retries it — killing the session and its context — into the same exhausted window.

Wanted: a warning at 85% and 95%, the engine holding new work at 95% and resuming on its own when the
window resets, a worker cut off by the limit continued in place rather than retried, and the pet showing
how much is left — briefly, because a standing indicator distracts the user.

Out of scope: switching Claude accounts automatically (`2026-10-07-claude-account-switch-design.md` keeps
switching manual); a per-run override to run through a hold; stopping workers already running; quota for
providers that report none.

## Decisions

### Roles

The pet is a glance, the toast is the warning, the engine is the action. Each works with the others
hidden: turning the pet off loses no warning and no hold.

### 1. Where the engine reads quota: `pkg/quotagate`

Today the live per-provider percentage is assembled only in the frontend (`ratelimitstore.ts`); the
server passes `agent:status` usage through without reading it, and `pkg/claudequota` fetches only when
asked. The gate is server-side so a hold does not depend on a window being open.

- `pkg/quotagate` keeps the latest `baseds.AgentUsage` windows per provider. `EventPublishCommand`
  (`wshserver.go`) feeds it every `agent:status` event that carries usage, beside the existing
  `orchestrate.NoteLeadStatus` call. Codex percentages are inverted the way the frontend's
  `normalizeAgentUsage` does.
- For claude, when its reading is older than 5 minutes or absent, the gate calls `claudequota.Get`
  (which already rate-limits itself to one fetch per 5 minutes and backs off on 429).
- `Held(provider) (held bool, reason string, resetAt int64)`: held when the 5-hour or the weekly window
  is at or above **95%**. A window whose reset time has passed counts as a fresh window, so a stale
  reading never holds past its reset. `resetAt` is the later reset among the held windows.
- No reading at all is "not held": a provider that reports no quota is never gated.

### 2. The engine holds new sessions

- In the worker spawn loop (`engine.go`, `for _, taskID := range NextToSpawn(g)`), right after
  `effectiveTaskRoute` resolves the task's runtime: when `quotagate.Held(runtime)`, `continue` without
  `failDispatch`. The task stays pending and the dag stays `running`. The check is a package var
  (`quotaHeld`) like `spawnWorker`, so tests script it.
- The same check guards the other sessions the engine starts: `spawnReviewer` (`review.go`),
  `spawnStageSession` (`stagesession.go`, plan review and final) and `advancePlanReview`
  (`planreview.go`). Each defers instead of failing.
- The gate is per provider: a claude hold leaves pi tasks running.
- Resume needs no new mechanism. The watchdog ticks every `running` dag every 30 s (`watchdog.go`);
  once the window resets, `Held` turns false and the next tick spawns.
- Wakes to the lead are held too while the lead's own provider is held: a wake typed into a
  rate-limited lead goes unconfirmed and marks the lead dead (`wakeUnconfirmedNote`). Held lines stay in
  the run's wake queue (`PostWake` appends, `flushLocked` delivers) and flush on the tick after the
  reset, the way a busy lead's do.

### 3. A worker cut off by the limit continues in place

95% does not stop a long task from reaching 100% mid-turn. Hooks give no reliable "stopped by the rate
limit" signal, so the gate's state stands in for one:

- When a worker's turn has ended past `TurnEndedGrace` and its provider is held, liveness does not call
  it hung. The task is marked `waiting-quota` (a task note, not a new dag status) and the lead is not
  woken.
- On the first tick after `Held` turns false, the engine sends `continue` to the worker's block with
  `SendToSession` (`wake.go`) — the path the lead's wakes take: over the mod's stream when the session
  holds one, typed and submitted otherwise. The session keeps its context and its uncommitted edits in the worktree.
- If the worker has not turned working within `WakeConfirmTimeout` (30 s), the task falls back to
  today's path: `taskTurnEndedWake` to the lead.

### 4. Surfacing a hold

- Entering a hold posts one run event per provider and window (`RunEventKind` `QuotaHeld`, once via the
  `NotifiedCondition` mechanism `noteMergesHeld` uses); leaving it posts `QuotaResumed`.
- `BuildAttention` (`pkg/jarvis/attention.go`) gets a kind `quota-held` per held dag: the provider, the
  window, and when it resumes. It is not in `DECISION_KINDS` — nothing is asked of the user, and the 95%
  toast already told them. It disappears when the hold lifts.
- A `QuotaResumed` event raises an `info` toast: "Run X continues — Claude's window reset".

### 5. Toasts at 85% and 95%: `quotaalerts.ts`

- A pure `frontend/app/view/agents/quotaalerts.ts` diffs each provider's merged windows
  (`mergeRateLimitWindows`) against the previous reading and emits one event per threshold crossed:
  85 → `warn` ("Claude has used 85% of its 5-hour window — resets in 1h20"), 95 → `error` ("Claude has
  used 95% — new run work is held until it resets in 1h20"). A reading that jumps past both emits only
  95.
- Each event fires once per window: its key is `provider + window + resetAt + threshold`, kept in
  localStorage, so a relaunch does not repeat it and a fresh window can fire again.
- The first reading after launch is a baseline and fires nothing (as `diffEvents` does); the pet's
  battery and the Plan usage strip still show the level.
- Events go through `routeNotify`: a toast while focused, an OS notification while not, under the
  existing `notify:toast` / `notify:os` settings. Clicking opens Usage.

### 6. The pet's battery: `petbattery.ts`

- Level = 100 minus the highest percentage across providers and both windows, drawn as a 4-bar
  battery. Colour follows `usageLevel`: `--color-success`, `--color-warning`, `--color-error`.
- A new `PetMark` `battery` with one `MARKS` stamp per bar count in `petsprite.ts`, drawn in the overlay
  like the sweat drop.
- It shows for 6 s at a time, never standing:
  - on crossing 60, 85 or 95 — at 60 the pet also says a line (`pushPetEvent`); at 85 and 95 it only
    shows the battery, since the toast already spoke;
  - while the pointer is over the pet or the peek is open;
  - every 30 minutes while above 85.
- `petbattery.ts` is pure: the level from the signals, and the next show time from crossings, hover and
  the last show. `petwalk.view()` adds the mark while the show window is open.
- The tired face loses its sweat drop (the drop stays for a full RAM); the slower walk stays. The
  peek's quota line keeps its wording and, while the engine holds a run, carries an `open` act to that
  run — so the row is no longer the readout-only exception in `petacts.ts`.

## Testing

- `pkg/quotagate`: held at 95 on either window, not held below, a passed reset is not held, codex
  inversion, no reading is not held, claudequota fallback when the event reading is stale.
- `pkg/orchestrate`: a held runtime leaves the task pending without a failure; a pi task spawns while
  claude is held; reviewer and stage sessions defer; the tick after the reset spawns; a turn-ended worker
  under a hold is `waiting-quota` and gets `continue`, and falls back to the lead wake when it does not
  turn working; lead wakes queue under a hold.
- `pkg/jarvis`: `quota-held` attention item appears and clears.
- `quotaalerts.test.ts`: each threshold, both in one jump, once per window, a new window fires again,
  the baseline fires nothing, a stale reading fires nothing.
- `petbattery.test.ts`: level across providers and windows, show on crossing, hover, the 30-minute
  repeat, never standing. `petwalk` tests cover the `battery` mark.
- CDP: a `pet-battery` scenario in `scripts/cdp/scenarios.mjs` forces the battery visible and shoots it.

## To verify in implementation

- That `SendToSession`'s `continue` reaches a worker that stopped on a rate-limit error the same way it
  reaches one at its prompt.
- How `claudequota.Get` behaves when called from the engine tick with a token that has expired (it never
  refreshes); an error must read as "no reading", not as a hold.
