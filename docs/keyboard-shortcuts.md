# Keyboard Shortcuts

The cockpit is designed to be operated entirely from the keyboard. This is the human-readable mirror
of the keybinding registry (`frontend/app/store/keybindings/`) — **the registry is the source of
truth**; when they disagree, the registry is right and this file is stale.

Verified against `bindings.ts` on 2026-10-06.

Design spec: [`docs/superpowers/specs/2026-07-03-keyboard-operability-design.md`](superpowers/specs/2026-07-03-keyboard-operability-design.md).

## Concepts

- **Postures.** There is no global "mode" to track. Focus determines behavior:
  - **Navigate** — focus is on a surface region (not a text field). Single keys move a cursor and act on it.
  - **Type** — focus is in a text field, composer, or the terminal. Keys type normally. Press `Esc` to return to Navigate.
- **Leader (`g`, "go").** Press `g` (while not typing), then a letter, to teleport. A hint bar
  appears at the bottom of the screen showing the available next keys.
- **Which-key bar.** The transient bottom bar shown after pressing a leader — it only lists keys
  that will work in your current context.
- **Cheat sheet.** Press `?` (while not typing) to open a searchable modal of every shortcut.
  When you are typing (e.g. in the terminal), open it via Search (`Ctrl`+`P`) → Commands → "Keyboard shortcuts".

## Global (work anywhere, including inside the terminal)

| Keys | Action |
|---|---|
| `Ctrl`+`1`…`7` | Jump to surface by position — in order: Cockpit, Jarvis, Agent, Usage, Code, Diff, Radar |
| `Ctrl`+`P` | Search — opens on the Files scope on Code (see below) |
| `Ctrl`+`N` | New agent |
| `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` | Next agent / next agent that is asking (it goes forward, not back) |
| `Ctrl`+`C` `Ctrl`+`C` (double, within 500ms) | Close the focused agent |

Setup and Settings have no `Ctrl`+number slot — the positions are bound to `SURFACE_ORDER`
(`frontend/app/view/agents/agents.tsx`), which excludes them. Reach Setup with `g` `.` and Settings with `g` `,`.

## Go-to surface — leader `g` (Navigate posture)

| Keys | Surface |
|---|---|
| `g` `h` | Cockpit (home) |
| `g` `a` | Agent |
| `g` `j` | Jarvis — channels, records, recall |
| `g` `r` | Radar |
| `g` `s` | Conversation History (in the Agent surface) |
| `g` `f` | Files |
| `g` `u` | Usage |
| `g` `b` | Code — browse source |
| `g` `.` | Setup — instructions and skills |
| `g` `,` | Settings |
| `g` `p` | Search |

## Search (`Ctrl`+`P`)

One overlay with scopes: All, Needs you, Go to, Agents, Runs, Sessions, Records, Projects, Files, Commands.

| Keys | Action |
|---|---|
| `Tab` / `Shift`+`Tab` | Next / previous scope |
| `n:` `g:` `a:` `r:` `s:` `re:` `p:` `f:` `c:` typed first in All | Narrow to Needs you, Go to, Agents, Runs, Sessions, Records, Projects, Files, Commands. A `\` or `/` right after the colon keeps it as text, so a pasted `c:\path` stays a query |
| `@` `/` `#` `>` typed first in All | Jump to Agents, Sessions, Projects, Commands (the older sigils) |
| `→` with the caret at the end of the query | Open the selected row's actions (a run, agent, session, record, initiative or project). Mid-query, `→` moves the caret |
| `←` or `Backspace` on an empty action filter | Leave an action's input, then the action list, back to the results with the query and selection as they were |
| `1`…`9` in Needs you | Answer the selected ask with that option, in place |
| `Ctrl`+`Enter` | The selected row's alternate action, named in the footer. On the goal block, open an orchestrator run instead of a Quick one |
| `Backspace` on an empty query | Leave a picker, then drop back to All |
| `path:123` in Files | Open the file at that line; a bare `:123` on Code moves the open file |

In All, text that names nothing is a goal: Quick and Orchestrate open the New run window with it
filled in and the active (else last used) project preselected, so the project is confirmed there
before anything starts; the Ask rows send it as a one-shot ask in that project. When the
text names something, Enter opens that, and one "Start as a goal" row below expands into the same
choices. A verb names something too: "cancel" lists "Cancel run · <run>" for each run that can be
cancelled now, in All and in Commands, so it never starts a run named "cancel".

## Navigation within a surface (Navigate posture)

| Keys | Action |
|---|---|
| `[` / `]` | Previous / next surface (cycles `SURFACE_ORDER`, wraps) |
| `j` / `k` (or `↓` / `↑`) | Move the cursor within the active region |
| `Enter` | Open / activate the item under the cursor |
| `Space` | Peek the item under the cursor in the avatar popup, without leaving the surface (see Peek below) |
| `Esc` | On a deep surface (Jarvis, Radar, Files, Usage, Code), return to the Cockpit. In a composer or text field, leave Type posture first. |

## Peek (the avatar popup's item view)

A peek shows a run, agent, record, initiative, radar finding or memory note in the avatar popup. It writes no
selection on the surface underneath and never changes the cockpit focus. `Space` on a row cursor peeks it;
holding `Ctrl` underlines every link that can be peeked, and `Ctrl`+click on one peeks it instead of opening it.
`Space` never peeks while focus is in a text field.

| Keys | Action |
|---|---|
| `Enter` | Open the item on its own surface (absent for a memory note, which opens nowhere else) |
| `Backspace` | Back to the avatar popup's hub |
| `Esc` | Close the popup, or return to the hub if the item was opened from it |

A link inside an item view does a full open, even with `Ctrl` held.

## Per-surface actions (Navigate posture)

### Cockpit

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous card or task row |
| `n` | Jump to the next ask |
| `h` / `l` (or `←` / `→`) | Move to the other column; on an ask with several questions, switch question |
| `1`…`9` on a task row | Answer the worker's question, else run the row's action |
| `Enter` on a task row | Send the worker's answer, else open the worker |
| `1`…`9` | Select an answer option |
| `Enter` | Confirm the answer, else open focus |
| `r` | Reply inline to the agent |
| `t` | Open the agent's terminal |
| `b` | Background the agent (keeps it running) |

### Agent

| Keys | Action |
|---|---|
| `j` / `k` (or `↓` / `↑`, `→` / `←`) | Next / previous agent |
| `d` | Toggle the agent rail |
| `f` | Toggle terminal fullscreen |
| `r` | Review: open the focused lead's Spec review or Plan review dialog, or show the focused agent's Doc review in place of its terminal |
| `Esc` | Back to Cockpit, or exit fullscreen first; from Conversation History or a session transcript, back to the terminal |
| `Shift`+`Esc` | Return focus to the nav (from inside the terminal) |
| `←` / `→` / `Home` / `End` | Move between the panel's tabs (Overview, File) while its tab strip has focus; the agent keys stand down there |
| `Esc` | In the panel's File tab: cancel the comment being written, else close the file |
| `c` | In the File tab's Preview of a markdown file, comment on the selected text |
| `Ctrl`+`Enter` | In the File tab: add the comment being written; outside a comment box, send the comments to the agent |

### Agent: Conversation History

Opened with `g` `s` or the sidebar's Conversation History button. History and an ended session's transcript cover the terminal, so the keys
that act on the focused agent stand down while either is open: `j` / `k`, the arrows, `d`, `f`, `r`, `c`, the canvas and review keys, `F11`,
`Ctrl`+`Enter` (send marks, send review) and the `Esc` that goes back to the Cockpit. In History `j` / `k` (or `↓` / `↑`) move the list cursor,
`Enter` jumps to a live session or resumes an ended one, and `Esc` returns to the terminal. `Ctrl`+`Tab` still cycles agents and brings the
terminal back. An ended session opened from the sidebar covers the terminal the same way, and `Esc` leaves it.

### Agent: terminal grid

Open a split by dragging a live agent from the tree onto a terminal (up to four cells), or by right-clicking its row and
picking **Open in split**. From the keyboard it is in the palette: `Ctrl`+`P`, the agent, `→`, **Open in split**. A split
needs an agent with no cell yet and a grid with room; otherwise the menu item is disabled and the palette action just
opens the agent.

Once there are two cells, each has a bar you can drag to rearrange it; the `×` on it takes the agent out of the grid and
leaves it running. The header and the details rail follow the focused cell; click a cell to focus it.

Moving between agents with the keyboard follows one rule: if the agent already has a cell, that cell takes focus;
otherwise the agent replaces the focused cell and the others stay put. So stepping through more agents than there are
cells keeps changing which of them show.

| Keys | Action |
|---|---|
| `Ctrl`+`Tab` | Next agent, by the rule above. Works from inside a terminal, and pressed there, typing follows to the new agent's terminal |
| `Ctrl`+`Shift`+`Tab` | Next asking agent, by the rule above |
| `j` / `k` (or `↓` / `↑`, `→` / `←`) | Next / previous agent, by the rule above, stopping at the ends of the list; not while a terminal holds focus |
| `f` / `F11` | Fullscreen shows only the focused cell; the grid returns when you leave it |

Canvas mode, a review, the subagent view, Conversation History, an ended session's or a done worker's transcript, and a
terminal focused from the tree's Terminals section each show one thing in place of the grid; the grid comes back as it
was.

### Agent: canvas mode

`c` works when the focused agent has a canvas. In canvas mode, `[` / `]`, `d`, `f`, `F11` and `Esc` do not do their usual jobs; the agent keys (`j` / `k`, the arrows, `Ctrl`+`Tab`) still move between agents, since the tree stays beside the canvas.

| Keys | Action |
|---|---|
| `c` | Show the agent's canvas; from the canvas, back to the terminal |
| `[` / `]` | Previous / next board |
| `m` | Mark parts of the board; in mark mode, stop marking |
| `Ctrl`+`Enter` | Send the marks to the agent (from mark mode) |

### Agent: review mode

Review mode shows the focused agent's `Doc review` in place of its terminal; `r` enters it while the agent asks one. As in canvas mode, `[` / `]`, `c`, `d`, `f`, `F11` and `Esc` do not do their usual jobs there, and the agent keys still move between agents. The canvas and the review never show at once: showing one puts the other back.

| Keys | Action |
|---|---|
| `r` | Back to the terminal |
| `[` / `]` | Previous / next tab: Changes, PDF (a `.tex` file only) |
| `c` | Comment on the selected text |
| `Ctrl`+`Enter` | Approve, while there is no comment and no note to send. Inside a comment being written it adds that comment instead |
| `Ctrl`+`Enter` | Request changes, once there is a comment or a note. Inside a comment being written it adds that comment instead |

### Jarvis

| Keys | Action |
|---|---|
| `i` | Focus the composer |
| `/` | Filter the Brief's rows (`Esc` clears) |
| `Enter` | Open the row under the cursor |
| `w` | Work on the initiative under the cursor in a new agent, or go to the agent already open on it |
| `Alt`+`↑` / `Alt`+`↓` | Move the chunk under the cursor up / down within its stage |
| `d` | Toggle the context rail |
| `e` | Expand / collapse the record band |
| `c` | New channel |
| `Shift`+`G` | Graph peek (`Esc` closes) |
| `Shift`+`J` / `Shift`+`K` | Next / previous run in this channel |
| `j` / `k` | With a run sheet open: next / previous run in the list it counts (Runs, or Shipped for a finished run) |
| `1`…`9` | Answer an ask option on a run body |
| `Enter` | Submit the answer |
| `Esc` | Leave the composer |

### Diff

| Keys | Action |
|---|---|
| `j` / `k` (or `↓` / `↑`) | Next / previous commit or file |
| `Enter` | Open the file under the cursor |
| `/` | Filter history (`Esc` clears) |
| `Shift`+`G` | Toggle the history graph |
| `g` `g` | Top of history |
| `Shift`+`H` | Collapse / expand history |
| `Shift`+`N` / `Shift`+`P` | Next / previous change in the open diff |
| `Shift`+`D` | Split / unified |
| `Shift`+`W` | Ignore whitespace |
| `r` | Refresh changes and history |
| `c` | In history: compare refs. In compare: change the compared refs |
| `Shift`+`S` | Swap compare refs (in compare) |
| `Tab` | Switch compare side (in compare) |
| `Ctrl`+`Enter` | Send the line comments to the agent (outside a comment box; inside one it adds the comment, `Esc` cancels) |
| `Esc` | Clear filters, else leave compare, else back to the Cockpit |

### Route DAG (the orchestrator run's graph)

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous task, in plan order |
| `←` / `→` | Follow an edge to the nearest dependency / dependent |
| `↑` / `↓` | Previous / next task in the same column |
| `Enter` (or double-click a task) | Open the task's worker in the Agent surface, or its child run once the session is gone |
| `f` | Fit the whole graph |
| `+` / `-` | Zoom in / out |
| `Esc` | Clear the selection; with nothing selected, close the graph |

Resting the pointer on a task shows its peek: the full title, the description's first paragraph (or the files
it touches), what it is waiting on, its latest activity, and why it failed. Drag a task to move it (its place is
kept for that run until Reset layout); drag empty canvas to pan. A dashed band marks a lane: tasks that merge as one.

### Final check viewer (a run's Final check screenshots, opened from its run sheet)

| Keys | Action |
|---|---|
| `↑` / `↓` | Previous / next scenario |
| `←` / `→` | Previous / next screenshot of the scenario |
| `z` | Fit / actual size |
| `s` | Show or hide the steps |
| `Esc` | Close the viewer; the run sheet stays open |

While the viewer is open these are the only cockpit keys: the surface underneath does not move.

## Help

| Keys | Action |
|---|---|
| `?` (`Shift`+`/`) | Open the shortcut cheat sheet (Navigate posture) |
| Search → Commands → "Keyboard shortcuts" | Open the cheat sheet while typing |

---

*Not yet configurable.* Bindings are fixed in v1. User-remappable shortcuts
(`keybindings.json`) are a deferred enhancement — see the design spec.
