# Token burn guard, v1: a gate before an agent spawns subagents

Status: design, 2026-10-08. Picks up part (1) of "(arcterm) Token burn guard" in `docs/deferred.md`; parts (2)
(burn alert toast) and (3) (cache reads apart in Consumers) stay deferred.

## Problem

On 2026-10-08 one docs session with 4 subagents and 3 demo agents took the account from ~20M to ~220M tokens in
about an hour, almost all cache reads: every tool call re-sends the whole context, so spend ≈ context × calls ×
agents. Nothing asked before the fan-out started. `wsh memgate` already holds a heavy shell command for the
person's say while RAM is short; the same shape fits a spawn.

## What v1 does

Before a Claude Code agent inside arcterm runs `Agent`, `Task` or `Workflow`, arcterm decides whether the
spawn is worth a question. **Most spawns are not:** a lone subagent while the window has room runs at once, and
the agent's log gets one `arc:` line ("Token burn: starting 1 subagent, about 1.5M tokens, ~3% of the 5h
window"). A card asks only when one of these holds:

- the spawn would take **≥ 10%** of the 5-hour window (`tokengate:sharepct`);
- the window is already **≥ 70%** used (`tokengate:windowpct`);
- the group starts **≥ 3** agents at once (`tokengate:agents`);
- it is a **Workflow**.

A rule whose number is unknown (no quota reading, share not computable) does not fire; the others still do.

The card is the ask card memgate's "Low RAM" uses:

- **Header:** `Token burn`
- **Question** (one paragraph, rough numbers say so):
  "An agent wants to start 3 subagents, about 4.5M tokens (rough). Its own context is 142k of 200k, and each of
  its further calls re-reads that. The 5-hour window is 62% used and resets at 14:20; this would take about 9%
  more."
  - Workflow: "An agent wants to run a workflow with at least 4 agents, about 6M tokens (rough)…"
  - An unknown number is left out of the sentence rather than shown as 0.
- **Options:**
  - `Allow`: this group; a later spawn that meets a rule asks again.
  - `Allow this turn`: this group and every later spawn until the person's next prompt, without asking.
  - `Allow this session`: every spawn of this session, without asking, until the session ends or is cleared.
  - `Don't spawn`: this group and every later spawn of this turn are refused.

A dismissed card, a typed answer or no answer is `Don't spawn`, as in memgate.

Decisions (brainstorm, 2026-10-08):

- Ask only when it matters: a card on every spawn trains a reflex Allow, which guards nothing. Thresholds are
  settings; `tokengate:enabled: false` turns the gate off. On by default.
- **One card per group:** parallel `Agent` calls in one message fire one hook each; they are gathered.
- Claude Code only. pi and opencode have no built-in subagent tool.
- Engine-run agents go through the same rules; exempting them needs a "this block is a run's" tell the hook
  can read cheaply, which v1 does not have.

## The estimate

`pkg/tokengate` holds the model in one place, deliberately simple and labelled rough:

- `PerAgentTokens = 1_500_000`: a subagent's typical run, ~30 tool calls at a ~50k average context, nearly all
  of it cache reads. Calibrating it from saved transcripts is the measurement the deferred entry asks for and
  is a follow-up.
- `Estimate(agents) = agents × PerAgentTokens`.
- **Agent count:** `Agent`/`Task` = 1 per call, summed over the group. `Workflow` with an inline `script` =
  the number of `agent(` call sites, at least 1, shown as "at least N". A `Workflow` by `name` or `scriptPath`
  = "at least 1".
- **Window share:** capacity ≈ `fiveHourTokens / (fiveHourPct / 100)`, `fiveHourPct` from
  `GetClaudeQuotaCommand`, `fiveHourTokens` from `GetWindowTokensCommand` with cutoff = reset − 5h. Computed
  only when `fiveHourPct ≥ 5` and `fiveHourTokens > 0`. Known uncertainty: the transcript count includes cache
  reads, which the real limit may weigh less, so the share may overstate; it is labelled "about".
- The agent's own context comes from the mod's last `session.measure`.

## Components

### `pkg/tokengate` (Go, pure)

Mirrors `pkg/memgate/card.go`:

- `Spawn { Tool; Agents; AtLeast; ContextTokens, ContextMax }`, `Quota { FiveHourPct, FiveHourReset, Share }`
  (pointers: nil is unknown), `Rules { SharePct, WindowPct, Agents }` with `DefaultRules` 10 / 70 / 3.
- `Estimate`, `WindowShare`, `Asks(Rules, Spawn, Quota) bool`, `Note(Spawn, Quota) string` (the log line),
  `Question(Spawn, Quota, loc)`, `Choice`, `VerdictFor(choice, Spawn)`, `Asking(Spawn)` (hold line).
- `Verdict { Run bool; Scope string ("turn" | "session" | ""); Reason string; Note string }`. The deny reason:
  "Not run: the person chose not to start subagents now (token budget). Do not retry a spawn this turn; do
  the work in this session or ask the person, and say in your report that the spawn was refused."

### `wsh tokengate` (`cmd/wsh/cmd/wshcmd-tokengate.go`, hidden)

`wsh tokengate --tool <Agent|Task|Workflow> --agents N [--at-least] [--context-tokens N --context-max N]`

1. Settings via `GetFullConfigCommand`; disabled → `{"run":true}`.
2. Quota and window tokens (5 s timeouts; a failure only leaves those numbers unknown).
3. No rule fires → `{"run":true,"note":"…"}`.
4. Otherwise resolve the card's target as `memgateDecide` does, print the hold line, `AskCommand` with `Wait`
   and `Hold`, map the choice.

Output as memgate: hold lines, then one verdict line. Any error exits non-zero with nothing on stdout and the
mod lets the spawn run: a broken gate never blocks an agent.

### Settings (`pkg/wconfig/settingsconfig.go`)

`tokengate:*` (clear), `tokengate:enabled` (`*bool`, nil = on), `tokengate:sharepct`, `tokengate:windowpct`,
`tokengate:agents` (`*float64`/`*int`, nil = the default; 0 turns that rule off). Then `task generate`.

### Claude mod (`claude/arc-mod/hooks/`)

- `tokengate-core.ts` (pure, vitest): `spawnCount`, `joinGroup`, `tokengateArgs`, `tokengateLine`
  (hold / verdict with scope and note / null), `decisionAfter(verdict)`.
- `register.ts`: `tool.call` on `Agent`, `Task`, `Workflow` (only while `active`):
  - decision `allow-session` or `allow-turn` → run; `deny-turn` → refuse with the stored reason.
  - Otherwise join the open group, or open one and wait `GATHER_MS = 400` for siblings, then spawn
    `wsh tokengate` once and give every member the same verdict; log the note when there is one.
  - `classic.UserPromptSubmit` clears a turn decision (not `turn.start`, which does not say whose turn it is);
    `session.start` clears all, a session decision included.
  - `session.measure` keeps the last context reading for the args.
- Spawns from a subagent go through the same gate.

If Claude Code runs parallel `Agent` hooks one after another rather than together, the group holds one spawn;
the agent-count rule then never sees the whole batch, but `Allow this turn` still spares the rest. The live
check in the plan settles which.

## Failure and edge cases

- Outside arcterm, the setting off, or any wsh error: the spawn runs.
- The session runs in the Claude daemon with no tab: wsh errors, the spawn runs (as memgate).
- No measure yet: the context clause is left out. No quota reading: the share and window rules do not fire.
- The card is the only place to answer; there is no terminal dialog for it (as memgate).

## Testing

- Go: `pkg/tokengate` table tests for `Estimate`, `WindowShare`, `Asks` (each rule alone, a rule at 0 off,
  unknown numbers), `Note`, `Question` with each clause present or absent, `Choice`, `VerdictFor`.
- Go: `tokengateDecide` returns at once on a done context (as memgate's test).
- vitest: `tokengate-core.test.ts`.
- `claude plugin validate claude/arc-mod`.
- Live (starts a few tiny subagents; ask first): one Haiku subagent passes silently with a note; three in
  parallel ask once; each option's effect.

## Out of scope

The burn-rate toast and the context-over-150k nudge (deferred part 2), cache reads in Consumers (part 3),
calibrating `PerAgentTokens`, pi/opencode, exempting engine runs, and memgate's own prompt fatigue on a small
Mac (its own deferred entry).
