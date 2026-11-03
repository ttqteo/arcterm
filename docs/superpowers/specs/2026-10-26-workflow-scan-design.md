# Workflow scan: suggest fixes from run records

Initiative: `effort:d1f57603-3f5c-4fc0-abfd-888e6acf6213`. Brainstorm: `.superpowers/brainstorm/workflow-scan/brainstorm.json` (gitignored).
Prototype: `canvas:workflow-scan`, boards in `.superpowers/design/workflow-scan/project/` (gitignored): `Main.dc.html`
(the Workflow lens with suggestions to decide), `Palette.dc.html` (the palette action), `States.dc.html` (idle, scanning,
nothing to suggest, not raised, raised again, done, fix in another project). The owner settled them in quick run
`c01c384f`; they are the authority on presentation. Their numbers are probe data re-dated to 10-12..10-26, and some
counts and every SHA, time and cost are placeholders.

Ported from the kaeltran16 fork (`kael/main` at `16b726ffd`), where this file is
`docs/superpowers/specs/2026-10-26-workflow-scan-design.md`. arcterm builds the cheap port (plan
`2026-11-03-workflow-scan-core`): the corpus, the Sonnet pass, the recount and the Opus agent are the fork's; the
Workflow lens, its picks, its Needs you item and its CDP scenario are not built. A section or line that no longer holds
here is marked **Superseded in arcterm: …** and the fork's text under it is kept as the record of what was not built; a
difference that leaves the rest standing is marked **In arcterm:**. The initiative, the brainstorm and the prototype
boards named above are the fork's and are not in this repo; the boards draw the lens, so they are superseded too.

## Intent and why

Arc's run records show the same workflow problems recurring across runs: a Final scenario that reads data the
empty store lacks, a skipped red step filed under the wrong report section. Nobody reads 100 runs to notice them.
A scan has a model read the recent records and name the patterns seen in 3 or more runs that the current files do
not already cover. For each one it proposes a small edit to the prompt or config file that causes it. The owner
approves or drops each edit.

## Goals

- On demand, find workflow problems that recur across 3 or more lead runs in the last 14 days and that the
  current files do not already address.
- For each, draft a one-to-three-line edit to the file that causes it, with the evidence that it recurs.
- Apply and commit only the edits the owner names.

## Non-goals and anti-goals

- **No findings store** (owner's constraint). No memory-like layer to maintain. Radar (retired, `docs/deferred.md`) is
  a different feature, but its failure mode was an untriaged findings list. Nothing persists between scans except
  what lands in git (applied edits and Declined entries in `docs/deferred.md`) and the latest scan run's own record,
  which the Workflow lens reads and the next scan replaces. The owner accepted that view as within this rule.
- No scheduled or after-seal scans. One sealed run cannot show a 3-run pattern, and a scan nobody is there to triage
  repeats Radar's failure.
- No session transcripts or worker transcripts in the corpus.
- Suggestions are not terminal text. The owner rejected that in the mockup run ("TUI is not it").
  **Superseded in arcterm: there is no lens to show them in.** The agent presents them with `AskUserQuestion`, which
  arcterm already projects into the cockpit as an agent waiting on the owner; picks typed into a terminal stay out.

## Evidence this works (the 10-26 probe)

The corpus builder (`.superpowers/dag-measure/corpus.mjs`, local and gitignored) read the packaged store: 106 runs,
1,183 signal lines, about 204k tokens. One Opus agent took about 10.5 min and about $6.50, unoptimized: it read the
corpus in chunks over 49 turns, with 15.6M cache-read tokens. As a control, it rediscovered the Check-path pattern
(be564a7a, already fixed) and filed it as covered.

The agent made 6 proposals. A hand-written regex recount (`verifyprobe.mjs`) confirmed 4 of them as real, unfixed
and recurring:

| ID | Finding | Runs | Fix target |
|---|---|---|---|
| P1 | Final's dev app starts on an empty store, and Final scenarios read data it lacks | 11 | AGENTS.md, the plan-format paragraph |
| P2 | A skipped "watch it fail first" step is filed under Differs from plan, not Not verified | 14 | `workerContract`, `pkg/orchestrate/engine.go` |
| P3 | Plans ask workers for whole-package runs, and no plan reviewer flags it | 11 | `planReviewChecklist`, Tests lens, `pkg/orchestrate/planreview.go` |
| P6 | eslint gives `scripts/**/*.mjs` no Node globals | 4 | `eslint.config.js` |

Of the other two, one was overcounted (7 runs claimed, 2 found) and one cited evidence from the wrong run. That is
why code recounts before a human sees anything.

Where the runs came from: the store's signal-bearing lead runs are 69 from waveterm, 32 from SIEM
`cyber_anomaly_detector`, and a few others. P2's runs were 13 `cyber_anomaly_detector`, 2 `cyber_assistant` and 2
waveterm, yet its fix lives in Arc's engine. P1, P3 and P6 were all waveterm runs.

Recurrence speed: each confirmed finding reached 3 runs within 7 days.

## Decisions

### Trigger and window

A scan runs only when the owner asks for one. It reads the last 14 days of run records, a fixed window, not "since
the last scan", so nothing is stored. Patterns recur fast enough for 14 days to catch them with margin. Signal-bearing
lead runs number about 18 to 28 a week.

### Corpus: run records only

The corpus is the probe's, as is: every Arc-only failure and correction signal from runs in the window, keyed by the
run that holds it. It reads all projects (see Scope). The signal list, from `corpus.mjs`:

- Run events (`db_runevent`):
  - `plan-reviewed`: `findings`
  - `task-review-failed`: `taskid` and `note`
  - `task-review-passed`: `unverified` (a reviewer caveat), when set
  - `child-ask`: `taskid` and `question`
  - `task-told`: `taskid` and `text`
  - `land-held`: `reason`
  - `task-failed`: `taskid`, `lastfailurekind` and `detail`
  - `task-verify-failed`: `taskid` and `detail`
  - `lead-wake-failed`: `lines`
  - `task-retried` and `review-overruled`: their data
- Run evidence (`db_run`):
  - per DAG task, `differs`, `foundnotfixed` and `notverified`
  - `evidence.dag.told` entries
  - `verification.reasons`, tagged with `verification.state`
- Text that is empty, "none" or "undefined" is skipped. Each field is cut at 1,500 chars (`MAXFIELD`).

Each line keeps its run id, its kind tag and the run's date. Sizes measured over 14 days: about 100k tokens of run
records.

Left out on purpose:

- `child-answered` events: they hold only the ask id, not the answer text.
- `task-lead-told` events: they are hand-off notes between tasks, not corrections.
- Session prompts: about 3,000 typed prompts, or 138k tokens, in 14 days. They carry no reply context and no run id
  to recount against.
- Worker transcripts: failure loops showed up in only 0.6% of them.

**In arcterm:** every event kind and evidence field in the signal list above exists in arcterm's run records under the
same name (checked against each event's writer in `pkg/orchestrate`, and by the `liveprobe` over a snapshot of the
store), so none is dropped or remapped. The corpus reads `RunEvent.Detail` and `RunEvidence` as they are.

### Cost shape: Sonnet notices, Opus confirms

1. A Sonnet pass gets the whole 14-day corpus in one prompt. It returns candidate patterns, each with a named fix
   target and, for every run it cites, one verbatim quote from that run's lines. It is pinned to claude/sonnet:
   `consult.Run` with `consult.SpecForTier("claude", consult.TierMid)`, not `HeadlessSpecForTier`. That one follows
   the `headless:runtime` setting, which defaults to openrouter's one cheap model, and the owner chose Sonnet by name.
2. Code recounts the candidates (next section).
3. Only the survivors reach Opus. Opus is the scan run's own agent (see "Where suggestions show"). It checks each
   survivor against the current files and drafts the edits.

### Recount: verified quotes, counted by run

For each cited run, code keeps the run only if its quote appears in that run's corpus lines, after both are
normalized for whitespace and case. It counts distinct runs, keyed by the run that holds the signal. A candidate
survives with 3 or more verified runs. Agent's call (builder check): no roll-up. `parentleadoref` is a tab oref
(`tab:<id>`, `pkg/waveobj/wtype.go`), set on 0 of 2,074 runs in the packaged store. DAG task signals and evidence
already sit on the lead run, which is also what `verifyprobe.mjs` counted. The distinct-day count is shown beside the run count, for Opus and the
owner to weigh. It is not a gate. Quote verification covers both of the probe's model errors: the overcount and the
misattributed citation. Nothing in the recount is model-written: no model-supplied regex.

### Where suggestions show and how an edit is applied

**In arcterm** there is no Workflow lens on Usage, no new Needs you item kind and no picks command. A scan is a quick
run on Opus whose agent runs `wsh workflow scan` (the corpus, the Sonnet pass and the recount; it returns the
survivors with their evidence), checks each survivor against the current files and `docs/deferred.md`, drafts the
edits, and writes its verdicts to the scan run's record with `wsh workflow result`. It then presents its proposals and
takes the owner's picks itself, with Claude Code's `AskUserQuestion`: one question per `suggest` verdict, options
Apply and Drop, and a reason for a Drop in Other. arcterm already projects `AskUserQuestion` into the cockpit as an
agent waiting on the owner, so nothing new is built to show it. Per answer:

- Apply, the fix is in the scan run's repo: the agent makes the drafted edit there and commits it with the other
  applied edits.
- Apply, the fix is in another project: never applied from this run. The agent shows the project, file, where and the
  edit as text to copy there.
- Drop: the agent adds the Declined entry to the `docs/deferred.md` of the repo the scan runs in (below), with the
  reason from Other.
- No answer: left alone, neither applied nor declined.

Because the picks never leave the agent, these fork parts are dropped: `WorkflowScanPicksCommand`,
`GetWorkflowScanCommand`, `WorkflowScanPick` and `WorkflowScan.Picks`, the `applying` state, `workflowscan.PicksLine`
and `ValidatePicks`, `wsh workflow picks`, and the fork's commit `19c627337` (it resumed a closed agent to deliver lens
picks). The scan's state stays `picking` while the agent asks; the run's own Done or Cancelled ends the scan. The
agent's instructions are `pkg/workflowscan/goal.go`; its `arcProject` is `arcterm`.

**Superseded in arcterm: the Workflow lens and its clickable picks (not built, the agent asks instead).** The fork's
design follows, kept as the record.

A scan is a quick run on Opus whose agent runs `wsh workflow scan`. That command builds the corpus, runs the
Sonnet pass and the recount, and returns the survivors with their evidence. The agent then:

1. checks each survivor against the current files and `docs/deferred.md`
2. drafts the edits
3. writes the result to the scan run's record for the lens
4. waits for the owner's picks
5. applies and commits the edits picked for Apply
6. writes the Declined entries for the ones picked for Drop

The suggestions show in a new **Workflow lens on the Usage surface**, beside By provider and By work (`Main.dc.html`).
Each suggestion is a card showing:

- its pattern
- its verified run count and distinct days
- a chip per project
- a verbatim quote per run, with the run id as a link
- the fix target
- the drafted edit as a diff

Below the cards sit "Already covered" and "Under 3 runs" rows.

Picks are clickable: Apply or Drop on each card, and a reason field when you drop. One primary button ("Apply 2,
decline 1") sends the picks back to the scan run's agent. A scan waiting on picks shows under Needs you. The lens
shows the latest scan's outcome until the next scan replaces it, read from that scan run's record. `States.dc.html`
draws the other states: idle, scanning with its stages, nothing to suggest, everything covered or still declined, a
declined pattern raised again because its count grew, and done (the commit, applied and declined).

An earlier answer put the suggestions as terminal text in the run's Agent tab, with picks typed to the agent. The
owner replaced that in the mockup run. Memory hygiene's review rail was considered and dropped, because
`pkg/memhygiene/store.go` persists open and kept items across checks.

### Scope: all projects, edits only in the run's repo

The scan reads every project's runs. A fix whose target is in the scan run's repo gets Apply, and the agent commits
it there. A fix whose target is in another project gets "Copy for #<project>" instead of Apply, with the text that will
be copied, and is never applied from this run (the fix-in-another-project state on `States.dc.html`). Reading only the current project would have cost P2: waveterm alone has 2 of its runs, below the floor.

**In arcterm** there is no Copy button: the agent shows such a fix as text in its reply and its report, and never
applies it (see "Where suggestions show").

### A dropped suggestion stays dropped

When the owner drops a suggestion, the scan's agent adds a short Declined entry to the `docs/deferred.md` of the repo
the scan runs in, creating the file if the repo has none (owner, builder question 1 and brainstorm answer 10). This
overrides the mockup's version, which offered the entry as copy for the fix repo's `docs/deferred.md`; where a board
shows that copy, follow this section instead. The entry holds:

- the owner's reason
- the verified run count at the time

The Opus stage reads `docs/deferred.md`, files a matching candidate as declined, and raises it again only if its count
has grown past the recorded number. `docs/deferred.md` already holds dated declines, so this adds no store.

Agent's call (builder check): matching and the count comparison are the Opus agent's judgement, not code. A new
candidate's wording never matches an old entry's exactly, so there is nothing for code to key on. To keep entries
legible to that agent, each one is a section in the file's existing style:

```
## Workflow scan: <pattern, one line> (declined YYYY-MM-DD)

<owner's reason>. Fix target: <file>. Verified runs at decline: N. Raise again only above N.
```

**In arcterm** the reason is what the owner typed in Other. A Drop chosen with none typed is written with "No reason
given." in its place; the fork's lens held its button until every Drop had a reason.

### How a scan starts

**Superseded in arcterm: in the app the one way in is the palette's Scan workflow row, which starts the scan in the
home project and opens the scan's agent, not Usage > Workflow; there is no Projects > #name action.** The fork's text
follows, kept as the record. `wsh workflow scan --start` and `wsh workflow scan` as described below hold.

There are two ways:

- `wsh workflow scan --start` starts the Opus quick run in the repo it is run from, with built-in instructions. They live
  in code, not a prompt the owner retypes.
- A "Scan workflow" action in the cockpit command palette (`frontend/app/cockpit/command-palette.tsx`) starts it in
  the home project: the active one, else the last used, else the only one. Projects > #name > Scan workflow starts it
  for any other project. Both open Usage > Workflow (`Palette.dc.html`).

A scan in any repo reads and writes that repo's own `docs/deferred.md` for declines (owner, builder question 1), so a
pattern declined in one repo's scan can come back in another's.

Without `--start`, `wsh workflow scan` prints the survivors. That is what the run's agent calls. A quick run starts
today through `wsh runs start <goal> --runtime claude --model opus`. Reuse that path.

### The probe's four findings stay held

P1, P2, P3 and P6 stay unapplied, by the owner's call on 10-26, and the first real scan must raise them. The owner
chose this knowing the window moves: by the time the scan exists, only P2 is sure to still have 3 runs in it (11
runs since 10-15). P1, P3 and P6 drop out unless they recur.

## Left to the builder

- **Where the scan code lives:** a wsh command over a wshrpc call into wavesrv, or wsh reading the store directly.
- **The corpus port:** porting the signal list above to Go, including the per-field cut.
- **The Sonnet prompt and its output schema:** patterns in 3+ runs, one verbatim quote per run, a named fix target.
- **The Opus run's instructions:**
  - check each survivor against the current files and `docs/deferred.md`
  - draft one-to-three-line edits
  - write the structured result
  - wait for the owner's picks
  - apply and commit only in the run's repo
  - write Declined entries for drops
- **The structured scan result on the scan run's record,** which the Workflow lens reads:
  - survivors with their quotes, fix target and drafted edit
  - covered, declined and under-floor rows
- **How the lens's picks reach the run's agent.** Superseded in arcterm: they never leave the agent, which asks with
  `AskUserQuestion`.
- **The Needs you item** while picks are pending. Superseded in arcterm: the waiting agent is the item the cockpit
  already shows; no new kind.
- **A `--window` flag** beside the 14-day default, if testing needs one.
- **The usage role,** so the Usage surface attributes the Sonnet pass.
- **A CDP scenario** (`scripts/cdp/scenarios.mjs`) for each state the boards draw. Superseded in arcterm: no lens, so
  no state to draw; see "Tests and checks".
- **Tests:**
  - unit tests for the recount: quote match after normalization, one count per run, the 3-run floor
  - tests for the corpus builder on fixture records
  - Agent's call (builder check): no unit test for the revive count, because the Opus agent compares it (see "A
    dropped suggestion stays dropped")

## Builder decisions (lead, 10-26)

The "Left to the builder" items, settled. Each says what was chosen and why.

### Where the code lives

- **Corpus, recount, Sonnet prompt, reply parse and the Opus run's instructions: a new pure package
  `pkg/workflowscan`.** It takes runs and events as values and returns text and structs, so the corpus port and the
  recount are unit-tested without a store or a model.
- **The scan runs in wavesrv behind wshrpc commands, not in wsh reading the store.** wavesrv owns the store and
  already shells out to `claude -p` through `pkg/consult`; wsh opening the SQLite file would be a second writer path.
  Handlers: `pkg/wshrpc/wshserver/wshserver_workflowscan.go`. Commands: `cmd/wsh/cmd/wshcmd-workflow.go`.
- **`wsh workflow scan` passes a 20-minute RPC timeout.** The default wshrpc budget binds the server's context, and a
  Sonnet pass over ~100k tokens takes minutes. The Sonnet call itself is bounded at 15 minutes.

### The record: `Run.WorkflowScan`

A scan run is a quick run whose record carries a typed `WorkflowScan` field (`pkg/waveobj/wtype.go`), not meta keys,
so the frontend gets generated types and there is one source of truth. It holds:

- `State`: `scanning` | `picking` | `applying` | `failed`. Done and cancelled are the run's own `Status` and are not
  copied here.
- While scanning, `Stage`: `read` | `patterns` | `recount` | `checking`, with the counts the Running board shows:
  `Runs` (runs read), `Projects`, `Candidates` (Sonnet's patterns), `Kept` (survivors), `Dropped` (run blocks cut for
  size, below), and `WindowDays`, `FromTs`, `ToTs`.
- `Survivors` and `UnderFloor`: written by code at the end of `wsh workflow scan`, so every number and quote a card
  shows comes from the recount, never from a model.
- `Verdicts`: the Opus agent's judgement per survivor (below).
- `Picks`: the owner's picks.
- `Error`: why the scan failed, shown on the lens.

The scan run is marked with `WorkflowScan` (state `scanning`, stage `read`) when it is created, before its agent can
call `wsh workflow scan`, which refuses a run that is not a scan. The lens reads the newest run that has a
`WorkflowScan` (`GetWorkflowScanCommand`), then follows that run's object through the usual WaveObj updates, so
stages and verdicts show as they land. A newer scan replaces it; nothing else is kept, which is the spec's no-store
rule.

**In arcterm:** `State` is `scanning` | `picking` | `failed` (no `applying`), there is no `Picks`, and there is no
`GetWorkflowScanCommand`, since no lens reads the newest scan. `picking` lasts while the agent asks the owner. Of the
paragraph above, only "marked when it is created, before its agent can call `wsh workflow scan`, which refuses a run
that is not a scan" holds; the lens sentences are superseded.

### Corpus

- Window: runs whose `createdts` is within the last 14 days. `--window <days>` overrides it; the lens never sets it.
- Every run in the window that holds a signal is a block, keyed by the run that holds it, as the spec says. The lens
  labels the count "runs", not "lead runs", since that is what it counts. Brainstorm sessions and scan runs are left
  out.
- A run's project is its channel's name, else the base name of its project path.
- Block header: `### run <first 8 of id> · <YYYY-MM-DD> · <project> · <goal, cut to 100>`; lines `[<tag>] <text>`,
  with the tags and the 1,500-char per-field cut (`MAXFIELD`) as `corpus.mjs` has them.
- **Size cap: 640,000 chars (~160k tokens).** Over it, the oldest blocks are dropped first and `Dropped` records how
  many. Why: a busy fortnight must not push the one Sonnet prompt past its context and fail the whole scan.

### Sonnet pass

- `consult.Run` with `consult.SpecForTier("claude", consult.TierMid)` plus `--session-id <new uuid>`, in the scan
  run's project directory.
- Output: one fenced `json` block, `{"patterns":[{"title","fixtarget","citations":[{"run","quote"}]}]}`. `run` is the
  8-character id from the block header; `quote` is copied verbatim from that run's lines. The prompt asks only for
  patterns seen in 3 or more runs, and for the fix target as `<file> · <symbol or section>`.
- A reply with no parseable block fails the scan with the reason; it is not retried. Why: a retry doubles the cost of
  the most expensive call, and the owner can start another scan.

### Recount

- A citation is verified when its run id resolves to exactly one run in the window and its quote, lower-cased with
  whitespace collapsed to single spaces, is a substring of that run's lines treated the same way.
- **A quote shorter than 24 normalized characters is not verified.** Why: a quote like "tests fail" matches nearly
  every run and would verify nothing.
- Runs count once each per pattern; a pattern survives with 3 or more. Distinct days are the distinct UTC dates of
  its verified runs. Survivors get ids `p1`, `p2`, ... in order of verified runs, most first.

### The Opus run

- Its goal is built-in text in Go (`pkg/workflowscan`), first line `Workflow scan`, which the run lists show.
- Commands it uses: `wsh workflow scan` (prints survivors and under-floor rows), `wsh workflow result <file>` (writes
  verdicts), `wsh workflow picks` (prints the owner's picks), then `wsh jarvis complete --commit <sha> --report
  <file>`, without `--commit` when nothing was committed.
- One verdict per survivor, every survivor exactly once: `suggest` with `file`, `where`, `fixproject` and `edit` (the
  drafted change as `+`/`-` lines: 1 to 3 `+` lines, at most 3 `-` lines), plus `declinedat` when it raises a declined
  pattern again; `covered` with `note` (the commit or file that covers it); or `declined` with `declinedat`. The
  server refuses a result that breaks these rules, with the reason, so the agent fixes and resends it.
- With no `suggest` verdict, the agent writes the result and completes; there is nothing to pick.

**In arcterm** there is no `wsh workflow picks`: after the result the agent asks the owner with `AskUserQuestion` (see
"Where suggestions show") and goes on from the answers, so its commands are `wsh workflow scan`, `wsh workflow result
<file>` and `wsh jarvis complete`.

### Picks reach the agent

**Superseded in arcterm: the picks are never sent to the agent, because the agent asks for them itself with
`AskUserQuestion`; no command, store field or typed line carries them.** The fork's design follows, kept as the record.

- The lens sends `WorkflowScanPicksCommand` with `{id, pick: apply|drop, reason}` per decided suggestion. The server
  checks them (ids are `suggest` verdicts; `apply` only where `fixproject` is the scan's own project; `drop` needs a
  reason), stores them, sets `applying`, then types one line into the agent's terminal through the delivery the
  brainstorm lines use: `workflow-scan: the owner's picks are in; read them with wsh workflow picks`.
- Picks are stored before the line is sent, so a lost agent loses no decision; a failed delivery comes back to the
  lens as an error naming the run.
- A suggestion with no pick is left alone: not applied, not declined. That is how a fix in another project is handled
  after its Copy: the owner copies it and leaves it unpicked, or drops it.
- The primary button stays disabled until every Drop has a reason, since the Declined entry is built from it.

### Needs you

**Superseded in arcterm: no new attention kind; an agent waiting on `AskUserQuestion` already shows in the cockpit as
waiting on the owner.** The fork's design follows, kept as the record.

A scan run in `picking` that is not done or cancelled is one attention item: kind `workflow-scan`, action `Decide`,
text `<n> suggestions to decide`, in the palette's Reviews group. It carries its run and channel and the address
`workflowscan:<runid>`. Every surface that lists it opens it by that address through the one router (`openref.ts`):
the palette's Needs you, the Brief's queue and the desktop popup all land on Usage > Workflow. The lens's own entry
points use the same address, so no caller sets the surface and lens by hand.

### Usage role

The Sonnet pass's session id is recorded on the scan run as `ConsultSessions: [{sessionid, role: "workflow-scan"}]`.
The usage linker matches those ids as it matches `sessionid` and gives the session that role, so By work shows the
scan run with two rows: its own agent and the `workflow-scan` pass. A generic field, not a scan-only one, because the
role has to travel with the id and the linker should not know about scans. A Go test proves the link; no CDP scenario
shows the row, because the row needs a real transcript with usage under that session id.

### Lens states

**Superseded in arcterm: there is no Workflow lens, so no lens states; the scan's own run sheet and its agent are all
that show a scan, and the `applying` state does not exist.** What holds from the last paragraph is the server's rule:
one scan at a time across all projects, a start refused while any scan run is `scanning` or `picking` and its run is
neither done nor cancelled. The header button and its disabled state are the lens's and are superseded. The fork's
design follows, kept as the record.

How the boards map onto the record:

- **Idle**: no scan yet, or the newest scan was cancelled or failed; then the `last:` line says which, with its
  date.
- **Scanning**: `State` `scanning`, the stage list from `Stage` and the counts.
- **Picking**: the Main board. Cards for `suggest` verdicts; a raised-again one tagged with its old and new counts; a
  fix in another project with Copy for #project instead of Apply; then the "already covered" and "under 3 runs" rows.
- **Applying**: the cards read-only with their picks, the stage list's "Your picks" row done and the agent working.
- **Done**: run `Status` done. With picks, the Done board (the commit with Open in Diff, one row per pick). With no
  suggestions, Nothing to suggest with the Not raised list.

The header's Scan workflow button starts a scan in the home project (active, else last used, else only), resolved
by the palette's own `palettePickChannel`. It is disabled while the newest scan is scanning, picking or applying and
its run is neither done nor cancelled. The server holds one scan at a time across all projects: it refuses a start
while any scan run, in any project, is scanning, picking or applying and its run is neither done nor cancelled, and
the error names that scan's project and run. A scan whose run is done or cancelled, including one that died
mid-scan, blocks nothing.

### Tests and checks

- Unit tests in `pkg/workflowscan` for the corpus (fixture runs and events), the recount (normalization, one count
  per run, the floor, the short-quote rule, an ambiguous id) and the reply parser.
- A `liveprobe` build-tagged test builds the corpus from a snapshot of the packaged store and checks that every run
  the probe's P2 regex matches in the window has a block. It never runs in Verify; it is evidence toward the
  Acceptance section, whose full check needs a real scan.
- CDP scenarios: `workflow-scan` (each lens state, seeded on a fixture run's record) and `workflow-scan-entry` (the
  palette row, the project action and the Needs you row).

  **Superseded in arcterm: no `workflow-scan` scenario (no lens states), and `workflow-scan-entry` is cut to the
  palette's Scan workflow row and the scan run's sheet opened through its `workflowscan:<runid>` address; it has no
  project action and no Needs you row, and never fires the row, which would start a real Opus agent.**

## Acceptance

The first real scan raises at least P2, and its recount for P2 matches the regex recount `verifyprobe.mjs` produced.

Agent's call (builder check) on what "matches" means: an exact count match is impossible by construction. The regex
counted every run all-time, and the scan counts only runs in its window that Sonnet cited. So the test is:

- the scan raises P2 with at least 3 verified runs
- every run it verifies for P2 is also matched by the probe's P2 regex over the same window

The regex, from the gitignored `verifyprobe.mjs`:
`/(see|watch|saw) (it|them|the tests?) fail|red (run|step)|step \d+[^.\n]{0,30}fail first|run the tests? to see/i`.

Lead's call (10-26): the build run cannot perform this check. It needs a real Sonnet and Opus scan over the packaged
store, so the owner runs the first scan after the land. The build gives the evidence it can: a `liveprobe` test that
the corpus holds every run the P2 regex matches in the window.
