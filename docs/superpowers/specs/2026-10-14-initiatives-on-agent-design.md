# Initiatives on the Agent surface

The person spends nearly all their time on the Agent surface, and initiatives live one surface away, in Jarvis.
Four things they want from initiatives are built where they already are, instead of a new view inside Jarvis:
reviewing a plan an agent proposes, the initiative an agent works on without leaving it, a pass over what changed,
and parent and child initiatives. The Jarvis graph view designed first is deferred (`docs/deferred.md`, "Jarvis as
graph"); this spec takes its useful parts.

Mockup: `.superpowers/design/initiatives-on-agent/project/` (gitignored): `Main` (Plan to review on the rail,
interactive), `Popover`, `Unlinked`, `Review` (interactive), `ParentChild`, `Sprout`.

## Decisions

### 1. Proposed chunks: a plan the agent proposes and the person accepts

Backend, small:

- A chunk status `proposed`, added to `effortChunkStatuses` (`pkg/jarvis/effortops.go`) and the comment on
  `EffortChunk.Status` (`pkg/waveobj/wtype.go`).
- `wsh effort chunk add --proposed` creates the chunk as `proposed`. The `addChunk` op takes an optional status;
  only `proposed` is accepted there, and an empty one stays `pending`.
- A proposed chunk does not count toward progress: `done/total` (the summary, the List's bar, every count derived
  from it) leaves it out. `advance` and Work on never pick it as the active chunk.
- Reviewing uses the ops that exist: Accept is `setChunkStatus proposed → pending`, Rename is `renameChunk`, Drop is
  `removeChunk`. No new op.
- `pkg/jarvis/attention.go` builds a new attention kind `plan-review` beside `chunk-due`: one item per initiative
  with proposed chunks ("Jarvis as graph · 4 proposed by graph layout"), keyed so it disappears when none is left.
  It reaches every reader of the attention queue: Sprout, the nav rail badge, Jarvis's Waiting on you, the Cockpit's
  Needs you. Label "Plan to review".

Who proposes:

- Plan it's prompt (`initiativework.ts`) asks for chunks added with `--proposed`, then a stop for review.
- The `effort-tracking` skill gains one rule: chunks an agent adds on its own, beyond what the person asked for, go
  in `--proposed`.

An idea whose only chunks are proposed stays an idea (Ideas column, "4 proposed"); the first accepted chunk makes it
an initiative, as the first chunk does today.

### 2. Plan to review on the agent's rail

On the Agent surface, an agent whose session names an initiative (`session:effort`, `agent.effortId`) that has
proposed chunks shows a **Plan to review** section first on the details rail's Overview, above Needs you:

- asking-tinted panel (`askingbg` fill, `asking/30` border), heading in the region-label style with "N proposed";
  a line naming the initiative and the agent that proposed it;
- one row per proposed chunk: a dashed asking ring, its label, its stage and note; icon buttons Accept, Rename (in
  place), Drop; a decided row shows "accepted · now pending" or "dropped" with Undo until the rail re-reads;
- Accept all and continue, Accept all, Drop all. Continue sends "Plan accepted, start with <first chunk>" into the
  agent's terminal through the same path the ask answers use; the other two send nothing.

The agent header shows an asking chip "N TO REVIEW" after the initiative link while any wait. A `plan-review` item
opened anywhere else goes to that agent when it is still open, else to the initiative on the Jarvis List, where
proposed chunks carry the same buttons inside the opened row.

### 3. The initiative popover on the agent header

The header's initiative link (`InitiativeLink`, `agentheader.tsx`) opens a popover in place; Ctrl/Cmd-click keeps
today's open-in-Jarvis (the app's peek gesture). Key `i` on the Agent surface (free there; `jarvis:focus-composer`
is Jarvis-only) toggles it. Contents, 340px:

- "Initiative · <project>", the title, "↳ Part of <parent>" when linked, the segment bar with done/total, the
  status (agent open, at work, blocked, paused);
- **This agent is on**: the chunk whose workrefs hold `agent:<this tab>`, with **Mark done** (`m`; `d` is the
  rail toggle), which runs the existing `advance` op, and the chunk's latest note;
- **Next**: the next two pending chunks; a click opens the chunk's status menu or rename;
- "N proposed · Review on the rail" when any, which scrolls the rail to Plan to review;
- footer: Add note (`n`, appended to the chunk this agent is on), Open in Jarvis; Esc closes.

The popover's keys are bound only while it is open, so they never reach the terminal or the surface.

An agent with no initiative shows **+ Link to initiative** in the header's place for the link. It opens a picker:
a filter field, the initiatives of the agent's project (title, done/total, status), "+ New initiative from this
session", "Other projects · N". Picking one sets the tab's `session:effort` and attaches the agent to the
initiative's active chunk (or the first pending one) with the existing `attachWork` op.

### 4. Review: what changed, and idle initiatives

Review is not urgent, so it never enters the attention queue and never adds to Sprout's badge.

- A per-initiative "reviewed at" kept in localStorage as a map `oref → ts` (like "Since you looked"'s
  `jarvis.briefing.lastseen`); an initiative never reviewed starts from that cursor.
- Changed: `updatedts` after its reviewed-at. Idle: active, no workref on any chunk, unchanged and not reviewed for
  14 days (a constant, no setting), so Mark reviewed takes it out of the queue until 14 more still days pass. The
  List's status cell shows "idle 3w" muted.
- The List's Initiatives heading gains **Review · N**; Sprout's popup ends with a muted line
  "N initiatives changed · M idle · Review in Jarvis".
- Review mode narrows the region to changed and idle initiatives, in the order blocked, asks you, at work, changed,
  idle, and opens the first. Above its detail a **Since you reviewed** block lists the effort's events since the
  mark (chunk done, chunk added, status changed, note), newest first, read from `Effort.Events`. Actions: Keep
  going, Go to agent / Work on, Pause, Archive, and **Mark reviewed** (`Enter`, then the next). For an idle one
  Pause and Archive come first. `j`/`k` or `←`/`→` move, `Esc` leaves; the end shows "All reviewed".

### 5. Parent and child initiatives on the List

`EffortSummary.parentoid` is already on the wire; nothing draws it today.

- A child sits under its parent, indented 20px with a thin elbow connector; its meta line reads
  "↳ Part of <parent>". The parent's title carries "+N sub" and its opened detail lists Sub-initiatives.
- The row's ⋯ menu gains **Link to…** (the picker from §3) and **Unlink from <parent>**.
- Backend: linking refuses a cycle (A under B while B is under A, at any depth), not only a self-link as today
  (`wshserver_effort.go`).
- An idea linked to an initiative shows under it in the opened detail.

## Not doing

- The Jarvis graph view (deferred, see above).
- Editing or deleting a whole stage from the popover or the rail; that stays on the List.
- A setting for the idle threshold.

## Where it lands

- Backend: `pkg/jarvis/effortops.go` (status, addChunk status, progress and advance skipping proposed),
  `cmd/wsh/cmd/wshcmd-effort.go` (`--proposed`), `pkg/jarvis/attention.go` (`plan-review`), the effort summary's
  done/total, `pkg/wshrpc/wshserver/wshserver_effort.go` (cycle check). `skills/effort-tracking/SKILL.md`.
- Frontend, pure models with vitest beside them: proposed rows and their decisions, the popover's chunk picks
  (this agent's chunk, next two), the review queue and its order, idle detection, the parent/child row order.
- Views: `agentdetailsrail.tsx` (Plan to review section), `agentheader.tsx` (popover, chip, Link to initiative),
  the Brief's initiative rows and opened detail (proposed buttons, Since you reviewed, Part of, ⋯ items),
  `petpeek.tsx` (the review line), `needsyoustripmodel.ts` and the Brief's queue (the `plan-review` label).
- Keybindings: `agent:initiative` (`i`), the popover's own `m`, `n`, Esc; Review mode's `Enter`, `j`/`k`, Esc.
  `docs/keyboard-shortcuts.md` mirrors them.

## Verification

- Go tests: proposed status accepted and counted out of progress, advance skipping it, `plan-review` items built
  and cleared, the cycle check.
- vitest for each pure model above.
- CDP scenarios, one per UI: the rail's Plan to review (seed an initiative with proposed chunks on a live agent),
  the header popover (open with `i`, Mark done), Link to initiative, Review mode (seed changed and idle
  initiatives), parent/child rows. Each names the step that shows its view.
