# Brainstorm mode

An agent's brainstorm shows inside Arc on the Agent surface, the way a design canvas does: the
agent's current question, the design it is writing as you talk, the mockups beside the parts they
illustrate, and at the end a builder check and the start of a run. It works for a brainstorm about
any project; nothing in it is about Arc itself.

**The approved mockup is the spec for everything visual:**
`C:\Users\cktra\Projects\waveterm\.superpowers\design\brainstorm-mode\project\` — `Main.dc.html`
(mid-conversation, interactive), `Handoff.dc.html` (builder check and approve), `States.dc.html`
(just started, tree and popup, a confirmed part changed, after a compaction, between questions,
agent exited). The folder is gitignored, so a worktree reads it by that absolute path. Where this
spec and the mockup disagree on a look, the mockup wins; this spec owns behaviour and wiring.

Follow `DESIGN.md`. Reuse what the mockup copies: `element/segmented.tsx` for the switcher, the
AgentHeader `ICON_BTN`, `CANVAS_BTN` / `CANVAS_PRIMARY_BTN`, the canvas pane's toolbar row, and the
answer bar's chip and text-field looks (`answerbar.tsx`). Colours are `@theme` tokens only.

## Why

You brainstorm in an agent, it writes a spec, then it dispatches an orchestrator run. Today the
brainstorm is terminal scrollback: superpowers 7.0.0's brainstorming asks one prose question per
turn, plays back its understanding in 200–300 word chunks, and opens its own browser tab for
mockups. Nothing in the cockpit knows a brainstorm is happening, what has been decided, or that the
agent is waiting on you.

## Goals

- The design is visible while it forms, each part marked as **yours** (you said or confirmed it),
  the **agent's guess**, the part the current question is **asked** for, or **open**.
- The current question is in front of you with a free-text answer; earlier answers say which part
  each went into.
- Mockups sit beside the part they illustrate.
- A part the agent changes after you confirmed it goes back to a guess and shows what changed and why.
- The brainstorm survives a compaction, an Arc restart and the agent exiting.
- It ends in a builder check and then an orchestrator run with the spec attached.

## Non-goals

- No fixed list of parts and no total. Parts appear as the conversation finds them; counts are of
  what exists now. `Left to the builder` is always the last part.
- No change to the superpowers plugin. Arc adds its own skill beside it.
- No editing of the design by Arc. The agent is the only writer (decision 1).
- No brainstorm surface or list of brainstorms; it lives on the agent, like a canvas.

## Anti-goals

- A progress bar or "N of M" that implies the agent knows how many questions remain.
- Arc and the agent both writing the design and racing each other.
- A brainstorm that only works for Claude Code.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The brainstorm's state is one JSON file the agent writes: `<project>/.superpowers/brainstorm/<topic>/brainstorm.json` (format below). Arc only reads it. | It survives a compaction, a restart and the agent exiting with no new store, object type or migration; the agent re-reads it after a compaction. `.superpowers/` is already gitignored. One writer means no merge. |
| 2 | Every user action reaches the agent as one line typed into its terminal, the same path canvas marks use (`canvassend.ts` `type`). An answer is typed as written; every other action is a `brainstorm:` line (table below). | brainstorming 7.0.0 ends its turn on a prose question and waits for the next user message, so typing the answer is that message. No ask-registry entry, no new RPC. |
| 3 | Address `brainstorm:<topic>`, parsed in `address.ts`, landed by `openref.ts`, reachable as `wsh ui reveal brainstorm:<topic>` (it already sends `callercwd`). The `wsh agent-hook` PostToolUse hook reveals it on its own when an agent writes or edits `<project>/.superpowers/brainstorm/<topic>/brainstorm.json`, mirroring `canvasRevealFor`. | Same as canvas decisions 1, 2 and 13. Pi and opencode have no such hook and use the skill's reveal step. |
| 4 | A new Arc skill, `skills/brainstorm/` (`arc:brainstorm` in Claude Code), holds the file format, the `brainstorm:` lines and the rules below. It works alongside `superpowers:brainstorming`: inside Arc a playback chunk becomes a part written to the file instead of 200–300 words in the terminal, and the visual companion becomes `arc:design` boards. Add it to the `//go:embed` list in `skills/skills.go`. | Arc's skills ship this way already; the superpowers skill stays untouched. |
| 5 | When a Claude Code agent invokes the `Skill` tool for `superpowers:brainstorming` (or `brainstorming`), the PostToolUse hook returns `hookSpecificOutput.additionalContext` telling it to also follow `arc:brainstorm`. The hook writes nothing to stdout today; this is its first context output. | A skill description alone does not reliably fire next to another skill that says "use no other". |
| 6 | Per-agent brainstorm state is a jotai `atomFamily` keyed by agent id, in memory, like `canvasStateAtom`: the file's parsed contents, the mode (`terminal` / `brainstorm`), the dir, status. A poller reads the file every 3 s for the focused agent while the Agent surface is mounted (`canvaspoller.ts` pattern, `FileInfoCommand` + file read). | Same trade-offs as canvas decisions 3 and 7. |
| 7 | The header's switcher is `Segmented` **Terminal \| Brainstorm**, where canvas mode's Terminal \| Canvas sits, with an amber dot on Brainstorm while it asks you. Key `b` toggles (two bindings with exclusive `when()`s, as canvas decision 12). Brainstorm mode swaps the terminal for the brainstorm pane; the xterm stays mounted and hidden. | Mockup; the xterm must never remount. |
| 8 | An agent with a brainstorm shows its canvas boards inside the brainstorm: a part names its boards, drawn as a thumbnail beside the part (served by wavesrv as canvas decision 6), and **Open full size** shows the board in the brainstorm pane with canvas mode's board view and Mark, and a way back. Its switcher has no Canvas option. Without a brainstorm, canvas mode is unchanged. | The user rejected a separate Canvas view during a brainstorm: the mockup belongs next to its part. |
| 9 | An agent whose file has a `question` and whose turn has ended reads as asking in the agent tree ("Brainstorm · asking question N") and in the attention popup (the question's text and the part it is for). This is derived in the roster from the file; it adds nothing to `pkg/agentask`. | The question exists only in the file and the terminal. |
| 10 | **Check with a builder** is enabled only when the file says `done: true` (the agent has nothing left to ask) and every part is yours. It sends `brainstorm: check`; the skill then has the agent write the spec file and run superpowers' builder check, and put the result in `check`. | Readiness is the agent's call, per the skill, and the builder reads the written spec. |
| 11 | **Approve and start run** types `brainstorm: approved` and opens the + Run launcher prefilled through `newRunPrefillAtom` (as canvas's Build this…): orchestrator, the agent's project, a goal naming the spec's absolute path, and the brainstorm's canvas `Main.dc.html` as prototype when it has boards. The approve bar's run line shows that prefill. | Same flow and confirmation as Build this…; routes stay the launcher's job. |
| 12 | When the agent's process has exited and its file has no `run`, the pane shows the exited state; **Resume in a new agent** launches a new agent in that project and folder, through the existing new-agent path, with the prompt `Resume the brainstorm in <absolute path to brainstorm.json> with arc:brainstorm.` | The file holds everything the new agent needs. |

## The file

```json
{
  "v": 1,
  "title": "Consumer lag alerts",
  "spec": "docs/superpowers/specs/2026-10-18-consumer-lag-alerts-design.md",
  "canvas": "consumer-lag-alerts",
  "question": { "n": 4, "text": "Walk me through the last time lag bit you…", "part": "thresholds" },
  "working": null,
  "parts": [
    { "id": "intent", "title": "Intent and why", "state": "yours", "from": "answer 1", "body": "…" },
    { "id": "page", "title": "What on-call sees", "state": "guess", "from": "mockup", "body": "…", "boards": ["Page.dc.html"] },
    { "id": "constraints", "title": "Constraints", "state": "guess", "from": "answer 2", "body": "…",
      "was": "the body you had confirmed", "why": "your answer 4 named the growth rate, which needs Prometheus 2.45" }
  ],
  "history": [
    { "kind": "question", "n": 1, "q": "…", "a": "…", "into": ["intent"] },
    { "kind": "recon", "q": "I offered to look at your Prometheus targets. You said yes.", "a": "…", "into": ["current"] }
  ],
  "done": false,
  "check": null,
  "run": null
}
```

- `state` is `yours`, `guess`, `asked` (the part `question.part` names) or `open`. Parts are in
  display order; `Left to the builder` (id `builder`) is last.
- `working` is a short line while the agent turns an answer into a part ("Writing When it pages");
  the answer box stays closed while it is set.
- `was` and `why` are set only when the agent changed a part that was `yours`; the part is then a
  `guess` until you keep or restore it.
- `check`, after the builder check: `{ "yours": [{ "q": "…", "why": "…" }], "calls": ["…"], "answered": ["…"] }`.
  The spec marks each call inline ("Agent's call").
- `run` is the run id once one started from this brainstorm; the tree then says "Brainstorm done ·
  run <id>".
- A file that fails to parse shows the pane's error state with the parse error and the path, and
  keeps the last good contents in memory.

## The lines Arc types

| Action | Line |
|---|---|
| Send an answer (Enter) | the answer, as typed |
| Guess for me | `brainstorm: guess` |
| Skip the questions | `brainstorm: skip questions` |
| That's right | `brainstorm: confirm <part id>` |
| Edit (a part) | `brainstorm: edit <part id>: <the new text, on one line>` |
| Keep the change | `brainstorm: keep <part id>` |
| Put mine back | `brainstorm: restore <part id>` |
| Check with a builder | `brainstorm: check` |
| Answer the builder's question | `brainstorm: builder answer: <text>` |
| Approve and start run | `brainstorm: approved` |

The skill defines what the agent does with each. A multi-line answer or edit is joined with spaces,
as canvas marks are.

## What the skill says (`skills/brainstorm/SKILL.md`)

- Use it whenever `superpowers:brainstorming` runs inside Arc (`wsh` on PATH). Pick `<topic>`
  (kebab-case) at the first message and create the file; reveal with
  `wsh ui reveal brainstorm:<topic>` (the Claude hook does this on its own).
- Every question: set `question` (and the part it is for, created as `asked` if new), append the
  previous exchange to `history`, then end the turn with the question in the terminal too.
- A playback is a part: write or rewrite it as `guess`; it becomes `yours` only on
  `brainstorm: confirm`, or when the user's own words are the part.
- Changing a part that is `yours` sets `was` and `why` and makes it a `guess`.
- After a compaction, re-read the file before anything else.
- Mockups: `arc:design` boards under `.superpowers/design/<canvas>/`, listed on the part they
  illustrate. Never start the visual companion's server inside Arc.
- Set `done: true` only when nothing is left to ask. On `brainstorm: check`, write the spec at
  `spec`, run the builder check, fill `check`. On `brainstorm: approved`, stop: Arc opens the run
  launcher.

## Verify

- Pure logic in `brainstormmodel.ts` with `brainstormmodel.test.ts`: parsing and validation (bad
  JSON, unknown state, missing fields), the counts, when Check with a builder is enabled, the tree
  line, and every line in the table above. The hook's reveal and context output in
  `wshcmd-agenthook_test.go`.
- A CDP scenario `brainstorm-mode` in `scripts/cdp/scenarios.mjs` with one step per state the
  mockup draws: mid-conversation (Main), the builder check before and after your answer (Handoff),
  just started, between questions, a confirmed part changed, after a compaction (terminal mode with
  the switcher), agent exited, and the tree row plus the attention popup. It seeds a
  `brainstorm.json` per step under a temp project and an agent that owns it.

## Left to the builder

- File layout of the pane's components and model.
- How the poller shares code with `canvaspoller.ts`.
- Whether actions other than the answer are allowed while `working` is set (Claude Code queues typed
  input; pi may not).
- The thumbnail's size and how a board too tall for it is cropped.

## Decisions made while planning (2026-10-18)

Made by the planning agent on an autonomous run; each amends or settles a point above.

| # | Decision | Why |
|---|---|---|
| P1 | Amends 6: the state is one jotai atom holding a map from agent id to brainstorm state (`brainstormsAtom`), with a derived per-agent read; the poller runs in the always-mounted cockpit shell and reads every attached brainstorm's file every 3 s, not only the focused agent's. | The tree line and the attention popup (decision 9) need unfocused agents' questions, and an `atomFamily` cannot be enumerated reactively. One FileInfo plus one small read per brainstorm every 3 s is cheap. |
| P2 | Restart: attaching a brainstorm writes the agent's tab meta `session:brainstorm` = the absolute path of its `brainstorm.json`; at boot every roster agent with that meta is re-attached. New meta key in `pkg/waveobj/wtypemeta.go`, regenerated. | Goal "survives an Arc restart": an agent waiting on the user writes nothing more, so the hook's reveal never comes again. |
| P3 | Amends 5: the generic PostToolUse `agent-hook` is registered async, and an async hook's output does not reach the turn. A second managed hook, PostToolUse matcher `Skill`, synchronous, runs `wsh agent-hook --skill-context`, which only prints the context JSON (no RPC). The brainstorm.json reveal stays on the async path beside the canvas reveal. | Context must arrive in the same turn the skill starts. |
| P4 | File additions: `compacted` (Unix ms, written by the agent after it re-reads the file following a compaction; drives the terminal-mode banner until the user next opens brainstorm mode); `check.yours[]` entries also carry `a` (the answer, once given) and `into` (the part it went into); `check.calls[]` entries are `{ "text", "part" }` (a bare string is a call with no part); `check.touched` lists the part ids the builder check changed or annotated. Optional on parse, all of them. | The Handoff board draws "You answered … Added to Anti-goals.", the calls inline under their parts, and "Show the N parts the builder did not touch". |
| P5 | New line: **Keep talking** (Handoff) types `brainstorm: keep talking`; the skill sets `done: false` and asks its next question. | The Handoff board has the button; the spec's table had no line for it. |
| P6 | While `working` is set every action that types is disabled (answer box closed, part buttons disabled with a title saying the agent is writing). | Left to the builder; pi does not reliably queue typed input, and a disabled button beats a lost line. |
| P7 | Thumbnail: 300 px wide, the board scaled to that width, at most 200 px tall, top-aligned and cropped at the bottom; a non-interactive iframe of the served board. Label `<board> · option <A..> of <n>` when a part names several boards. | Left to the builder; matches the Main board's card. |
| P8 | Agent exited = its block's `controllerstatus` event reports `shellprocstatus: "done"`; the card shows the exit code and the time the event arrived, and the last non-empty terminal line read through `TermGetScrollbackLinesCommand` (omitted when the read fails). | Agents are `cmd` blocks, so the controller status is the exit signal Arc already has. |
| P9 | The approve bar's run line is `<project> · orchestrator · this design attached · Change`; Change opens the same prefilled launcher without typing `brainstorm: approved`. The lead and workers are picked in the launcher, so the line does not name them. | The cockpit cannot know the launcher's route pick before it opens. |
| P11 | Amends 11: the run's prototype is the first board any part lists (in part order), `<project>/.superpowers/design/<canvas>/project/<that board>`, not a fixed `Main.dc.html`; no listed board, no prototype. | A brainstorm's canvas need not have a `Main.dc.html`. |
| P12 | A `brainstorm:<topic>` reveal with a caller lands at once (no wait for the user to stop typing) and toasts only when that topic is not already attached to the caller, exactly as a canvas reveal does (`uiapi.ts` `revealWaitsForUser` / `revealLeavesTrail`). | The hook reveals on every write of the file; without this each write would wait up to 4 s and toast. |
| P10 | The brainstorm's attention item is synthesized in the frontend and fed only to the taskbar flash and the desktop popup (`attentionpoller.tsx`), not to the server's attention list. | Decision 9: nothing is added to `pkg/agentask` or the server. |

## Decisions after the end-to-end test (2026-10-20)

A real Claude Code brainstorm was run through the protocol (14 turns), then again inside the dev app,
driven only through the pane. Each amends a point above.

| # | Decision | Why |
|---|---|---|
| E1 | Amends 2: every line reaches the agent through `AgentPromptCommand`, as canvas marks do: a session whose arc mod holds a control stream runs it as a prompt, leaving the composer and any draft alone; any other session has it typed. | Typed keystrokes land in whatever the user has half-written in the composer. |
| E2 | The agent writes the file once per turn, not twice per answer. Arc shows the agent writing from the moment it sends a line (`sent` in the brainstorm state, settled by the poller once the agent's turn ends after the send, or the file changes while it is not at work); `working` in the file is still read. A small change is a one-line read-modify-write script, not a retyped file. | Two whole-file writes per answer grew to 6.5k output tokens and 56 s per answer at 6.8 KB; a script confirm took 574 tokens and 8 s against 4.3k and 30 s for a retyped one. A write mid-turn does not settle, since a line sent then joins the running turn. |
| E3 | Every question the agent waits on is in `question`, whatever the phase; one about no part leaves `part` out. The check view shows it too, with no Guess or Skip; Check with a builder waits while one is open. Pressing Check with a builder is the go-ahead for superpowers' builder subagent. | On `brainstorm: check` the agent stopped to ask in the terminal whether it could start the builder subagent; with `question: null` the pane showed "ready" and nothing to answer. |
| E4 | New line `brainstorm: confirm every guess` (**Confirm all N guesses** in Before the builder check, at two or more plain guesses); a changed part still waits for keep or restore. | After a skip, nine guesses meant nine clicks, each a full agent turn. |
| E5 | Amends 11: the launcher hears the id of the run a brainstorm's prefill starts (`NewRunPrefill.onStarted`) and sends `brainstorm: run <id>`, so `run` is set without the user typing it. | Nothing sent the id back, so the tree and the pane never reached "Brainstorm done". |
| E6 | A part that takes the user's builder answer becomes `yours`. The terminal reply is one line plus the question, and after the check one line naming the spec. | Folded answers stayed guesses after approval; playbacks were repeated in the terminal beside the pane. |
| E7 | Amends 5: an agent a run started carries `ARC_RUN_AGENT` (`jarvis.RunAgentEnv`), the Skill hook adds no brainstorm context for it, and the skill says not to use it there. | A run lead's prompt routes every question through AskUserQuestion; given that prompt, the lead still loaded arc:brainstorm and wrote brainstorm.json. |
