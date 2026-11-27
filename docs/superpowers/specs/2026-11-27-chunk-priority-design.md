# Chunk priority

Status: design, 2026-11-27. Brainstorm: `.superpowers/brainstorm/chunk-priority/brainstorm.json`.
Prototype: `.superpowers/design/chunk-priority/project/A-word-chip.dc.html`.

## Intent

An initiative's chunk gets a priority. It is a label on the chunk card and in `wsh effort show`, and it decides the
order of work: `advance` opens the open chunk with the highest priority, and among chunks of the same priority the
one that comes first. Every place that names the next chunk follows the same rule. A chunk's position and number do
not change, and Needs you gains no entries.

Today position is the only way to say which chunk comes first. `wsh effort chunk move` changes a chunk's position,
which also changes its number, so notes and answers that cite "chunk 11" then point at the wrong chunk.

## What exists

- `EffortChunk` (`pkg/waveobj/wtype.go:947`) holds Label, Status, Stage, Owner, Due, BaseCommit, WorkRefs, Notes,
  UpdatedTs. It has no priority.
- `advance` (`pkg/jarvis/effortops.go:512`) marks the active chunk done, then activates the first chunk by position
  whose status is pending, blocked or deferred.
- The frontend has its own copy of that rule. `nextChunk` (`frontend/app/view/jarvis/effortmodel.ts:175`) returns the
  active chunk, or else the first by position that is not done, skipped or proposed. `inlinetracker.ts:107` uses it
  to raise the next chunk's row and mark it with an accent → and the status word "next". `effortmodel.ts:224` uses it
  too.
- `due` is the nearest pattern for a new chunk field: op `setChunkDue` (`pkg/jarvis/effortops.go:221`, `:443`),
  `EffortOp.Due` (`pkg/wshrpc/wshrpctypes_effort.go:136`), the command `wsh effort chunk due`
  (`cmd/wsh/cmd/wshcmd-effort.go:456`), `--due` on `chunk add`, `dueSuffix` in `show` (`:625`, `:683`), and
  `chunkDueChip` on the row (`inlinetracker.ts:168`, `inlinetrackerview.tsx:375`).
- The chunk row's menu (`inlinetrackerview.tsx:484`) has Status, Rename, Move up/down, Move to stage and Delete chunk.

## Design

### Scale

Five levels, lowest to highest: `information`, `low`, `medium`, `high`, `critical`. The field is a string on
`EffortChunk` (`priority`, omitempty). It is `""` when no one has set it, and the server refuses any other value.

- **Unset chunks:** a chunk with no priority ranks as `medium` when the next chunk is picked. It shows no badge. Old
  chunks keep their order, and setting `low` or `high` on one chunk moves it down or up as the names say.
- **Information:** the lowest level, not an exception. `advance` still opens an `information` chunk, after every
  other open chunk. Work that is not to be done keeps using `deferred` or `skipped`.

### Which chunk is next

`advance` in Go and `nextChunk` in the frontend use one rule:

1. The active chunk, if there is one. `advance` never takes the active slot from a chunk: priority only decides which
   chunk opens next.
2. Otherwise, among `pending` chunks, the one with the highest rank: critical > high > medium = unset > low >
   information.
3. Only when no chunk is pending: among `blocked` and `deferred` chunks, the one with the highest rank (builder
   question 3, answered). This changes today's behavior, where a blocked chunk at position 2 opens before a pending
   chunk at position 5: ready work now opens before parked work.
4. Among chunks with the same rank, the one that comes first by position.

A chunk's position, its number and the order of rows on the card do not change. The "next" arrow points at the chunk
`advance` will open.

Builder question 1, answered: every other place that names the next chunk follows this rule too:

- the summary's `ActiveChunk` (`pkg/jarvisstate/jarvisstate.go:315-327`), which `wsh effort list`
  (`cmd/wsh/cmd/wshcmd-effort.go:125`) and the Brief's effort card ("· active: X", `effortmodel.ts:84`) print;
- the Agent surface's initiative band and popover, `nextChunks` (`frontend/app/view/agents/initiativepopovermodel.ts:33`,
  used at `initiativeband.ts:86`), which lists the next chunks in the order of work;
- Chat's "go on with: <chunk>" chip (`frontend/app/view/agents/chatsuggest.ts:316`);
- DUM-E's queue (`pkg/dume/chunks.go:115`, `Summary.Waiting`, whose first entry is next).

`EffortChunkSummary` (`pkg/wshrpc/wshrpctypes_effort.go:247`) gains `priority` so the frontend sites can rank. Each
site gets a test over the shared cases.

Agent's call (builder question 4): the next chunk is always visible on the card. A folded plan (more than 10 chunks)
or folded stage (all done) shows its first 10 chunks and "+N more" (`inlinetracker.ts:55-62`, `:122-133`). When the
next chunk is past that cut, its row shows just before "+N more". Both sides keep the same rank table. Agent's call: the rank lives in one small function per
side, with a test on each side over the same cases, so the two cannot drift.

### Setting it

- `wsh effort chunk priority <effort> <chunk> <critical|high|medium|low|information|"">`. `""` clears it.
- `wsh effort chunk add … --priority <level>`.
- Each change writes a note on the chunk's trail (`priority: high`, `priority cleared`), as a due change does.
- In the cockpit, the chunk row's menu gains a Priority section: the five levels with the current one ticked, then
  "No priority". This matches the prototype.

### Badge on the row

Board: `A-word-chip.dc.html`. A chunk with a priority shows the level's name as a word at 10.5px, after any due chip
and before the notes count, in the same style as the due chip. Colors come from theme tokens:

| Level | Style |
|---|---|
| critical | `text-error`, semibold |
| high | `text-ink-hi`, semibold |
| medium (set by hand) | `text-ink-mid` |
| low | `text-muted` |
| information | `text-ink-faint` |

A chunk with no priority shows no word.

### `wsh effort show`

Agent's call (builder question 2): `show` keeps today's layout, in position order with its `-- stage --` headers
(`wshcmd-effort.go:613-620`), because re-sorting the lines would split the stage runs that agents read. The level's
name is printed beside the label (as `dueSuffix` does for due), the next chunk is marked, and a line under the title
lists the open chunks' numbers in the order of work: `Order of work: 11, 21, 17, 23, 22`.

## Left to the builder

- The op's name (`setChunkPriority`, next to `setChunkDue`) and where it sits in `pkg/jarvis/effortops.go`.
- Run `task generate` after adding the field to `EffortChunk` and `EffortOp`. Never hand-edit the generated files.
- Whether Priority is a section in the chunk menu or a submenu. A keyboard shortcut is optional; if one is added,
  update `docs/keyboard-shortcuts.md`.

## Testing

- Go (`pkg/jarvis/effortops_test.go`): `advance` opens by priority, then by position. A pending chunk opens before
  any blocked or deferred chunk, whatever their levels. `advance` keeps an active chunk.
  An unset chunk ranks as medium. `information` opens last. An invalid level is refused. A change writes a trail note.
- Go (`cmd/wsh/cmd/wshcmd-effort_test.go`): `show`'s Order of work line, the next mark and the level suffix.
- Go: `ActiveChunk` in `pkg/jarvisstate` and DUM-E's `Waiting` order in `pkg/dume` follow the rule.
- Vitest: `nextChunks` (`initiativepopovermodel.test.ts`) and the Chat chip (`chatsuggest.test.ts`) follow the rule.
- Vitest (`inlinetracker.test.ts`): a folded plan whose next chunk is past the first 10 shows that chunk's row.
- Vitest (`effortmodel.test.ts`, `inlinetracker.test.ts`): `nextChunk` over the same cases as the Go test, and the
  badge text and tone per level.
- CDP: a scenario that draws an initiative card with chunks of several levels, the badges, the "next" arrow on the
  highest-ranked chunk, and the Priority menu open. It is checked against `A-word-chip.dc.html`.
- `CHANGELOG.md`: one line under Added (a user opens it to try it, so `<!-- big -->` with its shot).

## Builder's calls

Made by the lead of the autonomous run (2026-11-27), each with why.

1. **One rule per side, in a leaf place.** Go: `pkg/waveobj/chunkorder.go` (`ChunkPriorities`, `ValidChunkPriority`,
   `ChunkRank`, `ChunkOrderOfWork`, `NextChunkIndex`). `pkg/waveobj` because `pkg/dume` imports only `waveobj`, and
   `pkg/jarvis`, `pkg/jarvisstate` and `cmd/wsh` all import it already: one Go copy, no new import edge. Frontend:
   `frontend/app/view/jarvis/chunkorder.ts` (`CHUNK_PRIORITIES`, `chunkRank`, `orderOfWork`, `priorityBadge`).
2. **One table of cases for both sides.** `pkg/waveobj/testdata/chunkorder-cases.json` lists chunk lists (status and
   priority) and the expected order of work. The Go test and the vitest both read it, so the two rules are checked
   against the same cases and cannot drift without a test failing.
3. **Order of work** is: the active chunk (if any), then pending chunks by rank (ties by position), then blocked and
   deferred chunks by rank (ties by position). Done, skipped and proposed chunks are not in it. The next chunk is its
   first entry. This is the spec's rule written as one list, so `show`'s "Order of work" line, the popover's
   `nextChunks` and DUM-E's queue read the same list.
4. **`nextChunks(effort, label, limit)`** (band and popover) keeps its signature and now returns the pending chunks in
   order of work, leaving out `label`. "After `label` in plan order" no longer says what comes next once priority
   reorders work.
5. **Chat's "go on with" chip** names the first chunk in order of work that is active or pending and that no other agent
   or run holds, leaving out the chunks this agent held. It no longer looks only past this agent's last chunk by
   position, for the same reason.
6. **DUM-E's `Waiting`**: within one initiative, its waiting (pending) chunks come in order of work; initiatives keep
   their order.
7. **The op** is `setChunkPriority` with `EffortOp.Priority` (`""` clears), validated next to `setChunkDue` in
   `effortops.go`. Its trail note is `priority: <level>` or `priority cleared`. `addChunk` takes `Priority` too and, like
   `Due` on add, writes no separate note. An invalid level is `EC-INVALID-PRIORITY`.
8. **Vault merge** (`pkg/wavevault/effortmerge.go`) picks `Priority` with `pickField` like `Due`, so a synced edit is
   not lost.
9. **The menu** gets a section, not a submenu: `MenuHead` "Priority", the five levels highest first with the current one
   ticked (`active`), then "No priority" (ticked when unset), after Move up/down. A section is what the prototype draws
   and what the Status section already does. No keyboard shortcut.
10. **`show`** prints the level as ` (priority high)` after the due suffix, marks the next chunk with ` ← next` at the
    end of its line, and prints `Order of work: …` (1-based positions) under the title only when a chunk is open.
