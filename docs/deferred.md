# Deferred work

Running log of intentionally-deferred features. Each entry records what was deferred, why,
where it would plug in, and how to pick it back up. Append new entries at the top.

> The consolidated "what's left" view lives in `docs/open-issues.md` (2026-08-24). This file stays the
> append-only rationale log — append the full deferral here, then mirror a one-line row there. An entry
> marked RESOLVED/DECLINED is kept only while it still carries a residual or a revive condition.
>
> Pruned 2026-10-05: 27 entries whose work shipped, was retired with its subsystem, or was superseded were
> removed. Recover any of them with `git show c99f2041:docs/deferred.md`.

## (arcterm) Saved actions: one-click repeated chores such as commit and pull (deferred 2026-10-09)

- **Deferred:** a panel of saved actions run with ▶, like Claude Code's agents panel (one row per `.claude/agents`
  subagent), for chores done again and again: commit, pull/sync, a typecheck.
- **Why deferred:** the user's call after a first brainstorm; nothing is blocked on it.
- **Settled in discussion, for when it is picked up:**
  - An action is either a `cmd` or a `prompt`, chosen by whether it needs judgment. A `cmd` (`git pull --rebase`,
    `task check:ts`) runs in the project's terminal: instant, no tokens, the same every time. A `prompt` goes to the
    selected agent, for work that must read the situation: a commit has to pick this session's files by pathspec
    (the index is shared with other sessions), write the message and maybe a CHANGELOG line.
  - A later option: a `cmd` with `onFail: prompt`, handing the failure output to an agent (a pull that hits a
    conflict), so tokens are spent only when judgment is needed.
  - Open: where actions live (a checked-in `.arc/actions.json` like `.arc/setup`, a global list, or both).
- **Relation:** the Diff surface's repository actions (Spec B, below) ask the same questions about writing to a tree
  an agent or run may hold; design the two together.
- **Revive when** the same commit or sync prompt is typed by hand often enough to be a chore.

## (arcterm) Token burn guard: warn before an agent fans out or burns cache reads (deferred 2026-10-08)

- **What:** warn, before it happens, when an agent is about to spend tokens fast. Seen 2026-10-08: one docs
  session with 4 subagents and 3 demo agents went from ~20M to ~220M tokens in about an hour, almost all cache
  reads (every tool call re-sends the whole context, so cost ≈ context size × call count). Nothing warned.
- **Signals we already have:** per-session tokens and the 10-minute burn the Consumers panel sorts by
  (`consumers.ts`), each session's context size (the rail's token strip), and the 5-hour window
  (`ratelimitstore.ts`). Hooks see a spawn before it runs: a `PreToolUse` on the `Agent`/`Task` tool
  (and `Workflow`) can ask, the way `wsh memgate` asks before a heavy Bash command (`pkg/memgate`).
- **Shape:** (1) a "token gate" beside memgate: before an agent spawns subagents or a workflow, show a card
  with the projected cost (open context × expected calls × agents) and the 5h window left, Allow / Deny;
  (2) a burn alert: a toast when a session's 10-minute burn would empty the 5h window before its reset, or
  when its context passes ~150k while it keeps calling tools (suggest `/compact` or → Sonnet from the
  Consumers row); (3) cache reads shown apart from fresh tokens in the Consumers Tokens view.
- **Relation:** complements `docs/superpowers/specs/2026-10-07-quota-guard-design.md` (warns at 85%/95% of the
  window and holds engine work); this guard acts earlier, on the rate rather than the level.
- **Pick up** with a brainstorm/spec; measure first how well "context × calls" predicts a session's spend
  from saved transcripts.
- **Status (2026-10-09):** an orchestrator run for version 1 (`8b822a9b`, started 2026-10-08 21:15) was
  interrupted by an app restart at 21:20, before its lead submitted a plan. Nothing was built; the run sits
  Blocked until it is resumed (the sheet's Resume lead) or cancelled.

## Radar's metadata collectors and clustering pipeline (retired 2026-10-06)

- **Retired:** the scan that collected metadata signals and clustered them in one model call that never read
  code: the structure, transcript, runs, config and dependency collectors, the per-commit git signal collector,
  the no-test signal and its admissibility gate, candidate preparation and the payload budget, the clustering
  prompt and synthesis call, the per-mode lenses (correctness, security) and their risk taxonomies, the security
  gate, evidence strength, and the finding cap. Radar now audits each recent fix commit for the same bug at
  sibling sites (`docs/superpowers/specs/2026-10-06-radar-fix-sibling-audit-design.md`).
- **Why:** its last two scans kept 0 findings and 9 finished investigations found no defect. A hand trial on
  2026-10-06 that read the code around 5 fix commits found a real sibling bug in 2 and a conditional one in 1.
- **Revive when** chunk 8 of `effort:1557171a-e61d-4b29-83fd-fc7f818e6131` measures the audit as not worth
  keeping and metadata signals are wanted back.
- **Recover** with `git show 78fe087a:pkg/reporadar/<file>`, where `<file>` is one of `collect.go`,
  `collect_config.go`, `collect_dependency.go`, `collect_git.go`, `collect_runs.go`, `collect_structure.go`,
  `collect_transcript.go`, `modes.go`, `prepare.go`, `security.go`, `synth.go`, `validate.go` (each with its
  `_test.go`), or the old `scan.go`, `lifecycle.go` and `types.go` they plugged into.

## (arcterm) Preview pane: localhost dev servers and HTML files (deferred 2026-10-08)

- **Deferred:** an in-app preview limited to two things: a dev server on `http://localhost:<port>`, and an `.html`
  file on disk (with its relative CSS, JS and images). Not a general browser.
- **Why deferred:** the user's call ("chắc làm sau"); nothing is blocked on it.
- **Why not a full browser:** a native child webview (Tauri multiwebview, still `unstable`) is an OS window layered
  over the React UI, so the palette, popovers and toasts cannot draw over it and its bounds must be synced by hand.
  Most real sites refuse an `<iframe>` (`X-Frame-Options`/CSP). WKWebView answers no CDP, so an agent-driven embedded
  browser would be Windows-only. Agents already have claude-in-chrome and Playwright MCP.
- **Settled in discussion, for when it is picked up:**
  - Both are an `<iframe>`, so one approach covers Windows and macOS.
  - **Localhost:** add `http://localhost:*` to `frame-src` in `src-tauri/tauri.conf.json` (today only
    `http://127.0.0.1:*`). wavesrv finds the ports the selected agent's process (or its worktree's Setup) listens on,
    and the pane follows the selected agent. Keep an "Open in browser" button: OAuth redirects and `SameSite` cookies
    may break inside a frame.
  - **HTML files:** do not reuse `/wave/stream-file` (`pdfframe.tsx` `streamFileUrl`). Its `?path=` query breaks
    relative asset URLs, and the URL carries the wavesrv `authkey` on wavesrv's own origin, so the page's JS could read
    `location.search` and drive wavesrv's RPC. Add a read-only `/preview/<token>/<relpath>` route whose token is scoped
    to the file's folder (no `..` escape, not the authkey), and frame it with `sandbox="allow-scripts"` and no
    `allow-same-origin`.
  - HTML is a Preview mode of `.html` in the File tab, as `.md` and `.tex` have; no new surface. It also opens
    `design-local` `.dc.html` canvases and agent-made HTML reports in the app. Build it first (small, used at once),
    then the localhost pane with port detection.
- **Revive when** opening a dev server or a `.dc.html` canvas in an outside browser becomes a regular step.

## (arcterm) agy as a run lead (2026-10-08)

- **Deferred:** Antigravity (`agy`) leading an orchestrator run, or acting as a reviewer or stage session. agy is a
  task worker only; `harness.OperationLead` refuses it, and the lead, reviewer and run-route pickers do not list it.
- **What is missing:** a lead needs the handoff `/compact` and re-orientation after compaction. agy has no `/compact`
  command and no compaction event, so a long lead could not shed context or be re-oriented.
- **Why:** design decision D2 in `docs/superpowers/specs/2026-10-08-agy-harness-design.md`: a worker needs only
  liveness, ask delivery and route validation; judgment roles need the rest.
- **Where to pick it up:** `harness.OperationLead` (`pkg/harness`) to allow the route; `HandoffCompact` in
  `pkg/orchestrate/wake.go` for the compaction handoff; agy's PreInvocation hook `injectSteps` as the path to
  re-orient a lead after it compacts.

## (arcterm) Line comments in the Spec/Plan review dialog (deferred 2026-10-07)

- **Deferred:** commenting on lines of the document in the Spec review / Plan review dialog
  (`frontend/app/view/agents/docreviewdialog.tsx`), as the Agent panel's File tab already can on a markdown file.
  Today the dialog renders the document read-only (`MarkdownMessage`), and the only feedback is the Request changes
  note.
- **Why:** low value for the cost. Plan review opens only after the plan reviewer has failed twice, and what it
  decides is the findings on the right, not the plan's lines; the note already carries "Finding 2: …" or
  "Task 5: …". Spec review is where it would pay (a long prose document), but nothing yet says the note falls short
  there.
- **Settled in brainstorming (2026-10-07), for when it is picked up:**
  - Comments on the document pane only, not per finding. A mockup-settled spec (the canvas pane) stays as it is.
  - Reuse `MdDoc` (`mddoc.tsx`) rather than Doc review's sentence anchors (`proseanchor.ts`): line refs suit a plan's
    tables, code blocks and Task headings, and the lead can open `path:line` directly. Pass `agent` = the lead,
    `fileRef = { abs: review.path, root: null }` (the plan sits in a worktree; the absolute path is the safe ref).
  - The footer stays as it is: Accept stays primary with no confirmation, and comments go only with Request changes,
    which reads "Request changes (N)" and can send with comments and an empty note. Accepting with comments drafted
    drops them.
  - The answer is one text answer (an ask answer is text or a selection, not both: `buildAskAnswers`): the note, then
    `formatMdComments` of this file's comments. Make it a pure `requestAnswer(note, comments)` with a vitest beside it.
  - Drafts live in `mdCommentAtom(leadId)`, shared with the File tab; either answer clears this file's comments, since
    the next round's line numbers no longer match.
  - `MdDoc` needs an optional `onOpenLink` so a link closes the dialog first; otherwise the file opens in the Agent
    panel behind the modal.
  - No keyboard conflict: the comment box stops propagation of Ctrl+Enter and Esc, so `ModalShell`'s window listener
    never sees them (no accidental Accept, no closed dialog).
  - CDP: extend the `doc-review` scenario: open a Plan review, comment a selection, save with Ctrl+Enter, assert the
    dialog stays open, the card shows, and the button reads "Request changes (1)".
- **Revive when:** Spec review notes keep pointing at specific passages ("Task X", "the paragraph about Y"), or a
  review is long enough that a single note loses track of where each remark belongs.

## (arcterm) Editable LaTeX visual mode, Overleaf style (deferred 2026-10-07)

- **Deferred:** a `.tex` mode that is rendered and editable at once, as Overleaf's Visual Editor is: `\section{…}`,
  `\textbf{…}` and `\cite{…}` drawn as a heading, bold text and a chip inside the editor, with the cursor still
  typing into the source.
- **Why:** Monaco can tint ranges and inject text but cannot replace a range with a widget, so this needs
  CodeMirror 6 beside Monaco (two editors in the bundle) and Overleaf-scale work on cursor movement through
  widgets, undo, copy/paste and user macros. In arcterm the agent edits a paper and the user reads and reviews
  it; the read-only `.tex` Preview (spec `2026-10-07-tex-wrap-pdf-viewer-design.md`, decision 10) covers reading,
  and double-click jumps to the source line for a hand edit.
- **Where it would plug in:** a fifth Code surface view mode for `.tex` in `viewModesFor`
  (`frontend/app/view/code/codeclassify.ts`), rendered by a CodeMirror 6 editor with decorations built from
  `docprose.ts`'s token kinds.
- **Revive when:** the user edits papers by hand in arcterm often enough that switching between Preview and
  Source is the complaint.

## (arcterm) Session scan cache on disk (deferred 2026-10-06)

- **Deferred:** keeping the sessions scan's parsed results across wavesrv restarts, so the first Conversation History
  or Agent sidebar load after a launch is as fast as every later one.
- **Why:** `scanCache` in `pkg/agentsessions/agentsessions.go` is in memory only, so each launch's first
  `GetSessionsActivity` re-parses every transcript it lists. On 2026-10-06 that was 2.9 s for 100 sessions: 324 MB of
  JSON across 200 files, a third of it subagent transcripts that were dropped after being parsed. Two cheaper fixes
  shipped instead and brought it to 0.5 s: the walk skips `subagents/` (the provider's `skipDir`), and
  `parseCandidates` parses in batches on up to 8 workers (`parseWorkers`). A disk cache would add a file format, a
  version stamp to bump whenever any provider's derivation changes (a stale entry would keep showing an old title or
  status), and a write-back path, for a 0.5 s that happens once per launch.
- **Plugs in:** `scanSessionCached`. Load the entries once from a file under `wavebase.GetWaveCachesDir()`, keyed by
  path, valid only while mtime and size still match (the in-memory rule), and write back after a scan that parsed
  anything new. Store a nil entry for a file that holds no session too, so non-sessions stay skipped. Keep the
  version stamp in the file and drop the whole cache on a mismatch.
- **Revive when** the first load is slow again: the scan's limit or window grows, or a cold `ScanSessions` measures
  over about 1 s. Nothing was built for this, so there is nothing to recover from git.

## (arcterm) In-app auto-update, Chrome style (deferred 2026-10-06)

- **Deferred:** the app checking for a newer version itself, showing "Restart to update", downloading the installer
  and running it, so an update closes arcterm, installs over it and reopens it with no installer pages.
- **Why:** builds are made and installed on this machine; nothing publishes releases yet, so there is nothing to
  check against. The installer already supports the update itself: Tauri's NSIS template (bundler 2.10.1) takes
  `/P` (passive, no pages), `/UPDATE` (install over, skipping "Uninstall before installing") and `/R` (start the app
  when done), and closes `wave-tauri.exe` through the Restart Manager. A plain double-click still defaults to
  "Uninstall before installing" on an upgrade, which is why installing felt like uninstall plus reinstall.
- **Plugs in:** `tauri-plugin-updater` (and `tauri-plugin-process` for the relaunch) in `src-tauri/`, a check on
  launch, and a "Restart to update" prompt in the app bar. `bundle.createUpdaterArtifacts: true` and a signing key
  pair (`TAURI_SIGNING_PRIVATE_KEY` at build time, the public key in `plugins.updater.pubkey`). Each release
  publishes the installer, its `.sig` and a `latest.json` where the app can fetch them without signing in: GitHub
  Releases of a public repo, or another host while the repo is private.
- **Done 2026-10-07, needed either way:** `src-tauri/installer-hooks.nsh` (`NSIS_HOOK_PREINSTALL` and
  `NSIS_HOOK_PREUNINSTALL`) stops the install directory's own `wave-tauri.exe` and `wavesrv.x64.exe` by path before
  the copy or delete, asking first when the installer shows pages, since the Restart Manager closes only the main
  binary and a live wavesrv fails the overwrite halfway (a double-click install over 0.15.1 broke this way and had to
  be run again). `task install` runs the last build's installer with `/P /UPDATE /R`, the local stand-in for the
  updater. An uninstaller from before 0.15.2 has no hook, so "Uninstall before installing" over one can still fail.
- **Also deferred (2026-10-07): a double-click upgrade defaulting to "Do not uninstall".** It needs a fork of the
  bundler's `installer.nsi` (`bundle.windows.nsis.template`; hooks are included before `$ReinstallPageCheck` and
  `$UpdateMode` are declared, so they cannot set the default). The fork freezes at the bundler version of the
  `cargo tauri` that made it and has to be re-copied on every tauri-cli upgrade. Both choices work since the hook, so
  only the default would change. Revive when builds are handed to other people often enough that the default matters.
- **Revive when** releases are published somewhere fetchable. The updater itself was not built, so there is nothing
  to recover from git.

## Markdown comments in the Agent panel — re-measure their use (deferred 2026-10-06)

- **Deferred:** deciding whether the File tab's markdown comments stay
  (`docs/superpowers/specs/2026-10-06-md-comments-design.md`).
- **Why:** the 2026-10-01 brief counted the earlier send-to-agent features: 2 uses of Code's "Send to agent" since
  August, 0 of canvas send-marks. These sit where the reading happens, but that is a bet.
- **Revive when** around 2026-10-20: count the sends (agent transcripts holding a `Comments on … (N):` message).
  Near zero: remove the comment gestures and the tray, and keep the Preview.

## Code and Diff in the nav rail (deferred 2026-10-06)

- **Deferred:** taking Code and Diff out of the nav rail. The rail now groups them with Radar as tools, under Cockpit,
  Jarvis, Agent and Usage (`docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md`).
- **Why:** the Agent panel's File tab (and later its Review tab) covers reading a file and an agent's changes, not
  browsing, searching or editing a project, nor history or compare. Whether the nav items still earn their place is
  only known after using the panel for a while.
- **Revive when** around 2026-10-20, after the 2026-10-15 re-measure of Code's "Send to agent": if Code and Diff are
  reached almost only through the panel's "Open in…" buttons, the palette and `g b` / `g f`, drop them from
  `TOOL_ITEMS` in `navrail.tsx` and from `SURFACE_ORDER` in `agents.tsx` (Radar becomes Ctrl+5).

## Sessions "All activity" feed rows peeking a run, agent or initiative (deferred 2026-10-01)

- **Deferred:** the peek gesture on the Sessions "All activity" feed, where `Main.dc.html` in the cockpit-peek mockup
  shows each row peeking a run, agent or initiative.
- **Why:** those rows link sessions today, not runs, and giving them targets was scoped out of the cockpit-peek run.
  The gesture is demonstrated on the Brief's run rows instead (CDP scenario `peek-ctrl-click`). No feed-row-to-target
  mapping was built.
- **Revive when** the feed rows carry a target (a run oref, an agent tab id or an effort id). Wire each row through
  `openOrPeek` in `frontend/app/view/jarvis/openref.ts`, the way the Brief's `openLine` does, and mark it `data-peek`.
  Nothing was built for this, so there is nothing to recover from git.

## Terminal file drop pastes the file's path (deferred 2026-09-30) — ✅ RESOLVED 2026-10-06

**Resolved by `6eeab650`:** an OS file dropped on a terminal is copied to a temp file and that path is pasted, one
paste per file (`CockpitFocusPane` → `ingestFiles` in `frontend/app/view/agents/uploadsingest.ts`), with
`dragDropEnabled` still off. **Residual:** the pasted path is the copy's, not the original's; pasting the original
path still needs the native route below.

- **Deferred:** dropping a file onto a terminal to paste its quoted path. The Electron build read the path with
  `webUtils.getPathForFile`; the Tauri port stubbed that to return `""`, so the drop handler never pasted anything.
  The stub and the handler are gone; `termwrap.ts` now only swallows the drop so the webview doesn't navigate to the file.
- **Why:** a webview `File` carries no path. Tauri's native drag-drop event does, but it needs `dragDropEnabled: true`
  on the window (`src-tauri/tauri.conf.json`), which takes HTML5 drag-and-drop away from every surface.
- **Revive when** file drops onto a terminal are wanted: listen to `getCurrentWebview().onDragDropEvent` and hit-test the
  drop position against the terminal, which needs that flag flipped and every HTML5 drag target re-checked. The old
  handler: `git show a4b5bd4f:frontend/app/view/term/termwrap.ts` (`dropHandler`).

## Final stage: a verifier's verdict held during Checking is not persisted (declined 2026-09-30)

- **Declined:** persisting the verdict of a final verifier that finishes before the stage's Check and Final
  commands. It lives in `finalRuns.verdicts` (`pkg/orchestrate/final.go`), so a wavesrv restart in that window
  loses it, and the next tick restarts the commands and replaces the verifier.
- **Why:** the commands restart anyway and take longer (the Final command is bounded at 30 min, and every final
  verifier since `0c1e4523` gave its verdict in 0.7 to 2.6 min), so the respawned verifier costs one session's
  tokens and no wall-clock. Persisting needs a `FinalStage` field and restart handling for a window no run has been
  seen to hit.
- **Revive when** a run's history shows a final verifier replaced after a restart, or restarts during Checking
  become routine (auto-update mid-run, for example).

## Run recovery after a restart — dag runs (deferred 2026-09-30) — ✅ RESOLVED 2026-10-05

**Resolved by `90f4b49e`:** `ResumeInterruptedLeads` restarts a dag run's lead at boot, in its own tab and
session, before the watchdog runs; the watchdog was already picking the dag's workers back up (seen on run
`0354da6a`). A lead that cannot be resumed takes the existing dead-lead path. Unit-tested
(`leadresume_test.go`), not yet seen live.

The restart recovery in `git show a4b5bd4f:docs/superpowers/plans/2026-09-30-run-restart-recovery.md` covers non-dag runs only: quick, pipeline, and an
orchestrator lead before `dag submit`.

- **Deferred:** marking a dag run's children and a submitted lead interrupted at boot, and resuming them.
- **Why:** the watchdog already schedules every dag at boot, and it is unverified that a dead child goes
  unnoticed. claude children are exempt from the first-token deadline (`firstTokenRuntimes`,
  `pkg/orchestrate/liveness.go`), so one might, but nobody has seen it happen.
- **Revive when** a live repro shows a dead child or lead that the engine never notices after an app
  restart: start a plan run, kill the dev app mid-task, restart it, and watch whether the task is retried or
  stays running. The boot pass is `orchestrate.MarkInterruptedRuns` (`pkg/orchestrate/interrupted.go`),
  which skips any run with a `DagORef`.

## Run recovery after a restart — New Agent sessions (deferred 2026-09-30)

- **Deferred:** stopping a New Agent session (a block with no `agent:runid`) from replaying its launch prompt
  when its tab remounts after a restart. `shouldRelaunchWorker`
  (`frontend/app/view/agents/session-models/agentresumestore.ts`) still relaunches every such block.
- **Why:** a transcript scan on 2026-09-30 (798 claude and 353 pi sessions) found no session that re-ran its
  launch prompt after a restart: resume-on-reopen bakes `--resume`/`--session` into the block's `cmd:args`
  once the session reports its transcript.
- **Revive when** a session is seen re-running its prompt after a restart. The gate to change is
  `shouldRelaunchWorker`; nothing was built for this, so there is nothing to recover from git.

## Work on an initiative — "Save place and close" (deferred 2026-09-29)

Work on (the Brief's initiative row, `w`, and the palette's ctrl+enter) starts an agent with "where are
we" and points it at the initiative's newest note, and sends you to the agent already open on it instead
of starting a second one. What it does **not** do is capture where a session was when it closes.

- **Deferred:** the close dialog (header ✕, tree "Close agent", double ctrl+c — all `confirmCloseSession`)
  offering **Save place and close** for a session linked to an initiative. arcterm would type a "record where
  we are as one left-off note" prompt into the agent, wait for a note from that session with a new
  `--left-off` flag on `wsh effort note`, then close the tab; ctrl+c in the dialog closes without saving.
- **Why:** agents already write where they are. Since note authorship shipped (2026-09-23), 23 sessions
  wrote 185 notes to initiatives, including explicit "END-OF-DAY STATE (resume here)" notes, so the newest
  note is usually the resume point. Losing mid-conversation state ("I was at question 10+") showed up once
  in 30 days of transcripts. Saving costs a turn on every close, and a full cache write when the session
  has sat idle past the cache TTL — the cost that ruled out resuming the last session instead.
- **Revive when** losing a session's place recurs. It plugs in on top of what shipped: the link is the
  tab's `session:effort`, and `confirmCloseSession` (`frontend/app/view/agents/agentactions.ts`) is the one
  place to add the option. The design was a local `.dc.html` canvas and was never committed, so there is
  nothing to recover from git; the steps above are the whole design.

## Cockpit focus — deferred until evidence (2026-09-22)

From `docs/superpowers/specs/2026-09-22-cockpit-focus-and-peek-design.md`. Slice 1 landed the app-bar
Focus switcher, the scoped-surface filter and the divergence banner; all of it was **removed on
2026-10-06** as unused (peek stayed). Recover the frontend with
`git show 43d8365a:frontend/app/view/agents/focusstore.ts` (siblings: `focusswitcher.tsx`,
`focusscope.ts`, `focusbanner.tsx`, `focussubject.ts`, `focusfor.ts`) and the resolver's agent and run
kinds with `git show 43d8365a:pkg/wshrpc/wshserver/wshserver_jarvis.go`. These were scoped out of
slice 1 deliberately, and the ones that do not need focus still stand:

- **Relationship annotation.** Surfaces marking up each other's content in place — an editing-agent and
  open-finding marker in Code, a finding badge on a Files hunk, "cited by N runs" under a memory note, a
  session row naming the run it produced. All the source data exists (`finding.files`, roster cwd and
  changed files, `Run.RadarOrigin`/`EffortRef`/`DagORef`, `jarvisattrib` edges) and nothing derives
  markers from it. Cheapest of the three ideas and the most likely to degrade into noise, so it wants
  the surfaces to agree first and a mockup per `DESIGN.md`. **Revive after slice 1.**
- **Companion split** — pinning a second surface beside the current one. Needs a second mount slot,
  since only the Agent surface stays mounted. **Revive if peek proves insufficient** for sustained
  side-by-side work.
- **Time correlation** — every surface answering "what did this look like at T". **Revive on a real
  post-mortem** that peek cannot serve.
- **Drag courier** — dragging a finding or file onto an agent in the roster. Shares machinery with the
  pet's deferred courier gestures; **build the store and the gestures together or not at all.**
- **Usage project support.** Held at `unsupported` because `UsageBucket` carries no attribution
  dimension at all; blocked on the usage scanner gaining per-session or per-run attribution, not on a
  design decision. **Revive together with that.**

## Composer attachments (2026-09-18)

Composer attachments (paste / attach / drag-drop onto a run goal or steer, `875967bf`) were mounted only
by the deleted `channelcomposers.tsx` and went with it in `5eac07ed`. Image paste into an agent's own
terminal still works. Revive when attaching a file to a goal or steer is wanted; recover with
`git show 5eac07ed^:frontend/app/view/agents/composerattachments.ts` and
`git show 5eac07ed^:frontend/app/view/agents/attachmenttray.tsx`. This also retires the attachment half of
the 2026-07-16 "Channel composer attachments" entry and of the Remote/WSL blocked row.

## Lead-authored task routing — Phase 4 measurement gate (2026-09-17)

Phases 1–3 of `docs/superpowers/briefs/2026-08-19-lead-authored-task-routing-roadmap.md` are now shipped: the DAG-graph route display
(`551f76ee`) and run-evidence recording of the effective `(harness, model)` per task (`96fa3254` —
`RunEvidence` gains `Harness`/`Model`, sealed from the run's actual route and its last worker transcript's
reported model). Phase 4, the cost/outcome measurement gate, stays held.

- **What is deferred:** instrumenting cost and outcome per task keyed by `(lead stamp, harness, model)`,
  and revisiting a difficulty classifier or deterministic sniff on that evidence.
- **Why:** the roadmap built Phase 4 evidence-gated on purpose — a classifier's calibration is worst exactly
  where it matters (easy-rated-but-hard tasks), and misrouting hard-as-easy is strictly worse than not
  routing at all (YAGNI unless evidence shows cheap-first waste actually biting). No such evidence exists
  yet.
- **Where it plugs in:** `docs/superpowers/briefs/2026-08-19-lead-authored-task-routing-roadmap.md` §"Phase 4 — Measurement gate" states
  the fix shape (cost/outcome per `(stampTier, runTier, cached%)` via `usagestats`) and stays valid; Phase 4
  may be skipped entirely.
- **To resume:** on evidence that cheap-first routing waste is common (a hard task run cheap, cost or outcome
  showing it).

## Resource linking beyond navigation: relationships, trail, structured refs, wider targets (2026-09-17)

The resource-linking slice shipped canonical addresses, one parser and one `openTarget`
(`docs/superpowers/specs/2026-09-15-cross-surface-resource-linking-design.md`). The spec was cut to that core at
review; everything else it designed waits for evidence, with each settled decision kept in the spec's
"Deferred until evidence" section so it is not re-derived.

- **What was deferred:**
  - Related Work: forward links and backlinks derived from authoritative Run/DAG/Radar/effort data and
    attribution edges, no persisted link table, inferred edges showing `jarvisattrib`'s own provenance. Needs a
    mockup per `DESIGN.md`.
  - The Work Trail strip: explicit lineage only (finding → Run → task → worker → files), stopping at a branch.
  - Structured resource refs on the wire (file revisions, nested parents) — nothing persists a file revision yet.
  - File, diff, commit and session targets in `openTarget`; `openInCode` and `openDiff` stay the landings.
  - A shared contextual-action builder across buttons, menus and the palette.
  - Usage-to-work links, which need per-session or per-run attribution in the usage scanner first.
  - Unifying the attachment oref namespace (`resolveAttached`'s `run:`/`memory:`/`radar:`) with addresses.
  - Cross-surface Back is the entry below.
- **Why:** no flow has yet shown the need; each item names its trigger in the spec.
- **Where to pick it up:** the spec's "Deferred until evidence" section; the router is
  `frontend/app/view/jarvis/openref.ts` and the parser `frontend/app/view/jarvis/address.ts`. A new target kind
  is a union member in `address.ts`, a landing in `openref.ts`, and a row in `openref.test.ts`.

## Cross-surface Back history, its context strip, and a Space filter on the Brief (2026-09-17)

The first cross-surface plan (`effort:2450d93e`) built typed surface navigation and a Space filter in
`.worktrees/surface-integration`, uncommitted. The approved resource-linking spec
(`docs/superpowers/specs/2026-09-15-cross-surface-resource-linking-design.md`) cut the effort to addressing
and landing. That work was parked as `09e86573` on branch `feat/surface-integration`. Only the Sessions half of
its project and Space scope moved to `main`.

**Recovery lost (checked 2026-10-09):** the branch is deleted and `09e86573` no longer exists in this clone, so
every `git show 09e86573:…` pointer below is dead. Reviving this means building it again from the descriptions here.

- **What was deferred:**
  - Cross-surface Back: `navigateSurface` with direct and contextual kinds, a history bounded at 20,
    `navigateBack`, and the rail and keybinding routing onto them. Built and unit-tested, never merged.
  - The context strip ("Back to Radar"): a mockup only, never approved.
  - Deterministic reverse links and palette Open versus Execute, the plan's Tasks 5 and 6: not started. The
    palette's current handling of an ended session was not re-checked.
  - A Space filter on the Brief (`filterJarvisBySpace`) over channels, runs and workers, keeping attention
    global. It filtered the Brief's active-work region, which ea4cd452 replaced with the inline tracker, so
    it no longer applies. `SURFACE_CONTEXT` marks Jarvis's Space support `unsupported` until it returns.
- **Why:** the spec defers Back until a real flow shows the need. Its `openTarget` replaces the result type
  that work gave `openORef`. What a Space should hide among the inline tracker's rows is undecided.
- **Where to pick it up:**
  - Navigation: `git show 09e86573:frontend/app/cockpit/surfacenavigation.ts` and its `.test.ts`; the
    callers' wiring is `git diff eb5a3654 09e86573 -- frontend`.
  - Design and plan: `git show 09e86573:docs/superpowers/specs/2026-09-15-cross-surface-navigation-design.md`
    and `git show 09e86573:docs/superpowers/plans/2026-09-15-cross-surface-navigation-plan.md`.
  - Strip mockup: `git show 09e86573:docs/prototype/cross-surface-context-strip.html`.
  - Brief filter: `git show 09e86573:frontend/app/view/agents/spacescope.ts` (`filterJarvisBySpace`) and
    `git diff eb5a3654 09e86573 -- frontend/app/view/jarvis/briefsurface.tsx`.
  - Back needs its own chord: Code's Back/Forward owns `Alt+ArrowLeft/Right`.

## Lanes: a skipped task's commits land with its lane, and a retry's evidence starts at the branch head (2026-09-15) — ✅ RESOLVED 2026-09-29

**Resolved by `720ba0e1`** (run f9d2a919, merged in 443c5f66): a task's first dispatch stamps `StartBase`; skip writes
a recovery patch and resets the lane to it without cleaning the tree, and a retry's run starts from it, so its evidence
covers the failed attempt's commits. Tests: `pkg/orchestrate/laneskip_test.go`. The third bullet (a lane's first task
retried after a Setup failure keeps its original base) was not part of that change.

Slice 4d of the orchestrator redesign (`git show edf0132b:docs/superpowers/plans/2026-09-15-orchestrator-redesign-s4d-lanes.md`)
runs a chain of tasks as one lane: one worktree and branch, and one squash merge once the last task is done.

- **What was deferred:**
  - Skipping a task never rewinds its lane's branch. Anything a failed attempt committed before the task was
    skipped lands with the lane's squash merge.
  - A retried task continues from the lane branch, including any commits its failed attempt made. Its child
    run's `BaseCommit` is the branch head at the retry, so its evidence leaves those commits out.
  - A lane's first task retried after a Setup failure keeps the base its branch was created at, even when
    other lanes have merged since.
- **Why:** workers commit once, at the end, so a failed attempt rarely leaves commits behind. Rewinding needs
  a hard reset inside a tree that `task worktree:prepare` junctions into, the class of operation c375b9ff had
  to make safe for removal.
- **Where to pick it up:** in `applyActionLocked`'s `skip` case (`pkg/orchestrate/mutation.go`), reset the lane
  worktree to the last done task's reported commit (its child run's `EndCommit`) after `DumpRecoveryPatch`,
  unlinking junctions first as `removeWorktreeDir` does. For evidence, stamp the base on the task node at its
  first dispatch and reuse it on a retry.

## Merge-point Verify: a timeout kills the shell only, and a failed Verify holds only its own run's merges (2026-09-15)

**Half resolved (re-checked 2026-09-29):** a plan command now runs in a Windows job object and a timeout
kills its whole tree (`plancmd_windows.go`, `jobobject.KillTree`). The cross-run hold is still open, and
applies only to `--landing checkout`: a branch-landed run (the default) merges in its own landing tree.

Slice 4c of the orchestrator redesign (`git show edf0132b:docs/superpowers/plans/2026-09-15-orchestrator-redesign-s4c-setup-merge-verify.md`)
runs a plan's Setup and Verify commands through the platform shell and serializes merges per project checkout.

- **What was deferred:**
  - At `SetupTimeout` or `VerifyTimeout`, `execPlanCommand` (`pkg/orchestrate/plancmd.go`) kills the shell it
    started (`cmd.exe` or `sh`). A test runner the shell started keeps running until it exits on its own;
    `WaitDelay` only stops the engine waiting for it. `TestPlanCommandTimesOut` shows it on Windows: a 200ms
    timeout returns after about 5s, because the orphaned `ping` holds the output pipe until `WaitDelay`.
  - The landing claim (`pkg/orchestrate/verify.go`) serializes a merge and its Verify across every dag in one
    checkout, but a persisted `verify-failed` task holds only its own dag's later merges. A second orchestrator
    run in the same checkout would land on top of the failure.
- **Why:** both need machinery that one run per checkout does not: a process tree kill (a Windows job object,
  a Unix process group), and a store scan across dags by project path.
- **Where to pick it up:** `pkg/shellexec/jobobject_windows.go` already kills a process tree through a job
  object (`attachJobObject`, `killJobTree`); export it and attach it in `execPlanCommand` after `Start`. For the
  hold, have `AutoMergeReady` scan the non-terminal dags whose owner run has the same `ProjectPath`.

## Codex and opencode run workers (2026-09-14)

The orchestrator redesign (`docs/superpowers/specs/2026-09-14-orchestrator-redesign-design.md` §8) scopes
run workers, both leads and task workers, to Claude Code and pi, the two harnesses the owner uses. Consults
still run on codex and opencode; only the unattended run path lost them.

- **What was removed:**
  - `RunWorkerCapable` is false for codex and opencode (`pkg/harness/catalog.go`).
  - The codex and opencode arms of `RunWorkerSpecFor` (`pkg/jarvis/runexec.go`) are deleted.
  - The codex entry in `livenessRuntimes` (`pkg/orchestrate/liveness.go`) and its rollout test are deleted.
    The transcript scan still reads codex's date-nested layout and its `session_meta` cwd.
  - The codex and opencode rows of the route table, and `codexSafe` (`pkg/runroute/runroute.go`), are
    deleted.
- **Why:** each runtime multiplies the orchestration surface: wake adapters, compaction hooks, ask
  delivery, liveness and route validation. The redesign builds those for two harnesses, and neither of the
  other two was in use.
- **Recovery:**
  - `git show adfcbebc:pkg/jarvis/runexec.go`
  - `git show adfcbebc:pkg/jarvis/runexec_test.go`
  - `git show adfcbebc:pkg/orchestrate/liveness.go`
  - `git show adfcbebc:pkg/orchestrate/liveness_test.go`
  - `git show adfcbebc:pkg/runroute/runroute.go`
  - `git show adfcbebc:pkg/runroute/runroute_test.go`
  - `git show adfcbebc:pkg/harness/catalog.go`
- **Where to pick it up:** re-add the adapter arm, the route validation (a model namespace check, since
  tiers are gone) and the `RunWorkerCapable` flag together; a runtime needs all three to dispatch. A
  runtime also needs the redesign's per-harness pieces (wake, compaction rules, ask delivery) before it can
  lead. codex additionally needs its `livenessRuntimes` entry back.

## Diff surface — hiding whitespace-only files from the change list (2026-09-11)

Deferred by finding F4 of the git-compare-viewer parity initiative
(`git show edf0132b:docs/superpowers/plans/2026-09-04-git-compare-viewer-parity.md`).

- **What the finding asked for, and why it was not built:** F4 prescribed threading `-w` through the
  `CommitDiff` / `CompareDiff` RPCs. That prescription went stale during the initiative — after Task 8 the
  production pane calls neither command: it reads two file texts through `GitFileAtRef` and lets Monaco
  compute the diff. A temp-repo probe also showed the two git reads disagree under `-w`: `git diff
  --numstat -w` drops a whitespace-only file entirely while `git diff --name-status -w` still lists it, so a
  server-side flag would leave the change list and its own counts contradicting each other.
- **What shipped instead** (`88523b90`): the real post-Task-8 defect was Monaco's `ignoreTrimWhitespace`
  defaulting to **true** — a whitespace-only change drew as no change at all while the header above it read
  `+2 -2`. `frontend/app/view/agents/diffoptions.ts` makes the switch explicit and **off** by default, so the
  pane and the list agree; Shift+W (`files:toggle-whitespace`) is the opt-in for reading through a reformat.
- **What is still deferred:** filtering whitespace-only *files* out of the change list while whitespace is
  ignored. It is not a flag on an existing command — it needs one read that decides both the list and the
  counts, i.e. `gitinfo.Changes` returning a per-file "whitespace-only" bit derived from a single
  `--numstat` / `--numstat -w` pair. Building it as a second read is what produces the contradiction above.
- **Where to pick it up:** `git show 88523b90:frontend/app/view/agents/diffoptions.ts` for the switch this
  would hang off, and `pkg/gitinfo/gitinfo.go` `Changes` for the read that would have to carry the bit.

## Diff surface — repository actions split out of the parity work (2026-09-04)

Deferred by the two-spec split agreed during brainstorming on 2026-09-04. The Diff surface's
JetBrains-parity work was scoped as six gaps; five are specced and planned
(`docs/superpowers/specs/2026-09-04-git-compare-viewer-parity-design.md`,
`git show edf0132b:docs/superpowers/plans/2026-09-04-git-compare-viewer-parity.md`). The sixth — **repository
actions** — is this entry.

- **Shipped 2026-10-09:** commit (the Commit tab), fetch, pull and push (the sync bar), under
  `docs/superpowers/specs/2026-10-09-diff-commit-log-redesign-design.md`. That spec also left out hunk selection,
  AI-written messages, changelists, Commit and Push, remotes other than origin, force push, tags, merge or rebase
  when a branch has diverged, and automatic fetch; this entry does not cover them.
- **What is still deferred:** checkout, cherry-pick, revert (file and hunk), and any other operation that
  writes to the repository from the Diff surface beyond the four above. JetBrains offers these from its compare
  view's context menu; this surface offers none of them.
- **Why:** everything in the parity spec reads; these write. Different risk class, needs its own
  confirmation UX and its own conversation about what a cockpit should be allowed to do to a working
  tree. Designing a diff renderer and a destructive action in the same spec would have rushed the
  second.
- **What existed, deleted 2026-10-05:** `gitinfo.RevertFile` / `gitinfo.RevertHunk`, `GitRevertCommand`
  and `gitdiff.ts`'s `hunks` / `diffHeader` fields (the patch source a hunk revert needs) had no caller
  since Review mode was deleted on 2026-07-31. Recover them, with their tests, from the commit before the
  deletion: `git show 553658ba:pkg/gitinfo/gitinfo.go`, `git show 553658ba:pkg/gitinfo/gitinfo_test.go`,
  `git show 553658ba:pkg/wshrpc/wshrpctypes_projects.go`,
  `git show 553658ba:pkg/wshrpc/wshserver/wshserver_projects.go`,
  `git show 553658ba:frontend/app/view/agents/gitdiff.ts`, then `task generate`.
- **Where it plugs in:** the affordances belong in `diffpane.tsx`'s header and the changed-file rows
  in `changedfilelist.tsx` — both of which the parity plan rewrites, which is the argument for doing
  the parity work first and designing this against the result.
- **How to pick it back up:** brainstorm it as its own spec (Spec B). Open questions to settle there:
  which actions are in scope, what confirmation each needs, whether anything is allowed while a run
  or agent holds the same working tree, and how a failed write surfaces. Do not start from the parity
  spec alone — it deliberately says nothing about writes.

## Channel data-model scaling — what Phase 3 left behind (2026-10-06)

Phase 3 (Contract) shipped 2026-10-06: a channel row is metadata, and messages and runs live only in
`db_channelmessage` / `db_run` (spec `docs/superpowers/specs/2026-07-21-channel-data-model-scaling-design.md`;
its Section 4 has the startup pass and how it fails). These were left.

- **A reader that crosses channels sees only each channel's newest 500 messages**
  (`wstore.DefaultChannelMessageLimit`). The cockpit's needs-you count and a record's fleet read
  `channelMessagesAtom`, one `GetChannelMessages` window per channel, so a dispatch or an answered-ask card
  older than the window drops out of them. Not built: a query by ref (`GetMessagesByRef` is the server
  half) instead of the window. On 2026-10-06 the packaged store held 110 messages across its 9 channels
  in all, so nothing is outside a window. Build it when a channel nears 500 messages.
- **`db_channel_precontract` is gone.** Migration `000023` copied every channel blob into it before the
  startup pass (`wstore.ContractChannels`) stripped the arrays, and `000024` drops it. Before the drop,
  on 2026-10-06, every embedded message and run of the packaged store (882) and the dev store (332) was
  compared field by field with its row: the only differences were runs written after the pass. A store
  still below `000023` runs both migrations before the pass, so it is stripped with no copy kept: back
  its `waveterm.db` up by hand first.
- **The active channel still re-reads its message window on every channel version bump.** The run list
  no longer does: it was measured and fixed on 2026-10-06. On the packaged store's largest channel (589
  runs, 10.8 MB of run rows, 7.2 MB of it `goal` text) one `GetChannelRuns` cost about 240 ms in wavesrv
  (select 59, decode 153, encode 25) for an 11.1 MB reply, and that channel took 256 run writes in a day,
  0.3 to 1.1 a minute during an orchestrator run, while growing about 6 MB a week. `channelsstore.ts` now
  answers a bump with `GetChannelRunChanges`: it sends the version it holds of each run and gets back the
  channel's run ids and only the rows that are new or changed. With one run changed that is about 1.6 ms
  and 44 KB on the same rows. The channel bump stays the only signal, so a run written with no `run:`
  broadcast of its own (about 27 write sites pair their broadcasts by hand, and run creation sends none)
  still reaches the list. Left as it was: the message list is re-read whole on each bump, which is bounded
  at the newest 500 messages (95 in that channel); and the two on-demand readers of a whole run list, the
  palette (`palette-data.ts`, every channel) and a channel peek (`openref.ts`), still pay the full read
  when the user opens them. Revisit either on a measured cost.

## Jarvis Briefing — generic cross-project progress and durable milestones (2026-08-13)

Deferred during the Axis 2 landing-briefing design. The briefing can generically identify active work
across projects, but Wave does not yet own a trustworthy project- or workstream-progress denominator.

- **What is available now:** Wave-owned Run status/phases and runtime task plans from agent transcripts
  (Claude `TodoWrite`, Codex `update_plan`, Pi `TaskCreate`/`TaskUpdate`/`TaskList`), associated with a
  project through `Run.ProjectPath` / `agentsessions.SessionInfo.ProjectPath`. These describe one run's
  execution progress only. They may be absent, replaced, or cleared by the runtime.
- **What is deferred:** a generic progress model that persists across runs and can honestly answer how
  far a larger workstream has advanced. Dossiers have status and acceptance prose but no checked
  milestones; arbitrary repository trackers, Jira, and GitHub Projects have no common contract. Do not
  parse project-specific Markdown or relabel a current run's `done/total` as whole-project progress.
- **Why:** milestone identity, ownership, weighting, update authority, and stale-report behavior need a
  dedicated product/data-model session. Folding them into the landing briefing would overfit one project
  and invite fabricated percentages.
- **Where it plugs in:** a Wave-owned workstream/milestone contract (likely adjacent to dossiers), an
  agent reporting path, and then a source-identified progress projection in `pkg/jarvisstate` and the
  Briefing subject. Runtime task plans remain a possible run-level fallback, not the durable source.
- **To resume:** define workstream identity across runs; milestone lifecycle and who may update it;
  deterministic progress semantics (including unequal or unknown work); source health and staleness;
  runtime-normalized task-plan fallback; and UI wording that distinguishes run execution from durable
  workstream progress.

## Pi Part B — wave_create_widget tool + `wsh widget` vdom CLI deferred to v2 (2026-08-12)

Designing the bidirectional pi↔arc integration (meta Part B, spec
`docs/superpowers/specs/2026-08-12-pi-partb-bidirectional-design.md`), we kept four wave_* tools in
scope (wave_run_command, wave_open_file, wave_query_sessions, wave_notify) and deferred the fifth:

- **`wave_create_widget` (pi tool) and its `wsh widget` CLI wrapper** — the only tool needing new
  server surface: it would wrap `VDomCreateContextCommand` / `VDomRenderCommand`
  (`pkg/wshrpc/wshrpctypes_vdom.go`) behind a new wsh subcommand. Deferred because vdom
  async-initiation / render-stream semantics deserve their own care and there is no concrete
  consumer yet (YAGNI).
- **How to resume:** when a concrete consumer appears, add `wsh widget create <name> <json>` /
  `wsh widget update <oref> <json>` wrapping the two vdom commands, register `wave_create_widget`
  in `pi/extensions/waveterm-tools.ts` (Typebox params: name/data for create, oref/data for
  update), and extend the Part B plan's tool tests.

Also confirmed NOT deferred (deliberately included in v1 after review): control-channel
`new_session` / `switch_session` commands, despite the documented session-replacement footguns.

## Jarvis U2 — Tasks surface (dossier editor) (2026-07-24)

U2 ships the read + two-write inside-Wave tier (append a decision, change status). Deferred this cycle (spec §9):
- **In-Wave `## Notes` editing:** the human Notes prose renders read-only in the Tasks detail (`frontend/app/view/jarvis/taskdetail.tsx`). Editing needs a human-owned write path (`Vault.Write` rejects human-region edits by design; a Notes edit would append via a `CreateHuman`-style prose write + commit) plus an editor affordance. To resume: add a "Edit notes" toggle in `taskdetail.tsx` and a `SetDossierNotesCommand` that writes the `## Notes` region as a user commit.
- **Editing non-reserved frontmatter** (arbitrary human keys) and **editing/superseding existing decisions from the UI:** backend supports `SupersedeDecision`, but no UI affordance. Decisions stay append-only in U2.
- **Manual dossier creation** from the surface: dossiers are created by `jarviscapture`/dispatch (machine `CreateDossier`) only; no "New task" button.
- **Semantic/probation edge rendering, the Graph surface, live push:** the detail refs render as flat id chips (`Refs` machine field); no graph view, no `wps` subscription — the surface reloads on its own writes and on nav-focus, not on external vault mutations.
- **Notes heading normalization is FE-side:** `LoadDossier`'s `Notes` projection keeps the scaffold's `## Notes` heading; `taskdetail.tsx` strips a leading `## Notes` before display (deviation from the plan's verbatim render, which would have shown a literal `## Notes` line + an empty Notes section on every dossier). If a backend-side fix is preferred later, strip the heading in `jarvisdossier.LoadDossier` instead and drop the FE regex.

## Jarvis sub-project E (Continuity) — model tier, resume affordance, quit flush, terminal re-freshness (2026-07-24)

Decided during the E brainstorming (spec `docs/superpowers/specs/2026-07-24-jarvis-e-continuity-design.md`). E ships the rest-boundary narrative writer (`pkg/jarviscontinuity`): on a Run entering a rest state (`awaiting-review | blocked | done`), it assembles deterministic facts, runs one capable-model summary, and writes the dossier's `state` block + status off-band from `AdvanceRunCommand`. Recall (C) serves that narrative during ordinary traversal. Four forks + PLACEHOLDER tuning are deferred.

- **What's deferred:**
  1. **Haiku model tier for boundary summaries** (fork 2) — E's one model call reuses the capable model via `consult.SpecFor("claude") → consult.Run`, with no `--model` selection. The cheap tier is a shared concern (C's synthesis + E's summary both want it) and lands as its own cross-cutting slice, not a one-off inside E. Boundary summaries are event-bounded (one per rest transition, never a poll), so the interim cost is bounded.
  2. ~~**Resume UI/RPC + ambient "pick up where you left off"** (fork 1) — `jarviscontinuity.Resume(r, taskID) → Narrative` is exposed and unit-tested but has **no wired v1 consumer** (recall reads the `state` block during traversal, so nothing calls it). A dedicated resume card / `resume` RPC is a *push* affordance adjacent to v2 proactive resurfacing — an ambient-presence follow-on, not E.~~ **RESOLVED 2026-08-06** — `GetLatestResumeCommand` (`pkg/wshrpc/wshserver/wshserver_jarvispet.go`, `017dd234`) serves the single newest narrative by its own `Updated` stamp, and the pet's ambient sources consume it (`petsources.tsx` → `eventFromResume` in `petjoin.ts`): a stable-id "Where we were — …" peek event that re-speaks only when a new narrative is written. Still the newest narrative only — a per-task resume card remains the v2 ambient follow-on.
  3. **App idle/quit continuity flush** — no separate E flush on app idle or quit. A (Wave Vault) already performs a quit-safety commit, so a speculative E-owned flush is unjustified.
  4. **Completed-task prose re-freshness** (§3 caveat) — a **completed** task's prose can drift if facts change after `done`, because there is no further transition to re-trigger a summary. Low-stakes: it is a historical record and C still resolves live run status at query time. Re-freshness of terminal dossiers is out of scope.
- **Why:** each is either blocked on a not-yet-built substrate (1 needs the tiering slice; 2 needs the v2 ambient-presence surface) or is speculative against an existing guarantee (3 duplicates A's quit commit; 4 is a low-stakes drift on a historical record that C already backstops with live leaf resolution). Building any now would be a single-use abstraction or premature.
- **Where it plugs in:** (1) the `summarize` var in `pkg/jarviscontinuity/continuity.go` (a `--model` per call, wired with C's traversal at the shared `consult.Run` site — arrives with ≥2 real cheap-tier users per the F tiering-defer entry). (2) a resume card / RPC consuming `Resume` (`continuity.go`), surfaced on the Jarvis/ambient surface. (3) an app-lifecycle hook alongside A's quit commit. (4) a re-summarize trigger on post-`done` fact changes (or accept the drift).
- **PLACEHOLDER tuning** (`pkg/jarviscontinuity`, calibrate against a populated vault): the rest-state set `{awaiting-review, blocked, done}` (`IsRestState` — drop `awaiting-review` if plan-gate-heavy runs prove noisy, keeping `blocked`/`done`); `continuityCaptureTimeout = 90s` (the detached boundary-summary model-call bound, `pkg/wshrpc/wshserver/wshserver_runs.go`).
- **To resume:** each is independently pickable — (1) with the tiering slice, (2) a per-task resume card beyond the pet's newest-narrative peek, (3) if a quit-time gap surfaces, (4) on evidence that terminal-dossier drift matters.

## arcterm Environment capability — declined (2026-07-16)

The arcterm Environment roadmap (an agent-aware local dev-environment manager: discover services from
project manifests, launch/observe/diagnose them in dependency order, and let agents share the same
infrastructure instead of spawning duplicates) was captured 2026-07-15 as `docs/environment-roadmap.md`
and **decided against 2026-07-16, before any implementation**. Nothing was built — the roadmap was the
only artifact (doc-only commit `4e80bf4f`), now removed to keep the roadmap set honest.

**To revive:** `git show 4e80bf4f:docs/environment-roadmap.md` restores the full product + architecture
design (thesis, data contracts, deterministic detection contract, the 6-phase delivery plan, and the
Windows-local scope bound). Each phase defined its own exit evidence, so it can be picked back up as
written if the need reappears.

## Usage surface — deferred (2026-06-26)

**Permanent limitations (no honest source — not open TODOs):**
- **Rate-limit window token cap** (handoff "1.34M / 2.2M tok"): there is no faithful *limit* — the
  5h/weekly `%` is Anthropic's opaque server-side number, unrelated to any transcript token sum. The
  cockpit now shows a real *used*-token count with **no denominator** (see the resolved usage-bar
  entry); a "used / limit" ratio would require a cap Anthropic does not publish.
- **Plan-tier badge** (handoff "Max 20×" / "Tier 4"): not carried by the statusLine; the provider
  label is shown without a tier badge. No source to derive it from.

**Resolved 2026-07-01 (deferred-token-truth-usage-polish):**
- **Model-id prettifying** — DONE. `prettyModel` (`modellabel.ts`) turns raw ids into friendly labels
  (e.g. "claude-opus-4-8" → "Opus 4.8"); used in the Usage per-model bar and the rail Model row, with
  the raw id kept as a `title` tooltip. Unknown ids fall through unchanged.
- **Pricing table** — REFRESHED to current-generation rates (`usagepricing.ts`): Fable $10/$50, Opus
  $5/$25, Sonnet $3/$15, Haiku $1/$5, plus the new `fable` family. Caveat: family-substring matching
  loses the version, so a historical Opus-4.0 transcript (billed $15/$75) is priced at the current
  Opus tier — acceptable for an estimate; documented in the code.
- **Scan bound** — OBSOLETE. The `SESSION_READ_CAP`/`USAGE_READ_MAXLINES` text described the old
  frontend scan; the usage scan now runs in the Go backend (`GetUsageStatsCommand` → `usagestats`)
  which walks the transcript roots with no file/line cap.

**Still open:**
- **Codex/OpenAI token breakdown**: the parser handles Codex rollout token totals, but OpenAI has no
  5h/weekly window, so the window bars stay Claude-only and a Codex provider row appears only when
  real data exists for it.

## Cockpit light mode (Paper theme) — 2026-07-03 — DECIDED AGAINST, removed 2026-08-24

The light mode was declined and the code deleted. The `paper` palette entry is gone from `THEMES`
(`frontend/app/view/agents/themes.ts`), along with the now-pointless `ThemeDef.dark` flag and the
`PICKER_THEMES` dark-only filter it existed to drive; the picker, palette commands, and Monaco sync
all read `THEMES` directly. A persisted `paper` preset id falls back to Midnight via
`activePalette`'s unknown-id fallback. The audit work the original entry scoped (hardcoded
light-assumed colors in overlays, scrollbar hexes, `buildThemeVars` greys) is therefore not needed.
The Monaco editor's separate `wave-theme-light` base definition (`monaco-env.ts`) was left alone —
it is editor theming, not cockpit light mode.

## Jarvis sub-project D — attribution tuning constants (2026-07-24)

`pkg/jarvisattrib/edges.go` ships PLACEHOLDER tuning values, to be calibrated against a populated vault before v2 proactive resurfacing trusts hardened edges:
- layer confidence weights: L1=1.0, L2=0.8, L3=0.3
- probation window: 24h (`probationMs`)
- layer-3 time-box (drift decay): 30d (`timeBoxMs`)
- ~~confidence display buckets: weak <0.4, strong ≥0.75~~ — **retired 2026-08-03, not calibrated.**
  `bucketWeakMax` and `bucketStrongMin` were deleted: the display bucket now derives from the edge's
  firing layer (`jarvisattrib.BucketFor`), so there is nothing left to calibrate. They were never
  calibratable — `confidenceFor` returns the max of four fixed layer weights and never blends them, so
  the reachable confidence set is `{0.2, 0.3, 0.8, 1.0}` and no edge could land in the `[0.4, 0.75)`
  "medium" band. See J10 in `git show a4b5bd4f:docs/jarvis-second-brain-open-issues.md`.
- **Layer-3 window — retuned 2026-10-09 from the live vault.** 34 of its 35 dossiers read `active`: a dossier is
  made per dispatched run and nothing closes it when the run finishes. Layer 3 let an active dossier's window reach
  now on status alone, so every old plan in a repo attached to every new run there (run `8b822a9b`'s record band
  read "+14 more" before it had done anything). An active dossier's window now ends at its last update, the end of
  its latest own run, or now only while one of its own runs is executing or planning (`dossierActiveUntil`,
  `pkg/jarvisattrib/extract.go`). The weights, probation and time-box above are unchanged. **Still open:** nothing
  moves a dossier off `active` when its run finishes; that is the root, and this bound only stops it leaking into
  attribution.

## Jarvis U3 — graph edge/node visual tunables (2026-07-27)

`frontend/app/view/jarvis/jarvisgraphderive.ts` (`attributionStyle`) and `jarvisgraph.tsx` ship
PLACEHOLDER visual constants, to be calibrated once a real populated vault is rendered (the current
values were picked to be legible in isolation, not against a dense graph):
- confidence bucket → edge opacity: strong 1.0, medium 0.6, weak 0.35
- confidence bucket → edge width: strong 1.4, medium 1.0, weak 0.7
- `informing` dash pattern: `[3, 3]` (`DASH_INFORMING`)
- run-node square half-extent vs a same-degree circle radius: `RUN_SQUARE_SCALE` = 1.6

Also deferred in U3: search/filter over the graph, a read rail, cross-surface nav out of a node,
live push (the base graph is a snapshot per surface open), and whole-vault attribution — the
attribution bloom is resolved per focused task, never for every dossier at once.

## Diff surface — narrow-window folding and row density (2026-08-03)

- **Diff surface narrow-window folding and row density declined** (2026-08-03). The Git-review mockup folds the commit pane to a chip below ~1100px, drops the author column, folds the graph to three lanes and turns history into a drawer below 900px, and exposes comfortable 34px / compact 28px rows. Both declined in `docs/superpowers/specs/2026-08-03-git-review-history-reads-design.md` decision 2: the cockpit runs at roughly 1600×950, so every breakpoint would be an untested path, and `historypane.tsx` keeps its single `ROW_H = 34`. Revive only on evidence of a narrow-window user.

**PARTLY RESOLVED 2026-09-11 (`19d324e5`)** — the evidence arrived: the app ships a 1000×700 window (`src-tauri/tauri.conf.json`), where a fixed 460px commit column plus the file list leaves the diff pane about 240px. The commit column now folds to a 44px rail below 1280px (`difflayout.ts`, `historyrail.tsx`), and the fold is manually overridable so a resize cannot undo the user's choice. The rest of the cascade stays declined: no author-column drop, no three-lane graph, no history drawer, and `ROW_H` is still a single 34.

## Jarvis pet — 2D creature (2026-08-04)

Deferred out of this cycle:
- **Concierge-tier courier gestures** — carry/hold/escort, i.e. dragging an object onto the creature to
  pocket it and dragging it back out onto a target. Nothing of this remains in the code: the half-built state
  seam (a `petPocketAtom` with a reader and no writer, plus a Pocket section in `petpeek.tsx` that could never
  render) was removed on 2026-08-04, because unreachable UI cannot be tested, silently rots against the atom
  shape it reads, and reads as shipped. Build the store and the gestures together — the renderer's shape
  depends on the gesture it serves (what the drop target looks like, whether the creature changes shape while
  holding), so guessing at it first is wasted work. Design §6.
- **The higher acting tiers on the creature** (Gatekeeper, Delegator). Those flags are per-channel with no
  client-level equivalent (`pkg/jarvis/resolve.go`), so the creature can only express them while acting on a
  specific channel; design §6 records the resolution and nothing in this cycle acts on a channel.

Resolved rather than deferred, recorded because the fix removed something a reader might try to restore: the
two top corners were dropped on 2026-08-04 (the pet's corners became the bottom pair only). They sat on the
surface heading band — the page title on the left, the header's action buttons on the right. Do not re-add
them without a placement that clears a band whose height varies per surface. Design §9 carries the
measurements. Since 2026-10-06 the creature has no stored corner at all: Sprout walks the footer ledge, and
the bubble and peek open from the half of the window it stands in (`cornerFor` in `petledge.ts`).

## Dropped from the initiative sheet by the inline tracker (2026-09-16)

The Brief's initiative rows now expand in place (`inlinetracker.ts` / `inlinetrackerview.tsx`) and the
detail sheet's plan section was removed rather than kept in sync with a second copy of the same plan. The
sheet survives as the **initiative activity** escape hatch (every note on every chunk in one stream), which
the inline sidebar deliberately does not show — the sidebar is scoped to one chunk.

Carried over into the inline tracker: per-chunk notes, add note, set chunk status (which covers what
`reopen` did), add chunk, archive, the `wsh effort show` handle.

Deliberately dropped, with nothing left in the code that half-implements them:

- **Stage renaming and per-chunk stage moves** (`StageInput`, `StageHeader`, `StageTag` and the
  `setChunkStage` run-tail edit). A stage is a label on a consecutive run of chunks, so the editor had to
  express "this chunk down to the next boundary", which is a heavier interaction than a one-line inline row
  can hold. `wsh effort` remains the way to restage. **Back since `c51ee10e` (2026-09-23, edit an initiative's
  plan in place on the Brief):** `briefsurface.tsx` calls `setChunkStage` over a stage's run of chunks
  (`stageRunLabels`), so stage edits have a home again.
- **Per-chunk `owner` and `workrefs`** (the agent/run links under a chunk row). These were two extra lines
  under an expanded chunk in the sheet; the inline row is one line by design and the sidebar is about prose.
  The data is still on `ChunkRowModel`, so restoring them is a render change, not a plumbing one.

Recovery: `git show 6061ff3d:frontend/app/view/jarvis/effortdetailview.tsx` has the full pre-slim file
(746 lines) with all of the above.

## The memory subsystem, removed (2026-09-22)

Measured before removal, across 416 Claude Code sessions and 458 Pi sessions: note **bodies** were opened
in 5.3% of sessions — the behaviour memory actually drove came from the one-line `MEMORY.md` index
entries, not the 867 note bodies behind them. Pi was write-only (arcterm regenerated an 87 KB projection per
session start that nothing read: `pi-memory` was not in `~/.pi/agent/settings.json` packages, qmd was not
installed so `memory_search` could not run, and zero real `memory_search` calls appear in 458
transcripts). Recall telemetry had never worked — `slugify` renamed `_`→`-` on harvest so every stamp
missed, and `writeSourcedNote` never serialized `reference_count`.

Removed: `pkg/memvault` (29 files), `pkg/memdistill`, `pkg/memgarden`, `wshserver_memory.go` (17 RPCs),
`reporadar/collect_memory.go` + the `CollectorMemory` kind, `wsh memory`, `wsh agent-memory-hook`,
`wsh agent-memory-project`, the pi memory extension, the Vault surface and its 16 frontend files, the
pet's memory register (decay polling, the `drifting` condition, `actsForVault`, the `memory:activity`
event and its `baseds` payload types), and `CaptureStatus.DistillQueue`.

Kept, deliberately: `pkg/memroots` and `pkg/wavevault` (Jarvis's whole corpus reads through them, and
`memory:vaultpath` is still the vault root's source of truth), `pkg/jarvisrecall` (decoupled — `ask.go`,
`retrieve.go` and `judge.go` never touched memvault), `pkg/agentsync` (the steering projection Pi does
receive), and `agentsync.memoryRegion`, which now only *preserves* an `ARC-MEMORY` block an older arcterm
left in a steering file rather than writing one. (2026-09-25: `memoryRegion` is gone too, with the
steering-sync cleanup; the leftover blocks in codex and opencode were deleted by hand.)

Two self-healing cleanups ship with it, because a removed subcommand that is still referenced on disk
keeps firing: the `agent-memory-*` forms stay in `isManagedCommand`'s allowlist (recognition is what lets
a stale hook be *pruned*, not what preserves it), `mergeAgentHooks`/`configIsHealthy` now scan every event
present in `settings.json` rather than only the ones arcterm currently manages (`SessionEnd` left
`managedHooks` entirely with `agent-memory-hook`), and `install-agent-hooks` deletes a leftover
`~/.pi/agent/extensions/waveterm-memory.ts`.

Revive only on evidence that note bodies — not index lines — are what changes an agent's behaviour.

Recovery: `git show f5e2179a:pkg/memvault/memvault.go` (and any other path) has the full pre-removal
tree; `git show f5e2179a:frontend/app/view/agents/vaultsurface.tsx` for the surface.

Five agentsync RPCs left with no caller — deleted with the recall arm (2026-09-23); `pkg/agentsync` functions stay.

### The corpus deleted too (2026-09-22), after measuring what still read it

An earlier note here said the vault's `memory/` collection could be deleted because "`tasks/`,
`decisions/` and `attachments/` are Jarvis's corpus." That was wrong: `wavevault.AllScope()` is
`{memory, tasks, decisions}` and `WorkerScope()` is `{memory, decisions}` — `memory` was the only
collection in both, and `jarvisrecall.scopeToVault` returns `AllScope()` on every path.

So the deletion was measured first, against the packaged app's DB rather than the dev profile:

- **Ask Jarvis:** 6 conversations, **8 questions ever**, last on 2026-08-19. 77 grounding cards, 65 of
  them from `memory/`.
- **jarvisproactive** (the automatic consumer, run dispatch): 49 of 88 runs evaluated, **14 hits** —
  13 citing a memory note, 1 a dossier. 26 judge-declined, 6 no-candidates.
- The hits' `why` field was boilerplate in all 14: literally `Related to "<the run goal>"`. Three
  separate runs surfaced the same generic note. One (`project_wave_git_review_scope_decision` on the
  git-review plan) was the real thing the feature exists for.

Decision: usefulness did not match the maintenance cost; a different system gets designed later. All
870 notes deleted from `~/IdeaProjects/obsidian_vault/memory/`. `tasks/` (129), `decisions/` (4),
`steering/`, `skills/` and `attachments/` are untouched — Jarvis still grounds on them, and
`jarvis-vault-recall` still returns cards. `OpenVault` scaffolds the empty `memory/` dir back on open,
so nothing needed repointing.

Recovery is in the **vault** repo, not this one (local-only, no remote):
`git -C ~/IdeaProjects/obsidian_vault show 41047c4:memory/<name>.md`; the deletion is `454938f`.

Still orphaned by all this, not yet cleaned:

- ~~`memroots.AllRoots()` and `memroots.Mirrors()`~~ deleted since (no definition left, checked 2026-10-05).
- Four state files in `%LOCALAPPDATA%\dev.arc.app\data\` have no writer left in the tree:
  `memgarden-state.json`, `memory-distill-queue.json`, `memory-decay-restore-done.txt`,
  `memory-recall-epoch.txt`. They go inert once a build from `main` is installed.
- `jarvisproactive` and the Ask surface — retired 2026-09-23, see "The Jarvis recall arm" below.

### The Jarvis recall arm — retired 2026-09-23

Proactive "related prior work" cards, the Ask surface (the Brief's ask thread, the palette's Ask group,
the Ask Jarvis buttons, the pet's Ask act, `wsh jarvis ask`, pi's `wave_vault_ask`, persisted
conversations) and the embedding index (`pkg/jarvisembed`, attribution layer 4, the Settings Embeddings
section) are deleted. Spec: `docs/superpowers/specs/2026-09-23-retire-jarvis-recall-arm-design.md`.

Evidence, measured 2026-09-23: of 89 runs with a proactive evaluation, 14 hit and one hit was useful;
~14 of 22 agent `wave_vault_ask` calls returned not-found; attribution L4 produced 0 of 352 edges.

Kept: the resume narrative (`jarviscontinuity`), the ledger, attribution L1–3, OpenRouter as the headless
runtime. Its key still lives in the secret `jarvis_embedapikey`, now set from Settings → Headless AI.

Recovery: `git log --diff-filter=D --oneline -- pkg/jarvisrecall pkg/jarvisproactive pkg/jarvisembed`
names the deleting commit; then `git show <commit>^:pkg/jarvisrecall/ask.go` (any path). The table is
recreated by `db/migrations-wstore/000020_drop_jarvisconversation.down.sql`.

Manual cleanup on an existing profile (no code touches user data): delete `data\jarvis\index.db`, the
`jarvis:embedenabled` / `jarvis:embedbaseurl` / `jarvis:embedmodel` lines in `settings.json`, and the
inert `memgarden-state.json`, `memory-distill-queue.json`, `memory-decay-restore-done.txt`,
`memory-recall-epoch.txt` in `data\`.
