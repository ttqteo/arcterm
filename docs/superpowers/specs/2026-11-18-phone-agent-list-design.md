# Phone agent list: a list you can act on

Date: 2026-11-18. Brainstorm: `.superpowers/brainstorm/phone-agent-list/brainstorm.json`.

## Why

The phone page's **Agents** list (shipped in 7ea552174) shows every agent tab in the cockpit's roster, read-only.
On a real install it was mostly noise: of 15 rows, 10 were sessions that had exited back to their shell, every row
read "arcterm arcterm" (an agent's default name is its project), every row had the same orange dot (the runtime
colour, not the state), idle rows had no line, and no row could be tapped, because the phone can only drive an agent
the desk handed over. This redesign makes the list worth opening: it lists only what is alive, says what each agent is
doing, and a tap takes the agent to the phone.

## What it is for

The list is both a glance at what is running and the place to take an agent to the phone: tap a row and the phone
takes that agent (transcript, send a prompt, stop, approve or deny a permission) without a hand-over from the desk
first.

## Which agents are listed

- Only live agents. An agent whose session exited (tab open, claude or pi back at its shell: `listedState` returns
  `ended` today) is not listed. The `ended` state and its "exited" label leave the phone page.
- Agents a run started (task workers, task reviewers, stage sessions, `wsh jarvis run` children: `isRunWorker`,
  `pkg/wshrpc/wshserver/wshserver_remoteagents.go:50`) are not listed one by one. They are grouped into one row per
  run (below).
- A run's orchestrator lead and a Quick run's agent are not run workers (`isRunWorker` excludes them), so they are
  ordinary agent rows and can be taken.
- Handed-over agents stay under **Handed over**, not in the list, as today.
- Agent's call: a live agent that `Eligible` would refuse for a reason other than being a run worker (a codex, agy or
  opencode session, an agent with no terminal block) is still listed, so the glance stays whole, but drawn muted and not
  tappable. `ListedAgent` gains a `takeable` flag set from `Eligible`; only takeable rows are buttons.

## An agent row

- The agent's name. The project shows only when it differs from the name.
- The dot on the left shows the state (asking, needs approval, needs input, working, idle), not the runtime, so its
  colour means something. The state chip on the right stays.
- A second line: a working agent shows what it is doing (`stateLine`, as today); an idle agent shows the first
  sentence of its last reply (what `handedLine` already reads from the transcript for a handed-over agent); a waiting
  agent shows its question or permission line.
- The whole row is a button.

Order stays as today: asking, needs approval, needs input, working, idle; oldest wait first within a state, then name.

## Tapping an agent row takes it

A tap takes the agent at once, with no preview step, and opens the handed-over agent view the phone has today
(transcript, send, stop, approve, deny, Take back).

- New endpoint `POST /api/agents/{tab}/hand`, behind `handlerPost` (`pkg/remotemode/handler.go:106`: Origin and JSON
  checks like every other POST). It runs the same rule as `Hand` (`pkg/remotemode/handover.go:147`): resolve the tab,
  check `Eligible`, then `handAdd`. Remote mode is already on (the phone is talking to it), so it does not call
  `remoteStartLocked`.
- A refused take (`Eligible` fails, the tab is gone) answers with the reason, and the phone shows it on the row and
  leaves the agent in the list. A take of an agent already handed over just opens it.
- At the desk, a taken agent shows **On phone · Take back** (`agentheader.tsx`), exactly as after a hand-over from the
  desk. The desk can still type into it.
- A take you never act on goes back by itself (builder question 1). If you leave the agent view without sending,
  stopping, approving or denying anything, the agent returns to the desk: it leaves **Handed over** on the phone and
  **On phone · Take back** at the desk, and is listed again. Once you have sent, stopped, approved or denied, the take
  stays until Take back, exit or remote off, like a hand-over from the desk. The server keeps an `acted` flag on each
  hand-over taken from the phone. A phone take starts with it unset, and every successful send, stop, approve or deny
  sets it. Leaving the view posts `POST /api/agents/{tab}/release`, which ends the hand-over (reason `taken`) only while
  `acted` is unset; it is a no-op otherwise, and for a hand-over made at the desk, which is never released this way. A
  phone that never leaves cleanly (the page is closed, the phone locks) leaves the take in place: the owner takes it
  back as today.
- Who can take: anyone who can reach the page, which is the owner only (a tailnet device with Tailscale; Cloudflare
  Access with the owner-email lock). That is the same trust as answering an agent's question today.

## A run's row

- One row per run that has at least one live worker, grouped by the run's `DagORef` (`pkg/waveobj/wtype.go:284`,
  reached through the `ownerRun` lookup the roster already uses, `wshserver_remoteagents.go:41`). A worker whose run
  has no `DagORef` is grouped by its own run id.
- The row shows the run's goal and how many workers are in each state ("3 working · 1 needs approval").
- Tapping it opens it in place: under it, one line per worker with its task title and what it is doing, read-only
  (workers cannot be taken: `Eligible` refuses them). Tapping again closes it. Which runs are open is kept on the page
  only (survives the 10-second poll, not a reload).
- Runs come after the agent rows, under their own **Runs** heading; a run that needs you sorts first among them.
- Agent's call, the run's name: the goal of the run's lead, that is the `Run` sharing the `DagORef` that has no
  `TaskId`, no `Review` and no `StageRole`. With no lead run found, the first worker's own `Goal`. A `wsh jarvis run`
  child (no `DagORef`) is grouped by its `ParentLeadORef` and named after that lead tab's agent name.
- Agent's call, "needs you": a run needs you when any of its workers is asking or needs approval or input. Such a run
  sorts first and its chip says so; the phone cannot act on the worker, but it tells the owner to go to the desk.
- Agent's call, worker lines: a task worker shows its task's title, a reviewer "Review: " and the task's title, and a
  stage session its role ("Plan reviewer", "Verifier", "Land resolver").

## Reading an agent's transcript

- Opening an agent shows its most recent messages. The backlog is counted in shown messages, not in raw JSONL lines:
  today the stream sends the last 200 JSONL lines (`defaultTranscriptTailLines`,
  `pkg/wshrpc/wshserver/transcript.go:26`), and one tool-heavy turn can push the answer out of that window.
- Scrolling to the top loads the page of older messages before it, until the session's start. A new read-only
  endpoint (for example `GET /api/agents/{tab}/transcript?before=<cursor>`) serves the pages; the stream keeps
  delivering new messages live as today.
- The scroll position stays put when an older page is added above it.
- Agent's call, where a message is defined: on the phone, not the server. The server pages raw JSONL lines (a page of
  lines before a byte-offset cursor); the phone runs them through its existing projector (`projectors.js`,
  `projectFor`) and keeps asking for the page before until it has gained a screenful of shown messages or reached the
  session's start. No Go port of the projectors. The first backlog stays the stream's tail of raw lines, as today.
- Agent's call, reconnects: a stream reconnect replaces only the live tail; older pages already loaded are kept, and
  `MAX_LINES` (`chat.js:8`) caps the live tail, not the loaded history.

## Page layout

- The header no longer reads "Waiting on you" when nothing waits: it counts what needs you, or says nothing waits on
  you.
- Section order: what waits on you, Handed over, Held runs, Agents, Runs.
- Agent's call, the count: the `h1` reads "N need you" (or "Nothing waits on you") and the sub-line stays
  `countsLine`. N counts open questions, every agent (handed over, listed, or a run's worker) that is asking or needs
  approval or input, and every shown attention item. A handed-over agent that is working or idle does not count.
- Agent's call, "Held runs": the shown attention items (held, blocked, escalated, unverified, workflow scan) keep their
  one section and today's title rule (`phone.js:466`: "Held runs" when every item is held, else "Waiting at the desk").
  "What waits on you" is the Questions section as today.
- A page with no agent, no run and nothing waiting stays as today's empty view.

## Controlling the computer from the phone

Added at the owner's ask (brainstorm answer 6): the phone can lock the computer and change its volume.

- A **Computer** section near the bottom of the page, above **Turn off remote mode**: a **Lock** button and three
  volume buttons (down, mute, up). Shown whenever the page is online, empty view included.
- `POST /api/pc/lock` and `POST /api/pc/volume` with `{"step": "down" | "mute" | "up"}`, both behind `handlerPost`
  like every other POST. A refusal or a failure answers with the reason, and the page shows it under the buttons.
- Windows: Lock calls `LockWorkStation` in `user32.dll`; volume sends the media keys `VK_VOLUME_DOWN`, `VK_VOLUME_MUTE`,
  `VK_VOLUME_UP` with `keybd_event` (or `SendInput`), one step (about 2%) per press, the same as the keyboard's volume
  keys. wavesrv runs in the owner's desktop session, so both reach it. They sit in a `pc_windows.go` beside
  `awake_windows.go`, which already calls `kernel32.dll` the same way.
- macOS: Lock runs `pmset displaysleepnow` (the screen locks when the account asks for its password at once on sleep,
  the default); volume runs `osascript` setting the output volume 6 points down or up, or toggling output muted.
- Other platforms answer 501 and the page hides the section (the waiting list carries a `pc` flag saying whether the
  controls work).
- No confirm on Lock: unlocking needs the owner's password at the desk, and locking stops no agent.
- The page shows no current volume level: the media keys cannot read it, and a level read needs Core Audio over COM,
  which is out of scope.

## Left to the builder

- How many messages a transcript page holds, and the cursor format for older pages.
- How an idle row gets its last-reply line without reading every agent's transcript every 10 seconds (for example, a
  cache keyed by the transcript's size and modification time).
- The exact JSON the hand endpoint returns on a refusal, and the row's error wording.
- Update `cmd/remotepreview` fixtures (a live idle agent with a last reply, a run with workers, no exited rows), step
  1a of the `remote-phone` CDP scenario (`scripts/cdp/scenarios-remote.mjs`), `docs/remote-phone.md` ("The Agents
  list"), `CHANGELOG.md`, and a `docs/hand-checks.md` line for a real iPhone (take an agent, scroll an old transcript).

## Out of scope

- Taking a run's worker to the phone.
- Starting a new agent or run from the phone.
- Any change to how a hand-over ends (`taken`, `exited`, `off`), beyond the release of an unacted phone take above.

## Build decisions (the run's lead, 2026-11-18)

What "Left to the builder" left open, decided here so the tasks agree.

- **Cursor.** A cursor is a byte offset into the transcript file: the start of the first line a chunk holds. A
  page is up to 200 non-empty, complete raw lines ending at the cursor it was asked for
  (`GET /api/agents/{tab}/transcript?before=<offset>` → `{"lines": [...], "cursor": <start of lines[0]>}`); cursor 0
  is the session's start. Why bytes: the file only grows, so an offset never moves, where a line count from the end
  shifts with every append. The tab must be handed over (else 410 with the reason, as the action routes); a missing
  or malformed `before` is 400.
- **Screenful.** The phone pages back until it has gained at least 20 chat items (`chatItems` over the projected
  entries) or reached cursor 0. The projector runs over history + live tail together, as today over the tail.
- **The stream resumes instead of restarting.** The backlog `lines` event carries `cursor` and `backlog: true`;
  every `lines` event carries an SSE `id:` that is the byte offset after its last line. On a reconnect the browser
  sends `Last-Event-ID` itself, and the server's backlog is then the lines from that offset on, so the live tail
  continues with no gap and no duplicate, and the loaded history is kept. Why: the spec keeps older pages over a
  reconnect, and resending the last 200 lines after a long drop-out would leave a hole between them and the
  history. Without `Last-Event-ID` the backlog is the last 200 lines, as today.
- **The idle line** is the first sentence of the first non-empty line of the agent's last reply, at most 160
  characters, the same helper the Handed over row uses. It is cached per transcript path, keyed by the file's size
  and modification time, so the 10-second poll reads a transcript only when it changed.
- **A refused take** answers 409 `{"error": "refused", "reason": "<why>"}` (the `Eligible` message, or "its tab is
  gone" for a tab no longer in the roster); the row shows "Not taken: <reason>" under its line until the next take
  or reload. A take of an agent already handed over answers 200.
- **Release** answers 200 `{"ok": true}` in every case it is a no-op (acted, made at the desk, not handed over).
  The chat posts it whenever it is left by Back or a hash change, not when it ended (the hand-over is already gone).
- **The run row's counts** are drawn on the phone from the workers' states, in the state order, e.g.
  "3 working · 1 needs approval". The server sends `needsyou` and sorts by it, then by name.
- **"N need you" counts each thing once** (plan review, round 1): the open questions, the shown attention items, and
  every agent (handed over, listed, or a run's worker; one per tab) that needs approval or input. An asking agent is
  counted through its question, not again as an agent: the Questions list holds every open ask.
- **An asking row's line is its question** (plan review, round 1): the roster carries the text of the open ask's first
  question; the generic "Asking you a question" stays only for an agent reported asking with no ask registered.
- **The Computer section has the heading "Computer"**, like every other section, and shows in the main and empty views.
- **Computer controls.** 501 `{"error": "Not supported on this computer"}` where the platform has none; a bad
  `step` is 400. The waiting list's `pc` is true only on Windows and macOS.
