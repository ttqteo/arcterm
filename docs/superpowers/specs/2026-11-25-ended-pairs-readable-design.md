# Read a judge pair again, on either machine

Date: 2026-11-25. Brainstorm: `.superpowers/brainstorm/ended-pairs-readable/brainstorm.json`.

**Prototype:** `.superpowers/design/ended-pairs-readable/project`

One board, `B-under-worker-session.dc.html`: Library's Conversations with a pair nested under the working agent's
session, open read-only in the detail pane. Sample copy is Vietnamese, from the mit-thesis pair of
`2026-11-25-agent-pair-judge-design.md`. The rejected placements (a fifth Library tab, a shared tab with Councils,
`wsh read` alone) are in `.superpowers/design/ended-pairs-readable/unchosen/` and are not part of the spec.

## Why

A pair (a working agent and its judge, `pkg/agentpair`, spec `2026-11-25-agent-pair-judge-design.md`) can only be read
while it is live, in the Agent surface's centre, tied to the working agent's tab. Once it ends it leaves every list, and
nothing in the cockpit shows it again. The person works the mit-thesis repo on two machines and moves its Claude history
between them with `history/sync_history.py` (in the mit-thesis repo, not this one); that script carries transcripts,
memory, councils, boards and "Mark for later", but not pairs. So on the other machine a pair's conversation and its
Decided list are gone, though both agents' transcripts are there.

The person wants: every pair of the repo synced to the other machine, readable there and here in Library, nested under
the session of the agent that worked, and readable as text with `wsh read`.

## What runs today

- A pair is one JSON file, `<data dir>/pairs/<id>.json` (`pkg/wshrpc/wshserver/wshserver_pair.go:41`; type `Pair`,
  `pkg/agentpair/pair.go:75`). Its sides are cockpit tab ids (`Side.Tab`, `pair.go:50`), which mean nothing on another
  machine. It stores `Project` and `CreatedTs`, no session id, no transcript path, no last-updated time.
- States: `relaying`, `stopped` (the stop rule: settled, token cap, no new points, judges gone), `ended` (Unpair, a
  failed start, or the working agent gone: `manager.go:388`, `manager.go:854-858`).
- An ended pair leaves the in-memory index (`manager.go:140`); `PairList` and `PairGet` see only pairs in it
  (`manager.go:190`, `manager.go:212`). Nothing lists ended pairs.
- `Manager.Load` (`manager.go:579`) walks every pair in the index at boot and asks the link for each tab's state; a tab
  this machine does not have reads `LinkGone` (`wshserver_pair.go:184-189`), and a gone worker ends the pair with a system
  line. A file from another machine dropped into `pairs/` would be ended here, and could later overwrite the live one.
- The pair's view is `PairConversation` (`frontend/app/view/agents/pairpane.tsx:77`): the thread, with a composer
  (`PairComposer`, `:510`), Reply (`:418`) and Run now (`:454`). The Decided list is the rail tab built from the same
  `PairView`.
- Library has four tabs, `conversations | canvases | councils | boards`, switched with `1`–`4`
  (`frontend/app/view/library/librarystore.ts:32-35`). Conversations is Conversation History
  (`frontend/app/view/agents/conversationhistory.tsx`): sessions and orchestrator runs, no councils. Councils is a list
  that opens a council under a Back row (`showLibraryCouncil`, `librarystore.ts:135`; the Library Councils key,
  `frontend/app/store/keybindings/bindings.ts:296`).
- The Overview's History column already nests runs and councils under the session that started them: `historyRows`
  (`frontend/app/view/agents/projectoverviewmodel.ts:337`) places a council by the session id it carries
  (`Council.SessionId`, `pkg/council/types.go:626`), a run by its origin transcript, and puts the rest top-level by time
  with "Started from the cockpit, not a session".
- `wsh read` reads an agent, run, council, past conversation and initiative (`cmd/wsh/cmd/wshcmd-read.go`), not a pair.
- `sync_history.py` (mit-thesis `history/sync_history.py`) syncs councils by a per-council file: only this repo's, newer
  `updated` wins, paths inside the repo stored relative and turned back into each machine's absolute paths, an id moved
  under `history/archive/` is out of the sync for good.

## Design

### A pair remembers its sessions

When a pair starts, and when a judge joins, the pair stores each side's **session id** (the transcript file's name, the
id Claude and pi use) beside its tab. It also stamps an **updated time** on every save. It stores no machine id (Agent's
call, builder question 4): the folder a pair file sits in says where it came from (below). Session ids survive `sync_history.py`, so the other machine can nest the pair
under the same session; tab ids do not. A pair saved before this change has no session ids: it lists top-level by
its last message's time (it has no updated time either), as a council no session started does.

### Sync: every pair of the repo, read-only on the other machine

`history/sync_history.py` in the mit-thesis repo gains a section like Councils: `history/pair/<id>.json` in the repo,
arcterm's pair files on each machine.

- Every pair whose `project` is this repo moves, **in every state**, relaying included: the person cannot tell ahead when
  a pair is over.
- A pair in a machine's own `pairs/` folder was made there, and only those are pushed into the repo (Agent's call,
  builder question 4: no machine id). A pair from the repo is pulled only into a separate folder of synced pairs, never
  into `pairs/`, and the pair `Manager` never loads that folder: no relay, no gone-tab check, no state change. It shows
  the pair as of the last sync; a pair that went on where it was made arrives newer at the next sync.
- The script reads the installed arcterm's data dir, as it does for councils (`ARC_COUNCILS_DIR`-style override for the
  pairs folders). The dev app keeps its own data dir, so pairs made in the dev app are not synced.
- Newer `updated` wins. Paths inside the repo (`project`) are stored relative to the repo and turned back into each
  machine's absolute path, as councils are.
- A pair moved under `history/archive/` is out of the sync for good, in both directions.
- This part is a change to the mit-thesis repo; the arcterm part is the synced-pairs folder, which arcterm reads.

### Library: Conversations holds pairs and councils; the Councils tab goes

- In Library's Conversations, a pair nests under the working agent's session (by the stored session id), as a run does
  under the session it started from. A council nests under the session id it carries. Pairs and councils no listed
  session started stand top-level by time. Conversations shares the Overview History's **placing rule** only, not
  `historyRows` whole (Agent's call, builder question 1): the rule that puts a run, council or pair under a session moves
  into one function with no 7-day window and no project filter, used by both Histories. Conversations keeps every
  project, its recency groups, paging, search and "All activity", and an orchestrator run stays its own entry. A pair or
  council whose session is on a page not loaded yet stands top-level by its own time, and moves under the session once
  that page loads; one older than every loaded session waits until the pages reach its time (planning section, "The
  frontier").
- The Councils tab is removed: Library keeps Conversations, Canvases and Boards, switched with `1`–`3`. Every way that
  opened an ended council on Library (`showLibraryCouncil`, the Library Councils key, Jarvis openers) opens it in
  Conversations instead, in a new full-width `council` view (`libraryConvViewAtom` gains `council`, as it has `run`)
  that keeps every council view: Discussion, Report, the seat filter and a Back row; the openers carry `view` and `only`
  there (Agent's call, builder question 3). `docs/keyboard-shortcuts.md` follows.
- **Filter chips** Judge and Council sit over the list. With one on, the list shows only pairs (or councils), flat, newest
  first, each row naming the session that started it; with both on, both kinds. Off, the list is the nested one.
- **The Councils tab's other features move into Conversations, behind the Council chip** (builder question 2): with the
  Council chip on, the council benchmark (`CouncilBenchChart`, folded to one line until opened) sits over the list; a
  council row keeps Pin/Unpin and Resume, its hover button and menu, as on the Councils tab today
  (`councilhistoryview.tsx`); Conversations' search finds councils too. The `go:councils` key (`o`,
  `bindings.ts:291-297`) opens Conversations with the Council chip on.
- A pair's row reads its working agent's title, the judge's short id, and why it stopped or that it is still relaying.
- Opening a pair shows it in the detail pane, **read-only**: the header (working agent, judge, when it ended or its state
  at the last sync, tokens), the thread as `PairConversation` draws it without the composer, Reply and Run now, and the
  Decided list beside it (agreed, what the person answered, still open). A line at the bottom links both agents'
  transcripts. A pair synced from the other machine reads the same. Opened from outside Library (`wsh ui`, Jarvis), a
  pair shows in a full-width `pair` view under a Back row (Agent's call, builder question 3).
- The Overview's History nests pairs under their session too, by the same placing.

### `wsh read <pairId>`

`wsh read` takes a pair's id (live, ended or synced) and prints the pair as text: a header line (working agent, judge,
project, state and why, tokens), each message as `[hh:mm] Who → Whom` with its text, then Decided (agreed, the person's
answers, still open). An agent can read it as well as the person.

## Left to the builder

- The names of the new fields (each side's session id, the updated time) and of the synced-pairs folder under the data
  dir.
- How the other machine's synced pairs reach the frontend: an RPC that lists ended and synced pairs for a project, or
  `PairList` with an option. Whatever it is, it never routes a synced pair into the `Manager`.
- How `PairConversation` and the Decided view take a read-only mode.
- The changes to `historyRows` and its use from Conversation History; the Library tab removal and every opener moved.
- The text layout of `wsh read <pairId>` beyond what is above.
- The `sync_history.py` change itself (mit-thesis repo): one section beside Councils, its docstring updated.
- CDP scenarios: a pair nested under its session in Conversations, the Judge and Council chips, a pair open read-only, and
  Library with three tabs. A `CHANGELOG.md` line for the person (pairs and councils now live in Conversations).

## Testing

- Go: the new fields saved and read; a synced pair is never loaded into the `Manager` and never changes state; listing
  includes ended and synced pairs for a project; `wsh read` on a pair prints the thread and Decided.
- Frontend: `historyRows` places a pair under its worker's session, a pair without a session id and a council without
  one top-level; the filter chips' rows; the read-only view's model drops the composer, Reply and Run now.
- mit-thesis: `sync_history.py` moves a pair of this repo in every state, pushes only from its origin, keeps the newer by
  `updated`, and skips archived ids.
- UI: the CDP scenarios above, on the merged tree.

## Decisions made while planning

The builder's calls on what "Left to the builder" names, and on what the spec left open. Every task builds on the
shapes fixed here.

### Storage and wire

- **Field names.** `agentpair.Side.Session` (`json:"session,omitempty"`): the agent's session id, the transcript file's
  name without its extension (`agentobserve.TranscriptSession`). `agentpair.Pair.UpdatedTs` (`json:"updated"`, ms):
  stamped by `Manager.saveLocked` on every save. `updated` is the key councils use, so `sync_history.py` compares the
  two the same way. Wire: `wshrpc.PairSide.Session` (`session`), `wshrpc.PairInfo.UpdatedTs` (`updatedts`; a file
  saved before this change has no `updated` and reads its `LastTs`), `wshrpc.PairInfo.Synced` (`synced`: the pair came
  from the synced folder).
- **Folders.** `<data dir>/pairs/` stays the own folder (`agentpair.DirName`); synced pairs go in
  `<data dir>/pairs-synced/` (`agentpair.SyncedDirName`). The `Manager` only ever gets `Dir` = the own folder: nothing
  in it names the synced one.
- **When the session ids are taken.** At Start (the worker and the judge) and when a judge joins, derived by the
  `Manager` from `Link.Agent`'s existing `AgentFacts.Transcript` with `agentobserve.TranscriptSession` (no new facts
  field). A side that had no transcript yet when it joined (a judge launched with the brief) gets its id at its first
  turn end. Why: a briefed judge's transcript can appear only after `PairStart` returns. The first id a
  side gets is kept for good (a `/clear` later does not move the pair to the new session): the pair happened in that one.
- **How the frontend reads them.** A new `PairHistoryCommand(CommandPairHistoryData{Project})` returns every pair file
  of the own folder (every state, live ones included) and of the synced folder as `[]PairInfo`, newest first;
  `Project ""` is every project, matched as councils match a project path. It reads the files, never the `Manager`, so a
  synced pair can never enter the index. `PairGetCommand` reads the `Manager` first and, for an id it does not hold
  (`agentpair.ErrNoPair`), the own folder's file and then the synced folder's (`agentpair.Read`). An id is checked
  against `^[A-Za-z0-9_-]{1,64}$` before it names a file. Why one new command and not a `PairList` option: `PairList` is
  the live index the Agent surface reads on every `pair:update`; the history read walks folders and has other callers.
- **An id in both folders** reads the own folder's copy: the sync never pulls a pair into the machine that made it, so
  this only happens with a hand-copied file.

### Library

- **Selection keys.** In Conversations a pair is selected as `pair:<id>` and shown in the detail pane, on the model's
  existing `sessionsSelAtom` (as `run:<id>` and `all` already are). A council row opens the full-width `council` view
  (`libraryConvViewAtom = "council"`), as the Councils tab's rows open a council under a Back row today.
- **Full-width views.** `LibraryConvView` gains `council` and `pair`; `libraryPairSelAtom` holds the full-width pair.
  Their Back is `leaveLibraryDetail` (the list, and the surface the jump came from), so Escape follows
  `libraryOpen().detail`; the council view's Escape still stands down while the council holds it (`councilHoldsEscape`).
  `openPair(model, id)` is the one route that opens a pair from outside its views: a pair in the live list
  (`pairListAtom`) opens on Agent's centre (`showPair`), any other (ended, synced) in Library's full-width `pair` view.
- **Chips.** `libraryConvKindsAtom: { judge: boolean; council: boolean }` in `librarystore.ts`. `go:councils` (`g o`)
  and the `surface:councils` address open Conversations' list with `{ judge: false, council: true }`. With a chip on,
  the status filter (All / Live / Needs you / Done) is hidden, since the rows are not sessions; both off is the nested
  list.
- **Nesting.** The placing rule (`historyplace.ts`, `placeUnderSessions`) finds a council's owner by `sessionid`, a
  pair's by its worker's `session`, a run's by its origin transcript (the Overview's use). In Conversations an owner
  that is a run's member session nests the item under that run's entry; any other owner, under its session's entry. A
  nested row is a tree line (`└`), as the board draws it; a top-level pair or council is a card of its own, placed by
  its own time in the recency groups.
- **The frontier.** While older pages are still unread, a top-level pair or council older than the oldest loaded
  session waits (the Overview's `rowsUntil` rule) rather than standing at the end of the list. Why: with every council
  of every project read at once, the first page would otherwise end in a long tail of old councils above the paging
  trigger, reshuffled by each page. It stands top-level by its own time once the pages reach its time.
- **The status filter and loose rows.** Live / Needs you / Done filter sessions and runs; a nested pair or council rides
  with its entry; a top-level pair or council shows under All only.
- **Search.** While the box holds a query, councils (`searchCouncilHistory`) and pairs (worker name, judge short id,
  project) that match show as their own section above the session results; the backend search stays sessions-only.
- **Council rows.** A nested council row and a flat one both keep Pin/Unpin (hover button and context menu) and Resume
  (menu), with the actions of `councilhistory.ts` / `councilresume.tsx`. The flat list uses the Councils tab's row view
  (`CouncilHistoryRowView`, exported); the old `CouncilHistory` list component goes with the tab. The bench chart sits
  over the list while the Council chip is on.
- **Keyboard.** Nested pair rows are in the list's `j`/`k` order (selecting one shows it in the detail pane); council
  rows are not, since selecting one leaves the list.
- **Row text.** Nested pair: `Pair with judge <short id> · <state words>`. Top-level or flat pair: the worker's name as
  title, `Judge <short id> · <state words>` under it, and in the flat list the session that started it (its label, else
  `Started from the cockpit, not a session`). State words: `settled` → "both sides settled", `token-cap` → "token cap
  reached", `no-new-points` → "no new points", `judges-gone` → "judges gone", ended → "ended", relaying → "still
  relaying"; a synced pair adds "as of the last sync". One function (`pairStateWords`, `pairreadmodel.ts`) says them on
  every surface.
- **Read-only view.** `PairConversation` and `RailDecidedPane` take a `readOnly` prop: no top bar, composer, Reply,
  Run now, Unpair or answer chips (an answered ask still shows its answer). `PairReadView` (`pairreadpane.tsx`) is the
  header, the read-only thread, the read-only Decided list beside it, and a foot line with both agents' transcript
  links. A link opens the session `<harness>:<session id>` (the Conversations selection key): in the detail pane it
  selects that session in the list, in the full-width view it goes through `showLibrarySession`. A side with no session
  id has no link. A live pair opened in Library reads the same, read-only; the Agent surface is where it is driven.
- **The prototype board still draws four tabs.** The spec's later decision (three tabs, councils in Conversations) wins.

### `wsh read`

- `pair` joins `readKinds` after `council`; candidates come from `PairHistoryCommand` (every project), the text from
  `PairGetCommand` through `agentpair.Document(view)`: `# Pair <id8> · <worker> · judge <short ids>`, a line with
  project, state and why, tokens of the cap, `Synced from another machine` when it is, then `[hh:mm] Who → Whom` and the
  text of each message (Who/Whom: Worker, Judge <short>, You, System; a worker's message goes to the live judges, a
  person's to its `To`), then `## Decided` with Agreed, Your answers and Still open.

### Not in this run

- **`sync_history.py`** lives in the mit-thesis repo, which no task of an arcterm run can change: the lead writes it on
  a branch of that repo (`sync-pairs`) with its own check, and the run's report names it for the person to merge.
- **The What's new lines** are an ordinary `Added` and `Changed` pair, not `<!-- big -->`: a big line needs a picture
  taken in the dev app, which no worker has; a `docs/hand-checks.md` line asks for the shot and the promotion.
