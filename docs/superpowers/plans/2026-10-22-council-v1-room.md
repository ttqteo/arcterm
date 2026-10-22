# Council v1, part 2: the room as a group chat, Brainstorm mode, one at a time, started from a chat, saved Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the parts of the council v2 design that v1 can carry: the running council reads as a lively group chat,
a Brainstorm mode beside Review picked from the question, one council at a time with a queue, an agent that starts a
council from the conversation, and every finished council saved into the project with its whole discussion.

**Architecture:** Builds on `docs/superpowers/plans/2026-10-22-council-v1-ui.md` (run 74b368ce: plain words, top-3
picks, report first, notices, composer Setup), which this run starts after. Task 1 lands every wire field first, so the
Go work (Tasks 2–3), the frontend (Tasks 4–6) and the skill (Task 7) proceed side by side. Go adds a mode, a
server-side queue and the saved document; the frontend adds a feed view of a running Discussion and the Brainstorm
report; the `council` skill is rewritten. Agent teams, the RAM awake limit, the cost levers and the Scout stay out (they
wait on Phase 0b).

**Tech Stack:** Go (`pkg/council`, `pkg/wshrpc`, `cmd/wsh`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` ("The two modes", "Starting a council",
"UI", "Storage", "One council at a time"), applied to v1 as this plan states. The design boards stayed on the machine
that drew them, so this plan's words and the spec's "UI" section are the design: v1 has no awake/asleep chips, so
the feed shows each expert's current activity instead; follow `DESIGN.md` and the existing council views for the rest.

**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/... ./cmd/wsh/... ./skills/...`

**Final:** `node scripts/cdp/final-verify.mjs council-tree council-setup council-ask council-discussion council-summary`

## Global Constraints

- Words as in part 1. Brainstorm message labels: **idea**, **builds on it**, **wild idea**, **has doubts**,
  **is against it**, **replies**; Review keeps **proposes**, **has doubts**, **is against it**, **replies**. The
  person's messages: **sets the goal** (the council's question, the first message of the feed) and **steers** ("Ask
  the whole council"); the person's reply on a proposal is **replies**. Agreement stays a reaction.
- Modes on the wire: `review` (default, and the mode of every council saved before this change) and `brainstorm`.
- One council runs at a time across all projects; a council waiting on the person holds no slot.
- Go tests on Windows go through `node scripts/verify.mjs <packages>` or carry
  `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash): `pkg/wshrpc/wshserver` opens the sqlite store in its
  TestMain and panics with cgo off. A `-run` filter on one package is fine with the prefix.
- Colours from `@theme` tokens; status never in the accent; `DESIGN.md` rules.
- Pure logic in `*model.ts` with tests beside it; generated files only through `task generate`.
- CDP scenarios seed their councils with `writeCouncil(ctx, name, { id, edit })` / `seedCouncil` from
  `scripts/cdp/council/fixtures.mjs`, editing a copy of an existing fixture; no task changes `fixtures.mjs`,
  `fixtures.test.mjs` or the `rail-apps-*.json` files.
- No thesis or paper detail anywhere (the repo is public).
- Commits carry no co-author trailer; nothing is pushed.

## Deliberate deviations from the spec

- **Brainstorm doubts in round 2:** the spec opens doubts "only on ideas someone builds on". v1's round 2 is one
  parallel call per expert, so an expert cannot see the others' builds of the same round; the rule used is "doubts only
  on ideas you build on yourself or put in your top 3".
- **No Scout** in the `product-ideas` group: the Scout is a cost lever of the agent-team room (Phase 0b).
- **Harness version** in the saved document's run facts comes with `docs/superpowers/plans/2026-10-22-council-bench.md`
  Task 1, which adds `Council.Harness` and its run-facts line; this plan leaves it out.
- **The start line's link to the room:** `wsh` prints no clickable link; the line names the council id, and the council
  shows in the Agent tree under its project.
- **The person's own actions are never queued:** Continue on a paused council, a reply or follow-up on a done one,
  Retry and Summarize run at once even while another council runs; only a new council's start (Setup, `wsh council
  start`, Start council on a not-run one) is queued.

## Review Focus

- **Councils saved before this change** (no `mode`, no queue state): they read as Review, open as before, and are never
  queued.
- **The queue when the running council fails, is stopped, or waits on the person:** the next queued council starts in
  each of these cases, exactly once.
- **Two starts at the same moment** (Setup and `wsh council start`): one runs, the other is queued; neither is lost.
- **Saving into a project that is not a git repo, or a slug that already exists:** the file still lands, with a `-2`
  suffix on a clash, and the report shows its path.
- **A Brainstorm council with no wild ideas:** the report shows no empty "Wild ideas kept aside" section.

---

### Task 1: Council wire types

**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/types_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `frontend/types/gotypes.d.ts`, `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`

**Interfaces:**
- Produces (Go, `pkg/council/types.go`): `ModeReview = "review"`, `ModeBrainstorm = "brainstorm"`;
  `func ModeOf(c *Council) string` (`review` when `Mode` is empty); `StateQueued CouncilState = "queued"`;
  `Council.Mode string` (`json:"mode,omitempty"`), `Council.ModeWhy string` (`json:"modewhy,omitempty"`, the one-line
  reason the mode was picked: the suggestion's, the agent's `--mode-why`, or `picked by hand`),
  `Council.QueuedAfter string` (`json:"queuedafter,omitempty"`, the id of the council it waits on),
  `Council.DocPath string` (`json:"docpath,omitempty"`, absolute path of the saved document);
  `CouncilProposal.Wild bool` (`json:"wild,omitempty"`, a Brainstorm wild idea);
  `CouncilReply.Builds bool` (`json:"builds,omitempty"`, a Brainstorm reply that builds on the idea);
  `CouncilDirection.FirstStep string` (`json:"firststep,omitempty"`);
  `CouncilSummary.Kept []CouncilDirection` (`json:"kept,omitempty"`, the wild ideas kept aside);
  `CouncilSuggestion.Mode string` (`json:"mode,omitempty"`) and `CouncilSuggestion.ModeWhy string`
  (`json:"modewhy,omitempty"`).
- Produces (wire): `CommandCouncilStartData.Mode string` (`json:"mode,omitempty"`) and `ModeWhy string`
  (`json:"modewhy,omitempty"`); `CouncilStartCommand` copies both onto the council and refuses a mode other than
  empty, `review` or `brainstorm`.
- Produces (TS, `councilmodel.ts`): `STATE_WORD.queued = "Queued"`; `headerChip` and `treeMeta` give a queued council
  `Queued` (tone `muted`); `CouncilSetupDraft.mode: "review" | "brainstorm"` and `modePicked: boolean` (the person
  flipped the chip), `emptyCouncilDraft` sets `mode: "review", modePicked: false`, `draftFromCouncil` takes the
  council's mode (`review` when empty) with `modePicked: true`.

- [ ] **Step 1: Tests.** `types_test.go`: `TestModeOf` (empty → review, brainstorm kept). `wshserver_council_test.go`:
  `TestCouncilStartCopiesMode` (start with `Mode: "brainstorm", ModeWhy: "a goal"` → the saved council carries both),
  `TestCouncilStartRefusesAnUnknownMode`. `councilmodel.test.ts`: a queued council's `headerChip` and `treeMeta` read
  `Queued`; `emptyCouncilDraft` and `draftFromCouncil` carry the mode (a council with no mode → review).
- [ ] **Step 2:** Run `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/council ./pkg/wshrpc/wshserver -run 'ModeOf|CouncilStartCopiesMode|UnknownMode'` and `npx vitest run frontend/app/view/agents/councilmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement the fields and the copy; run `task generate`.
- [ ] **Step 4:** Run `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/... ./cmd/wsh/...` and the vitest command — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): the wire fields for modes, the queue and the saved document`.

### Task 2: Brainstorm mode in the runner

**Depends on:** Task 1 (uses the Mode, Wild, Builds, FirstStep and Kept fields it adds)
**Files:** `pkg/council/prompts.go`, `pkg/council/parse.go`, `pkg/council/roles.go`, `pkg/council/runner.go`, `pkg/council/prompts_test.go`, `pkg/council/parse_test.go`, `pkg/council/roles_test.go`, `pkg/council/runner_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`

**Interfaces:**
- Produces: built-in roles `designer`, `builder`, `contrarian`, `facilitator` and group `product-ideas` ("Product
  ideas": `newuser`, `designer`, `builder`, `contrarian`; coordinator `facilitator`; no Scout, see Deviations);
  `wsh council start --mode review|brainstorm` (omitted: `review`) and `--mode-why "<one line>"`, passed as
  `CommandCouncilStartData.Mode` / `ModeWhy`; `--mode brainstorm` with no `--group` takes `product-ideas` (and
  `wsh council estimate --mode` the same default); an unknown `--mode` is refused before anything is asked.
- Uses: Task 1's `Mode`, `ModeWhy`, `Wild`, `Builds`, `FirstStep`, `Kept`, `CouncilSuggestion.Mode/ModeWhy`.

- [ ] **Step 1: Tests.** `prompts_test.go` (`TestBrainstormPrompts`, `TestReviewPromptsUnchanged`): in Brainstorm,
  round 1 asks for ideas with no evidence rule and allows a `wild` flag; round 2 asks each expert to build on others'
  ideas (a `builds` reply), name its top 3 picks, and voice doubts only on ideas it builds on itself or picks; the
  synthesis asks for at most 3 ideas worth trying, each with why and a first step, plus the wild ideas kept aside; in
  Review every prompt is unchanged from part 1. `parse_test.go` (`TestParseBrainstorm`): a round 1 reply sets `Wild`, a
  round 2 reply sets `Builds`, a Brainstorm synthesis fills `Directions` (≤3, `FirstStep` set) and `Kept`.
  `roles_test.go` (`TestProductIdeasGroup`): `product-ideas` resolves with `facilitator` last as its coordinator.
  `runner_test.go` (`TestSuggestMode`, `TestBrainstormRunKeepsKept`): the suggestion parses `mode` and `modewhy`, an
  absent or unknown mode comes back empty; a Brainstorm run through the fake caller saves `Wild`, `Builds`, `FirstStep`
  and `Kept`. `wshcmd-council_test.go`: `TestCouncilFlags` gains `--mode` and `--mode-why`;
  `TestCouncilModeDefaultGroup` (brainstorm with no group → `product-ideas`, review → `ui-feature`, an explicit
  `--group` wins); `TestCouncilModeRefusesUnknown`.
- [ ] **Step 2:** Run `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/council ./cmd/wsh/cmd -run 'Brainstorm|ReviewPromptsUnchanged|ProductIdeas|SuggestMode|CouncilFlags|CouncilMode'` — Expected: FAIL.
- [ ] **Step 3:** Implement. The suggestion call's prompt asks for the mode (a problem or goal is `brainstorm`, a thing
  to judge is `review`) with a one-line reason. `councilPrepare` takes the mode and its default group. Update the start
  command's Long help: an agent starts one when the conversation is ready or the person asks (no longer "only when the
  person picked it"), with `--mode`, `--mode-why` and `--screenshot` described.
- [ ] **Step 4:** Run `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/... ./cmd/wsh/...` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): a Brainstorm mode beside Review, picked from the question`.

### Task 3: One council at a time, and the saved document

**Depends on:** Task 2 (edits `runner.go` and `wshcmd-council.go` after it)
**Files:** `pkg/council/runner.go`, `pkg/council/docpath.go`, `pkg/council/docpath_test.go`, `pkg/council/markdown.go`, `pkg/council/runner_test.go`, `pkg/council/markdown_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`

**Interfaces:**
- Produces: `council.FeatureSlug`, `council.DocDay` (a replaceable `func() time.Time`) and `council.DocPath(c, asked)`
  in `pkg/council/docpath.go`, moved from `wshserver_council.go` (`councilFeatureSlug`, `councilDocDay`,
  `councilDocPath`) so the runner can save; the default path gains a `-2`, `-3` suffix when the file exists.
  `Runner.StartNext()`: starts the oldest queued council when none runs (called by `StartCouncilRunner` after
  `MarkStale`). `Markdown(c)` gains the whole discussion and the run facts.
- Uses: Task 1's `StateQueued`, `QueuedAfter`, `DocPath`, `Mode`, `ModeWhy`, `Wild`, `Builds`, `FirstStep`, `Kept`.

- [ ] **Step 1: Tests.** `runner_test.go`: `TestQueueSecondStart` (a `Start` or `StartSaved` while another council runs
  saves it `queued` with `QueuedAfter` = the running one's id, in any project); `TestQueueTwoStartsAtOnce` (two `Start`
  calls from two goroutines: exactly one runs, the other is queued); `TestQueueNextStartsOnce` (when the running one
  ends done, stopped, failed or awaiting-you, the oldest queued one starts, once, and a second queued one stays queued);
  `TestQueueStopRemoves` (`Stop` on a queued council leaves it `stopped`, never run, and it never starts);
  `TestQueuePersonActsNotQueued` (Continue, Reply follow-up, Retry and Summarize run at once while another council
  runs); `TestQueueOldCouncils` (councils saved without `mode` or with an old state behave as before);
  `TestQueueStartNextAfterRestart` (`MarkStale` leaves queued councils queued; `StartNext` starts the oldest).
  `docpath_test.go` (moved from `TestCouncilFeatureSlug` and `TestCouncilSaveDocDefaultPath`, which leave
  `wshserver_council_test.go`): `TestDocPathClash` (`-2`, `-3`), `TestDocPathNotGit` (a plain folder works).
  `markdown_test.go` (`TestMarkdownDiscussion`, `TestMarkdownBrainstorm`): the document holds the report (answer,
  directions or ideas worth trying with first steps, kept ideas when any), then "The discussion": every proposal and
  reply in time order with author, label (the Global Constraints' words) and evidence, then the run facts (mode and its
  reason, experts and models, tokens, time). `runner_test.go` `TestDocPathSavedOnEnd`: on done or stopped the runner
  writes the document under the project's `docs/council/` and sets `DocPath`; a write error is logged and the council
  still ends. `wshcmd-council_test.go`: `TestCouncilQueuedLine` (`Queued after <id> (<feature>)`),
  `TestCouncilWaitDoneIsEveryStateButRunning` gains a `queued` row (not done), and the start line names the mode
  (`TestCouncilStartedLine`).
- [ ] **Step 2:** Run `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/council ./cmd/wsh/cmd -run 'Queue|DocPath|Markdown|CouncilWait|CouncilStartedLine'` — Expected: FAIL.
- [ ] **Step 3:** Implement. The queue check and the launch happen under `Runner.mu`. `CouncilSaveDocCommand` uses
  `council.DocPath`. `wsh council start` prints `Queued after <id> (<feature>)` for a queued start and its started line
  names the mode; `wsh council wait` waits through `queued`; `--queue` stays accepted and does nothing more (every
  second start is queued now); the Long help says so ("one council runs at a time across all projects").
- [ ] **Step 4:** Run `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/... ./cmd/wsh/...` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): one council at a time with a queue; each finished council saves itself into docs/council`.

### Task 4: The running council as a group chat

**Depends on:** Task 1 (uses Council.mode, wild, builds and the queued state it adds)
**Files:** `frontend/app/view/agents/councilfeedmodel.ts`, `frontend/app/view/agents/councilfeedmodel.test.ts`, `frontend/app/view/agents/councilfeed.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `scripts/cdp/council/discussion.mjs`

**What stays and what is replaced:** the feed is the Discussion's main body only while a council is `running` at step
2 or 3 (rounds 2–3, either mode). Step 1 keeps the experts' cards and the call bar; a paused, done, stopped, failed or
not-run council and a follow-up after done keep today's thread (`councilthread.tsx`, `councildiscussionmodel.ts`
unchanged). The ideas column, its ranking, fold and ↑ stay beside the feed. A queued council's Discussion shows one line,
`Queued: it starts when the running council ends.`, and nothing else in the body.

**Interfaces:**
- Produces: `councilFeed(c: Council, onProposal?: string): FeedItem[]` where
  `FeedItem = { kind: "system" | "message" | "typing"; id?: string; author?: string; label?: string; on?: string; text: string; evidence?: string[]; weak?: string; reactions?: string[]; mine?: boolean; at?: string }`;
  `stepOf(c: Council): { step: 1 | 2 | 3; words: [string, string, string] }` (Review: `Read and propose`, `Argue`,
  `Write the answer`; Brainstorm: `Ideas`, `Build on each other`, `Pick the best`).
- Uses: Task 1's `Mode`, `Wild`, `Builds`, `StateQueued`.

- [ ] **Step 1: Tests.** `councilFeed` opens with the person's question as a `sets the goal` message (when there is
  one); orders proposals and replies by time; a reply carries `on` = its proposal's title; the person's messages carry
  `mine` and the label `steers` (whole council) or `replies`; an empty accept is a reaction on its proposal's message
  (`New user agrees`), not an item; a weak claim carries `weak`; each expert with live activity yields a `typing` item
  (`Skeptic is writing…`); round boundaries yield `system` items (`2:12 · 6 ideas from 4 experts · now they argue`, in
  Brainstorm `· now they build on each other`); Brainstorm labels `idea`, `wild idea` (a `Wild` proposal), `builds on
  it` (a `Builds` reply); `onProposal` keeps only that proposal's message and its replies. `stepOf` for each round
  and mode.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilfeedmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement `councilfeed.tsx`: the 3-part step bar (`data-council-step`, the current part marked), while
  running the line "Nothing to do now. The answer opens here when it finishes; you can leave."
  (`data-council-nothing`), a row of expert chips (`data-council-expert-chip=<id>`, title `<name>: <activity>`, a
  green dot while working), the feed (`data-council-feed-item`, `data-feed-kind`, `data-feed-label`, `data-feed-on`,
  `data-feed-mine` on the person's messages, drawn on the grey surface fill), reactions (`data-council-reaction`),
  the typing row (`data-council-typing`), a Reply on each expert message (`data-council-reply=<reply or proposal id>`)
  that opens the existing reply composer (`data-composer-for`), and the existing "Ask the whole council" composer under
  it. `councildiscussion.tsx` shows the feed as stated above, a mode chip in the header (`data-council-mode`:
  `Review` or `Brainstorm`, every state), and clicking a proposal in the column filters the feed to it (clicking it
  again clears the filter).
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** Rewrite `council/discussion.mjs` phases `round2` and `picks` to the feed (the thread
  assertions on `data-council-node`, `data-node-depth`, `data-council-post-title` and the post foot go; the chip,
  avatars-to-chips, cost line, column order, real reply and Summarize-disabled checks stay in feed terms):
  `round2` asserts the step bar on part 2 (`Argue`), the "Nothing to do now" line, the `Review` mode chip, the Skeptic
  chip title `Skeptic: Replying to UX`, a message labelled `has doubts` with an `on` line, the typing row; clicks
  `[data-council-proposal="P2"]` and asserts every feed message is on P2's title and the count narrowed; replies on
  r17 through `[data-council-reply="r17"]`, sends, and asserts a `[data-feed-mine]` message holding the text.
  `picks` asserts the column ranking and fold as today and the `New user agrees` reaction under P2's message with no
  message for r17. A new `brainstorm` phase seeds round2 with `edit: (c) => { c.mode = "brainstorm"; c.proposals[0].wild = true; c.replies.find((r) => r.stance !== "accept").builds = true; }`
  and asserts the step words `Ideas`, `Build on each other`, `Pick the best`, the `Brainstorm` chip, and the labels
  `wild idea` and `builds on it`. A new `queued` phase seeds round1 with `edit: (c) => { c.state = "queued"; c.round = 0; }`
  and asserts the queued line. The other phases stay as they are. Shown by `council-discussion`.
- [ ] **Step 6:** Commit `feat(council): a running council reads as a group chat`.

### Task 5: The mode chip in Setup and the Brainstorm report

**Depends on:** Task 1 (uses the draft mode, docpath, kept and firststep it adds)
**Files:** `frontend/app/view/agents/councilsetup.tsx`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `scripts/cdp/council/setup.mjs`, `scripts/cdp/council/summary.mjs`

**Interfaces:**
- Uses: Task 1's `CouncilSetupDraft.mode` / `modePicked`, `CouncilSuggestion.mode/modewhy`, `Council.mode`,
  `docpath`, `Kept`, `FirstStep`, `Builds`, `StateQueued`, `CommandCouncilStartData.mode/modewhy`.

- [ ] **Step 1: Tests.** `councilsetupmodel.test.ts`: the mode chip reads `Brainstorm · picked from your question` from a
  suggestion with `mode: "brainstorm"`, `Review · picked from your question` from one with `review`, `Review` with no
  suggestion mode, and `<mode> · you picked it` once flipped (`modePicked`, never overridden by a later suggestion);
  each mode has its one sentence of rules (Brainstorm: `Ideas first and no doubts yet; then they build on each other
  and pick the best.`, Review: `Every claim cites a file line or a screenshot, or is marked as citing nothing.`); the
  default group follows the mode unless the group was picked (`product-ideas` for Brainstorm; for Review the
  suggestion's group, else `ui-feature`), so a suggestion with no mode and group `paper` still gives `paper`; the Start
  label is `Queue council` when any council is `running`, else `Start council`; the start data carries `mode` and
  `modewhy` (the suggestion's reason, or `picked by hand`). `councilsummarymodel.test.ts`: a Brainstorm council's
  report heads `Ideas worth trying, best first`; each row carries `First step: <FirstStep>` and `Had it: <authors> ·
  built on by <names of Builds repliers>` (the builders part only when any); `Kept` becomes the `Wild ideas kept
  aside` rows and no section when `Kept` is empty; a count line `<n> more ideas merged or dropped` (proposals in no
  direction and not kept, absent at 0); the saved line reads `Saved to docs/council/<file> with the whole discussion`
  when `docpath` is set, and the `⋯` item is `Open the document` then (else `Save as doc`).
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilsetupmodel.test.ts frontend/app/view/agents/councilsummarymodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement: the chip in the composer bar (`data-council-mode-chip`, a click flips it) with its rules
  line under it (`data-council-mode-rules`); Setup's line about the council says it `saves to docs/council/`; the
  Brainstorm report as tested (`data-council-first-step`, `data-council-kept` section, `data-council-dropped`); the
  saved line under the report (`data-council-docpath`); **Open the document** opens `docpath` in the Code surface
  through `openRefInCode` (`frontend/app/view/agents/agentrailstore.ts`).
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenarios.** `council/setup.mjs`: write the round2 fixture just before step 11's click instead of in
  `arrange`, so no council runs before it and step 11 still reads `Start council`; a new step resolves the stubbed
  suggestion with `mode: "brainstorm", modewhy: "a goal to reach"` and asserts the chip `Brainstorm · picked from your
  question`, the rules line, and the group switching to Product ideas, then clicks the chip and asserts `Review · you
  picked it`; a last step seeds a running council (round2 under another id) and asserts the Start button reads
  `Queue council`. `council-ask` (also in `setup.mjs`) must still pass unchanged: its suggestion has no mode and group
  `paper`. `council/summary.mjs`: seed the done fixture under another id with
  `edit: (c) => { const ds = c.summary.directions; c.mode = "brainstorm"; c.summary.kept = [{ ...ds[3], rank: 1 }]; c.summary.directions = ds.slice(0, 3).map((d) => ({ ...d, firststep: "Try it on one screen" })); c.docpath = <the fixture project>/docs/council/2026-10-22-x.md (written there first, so it opens); }`
  (open it with its own wait for 3 directions, not `openSummary`'s 4) and assert `Ideas worth trying, best first`, a
  `First step:` line, the `Wild ideas kept aside` section, the saved line, and `Open the document` in the `⋯` menu,
  clicking it and asserting the Code surface shows the file; a second seed with `kept: []` asserts no kept section.
  Shown by `council-setup`, `council-ask` and `council-summary`.
- [ ] **Step 6:** Commit `feat(council): Setup shows the mode it picked; a Brainstorm report with first steps and kept ideas`.

### Task 6: A queued council in the tree

**Depends on:** Task 1 (uses the queued state, queuedafter and treeMeta's Queued it adds)
**Files:** `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/council/tree.mjs`

**Interfaces:**
- Uses: Task 1's `StateQueued`, `QueuedAfter`, and `treeMeta`'s `Queued`.

- [ ] **Step 1: Tests.** `councilRowsByProject`: a queued council's row meta reads `Queued · after <feature of the
  council named by queuedafter>` (`Queued` alone when that council is not in the list), tone `muted`, and the row
  carries `queued: true`.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement: a queued `CouncilRow` gets a hover action and a context menu item **Remove from queue**
  (`data-council-act="remove"`), as `QueuedEntryRow` does for runs; it calls `CouncilStopCommand` on the queued council.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/tree.mjs`, after the existing steps (which count the four fixture rows), seed a
  fifth council with `seedCouncil(h, ctx, "round1", { id: <round1 id>-queued, edit: (c) => { c.state = "queued"; c.round = 0; c.queuedafter = <the round2 fixture's id>; } })`;
  assert its row reads `Queued · after <round2's feature>`; stub `CouncilStopCommand`, click
  `[data-council-act="remove"]` on it, and assert one call with the queued id (`rpcCalls`). Shown by `council-tree`.
- [ ] **Step 6:** Commit `feat(council): a queued council shows in the tree and can be removed`.

### Task 7: The agent starts a council from the conversation

**Depends on:** none
**Files:** `skills/council/SKILL.md`, `skills/skills_test.go`

- [ ] **Step 1: Test.** `TestShippedSkills` checks the council skill mentions `wsh council start`, `--mode`,
  `wsh council wait`, `Not run:` and `Queued after`; `wsh council estimate` is dropped from the list on purpose (the
  token gate prices a start; the skill no longer offers).
- [ ] **Step 2:** Run `go test ./skills/...` — Expected: FAIL.
- [ ] **Step 3:** Rewrite the skill: start a council without asking when the conversation holds a clear problem or a
  thing to judge and a real open question more viewpoints would settle (two directions weighed and neither won, a spec
  or plan just written, a draft about to be submitted), and at once when the person asks for one ("ask a council",
  "hỏi council", `/arc:council`). Pick the mode yourself (a problem or goal is `brainstorm`, a thing to judge is
  `review`). Run `wsh council start --mode <review|brainstorm> --mode-why "<one line>" --feature <first line>
  --question "<the question in the person's words. Keep to: <constraints they stated>>" --files <files discussed>
  [--screenshot <png>]...`; say in one line that it started (mode, group, estimate) or was queued
  (`Queued after …`); a `Not run:` result is the person's refusal, never retried; then `wsh council wait <id>`, sum the
  report up in the conversation, and carry on.
- [ ] **Step 4:** Run `go test ./skills/...` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): the agent starts a council from the conversation when it is ready, or when asked`.

### Task 8: Changelog and hand check

**Depends on:** none
**Files:** `CHANGELOG.md`, `docs/open-issues.md`

- [ ] **Step 1:** Under `## Unreleased`, one line each for the person: a running council reads as a group chat;
  Brainstorm mode, picked from the question; one council at a time, the next one queued; every finished council saved
  in `docs/council/` with its discussion; an agent starts a council when the conversation is ready or when asked.
- [ ] **Step 2:** In `docs/open-issues.md` "0 · Waiting on a hand check": in a claude session, after weighing two
  options, check that the agent starts a council by itself with one line (mode, group, estimate), that "ask a council
  about this" starts one at once, and that it sums the report up in the chat when it ends.
- [ ] **Step 3:** Commit `docs(council): changelog lines and the hand check for the council room`.
