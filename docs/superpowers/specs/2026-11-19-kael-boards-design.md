# Boards, ported from Kael's fork

Brainstorm: `.superpowers/brainstorm/kael-boards/brainstorm.json` (2026-11-19). Mockups: canvas `kael-boards`,
boards `A-ben-canh-chat.dc.html` (a board split beside Chat) and `Library-boards.dc.html` (Library → Boards). Boards
`B-thay-cho-chat` and `C-trong-canvas-pane` are the options not chosen, kept on the canvas for reference only: build
neither.

## Intent

An agent explains something (a startup flow, an architecture, a choice) better with a drawing. Kael's fork
(`kael/main`, remote `https://github.com/kaeltran16/waveterm.git`) built Boards for that: an Excalidraw drawing per
topic, drawn by a separate, cheap, read-only drawer so the drawing work stays out of the working agent's context.
This ports the design Kael settled on last (`docs/superpowers/specs/2026-11-19-boards-agent-connection-design.md` on
`kael/main`), cut down to what is decided below. The agent stays the one you talk to; the board is where its
explanations get drawn.

Kael's fork split from `main` on 2026-10-19 (1604 commits since). Its code is the starting point, rewritten for
`main`'s architecture: `main` has no workspace pane beside the transcript, so nothing is cherry-picked.

## What exists on main today

- No boards: no `view/boards`, no `pkg/board*`.
- The Agent surface swaps a pane in place of an agent's terminal, one at a time: Review, Brainstorm, Canvas, App
  (`frontend/app/view/agents/agentsurface.tsx:917-933`, `swapped` at :210).
- Chat (`chatpane.tsx`) renders only claude agents (`chatCapable`, `chatmode.ts:29-40`).
- Library has three tabs, Conversations, Canvases, Councils (`frontend/app/view/library/librarysurface.tsx:45-49`,
  `LIBRARY_TABS` in `librarystore.ts`). Its Canvases tab is the `.dc.html` design gallery, unrelated to Boards.

## Decisions

### Which agents

Only claude agents get boards. Forwarded questions and their answers go through Chat and the claude transcript. A pi
agent has no board beside it.

### How a board starts

Only through the agent: `wsh board draw --board <name> [--context "<briefing>"] [--ask "<question>"]`. `--context`
briefs the drawer and creates the board when the agent's project has none of that name; later requests are one
line. The board is tied to the agent that ran it. There is no palette command and no New board, so there is no agent
picker, no agent chip and no "needs an agent" state. Another agent's `wsh board draw` on a board tied to someone else
is drawn as its request and leaves the tie as it is.

The `arc:cockpit` skill (`skills/cockpit/`) tells agents when and how to use `wsh board draw`.

### When the agent draws

The agent's turn in Chat carries a board card (the board's name, its shape count, **Open**). The board never opens
by itself. **Open** splits the agent's cell with the board. When you are not looking at that agent, a toast says the
drawer drew on `<board>`, with **Open**. Each board has its own card; the board's name in its header switches
between the agent's boards.

### Where a board shows: split beside Chat

Superseded by `2026-11-22-board-cells-design.md`: the board is a grid cell of its own, opened from a row in the Agent tree.

Board `A-ben-canh-chat.dc.html`. The agent's cell splits: Chat on the left, the board on the right.

- Header: the board's name (the switcher), its facts (`9 shapes · drawn 15:20`), Expand (the board takes the whole
  cell) and Close (back to Chat alone).
- Canvas: plain Excalidraw.
- Recent turns under the canvas, each with its state (drawn, forwarded), **Show** on a drawn turn (outlines its
  shapes) and send-the-other-way (below).
- The ask box: shows `Selected <shape label>` when shapes are selected, else a hint to select shapes to ask about
  them; **Ask**.
- A forwarded question shows in Chat as your own message under a chip `from <board> · on <shapes>`.

When the cell is not showing Chat (Terminal chat mode, or a Review, Brainstorm or Canvas pane in the terminal's
place), **Open** switches the cell to Chat, closing that pane, then splits. The live xterm is therefore never inside
the split. The toast's **Open** and Library → Boards opening a live agent's board do the same.

The split is part of the agent's cell, so it obeys AGENTS.md's grid rules: the terminal stack stays one always
rendered grid, the cell's pane is never re-parented, tracks stay `minmax(0, 1fr)`, nothing animates a cell's size.

### The drawer

- One headless `claude --model sonnet` session per board, tools `Read,Grep,Glob` only, no MCP
  (`--strict-mcp-config`), working directory the project's repo. First turn `--session-id`, later turns `--resume`.
  Kael's `pkg/boarddrawer/runner.go` is the reference.
- One turn at a time per board.
- Each turn it reads what the agent said since its last read (the claude transcript), so "draw what we just
  discussed" works without restating it.
- Each turn does exactly one of: change the drawing, or flag the line as a question for the agent and draw nothing.
  It never answers in words.
- Selected shapes go with the line. The whole board is shared: the drawer may move, restyle or remove any shape,
  hand-drawn ones included.
- States: answering (green, seconds since you asked; Ask disabled until it lands), slow (past the usual time, "Still
  answering" with **Stop**, which ends the turn and leaves the board unchanged), failed ("Couldn't answer", what
  happened, nothing changed, **Retry**).
- One Excalidraw undo step per drawing turn.
- **Agent's call:** a turn the agent sent (`wsh board draw`, its `--ask` or its briefing) is always drawn, never
  flagged back to the agent; if the drawer cannot draw it, the turn fails. So there are two kinds of turn: the
  person's ask (routed) and the agent's request (drawn or failed). `wsh board draw` returns to the agent what
  happened: drawn on `<board>` with the shapes added and changed, or the error.

### Forwarding a question to the agent

- A line the drawer flags is typed into the agent as your own message: your words, the selected shapes' labels and
  the board's name, headed by a marker Chat recognises (it draws the chip) and the reply search finds by turn id
  (Kael: `pkg/boardforward`). It is the only board text that reaches the agent; no shapes, coordinates or drawer
  turns do.
- If the agent has a question or permission prompt open, the forward waits on its turn ("waiting for <agent>") and
  goes once the prompt is answered. If the agent is mid-turn, it queues after the current turn, as a typed message
  would. If the agent's tab is closed, the turn says so; nothing is lost. **Agent's call:** if the agent is asleep,
  the forward wakes it, as a message you type in Chat would.
- When the agent's turn ends, wavesrv reads its reply from the transcript and stores it as the forwarded turn's
  reply. Reading it is a transcript read, not a model call.
- In the split beside Chat the turn reads "forwarded · answered in Chat". Expanded, and in Library, the copied reply
  shows under the question.
- If the answer changes the picture, the agent may send the drawer a one-line `wsh board draw`.

### Send the other way

Each turn has one button: a drawn turn can be sent to the agent instead, a forwarded turn can be drawn instead. It
only redoes, never takes back: a drawn turn resent keeps its shapes (Excalidraw undo removes them); a forwarded turn
drawn instead stays with the agent. Forwards go at once, with no hold and no revert data.

### Reopening boards: Library → Boards

Board `Library-boards.dc.html`. Library gets a fourth tab, **Boards** (key 4), after Councils.

- The list: the project picked in the app bar, newest first. Each row: a thumbnail, the board's name, its agent and
  whether the agent is running or ended, turn count, shape count, last drawn time. A search box filters by name.
- The selected board: its canvas (hand edits still save) and the column of turns with their copied replies, **Show**
  on drawn turns. A board whose agent ended takes no new questions ("The agent ended, so you can't ask here"). A board
  whose agent is alive opens beside that agent's Chat on the Agent surface instead, through the router
  (`frontend/app/view/jarvis/openref.ts`).
- **Open conversation** opens the agent's session in Library → Conversations.
- Empty: the project has no boards; say that boards appear when an agent runs `wsh board draw`.

All routes into Library go through `librarystore.ts` (`showLibrary(model, tab)`).

### Storage

`<data>/boards/<project>/<id>.excalidraw`, plus a sidecar beside it holding the board's turns, its agent and the
drawer's session id. Saves are rev-guarded so a hand edit and a drawer turn never overwrite each other. Local only, no
sync. Kael's `pkg/boardstore` is the reference.

**Agent's call: what a board is tied to.** The cockpit agent id (its tab), which survives sleep and wake and an app
restart. The drawer's transcript read and the reply search look up that agent's current claude session at each turn,
so they follow `/clear` and compaction. A sleeping agent is alive. An agent ends when its tab closes; resuming its
session from Library makes a new agent, and the board stays with the ended one (read-only in Library → Boards).

### Cost and RAM

- The drawer stays on Sonnet and resumes its session, so it never re-reads the whole talk. Its turns count in Usage
  under the board's project.
- `@excalidraw/excalidraw` (Kael uses 0.18.1) is lazy-loaded when a board first shows, so the app carries none of it
  when no board is open.
- Measure the RAM of an open board and log it under "RAM watch" in `docs/open-issues.md`.

## Not in this port

- New board from this (handoff with a drawer-written summary) and the briefing-changes-topic prompt (New board from
  this / Keep it here).
- A palette command or New board; the agent picker and agent chip.
- pi agents.
- A Boards surface on the rail.
- Drawer words replies (11-12 design).

## Left to the builder

- The drawer's prompt and how it decides draw versus forward (start from Kael's `pkg/boarddrawer/drawer-prompt.md`).
- The exact text of the forwarded message.
- How the reply is found in the transcript at turn end.
- How wide the board half is, and whether a cell in a 2x2 split can split again or only opens expanded.
- How many turns the narrow column lists.
- Code to port from `kael/main`: `pkg/boardstore`, `pkg/boarddrawer`, `pkg/boardforward`,
  `pkg/wshrpc/wshrpctypes_board.go`, `pkg/wshrpc/wshserver/wshserver_board*.go`, `cmd/wsh/cmd/wshcmd-board.go`,
  `frontend/app/view/boards/*`. Drop `pkg/boardthings` (it read runs, initiatives and sessions as a board's About,
  which this port has no route for) unless the drawer's prompt needs it.
- Run `task generate` after the wshrpc types.
- CDP scenarios for: the board card in Chat, the board split beside Chat (turns, Show, send-the-other-way, ask box with
  a selection), a forwarded question with its chip in Chat and its copied reply, the drawer's answering, slow and
  failed states, and Library → Boards (list, a selected board, empty).
- `CHANGELOG.md`: a big line with its `<!-- shot: ... -->`.

## Builder decisions (2026-11-19, autonomous run)

What "Left to the builder" left open, decided by the run's lead, each with why.

- **A board belongs to a project by name.** The key is the roster's `AgentInfo.Project` (the registered project's
  name, the same key the app bar's project picker and `AgentVM.project` use), and the drawer's working directory is
  `AgentInfo.ProjectPath`. Storage is `<data>/boards/<project>/`, the name sanitized for a path. Kael keyed boards by
  channel id; `main`'s Library, Usage and app bar all speak project names, so one key serves every reader. An agent
  whose folder is no registered project gets an error from `wsh board draw` ("… is not in a registered project"):
  there is nowhere to list its board.
- **Only claude agents can draw.** `wsh board draw` from a pi (or any non-claude) agent is refused with "boards are
  for Claude agents". `BoardAgent` keeps the tab id, the title the roster gave it, and the agent's latest claude
  session id (refreshed at every drawer read), so Library's **Open conversation** works after the tab closes.
- **Alive = the tab is in the roster** (sleeping included). The server refuses a person's ask on a board whose agent
  ended ("the agent ended, so you can't ask here"), so the UI's rule has one source of truth on the wire too.
- **`wsh board draw` waits for its turn.** It returns once the turn is drawn (the frontend applied the answer and
  acked it) or failed, printing `Drawn on board "<name>": +A shapes, C changed, R removed.` or the error (exit 1).
  It waits at most 9 minutes; past that it prints `Still drawing on board "<name>"; its card in Chat shows when it
  lands.` and exits 0. The `arc:cockpit` skill tells agents to run it with a Bash timeout of 600000 ms. Why: the spec
  says the command returns what happened; Claude's Bash tool caps a call at 10 minutes.
- **The frontend still lands every drawing.** As in Kael's fork, the drawer's answer is element skeletons; only
  Excalidraw's `convertToExcalidrawElements` turns them into elements, so wavesrv files each answer in the board's
  inbox and an always-mounted applier lands it (on the open canvas as one undo step, else in the file under the rev it
  read) and acks it with the shape ids. A landing that fails acks with an error, which fails the turn ("Couldn't
  answer", nothing changed). The applier loads `@excalidraw/excalidraw` the first time an answer arrives or a board
  shows, so an app with no boards carries none of it.
- **Two kinds of turn on the wire:** `kind: "ask"` (yours, routed draw or forward) and `kind: "request"` (the agent's
  `wsh board draw`, always drawn or failed). Your ask is refused while a turn runs (Ask is disabled); an agent's
  request queues behind it.
- **No summary handoff.** Kael's drawer starts a new session from a summary past 60k tokens of context; that path
  (and its fork-session plumbing) is not ported. The talk still records `contexttokens`, so it can be added when a
  long board shows the need. Why: YAGNI for a first port; the spec scopes the drawer to one resumed session.
- **The forward's marker** is Kael's: a first line `[From board "<name>" · on <labels> · turn <id>]`, then your
  words. Go writes it (`pkg/boardforward`), the frontend parses it (`boardforwardmarker.ts`) to draw the chip and hide
  the line. The reply is the last agent text after that user entry and before the next user entry
  (`boardforward.ReplyAfter`), read at the agent's turn end.
- **Forward states:** `waiting` (the agent has a question or permission prompt open; it goes once that is answered),
  `sent`, `replied`, `agentgone` (the tab closed; the question stays on the turn and send-the-other-way still draws
  it). A sleeping agent is woken through the same `deliverToAgent` path `wsh agents send` uses.
- **The split's widths.** The board takes the right 50% of the cell. In a grid of more than one cell, Open opens the
  board expanded (the whole cell) and the header has no Expand: half of a quarter is too narrow to draw in. Close
  always returns to Chat alone. The split is a layer inside the cell, beside `ChatLayer`: Chat's absolute box gets a
  right inset, the xterm under both keeps its size, so no pane changes parent and nothing refits.
- **The narrow column lists the last 3 turns** with a "N earlier" line that expands the board; expanded (and in
  Library) every turn shows, with copied replies under forwarded questions.
- **Slow** starts 45 s after a turn starts answering (Kael's figure); answering shows the seconds since you asked.
- **The toast** fires only for a drawn turn the agent requested, and only when the focused agent on the Agent surface
  is not that board's agent. A failed agent request needs no toast: `wsh board draw` already told the agent.
- **Library → Boards with no project picked** lists every project's boards, newest first, each row naming its project.
- **Scenarios stub the board RPCs in the page** (as Kael's did): Final must never start a real drawer. The live drawer
  is a hand check in `docs/hand-checks.md`.
- **The What's new picture.** The `boards-split` scenario takes it (`h.whatsnewShot("boards", …)`) on the Final run;
  until that file is committed the CHANGELOG line carries `<!-- shot: none -->`, since `whatsnew.test.ts` fails a
  shot comment naming a file that does not exist yet.
