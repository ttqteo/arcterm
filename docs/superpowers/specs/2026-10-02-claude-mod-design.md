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
that registers the block in `pkg/agentctl` and prints each prompt as one JSON line `{"text"}`. The
mod runs a line as typing it would (`hooks/control-core.ts`, vitest): a leading slash is
`$.command.run` (the handoff `/compact`), anything else `$.prompt.submit` with `asUser: true`, so
the model reads the text bare and not as "The arc plugin sent a message".

`typeWake` sends over the stream when the block has one and its latest state is at the prompt
(`overStream`), and types otherwise: no stream (pi, an older Claude, a mod that failed to load), or
a working session, since the mod's prompt waits for the running turn to end where typed text
reaches the turn itself, which a `dag tell` to a busy worker relies on. The retry's Enter alone is
dropped for a block with a stream: it would submit the human's draft. The waker is otherwise
unchanged; it still confirms a wake on the working report.

Probed 2026-10-04 on 2.1.289, the real mod in a pty against a stub `wsh` whose `agentctl` streamed
lines from a file: the prompt ran with `UserPromptSubmit` and `Stop` fired and the prompt text bare,
`/compact` ran with `PreCompact` (`manual`), and a draft typed in the composer beforehand was still
there afterwards. Not covered: the stream RPC end to end against a real `wavesrv`, and
`steerRunLead` (a child run's notice to its parent lead), which still types.

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
answers the call itself, so Claude's own dialog does not open. The API cannot cancel a dialog once
`next(e)` opened it, so the two cannot race.

Amended (2026-10-04): **the terminal answers too.** The user is sometimes in the agent's terminal
rather than the cockpit, so the hook also draws a picker there (`hooks/ask-band.tsx`) and takes
whichever answer comes first. The mod draws and closes the picker itself, so it can race the card
where Claude's dialog could not. It opens in a focused pane (`$.ui.open` with `focus` and
`closeOnEscape`), where the arrows and Enter pick as in Claude's dialog, the first option holds
the ring, a digit presses its option, and Esc dismisses the question. A pane a mod opens unasked
is not drawn below 144 terminal columns (`isPlaced: false`); the picker then moves to the band
above the prompt (`ui.render` on `AbovePrompt`), where a mod cannot take the keyboard, so a bare
digit in an empty composer is the pick. A multi-select marks options and confirms with `Done`;
`Other` is an `Input`. Previews stay on the card. A picker answer ends the `wsh ask --wait`
stream, which kills the child, and the server's waiter cancel takes the card down; a card answer
clears the picker state and closes the pane.
The picker's steps are pure (`ask-core.ts`, vitest); the race was checked once with
`claude plugin test` on a scratch copy (the runner and vitest both claim `*.test.ts`, so no
engine-level test is checked in). Steps 2 to 5 below describe the card side, unchanged.

1. **Questions the card cannot show go native.** Any question with `kind` `text` or `number`, or with
   no options, means the whole call goes to `next(e)` (the current path, unchanged).
2. **Wait on the card.** `$.process.spawn({ argv: [wsh, 'ask', '--wait'], input: <questions json> })`
   (spawn, not `run`: `run` caps at ten minutes; stdin, not `--questions-json`: option previews can
   outrun a Windows command line). `$.ui.status` shows a line pointing at the Arc
   card while it waits, cleared when it ends. `next.signal` (an Esc interrupt) ends the spawn loop,
   which kills the child; the server's waiter cancel cleans the card up
   (`TestAskCommandWaitCancelCleansUp`).
3. **Map the reply.** `wsh` prints `{ answers: AgentAnswerItem[], cancelled }`. Answers are in
   question order: `selectedindexes` become the option labels, comma-joined for multi-select;
   `text` (the "Other" answer) is used verbatim. The hook returns
   `{ result: { questions: e.questions, answers: { [question]: answer } } }`.
4. **Cancelled** (dismissed in the cockpit): `{ deny: "The user dismissed the question." }`.
5. **Failure** (wsh cannot start, RPC error, or its 30-minute `askWaitTimeout`): clear the card
   with `wsh ask --clear`, then `next(e)`, so the question still reaches the user through the native
   dialog. This is error handling, not a second answer surface. An interrupt is not a failure: it
   clears the card and returns a deny, never opening the dialog.

The settings hooks for `AskUserQuestion` (`ask`, `ask --clear`) stay: they run beneath plugin
`tool.call` hooks, so they never fire when the mod answers, and they keep the keystroke path working
wherever the mod is not loaded. `pkg/agentask` keystroke injection stays for that fallback and for
pi.

### To verify in implementation (not assumed)

- `CLAUDE_CODE_PLUGIN_DIRS` from a settings `env` block loads the mod (the probe used
  `--plugin-dir`). Covered headless by the plan's Final check: `claude -p --settings` with that env
  block and a stub `wsh`, asserting `session.measure` ran `wsh agentstatus --usage`. This guards the
  statusLine unwrap, which would leave usage dark if the mod did not load.

The rest need an interactive Claude session (`AskUserQuestion` is not offered under `claude -p`), so
no run checks them; they are listed in `docs/open-issues.md` and stay the effort's live-verify chunk:

- Settings `PreToolUse` hooks do not fire for a call the mod answers. The probe shows the answer
  lands; it did not check the settings side. If `agent-hook`'s `Asking` state then never reaches the
  cockpit, check whether the pending-ask publish from `AskCommand` already covers it before adding
  anything.
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
