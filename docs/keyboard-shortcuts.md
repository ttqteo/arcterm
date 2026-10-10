# Keyboard Shortcuts

The cockpit is designed to be operated entirely from the keyboard. This is the human-readable mirror
of the keybinding registry (`frontend/app/store/keybindings/`) — **the registry is the source of
truth**; when they disagree, the registry is right and this file is stale.

Verified against `bindings.ts` on 2026-10-07.

Design spec: [`docs/superpowers/specs/2026-07-03-keyboard-operability-design.md`](superpowers/specs/2026-07-03-keyboard-operability-design.md).

## Concepts

- **`Mod`** is `Cmd` (⌘) on macOS and `Ctrl` on Windows: the app's own chords (`Mod`+`P`, `Mod`+`N`, `Mod`+`Enter`…)
  follow the platform. A chord written `Ctrl` is the Control key on both (`Ctrl`+`Tab`, and `Ctrl`+`C`, which
  belongs to the terminal). On macOS an `Alt` chord is `Option`, matched by the key's position.
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
  (`Mod`+`1`–`7`, `Alt`+`1`–`9`) while the rail and the Active list number their rows.
- **Cheat sheet.** Press `?` (while not typing) to open a searchable modal of every shortcut.
  When you are typing (e.g. in the terminal), open it via Search (`Mod`+`P`) → Commands → "Keyboard shortcuts".

## Global (work anywhere, including inside the terminal)

| Keys | Action |
|---|---|
| `Mod`+`1`…`7` | Jump to surface by position — in order: Cockpit, Jarvis, Agent, Usage, Code, Diff, Radar. Hold `Mod` a moment to see the numbers on the rail |
| `Mod`+`P` | Search — opens on the Files scope on Code (see below) |
| `Mod`+`N` | New agent: opens the New dialog on an agent row |
| `Mod`+`Shift`+`R` | New run: opens the New dialog on a run row |
| `Mod`+`Shift`+`N` | Launch a Pi tab |
| `Mod`+`G` | Go to…: opens the go-to leader (see below) |
| `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` | Next agent / next agent that is asking (it goes forward, not back) |
| `Ctrl`+`C` `Ctrl`+`C` (double, within 500ms) | Close the focused agent |

Setup and Settings have no `Mod`+number slot — the positions are bound to `SURFACE_ORDER`
(`frontend/app/view/agents/agents.tsx`), which excludes them. Reach Setup with `Mod`+`G` `.` and Settings with `Mod`+`G` `,`.

## The New dialog (New agent, New run)

One dialog starts an agent, a terminal or a run. It opens with focus on the Start column.

| Keys | Action |
|---|---|
| `1`…`9` | Pick that row in the focused column (Start or Project) |
| `↑` / `↓` | Move in the focused column |
| `→` / `←` | From the Start column to the Project column, and back |
| letters | In the Project column, filter projects by name; `Backspace` shortens the filter |
| `Tab` / `Shift`+`Tab` | Next / previous: Start, Project, each field, Cancel, the launch button, and round again |
| `Enter` | Launch, from a column or a one-line field; in the task or goal box it starts a new line |
| `Mod`+`Enter` | Launch, from anywhere in the dialog |
| `Esc` | Close the open menu or the project filter first, then the dialog. What you typed is kept for the next open |

## Go-to surface — leader `Mod`+`G`

| Keys | Surface |
|---|---|
| `Mod`+`G` `c` | Cockpit (home) |
| `Mod`+`G` `a` | Agent |
| `Mod`+`G` `j` | Jarvis — channels, records, recall |
| `Mod`+`G` `r` | Radar |
| `Mod`+`G` `s` | Conversation History (in the Agent surface) |
| `Mod`+`G` `f` | Files |
| `Mod`+`G` `u` | Usage |
| `Mod`+`G` `b` | Code — browse source |
| `Mod`+`G` `.` | Setup — instructions and skills |
| `Mod`+`G` `,` | Settings |
| `Mod`+`G` `p` | Search |
| `Mod`+`G` `w` | What's waiting — the avatar popup (Jarvis peek), on any surface |

## Search (`Mod`+`P`)

One overlay with scopes: All, Needs you, Go to, Agents, Runs, Sessions, Records, Projects, Files, Commands.

| Keys | Action |
|---|---|
| `Tab` / `Shift`+`Tab` | Next / previous scope |
| `n:` `g:` `a:` `r:` `s:` `re:` `p:` `f:` `c:` typed first in All | Narrow to Needs you, Go to, Agents, Runs, Sessions, Records, Projects, Files, Commands. A `\` or `/` right after the colon keeps it as text, so a pasted `c:\path` stays a query |
| `@` `/` `#` `>` typed first in All | Jump to Agents, Sessions, Projects, Commands (the older sigils) |
| `→` with the caret at the end of the query | Open the selected row's actions (a run, agent, session, record, initiative or project). Mid-query, `→` moves the caret |
| `←` or `Backspace` on an empty action filter | Leave an action's input, then the action list, back to the results with the query and selection as they were |
| `1`…`9` in Needs you | Answer the selected ask with that option, in place |
| `Mod`+`Enter` | The selected row's alternate action, named in the footer. On the goal block, open an orchestrator run instead of a Quick one |
| `Backspace` on an empty query | Leave a picker, then drop back to All |
| `path:123` in Files | Open the file at that line; a bare `:123` on Code moves the open file |

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
| `Esc` | On a deep surface (Jarvis, Radar, Files, Usage, Code), return to the Cockpit. In a composer or text field, leave Type posture first. |

## The avatar popup (what's waiting)

Click the creature on the footer, or press `Mod`+`G` `w`, to open it.

| Keys | Action |
|---|---|
| `j` / `k` (or `↓` / `↑`) | Move between the waiting rows |
| `Enter` | The focused row's button: approve, retry, acknowledge, land again, or open |
| `1`…`9` | Answer the focused row's question with that option (a one-question, single-pick ask) |
| `Space` | Peek where the focused row's Open would go |
| `/` | Ask Jarvis (the composer at the bottom) |
| `Esc` | Close |

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

### Agent

| Keys | Action |
|---|---|
| `j` / `k` (or `↓` / `↑`, `→` / `←`) | Next / previous agent |
| `d` | Toggle the agent rail |
| `f` | Toggle terminal fullscreen |
| `Shift`+`F` | Toggle float: the window shrinks to the focused terminal, and its pin keeps it on top of other apps |
| `r` | Review: open the focused lead's Spec review or Plan review dialog, or show the focused agent's Doc review in place of its terminal |
| `Esc` | Back to Cockpit, or exit fullscreen first; from Conversation History or a session transcript, back to the terminal |
| `Shift`+`Esc` | Return focus to the nav (from inside the terminal) |
| `←` / `→` / `Home` / `End` | Move between the panel's tabs (Overview, Files, File) while its tab strip has focus; the agent keys stand down there |
| `↑` / `↓`, `←` / `→`, `Enter` | In the panel's Files tab: move the cursor, collapse / expand a folder, open a folder or open a file in the File tab |
| `Esc` | In the panel's File tab: cancel the comment being written, else close the file |
| `c` | In the File tab's Preview of a markdown file, comment on the selected text |
| `Mod`+`Enter` | In the File tab: add the comment being written; outside a comment box, send the comments to the agent |

### Agent: Conversation History

Opened with `Mod`+`G` `s` or the sidebar's Conversation History button. History and an ended session's transcript cover the terminal, so the keys
that act on the focused agent stand down while either is open: `j` / `k`, the arrows, `d`, `f`, `r`, `c`, the canvas and review keys, `F11`,
`Mod`+`Enter` (send marks, send review) and the `Esc` that goes back to the Cockpit. In History `j` / `k` (or `↓` / `↑`) move the list cursor,
`Enter` jumps to a live session or resumes an ended one, and `Esc` returns to the terminal. `Ctrl`+`Tab` still cycles agents and brings the
terminal back. An ended session opened from the sidebar covers the terminal the same way, and `Esc` leaves it.

### Agent: terminal grid

Open a split by dragging a live agent from the tree onto a terminal (up to four cells), or by right-clicking its row and
picking **Open in split**. From the keyboard it is in the palette: `Mod`+`P`, the agent, `→`, **Open in split**. A split
needs an agent with no cell yet and a grid with room; otherwise the menu item is disabled and the palette action just
opens the agent.

Once there are two cells, each has a bar you can drag to rearrange it; the `×` on it takes the agent out of the grid and
leaves it running. The header and the details rail follow the focused cell; click a cell to focus it.

Moving between agents with the keyboard follows one rule: if the agent already has a cell, that cell takes focus;
otherwise the agent replaces the focused cell and the others stay put. So stepping through more agents than there are
cells keeps changing which of them show.

An agent asking a question in its terminal (Claude Code's picker) takes the keyboard: choose it by any route, or have
the chosen agent start asking, and typing moves into its terminal, so `↑` / `↓`, `Enter` and the digits answer the
picker instead of moving through the list. `Shift`+`Esc` goes back to the list.

| Keys | Action |
|---|---|
| `Ctrl`+`Tab` | Next agent, by the rule above. Works from inside a terminal, and pressed there, typing follows to the new agent's terminal |
| `Ctrl`+`Shift`+`Tab` | Next asking agent, by the rule above |
| `Alt`+`1`…`9` | The nth agent of the Active list, top to bottom (the split's agents first). Hold `Alt` a moment and each row shows its number. Works from inside a terminal, where typing follows as with `Ctrl`+`Tab` |
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
| `Alt`+`C` | Switch Terminal → Canvas → Review, skipping the ones the agent doesn't have. Works from inside the terminal, where a bare `c` is typed into it |
| `Alt`+`W` | Close the agent whose header shows **Done — Close** (its last turn committed and you have read it). Works from inside the terminal; when the header offers no Done, the key goes to the terminal |
| `[` / `]` | Previous / next board |
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

### Code

| Keys | Action |
|---|---|
| `Alt`+`Z` | Toggle word wrap for the open file, also while typing in it. Prose (`.tex`, `.bib`, `.md`, `.txt`) wraps by default; code follows `editor:wordwrap` |
| `Mod`+`\` | Open the file in a read-only side column (a `.tex` file on its PDF, a document on its preview), or close the side column. Dragging a file from the tree onto the right half of the editor does the same for that file |
| `d` | Toggle the diff against HEAD |
| `r` | Refresh the file index |
| `Alt`+`←` / `Alt`+`→` | Back / forward through opened files |
| `Mod`+`S` | Save the open file |

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
| Search → Commands → "Keyboard shortcuts" | Open the cheat sheet while typing |

---

*Not yet configurable.* Bindings are fixed in v1. User-remappable shortcuts
(`keybindings.json`) are a deferred enhancement — see the design spec.
