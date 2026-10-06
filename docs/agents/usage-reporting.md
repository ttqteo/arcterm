# Agent usage reporting — context %, cost, plan limits

The Agents tab shows two usage readouts:

- **Per-agent context bar** (focus view): `ctx [▓▓▓░] 84k / 200k · 42% · $1.23` — each
  agent's own context-window fill, token estimate, and session cost.
- **Account-wide "Plan usage" strip** (list header): the Claude.ai Pro/Max 5-hour
  ("Session") and 7-day ("This week") rate-limit gauges. These are account-global —
  every agent reports the same numbers, so the view shows the freshest one.

Both are driven by a single `AgentUsage` snapshot per block. If neither readout
appears, **no usage data is reaching Wave** — see the data flow below.

## Where usage comes from

Agent **state** comes from `wsh agent-hook` in the Claude Code lifecycle hooks; those payloads carry no
usage numbers. Usage reaches arcterm one of two ways, chosen by `wsh install-agent-hooks` from
`claude --version`:

- **Claude Code 2.1.287 and later:** the arcterm Claude mod (`claude/arc-mod`, installed to
  `~/.arc/claude-mod` and loaded through `env.CLAUDE_CODE_PLUGIN_DIRS`) hooks `session.measure`, which
  fires when the context fill, a rate-limit window or the cost changes, and runs
  `wsh agentstatus --usage`. Your `statusLine` is left as you wrote it; a wrapper an older arcterm added is
  unwrapped back to your original command.
- **Older Claude Code:** the statusLine JSON is the only source, so arcterm wraps `statusLine.command` in
  `wsh statusline --inner=<base64 of your original command>`, which publishes the usage and then runs
  your original command with the same stdin.

A session only learns its rate-limit windows from its first response, so both sources say nothing
about the account until a claude turn has run. For the **account's Claude windows with no session
running**, wavesrv reads them itself (`pkg/claudequota`, the `GetClaudeQuotaCommand` RPC):

- It asks `GET https://api.anthropic.com/api/oauth/usage` with the access token Claude Code stored in
  `<config dir>/.credentials.json` (`CLAUDE_CONFIG_DIR`, else `~/.claude`). The token is only read,
  never refreshed: rotating it would sign Claude Code out. An expired one is skipped until Claude Code
  refreshes it on its next run.
- The endpoint is rate-limited, so wavesrv asks at most once per 5 minutes, whichever windows poll,
  and backs off on a 429 (10 minutes doubling to an hour, or the `Retry-After` when longer).
- Without a live answer it falls back to `cachedUsageUtilization` in Claude Code's config file, Claude
  Code's own copy of an earlier answer. That copy can be a day old.
- The frontend (`frontend/app/view/agents/claudequota.ts`, started at boot) polls the RPC every 5
  minutes and saves the answer as the claude snapshot in `ratelimitstore.ts`, stamped with the time
  it is as of. A newer snapshot from a live agent is kept. Every place that shows saved windows shows
  it, labeled "as of".

This reverses the 2026-06-26 specs' choice to avoid the endpoint, made by the user on 2026-10-06 so
the windows are known before any claude runs.

## Data flow

```
Claude Code session.measure (mod)  or  statusLine JSON (wrapper, older builds)
        │
        ▼  claude/arc-mod usage-core.ts  /  wsh statusline
   wsh agentstatus --usage --context-pct … --five-hour-pct … --week-pct …
        │
        ▼  cmd/wsh/cmd/wshcmd-agentstatus.go : publishUsageDelta()
   publishes an `agent:status` WaveEvent  { usage: AgentUsage }   (Persist:0, ephemeral)
        │
        ▼  frontend/app/tab/sessionsidebar/agentstatusstore.ts : setupAgentStatusSubscription()
   data.usage != null  →  globalStore.set(getAgentUsageAtom(oref), data.usage)
        │
        ▼  frontend/app/view/agents/liveagents.ts : liveAgentBaseAtom
   vm.usage = get(getAgentUsageAtom(row.termBlockOref))
        │
        ├─▶ focusview.tsx       — renders the context bar iff usage.contextpct != null
        └─▶ agents.tsx PlanGauge — renders the plan strip iff usage.fivehourpct/weekpct != null
```

`Persist:0` (ephemeral) matters: the usage event is **not retained or replayed** to a
late subscriber (the retained `Persist:1` state event for the same scope must stay the
one replayed). The usage atom is populated only by events that arrive *after* the
sidebar subscription is live — which it always is — and the value sticks in the atom
for the rest of the app's lifetime. Both sources re-fire constantly while an agent
is active (the statusLine on each render, `session.measure` on each change), so a fresh
value lands within seconds; a dropped publish self-heals on the next one.

## statusLine JSON → wsh flag mapping

Confirmed against the Claude Code statusLine schema
(<https://code.claude.com/docs/en/statusline.md>). Resets are **Unix epoch seconds**
(what the FE `formatReset` expects). Rate-limit fields are **subscriber-only** (absent
for API-key auth) — omit them rather than send `0`, or the gauge shows a misleading 0%.

| statusLine field                          | wsh flag            | AgentUsage field | notes                          |
| ----------------------------------------- | ------------------- | ---------------- | ------------------------------ |
| `.context_window.used_percentage`         | `--context-pct`     | `contextpct`     | input-only %; gates the bar    |
| `.context_window.context_window_size`     | `--context-max`     | `contextmax`     | 200000 or 1000000; FE falls back to 200000 |
| `.cost.total_cost_usd`                     | `--cost-usd`        | `costusd`        | client-side estimate; hidden when 0 |
| `.rate_limits.five_hour.used_percentage`  | `--five-hour-pct`   | `fivehourpct`    | subscriber-only → "Session" gauge |
| `.rate_limits.five_hour.resets_at`        | `--five-hour-reset` | `fivehourreset`  | epoch seconds                  |
| `.rate_limits.seven_day.used_percentage`  | `--week-pct`        | `weekpct`        | subscriber-only → "This week" gauge (key is `seven_day`, **not** `weekly`) |
| `.rate_limits.seven_day.resets_at`        | `--week-reset`      | `weekreset`      | epoch seconds                  |

## Setup (automatic)

Provisioning is automatic — there is nothing to hand-edit. On every launch the arcterm
app runs `wsh install-agent-hooks`, which (besides the lifecycle hooks) writes the arcterm
Claude mod to `~/.arc/claude-mod`, lists that folder in `env.CLAUDE_CODE_PLUGIN_DIRS` of
`~/.claude/settings.json`, and then picks the usage source from `claude --version`:

- **2.1.287 and later:** the mod reports usage, so your `statusLine` is not wrapped. A
  wrapper an older arcterm added is unwrapped: `--inner=` is decoded back to your original
  command, or `statusLine` is removed if arcterm had added it with none.
- **Older, or `claude` not on PATH:** arcterm wraps your `statusLine.command`:

      statusLine.command  →  "<wsh>" statusline --inner=<base64 of your original command>

  `wsh statusline` reads the statusLine JSON on stdin, publishes the usage delta to
  Wave, and then runs your original command with the same stdin — so your terminal
  statusline display is unchanged. The wrap is idempotent: re-running decodes
  `--inner=` to recover your true original instead of nesting, and refreshes the `wsh`
  path so app updates self-heal. If you change your statusLine later, the next launch
  re-wraps the new value.

To (re)provision manually from any arcterm terminal: `wsh install-agent-hooks`.

## Verifying

- `bash -n ~/.claude/statusline-command.sh` — syntax.
- Feed a synthetic payload and confirm the argv (swap the `( wsh … & )` line for an
  `echo` to inspect it without publishing):
  ```bash
  echo '{"context_window":{"used_percentage":42.5,"context_window_size":1000000},
         "rate_limits":{"five_hour":{"used_percentage":63,"resets_at":1750700000},
         "seven_day":{"used_percentage":18,"resets_at":1751200000}},"cost":{"total_cost_usd":1.23}}' \
    | WAVETERM_BLOCKID=block:x bash ~/.claude/statusline-command.sh
  ```
- `wsh agentstatus --help | grep usage` — confirm the installed binary has the flags.
- Live: with an agent active in a Wave block, the focus-view context bar and the Plan
  usage strip populate within a few seconds (after the next statusLine render).

## Update cadence

Through the mod, usage refreshes on each `session.measure`, which fires at session
start and whenever a measured value changes. Through the wrapper, it refreshes once per
statusLine run, as follows. Claude Code invokes the statusLine
**event-driven, debounced at 300ms** — after each new assistant message, after
`/compact`, on a permission-mode change, and on a vim-mode toggle (per the
[statusLine docs](https://code.claude.com/docs/en/statusline.md)). So while an agent
is actively producing output, the gauges refresh up to ~3×/second; **when the session
goes idle the statusLine goes quiet**, so usage stops refreshing and holds its last
end-of-turn value. (Whether it fires on session start/resume is undocumented.)

To keep the gauges ticking during idle, add `refreshInterval` (seconds, min 1) to the
`statusLine` block in `~/.claude/settings.json` — it layers timer-based runs on top of
the event triggers. Marginal for per-agent context/cost (the numbers don't change while
idle); mainly keeps the account-global plan gauges current from other activity.

## Behavior notes

- **Context % is input-only** (Claude Code excludes output tokens from
  `used_percentage`); the token figure in the bar is derived from `pct × contextmax`.
- **Plan gauges are subscriber-only.** API-key sessions never emit `--five-hour-pct` /
  `--week-pct`, so the Plan usage strip stays hidden — by design, not a bug.
- **Idle agents** keep their last usage value (atoms don't clear); it just stops
  refreshing once the session quiets. A full app restart clears the atoms until the
  next usage report per block.
- The reporter (`wsh agent-hook`) is intentionally **not** involved here —
  state/subagents and usage are independent channels into the same `agent:status` event.
