# Arc Claude mod: usage and ask through Claude Code function hooks

Date: 2026-10-02. Status: shipped 2026-10-02 (run 1da34422); the interactive checks below are still open in `docs/open-issues.md`.

## Why

Arc talks to Claude Code through settings `command` hooks and a `statusLine` wrapper, each one a
fresh `wsh` process fed a JSON envelope. pi gets in-process extensions (`pi/extensions/*`) instead.
Claude Code 2.1.287 ships function-hook plugins ("mods"): a TypeScript module loaded into the
session, with typed events and an engine interface `$` (`$.process`, `$.fs`, `$.env`, `$.tool`, ...).

Two things Arc does for Claude are workarounds that a mod removes:

1. **Usage rides the statusLine.** `docs/agents/usage-reporting.md`: Claude delivers context,
   rate-limit and cost numbers only to the `statusLine` command, so `install-agent-hooks` wraps the
   user's status line in `wsh statusline --inner=<b64>`. The mod's `session.measure` event carries
   the same numbers, so the wrapper can go and the status line is the user's again.
2. **Claude asks are answered by typing into the terminal.** A cockpit answer to a Claude
   `AskUserQuestion` is delivered by `pkg/agentask/deliver.go` as arrow/enter keystrokes into the
   native picker, one PTY write per key with `KeystrokeDelay`, then `awaitClear` to confirm it landed.
   The mod can answer the tool call itself: block on `wsh ask --wait`, the waiter path pi already
   uses, and return the answers as the tool's result. No keystrokes.

## Probe evidence (2026-10-02)

A throwaway mod (`.superpowers/probes/claude-mods/arcprobe`, gitignored) under Claude Code 2.1.287:

| Capability | Result |
|---|---|
| `claude -p --plugin-dir <dir>` loads it, no enable prompt | yes |
| interactive `claude --plugin-dir <dir>` loads it | yes (log shows session.start and hooks firing) |
| `tool.call` on `AskUserQuestion` returns `{ result: { questions, answers } }` | yes: the model received the hook's answer, interactive session |
| `session.measure` | fires at start and on change: `context { tokens, window, percent }`, `rateLimits [{ kind: five_hour\|seven_day, percentUsed, resetsAt (ISO) }]`, `cost { usd }` |
| `$.process.run([wsh, 'version'])` | works; ~40 ms per call (a bash spawn of the same: ~60 ms) |
| `$.env.get` | reads the process environment |
| `$.tool.register`, `prompt.compose` | work (not used in this design; see Out of scope) |

`AskUserQuestion` is not offered under `claude -p`, so headless runs cannot exercise the ask path.

## Design

### Source, build, install

- **Source:** `claude/arc-mod/` (beside `pi/`): `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `hooks/register.ts`, and pure `hooks/usage-core.ts` and `hooks/ask-core.ts` holding the mapping
  logic, each tested by vitest (`*-core.test.ts`), the same split as `pi/extensions/*-core.ts`.
- **Embed:** a `sync:claudemod` task, run wherever `sync:piartifacts` runs, copies the mod, minus
  tests, into `cmd/wsh/cmd/claude-mod/` for `go:embed`. Edit `claude/`, never the copy.
- **Install:** `wsh install-agent-hooks` writes the mod to `~/.arc/claude-mod/` (fixed, beside
  `~/.arc/bin/`), substituting `__WSH_PATH__` with the stable wsh path as the pi installers do.
- **Load:** the same command merges `~/.arc/claude-mod` into `env.CLAUDE_CODE_PLUGIN_DIRS` in
  `~/.claude/settings.json`. That variable is read from the user settings' `env` block and loads each
  folder exactly as `--plugin-dir`, so every Claude launch is covered (cockpit agents, run workers,
  consults, a terminal the user opened) with no change at any launch site. The merge keeps the
  user's own entries (platform path-list separator) and is idempotent. Mod files are rewritten only
  when their bytes differ: interactive sessions watch plugin folders and reload on a write.
- **Inert outside Arc:** `session.start` reads `WAVETERM_BLOCKID` and `WAVETERM_JWT`; without both,
  every hook passes straight to `next(e)`. The mod registers no tool and adds no prompt text.

### Usage (`session.measure`)

The hook maps the measurement to `wsh agentstatus --usage` flags and runs it with `$.process.run`,
awaited, then returns `next(e)`:

- `--context-pct` from `context.percent` (the same value as the statusLine's `used_percentage`),
  `--context-max` from `window`, `--cost-usd` from `cost.usd` (0 when absent, as the statusLine sent).
- `--five-hour-pct/--five-hour-reset` and `--week-pct/--week-reset` from `rateLimits` by `kind`,
  `resetsAt` converted to epoch seconds. Absent kinds send no flag (API-key sessions have none).
- No `context.percent` yet: report nothing, as `parseStatusLineUsage` does without
  `used_percentage`.
- A failed `wsh` call is logged with `$.ui.log(..., { to: "debug" })` and dropped; the next
  measurement self-heals, as a dropped statusLine publish does today.

### Idle after a turn with no answer (`turn.complete`)

Added 2026-10-04. `wsh agent-hook` reports idle from the `Stop` settings hook, which Claude does not
run for a turn that ended without an answer (an interrupt, an API error, a refusal), so the cockpit
read working until the idle notification. The mod's `turn.complete` hook reports
`wsh agentstatus --state idle --agent claude` for a main-loop turn whose `reason` is not `answer`
(`hooks/status-core.ts`, vitest), with the transcript path the latest `classic.UserPromptSubmit`
named. Answered turns stay with `Stop`; everything else `agent-hook` reports is unchanged (see Out
of scope). Probed 2026-10-04 on 2.1.289 with an interactive session in a pty and a stub `wsh`: an
Esc interrupt ran no `Stop` hook and the mod made the idle call; an answered turn ran `Stop` and the
mod made none. Not yet watched in the cockpit: the agent row turning idle on Esc.

### Prompts from the cockpit (`wsh agentctl`)

Added 2026-10-04. The engine woke a lead by pasting into its terminal and pressing Enter
(`typeWake`), which lands in the composer the human may be typing in. The mod now holds
`wsh agentctl` from `session.start` for the session's life: a stream RPC (`AgentControlCommand`)
that registers the block in `pkg/agentctl` and prints each message as one JSON line: `{"text"}`, a
prompt, or `{"compact"}`, a compaction with those instructions (the handoff). The mod runs a prompt as
typing it would (`hooks/control-core.ts`, vitest): a leading slash is `$.command.run`, anything else
`$.prompt.submit` with `asUser: true`. A compaction is `$.session.compact`, with the `/compact`
command as its fallback. So
the model reads the text bare and not as "The arc plugin sent a message".

`typeWake` sends over the stream when the block has one (`overStream`), and types otherwise: no
stream (pi, an older Claude, a mod that failed to load). The retry's Enter alone is
dropped for a block with a stream: it would submit the human's draft. The waker is otherwise
unchanged; it still confirms a wake on the working report.

Probed 2026-10-04 on 2.1.289, the real mod in a pty against a stub `wsh` whose `agentctl` streamed
lines from a file: the prompt ran with `UserPromptSubmit` and `Stop` fired and the prompt text bare,
`/compact` ran with `PreCompact` (`manual`), and a draft typed in the composer beforehand was still
there afterwards. Not covered: the stream RPC end to end against a real `wavesrv`.

Amended 2026-10-05: **a working session is not typed into either.** A prompt from the mod waits for
the running turn to end, where a `dag tell` to a busy worker is for the turn itself, so that text
used to be typed, into the composer and onto whatever the human had drafted there. `overStream` now
sends it with `midturn` set when the session is not at its prompt, and the mod joins it to the
running turn with `$.session.append` (a user-role row the model reads at its next request). That row
draws nothing, so `$.ui.log` adds one dim line the model never reads: `arc: read mid-turn: <text>`.
A wake never sets `midturn`: the waker confirms a wake on the working report its prompt raises, which
an appended row does not. `steerRunLead` (a child run's notice to its parent lead) goes the same way
through `orchestrate.SendToSession` in place of raw bytes into the pty.

The mod keeps the turn (`Turn` in `hooks/control-core.ts`, vitest): `turn.start` opens it, a main-loop
`turn.complete` closes it, and a `midturn` text with no turn open is a prompt. A joined text is held
as unread until a tool result follows it, which means another request carries it; one still unread
when the turn ends was appended during the final answer, so it is submitted as a prompt. Two known
edges, both marked `ponytail:` in `register.ts`: a text joined between the last tool result and the
final answer's request is read and then submitted again, and `turn.start` does not say whose turn it
is, so a background subagent starting one in an idle session reads as open. A mod older than
`midturn` runs the text as a prompt once the turn ends.

Probed 2026-10-05 on 2.1.289 (Haiku) in a pty, a scratch copy of the mod against a stub `wsh` whose
`agentctl` printed one `midturn` line during a 15 s Bash call: the model ran the extra command the
line asked for before answering, the log line drew under the running tool, and no second turn
started. A row appended to an idle session was stored and started no turn, which is why idle stays a
prompt. Not covered: a real `dag tell` in the dev app, the unread-at-turn-end path live, and the
cockpit transcript's view of the appended row.

### The wake's transcript row (`claude/arc-view-mod`)

Added 2026-10-05. A wake sent over the stream showed in the lead's transcript as the engine's raw
text: every `wake:` line with its command, then the `Unverified:` and `Since your last wake:`
sections. A second mod, `arc-view`, hooks `ui.render` on `UserMessage` rows whose origin is the arc
plugin and draws a wake as what it holds (`hooks/wake-core.ts`, vitest; `hooks/wake-row.tsx`): a
summary line, one row per event with a mark for its kind (`!` a failure, `i` a passed review's note,
`✓` run finished, `?` the question line) and its trailing command dim at the right or, on a narrow
terminal, under it; up to two of the lines that follow an event, then a count; each unverified
caveat whole; the recaps as a count. The model reads the wake as sent, ctrl+o shows that text, and
a prompt that is not a wake (a tell, a review note) is left to the engine.

It is a mod of its own, embedded as `claude-view-mod` and installed to `~/.arc/claude-view-mod` with
its own `CLAUDE_CODE_PLUGIN_DIRS` entry, because the engine skips a plugin's render hook on a row
that plugin raised (debug log: `ui.render skipped: re-entry (the plugin's own code raised it)`); a
later `$.ui.invalidate` or a resize does not get past it, and `claude plugin test` does not apply
it. Probed 2026-10-05 on 2.1.289 in a pty with scratch copies of both mods: the row drew at 120 and
150 columns and with the command dropped at 64. Not yet seen: its colours, and a real wake from
`wavesrv` in the dev app. A wake that is typed (pi, an older Claude, a busy session), a child run's
notice and a lead's launch prompt are not the arc plugin's rows and stay as the terminal draws them.

The same probe compacted from the plugin (`$.session.compact({ instructions })`) in place of running
`/compact`: `PreCompact` and `SessionStart` (`compact`) fired in the mod and in the settings hooks,
the transcript showed the engine's spinner and no prompt row, and a headless session refused the
call. The handoff compacts that way since 2026-10-05, and runs `/compact` when the call is refused:
the terminal shows the spinner alone, with no echo of the instructions and no `Compacted` line. A dev
run confirmed the waker still sees it (`PreCompact` reads working, `SessionStart` `compact` idle) and
the wake held behind it arrives after. The transcript takes the same `compact_boundary` and summary
records, so the cockpit's transcript still shows the compaction; the `/compact` command records are
what it no longer holds.

### Retiring the statusLine wrapper

Once the mod reports usage, `mergeStatusLine` stops wrapping and unwraps an existing wrapper with
`recoverInner`, restoring the user's original command (or removing `statusLine` if Arc added it with
no inner). This is gated on the installed Claude Code supporting mods: `install-agent-hooks` reads
`claude --version` and unwraps only at or above `2.1.287`, the tested build; below it the wrapper
stays. `wsh statusline` stays for that fallback. `configIsHealthy` expects the managed statusLine
today, so it takes the same gate (and checks the plugin-dirs entry), or every launch would rewrite
the settings file.

### Ask (`tool.call` on `AskUserQuestion`)

Decision (2026-10-02): **the cockpit card is the answer surface for Claude agents.** The hook
answered the call itself, so Claude's own dialog did not open, on the belief that the API cannot
cancel a dialog once `next(e)` opened it, so the two could not race.

Amended (2026-10-04): the terminal answered too, through a picker the mod drew (`hooks/ask-band.tsx`):
a focused pane, or, where a pane the mod opens unasked is not placed (under 144 columns), the band
above the prompt.

Amended (2026-10-06): **Claude's own dialog is the terminal's answer surface, and the card races
it.** The picker hid what it did not redraw. A cockpit terminal is under 144 columns, so the picker
was always the band, capped at half the terminal's rows: wrapped option descriptions pushed its
"Show previews" button out of view, and the engine arms a band hotkey only inside the view, so a
question's previews could not be seen at all. Every addition to Claude's dialog (previews, notes,
`Chat about this`, follow-ups) needed porting. A probe on 2.1.291 showed the 10-02 belief wrong: a
`tool.call` hook that settles while `next(e)` still holds the dialog takes the dialog down (that
`next(e)` resolves as a rejection within ~20 ms), the model reads only the hook's answer, and the
keys go back to the prompt. So the hook calls `next(e)` and races it against `wsh ask --wait`:

- **The dialog answers first** (a pick, notes, Esc): its result goes through as Claude made it, and
  ending the wait kills `wsh`, whose waiter cancel takes the card down.
- **The card answers or is dismissed first:** the hook's own answer (steps 3 and 4), which closes
  the dialog.
- `$.ui.notice` puts "Also answerable in Arc's ask card" under the dialog.

Calling `next(e)` also runs the settings `PreToolUse` hooks, whose `wsh ask` projects a
keystroke-answered card of its own over the one the hook waits on. So a `classic.PreToolUse` hook
answers `{}` without `next` for the calls the mod races (the same predicate), which skips the settings
hooks beneath, as the 10-02 path did by never calling `next`. The pure half (`ask-core.ts`: the
predicate, the payload, the reply as the hook's answer) is vitest. The race was checked in a pty at
68x25 and 68x40 against the real engine and a stub `wsh`, with a stub settings hook beside it: the
card first, the dialog first, the card dismissed, and a control with the mod inactive in which the
settings hook did run.

1. **Questions the card cannot show go native.** Any question with `kind` `text` or `number`, or with
   no options, means the whole call goes to `next(e)` (the current path, unchanged).
2. **Wait on the card.** `$.process.spawn({ argv: [wsh, 'ask', '--wait'], input: <questions json> })`
   (spawn, not `run`: `run` caps at ten minutes; stdin, not `--questions-json`: option previews can
   outrun a Windows command line). `$.ui.notice` shows a line under the dialog pointing at the
   Arc card while it waits; core removes it when the call resolves. `next.signal` (an Esc interrupt) ends the spawn loop,
   which kills the child; the server's waiter cancel cleans the card up
   (`TestAskCommandWaitCancelCleansUp`).
3. **Map the reply.** `wsh` prints `{ answers: AgentAnswerItem[], cancelled }`. Answers are in
   question order: `selectedindexes` become the option labels, comma-joined for multi-select;
   `text` (the "Other" answer) is used verbatim. The hook returns
   `{ result: { questions: e.questions, answers: { [question]: answer } } }`.
4. **Cancelled** (dismissed in the cockpit): `{ deny: "The user dismissed the question." }`.
5. **Failure** (wsh cannot start, RPC error, or its 30-minute `askWaitTimeout`): clear the card
   with `wsh ask --clear`; the dialog, already up, answers alone. This is error handling, not a
   second answer surface. An interrupt ends the dialog's `next(e)`, whose result goes through, and
   the wait with it.

The settings hooks for `AskUserQuestion` (`ask`, `ask --clear`) stay for sessions without the mod,
and for calls it does not race; for a call it races, its `classic.PreToolUse` hook skips them, and
`ask --clear` (PostToolUse) still runs when the dialog answers, clearing a card already gone. They
keep the keystroke path working wherever the mod is not loaded. `pkg/agentask` keystroke injection
stays for that fallback and for pi.

### Refused shell commands (`tool.call` on `Bash` and `PowerShell`), added 2026-10-05

Sessions run with permissions skipped, so a rule in a prompt is the only thing between a model and a
command. `hooks/guard-core.ts` refuses a few in code; the model reads the reason as the tool's error.

- **Every session inside Arc:** a kill aimed at `wave-tauri` or `wavesrv` by image name (`taskkill /IM`,
  `Stop-Process` without `-Id`, `kill -Name`, `pkill`, `killall`). A stop by pid passes.
- **A session whose directory is under `.waveterm/worktrees/`** (a task worker, its reviewer, the final
  verifier): `git push`, `git worktree add|remove|move|prune`, `git switch` and `git checkout -b`.

The match is on the command's text, so a refused phrase quoted inside another command is refused too, and
a script file that runs one is not seen. `git checkout <name>` passes: a path and a branch read the same.
The plan's Verify is not refused: the mod does not know the command, and the workers' costly runs were
whole packages, which an exact match would miss.

Checked live 2026-10-05 (2.1.289, Haiku, pty, scratch copy of the mod in a fake task worktree): a
`git push` came back as the refusal text. The kill rule is covered by unit tests only, since a miss in a
live check would stop the running Arc.

### To verify in implementation (not assumed)

- `CLAUDE_CODE_PLUGIN_DIRS` from a settings `env` block loads the mod (the probe used
  `--plugin-dir`). Covered headless by the plan's Final check: `claude -p --settings` with that env
  block and a stub `wsh`, asserting `session.measure` ran `wsh agentstatus --usage`. This guards the
  statusLine unwrap, which would leave usage dark if the mod did not load.

The rest need an interactive Claude session (`AskUserQuestion` is not offered under `claude -p`), so
no run checks them; they are listed in `docs/open-issues.md` and stay the effort's live-verify chunk:

- ~~Settings `PreToolUse` hooks do not fire for a call the mod answers.~~ Checked 2026-10-06 in a pty
  with a stub settings hook: skipped for a call the mod races, run for one it does not. The cockpit
  still shows the agent waiting then, from the card's own `AskCommand` publish.
- A dag child's ask still routes to its lead, and `wsh jarvis dag answer` resolves the waiter
  (`DeliverAnswer` resolves a waiter first, so it should).
- The settings `env` plugin dir loads in an interactive session without the enable-hot-reloading
  prompt.
- `$.process.spawn` has no hard timeout for the caller (its type declares none): a card left
  unanswered past ten minutes still answers the call.

## Out of scope

Each is a decision on the effort tracker, revived only on evidence:

- **`wave_*` tools for Claude** (`$.tool.register`, pi parity). Claude reaches the same actions through
  Bash, `wsh` and the cockpit skills; there is no recorded failure that native tools would fix.
- **Orchestration rules through `prompt.compose`** in place of the `SessionStart compact` →
  `wsh jarvis dag rules --inject` hook. The hook works; the move changes where the rules live (system
  prompt, not a user message).
- **Moving `agent-hook` status reporting into the mod.** It works, and the mod still spawns `wsh` per
  event (~40 ms vs ~60 ms), so speed is not a reason.
- **Panes, bands or other UI inside Claude.** The cockpit is the UI.

## Risks

- **Early-access API** ("may change between releases without notice"). Mitigations: the settings
  hooks stay as the fallback for ask; the statusLine unwrap is version-gated; `claude plugin validate`
  runs in CI-equivalent checks (see Testing).
- **A broken mod module** is skipped by the engine with a debug-log line, so Claude still works; the
  symptom is missing usage or a native dialog where a card was expected.

## Testing

- vitest on `usage-core.ts` (measurement to argv: float percent, ISO to epoch, missing kinds, no
  context) and `ask-core.ts` (answer mapping: single, multi, Other text, cancelled; the native-path
  predicate).
- `claude plugin validate claude/arc-mod` as part of the plan's Check line.
- Go: `install-agent-hooks` tests for the `CLAUDE_CODE_PLUGIN_DIRS` merge (user entries kept,
  idempotent, Arc's entry never duplicated; the mod dir is fixed and versionless, so there is no
  stale entry to drop) and the version-gated statusLine unwrap.
- Final (headless): the settings-env load check above.
- Live, in the dev app, by hand (`docs/open-issues.md`): a Claude agent's usage strip updates with
  the status line unwrapped; an `AskUserQuestion` answered from the card reaches Claude with no
  keystrokes; Esc during the wait clears the card; the interactive items listed above.

## Docs

`docs/agents/usage-reporting.md` (the data flow), `AGENTS.md` (`claude/` is a source dir like `pi/`),
`docs/open-issues.md` if anything above stays open.
