# Kael sync (2026-11-13): engine and run views, hardening, API key login, project Overview, Chat cards

Port what the kaeltran16 fork (`kael` remote) added after the 2026-11-12 sync. That sync's spec
(`2026-11-12-kael-sync-code-diff-usage-setup-design.md`) was cut at `d0be5ee41` and said "the fork has no commits
after 2026-11-06"; that is no longer true. `kael/main` is now at `a8f0864d1` (2026-11-12 13:13), with **369 non-merge
commits** after `d0be5ee41`. This spec also takes the **20 engine commits** in `f15fdc695..d0be5ee41` that the
2026-11-12 spec left as "Orchestrate engine changes: judged separately".

## Why this is a port, not a merge

GitHub shows `main` as 1152 commits behind `kael/main`. That count never reaches zero by porting: the last common
ancestor is `a8020da45` (2026-10-19), and every sync since then (11-03, 11-06, 11-12) re-made the fork's behaviour in
new commits, which git does not count as taken. `main` is 3694 commits ahead. A trial `git merge-tree main kael/main`
(2026-11-13) conflicts in **730 files** (440 under `frontend/app`, 49 `pkg/orchestrate`, 43 `pkg/wshrpc`, 35
`cmd/wsh`), so a merge would mean picking a side per file and would break the rule below.

So, as before: read a commit with `git show <hash>`, a file at the fork's tip with `git show kael/main:<path>`, a fork
spec with `git show kael/main:docs/superpowers/specs/<file>`, and port the behaviour into our shape. Use
`git cherry-pick -n` only where it applies cleanly. Run `git fetch kael` first; the hashes below are on `kael/main`.

Before porting a commit, check whether ours already does it: our own work since 11-06 overlaps the fork in places
(for example our `0e9d917d8` already refuses a fence left open over task headings, close to `725085b17`; ours already
has `MergeGateTs` on the dag wire type; ours already has `wsh agents wait` with an `--until`). A part ours already has
is skipped and named in the commit's "Differs from plan". Commits are listed oldest first.

## Owner decisions (2026-11-13)

- **Rendered mode: cards into Chat only.** Ours has Chat, with its own Allow / Deny permission card from our
  `PermissionRequest` hook. Port only the tool-output cards (group 7); skip the Rendered view, its toggle, now line,
  composer and the fork's permission registry.
- **Agent-drawn boards (Excalidraw): left out for now.** A new surface, a heavy dependency and a long-lived scribe;
  revisit later.
- **Project Overview: port it** (group 8).
- **Checkout landing stays.** Skip `c1869154c` (delete checkout landing); every fork fix that assumes runs only land
  on a branch is fitted so `--landing checkout` keeps working.
- **API key login: port it** (group 4).

## Our code wins (the owner's hard rule)

Same rule as the 2026-11-12 spec. The port is additive:

- Never rewrite, rename, remove or restyle an existing behaviour, component, binding, wire field or test of ours to
  match the fork. Where the fork's change and ours touch the same thing differently, ours stays and the fork's
  addition is fitted around it; when it cannot fit, skip that part and name it under the commit's "Differs from plan"
  (and in the run report).
- Prefer new files and small hook points over editing large shared files; an edited file of ours keeps every existing
  line's behaviour, and its existing tests pass unchanged (a test of ours is never edited to make a port pass).
- A plan reviewer or task reviewer treats any changed or removed existing behaviour of ours as a failure.

Fork commits that remove something ours may still have, so they are skipped unless ours provably lacks it:

- `98cd26122` drops may-be-stuck's repeated-failure scan.
- `1feb637d5` drops the lane label from run views.
- `90a09852e` stops installing the `SubagentStop` hook. Ours installs it (`cmd/wsh/cmd/wshcmd-installhooks.go`) and
  our background-subagent handling (`af6f768d0`) relies on it: skip.

## Our differences that matter

- The fork renamed Jarvis to Hub and has a Sessions surface; ours keeps Jarvis, and past sessions are centre modes of
  Agent (Conversation History). A fork change to "Hub rows" lands on Jarvis's Runs; one to the Sessions list lands on
  Conversation History when ours has the same row, else it is skipped.
- CDP scenarios: a new scenario goes in its own new file `scripts/cdp/scenarios-<area>.mjs` (default export taking
  `RT_KIT`, as `scenarios-monitor-tasks.mjs`); one task alone edits `scenarios.mjs` to register them.
- Go is the source of truth for wire types: change the Go and run `task generate`; never hand-edit generated files.
- Colours only from `@theme` tokens; motion follows `DESIGN.md`.
- The cherry-picks the fork made twice are listed once (`ff9e86dd2` = `5821c16bc`, `3c7d6ff32` = `cdb829964` =
  `37f260f26`, `b40931c4e` = `d04b34c9d`); take the later one if they differ.

## Scope

**291 commits to judge** (60 + 17 + 14 + 7 + 20 + 7 + 5 + 9 + 21 + 11 + 71 + 34, and 15 scenario fixes) of the 389;
the other 98 are out of scope (below). Twelve groups; each is its own plan (one engine run each, or the groups one
step of "Order" names together), run in that order.

### 1. Engine core: lands, merges, recovery, plan parsing (60)

`pkg/orchestrate`, `pkg/jarvis` (plan and worker-report parsing, landing seal, worker tabs), `pkg/wshrpc/wshserver`
(dag submit, adopt, land replies). Fork specs: `2026-11-06-live-run-phase2-fixes-design.md`,
`2026-11-09-live-run-phase3-fixes-design.md`.

- Most are fixes for git that fails, times out or is killed mid-step (typed git answers, undo for squash and land, a
  refused merge undone, a `merge --continue` finished, a branch probe git cannot answer). Port them all where ours
  has the same step.
- Land and seal (`c1998c0d0`, `9814ea56c`, `49c31729f`, `9f09d083f`, `43ba106a9`) are written for branch-only
  landing; fit each so a checkout-landing run behaves as it does today.
- Plan parsing (`dc1c00b4a`, `0d79622ee`, `a2c52d70e`, `19be11b27`, `725085b17`, `65f44bce3`, `6c55c3aef`) changes
  what `jarvis.PlanFormat` accepts: a plan ours accepts today and the fork refuses is a behaviour change; refuse only
  what ours would already misparse, and keep `pkg/jarvis/plan.go`'s existing tests passing unchanged.
- `04aea9b2c` runs workers and reviewers at below-normal priority: on Windows and macOS both.

- `04e8340db` fix(jarvis): a channel-less ask carries its agent's tab oref
- `a61a68c95` fix(runevents): read the whole run history, strip ANSI from last line
- `ac548aa57` perf(orchestrate): plan review edges, caller grep, leaner launches
- `04aea9b2c` feat(orchestrate): run workers and reviewers at below-normal priority
- `d977d702f` fix(orchestrate): take-over answers the lead's relay of the question
- `da342d465` fix(orchestrate): workers carry their project; usage counted once per…
- `ff9e86dd2` feat(orchestrate): keep earlier plan-review rounds' reviewers on the dag
- `dcd0ea248` feat(orchestrate): record the final stage's outcome as a final-ended…
- `c3a7aa5fa` feat(runs): wire fields, run event kinds and merge gate/verify lines
- `7378b15a4` feat(events): the human's actions, forwarded failures and a failed…
- `c408b2cd1` feat(orchestrate): action run events, Rerun answers the lead
- `a93cb8ca1` feat(runs): digest forwarded failures, held merge gate, Verify fail line
- `a19baa3ca` fix(digest): held merge gate never stale; only engine retries recover
- `932d4fa34` fix(runs): recovery line counts only the engine's retries
- `f26d786f8` fix(orchestrate): a join waits for every lane it depends on to merge
- `e89f2ddaf` fix(wsh): dag status names why a held merge tip waits
- `b3fbcfa57` fix(orchestrate): a lane's squash message skips commits HEAD has
- `c1998c0d0` fix(jarvis): seal a branch run's uncommitted work from its landing tree
- `dc1c00b4a` fix(jarvis): read plan code fences opened on a list item
- `1765e5dcb` fix(jarvis): read worker-report fences opened on a list item
- `0d79622ee` fix(jarvis): refuse a Depends on line after a task's Files, Model, Chunk
- `a2c52d70e` fix(jarvis): strip a UTF-8 BOM before parsing a plan
- `19be11b27` fix(jarvis): refuse a plan heading that misses the task shape
- `f2f866e4d` fix(orchestrate): classify task states in one table in dag.go
- `7e2075b98` fix(jarvis): keep a worker outcome summary valid UTF-8 at its cut
- `060b57372` fix(jarvis): remove a run worker's tab when its spawn fails part-way
- `e71d45566` fix(jarvis): prune prompt files older than a week
- `0db43e5af` fix(orchestrate): typed git answers and undo for squash and land
- `9f09d083f` fix(wshserver): decide a dag submit before touching the landing tree
- `758220f37` fix(orchestrate): a recovery patch never overwrites an earlier one
- `6b693bb55` fix(wshserver): validate the global profile's width and worker route
- `21e3e86e4` fix(orchestrate): a stale cleanup pass keeps the debt a merge set
- `969ae84ec` fix(wshserver): carry a failed adopt's reason in the reply with its plan
- `c245d90ed` fix(orchestrate): auto-retry cancels the failed worker's run
- `c37355faa` fix(wshserver): record child-created on the parent run's log
- `615d7a2ca` perf(jarvis): read a tab's run off its stamp, not a scan of every run
- `c31e2dfd6` fix(orchestrate): a failed resume in a new tab stops the tab it spawned
- `b2cc11cbf` fix(orchestrate): a stopped final stage's result never ends its rerun
- `1187414b4` fix(orchestrate): a git its context killed is no answer to gitAsk
- `cd62634c0` perf(jarvis): scan for a stale-stamped tab's run once per stamp
- `43ba106a9` fix(wshserver): carry a lead's land past a failed complete in its reply
- `2df05c467` fix(orchestrate): a branch probe git cannot answer is not a merged lane
- `f1f680954` fix(orchestrate): a restarted lane's branch git cannot see is not gone
- `d6629988b` fix(orchestrate): hold the land when git cannot tell it is mid-merge
- `f1ab8a344` fix(orchestrate): log the recovery patch a skip actually wrote
- `6231b6970` fix(orchestrate): finish a merge --continue its caller gave up on
- `ed721ed5c` fix(jarvis): resolve chunk refs against the live plan when a write runs
- `98cd26122` fix(orchestrate): drop may-be-stuck's repeated-failure scan
- `5459268f8` fix(orchestrate): treat a failed digest refresh as stale and retry it
- `5e7ef9081` test(orchestrate): keep worker spawns out of the real claude config
- `3299000a6` fix(orchestrate): a refused squash keeps the lead's staged work
- `09d6aef7c` fix(dag): refuse a plan revision past the review limit before committing
- `e1c8645bd` fix(orchestrate): a failed resume in a new tab puts the closed tab back
- `725085b17` fix(jarvis): refuse an unclosed code fence in plans and worker reports
- `65f44bce3` fix(jarvis): refuse a late Depends line and a one-# task heading
- `76df90972` fix(orchestrate): undo a refused merge on a context that outlives it
- `6c55c3aef` fix(jarvis): read a plan title that starts with "Task <n>" as the title
- `9814ea56c` fix(jarvis): seal a landed run from its merge, not its missing tree
- `49c31729f` fix(jarvis): seal a landed run from the branch tip its land recorded
- `b13e2eb92` fix(orchestrate): let skip stop a running or reviewing task

### 2. Run views: DAG modal, timeline, final stage, tree (17)

`frontend/app/view/orchestrate` and the run rows. `9f9b2f3e9`'s Hub rows land on Jarvis's Runs. Keys (`072d27962`,
`8c544f72c`, `7c9976ed1`, `92b5b04fa`) must leave every existing DAG binding as it is.

- `7477f4a27` fix(dag): ended and plan-review dags state what is true on the graph
- `1c535bc98` fix(dag): task peek review note, worked time, clean Verify tail
- `362ec28e7` fix(final): cancelled Final node, earlier-round details and empty shots
- `06ef4d9c4` fix(orchestrate): DAG modal takes its owner from the dag
- `072d27962` fix(dag): graph keys yield to modals, refit on resize, stage line wraps
- `652fa1a3d` fix(timeline): ended runs, drawer strip, row targets and event counts
- `a728ee85d` fix: The open Lifecycle drawer leaves the graph the larger share (F17…
- `aca599018` feat(dag): Adjust run settings from the Route DAG modal header
- `cff274e28` fix(final-stage): sub-second steps read <1s, Verifier step opens…
- `9d633e0a0` feat(tree): failed tones and merge gate rows in the tree and rail lanes
- `9f9b2f3e9` fix(runs): Hub rows, DAG peek and stage pane read the merge gate
- `8c544f72c` fix(orchestrate): keep the DAG graph's arrows out of a route picker
- `7c9976ed1` fix(orchestrate): let a modal above the DAG modal own Escape and Tab
- `c3d092f4f` fix(orchestrate): offer Cancel in the DAG header while the dag is blocked
- `c4f14e608` fix(orchestrate): clear a timeline hover when the rail unmounts
- `8d14dca57` fix(orchestrate): key timeline groups by their first event, in arrival order
- `92b5b04fa` fix(orchestrate): the DAG modal leaves Tab to a route picker above it

### 3. RPC and wsh plumbing (14)

`pkg/wshutil` routing and connection teardown (pending calls failed when a link goes, routing entries dropped on
timeout or cancel, a replaced link's requests moved to its successor), transcript tail reads. Go only; unit tests
port with the fixes.

- `77e8981e2` fix(wshutil): cancel a gone link's in-flight requests at unregister
- `19ec190db` fix(wshutil): drop a cancelled or timed-out rpc's routing entry
- `bd59fc337` fix(wshutil): fail a client's pending calls when its connection drops
- `cceba5f02` fix(wshutil): send an error when a response cannot be encoded
- `3855fa5fe` fix(wshserver): advance the transcript tailer by the bytes it read
- `e26c57a74` fix(wshserver): end an ask wait by claiming its own ask, not the block's
- `f238499ca` fix(wshutil): a request racing the rpc's close fails with an error
- `e0af2c88f` fix(wshutil): close the conn error channel when output ends cleanly
- `a7a346710` refactor(web): drop the per-link reap that UnregisterLink already does
- `7e19941e8` perf(wshserver): read transcript tails and heads without the whole file
- `e7978e227` fix(wshutil): fail requests whose destination link goes away
- `13d7f66d8` fix(wshutil): drop a routing entry once its request has timed out
- `1b6048399` fix(wshutil): let a gone link's queued response beat its route error
- `1d67a3d29` fix(wshutil): move a replaced link's unanswered requests to its successor

### 4. API key login (7)

Fork spec: `2026-11-09-claude-api-login-design.md` (plan `2026-11-09-claude-api-login.md`). An API key row beside the
Claude accounts in Settings, stored through `pkg/secretstore`; Usage's quota displays read "API key" while claude
uses one. Fit it beside our account switch (`2026-10-07-claude-account-switch-design.md`) without changing how an
account switch works today. `dfe90a373` only matters to a dev app (`ARC_DEV_NO_GLOBAL_INSTALL`).

- `3c7d6ff32` feat(secretstore): read a secrets file directly and flush on demand
- `c8d174373` feat(claudeaccount): wire types and commands for an API key login
- `163feb38a` feat(usage): quota displays read "API key" while claude uses one
- `7e6e98cb8` feat(settings): API key row beside the Claude accounts
- `dfe90a373` fix(jarvis): API key switch uses the dev app's own wsh without global install
- `c32ee25f8` fix(secretstore): fail the load when secrets.enc cannot be read
- `8856f82d5` fix(secretstore): retry a failed debounced write

### 5. Live-run states: lead card, events, naming (20)

The rest of the fork's live-run phase 2 and 3 UI: the Cockpit lead card (plan review row, lane wait, clock,
forwarded rows, merge gate, refusals), the Events rail's milestones and the lead's ask, a run's lead named by the
plan title everywhere, the session that started a run, the Brief's Behind you rows. Depends on group 1 for its wire
fields (`c3a7aa5fa` is in group 1 by scope; take its wire part first).

- `362376243` fix(cockpit): live-run review: run cards, tree, rail, Final, Sessions
- `608c29497` feat(runs): record the agent session that started a run
- `30604b711` feat(cockpit): lead card plan review row, lane wait, clock, route, pane
- `7441ea81a` fix(cockpit): one need-you count; space on a done row shows its…
- `663fc42f0` fix(cockpit): Events rail shows run milestones and the lead's ask
- `32828637e` fix(agents): accepted plan review, landed lead rail, close-run wording
- `d2b38bab3` fix(sessions): idle lead reads idle, accepted plan review reads accepted
- `400e47b70` fix(agents): name a run's lead by the run's plan title
- `a506a294b` fix(agents): name a worker header's lead by the run's plan title
- `6ef5ee4bc` fix(agents): name the lead by the plan title in rail and composer
- `9b2b2b865` feat(brief): Behind you rows show the latest note and run initiative
- `d4984e754` fix(brief): name a dag'd run's lead by its plan title in the composer
- `9d2e1fbf2` fix(cockpit): lead card forwarded rows, merge gate, refusals, progress
- `9ea34975e` fix(agents): refuse a prompt to a block no terminal can take
- `142dc92c5` fix(agents): the run carries its plan title, naming its lead early
- `7295fec74` fix(agents): a worker tab joining its run is placed from its first frame
- `52939d137` fix(agents): an agent that exited to its shell leaves the roster
- `ad2e2cae5` fix(agents): list a backgrounded run under Backgrounded while its lead idles
- `56d1be199` fix(agents): retry a failed run-event load and merge it with live events
- `1feb637d5` refactor(agents): drop the lane label from run views

### 6. `wsh agents`: explain, send --wait (7)

`wsh agents explain <tab>` (it reads the live terminal screen through `8897f387c`'s registry), `send --wait` failing
fast and naming the real state, an ask whose answer never arrived unlocked. Ours already has `wsh agents wait`: take
only what `ffe84cf3b` adds beyond it. `e5b3e8ca2` (a permission prompt reads as asking) applies to our
`PermissionRequest` hook too.

- `8897f387c` feat(term): registry to read a block's live terminal screen
- `8479d6a85` fix(agents): send --wait fails fast when no turn starts
- `ffe84cf3b` feat(agents): wsh agents wait <tab> [--until idle|asking]
- `603a21a35` feat(agents): wsh agents explain <tab>
- `e5b3e8ca2` fix(agents): a permission prompt reads as asking, not idle
- `ad650942f` fix(agents): send --wait timeout names the target's real state
- `8051926e0` fix(agents): unlock an ask whose answer never reached the agent

### 7. Chat cards from Rendered mode (5)

Fork spec: `2026-11-09-agent-rendered-view-design.md`. Port the renderer registry only as far as Chat needs it, and
the chart, test, git diff and image tool-output cards into Chat's tool rows. The `arc:charts` skill overlaps our
`arc:visual` (which already draws charts inline in Chat): take the chart card only for tool output and skip the skill
unless it does something `arc:visual` cannot; name the choice. Not the Rendered view (see Out of scope).

- `3967bf2b0` feat(agents): renderer registry skeleton and timeline hooks
- `05cd5978b` feat(agents): chart card renderer and the arc:charts skill
- `fac332dfc` feat(agents): test, git diff and image tool output cards
- `68fe3ddef` fix(agents): open a tool-call group that holds a card in Rendered
- `b904bee43` fix(agents): fold an expanded tool-call group again from its header

### 8. Project Overview (9)

The fork kept no spec for it, only plans it later deleted: `git show
9327ab637:docs/superpowers/plans/2026-11-06-project-overview-body.md` and `git show
3dcdcbda4:docs/superpowers/plans/2026-11-06-project-overview-body-round1.md`. A page
per project: Activity calendar, Branches commit graph, Running and Finished, 30-day History, loading skeletons the
shape of what they load. Ours has no project switcher row like the fork's; the plan decides where its button sits
(proposed: on the project folder row of the Agent tree, opening as a centre mode of Agent through `centerModeAtom`,
like Conversation History, not a new surface) and adds its keys to `bindings.ts` and `docs/keyboard-shortcuts.md`.
Its motion is in group 10 (`049f8c449`).

- `492a5d892` feat(overview): lay out the project Overview body's four regions
- `89afce8f6` feat(overview): draw the project Overview's Activity calendar
- `ac2d5da37` feat(overview): draw the project Overview's Branches commit graph
- `1125dd21b` test(keybindings): give the dispatcher test models projectOverviewAtom
- `022314aef` feat(overview): fill the project Overview's Running and Finished regions
- `ae2c6194f` feat(overview): fill the project Overview's History region
- `08897d461` fix(overview): History run line and ended-run target
- `fe9c34e7d` feat(overview): row overview button, level columns, 30-day History
- `65cd90251` fix(overview): loading skeletons the shape of what they load

### 9. Brainstorm (21)

Fork spec: `2026-11-10-brainstorm-working-visibility-design.md` (the Working view's step line and turn boards). Ours
has the same lineage (`brainstormpane.tsx`, `brainstormmodel.ts`, the approve bar in `brainstormcheck.tsx`) and has
since moved the brainstorm's cards into Chat; port each fix where ours still has the view it fixes, else name it
skipped.

- `992ef5a05` fix(brainstorm): review rows keep a readable gist at 1000px
- `250a9b7f1` fix(brainstorm): judge's approach rows read prose first, paths dimmed
- `675fdd692` fix(cdp): brainstorm-mode 12b waits for the tab meta to clear
- `a134231ab` fix(cdp): brainstorm-mode's terminal runs cmd, not pwsh
- `73804ffad` feat(brainstorm): working-turn model and BrainstormState.turn
- `b4e906ffc` feat(brainstorm): poller reads the turn boards' canvas.json
- `35f7f0a75` feat(brainstorm): step line and turn boards in the Working view
- `c875d91c4` test(cdp): brainstorm-working scenario for the Working view's turn
- `57f582167` fix(brainstorm): every wait on the user raises attention, not just a question
- `b36259a16` fix(agents): reload a brainstorm board opened full size
- `92a5b078e` fix(brainstorm): several boards in a row go under its text
- `d9391a634` feat(brainstorm): batch keep, put back and confirm into one line
- `b87535add` fix(brainstorm): read a blank answer, working or run as unset
- `7d040e3ca` fix(brainstorm): stop the judge on a terminal answer; resume ended talks
- `52b441a03` fix(brainstorm): an answered check stays taken through later turns
- `862de11f9` fix(brainstorm): Change on the approve bar approves first, when allowed
- `cb14179e2` fix(brainstorm): a removed board's way back stays in the brainstorm
- `5b1bc9c9f` fix(brainstorm): Change on the approve bar opens the launcher, sends nothing
- `f41b7b0f8` fix(brainstorm): a taken builder check stays taken through later turns
- `f14f8d54e` fix(canvas): fade the canvas pane in, and each board once it loads
- `386dc37b8` fix(brainstorm): hide Change on the approve bar while a run waits

### 10. Motion sweep (11)

Fork plan (deleted since): `git show 4b2d0fb77:docs/superpowers/plans/2026-11-10-motion-sweep.md`. Primitives 10 to 17 go into our motion module
beside the existing ones, then each view's state changes animate. Runs last, after the views it animates exist
(group 8 for the Overview); a view ours lacks is skipped. Respects reduced motion as our primitives do.

- `b40931c4e` feat(motion): add primitives 10-17 and the motion-sweep scenario stubs
- `41b391773` feat(motion): animate the hover and ctrl-click peeks
- `58aea87e1` feat(motion): animate the run sheet's state changes
- `d1169555d` feat(motion): animate the brainstorm views' state changes
- `64a2f11ac` feat(motion): animate the final stage and its screenshot viewer
- `275138d07` feat(motion): animate the Brief's controls and the new-run setup
- `93807082a` feat(motion): animate the workflow lens, canvas and doc review
- `cec4424b5` feat(motion): animate the Agent surface panes' state changes
- `a5a4503eb` feat(motion): animate the initiative brief's pages
- `959f789e9` feat(motion): animate the Diff surface's history, review and storage
- `049f8c449` feat(motion): animate the Code surface, project Overview and image zoom

### 11. Surface fixes (71)

Small fixes across Agent (Diff compare and history, Usage, Cockpit keys, rail loads, subagent list), Code (saves in
flight, blame after HEAD moves, UNC paths, the review bar), Jarvis (run sheet, Chunk sidebar, notes), Settings and
the terminal. Each applies only where ours has the code it fixes. Fork specs: `2026-11-09-surface-followups-3-fixes-design.md`,
`2026-11-10-surface-review-followups-4-design.md`.

- `4feac14d3` fix(docreview): keep section lines between findings as subheads (P4)
- `87c41274b` fix(switcher): let a click outside close the project dropdown
- `114ec261c` fix(diff): poll re-resolves a session start unknown at load
- `d44a2ac58` fix(docreview): review title follows the lead's proposal
- `d11601550` fix(jarvis): mark Runs rows new since your visit again
- `95a2087f6` fix(code): keep text typed while a save is in flight
- `82812c992` fix(agents): derive the Shift+Tab cycle and keep the typed mode
- `637ffcc76` fix(agents): cycle from an unknown focus starts at the first row
- `8f9eb23bf` fix(agents): drop an older rail load that lands after a newer one
- `63c387a6b` fix(agents): resolve a canvas owner among agents still open
- `7a1e79d2c` fix(jarvis): scope the Chunk sidebar's Escape claims to Jarvis
- `c04c43c12` fix(jarvis): drop a superseded run landing before it moves the sheet
- `d1e37856d` fix(jarvis): show the pending face while a sheet's channel switches
- `2f8b9d0d7` fix(jarvis): resolve a queued note delete against the current trail
- `53d165453` fix(jarvis): keep the cursor and open notes on a renamed chunk
- `a6c8d7a6f` fix(agents): keep the Cockpit's bare keys off chords and tabbed buttons
- `69fe2c548` fix(agents): keep a change-list reload off a scope's in-flight load
- `807ac1ab3` fix(agents): drop compare reads the Diff surface has moved on from
- `60ce4c1ca` fix(agents): drop history filters when the Diff moves to another repo
- `d9d06ee7f` fix(code): stop the delete confirm promising git history it lacks
- `1acfc9627` fix(code): keep slow saves and reads out of the file and project now open
- `a7bbbaa94` fix(jarvis): reset the run sheet's local state when stepping runs
- `a754da7a6` fix(jarvis): keep each run sheet's steer draft to its own run
- `75641dc01` fix(jarvis): ignore a repeated Ctrl+Enter while an initiative is created
- `9670f802a` fix(jarvis): drop the Chunk sidebar's note draft when the chunk changes
- `f1f50f16f` fix(jarvis): keep a delete hidden while its write is in flight
- `719258ad4` fix(agents): advance past an answered ask within the Cockpit's project scope
- `b3d52c54c` fix(agents): send a failed review's typed guidance with the keyed Send back
- `2ac6e6680` fix(agents): let the cursor scroll a rail jump whose row was not drawn
- `cdc48d3e8` fix(term): stop a disposed terminal's cache loop
- `695dd651c` perf(agents): skip the background-agents poll while hidden
- `1fd6e6cd2` fix(agents): mark Events read only in the project scope it was pressed in
- `e64e3d980` fix(agents): keep an agent's subagent list when a read fails
- `71161dbe7` fix(agents): keep a refreshed history list and show the retry skeleton
- `445d85851` fix(agents): skip re-selecting the row a list move is clamped to
- `80e1879d7` fix(agents): keep the selected history row in view as it moves
- `1a6900249` fix(agents): tie a comment send's progress and error to its own source
- `c27bb69b4` fix(code): run a second save after the one in flight, not beside it
- `bac890d0e` fix(code): keep a UNC root's leading separators when joining a path
- `3f90d1590` fix(code): close the review bar's popovers when its last comment goes
- `fdba7144c` fix(code): keep clicks in the rename field from opening or folding the row
- `970ec40e3` fix(code): show the Files tree when the toolbar starts a new file
- `ced18f783` fix(code): drop an open comment draft when another project opens
- `77948cf63` fix(code): refetch blame when HEAD moves under the open file
- `da619c65f` fix(agents): return Usage's row cursor to its own scope card going up
- `44a3ca961` fix(agents): clear the daily chart's brush box when its range resets
- `40265f520` fix(agents): stop Usage re-registering its list nav on every clock tick
- `2da93e63c` fix(agents): title a claude session from a prompt sent as blocks
- `1c5483194` fix(settings): Escape abandons a field's draft, Enter commits once
- `82ad8b873` fix(settings): show a failed storage scan, clear or save
- `50a18903b` fix(settings): Terminal font reads the shipped bare family name
- `cdf4c25ea` fix(agents): keep a pinned session's cache entry past the window
- `53c9d409f` fix(settings): Vault re-reads sync status while a sync runs
- `0191a6e95` fix(settings): Scrollback row shows the 2000 lines terminals keep
- `6c8607ea7` fix(settings): a refused settings write says so
- `50d3f796e` fix(agents): never cache a transcript whose read failed
- `70be37f02` fix(agents): apply and swap compare refs during a list reload
- `306bedf60` fix(code): New file opens a collapsed Code sidebar and focuses its name
- `5a76460d8` fix(agents): every compare action uses the comparison's repository
- `f2a2c187c` fix(agents): a landed Send back clears the task's review guidance
- `3645543bf` fix(code): a queued save runs even after another file opens
- `e7c42eb8c` fix(code): an edit back to the old text during a save is kept
- `69b408a9f` fix(agents): compare's j/k and Enter use the comparison's repository
- `f0c3a2189` fix(agents): a filter or retry during a change-list load keeps history
- `68ac085a8` fix(agents): leaving Diff while compare loads branches cancels it
- `e71a5d459` fix(code): a blame read before HEAD was known refetches when HEAD moves
- `11d5e8d11` fix(agents): never cache a pi session whose own read failed
- `a23df368a` fix(agents): compare column and history rail follow the selection
- `079503915` fix(jarvis): a record or graph peek left set holds Escape on Jarvis only
- `e2a68bbc9` fix(jarvis): renaming a stage keeps its cursor and fold
- `a4a39f742` fix(jarvis): keep the chunk sidebar's note draft across a chunk rename

### 12. Stores, sync, hooks and install (34)

`pkg/wavevault` (git timeouts, `index.lock`, the lock released during fetch and push, effort notes merged against
the base), `agentsync` (CRLF `SKILL.md`, case-insensitive skill dirs, retired shipped names), `effortstore` and
`notestore` holding the vault lock across a read, `wsh install-agent-hooks` never overwriting a `settings.json` it
could not read, the Claude mod's goalpost guard on Windows paths, pi and opencode session cache, Usage billing of pi
entries, the Tauri host (external URLs without a shell, log rotation). `90a09852e` is skipped (see Our code wins).
Edit `claude/arc-mod/`, never `cmd/wsh/cmd/claude-mod/`.

- `828356a12` fix(transcript): stream waits for a missing transcript folder (P1)
- `d26df2b5c` fix(blockcontroller): a resize to a block with no controller is quiet
- `5d93c0f49` fix(initiative): short work ids in notes, Notes count with marks, just…
- `90a09852e` perf(hooks): stop installing the SubagentStop hook
- `8b2088d15` perf(gitinfo): one rev-parse per change read; status takes no locks
- `88bedf307` fix(tauri): open external URLs without a shell
- `e84190ea4` fix(wsh): never overwrite a settings.json the install could not read
- `81cfba592` fix(usage): bill a forked pi session's copied entries once
- `a341995a8` fix(wsh): keep a user's hook that shares a group with an Arc hook
- `57b939c54` fix(effortstore): hold the vault lock across Update's read
- `d65594736` fix(agentsync): never adopt a skill under a retired shipped name
- `eedfcadd2` fix(agentsync): match harness skill dirs to vault names case-insensitively
- `fed97e1e8` fix(claude-mod): judge Windows file paths in the goalpost detectors
- `aae9224b8` fix(agentsync): read the frontmatter of a CRLF SKILL.md
- `abd886f03` fix(agentsync): keep a steering file's text when its end marker is gone
- `8d2bed4e6` fix(effortstore): list efforts without a glob of the vault path
- `1ece91003` fix(claude-mod): send a cockpit prompt that starts with a path as a prompt
- `7f0627eb4` fix(usage): bill pi's type:usage entries
- `4449981e6` fix(wavevault): bound git calls by the timeout, not a helper's pipe
- `6fa51ef03` fix(wsh): read settings.json after the claude version probe
- `64e3c131f` fix(wavevault): remove the index.lock a timed-out git leaves behind
- `e2c1dfeab` fix(wsh): keep installing the other agents when settings.json won't parse
- `226a4192a` fix(tauri): keep logging when waveapp.log cannot be rotated
- `59f6c705e` fix(wavevault): release the vault lock during sync's fetch and push
- `05da38329` fix(wavevault): merge effort notes, events and workrefs against the base
- `9e0fc711a` fix(consult): remove a held stderr capture once it is let go
- `3d8ec7369` fix(hooks): a nested claude no longer takes over its outer agent's row
- `2f17ea213` fix(notestore): hold the vault lock across Add and Update's read
- `c9f2f9d1c` fix(wavevault): a killed fetch or push leaves index.lock alone
- `8d6a6fb79` fix(claude-mod): goalpost's shell checks read Windows backslash paths
- `57dff0eb5` fix(agentsessions): do not cache an opencode session whose read failed
- `324a652ed` fix(claudemod): mask commit and tag messages before the guard rules
- `c0f606fd2` fix(claudemod): submit a cockpit slash text the session won't run
- `ea5c40ad1` perf(scripts): share one npm install per lock across worktrees

### Scenario fixes (15)

Take a fix only for a scenario ours has; otherwise it goes with the group whose scenario it is.

- `0e87a66c9` test(keybindings): give the dispatcher's fake models the overview atom
- `d826a4758` test(arc-view-mod): refresh lead prompt fixtures for the header rule
- `527980dc2` test(cdp): agent-tree-rail 9b waits for the tree to settle, 9c no…
- `070304476` test(cdp): sessions-list-states asserts the archive loaded before idle
- `92cbb8591` test(cdp): agent-header fixture tabs run no controller; fix fmt drift
- `03f95fa24` fix(cdp): boot wait covers the rpc client; tidy waits for the mod copy
- `03b937ef4` fix(cdp): closing the main window skips attach's boot wait
- `14efb6f6a` fix(cdp): agent-tree-rail's lead tabs are real shell blocks
- `2e2584c1a` test(cdp): dismiss picker-flip toast, restore You label check
- `8a50d6157` test(cdp): give shell-tasks fixture agents real controller-less blocks
- `ea3336765` fix(cdp): final-stage reseeds a States row an engine tick overwrote
- `19e9075d3` fix(cdp): motion-run-sheet reads the strip's color before the change
- `ecb96e17e` fix(cdp): brief-peek polls for the decision form's exit
- `a3f09b1f2` test(cdp): fix the 24 scenarios failing on main under final-verify
- `54f253b45` test(arc-view-mod): send the confirm-all line, not the removed confirm

## Out of scope

Skip every hunk of these.

- **Rendered mode** beyond group 7, and the fork's permission registry (ours has Chat's permission card); take
  `22ebedf8e`'s ask-hook half only if ours' ask hook fails outside Arc:

- `dbd40d400` feat(agentask): permission wire types, event and stub handlers
- `bcccc0fcf` feat(wsh): permission hook, managed entry, mode and tool key on status
- `6ee3b1989` feat(agentask): permission registry, delivery and retirement
- `32ecd517c` feat(agents): Rendered view toggle, composer and picker flip
- `21e8cd4e7` fix(agents): polish the Rendered timeline from a live review
- `016c28f1e` fix(cdp): one app-module loader; agent-rendered test card reads the new row
- `e3463699a` fix(agents): the permission band's No types Escape; reload keeps open prompts
- `cabcfcc3e` feat(agents): Terminal/Rendered becomes an icon toggle; Ctrl+Shift+B flips it
- `12c2ea022` feat(agents): Transcript entries carry their time; Now line model
- `b1e787b6f` feat(agents): Rendered gets a writing-card composer with attach and…
- `2c2ab69c0` feat(agents): Rendered fills the center and shows the now line
- `9e892090b` fix(agents): a model-invoked Skill no longer restarts the now line turn
- `40445d2e3` fix(agents): hide the header chip for a permission mode it can't change
- `06b66924d` fix(agents): let keys answer the Rendered view's ask dock
- `c47f7ac80` fix(agents): anchor permission marks by time, not entry index
- `fcef988c3` fix(agents): retire a permission request when its tool call fails
- `22ebedf8e` fix(wsh): let the permission and ask hooks no-op outside Arc

- **Agent-drawn boards** (Excalidraw, `pkg/boardstore`, the scribe, `wsh board draw`, the Boards surface):

- `ba45e360b` docs: spec and plan for Agent-drawn boards (Excalidraw)
- `0fdbb6f85` feat(boards): board wire contract, board:update event, excalidraw dep
- `0e15fe933` feat(boards): boardthings renders a source's text; TurnsSince
- `fdd6ee92c` feat(boards): the scribe's prompt, reply check, runner and scheduler
- `f643ec1d1` feat(boards): Board files and inbox (`pkg/boardstore`); Board file RPCs
- `cd7f7f98a` feat(boards): the scribe in wavesrv: Draw, follows and wsh board draw
- `173f2298b` feat(boards): Board scene model (frontend, pure); Board store, draw…
- `69f7fbaf3` feat(boards): Draw on a board… in the palette
- `507623992` feat(boards): board and Stop chips on a followed agent's tree row
- `48994cbcd` feat(boards): the Boards surface, its canvas, g w and toast actions
- `7d8604ca3` docs: spec and plan for Agent-drawn boards: round 1 fixes
- `548888c94` fix(boards): The palette boots, and the board drill's scenarios run; A…
- `c0fe0df32` docs: spec and plan for Agent-drawn boards: motion round
- `dda8174f1` feat(boards): motion for the board tree's rows and blocks
- `eef3f56cd` docs: drop the shipped agent-drawn boards plans

- **Early start**, which the fork built and then reverted ("its gain is under 3%"); ours never had it:

- `24afb2bd4` feat(orchestrate): early-start task fields and lane predicates
- `c2ac784e5` fix(orchestrate): do not retype For later tasks to a running dependent
- `ab1dcd2b3` feat(orchestrate): hold an early lane's merge for its base lane
- `563ebe94d` feat(orchestrate): start a cross-lane dependent on a worker-done lane
- `f8ce873b8` feat(orchestrate): digest the early base, held merge and restarts
- `c1de57653` feat(orchestrate): restart an early lane when its base goes back to work
- `38a4ef54c` fix(orchestrate): discard a restarted lane's tree on its next dispatch
- `6bf20ee68` revert(orchestrate): drop early start, its gain is under 3%

- **Checkout landing removal** (owner decision):

- `c1869154c` refactor: delete checkout landing; every engine run lands on a branch

- **Session full-text search and the fork's Sessions surface** (out of scope since the 2026-11-12 sync):

- `b5cf55baf` feat(sessions): Copy session id in a row's menu; Latest glides down
- `3baa311b8` fix(agents): stop a live session's reread snapping the find back
- `094154e9e` fix(agents): open a search hit in the run session it was found in
- `7e9f92935` fix(agents): keep a pending session search from posing as its last answer
- `ad04319a3` fix(agents): read an unclosed quote in a session find as the server does
- `c164d8bd9` fix(agents): give each session search snippet a unique row key
- `71e83e446` fix(sessions): re-centre the find when a longer read lands
- `f6a1d0156` fix(sessions): closing the find bar keeps the hit's session in view
- `631602896` fix(sessions): a pending search over an empty answer shows no summary

- **Jira** and **remote mode / the phone page** (as in the 2026-11-12 sync):

- `b8e21a4eb` feat(jira): pick the project a ticket's initiative starts in
- `809b3d89f` fix(jira): connection status is per site, email and token
- `19b3e1c21` fix(remotemode): regenerate the projector bundle
- `4fec46c68` chore(remote): regenerate projector bundle for transcript ts

- Version bumps, lint chores, the fork's workflow chore, and commits that only add or drop the fork's own specs and
  plans:

- `7fde1cfd1` chore(wstore): clear gopls lint leftovers
- `5635ab963` chore(workflow): worker UI checks, model naming, fixtures, pytest cache
- `bb6eb069e` chore: bump to 1.0.1
- `8a70c8061` chore: sync package-lock to 1.0.1
- `9327ab637` docs: spec and plan for Project Overview body: Activity, Running…
- `d04ea746a` docs: spec and plan for Live-run states phase 2 fixes (P1-P22)
- `3dcdcbda4` docs: spec and plan for Project Overview body: round 1 fixes
- `902026b4c` docs: Overview keys in the shortcut list; drop the shipped plans
- `e036e939e` docs: spec and plan for Live-run states phase 2 fixes, round 1
- `42f5537b2` docs: spec and plan for Live-run states phase 2 fixes, round 2
- `0b5ff0645` docs: drop the shipped live-run phase 2 fix plans
- `e4c08c45f` docs: spec and plan for Surface review follow-ups, round 3: code fixes
- `f7a0271e3` docs: spec and plan for Live-run states phase 3 fixes (Q1-Q19)
- `a4dfc4d17` docs: follow-ups 3 spec matches what landed; drop the shipped plan
- `85cf16642` docs: spec and plan for API key login beside the Claude account switcher
- `be39287bf` docs: spec and plan for Live-run states phase 3 fixes, round 1
- `446169ead` docs: phase 3 spec matches the merge; drop the shipped plans
- `bd19c36cc` docs: drop the shipped API key login plan
- `0d11e66d4` docs: spec and plan for Agent surface: Rendered mode
- `7cf0e6bac` docs: spec and plan for Agent surface: Rendered mode, round 1 fixes
- `360475643` docs: mark the Rendered mode spec shipped, drop its plans
- `f59b185c0` docs: spec and plan for Surface review follow-ups, round 4: fix plan
- `c27d56844` docs: spec and plan for Surface review follow-ups, round 4: fix round 1
- `99fa04adb` docs: spec and plan for Surface review follow-ups, round 4: fix round 2
- `cac872c1f` docs: drop the shipped follow-ups-4 plans; correct spec D6
- `72a9d7042` docs: spec and plan for Brainstorm board: show what the agent is doing —
- `23f9fc2e2` docs: rendered-view-better spec and claude-api-login plan
- `fc0731187` docs: spec and plan for Rendered view: know what it is doing now
- `b56ca2e56` docs: brainstorm Working view's step line and turn boards
- `af6e28618` docs: spec and plan for Rendered view: know what it is doing now, fix…
- `0a3a4edd1` docs: spec and plan for Rendered view: know what it is doing now, fix…
- `4b2d0fb77` docs: spec and plan for Motion sweep: animate the UI built since the…
- `edb120584` docs: spec and plan for Motion sweep, Final round 1 fixes
- `f0aa4aefe` docs: spec and plan for Motion sweep, Final round 2 fixes
- `55a9091a8` docs: list the sweep's view-swap wrappers and two Framer traps
- `1451d3304` docs: track initiative fallout growth in its own initiative
- `e27903a80` docs: align orchestrator docs with the engine's thresholds and wakes

- The duplicate cherry-picks named above:

- `5821c16bc` feat(orchestrate): keep earlier plan-review rounds' reviewers on the dag
- `cdb829964` feat(secretstore): read a secrets file directly and flush on demand
- `37f260f26` feat(secretstore): read a secrets file directly and flush on demand
- `b22e2d242` feat(agentask): permission wire types, event and stub handlers
- `b39aa5216` feat(agentask): permission wire types, event and stub handlers
- `ac3135b85` feat(agentask): permission wire types, event and stub handlers
- `d04b34c9d` feat(motion): add primitives 10-17 and the motion-sweep scenario stubs

## Order

1. Groups 1, 2 and 3 (engine, run views, RPC): Go-heavy; Verify `node scripts/verify.mjs ./pkg/orchestrate
   ./pkg/jarvis ./pkg/wshutil ./pkg/wshrpc/...`.
2. Groups 4, 5 and 6 (API key, live-run states, `wsh agents`): need group 1's wire fields.
3. Groups 11 and 12 (surface and store fixes): independent of the rest, can run beside step 2.
4. Groups 7, 8 and 9 (Chat cards, Overview, brainstorm), then group 10 (motion) last.

Each plan with frontend tasks puts `task check:ts` in its Check, and names a CDP scenario for every view it changes
(Final: `node scripts/cdp/final-verify.mjs <scenarios>`). A user-visible change adds its `CHANGELOG.md` line; a change
not tried in the app adds a `docs/hand-checks.md` line titled "(arcterm) Kael sync 11-13: …".

## Done when

- Every listed commit is ported, or named as skipped with a reason (already ours, our code wins, no such view in
  ours) in its group's run report.
- No existing behaviour or test of ours changed; checkout landing still works end to end.
- The Overview's RAM is measured once (it is not long-lived, but it reads git history) and noted under "RAM watch" in
  `docs/open-issues.md` only if it holds memory after it closes.
