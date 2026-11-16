# Agent header: the left side, redesigned

**Prototype:** `D:\work\arcterm\.superpowers\design\agent-header-redesign\project` (one board,
`A-mot-dong-chia-cum.dc.html`: every case below, wide, narrow and very narrow)

## Intent

The left half of the agent header (`frontend/app/view/agents/agentheader.tsx`, `AgentHeader`) reads as one run-on
line: project, initiative, orchestrator run, lead, origin session and started runs are all joined by ` · ` inside one
truncating span (agentheader.tsx:729-770), the unlinked state is a dashed chip (`LinkToInitiative`, :255-272) that
clashes with the rest, and the three relation arrows `↑` `↰` `↳` are hard to tell apart (`↳` renders like `l,`).
This redesigns that left half. The right-hand buttons (view switch, More, Split, Ship/Commit, Close-done, Float,
Fullscreen, Close) and the state colours stay as they are, except where the narrow rule below folds two of them.

No badge or pill wraps the project, the initiative or the run: they are plain text with a small icon.

## What is always visible

Besides the status dot and the name, the header always shows, without a click: the **project**, the **initiative**
(or the invitation to link one), the **run link**, and the **model and context**. This holds in Chat as in Terminal:
the Chat ("lean") header today hides the runtime mark, the state word, the model and the context
(agentheader.tsx:450-454, `lean`); after this change it shows them like Terminal does. The `Alt+C` keycap stays
Terminal-only. The Chat ◇ initiative chip comes back too (today lean drops it for the band); `i` keeps opening the
band once linked. *Agent's call:* in Chat a click on the ◇ link toggles the band, the same as `i`, so one panel answers
both and the popover and the band are never open together; in Terminal the click opens the popover as today; the peek
click is unchanged in both. The unlinked `/ + initiative` carries no `i` keycap in either view (its title says
`(i)`), since a keycap would put back the chrome this removes.

## Layout: one line, clusters, icons instead of ` · `

One row, same height as today (`py-[8px]`). After the dot come the name, the runtime mark, the state word (or the
queued-job tag), the dev-server mark and the start error, in today's order (agentheader.tsx:670-713). *Agent's call:*
both marks stay where they are: the runtime mark (`RuntimeMark`) now shows in Chat too, and `ServerMark` with its
ports stays, since it is the header's only view of a running agent's listening ports. Then come three clusters separated by wide gaps (18px), each led by a small lucide icon, never by ` · `:

1. **Location**: `[folder] project / [◇] initiative`, a short path. The initiative is a link in `text-accent-soft`
   that opens its popover (`InitiativeLink` behaviour unchanged).
2. **Run link**: one item (below).
3. **Model and context**: model in `text-muted`, context in its `CTX_TEXT` level colour, `tabular-nums`.

The "N to review" chip (`PlanReviewChip`) keeps its place at the end of the left side. Colours come from `@theme`
tokens only.

### An agent with no initiative

After the project: `/ + initiative` in `text-ink-faint`, no border, no fill; hover brightens it, a click or `i` opens
the existing `InitiativePicker`. Workers, the final stage and plain terminals cannot link, so nothing shows there
(today's `canLink` rule).

### The run link

One item replaces today's four branches (orchestrator run id, `↑ lead`, `↰ origin`, `↳ N runs`):

- One run: `[Workflow] run 094a3c28` (the id in mono, 8 chars).
- Several started runs: `[Workflow] 2 runs · 1 active` (`· N active` only when some run is still going).
- A worker or stage session: `[CornerLeftUp] <lead name>`.
- A lead (or a Quick run's agent) shows its own run's id even when it also started runs.

Clicking it:

- Worker / stage: focuses the lead, as today.
- A session that started exactly one run and belongs to none: opens that run (`openTarget`).
- Anything else (a lead, a Quick run's agent, a session with several started runs): opens a `ContextMenuModel` menu in
  sections: **This run** (id · goal · status), **Started from** (the origin session, or "a closed session", not
  clickable), **Started runs** (one row each: goal · status, running ones first). Cancelled runs are neither counted
  nor listed (`startedRunsShown`).

### Each case

- Plain session: location (with `/ + initiative` when unlinked), run link if it started runs, model + context.
- Lead: the `Workflow` icon before the name; run link = its run id.
- Worker: name `T3 · <label>`; no `+ initiative`; run link = `↑ lead`.
- Final stage: no dot; name and location only.
- Plain terminal: no initiative, no model.
- Queued heavy command: the `QueuedJobTag` replaces the state word.
- Failed to start: red dot, "failed to start", the error in red mono, truncated; no model cluster (none yet).
- Waking / falling asleep: the left side is unchanged; the right-side buttons lock as today.

## Narrow panes

An `@container` on the header, two levels; no cluster is ever hidden:

- **Narrow** (below ~720px): cluster gap 18px → 10px; the name keeps up to ~42% of the width before it truncates;
  `/ + initiative` becomes `/ +`; the run link becomes `094a3c28` or `2`; the model shows its family (`opus`);
  Split, Float and Fullscreen move into the More menu (*Agent's call*, as the board draws it; More already holds
  Fullscreen, and the header reads its width in JS, e.g. a ResizeObserver, to know which items More adds); the
  dev-server mark shows its glyph and a count, the ports in its tooltip; the runtime mark is unchanged.
- **Very narrow** (below ~480px): the name keeps up to ~34%; the initiative becomes its ◇ icon alone, its title in the
  tooltip; the project truncates with an ellipsis.

The run link, the model + context and the two marks never shrink; the project is what gives way first. Thresholds are a builder call
after trying the 2x2 grid.

## Motion

None new. Switching narrow levels while a split is dragged swaps text at once (layout seen many times a day, so no
animation); the run menu is the existing context menu with its own motion; the state word's settle on idle stays.

## Left to the builder

- The exact lucide icons (the board uses `Folder`, `Diamond`, `Workflow`, `CornerLeftUp`).
- The exact `@container` thresholds, after trying the 2x2 grid.
- Extract what the left side shows (which clusters, the run link's text and target, the narrow level's strings) into a
  pure model, e.g. `frontend/app/view/agents/headermodel.ts` with `headermodel.test.ts` beside it; `agentheader.tsx`
  renders it.
- A CDP scenario in `scripts/cdp/scenarios.mjs` that shows the header in each case of the board (plain session, Chat,
  lead with the run menu open, worker queued, failed to start, narrow, very narrow), seeded through cockpit fixtures.
- One `CHANGELOG.md` line under Changed.
