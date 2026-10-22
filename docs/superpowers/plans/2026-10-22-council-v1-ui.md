# Council v1 made readable: report first, plain words, top-3 picks, notices, a composer Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make today's council (v1, one-shot rounds) usable by someone who never read its spec: a finished council
opens on its answer, the UI speaks in plain words, the vote tells ideas apart, the person hears when a council ends or
waits, and Setup is one composer.

**Architecture:** The parts of the council v2 design that do not depend on agent teams, built on v1's runner and
views. Go changes round 2 (top-3 picks, agreement without a reply) and the synthesis (a one-sentence answer first);
the frontend renders them and drops code words; a small always-mounted notifier and a Jarvis attention item carry the
notices; Setup is rebuilt around one composer. The agent-team room, Brainstorm mode and starting from a chat are out of
scope (they wait on Phase 0b's go/no-go).

**Tech Stack:** Go (`pkg/council`, `pkg/jarvis`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` ("The two modes" for the words and the vote,
"UI" for the report and Setup, "The room" for the done/waiting notices), applied to v1 as this plan states. Boards (in
the main checkout, gitignored): `~/Workspaces/dev/arcterm/.superpowers/design/council-newcomer/project/ReportSetup.dc.html`
(Setup) and `ReportDone.dc.html` (the report; ignore its "Replay" wording, v1 keeps its Discussion).

**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/jarvis`

**Final:** `node scripts/cdp/final-verify.mjs council-tree council-setup council-discussion council-summary`

## Global Constraints

- Plain words in every visible string: **Agrees**, **Has doubts**, **Is against it** for accept, challenge, oppose;
  **Everyone agrees**, **<names> have doubts**, **<name> is against it** for a direction's tag. No proposal id (`P10`),
  no "Split", "stance", "round" as a label the person reads (the round chip may say "Step 2 of 3"). Go keeps
  `accept | challenge | oppose` on the wire.
- Colours from `@theme` tokens only (`frontend/tailwindsetup.css`); status never in the accent; follow `DESIGN.md`.
- Pure logic in `*model.ts` with a `*.test.ts` beside it; `.tsx` stays thin; no jsdom render tests.
- Generated files are never hand-edited: after a Go type change run `task generate`.
- No thesis or paper detail anywhere (the repo is public).
- Commits carry no co-author trailer; nothing is pushed.

## Review Focus

- **A council started before this change** (no `picks`, no `answer`): every view still renders it; the ↑ falls back to
  the old accept − oppose score, and the report opens on the summary text when there is no answer.
- **A council without a question:** the synthesis writes no answer line and the report shows no "You asked" line.
- **Agreement hidden but counted:** an accept with no text is a reaction under the post, never a reply row; reply
  counts and "N replies" exclude it; the synthesis still sees it.
- **A council the person is looking at when it ends:** no toast and no unread dot (they already see it).
- **A waiting council resolved elsewhere** (Continue pressed in the app): its Needs you item disappears on the next
  attention refresh, not left stale.

---

### Task 1: Round 2 picks and an answer-first summary

**Depends on:** none
**Files:** `pkg/council/prompts.go`, `pkg/council/parse.go`, `pkg/council/runner.go`, `pkg/council/types.go`, `pkg/council/prompts_test.go`, `pkg/council/parse_test.go`, `pkg/council/runner_test.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `Council.Picks map[string][]string` (`json:"picks,omitempty"`, expert id → up to 3 proposal ids);
  `CouncilSummary.Answer string` (`json:"answer,omitempty"`); `Round2Result.Picks []string`; TS `Council.picks?` and
  `CouncilSummary.answer?` through `task generate`.

- [ ] **Step 1: Tests.** `parse_test.go`: a round 2 reply with `"picks": ["P1","P3","P4","P5"]` parses to the first 3;
  a reply without `picks` parses with none. `runner_test.go`: `applyRound2` keeps only picks of other experts' non-cut,
  existing proposals, at most 3, in `c.Picks[e.Id]`; an `accept` stance with an empty reason is kept (a reply with
  empty `Text`). `prompts_test.go`: `Round2Prompt` asks for `picks` (the 3 most worth doing among the others') and says
  an accept needs no reason; `SynthesisPrompt` lists each proposal's pick count, asks to rank by it among the rest, and,
  only when `c.Question != ""`, asks for an `answer`: one sentence that answers the question directly; parsing a
  synthesis reply fills `Summary.Answer`.
- [ ] **Step 2:** Run `go test ./pkg/council -run 'Round2|Synthesis|Picks|Answer'` — Expected: FAIL.
- [ ] **Step 3:** Implement in the four files; extend the JSON shapes in `prompts.go`'s examples.
- [ ] **Step 4:** Run `go test ./pkg/council` — Expected: PASS. Run `task generate`; check `gotypes.d.ts` has
  `picks?` and `answer?`.
- [ ] **Step 5:** Commit `feat(council): round 2 names each expert's top 3 picks; the summary answers the question first`.

### Task 2: Plain words, picks and reactions in the Discussion

**Depends on:** Task 1 (reads `Council.picks`)
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councildiscussionmodel.ts`, `frontend/app/view/agents/councildiscussionmodel.test.ts`, `frontend/app/view/agents/councilthread.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `scripts/cdp/council/discussion.mjs`

**Interfaces:**
- Produces: `pickCount(c: Council, proposalId: string): number` and `reactions(c: Council, proposalId: string): string[]`
  (`["Reader agrees", …]`) in `councildiscussionmodel.ts`.

- [ ] **Step 1: Tests.** `STANCE_WORD` gives `Agrees`, `Has doubts`, `Is against it`; `proposalLine` reads
  `UX · 2 replies` (no id); `pickCount` counts experts whose `picks` hold the id, and falls back to accept − oppose when
  `c.picks` is absent; the proposal column ranks by it; `reactions` lists accepts with empty text as `<name> agrees`;
  reply counts exclude them; `scoreSummary` reads `Picked by 2 of 3 experts`.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilmodel.test.ts frontend/app/view/agents/councildiscussionmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement; `councilthread.tsx` draws the ↑ with the pick count and its title, the reactions as green
  chips under the post, and no reply row for an empty accept; `councildiscussion.tsx` drops ids from the column.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/discussion.mjs` assert the column shows no `P\d+`, a reaction chip
  `agrees`, and the ↑ title `Picked by`. Shown by `council-discussion`.
- [ ] **Step 6:** Commit `feat(council): the Discussion speaks plain words, ranks by picks, shows agreement as a reaction`.

### Task 3: A finished council opens on its report

**Depends on:** Task 1 (reads `CouncilSummary.answer`)
**Files:** `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/agentcenter.ts`, `frontend/app/view/agents/agentcenter.test.ts`, `scripts/cdp/council/summary.mjs`

**Interfaces:**
- Produces: `defaultCouncilView(c: Council | undefined): "discussion" | "summary"` in `councilsummarymodel.ts`
  (`"summary"` when the state is done, stopped or failed and a summary exists); `showCouncil(id, view?)` uses it when
  `view` is omitted.

- [ ] **Step 1: Tests.** `defaultCouncilView` for running, awaiting-you, done-with-summary, done-without-summary;
  the direction tag reads `Everyone agrees`, `Reader and UX have doubts`, `RAM is against it`; a direction's meta reads
  `from UX and RAM` (no ids); the matrix row label is the proposal's title; `STANCE_WORD` as in Task 2.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts frontend/app/view/agents/agentcenter.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. `councilsummary.tsx` (board `ReportDone`): header `Council · <feature>` with the state
  chip, time · tokens, **Show the discussion** (replacing the Back link), and Save as doc, Create initiative, Run again
  in a `⋯` menu; then "You asked: <question>" when there is one, the answer as one bold sentence (or the summary
  text's first sentence when no answer), the rest of the summary, the ranked directions with the new tags, Matrix
  folded at the bottom.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/summary.mjs` open a done fixture council from the tree and assert the Summary
  shows first, `Show the discussion` is present, a tag reads `Everyone agrees` or `have doubts`, no `P\d+`. Shown by
  `council-summary`.
- [ ] **Step 6:** Commit `feat(council): a finished council opens on its answer and ranked directions`.

### Task 4: Setup as one composer

**Depends on:** none
**Files:** `frontend/app/view/agents/councilsetup.tsx`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `scripts/cdp/council/setup.mjs`

**Interfaces:**
- Produces: `splitAsk(text: string): { feature: string; question: string }` (first non-empty line is the feature,
  the rest trimmed is the question) in `councilsetupmodel.ts`.

- [ ] **Step 1: Tests.** `splitAsk("Rail apps\nIs the pin worth it?")` → feature `Rail apps`, question
  `Is the pin worth it?`; one line → empty question; blank lines skipped; the draft keeps working when restored from an
  older draft that had separate feature and question.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilsetupmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement (board `ReportSetup`): "New council" and one sentence on what a council does; one
  composer (placeholder `What should the council review? The first line names it; ask a question under it.`), file and
  screenshot chips inside it, an attach button, the group as a chip, the estimate and **Start council** in its bar; one
  line naming the group's experts and what each looks at; **Options** unfolds the existing expert rows, models, files,
  Save as group and Pause after round 1. Everything Setup shows today stays reachable.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/setup.mjs` type two lines in the composer, assert the estimate and Start sit in
  the composer bar, open Options and assert the expert rows. Shown by `council-setup`.
- [ ] **Step 6:** Commit `feat(council): Setup is one composer; experts and files fold into Options`.

### Task 5: A toast and an unread dot when a council ends

**Depends on:** Task 3 (opens the report from the toast with `showCouncil`)
**Files:** `frontend/app/view/agents/councilnotify.ts`, `frontend/app/view/agents/councilnotify.test.ts`, `frontend/app/view/agents/councilnotifymount.tsx`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/council/tree.mjs`

**Interfaces:**
- Produces: `endedNotice(prev: Council | undefined, next: Council, viewing: boolean): { title: string; body: string } | null`
  in `councilnotify.ts` (non-null only on a change from running to done or stopped, when not viewing); an unread set
  kept per council id until its report is opened.

- [ ] **Step 1: Tests.** `endedNotice` fires once on running → done (`Council done`, the answer or the summary's first
  sentence), not on done → done, not while viewing; the tree row of an unread council carries `unread: true` and the
  word `Done`.
- [ ] **Step 2:** Run `npx vitest run frontend/app/view/agents/councilnotify.test.ts frontend/app/view/agents/agentsidebarmodel.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement; `councilnotifymount.tsx` subscribes to `council:changed` once and is mounted in the
  always-mounted Agent surface shell (where other surface-wide effects live); the toast uses `pushToast` and opens the
  report with `showCouncil(id, "summary")`; the tree draws the unread dot in `primary` ink, not the accent.
- [ ] **Step 4:** Run the same vitest command — Expected: PASS.
- [ ] **Step 5: Scenario.** In `council/tree.mjs` move a fixture council from running to done while another view is
  shown; assert a toast `Council done` and the row's unread dot; open it and assert the dot is gone. Shown by
  `council-tree`.
- [ ] **Step 6:** Commit `feat(council): a toast and an unread dot when a council ends`.

### Task 6: A council waiting on you is in Needs you

**Depends on:** none
**Files:** `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`

**Interfaces:**
- Produces: an attention item of kind `council` for each council in state `awaiting-you` (oref `council:<id>`,
  title `Council waiting on you: <feature>`); `openref` opens `council:<id>` with `showCouncil(id, "discussion")`.

- [ ] **Step 1: Tests.** `attention_test.go`: `BuildAttention` with one awaiting and one done council yields one
  `council` item; `briefingmodel.test.ts`: the item becomes a queue row with nav `{ kind: "council", … }` and an asking
  tone; `openref.test.ts`: `council:<id>` resolves to the council centre mode.
- [ ] **Step 2:** Run `go test ./pkg/jarvis -run Attention` and `npx vitest run frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/view/jarvis/openref.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement; feed the councils into `AttentionInput` where it is built (read them with `pkg/council`'s
  list), and count them in Jarvis's badge as the other waiting items are.
- [ ] **Step 4:** Run the same commands — Expected: PASS.
- [ ] **Step 5:** Commit `feat(council): a council waiting on you shows in Needs you`.

### Task 7: Changelog and hand checks

**Depends on:** Task 2 (its line), Task 3 (its line), Task 4 (its line), Task 5 (its line), Task 6 (its line)
**Files:** `CHANGELOG.md`, `docs/open-issues.md`

- [ ] **Step 1:** Under `## Unreleased` → `Changed`, one line each, written for the person: a finished council opens on
  its answer; the council speaks plain words and ranks ideas by the experts' top picks; New council is one box; under
  `Added`: a toast and a dot when a council ends, and a waiting council in Needs you.
- [ ] **Step 2:** In `docs/open-issues.md` "0 · Waiting on a hand check": run a real council with a question on the
  installed app and check the report opens with a one-sentence answer and that agreement shows as reactions.
- [ ] **Step 3:** Commit `docs(council): changelog lines and the hand check for the readable council`.
