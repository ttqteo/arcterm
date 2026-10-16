# Keyboard Shortcuts

The cockpit is designed to be operated entirely from the keyboard. This is the human-readable mirror
of the keybinding registry (`frontend/app/store/keybindings/`) — **the registry is the source of
truth**; when they disagree, the registry is right and this file is stale.

Verified against `bindings.ts` on 2026-10-13.

Design spec: [`docs/superpowers/specs/2026-07-03-keyboard-operability-design.md`](superpowers/specs/2026-07-03-keyboard-operability-design.md).

## Concepts

- **`Mod`** is `Cmd` (⌘) on macOS and `Ctrl` on Windows: the app's own chords (`Mod`+`1`, `Mod`+`S`, `Mod`+`Enter`…)
  follow the platform. A chord written `Ctrl` is the Control key on both (`Ctrl`+`Tab`; `Ctrl`+`C` always
  belongs to the terminal). On macOS an `Alt` chord is `Option`, matched by the key's position.
- **`Mod` works inside a terminal too.** `Mod`+`P`, `Mod`+`G`, `Mod`+`N`, `Mod`+`M`… are the app's on both machines,
  from a focused terminal as well (as in the VS Code terminal): on Windows the shell does not get `Ctrl`+`P`,
  `Ctrl`+`G`, `Ctrl`+`N`, `Ctrl`+`M` while arcterm is open.
- **Close is `Mod`+`Shift`+`W`**: `Cmd`+`Shift`+`W` on macOS, `Ctrl`+`Shift`+`W` on Windows, since `Ctrl`+`W` deletes a
  word in a terminal. A bare `Cmd`+`W` does nothing on macOS (it would have quit arcterm). Every other app chord is
  plain `Mod`, `Ctrl`+`J` too: in a terminal Shift+Enter is the newline.
- **Postures.** There is no global "mode" to track. Focus determines behavior:
  - **Navigate** — focus is on a surface region (not a text field). Single keys move a cursor and act on it.
  - **Type** — focus is in a text field, composer, or the terminal. Keys type normally. Press `Esc` to return to Navigate.
  - A Vietnamese input method left on Telex (EVKey, Unikey) does not get in Navigate's way: a letter it rewrites there
    ("đ" for `dd`, "ư" for `w`, "á" for `a` `s`) acts as the key pressed. One that moves a tone back onto an earlier
    vowel (free tone placement) sends more than one letter, and only the last counts.
- **Leader (`Mod`+`G`, "go").** Press `Mod`+`G`, then a letter, to teleport. It works the same everywhere,
  inside the terminal too; a bare `g` is never a leader. A hint bar appears at the bottom of the screen showing
  the available next keys.
- **Which-key bar.** The transient bottom bar shown after pressing a leader — it only lists keys
  that will work in your current context.
- **Held modifier.** Hold `Mod` or `Alt` on its own a moment and the bottom bar lists every chord on that key that
  works right now — inside the terminal, the only keys that reach the cockpit. The digit jumps show as one chip
  (`Mod`+`1`–`7`, `Alt`+`1`–`9`) while the rail and the Agent surface's project tree number their rows.
- **Cheat sheet.** Press `?` (while not typing), or click the `?` button at the right end of the bottom bar (on every
  surface, while typing too), to open a searchable modal of every shortcut. From the keyboard while typing, open it via
  Search (`Mod`+`P`) → Commands → "Keyboard shortcuts".

## Global (work anywhere, including inside the terminal)

| Keys | Action |
|---|---|
| `Mod`+`1`…`7` | Jump to surface by position — in order: Cockpit, Jarvis, Agent, Usage, Code, Diff, Radar. Hold `Mod` a moment to see the numbers on the rail |
| `Mod`+`P` | Search — opens on the Files scope on Code (see below) |
| `Mod`+`N` | New agent: opens the New dialog on an agent row |
| `Mod`+`Shift`+`R` | New run: opens the New dialog on a run row |
| `Mod`+`Shift`+`T` | Reopen the agent closed last, as a browser reopens a closed tab: its conversation comes back asleep (codex, which cannot sleep, resumes awake), and starts on Wake or a message. Keeps the last 5 closed agents, until arcterm restarts; older ones open from Conversation History. From inside a terminal too |
| `Mod`+`Shift`+`O` | Open a tool: the picker for lazygit, yazi, btop and your own tools (see below), opening in the focused agent's folder, else the project root. From inside a terminal too. Not bare `Mod`+`O`: on Windows that is `Ctrl`+`O`, which a TUI or the shell may take |
| `Mod`+`Shift`+`I` | Add as idea: keeps the text selected in an agent's terminal in that agent's Ideas (one line, at most 500 characters), then offers Undo; with nothing selected, opens the focused agent's Ideas and focuses its Add an idea box. The **Add as idea** chip that shows beside a selection does the same on a click, and goes when a key is typed or the terminal scrolls. From inside a terminal too. In the dev build WebView2's DevTools may take this chord first; a release build has none |
| `Mod`+`G` | Go to…: opens the go-to leader (see below) |
| `Mod`+`J` | What's waiting: the avatar popup (Jarvis peek), on any surface, from inside a terminal too (on Windows it takes `Ctrl`+`J` there; Shift+Enter is the newline). Hold `Mod` on its own and the creature shows a `J` |
| `Mod`+`,` | Settings, as in VS Code and every Mac app |
| `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` | On the Agent surface (a float and fullscreen included): the tab switcher, as the system's app switcher works. Hold `Ctrl`, press `Tab` to move through your agents and terminals (recent first; `Shift`+`Tab` goes back), and let go of `Ctrl` to open the one picked; `Esc` stays where you are. A quick `Ctrl`+`Tab` flips to the tab you were on before without drawing it. `Option`+`Tab` / `Option`+`Shift`+`Tab` too on a Mac, letting go of `Option` |
| `Mod`+`Shift`+`W` | Close the agent or terminal in focus, as a terminal app closes its tab: the pane you are typing in, else the selected agent. Works from inside the terminal and asks first. It has no plain `Mod`+`W` form: on Windows `Ctrl`+`W` deletes a word in the terminal, and a Mac uses the same shape |
| `Cmd`+`K` (macOS) | Clear the focused terminal's screen |
| `Mod`+`=` / `Mod`+`-` / `Mod`+`0` | Zoom the window in / out / back to 100% (`Cmd` on macOS) |
| `Mod`+`M` | Fold the window into Sprout, from the cockpit or a float, even from inside a terminal; folded, the same key brings the window back. Settings → General → Window → Minimize: Dock sends it to the Dock or taskbar instead |

Setup and Settings have no `Mod`+number slot — the positions are bound to `SURFACE_ORDER`
(`frontend/app/view/agents/agents.tsx`), which excludes them. Reach Setup with `Mod`+`G` `.` and Settings with `Mod`+`,` or `Mod`+`G` `,`.

## The New dialog (New agent, New run, Open a tool)

One dialog starts an agent, a terminal, a run or a tool. It opens with focus on the Start column. Three columns sit
side by side: Start, Project, and the pick's own list (an agent's sessions, the tools; a run's model, or its start and
width). They keep one height: a long Project, Session or Tool list scrolls inside its column. The Tool row is the last
in Start, so the other rows keep their digits.

| Keys | Action |
|---|---|
| `1`…`9` | Pick that row in the focused column (Start, Project or Session); in Session `1` is New session |
| `0` | In the Project column: Home, pinned under the projects |
| `↑` / `↓` | Move in the focused column |
| `→` / `←` | Step Start, Project, then the Session or Tool column, and back |
| letters | In the Start column, start typing the task (or a run's goal): focus moves to that box with the letter in it (not with the Tool row picked, which has no task box). In the Project or Session column, filter it by name; `Backspace` shortens the filter |
| `a`…`z` | In the Tool column (with the Tool row picked): pick the nth tool. `↑` / `↓` walk the list, `Enter` opens the tool |
| `Tab` / `Shift`+`Tab` | Next / previous: Start, Project, the Session or Tool column, each field, Cancel, the launch button, and round again |
| `Enter` | Launch, from a column, the Tool list or a one-line field; in the task or goal box it starts a new line |
| `Shift`+`Enter` | With a session picked: open it asleep (or read its transcript, for an agent that cannot sleep) instead of resuming it |
| `Mod`+`Enter` | Launch, from anywhere in the dialog |
| `Esc` | Close the open menu or a column's filter first, then the dialog. What you typed is kept for the next open |

## Open a tool (`Mod`+`Shift`+`O`)

A palette-style picker for the tool library (Setup → Tools). Its first line says where the tool will open: the focused
agent's folder (its worktree when it has one), else the project root, else Home. Other ways in: Open a tool… in an
agent's header `…` menu, and Search → Commands → "Open a tool…". The search box has focus on open.

| Keys | Action |
|---|---|
| letters | Filter by name, command or purpose |
| `↑` / `↓` | Move through the list (Installed, Not installed, Yours); the pointer moves the selection too |
| `Enter` | Open the selected tool in the centre. A tool that is not installed, is installing, failed, or is not on PATH answers with a line instead |
| `Shift`+`Enter` | Open it in the panel under the agent |
| `Mod`+`I` | Install the selected built-in tool that is not installed |
| `Esc` | Close |

## Go-to surface — leader `Mod`+`G`

| Keys | Surface |
|---|---|
| `Mod`+`G` `c` | Cockpit (home) |
| `Mod`+`G` `a` | Agent |
| `Mod`+`G` `j` | Jarvis — channels, records, recall |
| `Mod`+`G` `r` | Radar |
| `Mod`+`G` `s` | Conversation History (in the Agent surface) |
| `Mod`+`G` `v` | Canvas gallery — every project's design canvases (in the Agent surface) |
| `Mod`+`G` `f` | Files |
| `Mod`+`G` `u` | Usage |
| `Mod`+`G` `b` | Code — browse source |
| `Mod`+`G` `.` | Setup — instructions, skills and the tool library |
| `Mod`+`G` `,` | Settings |
| `Mod`+`G` `p` | Search |
| `Mod`+`G` `w` | What's waiting — the avatar popup (Jarvis peek), on any surface |

## Search (`Mod`+`P`)

One overlay with scopes: All, Needs you, Go to, Agents, Runs, Sessions, Records, Notes, Projects, Files, Commands.

| Keys | Action |
|---|---|
| `Tab` / `Shift`+`Tab` | Next / previous scope |
| `n:` `g:` `a:` `r:` `s:` `re:` `no:` `p:` `f:` `c:` typed first in All | Narrow to Needs you, Go to, Agents, Runs, Sessions, Records, Notes, Projects, Files, Commands. A `\` or `/` right after the colon keeps it as text, so a pasted `c:\path` stays a query |
| `@` `/` `#` `>` typed first in All | Jump to Agents, Sessions, Projects, Commands (the older sigils) |
| `→` with the caret at the end of the query | Open the selected row's actions (a run, agent, session, record, initiative or project). Mid-query, `→` moves the caret |
| `←` or `Backspace` on an empty action filter | Leave an action's input, then the action list, back to the results with the query and selection as they were |
| `1`…`9` in Needs you | Answer the selected ask with that option, in place |
| `Enter` in Notes | Copy the selected note as markdown and close |
| `Del` twice in Notes, caret at the end of the query | Delete the selected note. Any other key after the first `Del` cancels |
| `Ctrl`+`Enter` on a note in Notes | Edit it: the palette becomes the editor |
| `Enter` on "New note", the last row in Notes | Write a note; the query becomes its title |
| In the note editor: `Ctrl`+`Enter` / `Tab` / `Esc` | Save / move between title and body (`Enter` in the title moves to the body) / back to the Notes list, pressed twice when there are unsaved changes. `Ctrl`+`P` and a click outside go back the same way |
| `Mod`+`Enter` | The selected row's alternate action, named in the footer. On the goal block, open an orchestrator run instead of a Quick one |
| `Backspace` on an empty query | Leave a picker, then drop back to All |
| `path:123` in Files | Open the file at that line; a bare `:123` on Code moves the open file |

The Agents scope lists the plain terminals and tools beside the agents (a terminal's status reads `running` while it
runs a command, else `terminal`); `Enter` opens one in the centre.

In All, text that names nothing is a goal: Quick and
Orchestrate open the New dialog on that run row with it
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
| `Esc` | On a deep surface (Jarvis, Radar, Files, Usage, Code), go back to the surface you jumped from (opening a run, file, diff or agent from elsewhere), else return to the Cockpit. In a composer or text field, leave Type posture first. |

## The avatar popup (what's waiting)

Click the creature on the footer, or press `Mod`+`G` `w`, to open it.

| Keys | Action |
|---|---|
| `j` / `k` (or `↓` / `↑`) | Move between the waiting rows |
| `Enter` | The focused row's button: approve, retry, accept, land again, open, or open its answer form |
| `1`…`9` | Answer the focused row's question with that option (a one-question, single-pick ask); on a question with several parts or several picks, open its answer form and pick that option |
| `Space` | Peek where the focused row's Open would go |
| `/` | Ask Jarvis (the composer at the bottom) |
| `Esc` | Close |

Opening it from a "Needs you" bubble puts the cursor on that question, with its answer form open when it has one.

The answer form (a question with several parts or several picks; `Enter` or **Answer** opens it under the row):

| Keys | Action |
|---|---|
| `1`…`9` | Pick that option of the current question; on a multi-pick question, press it again to unpick. A single pick moves on to the next unanswered question |
| `←` / `→` | Previous / next question |
| `Enter` | Send once every question has an answer, else go to the first one still unanswered |
| `Esc` | Fold the form, from its text field too; a second `Esc` closes the popup |

## Peek (the avatar popup's item view)

A peek shows a run, agent, record, initiative, radar finding or memory note in the avatar popup. It writes no
selection on the surface underneath. `Space` on a row cursor peeks it;
holding `Mod` underlines every link that can be peeked, and `Mod`+click on one peeks it instead of opening it
(`Cmd`+click on macOS, where `Ctrl`+click is the right click).
`Space` never peeks while focus is in a text field.

| Keys | Action |
|---|---|
| `Enter` | Open the item on its own surface (absent for a memory note, which opens nowhere else) |
| `Backspace` | Back to the avatar popup's hub |
| `Esc` | Close the popup, or return to the hub if the item was opened from it |

A link inside an item view does a full open, even with `Mod` held.

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
| `o` | Switch the Cockpit between Cards and Office |
| `←` `↑` `↓` `→` (Office) | Walk the boss (hold `Shift` to run); walls stop it, doors let it through. In the dialog box `↑` `↓` move the ▶ and `←` `→` switch the question (or, at the notice board, the page) |
| `j` / `k` (Office) | The boss walks to the next / previous desk or seat, the notice board last while something waits on you |
| `n` (Office) | Show the way to the next Needs you for a second, then walk there, riding the lift first when it is on another floor; the notice board comes after the asking desks |
| `Space` (Office) | The Office's A button (`Enter` does the same). At a desk, the notice board, the lift or a room's `+N` chip (the agents and runs that did not fit a desk or a table; `Space` on one opens its card beside the chip), open its dialog box; in the box, do what the ▶ points at (an answer, then Send); on the full card, it works as `Enter` above |
| `f` (Office) | Open the desk's full card big; on the card, grow or shrink it (the size stays for the next card) |
| `PageUp` / `PageDown` (Office) | Ride the lift a floor up / down; `Space` at the lift opens its panel (`↑` `↓` choose a floor, `Space` rides, `Esc` stays) |
| `g` (Office) | Pick up the room the boss stands in to move it: `←` `↑` `↓` `→` pick a slot of the floor, `PageUp` / `PageDown` ride the lift with the room (past the top floor, a new floor), `Space` puts it down (swapping with the room in the slot), `Esc` or `g` puts it back. Dragging a room by its title does the same with the mouse |
| `Esc` (Office) | One step back: the full card to the dialog box, the box to walking; walking, hide the Events rail the menu showed. It never takes the window out of full screen |
| `m` (Office) | The office menu: next Needs you, Notice board and Lift (walk to them and open them), Move this room, Arrange automatically (rooms by name again, Home first), next or previous desk, Events, Background (shows the Backgrounded and Background sections, hidden in Office, while it has agents), Mute sound, Cards view, all keys |
| `s` (Office) | Mute or unmute the Office's sound; what plays is set in Settings → Appearance → Office |

### Agent

| Keys | Action |
|---|---|
| `j` / `k` (or `↓` / `↑`, `→` / `←`) | Next / previous row of the project tree: agents and terminals, in the tree's order. A terminal row takes the centre as an agent does |
| `Mod`+`` ` `` | Fold the terminal panel under the agent to a 32 px strip showing the terminal's name and latest output line, or open it again. Works from inside the terminal; active only while a terminal is in the panel, else the key is the terminal's own. By key position, so the same on every layout |
| `Cmd`+`R` (Mac) | Redraw the terminal: repaint garbled text and have the TUI draw itself again, without restarting the session (the header menu's **Redraw terminal**). Works from inside the terminal, on the one holding the keys (the panel's too), else the focused agent's. Not on Windows, where `Ctrl`+`R` is the shell's reverse search |
| `d` | Toggle the agent rail |
| `i` | The focused agent's initiative: opens a popover on the header (its progress, the chunk this agent is on, what is next, a note). An agent with no initiative opens Link to initiative instead. Inside the popover: `m` Mark done (the next chunk starts), `n` Add note, `↑` / `↓` move over the chunks, `Enter` opens a chunk's status menu, `Esc` or `i` closes it |
| `f` | Toggle terminal fullscreen |
| `Mod`+`Shift`+`Enter` (or `F11`) | Toggle terminal fullscreen from inside the terminal too. A Mac keyboard has no `F11` of its own, so `Cmd`+`Shift`+`Enter` is the one to use there |
| `Shift`+`F` | Toggle float: the window shrinks to the focused terminal, and its pin keeps it on top of other apps |
| `r` | Review: open the focused lead's Spec review or Plan review dialog, or show the focused agent's Doc review in place of its terminal |
| `Esc` | Back to where you jumped from, else to Cockpit; exits fullscreen first; from Conversation History, the Canvas gallery grid or a session transcript, back to the terminal |
| `Shift`+`Esc` | Return focus to the nav (from inside the terminal) |
| `Ctrl`+`C` | In a terminal on Windows: copy while text is selected (the selection goes with it), else the interrupt as always. `Cmd`+`C` copies on a Mac. `Ctrl`+`Shift`+`C` copies too |
| `←` / `→` / `Home` / `End` | Move between the panel's tabs (Overview, Files, File) while its tab strip has focus; the agent keys stand down there |
| `↑` / `↓`, `←` / `→`, `Enter` | In the panel's Files tab: move the cursor, collapse / expand a folder, open a folder or open a file in the File tab |
| `Esc` | In the panel's File tab: cancel the comment being written, else close the file |
| `c` | In the File tab's Preview of a markdown file, comment on the selected text |
| `Mod`+`Enter` | In the File tab: add the comment being written; outside a comment box, send the comments to the agent |

### Agent: Conversation History

Opened with `Mod`+`G` `s` or the sidebar's Conversation History button. History and an ended session's transcript cover the terminal, so the keys
that act on the focused agent stand down while either is open: `j` / `k`, the arrows, `d`, `f`, `r`, `c`, the canvas and review keys, `F11`,
`Mod`+`Enter` (send marks, send review) and the `Esc` that goes back to the Cockpit. In History `j` / `k` (or `↓` / `↑`) move the list cursor,
`Enter` jumps to a live session or resumes an ended one, and `Esc` returns to the terminal. The `Ctrl`+`Tab` switcher still works and brings
the terminal back. An ended session opened from the sidebar covers the terminal the same way, and `Esc` leaves it.

### Agent: Canvas gallery

Opened with `Mod`+`G` `v` or the sidebar's Canvas gallery button. Like History it covers the terminal, so the keys that act on
the focused agent stand down while it is open; the `Ctrl`+`Tab` switcher still works and brings the terminal back. The
gallery is a grid of cards (Today / Yesterday / Earlier); a card opens in a viewer that shows one board at a time.

| Keys | Action |
|---|---|
| `←` / `↑` / `↓` / `→` | In the grid: move the card cursor. Down from the last row of a group continues in the next group, in the same column |
| `Enter` | In the grid: open the canvas under the cursor |
| `/` | In the grid: search topic, board and project names. `Enter` in the box opens the first match, `Esc` empties it, and a second `Esc` gives the keys back to the grid |
| `Esc` | In the grid: back to the terminal |
| `←` / `→` | In an open canvas: previous / next board, round the ends. `[` / `]` step too, but the hints show only the arrows: a Vietnamese Telex input method turns `[` `]` into `ơ` `ư` |
| `Esc` | In an open canvas: back to the grid |
| `←` / `↑` / `↓` / `→` | In Clean up (the grid's **Clean up** button): move the card cursor over the suggested group, then Newer |
| `Space` | In Clean up: tick or untick the card under the cursor. A click does the same; **Untick all** and **Move to trash** are in the bar |
| `Esc` | In Clean up: cancel, back to the grid |

### Agent: terminal grid

A cell is an agent or a terminal (a shell, lazygit beside the agent). Open a split by dragging a live agent or terminal
from the tree onto a terminal (up to four cells), or by right-clicking its row and picking **Open in split**. From the
keyboard it is in the palette: `Mod`+`P`, the agent or terminal, `→`, **Open in split**. A split needs an agent or
terminal with no cell yet and a grid with room; otherwise the menu item is disabled and the palette action just opens it.
A terminal in the centre has the same in its header, **Open beside `<agent>`**, and a terminal in the panel in its bar.

Once there are two cells, each has a bar you can drag to rearrange it; the `×` on it takes the agent or terminal out of
the grid and leaves it running. The header and the details rail follow the focused cell (a terminal's header is its slim
one, with **Move to the panel** and **Close**); click a cell to focus it.

Moving between agents and terminals with the keyboard follows one rule: if it already has a cell, that cell takes focus;
otherwise it replaces the focused cell and the others stay put. So stepping through more of them than there are cells
keeps changing which of them show, and picking terminal T on agent A of a split [A, B] gives [T, B]; a quick `Ctrl`+`Tab`
puts A back in T's cell.

An agent asking a question in its terminal (Claude Code's picker) takes the keyboard: choose it by any route, or have
the chosen agent start asking, and typing moves into its terminal, so `↑` / `↓`, `Enter` and the digits answer the
picker instead of moving through the list. `Shift`+`Esc` goes back to the list.

| Keys | Action |
|---|---|
| `Ctrl`+`Tab` | The tab switcher (see Global); the tab it opens follows the rule above. Works from inside a terminal, and pressed there, typing follows to the new agent's terminal |
| `Alt`+`1`…`9` | The nth row of the project tree, agents and terminals, top to bottom as the tree shows them. Hold `Alt` a moment and each row shows its number. Works from inside a terminal, where typing follows as with `Ctrl`+`Tab` |
| `j` / `k` (or `↓` / `↑`, `→` / `←`) | Next / previous agent or terminal, by the rule above, stopping at the ends of the list; not while a terminal holds focus |
| `f` / `Mod`+`Shift`+`Enter` / `F11` | Fullscreen shows only the focused cell; the grid returns when you leave it |

Canvas mode, a review, the subagent view, Conversation History, the Canvas gallery and an ended session's or a done
worker's transcript each show one thing in place of the grid; the grid comes back as it was. A terminal picked from the tree, `j` / `k`,
`Ctrl`+`Tab` or Search no longer does: it takes a cell by the rule above.

### Agent: canvas mode

`c` works when the focused agent has a canvas. In canvas mode, `[` / `]`, `d`, `f`, `F11` and `Esc` do not do their usual jobs; the agent keys (`j` / `k`, `↑` / `↓`, the `Ctrl`+`Tab` switcher) still move between agents, since the tree stays beside the canvas. On a board `←` / `→` step the boards instead of the agents.

| Keys | Action |
|---|---|
| `c` | Show the agent's canvas; from the canvas, back to the terminal |
| `Alt`+`C` | Switch Terminal → Canvas → Review, skipping the ones the agent doesn't have. Works from inside the terminal, where a bare `c` is typed into it |
| `Alt`+`W` | Close the agent whose header shows **✓ Close · N tok** (its last turn committed and you have read it). Works from inside the terminal; when the header offers no Close, the key goes to the terminal |
| `[` / `]` or `←` / `→` | Previous / next board |
| `m` | Mark parts of the board; in mark mode, stop marking |
| `Mod`+`Enter` | Send the marks to the agent (from mark mode) |

### Agent: review mode

Review mode shows the focused agent's `Doc review` in place of its terminal; `r` enters it while the agent asks one. As in canvas mode, `[` / `]`, `c`, `d`, `f`, `F11` and `Esc` do not do their usual jobs there, and the agent keys still move between agents. The canvas and the review never show at once: showing one puts the other back.

| Keys | Action |
|---|---|
| `r` | Back to the terminal |
| `Alt`+`C` | Next of Terminal, Canvas, Review (as in canvas mode) |
| `[` / `]` | Previous / next tab: Changes, PDF (a `.tex` file only) |
| `c` | Comment on the selected text |
| `e` | Suggest an edit: open the selected text's paragraph as source; `Mod`+`Enter` saves the suggestion, `Esc` cancels. The file is not changed; the agent is sent `Edit: replace "…" with "…"` |
| `Mod`+`Enter` | Approve, while there is no comment and no note to send. Inside a comment being written it adds that comment instead |
| `Mod`+`Enter` | Request changes, once there is a comment or a note. Inside a comment being written it adds that comment instead |

### Jarvis

| Keys | Action |
|---|---|
| `r` | New run |
| `Shift`+`N` | New initiative |
| `i` | With a live run sheet open: focus its composer |
| `/` | Filter the Brief's rows (`Esc` clears) |
| `Enter` | Open the row under the cursor |
| `w` | Work on the initiative under the cursor in a new agent, or go to the agent already open on it |
| `v` | Review: walk the initiatives that changed since you last reviewed them, then the ones idle for two weeks. While a pass is on: `Enter` Mark reviewed and open the next, `j` / `k` (or `←` / `→`) move through the pass, `Esc` leaves it |
| `Alt`+`↑` / `Alt`+`↓` | Move the chunk under the cursor up / down within its stage |
| `e` | Expand / collapse the record band |
| `Shift`+`J` / `Shift`+`K` | Next / previous run in this channel |
| `j` / `k` | With a run sheet open: next / previous run in the list it counts (Runs, or Shipped for a finished run) |
| `1`…`9` | Answer an ask option on a run body |
| `Enter` | Submit the answer |
| `Esc` | Leave the composer (a second `Esc` closes the sheet) |
| `→` / `Enter` | While a Jarvis tour shows: next step |
| `←` | While a Jarvis tour shows: previous step |
| `Esc` | While a Jarvis tour shows: end the tour |

### Code

| Keys | Action |
|---|---|
| `Alt`+`Z` | Toggle word wrap for the open file, also while typing in it. Every file wraps by default |
| `Mod`+`\` | Open the file in a read-only side column (a `.tex` file on its PDF, a document on its preview), or close the side column. Dragging a file from the tree onto the right half of the editor does the same for that file |
| `d` | Toggle the diff against HEAD |
| `r` | Refresh the file index |
| `Alt`+`←` / `Alt`+`→` | Back / forward through opened files |
| `Mod`+`S` | Save the open file |
| `Mod`+`Shift`+`F` | Search file contents, also while typing in the editor |
| `Alt`+`T` (or `Mod`+`Shift`+`E`, VS Code's Explorer key) | Focus the file tree, also from inside the editor |
| `Alt`+`E` | Focus the editor |
| `Delete` | In the file tree: delete the file or folder under the cursor (asks first) |

### Diff

| Keys | Action |
|---|---|
| `j` / `k` (or `↓` / `↑`) | Next / previous commit. In a file list, `↓` / `↑` open the next / previous file at once |
| `Space` | In the Commit tab's list: tick or untick the selected file |
| `Enter` | Open the file under the cursor |
| `/` | Filter history (`Esc` clears) |
| `Shift`+`G` | Toggle the history graph |
| `Mod`+`G` `g` | Top of history |
| `Shift`+`C` | Commit tab, with the message box focused |
| `Shift`+`H` | Log tab |
| `Shift`+`B` | Hide / show the left panel (it starts hidden in a narrow window; your choice is kept) |
| `Shift`+`N` / `Shift`+`P` | Next / previous change in the open diff |
| `Shift`+`D` | Split / unified |
| `Shift`+`W` | Ignore whitespace |
| `Alt`+`Z` | Toggle word wrap for the open file (shared with Code) |
| `v` | Mark the open file reviewed (or unmark it) and open the next unreviewed file |
| `r` | Refresh changes, history and the source tree |
| `c` | In the log: compare refs (the Log tab's Compare…). In compare: change the compared refs |
| `Shift`+`S` | Swap compare refs (in compare) |
| `Tab` | Switch compare side (in compare) |
| `Mod`+`Enter` | Send the line comments to the agent (outside a comment box; inside one it adds the comment, `Esc` cancels). In the Commit tab's message box: commit the ticked files |
| `Esc` | Clear filters, else leave compare, else back to the Cockpit |

### Usage

| Keys | Action |
|---|---|
| `←` / `→` | Previous / next provider tab (the busiest provider first, All last) |
| `j` / `k` and `↓` / `↑` | On the Claude tab, move through the By session rows |
| `Enter` | On the Claude tab, open the By session row under the cursor: its tab in Agent if it is still open, else its transcript |
| `a` | On the Claude tab, Analyze: have Claude read the per-tab numbers and say where the quota goes. Does nothing while an analysis runs, with no Claude tabs in the window, or while Claude's 5-hour or weekly window is at 95% or more |
| `Esc` | Back to the Cockpit |

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
| The `?` button at the bottom bar's right end | Open the cheat sheet with the mouse, on every surface |
| Search → Commands → "Keyboard shortcuts" | Open the cheat sheet while typing |

---

*Not yet configurable.* Bindings are fixed in v1. User-remappable shortcuts
(`keybindings.json`) are a deferred enhancement — see the design spec.
