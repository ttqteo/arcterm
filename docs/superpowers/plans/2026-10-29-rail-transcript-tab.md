# Transcript tab on the agent rail

**Spec:** `docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs rail-transcript-tab agent-rail-tabs surface-smoke`

Shape: four tasks run side by side from the start — Task 1 (the Go read: a slice by line index, and an append from a
byte offset), Task 2 (`CompactTranscript` draws earlier items and scrolls to an entry), Task 3 (the tab on the rail
strip, its width and the keyboard binding, with a placeholder body) and Task 4 (the tab's pure model). Task 5 builds the
tab's body on all four, then the CDP scenario and the docs.

While iterating on a scenario in a task, run it with `task verify:ui -- <name>` against one dev app; the run's Final
runs `final-verify.mjs` once on the merged result.

Decisions the plan makes beyond the spec (its "Left to the builder"):

- **Line indices for loading back.** wavesrv numbers a transcript's non-empty lines from 0 (`readTranscriptLines`
  already drops the empty ones). The file is append-only JSONL, so an index stays valid while the session grows. A
  tail, head or `before` answer says where its lines start and how many the file holds. These reads still read the
  whole file on wavesrv and slice it (they happen on open and on scrolling up, not on a timer); the frontend never holds
  it all at once.
- **Byte offsets for appends** (the person's call, so appends never re-read the whole file). Every answer carries `end`,
  the byte offset just past the last newline-terminated line it read. An append sends `frombyte: <end>`; wavesrv seeks
  there and reads only the bytes after it, returning the complete lines in them and the new `end`. A file now shorter
  than `frombyte` (replaced) answers `reset: true` with no lines, and the tab reads the tail again. A tail read whose last
  line has no newline yet says `partial: true`; the tab drops that line and gets it whole from the next append.
- **Chunk size.** The first read is the last 2,000 lines (as Conversation History); each earlier load is the 2,000 lines
  before the first loaded one. Pi keeps `maxlines: -1` (the whole file, starting at 0), so it never loads earlier.
- **A tool call and its result across a chunk edge** are joined by re-projecting the whole loaded line array
  (`projectorFor(runtime, path).project(lines)`) after every load or append, never projecting a chunk alone.
- **Appends only while the tab is seen.** The tab starts the live stream (`startTranscriptStream`, as
  `useTranscriptRead` does) and reads appends only while the Agent surface is the shown one (`surfaceAtom === "agent"`:
  the Agent surface stays mounted while hidden), the rail is open and Transcript is the shown tab. Each activity stamp
  from the stream triggers an append read at most once every 3 seconds, with a trailing read for the last stamp.
- **Compactions control.** It learns nothing ahead of time: it shows when the projected entries hold a `compaction`
  entry or the loaded lines do not start at 0. Each press steps to the next older compaction marker than the last one it
  showed (the newest first); when none older is loaded and the start is not 0, it loads earlier chunks until one appears
  or the start is reached, and at the start with none left it says "No earlier compactions".
- **Fold state across a load.** Loading an earlier chunk shifts every entry's index. The tab passes `CompactTranscript`
  a `keyOffset` (how many entries the loads have put in front so far) so an item's key and its opened fold stay with it.
- **No loading line.** An earlier chunk's items appear when the read lands; a failed read shows an error line.
- **The CHANGELOG line has no Try it hook** (the spec now says so): Try it takes only a global binding, and
  `Mod+Shift+F` is Agent's own.

### Task 1: read a transcript slice by line index, and appends from a byte offset
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/transcript.go`, `pkg/wshrpc/wshserver/transcript_test.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`

- `CommandGetAgentTranscriptData` gains `Before int` (json `before,omitempty`) and `FromByte int64` (json
  `frombyte,omitempty`).
  - `Before > 0`: the last `MaxLines` lines of `[0, Before)` (`MaxLines` 0 keeps the default 200); `Before` past the
    total clamps to it.
  - `FromByte > 0`: stat the file; if its size is below `FromByte`, answer `Reset: true` and no lines. Otherwise read
    only `[FromByte, size)`, return its complete (newline-terminated) non-empty lines and `End` past the last newline;
    an unterminated tail is left for the next read. `MaxLines` is ignored, and `Start`/`Total` are 0 (the caller numbers
    appended lines itself).
  - Setting more than one of `Before`, `FromByte`, `FromStart`, or a negative `Before`/`FromByte`, is an error naming it.
  - Neither set: today's tail or head read, same lines as now.
- `CommandGetAgentTranscriptRtnData` gains `Start int` (json `start`, the file index of `Lines[0]`), `Total int` (json
  `total`, the file's non-empty line count), `End int64` (json `end`, the byte offset past the last newline-terminated
  line in the file at this read), `Partial bool` (json `partial,omitempty`, the last line returned has no newline yet)
  and `Reset bool` (json `reset,omitempty`). Tail, head and `before` reads fill `Start`, `Total`, `End` and `Partial`.
- Keep one whole-file read for the line-index reads and slice it with a pure function tested alone; the byte-offset read
  is its own function that never reads before `FromByte`.
- Run `task generate` and commit the regenerated files (never hand-edit them). The frontend sends
  `{ path, maxlines }`, `{ path, maxlines, before }` or `{ path, frombyte }`.

Acceptance: `go test ./pkg/wshrpc/wshserver -run 'Transcript'` passes, with new tests named `TestTranscript*` covering:
a tail read's `start`/`total`/`end`; a file whose last line has no newline (`partial`, and `end` before it); `before` in
the middle, at 1, past the end; pi's `-1` returning `start` 0; `frombyte` at `end` with nothing new, with two new lines,
with a half-written line (left out, `end` before it), and on a file shorter than `frombyte` (`reset`); the clash and
negative errors. `task generate` leaves no diff once committed.

### Task 2: `CompactTranscript` draws earlier items and scrolls to an entry
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/compacttranscript.tsx`, `frontend/app/view/agents/compactwindow.ts`, `frontend/app/view/agents/compactwindow.test.ts`

Today it keeps the last `RENDER_CAP` (200) items and drops the rest. It gains, as props Task 5 relies on, all optional so
Conversation History and the sleeping overlay need no change to gain the draw-earlier step:

- `onReachStart?: () => void` — called when every item is already drawn and the top of the list is in view (the caller
  loads an earlier chunk). Called once per item count: again only after the items grew and the top is in view again,
  never in a loop while nothing changed.
- `keyOffset?: number` — subtracted from an item's entry index for its React key and its fold state, so a load that puts
  entries in front keeps every drawn item mounted and its fold as it was. Default 0.
- `scrollTo?: { index: number; nonce: number }` — on each new `nonce`, draw back far enough to include the item holding
  entry `index`, then scroll it to the top of the scroll container. An index not in `entries` does nothing.

Behaviour: the drawn window counts from the end (`drawn`, starting at `RENDER_CAP`); when the top of the list is in view
and items are hidden above, `drawn` grows by `RENDER_CAP`, and the item that was at the top of the view stays where it
was (compensate `scrollTop` by the height added above, in a layout effect: the browser's own scroll anchoring does not
act at `scrollTop` 0). The top check re-runs when the items change, not only on scroll, since a sentinel that stays in
view fires no new intersection. New items at the end never undraw the ones being read. Add `data-compact-compaction` on
the element wrapping each `CompactionDivider` and `data-compact-item` on every top-level item.

Put the decisions in `compactwindow.ts` (pure): the first drawn item for `(itemCount, drawn)`; `drawn` after a grow; the
`drawn` needed to reach an item index; the key for `(index, keyOffset)`; and whether the top being in view should grow
the window, call `onReachStart`, or do nothing, given the item count `onReachStart` was last called at.

Acceptance: `npx vitest run frontend/app/view/agents/compactwindow.test.ts` covers the first-drawn index under, at and
over the cap; a grow at the start; reaching an item far back; stable keys across an offset; and `onReachStart` firing
once per item count (not again with the same count, again after a grow). Rendered proof is Task 5's scenario steps 2, 3,
4 and 6.

### Task 3: the Transcript tab on the rail strip, its width and Mod+Shift+F
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/agentrailtabs.ts`, `frontend/app/view/agents/agentrailtabs.test.ts`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/agentrailstore.ts`, `frontend/app/view/agents/railtranscript.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios.mjs`

- `RailTab` gains `"transcript"`. `visibleTabs(p, hasTree, hasTranscript)` puts it after Changes (before File's tabs)
  when `hasTranscript`; `shownTab` falls back to Overview for a stored Transcript with no transcript (as Files does with
  no tree); `selectTab`, `stripKeys`, `shownKey`, `selectKey` and every caller take the new flag. `hasTranscript` is the
  focused agent's own `transcriptPath` being set, not the rail's scope: with a subagent's interior open it stays true.
  `panelFor` never defaults to it.
- Width: `ResizableTab` becomes `"file" | "transcript"`, both with File's min and default, and both read and write the
  one remembered width (`railWideWidthAtom`, key `agent.rail.wideWidth`). On Transcript the rail is wide and shows the
  resize grip, as on File.
- The strip gets a Transcript tab (lucide `ScrollText`, aria-label `Transcript`) in `RailTabStrip` and in the collapsed
  strip's `stripTabs`; the body renders `<RailTranscript agent={agent} />` from the new `railtranscript.tsx`. Task 3
  writes that file as a placeholder (an empty panel with `data-rail-transcript`); its props are fixed here and Task 5
  fills the body without changing them:
  `export function RailTranscript({ agent }: { agent: AgentVM })`, reading `agent.transcriptPath`, `agent.agent` (the
  runtime that picks the projector, as `sleepingtranscript.tsx` passes it) and `agent.blockId`. (`AgentEntry` is the
  transcript-entry type `CompactTranscript` draws; it is never the agent.)
- `agentrailstore.ts` gains `railTranscriptFocusAtom` (a number) and `openRailTranscript(agentId)`: select the
  Transcript tab, open the rail (`railVisibleAtom`), and bump the atom. Task 5's body focuses its scroller on each bump.
- `buildAgentBindings` gains `agent:transcript` on `Mod:Shift:f` (label "Open the transcript"), calling
  `openRailTranscript` for the focused agent, and passing the key on when the focused agent has no transcript. It must
  fire with focus in the agent's terminal (see how `agent:toggle-rail` reaches past xterm). `docs/keyboard-shortcuts.md`
  lists it under Agent.
- Update `agent-rail-tabs` in `scripts/cdp/scenarios.mjs`: its fixture agent has a transcript, so the strip is now
  Overview, Files, Changes, Transcript, then File's tabs. Every tab-list assertion (steps 1, 2, 4, 5, 7) includes
  Transcript; step 5's arrow-key walk takes one more ArrowRight from Changes (asserting Transcript selected on the way)
  before File `a.txt`; step 7 (the collapsed strip) also clicks the Transcript icon and asserts the panel opens on
  Transcript at the wide width.

Acceptance: `npx vitest run frontend/app/view/agents/agentrailtabs.test.ts frontend/app/store/keybindings/bindings.test.ts`
covers Transcript's place in `visibleTabs` with and without a transcript and with no tree, the fallback in `shownTab`,
`selectTab` refusing it with no transcript, `stripKeys`, `clampWideWidth` for `"transcript"`, and `agent:transcript`
(id and keys `Mod:Shift:f`, passes with no transcript, active with terminal focus, calls `openRailTranscript`).
`task verify:ui -- agent-rail-tabs` passes with the steps above. The tab's own states are Task 5's steps 1 and 5.

### Task 4: the Transcript tab's pure model
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/railtranscriptmodel.ts`, `frontend/app/view/agents/railtranscriptmodel.test.ts`

Pure, on its own types (no wshrpc import), so it runs beside Tasks 1–3. Task 5 maps the RPC answer onto them.

- `LoadedWindow { lines: string[]; start: number; total: number; end: number }`.
- `firstWindow(answer)`: from a tail answer `{ lines, start, total, end, partial }`, dropping a partial last line.
- `prependChunk(w, answer)`: an earlier chunk in front; a chunk that does not end at `w.start` is a gap (returns
  "reread").
- `appendLines(w, answer)`: an append answer `{ lines, end, reset }` at the end; `reset` returns "reread".
- `keyOffsetAfter(prev, entriesBefore, entriesAfter)`: the new `keyOffset` after a prepend.
- `showsCompactions(entries, w)`, and `compactionStep(entries, lastShownIndex, atStart)`: the entry index to scroll to,
  `"load-earlier"`, or `"none-left"`, newest first.
- `appendThrottle`: given the last read time, whether one is in flight and now, read now, schedule a trailing read at a
  given time, or wait (3 s).
- `shouldStream({ surface, railOpen, shownTab })`: true only on the Agent surface with the rail open on Transcript.

Acceptance: `npx vitest run frontend/app/view/agents/railtranscriptmodel.test.ts` covers each function: the partial
drop, the prepend gap, the append reset, `keyOffset`, every Compactions step outcome (newest, older loaded, load-earlier,
none-left), the throttle's three outcomes, and `shouldStream` off another surface, with the rail closed, and on another
tab.

### Task 5: the Transcript tab's body, its scenario and the docs
**Depends on:** Task 1 (the `before`/`frombyte` read and its answer fields), Task 2 (`onReachStart`, `keyOffset`, `scrollTo`), Task 3, Task 4 (the loaded-window model, throttle and Compactions step)
**Model:** sonnet
**Files:** `frontend/app/view/agents/railtranscript.tsx`, `scripts/cdp/scenarios-rail-transcript.mjs`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

- `railtranscript.tsx` (props as Task 3 fixed them, `{ agent: AgentVM }`): the first read (`maxlines` 2,000, or -1 for
  pi), the projection over all loaded lines, `CompactTranscript` in a scroller (`tabIndex=0`, `data-rail-transcript`)
  with `onReachStart` loading the 2,000 lines before `start` (one load at a time; none once `start` is 0), the appends by
  `frombyte` as the decisions say, gated by `shouldStream` and `appendThrottle`, and the view following the bottom only
  while it is at the bottom. The Compactions control sits at the top (`data-rail-compactions`) and drives `scrollTo`
  through `compactionStep`, with "No earlier compactions" when it runs out. It focuses the scroller on each
  `railTranscriptFocusAtom` bump; Esc in it calls `focusTerm(agent.blockId)` (`frontend/app/view/term/termpaste.ts`). A
  failed read shows an error line in the tab (`data-rail-transcript-error`) saying the transcript could not be read,
  with the reason, and logs it; never an empty tab with no word.
- `scripts/cdp/scenarios-rail-transcript.mjs` exports `default function (kit)` returning `[scenario]`, as
  `scenarios-brainstorm-judge.mjs` does; `scenarios.mjs` registers it and passes in a kit the helpers it needs that are
  private there today (the fixture-roster writer, `openRailTerminal`, the saved-key teardown, `polishWaitFor`). Fixture:
  a generated Claude JSONL of more than 8,000 lines and about 50 MB (large tool results and base64 image blocks among
  them, so the RAM reading is for a long session), with two `compact_boundary` compactions, the older more than 4,000
  lines from the end, and enough turns that the first read holds more than 200 items. The fixture agent's `blockId` is a
  real terminal block opened with `openRailTerminal` (as `rwfRoster` in `scenarios.mjs` does), so focus can go to its
  xterm. Steps, each a shot:
  1. Select the agent; the strip shows Transcript; clicking it opens the rail at the remembered wide width (set it to a
     known value first, then check File opens at the same).
  2. Scroll the tab to the top: more items are drawn, and the item that was at the top keeps its position (within 2px).
  3. Open a "Worked for" fold, then keep scrolling to the top until an earlier chunk loads (the drawn conversation starts
     earlier than the first read); the fold is still open.
  4. Press Compactions: the newest marker is at the top; press again: an earlier chunk loads (the loaded start moves
     back) and the older marker is at the top; press again: "No earlier compactions".
  5. Focus the agent's terminal (`document.activeElement` is its `.xterm-helper-textarea`), press Mod+Shift+F: the rail
     is on Transcript and focus is inside `[data-rail-transcript]`; Esc: focus is in the xterm again.
  6. Copy the JSONL to `~/.claude/projects/verify-rail-transcript-<id>/<uuid>.jsonl` (as the History scenarios seed
     sessions) and open it in Conversation History's session view; scroll to the top: items are drawn past the first
     200. Teardown removes that folder.
  7. A second fixture agent whose `transcriptPath` names a missing file: Transcript shows the error line with the reason.
     A third with no `transcriptPath`: the strip has no Transcript.
  8. Append a turn to the fixture JSONL with the tab at the bottom: it shows within 5 s and the view follows; scroll up,
     append another: `scrollTop` holds (within 2px).
- `CHANGELOG.md`: one `Added` line under the top `Unreleased` section, for the user ("Read back a whole conversation
  beside the terminal: the Transcript tab on the agent's panel, Ctrl+Shift+F …"), no Try hook.
- `docs/open-issues.md`: measure the tab's RAM on the fixture (the renderer's JS heap through CDP after the first read,
  then after loading back to the start) and log both under "RAM watch"; add a `- [ ]` line under "0 · Waiting on a hand
  check" for a real compacted Claude session woken from sleep (a 55 MB+ transcript): read back to the start and note the
  RAM it then holds.

Acceptance: `task verify:ui -- rail-transcript-tab` passes steps 1–8.
