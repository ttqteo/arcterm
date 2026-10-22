# Council v1 made readable: report first, plain words, top-3 picks, notices, a composer Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make today's council (v1, one-shot rounds) usable by someone who never read its spec: a finished council
opens on its answer, the UI speaks in plain words, the vote tells ideas apart, the person hears when a council ends or
waits, and Setup is one composer.

**Architecture:** The parts of the council v2 design that do not depend on agent teams, built on v1's runner and
views. Go changes round 2 (top-3 picks, agreement without a reply) and the synthesis (a one-sentence answer first);
the frontend renders them and drops code words; a small always-mounted notifier and a Jarvis attention item carry the
notices; Setup is rebuilt around one composer. This is interim work on purpose: the spec's Phases say it ships ahead of
Phase 0b and extends v1's Discussion and Summary, which still go away in Phase 2 if the agent-team room ships.

**Tech Stack:** Go (`pkg/council`, `pkg/jarvis`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` ("The two modes" for the words and the vote,
"UI" for the report and Setup, "The room" for the done/waiting notices), applied to v1 as this plan states. Boards (in
the main checkout, gitignored): `~/Workspaces/dev/arcterm/.superpowers/design/council-newcomer/project/ReportSetup.dc.html`
(Setup) and `ReportDone.dc.html` (the report; ignore its "Replay" wording, v1 keeps its Discussion).

**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/jarvis`

**Final:** `node scripts/cdp/final-verify.mjs council-tree council-setup council-ask council-discussion council-summary council-needs-you`

## Global Constraints

- Plain words in every visible string: **Agrees**, **Has doubts**, **Is against it** for accept, challenge, oppose;
  **Everyone agrees**, **<names> have doubts**, **<name> is against it** for a direction's tag. No proposal id (`P10`),
  no "Split", "stance", "round" as a label the person reads. v1's three rounds are named as steps: **Step 1 of 3**
  (the experts read and propose), **Step 2 of 3** (they argue), **Step 3 of 3** (the coordinator writes the answer).
  Go keeps `accept | challenge | oppose`, `round` and the proposal ids on the wire and in `data-council-*` hooks.
- Keep every existing `data-council-*` hook a scenario reads (ids stay in data attributes, never in text); a control
  that moves (into a `⋯` menu, under Options) keeps its hook.
- Colours from `@theme` tokens only (`frontend/tailwindsetup.css`); status never in the accent; follow `DESIGN.md`.
- Pure logic in `*model.ts` with a `*.test.ts` beside it; `.tsx` stays thin; no jsdom render tests.
- Generated files are never hand-edited: after a Go type change run `task generate`.
- Scenario data: the `scripts/cdp/council/rail-apps-*.json` fixtures stay councils from before this change (no `picks`,
  no `answer`), except where a task below names one. A step that needs picks, an answer, or an accept with empty text
  writes its own copy with `seedCouncil(h, ctx, name, { id, edit })` / `writeCouncil(ctx, name, { id, edit })`
  (`scripts/cdp/council/fixtures.mjs`), so parallel tasks never edit the same fixture.
- Each task that changes a visible string rewrites every existing scenario step that asserts the old string (or the
  task names the later task that does); the steps named in a task are the ones known to break, not a complete list:
  grep `scripts/cdp/council/` for each old string before committing.
- No thesis or paper detail anywhere (the repo is public).
- Commits carry no co-author trailer; nothing is pushed.

## Not in this plan (deferred)

- **The agent-team room, Brainstorm mode, the mode chip, starting from a conversation**: Phase 1 (they wait on
  Phase 0b's go/no-go).
- **Answer in Needs you**: v1 waits on the person only at the pause after step 1, whose choices (cut ideas, add a
  question, Continue) are made in the Discussion, so the Needs you row offers **Open** only (the person's call,
  2026-10-22). Answer comes with the room's lead questions (Phase 1).
- **"Stopped early"** on the report: it names the room's stop-when-ideas-run-out lever (Phase 1); v1's Stopped state
  keeps its chip.
- **Was this useful?** (Useful / Not really): Phase 3, with the benchmark that reads it.
- **The project file** (`docs/council/YYYY-MM-DD-<slug>.md` written on finish): Phase 1; v1 keeps **Save as doc**.
- **Replay the room / See how it grew**: v1 keeps **Show the discussion**.
- **Unread survives a restart**: the unread dot lives for the app session; a council that ended while arcterm was
  closed shows Done without a dot.

## Review Focus

- **A council started before this change** (no `picks`, no `answer`): every view still renders it; the ↑ falls back to
  the old accept − oppose score, nothing folds as "no picks", and the report opens on the summary text's first
  sentence when there is no answer.
- **A council without a question:** the synthesis writes no answer line and the report shows no "You asked" line.
- **Agreement hidden but counted:** an accept with no text is a reaction under the post, never a reply row; reply
  counts and "N replies" exclude it; the synthesis still sees it.
- **A council the person is looking at when it ends:** no toast and no unread dot (they already see it).
- **The first load:** councils already done when the app loads raise no toast and no dot (`prev` undefined).
- **A waiting council resolved elsewhere** (Continue pressed in the app): its Needs you item disappears on the next
  attention refresh, not left stale.

---

### Task 1: The wire fields for picks and the answer

**Depends on:** none
**Files:** `pkg/council/types.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `Council.Picks map[string][]string` (`json:"picks,omitempty"`, expert id → up to 3 proposal ids, in the
  order the expert gave them); `CouncilSummary.Answer string` (`json:"answer,omitempty"`); TS `Council.picks?` and
  `CouncilSummary.answer?` through `task generate`.

- [ ] **Step 1:** Add the two fields to `pkg/council/types.go` with a one-line comment each, beside the fields they
  belong with. No behaviour change.
- [ ] **Step 2:** Run `task generate`; check `frontend/types/gotypes.d.ts` has `picks?: {[key: string]: string[]}` on
  `Council` and `answer?: string` on `CouncilSummary`, and that `git status` shows no other generated file changed
  beyond those (if one did, the generator brought in someone else's drift: report it, do not hand-edit).
- [ ] **Step 3:** Run `go test ./pkg/council` — Expected: PASS (the store round-trips a council without the fields).
- [ ] **Step 4:** Commit `feat(council): wire fields for each expert's top picks and the summary's answer`.

### Task 2: Round 2 picks and an answer-first synthesis

**Depends on:** Task 1 (fills its `Council.Picks` and `CouncilSummary.Answer`)
**Files:** `pkg/council/prompts.go`, `pkg/council/parse.go`, `pkg/council/runner.go`, `pkg/council/prompts_test.go`, `pkg/council/parse_test.go`, `pkg/council/runner_test.go`

**Interfaces:**
- Consumes: `Council.Picks`, `CouncilSummary.Answer` (Task 1).
- Produces: `Round2Result.Picks []string` in `parse.go`; `applyRound2` fills `c.Picks[e.Id]`; the synthesis fills
  `Summary.Answer`; round 2's activity text reads `Replying to <name>` (no proposal id; `ProposalId` still set).

- [ ] **Step 1: Tests.** `parse_test.go`: a round 2 reply with `"picks": ["P1","P3","P4","P5"]` parses to the first 3;
  a reply without `picks` parses with none. `runner_test.go`: `applyRound2` keeps only picks of other experts' non-cut,
  non-withdrawn, existing proposals, at most 3, in `c.Picks[e.Id]`; an expert's own proposal in its picks is dropped;
  an `accept` stance with an empty reason is kept (a reply with empty `Text`), a `challenge` or `oppose` with an empty
  reason is still refused as today; `round2Target`'s text is `Replying to UX` for a proposal by UX.
  `prompts_test.go`: `Round2Prompt` asks for `picks` (the 3 of the others' proposals most worth doing, best first)
  and says an accept needs no reason; `SynthesisPrompt` lists each proposal's pick count (and says when no picks were
  given: a council from before this change), asks to rank directions by picks among the rest, and, only when
  `c.Question != ""`, asks for an `answer`: one sentence that answers the question directly; with no question the
  prompt asks for no answer. Parsing a synthesis reply with `"answer"` fills `Summary.Answer`; without it, `Answer` is
  empty.
- [ ] **Step 2:** Run `go test ./pkg/council -run 'Round2|Synthesis|Picks|Answer|Target'` — Expected: FAIL.
- [ ] **Step 3:** Implement in the three source files; extend the JSON shapes in `prompts.go`'s examples.
- [ ] **Step 4:** Run `go test ./pkg/council` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): round 2 names each expert's top 3 picks; the summary answers the question first`.

### Task 3: Plain words, picks and reactions in the Discussion

**Depends on:** Task 1 (reads the TS `Council.picks` it generates)
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councildiscussionmodel.ts`, `frontend/app/view/agents/councildiscussionmodel.test.ts`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilthread.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `scripts/cdp/council/rail-apps-round2.json`, `scripts/cdp/council/fixtures.test.mjs`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/tree.mjs`

**Interfaces:**
- Consumes: `Council.picks` (Task 1).
- Produces, in `councilmodel.ts` (the base module, so nothing imports back into it): `STANCE_WORD` (moved here from
  `councilsummarymodel.ts`, which drops its copy, and replacing `councildiscussionmodel.ts`'s private one: one
  constant, `accept: "Agrees"`, `challenge: "Has doubts"`, `oppose: "Is against it"`, `proposed: "Proposed"`);
  `pickCount(c: Council, proposalId: string): number | null` (experts whose `picks` hold the id; `null` when the
  council has no `picks` at all); `rankedProposals` ranks by `pickCount`, falling back to the accept − oppose score
  when it is `null`; the word changes below. In `councildiscussionmodel.ts`: `reactions(c, proposalId): string[]`
  (`["Reader agrees", …]`, one per accept with empty text, by its author's latest stance) and
  `foldedCount(c): number` (the proposals no expert picked, `0` with no `picks`).

- [ ] **Step 1: Tests.** `councilmodel.test.ts`: `STANCE_WORD` gives the plain words; `pickCount` counts and returns
  `null` without `picks`; `rankedProposals` ranks by picks, and by the old score without them (the existing ranking
  tests keep passing on a council with no picks); `headerChip` reads `Step 1 of 3 · 2 of 4 experts done`,
  `Step 2 of 3 · 2 replying`, `Step 3 of 3 · summarizing` (`Follow-up` unchanged); `treeMeta` of a running council
  reads `Running` (a follow-up still `Answering`); `summaryChip` reads `Done · 4 experts · 11 min · 0.86M tokens` (no
  rounds); `replyLabel` of a queued reply reads `Queued for the next step`; `summarizeHold` reads
  `The summary comes by itself when the experts finish replying` / `Summarize unlocks after the experts' first ideas`;
  `matrixRows`' outcome for a withdrawn proposal reads `Withdrawn`. `councildiscussionmodel.test.ts`: `proposalLine`
  reads `UX · 2 replies` (no id); reply counts (`proposalLine`, `postFoot`, `costLine`'s `N replies`) exclude accepts
  with empty text; `reactions` lists them as `<name> agrees`; `replyPills` uses the plain words; `scoreSummary` reads
  `Picked by 2 of 4 experts` (and keeps today's text for a council with no picks); `expertDoing`/`expertCard` read
  `Proposed · 2 ideas`, `Replied · 3 replies`, `Waits for the answer` instead of `Round N done` / `Waits for round 3`;
  `composerHint` says `while the experts argue` instead of `in round 2`; `foldedCount` counts unpicked proposals.
  `councilsummarymodel.test.ts`: only the import of `STANCE_WORD` moves; its expectations use the plain words.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilmodel.test.ts frontend/app/view/agents/councildiscussionmodel.test.ts frontend/app/view/agents/councilsummarymodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. `councilthread.tsx`: the ↑ shows the pick count (title from `scoreSummary`), the
  reactions as green chips (`data-council-reaction`) under the post, no reply row for an empty accept, no `round 1` in
  the post's meta line. `councildiscussion.tsx`: the column shows no ids; when `foldedCount > 0` the unpicked ideas
  fold under a row `n more with no picks` (`data-council-folded`) that unfolds them; the pause panel reads
  `Ideas so far`, `Continue: let them argue`, `The rest: ≈ …` and `Stop here and keep these ideas` (hooks unchanged).
  `councilsummary.tsx`: only its `STANCE_WORD` import moves to `./councilmodel`. `rail-apps-round2.json`: every
  activity text `Replying to <name> on P<n>` becomes `Replying to <name>` (what the runner now writes, Task 2), and
  `fixtures.test.mjs` follows if it asserts that text.
- [ ] **Step 4:** Run the same vitest command and `npx vitest run scripts/cdp/council/fixtures.test.mjs` — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/discussion.mjs` rewrite the steps that assert replaced strings: the header
  chip `Round 2 of 3 · 2 replying` → `Step 2 of 3 · 2 replying` and round 1's `/^Round 1 of 3/` → `/^Step 1 of 3/`;
  Skeptic's hover `Skeptic: Replying to UX on P2` → `Skeptic: Replying to UX`; Summarize's title; the pause lines
  (`Rounds 2 and 3: …`, `Stop here and keep round 1`, `Continue to round 2`); the expert cards' `Round N done` lines.
  The column-order and withdrawn steps keep reading ids from `data-council-proposal` (unchanged ranking: the fixture
  has no picks). Add a step: seed the round2 fixture under a second id with `edit` adding `picks` (two experts pick P2,
  one picks P1; P3–P6 unpicked) and blanking the text of one `accept` reply on P2; assert the column shows no
  `/\bP\d+\b/` text, ranks P2 first, folds the rest under `4 more with no picks`, P2's ↑ title starts `Picked by`, a
  `[data-council-reaction]` chip reads `… agrees`, and no reply row holds the blanked reply. In `council/tree.mjs`
  rewrite step 2's metas (`Round 2` → `Running`) and step 3's wording. The steps of `council/summary.mjs` this task
  breaks (the chip's `3 rounds`, `Withdrawn in round 2`, the `Accept`/`Challenge`/`Oppose` pills) are rewritten by
  Task 4, which depends on this one; leave that file alone. Shown by `council-discussion` and `council-tree`.
- [ ] **Step 6:** Commit `feat(council): the Discussion speaks plain words, ranks by picks, shows agreement as a reaction`.

### Task 4: A finished council opens on its report

**Depends on:** Task 3
**Files:** `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/agentcenter.ts`, `frontend/app/view/agents/agentcenter.test.ts`, `scripts/cdp/council/summary.mjs`

**Interfaces:**
- Consumes: `CouncilSummary.answer` (Task 1); `STANCE_WORD`, `summaryChip`, `matrixRows`' `Withdrawn` (Task 3);
  `listNames` (`councildiscussionmodel.ts`, exists).
- Produces, in `councilsummarymodel.ts`: `defaultCouncilView(c: Council | null | undefined): "discussion" | "summary"`
  (`"summary"` when the state is done, stopped or failed and a summary exists, else `"discussion"`, and `"discussion"`
  for an unknown council); `answerLine(c): string` (the answer, else the summary text's first sentence);
  `askedLine(c): string` (`You asked: <question>`, empty with no question); `directionTag(c, d): string`. In
  `agentcenter.ts`: `showCouncil(id, view?, model?)`: with `view` omitted it looks the council up in `councilAtom(id)`,
  else in `councilListAtom("")`, and opens `defaultCouncilView` of it.

- [ ] **Step 1: Tests.** `defaultCouncilView` for running, awaiting-you, done-with-summary, done-without-summary,
  stopped-with-summary, unknown; `showCouncil(id)` with no view opens the summary of a done council in the list and
  the discussion of a running one; `directionTag` reads `Everyone agrees`, `Reader has doubts`,
  `Reader and UX have doubts`, `RAM is against it` (against wins over doubts); a direction's meta reads
  `from UX and RAM · 1 file · 1 weak claim · in Ideas` (no ids, no `Merged`); `answerLine` with and without
  `answer`; `askedLine` with and without a question; `brainstormPrompt` names proposals by title and author, with no
  `P\d+`.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts frontend/app/view/agents/agentcenter.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. `councilsummary.tsx` (board `ReportDone`): header `Council · <feature>` with the state
  chip (`summaryChip`), **Show the discussion** (`data-council-action="discussion"`, replacing the Back link), and a
  `⋯` menu (`data-council-menu`) holding Save as doc, Create initiative and Run again (their `data-council-action`
  hooks kept); then `askedLine` when there is one, `answerLine` as one bold sentence (`data-council-answer`), the rest
  of the summary text, `writtenLine` under it (who wrote it), the ranked directions with `directionTag`, each with
  **Start an agent on it** (renamed from Brainstorm this, same action), and the matrix folded at the bottom under
  `Every expert on every idea` (`data-council-matrix-toggle`), its rows labelled by the proposal's title.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/summary.mjs` rewrite the steps that assert replaced strings: the header
  (`back === "Discussion"` → `Show the discussion`; `Summary · Rail apps` → `Council · Rail apps`; the chip regex
  without `3 rounds`); any step asserting `Accept`, `Challenge` or `Oppose` (now `Agrees`, `Has doubts`,
  `Is against it`); the direction tags (`Agreed`/`Split` → `Everyone agrees` / `… have doubts`); direction 3's meta
  (`from UX and RAM · …`) and button (`Start an agent on it`); the matrix step (unfold it first; rows still read by
  their data ids, `P6`'s outcome `Withdrawn`, row text has no `P\d+`); the Save as doc, Create initiative and Run again
  steps open the `⋯` menu before clicking; the Start an agent on it step asserts the direction's title in the prompt
  instead of `P2`. Add steps: the plain done fixture (no answer) opened from its tree row lands on the Summary, shows
  `You asked: Which changes to pinned apps…`, and its bold line is the summary text's first sentence; a copy seeded
  with `edit` setting `summary.answer` shows that sentence bold; a copy with `question` removed shows no `You asked`
  line; no `/\bP\d+\b/` in the Summary's text. Shown by `council-summary`.
- [ ] **Step 6:** Commit `feat(council): a finished council opens on its answer and ranked directions`.

### Task 5: Setup as one composer

**Depends on:** none
**Files:** `frontend/app/view/agents/councilsetup.tsx`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `scripts/cdp/council/setup.mjs`

**Interfaces:**
- Keeps `CouncilSetupDraft`'s shape (`feature`, `question`, …; it lives in `councilmodel.ts`, which this task does not
  edit), so Run again, Ask the council and a draft saved before this change load unchanged.
- Produces, in `councilsetupmodel.ts`: `splitAsk(text: string): { feature: string; question: string }` (the first
  non-empty line is the feature, the rest trimmed is the question; when there is only one line and it ends with `?`,
  it is the feature and the question both) and `joinAsk(draft): string` (the feature, then the question on the next
  line; the question alone when the feature is empty or equal to it). The composer shows `joinAsk(draft)` and writes
  `splitAsk(text)` back on each edit.

- [ ] **Step 1: Tests.** `splitAsk("Rail apps\nIs the pin worth it?")` → `Rail apps` / `Is the pin worth it?`; one
  line without `?` → empty question; one line ending `?` → that line both; blank lines skipped; a multi-line question
  kept with its line breaks. `joinAsk` of Ask the council's prefill (`{ question, sessionId }`, empty feature) is the
  question, and `splitAsk(joinAsk(d))` gives it back as the question, so `startData` sends it and the synthesis answers
  it; `joinAsk` of a Run again draft (feature and question) round-trips; a draft restored from before this change
  (separate feature and question) round-trips. `readingLine` reads `… experts read the code first; then they argue
  over text only` (no rounds).
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilsetupmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement (board `ReportSetup`): "New council" and one sentence on what a council does; one composer
  (`data-council-input="ask"`, placeholder `What should the council review? The first line names it; ask a question
  under it.`), file and screenshot chips inside it (`data-council-file-chip`), an attach button
  (`data-council-attach`), the group as a chip, the estimate (`data-council-estimate`) and **Start council** in its
  bar (`data-council-composer-bar`); the footnote that blocks Start reads `Say what the council should review`; one
  line naming the group's experts and what each looks at; **Options** (`data-council-options`) unfolds the existing
  expert rows, models, files, Save as group and **Pause after the first ideas** (renamed from Pause after round 1).
  Everything Setup shows today stays reachable.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/setup.mjs` rewrite the steps that read `[data-council-input="feature"]` /
  `[data-council-input="question"]` to type into `[data-council-input="ask"]` (two lines for a feature and a
  question); the blocked footnote `Name the feature to review` → `Say what the council should review`; the estimate
  steps find it inside `[data-council-composer-bar]`; the expert-row, remove-row and Pause steps open Options first and
  the Pause label reads `Pause after the first ideas`. Add steps: the attach button and a file chip sit inside the
  composer; a draft restored with separate `feature` and `question` (prefill through `openCouncilSetup`) shows both
  lines in the composer. In `councilAsk` (scenario `council-ask`) rewrite the same reads, and assert the composer
  holds the Idea's question as its one line and the recorded `CouncilStartCommand` carries it as `question`. Shown by
  `council-setup` and `council-ask`.
- [ ] **Step 6:** Commit `feat(council): Setup is one composer; experts and files fold into Options`.

### Task 6: A toast and an unread dot when a council ends

**Depends on:** Task 3
**Files:** `frontend/app/view/agents/councilnotify.ts`, `frontend/app/view/agents/councilnotify.test.ts`, `frontend/app/view/agents/councilnotifysync.tsx`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/council/tree.mjs`

**Interfaces:**
- Consumes: `CouncilSummary.answer` (Task 1); `treeMeta`'s words (Task 3); `showCouncil(id, "summary")`
  (`agentcenter.ts`, exists); `pushToast` (`frontend/app/cockpit/notificationstore.ts`, with `onOpen`).
- Produces, in `councilnotify.ts` (pure): `endedNotice(prev: Council | undefined, next: Council, viewing: boolean):
  { title: string; body: string } | null` (non-null only when `prev` was running or awaiting-you and `next` is done,
  stopped or failed, and not `viewing`; titles `Council done`, `Council stopped`, `Council failed`; the body is the
  answer, else the summary text's first sentence, else the error); `markUnread(set, id)` / `markRead(set, id)`. In
  `councilstore.ts`: `councilUnreadAtom` (a `Set<string>` of council ids, for the app session). In
  `agentsidebarmodel.ts`: `CouncilRowVM.unread: boolean` from a set passed to `councilRowsByProject`.

- [ ] **Step 1: Tests.** `endedNotice` fires once on running → done with the answer as body, falls back to the summary's
  first sentence and to the error (running → failed: `Council failed`), returns null on done → done, on
  `prev` undefined (the first load), and while viewing; `markRead` removes and `markUnread` adds without mutating the
  set; `councilRowsByProject` sets `unread` from the set and keeps the meta `Done`.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilnotify.test.ts frontend/app/view/agents/agentsidebarmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. `councilnotifysync.tsx` (`CouncilNotifySync`, mounted in `cockpitshell.tsx` beside
  `NotifySync`, which is outside the surface switch) loads and watches `councilListAtom("")`, keeps the previous
  record of each council in a ref, and for each change calls `endedNotice` with `viewing` = the Agent surface is shown,
  `centerModeAtom` is `council` and `councilSelAtom` is that id; on a notice it marks the council unread and pushes a
  toast whose `onOpen` calls `showCouncil(id, "summary", model)`. It also clears a council's unread mark whenever that
  council is the one in view (either view). `agenttree.tsx` passes the set and draws the dot (`data-council-unread`) in
  `primary` ink, not the accent.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/tree.mjs` add steps: with the round2 council seeded under a new id and Setup in
  view, write the `done` fixture under that id (`writeCouncil(ctx, "done", { id })`, then `announceCouncil`); assert a
  toast titled `Council done` and the row's `[data-council-unread]` dot with the meta `Done`; click the toast and
  assert the Summary opens and the dot is gone. Then open another running copy, flip it to done the same way while it
  is in view, and assert no toast and no dot. Shown by `council-tree`.
- [ ] **Step 6:** Commit `feat(council): a toast and an unread dot when a council ends`.

### Task 7: A council waiting on you is in Needs you

**Depends on:** none
**Files:** `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/address.ts`, `frontend/app/view/jarvis/address.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/view/agents/attentionstore.test.ts`, `scripts/cdp/council/needsyou.mjs`, `scripts/cdp/councilscenarios.mjs`

**Interfaces:**
- Produces: in `pkg/jarvis/attention.go` the kind `AttentionCouncil = "council"`, `AttentionInput.Councils
  []*council.Council` (filled in `GatherAttentionFromLedger` from `council.List("")`; an unreadable list is logged and
  gives no council items, as efforts and learn proposals do), and one item per council in state `awaiting-you`: key
  `council:<id>`, `ORef` `council:<id>`, `Text` `Council waiting on you: <feature>`, `Action` `Open`, `WaitingSince`
  the council's `updated`. `pkg/council` must not import `pkg/jarvis` (check there is no cycle). In the frontend:
  `QueueNav` gains `{ kind: "council"; oref: string }` (the row gets an action, routes through `queueOpenTarget` as an
  oref, and is toned asking); `parseAddress("council:<id>")` gives `{ kind: "council"; councilId }` in `OpenTarget`;
  `openref.ts` opens it with `showCouncil(id, "discussion", model)`. The Jarvis badge counts it with no change:
  `splitAttention` files every kind but `ask` and `radar-triage` under Jarvis.

- [ ] **Step 1: Tests.** `attention_test.go`: `BuildAttention` with one awaiting and one done council yields one
  `council` item with that key, oref, text and action; the same council moved to done yields none (a council resolved
  elsewhere leaves Needs you on the next refresh). `briefingmodel.test.ts`: the item becomes a queue row with nav
  `{ kind: "council", oref: "council:<id>" }`, action `Open` and the asking tone; `queueOpenTarget` gives the oref.
  `address.test.ts`: `council:<id>` parses to the council target and `council:` alone is unsupported.
  `openref.test.ts`: the council target opens the council centre mode on its discussion. `attentionstore.test.ts`:
  `splitAttention` counts a `council` item under Jarvis (the badge).
- [ ] **Step 2:** Run `go test ./pkg/jarvis -run Attention` and `npx vitest run frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/jarvis/address.test.ts frontend/app/view/jarvis/openref.test.ts frontend/app/view/agents/attentionstore.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same commands — Expected: PASS.
- [ ] **Step 5: Scenario.** Add `scripts/cdp/council/needsyou.mjs` and register it as `council-needs-you` in
  `scripts/cdp/councilscenarios.mjs`: arrange the council fixture project, `writeCouncil(ctx, "awaiting")`, wait for
  the attention list to reload (its poll), go to Jarvis and assert a Needs you row reading
  `Council waiting on you: Rail apps` and the Jarvis nav badge (`[data-nav-badge="jarvis"]`) counting it; click the
  row and assert the Agent surface shows that council's Discussion (`[data-council-discussion]`); then write the `done`
  fixture under the same id and assert the row is gone after the next reload. Teardown removes the council. Shown by
  `council-needs-you`.
- [ ] **Step 6:** Commit `feat(council): a council waiting on you shows in Needs you`.

### Task 8: Changelog and hand checks

**Depends on:** none
**Files:** `CHANGELOG.md`, `docs/open-issues.md`

- [ ] **Step 1:** The top section of `CHANGELOG.md` is `## 0.15.17 — 2026-10-21`, so open a new `## Unreleased`
  above it. Under `Changed`, one line each, written for the person: a finished council opens on its answer; the
  council speaks plain words and ranks ideas by the experts' top picks, with agreement shown as a reaction; New
  council is one box. Under `Added`: a toast and a dot when a council ends, and a council waiting on you in Needs you.
  No `<!-- big -->` (these change an existing feature).
- [ ] **Step 2:** Run `npx vitest run frontend/app/cockpit/whatsnew.test.ts` (it parses the file) — Expected: PASS.
- [ ] **Step 3:** In `docs/open-issues.md` "0 · Waiting on a hand check": run a real council with a question on the
  installed app and check the report opens with a one-sentence answer, that agreement shows as reactions, and that the
  done toast arrives while another surface shows.
- [ ] **Step 4:** Commit `docs(council): changelog lines and the hand check for the readable council`.
