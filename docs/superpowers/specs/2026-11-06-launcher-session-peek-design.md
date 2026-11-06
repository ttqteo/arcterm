# New agent: Quick look a Claude session

In the New agent dialog, picking a Claude Code session in the Session column tells you only its title and age. To
see where the conversation stood, you have to Open asleep: that makes a tab on the roster with the whole transcript
and closes the dialog. That is too heavy when all you want is a glance before you choose Resume. This spec adds
**Quick look**: a panel inside the dialog that shows the session's last 5 messages and loads at once.

Prototype: `.superpowers/design/launcher-session-peek/project/A2-under-columns.dc.html`.

## What exists today

- The project Overview has a Quick look (`frontend/app/view/agents/sessionpeek.tsx`): a 920px dialog that draws the
  whole `SessionBody`. It stays as it is.
- The Session column (`launcherresumelist.tsx`) shows one line per session: its title and age. Spec
  `2026-10-28-new-launcher-declutter-design.md` D5 rejected a preview panel and any transcript read in the dialog.
  This spec narrows D5: the dialog reads a transcript only when the person opens Quick look. Edit D5 to say so.
- Open asleep is `launchAgentRow(p, true)` in `launchermodal.tsx`. It opens a tab with `agent:sleeping` set and
  closes the dialog.
- The existing tail read is slow for this. `readTranscriptSlice` (`pkg/wshrpc/wshserver/transcript.go`) loads the
  whole file into memory, then cuts its last N lines. We measured the largest arcterm transcript: 52 MB and 5,317
  lines. Its last 300 lines are 5.4 MB and hold only 5 prompts and 9 replies, because each tool result is one long
  line. Its last 60 lines are already 1 MB. Getting 5 messages through `GetAgentTranscriptCommand` would read 52 MB
  and send about 5 MB over the websocket to be parsed in the frontend. That is half a second or more.
- `pkg/agentsessions` already parses Claude's JSONL in Go. `claudeLine` carries `isMeta`, `isSidechain` and
  `origin`. `humanprompts.go` has `sentByPerson` and the rules for which user records are real prompts (it leaves
  out tool output, skill bodies, slash commands, command output, task notices, interruptions, the compaction
  summary, and `wsh agents send` messages).

## The resume step (revised 2026-11-06)

Used, the panel under the columns was too small: on a 1280×716 window the dialog already sat at its 86vh cap, so the
panel shrank to about two messages. The person chose to read the session where the columns were instead (canvas
`launcher-quick-look`, board `A-two-steps`). This replaces D2, D3, D5 and D6; D1, D4, D7 and D8 stand.

- For Claude Code, once a past session is picked (`resumeStepShows` in `launcherpeek.ts`), the dialog shows the resume
  step: the Task box on top, the Session list (272px) on the left and the picked session's read on the right, about as
  tall as the columns' band, so a step switch leaves the dialog's height alone. New session keeps the three columns, so
  a fresh launch looks as it always did (the person's call after trying the first build); picking New session from
  the step's list brings them back, with focus on that row.
- The read follows the pick at once, no button. Your messages are drawn in the transcript's box and Claude's as
  rendered markdown (`MarkdownMessage`), the way the compact transcript draws them; a new answer fades in
  (`MOTION.durMicro`).
- The agent and the project sit in the title as two small buttons. A click on either, or `←` from the Session list, goes
  back to the three columns to change them; working in the Start or Project column keeps the columns, and focus
  reaching the Session column again (`→`, `Tab`, a click) returns to the step.
- Esc closes the dialog at once, and Shift+Enter is Open asleep again, in the footer: the read is not a panel to close
  or toggle.

## Decisions

### D1. Only Claude Code

Quick look is offered only when the picked agent is Claude Code and a session is picked. Pi and Antigravity keep
Open asleep in the footer, and Codex keeps its Transcript button, exactly as today.

### D2. The footer's second button becomes Quick look

For a Claude session, the footer's second button is **Quick look** (`shift+enter`), in place of Open asleep. It
toggles the panel and shows as pressed while the panel is open. Open asleep moves to the panel's header, beside
the session's title.

### D3. The panel sits under the columns

The panel sits inside the New agent dialog, between the three columns and the footer, and spans the dialog's
width. Opening it only pushes the footer down, once. The Task box and the columns never move. An earlier popup
design was dropped because it covered the Session column. Putting the panel above the Task box was dropped
because the dialog is anchored at the top (`ModalShell` `align="top"`), so the panel would push the Task box and
every column down by about 230px.

The panel's header has an eye icon, the session's title, a meta line (`<age> ago · <model> · <branch> · <tokens>`,
from `SessionInfo`), Open asleep and a close button.

### D4. Five messages, words only

The panel shows the session's last 5 messages, yours and Claude's, oldest at the top and newest at the bottom.
Each message has a label ("You", or "Claude" in the accent color) beside its text. Tool calls and tool results are
left out entirely. So are records that are not the person's own words: `isMeta`, sidechain or non-human `origin`,
system reminders, and the other notices `humanprompts.go` already leaves out. Each Claude turn (everything between two
real prompts) gives one message: its last text-bearing, non-sidechain assistant record, which is the answer. The
narration between tool calls ("Let me check X.") is left out. This is the rule `LastAnswer` already uses
(`pkg/agentsessions/lastanswer.go`), applied per turn. Reading backwards, a turn is done as soon as its last text
record is found, so the reader skips the rest of that turn up to the prompt before it. (Builder question 1, answered
by the person.)

### D5. Fixed height, the app's scrollbar

The panel is a fixed ~170px high and scrolls inside, so moving between sessions never resizes it. Its scrollbar is
the app's shared one (`::-webkit-scrollbar` in `frontend/tailwindsetup.css`), the same as the Project and Session
columns, with no style of its own. Each time the panel opens or switches session, it starts scrolled to the newest
message. When the window is short (the dialog's `max-h-[86vh]`), the panel shrinks, to about two messages at
least, rather than squeeze the columns.

### D6. Keys

- `shift+enter`, or the footer button, opens and closes the panel. In the Task box, Shift+Enter stays a new line,
  as it is today with Open asleep.
- While the panel is open, ↑↓ in the Session column moves between sessions as today, and the panel follows the
  picked session.
- Esc closes the panel first. A second Esc closes the dialog.
- Enter still resumes the session (Resume agent).
- Picking New session, or another agent or project, closes the panel.

### D7. A new backward reader, kept light on RAM

Add one wshrpc command (in `pkg/wshrpc/wshrpctypes_agents.go`, implemented in `pkg/agentsessions`) that takes a
Claude transcript path and a count (5). It answers with at most that many messages, each `{ role: "user" |
"assistant", text, ts }`, oldest first, already stripped to plain text in Go. It reads only Claude's JSONL.

- It reads the file backwards from its end in 64 KB chunks and stops once it has the messages it needs. It never
  loads the whole file. At any moment it holds one chunk plus the messages' text.
- It skips any line longer than 256 KB without parsing it. Such a line is nearly always a tool result, which is
  left out anyway.
- It scans at most ~8 MB from the end. If it finds fewer messages than asked for, it returns what it found. The
  reply carries `capped: true` when the scan stopped at the cap before reaching the file's start, so the panel can
  tell "no messages in what was read" apart from "no messages at all" (D8). (Agent's call, builder question 2.)
- An unterminated last line (a session still writing) is ignored.
- Each message is clipped at ~1,500 characters, ending in "…".
- Run `task generate` after adding the type.

In the frontend:

- The panel reads only after the pick has been still for ~150 ms. A read that is overtaken is dropped, so holding
  ↓ across nine sessions reads once or twice.
- Results are cached by transcript path + `lastactivets`, a few KB each, at most ~20 entries. The cache is dropped
  when the dialog closes.
- Nothing runs in the background, and nothing lives on after the panel closes.

### D8. States

- **Loading:** the header shows at once. The message area stays empty for ~150 ms, then shows "Reading…", so a
  fast read never flashes.
- **Fewer than 5 messages:** show what there is. **None:** "This session has no messages yet."
- **Capped** (`capped: true`; Agent's call, builder question 2): with none found, "No messages in the last 8 MB.
  Open asleep to read the whole session."; with fewer than 5 found, the same note sits as a muted line above the
  oldest message shown.
- **Read error** (file gone, no permission): one line with the real error, in the panel. Resume and Open asleep
  still work.
- **Text:** plain text that keeps its line breaks. Code fences are drawn monospace. Markdown is not rendered.

## Testing

- Go: the backward reader. Cover a line far over 256 KB, a file smaller than one chunk, a message that spans a
  chunk boundary, an unterminated last line, the 8 MB cap, meta and sidechain records, and tool-only turns.
- vitest: a pure model for the panel (`launcherpeek.ts`, or similar): when it is offered (Claude, a session picked),
  the Esc order, the debounce and drop of overtaken reads, and the cache key and limit.
- CDP: a scenario in `scripts/cdp/scenarios.mjs` that opens New agent, picks a Claude session, opens Quick look,
  presses ↓ and shows the panel following the new session.
- Measure wavesrv's RAM while holding ↓ through a long session list, and log it under "(arcterm) RAM watch" in
  `docs/open-issues.md`.

## Docs

- One `CHANGELOG.md` line under Added, for example: "New agent: Quick look shows a Claude session's last 5 messages
  before you resume it (Shift+Enter)."
- Narrow D5 in `2026-10-28-new-launcher-declutter-design.md` as described above.
- `docs/keyboard-shortcuts.md`: Shift+Enter in New agent is Quick look for a Claude session.
