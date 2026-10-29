# Transcript tab on the agent rail

Status: design, from the brainstorm `.superpowers/brainstorm/rail-transcript-tab/brainstorm.json` (2026-10-29).

## Intent

After a compaction (and every wake from sleep, which compacts first), Claude Code's TUI shows only what came after the
compaction. The person needs to read back the earlier conversation to catch up, while the live terminal stays usable
beside it.

## What runs today

- The live stream (`frontend/app/view/agents/livetranscript.ts`) tails 300 lines (`STREAM_TAIL_LINES`) and keeps at
  most 4,000 (`MAX_RETAINED_LINES`); wavesrv's `transcriptTailer` (`pkg/wshrpc/wshserver/transcript.go`) sends only the
  lines appended since its last read.
- The one-shot read (`useTranscriptRead`, `frontend/app/view/agents/transcriptread.ts`), behind Conversation History's
  session view and the sleeping overlay (`sleepingtranscript.tsx`), tails 2,000 JSONL lines for every runtime but pi,
  which reads the whole file (`maxlines: -1`). A long compacted session can lose its pre-compaction part there.
- `GetAgentTranscriptCommand` (`CommandGetAgentTranscriptData`: `path`, `maxlines`, `fromstart`) reads the whole file on
  wavesrv and returns its tail or its head; it cannot return lines from the middle.
- Real Claude transcripts on this machine reach 55-64 MB (the largest 7,004 lines), with base64 images and large tool
  results.
- `CompactTranscript` (`compacttranscript.tsx`) keeps only its last 200 items in the DOM (`RENDER_CAP`) and drops the
  rest, so scrolling up stops there.
- The rail's tabs are overview, tree (Files), changes and file (`agentrailtabs.ts` `visibleTabs` / `panelFor`); Files
  gives way while a subagent's interior is open (`hasTree` false). File opens wide: `RAIL_WIDE_DEFAULT_PX` 520,
  `RAIL_WIDE_MIN_PX` 360, against `RAIL_OVERVIEW_PX` 300.
- A session that sleeps is compacted first when its cache is still warm (`pkg/agentsleep/compact.go`), so every wake
  lands on a compacted TUI. The JSONL keeps the whole conversation; `claude --resume` loads only from the
  `compact_boundary` on.
- The projection already turns a compaction into a `compaction` entry drawn by `CompactionDivider`, with the readable
  summary (`transcriptprojection.ts`, `compactSummaryText`).
- `Mod:Shift:f` is bound only on the Code surface (`code:search`, `frontend/app/store/keybindings/bindings.ts`); it is
  free on Agent.

## Design

### Where it lives

A **Transcript** tab on the Agent surface's right rail, so the conversation reads beside the live terminal rather than
over it.

### When the tab shows

The Transcript tab is always on the rail strip (Overview, Files, Changes, Transcript) for an agent whose transcript path
is known, compacted or not. An agent with no known transcript path has no Transcript tab.

Agent's call: the tab is keyed to the focused agent's own `transcriptPath`, not to what the rail is scoped to. While a
subagent's interior is open on the rail, Transcript stays on the strip and keeps showing the parent's conversation.

### How wide it opens

On the Transcript tab the rail opens at the wide width the File tab uses (520px by default, 360px minimum, resizable
with the same grip), and shares that remembered width with File.

### How the tab reads the conversation

The tab never reads the whole file at once (builder question 2). It reads only the recent part first (the last few
thousand lines, as Conversation History does) with `GetAgentTranscriptCommand`, and projects it in the frontend with the
runtime's projector (`projectorFor`). Scrolling to the top loads the chunk of lines before the ones it has, and so on
back to the start (lazy load), so the loaded and the drawn range grow together. `CommandGetAgentTranscriptData` gains a
way to ask for the lines before a given line (a small Go change in `pkg/wshrpc/wshrpctypes_agents.go` and
`pkg/wshrpc/wshserver/transcript.go`, then `task generate`). A pi session still needs its whole file for the
parent-linked active branch and keeps `maxlines: -1`.

### What the tab shows

The tab draws the conversation with `CompactTranscript`, as the sleeping overlay and Conversation History do: the
person's prompt in a box, the agent's prose, one folded "Worked for" line per stretch of tool calls, the compaction
markers with their summary, and the files-changed bar.

Scrolling to the top of the tab draws the previous 200 items (`RENDER_CAP`), loading the earlier chunk when the drawn
range reaches the loaded one, and so on back to the start of the conversation (builder question 1), keeping the item
that was at the top in place. The draw-earlier step lives in `CompactTranscript`, so Conversation History and the
sleeping overlay gain it too (over the lines they already read).

### No search

The tab has no search (builder question 3). Catching up is reading back: scrolling to the top loads earlier chunks, and
the Compactions control loads back to each compaction marker. Finding one exact sentence from before the compaction
means scrolling to it.

### Jump to a compaction

At the top of the tab, a **Compactions** control scrolls to a compaction marker, the newest first, stepping back through
earlier ones on each press. It shows when the loaded part has a compaction, or when the loaded part does not start at
the file's start (an earlier one may exist). A marker not loaded yet is reached by loading earlier chunks until it
appears; when the start of the file is reached with no further marker, the control says there are no earlier
compactions. The marker already shows the readable summary (`CompactionDivider`).

### Keyboard

`Mod+Shift+F` on the Agent surface opens the rail on the Transcript tab and moves focus into the conversation (so PgUp
and PgDn scroll it), from anywhere on Agent, the terminal included. Esc in the tab returns focus to the terminal. The
binding goes into `bindings.ts` (`buildAgentBindings`) and `docs/keyboard-shortcuts.md`.

### While the agent works

While the agent works, the tab appends the lines the agent writes after the ones it has (the live transcript stream,
`livetranscript.ts` over wavesrv's `transcriptTailer`, already delivers them), at most once every few seconds, and only
while the tab is shown (rail open, Transcript tab selected). It never re-reads the whole file. Your scroll position stays
put unless you are at the bottom, where the view follows the newest turn.

## Left to the builder

- The append interval (a few seconds), how it is paused while the tab is hidden or the rail closed, and how the
  projection takes appended lines (re-projecting the loaded lines, or a projector that appends).
- The chunk size of a lazy load, and how a tool call and its result that straddle a chunk edge are joined.
- How the Compactions control learns whether an earlier compaction exists before loading back.
- Measure the RAM the tab holds on a long session (the recent part, then after loading back to the start), and log it
  under "RAM watch" in `docs/open-issues.md`.
- A CDP scenario in `scripts/cdp/scenarios.mjs` that opens the tab on a compacted fixture, scrolls to the top to load an
  earlier chunk, and steps to a compaction marker before the loaded part.
- A `CHANGELOG.md` line under Added, with the `<!-- try: ... -->` hook for the new binding.
- A `- [ ]` line under "0 · Waiting on a hand check" in `docs/open-issues.md` for anything not tried in the running app.

## Out of scope

- Searching the conversation (dropped, builder question 3).
- Changing how much Conversation History or the sleeping overlay read (still a 2,000-line tail).
- Showing a session's subagent (sidechain) turns.
