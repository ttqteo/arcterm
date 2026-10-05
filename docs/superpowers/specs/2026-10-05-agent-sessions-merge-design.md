# Merge Sessions into the Agent surface (Antigravity-style), with a 2x2 agent grid — design

Status: design settled 2026-10-05. Not yet planned or implemented.

## Problem

The cockpit has two surfaces for the same thing. **Agent** shows live agents (a tree, the real TUI,
a details rail). **Sessions** shows the transcripts on disk (a list, a read-only detail). To find a past
conversation you leave the Agent surface; to continue one you go back. The reference the user wants is
Google Antigravity's agent manager: one window, a left sidebar of projects with the running and recent
conversations under each, the conversation in the middle, and a right panel of counted sections
(Subagents, Files Changed, Artifacts, Uploads, Background Tasks, Terminals).

Two additions ride along: drag-and-drop of agents into a grid of at most 2x2 terminals, and an Uploads
section fed by paste, drop and an Attach button.

Out of scope: a chat-style centre with its own composer (the centre stays the real TUI —
`docs/superpowers/specs/2026-06-29-agent-tab-real-tui-design.md` explains why), vertical stacking of two
cells, session rows as grid cells, uploading directories, a Tauri-side drop-path primitive.

## Decisions

1. **The Sessions surface is removed.** Its content lives inside the Agent surface. `SURFACE_ORDER`
   goes from 8 to 7 (Radar becomes Ctrl+6, Usage Ctrl+7). A persisted `"sessions"` or legacy `"activity"`
   startup surface is coerced to `"agent"` (`coerceStartupSurface`), the same way Activity was folded into
   Sessions before.
2. **Three columns, as today:** sidebar (248px) | centre | rail (300px, or the 44px strip). The centre
   has three modes in one atom: `terminal` (the live TUI or the ended-worker transcript), `session` (a
   read-only transcript with Resume), `history` (the old Sessions master-detail, embedded). The existing
   `sessions*Atom`s keep their names; "session" is already overloaded in this codebase (workspace tab
   sessions, the Brief region) and a rename would be churn.
3. **The sidebar is one tree per project.** Header: a full-width `+ New agent`, then `Conversation
   History`. Under each project folder (fold state already persisted in `collapsedProjectsAtom`):
   live agents first (today's rows, unchanged), then up to 5 ended sessions with a relative time
   (16m, 3d) and the session's first prompt as the title, then `Show more` (+5 per click).
   - A live agent and its session record are one row, joined by normalized transcript path (the join
     `overlayLive` already does). When the agent exits, the tab auto-closes after about 2s and the row
     drops into the ended group.
   - Sessions that belong to an orchestrator run (`runid` set) are not listed here; they already appear
     in the run lineage's done fold. History still shows them, grouped by run.
   - Status filters (All/Live/Needs you/Done) live in History only. The old Sessions surface has no search box,
     and none is added here.
   - The `Terminals` group leaves the tree and becomes a rail section.
4. **Clicking an ended session** sets `centerMode = session`: the transcript (`NarrationTimeline`,
   fed by `useTranscript`) and a `Resume` button, which is the existing `runSessionPrimary` path
   (`launchAgent` with the session's resume command; a new tab, same transcript stem).
5. **`Conversation History`** sets `centerMode = history` and renders the old list + detail unchanged
   (run grouping, "All activity", Transcript/Activity toggle, "Open in Orchestrate"). The rail is hidden
   while History is open, as it already is in canvas mode.
6. **The rail follows Antigravity's order**, each section counted and collapsible: needs (unchanged,
   when present), Subagents, Files Changed, **Artifacts**, **Uploads**, Background Tasks, **Terminals**,
   then Tools used, Run/Task, Details, Token usage as today. `planAgentRail` carries the new order. The
   rail becomes visible by default (`agent.rail.visible`); anyone with a stored value keeps it, and `d`
   still toggles.
   - Artifacts: the agent's canvas boards (`canvasStateAtom(id).boards`); a click enters canvas mode on
     that board.
   - Terminals: `liveTerminalsAtom`, filtered to the focused item's project. A terminal tab already carries
     `session:project`, but `deriveTerminalVMs` drops it, so the plan adds it to the terminal VM. A terminal
     that names no project shows everywhere. A click selects that terminal; a focused terminal gets a rail
     with just this section, since the rail is otherwise hidden for terminals.
7. **Uploads** records, per agent, `{id, name, path, kind: image|file, source: paste|drop|attach, ts}`.
   Three ways in, one store keyed by the terminal block id (the paste hook can only see the block, and one live
   agent owns one block), persisted without thumbnails:
   - Paste: `pasteHandler` already writes the image to a temp file and pastes the path; it also records.
   - Drop: OS files dropped on a terminal arrive as blobs without a path, because the window sets
     `dragDropEnabled: false` (which the grid's HTML5 drag needs). Each is copied to a temp file
     (`WriteTempFileCommand`, 5MB cap like paste), then pasted by path. Over the cap or a directory: a
     toast pointing at Attach.
   - Attach: `+ Attach` in the rail calls `@tauri-apps/plugin-dialog` `open({multiple: true})`, which
     already ships with `dialog:allow-open`, and pastes the real paths (double-quoted when they contain
     spaces). No new Tauri command.
   - Paths are inserted as a bracketed paste with no trailing Enter, so a TUI never reads them as
     commands.
   - Temp attachments are swept after 24h (`tempAttachRetention`). A paste/drop record older than that
     renders as "expired", not as an error. Image thumbnails (downscaled at ingest) live in memory only;
     after a reload a record shows a generic icon.
8. **The 2x2 grid.** The terminal stack in `agentsurface.tsx` already keeps every live agent's
   `CockpitFocusPane` mounted under one parent with stable keys, hiding all but the focused one. That
   parent becomes a CSS grid; each visible pane gets a grid placement and the rest stay `hidden`, so no
   terminal remounts and nothing replays.
   - Model: an ordered list of up to 4 agent ids plus the focused one. The shape depends only on the
     count: 1 fills the area, 2 sit side by side, 3 are two on top and one spanning the bottom, 4 is 2x2.
   - Drag an agent row from the sidebar (live agents only) onto a cell. While a drag with the custom MIME
     `application/x-arc-agent` is active, an overlay of zones appears over each cell: centre swaps the
     two; left/top inserts before; right/bottom inserts after. At 4 cells only swap remains. The overlay
     exists only during a drag, so it never sits over xterm.
   - Each cell gets a slim bar (status dot, name, `×` to drop it from the grid; the agent keeps running)
     that is also a drag handle for rearranging. The global `AgentHeader` stays on top and, like the rail,
     follows the focused cell.
   - Clicking a sidebar row replaces the focused cell's agent, or focuses its cell if it is already in
     the grid. Dragging, or a row context menu `Open in split` (the keyboard route), adds a cell.
     `Ctrl+Tab` follows the same rule.
   - History, canvas mode and fullscreen collapse the grid to the focused cell and restore it after.
   - Persisted in localStorage (`agent.grid`); ids that no longer exist are pruned on load.

## Architecture notes

- Pure modules, each with a `.test.ts` beside it (repo convention: no render tests):
  `agentsidebarmodel.ts` (merge live agents and sessions per project, dedupe by transcript path, the
  5-row limit and Show more), `agentgrid.ts` (add/swap/remove/replace/prune and `placementFor(count)`),
  `uploadsstore.ts` (record, expiry, dedupe), and the updated `planAgentRail`.
- Opening an item still goes through `openref.ts`. `session:open` in `cockpit/actions/session.ts` and
  `revealSurface("sessions")` in `focusstore.ts` retarget the Agent surface and set `centerMode`; the
  palette's "Sessions" scope stays and its Enter still resumes through `launchAgent`.
- The Agent surface is always mounted, so the sidebar's session scan (`GetSessionsActivityCommand`, 30
  days across four runtimes) must not run at boot. Load it after first paint, cache it in
  `sessionsArchiveAtom`, refresh on entering the surface and when an agent exits. No polling.
- `agentsurface.tsx` keeps `[data-agent-tree]`, `[data-agent-header]`, `aside[aria-label="Agent details"]`
  and `[data-agent-terminal]` as they are; many CDP scenarios depend on them.

## Removal and retargeting

- Remove the `sessions` key from `SurfaceKey`, `SURFACE_ORDER`, `navrail`, `cockpitshell`,
  `surfacecontext.ts`; `g s` opens History in Agent; drop `"sessions"` from `ESC_HOME_SURFACES`.
- Update `wsh ui`'s surface list (`uiapi.ts`), `skills/cockpit-ui/SKILL.md`,
  `docs/keyboard-shortcuts.md`, `docs/reference/architecture.md`, `AGENTS.md`, `README.md`,
  `scripts/cdp/attach.mjs`.
- Tests that hard-code the surface order: `surfaceorder`, `radarnav`, `bindings`, `store`,
  `surfacecontext`, `focusscope`.
- `docs/deferred.md` and `docs/open-issues.md` keep the "All activity rows can't peek" item: the feed
  survives inside History.

## Testing

- Unit tests for the pure modules above, run one file at a time (`npx vitest run <file>`).
- CDP scenarios: the existing Agent ones (`agent-tree-rail`, `agent-tree-quick-return`, `tui-fullscreen`,
  `tui-leader`, `canvas-swap`, `canvas-tabs`, `agent-terminal-on-arrival`, the doc-review ones) must keep
  passing; add `agent-history` (sidebar session rows, Resume, History, rail sections) and `agent-grid`
  (drag to 2, 3 and 4 cells, swap, `×`, and that no terminal remounts or garbles when the shape changes).
  They run against an already-running `task dev` app; the loop has no build step.

## Staging

Each stage ships on its own: (1) sidebar merge, History, Sessions surface removed; (2) rail sections
Artifacts and Terminals plus the new order; (3) the grid; (4) Uploads, the riskiest, as it depends on
paste/drop plumbing in `termwrap.ts`.

## Risks and open items

- xterm refits as cells change size; the `agent-grid` scenario is the check, with `tui-fullscreen` as the
  nearest existing one.
- Session titles are the first human prompt and can be long or generic; truncate, and keep the full text
  in the row's tooltip.
- Resume opens a new tab with a new id; the sidebar keys the row on the transcript, so it stays one row.
