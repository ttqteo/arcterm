# Council v1, part 2: the room as a group chat, Brainstorm mode, one at a time, started from a chat, saved Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the parts of the council v2 design that v1 can carry: the running council reads as a lively group chat,
a Brainstorm mode beside Review picked from the question, one council at a time with a queue, an agent that starts a
council from the conversation, and every finished council saved into the project with its whole discussion.

**Architecture:** Builds on `docs/superpowers/plans/2026-10-22-council-v1-ui.md` (run 74b368ce: plain words, top-3
picks, report first, notices, composer Setup), which this run starts after. Go adds a mode, a server-side queue and the
saved document; the frontend adds a feed view of the Discussion and the Brainstorm report; the `council` skill is
rewritten. Agent teams, the RAM awake limit and the cost levers stay out (they wait on Phase 0b).

**Tech Stack:** Go (`pkg/council`, `pkg/wshrpc`, `cmd/wsh`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` ("The two modes", "Starting a council",
"UI", "Storage", "One council at a time"), applied to v1 as this plan states. Boards (main checkout, gitignored):
`~/Workspaces/dev/arcterm/.superpowers/design/council-newcomer/project/ReportRunning.dc.html` and `V2Room.dc.html`
(the feed; v1 has no awake/asleep chips: show each expert's current activity instead), `V2Setup.dc.html` (the mode
chip), `V2Report.dc.html` (the Brainstorm report), `V2Chat.dc.html` (a council started from a chat, the queued row).

**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `node scripts/cdp/final-verify.mjs council-tree council-setup council-discussion council-summary`

## Global Constraints

- Words as in part 1. Brainstorm message labels: **idea**, **builds on it**, **wild idea**, **has doubts**,
  **is against it**, **replies**; Review keeps **proposes**, **has doubts**, **is against it**, **replies**. Agreement
  stays a reaction.
- Modes on the wire: `review` (default, and the mode of every council saved before this change) and `brainstorm`.
- One council runs at a time across all projects; a council waiting on the person holds no slot.
- Colours from `@theme` tokens; status never in the accent; `DESIGN.md` rules.
- Pure logic in `*model.ts` with tests beside it; generated files only through `task generate`.
- No thesis or paper detail anywhere (the repo is public).
- Commits carry no co-author trailer; nothing is pushed.

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

### Task 1: Brainstorm mode in the runner

**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/prompts.go`, `pkg/council/parse.go`, `pkg/council/roles.go`, `pkg/council/runner.go`, `pkg/council/prompts_test.go`, `pkg/council/parse_test.go`, `pkg/council/roles_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `cmd/wsh/cmd/wshcmd-council.go`, `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`

**Interfaces:**
- Produces: `Council.Mode string` (`json:"mode,omitempty"`, `"review"` when empty); `CouncilSummary.Kept []CouncilDirection`
  (`json:"kept,omitempty"`, the wild ideas kept aside); `CouncilDirection.FirstStep string` (`json:"firststep,omitempty"`);
  `CouncilSuggestion.Mode string` and `CouncilSuggestion.ModeWhy string`; `CommandCouncilStartData.Mode string`;
  `wsh council start --mode review|brainstorm` (omitted: the suggestion's mode); built-in roles `designer`, `builder`,
  `contrarian`, `facilitator` (coordinator) and group `product-ideas` ("Product ideas": `newuser`, `designer`,
  `builder`, `contrarian`; coordinator `facilitator`).

- [ ] **Step 1: Tests.** `prompts_test.go`: in Brainstorm, round 1 asks for ideas with no evidence rule and allows a
  `wild` flag, round 2 asks each expert to build on others' ideas (label `builds on it`), name its top 3 picks, and voice
  doubts only on ideas someone built on or picked, and the synthesis asks for at most 3 ideas worth trying, each with
  why and a first step, plus the wild ideas kept aside; in Review every prompt is unchanged from part 1.
  `parse_test.go`: a Brainstorm synthesis fills `Directions` (≤3, `FirstStep` set) and `Kept`. `roles_test.go`: the
  `product-ideas` group resolves with `facilitator` as its coordinator. The suggestion parses `mode` and `modewhy`.
- [ ] **Step 2:** Run `go test ./pkg/council -run 'Brainstorm|Mode|ProductIdeas|Suggest'` — Expected: FAIL.
- [ ] **Step 3:** Implement; the suggestion call's prompt asks for the mode (a problem or goal is `brainstorm`, a thing
  to judge is `review`) with a one-line reason; the start command passes `Mode` through; run `task generate`.
- [ ] **Step 4:** Run `go test ./pkg/council ./pkg/wshrpc/... ./cmd/wsh/...` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): a Brainstorm mode beside Review, picked from the question`.

### Task 2: One council at a time, and the saved document

**Depends on:** Task 1 (edits runner.go and types.go after it)
**Files:** `pkg/council/runner.go`, `pkg/council/types.go`, `pkg/council/store.go`, `pkg/council/markdown.go`, `pkg/council/runner_test.go`, `pkg/council/markdown_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: state `queued` (`StateQueued CouncilState = "queued"`) with `Council.QueuedAfter string`
  (`json:"queuedafter,omitempty"`, the id of the council it waits on); `Council.DocPath string`
  (`json:"docpath,omitempty"`, absolute path of the saved document); `Markdown(c)` gains the whole discussion.

- [ ] **Step 1: Tests.** `runner_test.go`: starting a council while another runs saves it `queued` with `QueuedAfter`;
  when the running one ends done, stopped, failed or awaiting-you, the oldest queued one starts once; stopping a queued
  council removes it from the queue (state `stopped`, never run); councils saved without a state behave as before.
  `markdown_test.go`: the document holds the report (answer, directions or ideas worth trying with first steps, kept
  ideas), then "The discussion": every proposal and reply in order with author, label and evidence, then the run facts
  (mode, experts and models, tokens, time). On done or stopped the runner writes it to
  `docs/council/YYYY-MM-DD-<slug>.md` in the project (`-2`, `-3` on a clash) and sets `DocPath`.
- [ ] **Step 2:** Run `go test ./pkg/council -run 'Queue|Markdown|DocPath'` — Expected: FAIL.
- [ ] **Step 3:** Implement; `wsh council start` prints `Queued after <id> (<feature>)` for a queued start and
  `wsh council wait` waits through `queued`; `--queue` stays accepted and means the same.
- [ ] **Step 4:** Run `go test ./pkg/council ./cmd/wsh/...` — Expected: PASS. Run `task generate`.
- [ ] **Step 5:** Commit `feat(council): one council at a time with a queue; each finished council saves itself into docs/council`.

### Task 3: The running council as a group chat

**Depends on:** Task 1 (reads `Council.mode` for the labels)
**Files:** `frontend/app/view/agents/councilfeedmodel.ts`, `frontend/app/view/agents/councilfeedmodel.test.ts`, `frontend/app/view/agents/councilfeed.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `scripts/cdp/council/discussion.mjs`

**Interfaces:**
- Produces: `councilFeed(c: Council): FeedItem[]` where
  `FeedItem = { kind: "system" | "message" | "typing"; author?: string; label?: string; on?: string; text: string; evidence?: string[]; weak?: string; reactions?: string[]; at?: string }`;
  `stepOf(c: Council): { step: 1 | 2 | 3; words: [string, string, string] }` (Review: `Read and propose`, `Argue`,
  `Write the answer`; Brainstorm: `Ideas`, `Build on each other`, `Pick the best`).

- [ ] **Step 1: Tests.** `councilFeed` orders proposals and replies by time; a reply carries `on` = its proposal's
  title; an empty accept is a reaction on its proposal's message, not an item; a weak claim carries `weak`; each expert
  with live activity yields a `typing` item (`Reviewer B is answering UX`); round boundaries yield `system` items
  (`2:12 · 18 ideas from 3 experts · now they argue`); Brainstorm labels come out as in the Global Constraints.
  `stepOf` for each round and mode.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilfeedmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement `councilfeed.tsx` (boards `ReportRunning`, `V2Room`): the 3-part step bar, while running a
  line "Nothing to do now. The answer opens here when it finishes; you can leave.", a row of expert chips with their
  current activity, the feed, and the existing "Ask the whole council" composer under it. `councildiscussion.tsx` shows
  the feed as its main body; clicking a proposal in the column filters the feed to that proposal's messages.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/discussion.mjs` open a running fixture council: assert the step bar, the
  "Nothing to do now" line, a message with a `has doubts` label and an `on` line, a reaction chip, and a typing row.
  Shown by `council-discussion`.
- [ ] **Step 6:** Commit `feat(council): a running council reads as a group chat`.

### Task 4: The mode chip in Setup and the Brainstorm report

**Depends on:** Task 1 (the suggestion's mode, Kept, FirstStep), Task 2 (state queued and DocPath)
**Files:** `frontend/app/view/agents/councilsetup.tsx`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `scripts/cdp/council/setup.mjs`, `scripts/cdp/council/summary.mjs`

- [ ] **Step 1: Tests.** `councilsetupmodel.test.ts`: the mode chip reads `Brainstorm · picked from your question`
  from the suggestion and flips to Review; the default group follows the mode (`product-ideas` for Brainstorm);
  the Start label is `Queue council` when another council is running. `councilsummarymodel.test.ts`: a Brainstorm
  council's report rows carry `FirstStep`; `Kept` becomes the "Wild ideas kept aside" rows; the saved line reads
  `Saved to docs/council/<file> with the whole discussion`.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilsetupmodel.test.ts frontend/app/view/agents/councilsummarymodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement (boards `V2Setup`, `V2Report`): the chip in the composer bar; for Brainstorm the report
  heads "Ideas worth trying, best first" with "First step:" lines and a "Wild ideas kept aside" section; the saved
  document's path under the report; Save as doc becomes **Open the document** once `DocPath` is set.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenarios.** `council/setup.mjs`: the mode chip flips; `council/summary.mjs`: a Brainstorm fixture
  shows "Ideas worth trying", a "First step:" line, and the saved path. Shown by `council-setup` and `council-summary`.
- [ ] **Step 6:** Commit `feat(council): Setup shows the mode it picked; a Brainstorm report with first steps and kept ideas`.

### Task 5: A queued council in the tree

**Depends on:** Task 2 (state queued and QueuedAfter)
**Files:** `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/council/tree.mjs`

- [ ] **Step 1: Tests.** A queued council's row reads `Queued · after <feature of the running one>`; its row menu
  offers **Remove from queue**.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement; Remove from queue calls the stop command on the queued council.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/tree.mjs` show a fixture with one running and one queued council; assert the
  queued row's words and its menu item. Shown by `council-tree`.
- [ ] **Step 6:** Commit `feat(council): a queued council shows in the tree and can be removed`.

### Task 6: The agent starts a council from the conversation

**Depends on:** Task 1 (`--mode`), Task 2 (a start may be queued)
**Files:** `skills/council/SKILL.md`

- [ ] **Step 1:** Rewrite the skill: start a council without asking when the conversation holds a clear problem or a
  thing to judge and a real open question more viewpoints would settle (two directions weighed and neither won, a spec
  or plan just written, a draft about to be submitted), and at once when the person asks for one ("ask a council",
  "hỏi council", `/arc:council`). Run `wsh council start --mode <review|brainstorm> --feature <first line> --question
  "<the question in the person's words. Keep to: <constraints they stated>>" --files <files discussed>`; say in one line
  that it started (mode, group, estimate) or was queued; a `Not run:` result is the person's refusal, never retried;
  then `wsh council wait <id>`, sum the report up in the conversation, and carry on.
- [ ] **Step 2:** Run `go build ./skills/...` — Expected: it builds (the skill is embedded by `skills/skills.go` and
  reaches Claude as `arc:council` through the arc mod at the next agent launch).
- [ ] **Step 3:** Commit `feat(council): the agent starts a council from the conversation when it is ready, or when asked`.

### Task 7: Changelog and hand checks

**Depends on:** Task 3 (its line), Task 4 (its line), Task 5 (its line), Task 6 (its line)
**Files:** `CHANGELOG.md`, `docs/open-issues.md`

- [ ] **Step 1:** Under `## Unreleased`, one line each for the person: a running council reads as a group chat;
  Brainstorm mode, picked from the question; one council at a time, the next one queued; every finished council saved
  in `docs/council/` with its discussion; an agent starts a council when the conversation is ready or when asked.
- [ ] **Step 2:** In `docs/open-issues.md` "0 · Waiting on a hand check": in a claude session, say "ask a council about
  this" after weighing two options; check the one-line start, the queue when another council runs, the summary back in
  the chat, and the saved file under `docs/council/`.
- [ ] **Step 3:** Commit `docs(council): changelog lines and hand checks for the council room`.
