# Cockpit Focus and Peek — Design

**Date:** 2026-09-22
**Status:** Approved 2026-09-22. Peek shipped; the Focus control was removed on 2026-10-06 (`docs/deferred.md`, Cockpit focus)
**Type:** Cockpit-wide contract, two slices

## Summary

The cockpit's nine surfaces are nine projections of the same few entities — project, agent, run, file,
commit, finding, note, session, cost. They do not disagree because they lack pipes between them:
`openTarget` already routes every addressable resource to its home surface. They disagree because
nothing tells them what the user is looking at, and because consulting another projection destroys the
one you are in.

This design fixes both with two pieces:

1. **Focus** — make `SURFACE_CONTEXT` load-bearing instead of decorative, and widen the second scope
   dimension from dossier-only to any entity that resolves to a scope bundle.
2. **Peek** — one overlay that renders any `OpenTarget` without unmounting the surface underneath and
   without writing the destination's selection.

They are designed together because each is weak alone: focus without peek makes every sideways glance
cost a re-focus, and peek without focus gives cheap looks with no way to settle on one.

Relationship annotation — surfaces marking up each other's content in place — is deferred with its
rationale under [Deferred until evidence](#deferred-until-evidence).

## Builds on

- `docs/reference/architecture.md` — one cockpit, `AgentsViewModel`, surfaces unmount on switch.
- `docs/superpowers/specs/2026-09-15-cross-surface-resource-linking-design.md` — canonical addresses,
  `parseAddress`, `openTarget`, and the error posture a failed landing owes the user. Peek reuses its
  target union and its result semantics unchanged.
- `frontend/app/view/agents/surfacecontext.ts` — the posture vocabulary, which this makes real.

## Problem

Verified against `main` on 2026-09-22.

### The scope contract is declared and unenforced

`surfacecontext.ts:16` declares, per surface, how it honors each of the two scope dimensions, with a
three-value vocabulary: `filter` narrows the surface's collection, `subject` supplies a default or
describes an explicit target without hiding it, `unsupported` makes no claim. Every surface has an
entry, and `surfacecontext.test.ts:23` asserts the table is complete.

The table is consumed by exactly one function, `projectControlCopy` (`surfacecontext.ts:29`), whose only
caller is `projectswitcher.tsx:27` and whose only output is a label and a tooltip string. Nothing
enforces a posture. The result is a contract that is currently false:

- **Project.** `projectFilterAtom` (`agents.tsx:140`) is read by the cockpit roster
  (`cockpitsurface.tsx:207`), sessions (`sessionssurface.tsx:107`), the background strip
  (`backgroundagentsstrip.tsx:25`) and Radar (`radarsurface.tsx:115`). Jarvis, Files, Vault and Code all
  declare `project: "subject"` and **never read it at all**.
- **Space.** `spaceScopeAtom` (`spacestore.ts:18`) is read by the cockpit roster
  (`cockpitsurface.tsx:209`) and sessions (`sessionssurface.tsx:109`). Agent, Files and Code all declare
  `space: "subject"` and never read it.
- **Radar's posture contradicts its behavior.** It declares `project: "filter"` but implements
  `subject`: `radarsurface.tsx:124-147` seeds `radarScopeAtom` from the project filter exactly once,
  behind an `initialized` ref, and never reads it again. There is no divergence indicator and no way to
  rejoin, so it silently drifts — the worst of the three states.

So the app bar's project selector is a global control that five of nine surfaces ignore, and the Space
switcher — whose own dropdown header already reads "Focus on task" (`spaceswitcher.tsx:46`) — reaches
two.

### Focus cannot point at the thing you are usually looking at

A Space is a dossier. `ResolveSpaceScopeCommand` requires a `DossierId`
(`wshserver_jarvis.go:518-520`) and derives the bundle from that dossier's attribution edges. But the
entity a user is usually attending to in an agent cockpit is an **agent** or a **run**, and neither can
be focused.

### Every cross-surface glance is destructive

Only the Agent surface stays mounted when off-screen; every other surface unmounts on switch, so
surface-local `useState` is lost. `openTarget` therefore costs the user their place: forty files into a
diff, checking one finding returns them to the top of the list. The surfaces are technically connected
and practically avoided. Navigation being cheap to *call* is not the same as cheap to *do*.

Today's peeks do not close this gap: `briefpeekview`, `graphpeek` and `petpeek` are bespoke,
Jarvis-local and reachable only from within Jarvis.

## Goals

- Every surface either honors the posture it declares or declares `unsupported` honestly.
- Focus can point at a task, an agent or a run, and every honoring surface renders that subject.
- A surface that diverges from focus says so and offers one click back. No silent drift.
- Any addressable target can be inspected without unmounting the surface beneath it.
- A peek never writes the destination surface's selection.

## Non-goals

- Relationship annotation (surfaces marking up each other's content) — deferred below.
- A third scope dimension, or collapsing the existing two into one.
- Changing `openTarget`'s behavior, its address vocabulary, or its failure copy.
- New durable data. `SpaceScope` stays rebuildable and unstored.
- Peeking a live terminal. See §5.

## Design

### 1. Two dimensions, one posture table

Keep both dimensions. They answer different questions, and the app bar already renders them side by
side (`app-bar.tsx:29,31`):

- **Project** — *where*. `projectFilterAtom`, a project name.
- **Focus** — *what*. `spaceScopeAtom`, a resolved `{ RunORefs, ChannelOids, TabIds }` bundle.

`SURFACE_CONTEXT` becomes the enforced contract rather than tooltip copy. Corrected table, with the one
cell whose declaration changes rather than merely getting implemented marked:

| Surface | project | focus | What changes |
|---|---|---|---|
| cockpit | filter | filter | nothing — both implemented |
| sessions | filter | filter | nothing — both implemented |
| radar | **subject** | unsupported | posture corrected to match behavior; add divergence + rejoin |
| jarvis | subject | unsupported | implement project |
| agent | subject | subject | implement both |
| files | subject | subject | implement both |
| code | subject | subject | implement both |
| vault | subject | unsupported | implement project |
| usage | unsupported | unsupported | nothing — see below |
| settings | unsupported | unsupported | nothing |

Jarvis's focus support stays `unsupported`. Its Space filter operated on the Brief's active-work region,
which `ea4cd452` replaced with the inline tracker, and what a focus should hide among those rows is
undecided (`docs/deferred.md:94-96`). Declaring it honestly is the point of the table.

Usage stays `unsupported` on both dimensions, and this is the cell most likely to be re-proposed, so the
reason belongs here: **the usage data carries no attribution dimension.** `UsageBucket`
(`gotypes.d.ts:3840`) is `{ harness, provider, model, day, token counts }` — no session id, tab id,
project or run. `GetUsageStatsCommand` walks transcripts and aggregates by harness, provider, model and
day, so neither "what did this agent cost" nor "what did this project cost" is answerable by filtering
what exists. Making Usage honor either dimension requires per-session or per-run attribution in the
usage scanner first, which is precisely the deferral recorded at `docs/deferred.md:71` ("Usage-to-work
links"). Promote this cell only after that lands.

### 2. Widening focus beyond a task

An agent, a run and a task all resolve to the same bundle shape, so this is one RPC signature change,
not a new frontend concept. `SpaceScope` stays the currency and every existing filter —
`filterBySpace`, `filterChannelsBySpace`, `filterSessionsBySpace` (`spacescope.ts`) — keeps working
untouched.

`CommandResolveSpaceScopeData { DossierId }` becomes `CommandResolveFocusScopeData { Kind, Id }`, and
`ResolveSpaceScopeCommand` becomes `ResolveFocusScopeCommand`, then `task generate`. Its one frontend
caller is `spacestore.ts:39`.

| Kind | Resolution |
|---|---|
| `task` | unchanged: `jarvisattrib.EdgesFor` → `buildSpaceScope` (`wshserver_jarvis.go:526-539`) |
| `agent` | `TabIds: [id]`; `RunORefs` and `ChannelOids` from runs whose phase `WorkerOrefs` contain `tab:<id>` |
| `run` | `RunORefs: ["run:"+id]`; `ChannelOids: [run.ChannelOID]`; `TabIds` from its phase `WorkerOrefs` |

An unknown kind is an error, not an empty bundle: an empty bundle is indistinguishable from a real
focus that currently matches nothing, and every `filter` surface would render empty with no explanation.

**No label on the wire.** Every caller already holds one — a task from `SpaceSummary.objective`, an
agent from the roster's `AgentVM.name`, a run from its `Goal` — and persisted focus stores the label
beside the ref. Returning it would be a second copy to keep in sync.

### 3. What `subject` posture obliges

`filter` is well-defined and implemented. `subject` is defined only in a comment. It gains three
concrete obligations:

1. **Seed** — a surface with no explicit target of its own adopts focus on mount.
2. **Show divergence** — when its explicit target differs from focus, say so in its header.
3. **Rejoin** — one click snaps back to focus.

The escape hatch follows from the posture, and no surface needs both halves:

- `filter` surfaces **hide rows**, so they need a **reveal** — `spaceRevealAtom`, per-surface, reset on
  switch (`spacestore.ts:20`). Unchanged.
- `subject` surfaces **hide nothing**, so they need a **rejoin**. A local target sticks; the banner
  offers the way back.

### 4. Setting, showing and persisting focus

**Setting.** `enterSpace(summary)` becomes `enterFocus(ref: FocusRef, label: string)` where
`FocusRef = { kind: "task" | "agent" | "run"; id: string }`. `exitFocus()` is today's `exitSpace`. The
stale-resolve guard at `spacestore.ts:40-43` is kept, comparing the whole ref rather than an id.

Entry points: the app-bar switcher (gaining agent and run groups beside tasks); a row action on the
cockpit roster, sessions rows and Jarvis run rows; the palette; and a keybinding on the row cursor.

**The keybinding is `.`** — audited against `bindings.ts`, where the only punctuation keys bound are
`[`, `]` and `/`. The obvious mnemonic `f` is unavailable: it is the Agent surface's fullscreen toggle
(`bindings.ts:774`) and the `g f` leader letter for Diff (`bindings.ts:105`). `.` carries no editor
muscle memory and collides with no surface's row bindings.

**Focus implies project.** `enterFocus` also sets `projectFilterAtom` to the focused entity's project.
Without this the user can hold a contradictory pair — project `A`, focus on an entity in `B` — and every
`filter` surface correctly renders empty, which reads as a bug. `exitFocus` leaves the project alone;
that is the natural widening from this task, to this project, to everything.

**Showing.** Two presentations, chosen by posture:

- `filter` surfaces keep `SpaceBanner` and `spaceBannerText` verbatim.
- `subject` surfaces render a divergence line **only when diverged**, and nothing when aligned — the app
  bar already carries the global answer, so silence is the reward for being in sync. Copy comes from a
  second pure function beside `spaceBannerText`, unit-tested the same way.

**Persisting.** Both focus dimensions persist across reload, and the existing per-surface persisted
targets — `lastCodeProjectAtom` (`codestore.ts:88`), `lastRadarProjectAtom`, `persistedSubjectAtom`
(`jarvissubjectstore.ts:41`) — are kept. A surface whose persisted local target differs from persisted
focus returns diverged and says so. Deliberate divergence is a real state and should survive a reload;
Code remembering which repo you were reading is behavior worth keeping.

**Staleness.** Today's bundle is resolved once at enter. With agent and run focus that breaks three
ways: a focused agent spawns workers absent from the bundle, a new run is attributed to a focused task,
or the focused entity exits and the bundle names a dead tab. **Re-resolve on a switch to a surface that
honors focus** — bounded, cheap, and exactly the moment it matters; a switch to Usage or Settings
resolves nothing. Not a poller. If the focus target no longer exists, degrade to
project-only focus and report it once through `pushToast`, matching `openTarget`'s no-silent-no-op
posture.

### 5. Peek

**Targets** are `OpenTarget` from `address.ts` verbatim — no second vocabulary.

| Target | Peek renders | Adapted from |
|---|---|---|
| run | goal, status, phase strip, evidence files, workers | `briefrunsheet.tsx` |
| record | the dossier peek as it stands | `briefpeekview.tsx` |
| radar | risk, why, severity, evidence, investigation status | `radarfindingdetail.tsx`, compacted |
| memory-note | title and body | `vaultreader.tsx` |
| effort | chunks and progress | the existing effort sheet |
| agent | project, branch, session, cwd, changed files — **no terminal** | `agentdetailsrail.tsx` |
| channel | excluded; a channel address peeks its active run | — |

The agent peek carries no PTY deliberately. Only the Agent surface stays mounted precisely so its live
xterm is never torn down and re-fitted at a stale size; a second terminal in an overlay is the exact
thing that rule exists to prevent. The rest of an agent is static fact, and the peek's Open promotes to
the real terminal.

**A peek writes no destination selection atom.** If peeking a finding set `radarSelectedIdAtom`, a later
navigation to Radar would land somewhere the user never chose — a peek would have silently rearranged a
surface they were not on. This forbids reusing the `land*()` functions in `openref.ts`, which are
load-then-select by construction. Each landing splits:

```
loadTarget(target)  → proves existence, returns the object   (shared)
selectTarget(...)   → writes the destination's selection     (open only)

openTarget = load → select → switch surface   // commits
peekTarget = load → render overlay            // borrows
```

One loader per kind, two consumers — a DRY refactor of existing code, not a parallel implementation.

**Hosting** reuses what exists. `ModalsRenderer` is already a `Record<string, ComponentType>` registry
driven from a stack atom and mounted once in `CockpitBody` (`modalsrenderer.tsx:18-24`); the peek
registry is the same shape keyed by target kind. `ModalShell`, `modalstack.ts` and `modalfocus.ts`
already handle stacking, focus ownership and Escape — `293f55ca` made a shell take focus only when it
owns the top of the stack.

**Invocation** is `Space` in Navigate posture. It is currently bound once, in the Vault review queue
(`bindings.ts:1307`, gated `when: inQueue`), so the conflict is already scoped by the existing `when`
mechanism. A modifier-click on a link that would otherwise navigate is the second door.

**Depth is 1.** A link inside a peek promotes to a full `openTarget` rather than stacking. `modalstack`
could nest, but a stack of half-loaded contexts is a worse place to be than a decisive jump.

**The host surface's scroll position survives by construction, not by saving it.** A peek is an overlay
over the mounted surface, so that surface is never unmounted and its DOM — and therefore its scroll
offsets, selection and in-flight state — is untouched. This is the whole reason peek is cheaper than
`openTarget`, and the test named below asserts the property rather than a restore mechanism, because
there is no restore mechanism to get wrong.

**Failure** reuses `OpenResult` unchanged: `unavailable`, `failed` and `unsupported` toast and open no
overlay; a peek started while another is loading supersedes it silently through the same `openSeq`
counter. A peek that cannot load must never leave an empty frame on screen.

### 6. Where focus and peek meet

A peek carries two promote verbs: **Open** commits the user's position to the target; **Focus this**
points the cockpit at it. That makes peek the browsing surface for choosing a focus — glance at three
runs cheaply, then focus the one that matters.

**A peek never changes focus by itself.** Focus is always deliberate.

## Testing

- **Posture table:** every surface's declared posture has a test asserting the behavior — a `filter`
  surface hides non-matching rows and reveals them on Show all; a `subject` surface seeds when it has no
  target, reports divergence when it does, and rejoins on click.
- **Focus resolution (Go):** `agent` and `run` kinds build the right bundle from phase `WorkerOrefs` and
  `ChannelOID`; `task` is unchanged; an unknown kind errors rather than returning an empty bundle.
- **Focus store:** `enterFocus` sets the project; `exitFocus` leaves it; a stale resolve is discarded; a
  vanished target degrades to project-only and toasts once; re-resolve happens on surface switch.
- **Peek:** a peek writes no destination selection atom (one assertion per target kind — this is the
  constraint most likely to regress); a failed load opens no overlay; a superseded peek renders nothing;
  promote calls `openTarget` with the same target; Escape restores the host surface's scroll position.
- **Pure copy:** the divergence line, table-tested beside `spaceBannerText`'s existing tests.
- **Checks:** `task generate` after the RPC rename, the stack-sized TypeScript check, a backend build,
  and `cargo test` untouched.
- **`task verify:ui` scenarios:** focusing an agent re-aims Files and Code; a diverged Code surface
  shows the rejoin line and rejoins on click; `Space` on a roster row peeks without leaving the
  surface, and Escape returns to the same scroll position.

## Rollout

Two slices, each its own commit carrying the part of this spec it implements.

**Slice 1 — Focus.** The RPC widening and `task generate`; `enterFocus`/`exitFocus` with project
implication, persistence and re-resolution; the corrected `SURFACE_CONTEXT`; per-surface implementation
of the posture each declares; the divergence line and rejoin; the keybinding.

**Slice 2 — Peek.** The `openref.ts` load/select split; `peekTarget` and the peek registry over
`ModalShell`; the six compact renderers; `Space` invocation; the Open and Focus promote verbs.

Slice 1 first: peek's Focus verb needs focus to exist, and slice 2's split is easier to review once the
surfaces already agree.

When both land, record the deferrals below in `docs/deferred.md`.

## Deferred until evidence

- **Relationship annotation.** Surfaces marking up each other's content in place — an editing-agent and
  open-finding marker in Code, a finding badge on a Files hunk, "cited by N runs" under a memory note, a
  session row naming the run it produced. All the source data exists (`finding.files`, roster cwd and
  changed files, `Run.RadarOrigin`/`EffortRef`/`DagORef`, `jarvisattrib` edges) and nothing derives
  markers from it. It is the cheapest of the three ideas and the most likely to degrade into noise, so
  it wants the surfaces to agree first and a mockup per `DESIGN.md`. Revive after slice 1.
- **Companion split** — pinning a second surface beside the current one. The supervision loop is "watch
  the agent, read what it changed", which is a toggle today. Needs a second mount slot, since only the
  Agent surface stays mounted. Revive if peek proves insufficient for sustained side-by-side work.
- **Time correlation** — every surface answering "what did this look like at T". Makes "what happened
  overnight" a first-class workflow. Revive on a real post-mortem that peek and focus cannot serve.
- **Drag courier** — dragging a finding or file onto an agent in the roster. Shares machinery with the
  pet's deferred courier gestures; build the store and the gestures together or not at all.
- **Jarvis focus support.** Held at `unsupported` until there is a decision on what a focus should hide
  among the inline tracker's rows (`docs/deferred.md:94-96`).
- **Usage focus and project support.** Held at `unsupported` because `UsageBucket` carries no
  attribution dimension at all; it is blocked on the usage scanner gaining per-session or per-run
  attribution (`docs/deferred.md:71`), not on a design decision. Revive together with that.
