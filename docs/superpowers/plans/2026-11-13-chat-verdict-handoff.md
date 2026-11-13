# Reviewer verdict and plan handoff cards in Chat — plan

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md` (all of it; the decisions below settle what it leaves open)
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-verdict-handoff chat-brainstorm-review chat-redesign agent-chat`
**Prototype:** D:\work\arcterm\.superpowers\design\chat-verdict-handoff\project

Goal: in a Claude agent's Chat, a reviewer's verdict (an ```` ```arc-review ```` block or a `ReportFindings` call) draws
as a verdict card with ticks and Fix / Skip, the plan handoff (`AskUserQuestion` with header `Handoff`) draws as a
four-row handoff card, and every run the conversation started draws as a run card at the `wsh runs start` call that
started it (queued state included). Each folds into its own ✓ row. A new arc skill (`arc:handoff`) teaches agents to
ask the handoff and write the block. Frontend plus one skill; no wavesrv change, no RPC, no migration.

Rules for every task:

- Read `DESIGN.md`, the spec, and for any view the two boards in the Prototype folder (open the `.dc.html` source; its
  sample copy is Vietnamese, the UI strings are the spec's English ones, section 7). Colours only from `@theme` tokens.
- Pure logic goes in a `.ts` with a `.test.ts` beside it; the `.tsx` stays thin. No jsdom render tests.
- Use the DOM contract below exactly: the scenario (Task 7) is written against it in parallel with the UI.
- Keep every `data-chat-bscard*` attribute the `chat-brainstorm-review` and `chat-redesign` scenarios read today.
- Simple and direct: no abstraction for one caller, errors handled at the boundary (a failed send shows on the card,
  as the brainstorm cards' `act.run` does), nothing swallowed silently.

## Builder decisions (made for this autonomous run, beyond the spec)

1. **One part kind per moment, made by `chatmodel.ts`.** `chatItems` splits an agent item's parts at each moment and
   emits a new `AgentPart`: `verdict` (an ```` ```arc-review ```` fence that parses, cut out of its prose with the
   prose before and after kept as their own prose parts; or a `ReportFindings` call, cut out of its work stretch),
   `handoff` (an `AskUserQuestion` call whose one question has header `Handoff`, cut out of its work stretch), and
   `runstart` (a Bash call whose command runs `wsh runs start` and whose output names a run or a queue entry; the work
   stretch is split after that call, and the call stays a tool line in it). Why: one place recognizes them, purely and
   testably, and the conversation draws parts as it already does. A fence that does not parse stays in the prose,
   where the markdown draws it as a code block (outside Chat it is raw JSON, as the spec says).
2. **Stable keys.** Each new part carries `key` = `<kind>:<entry index>` of the message or action it came from (a
   message with two `arc-review` fences: `verdict:<index>.<n>`). The verdict's send record and the run anchor use it.
3. **Verdict records reuse the brainstorm send record** (`chat.brainstorm.sent`): `RecordKind` gains `"verdict"`,
   with fields `verdictKey`, `verdictOutcome: "fix" | "skip"` and `fixed` (how many were ticked), under the fixed
   topic `VERDICT_TOPIC = "arc:verdict"`. The conversation pairs them with a second `pairAnswers` call (with or
   without a brainstorm), and a paired verdict line draws nothing (`pairedHidden`). The card itself folds in place
   into its ✓ row, finding its outcome by `verdictKey`. Why: one row per verdict, where the card was, and no second
   store.
4. **Verdict modes** (`verdictMode`): a record → folded with its outcome (`— Fix 2`, `— Skipped`); not the last part
   of the conversation → folded (`— You replied` when the next item is your message, no suffix when the agent wrote
   on); last and the agent exited, or an ended session → static card, no ticks, no buttons; last and the agent still
   working → card without ticks or buttons, tag Working; last, live and idle → waiting, ticks and both buttons. A
   passing verdict with no findings is folded from the start (`✓ Code review · Approved`): there is nothing to pick.
5. **Severities.** `Critical`, `Important`, `Minor`; Critical and Important start ticked. `ReportFindings`: CONFIRMED →
   Important, PLAUSIBLE → Minor, no verdict → Important; reviewer `code-review`; `pass` = no findings; note `N
   findings, M confirmed` (or `No findings`).
6. **Lines sent.** `Fix N selected` (disabled as `Fix none` at 0, as the board does) sends
   `Fix these review findings:` then one `- <file>:<line> — <summary>` line per ticked finding. `Skip the review` sends
   `Skip the review: go on without these changes.` Both go through the same prompt / wake path `sendBrainstorm` uses
   (`PromptIO`), the record kept only after the send succeeded.
7. **Reviewer pairing.** The block's `subagent` matches an `Agent` / `Task` call's `description` in the same agent
   item; without it, the nearest reviewer call before the block in that item (a call whose `subagent_type` or
   description contains "review", case-insensitive). `Open the review` shows only when the paired call resolves to a
   subagent transcript Arc can open; `/code-review` and `review-plan` have none.
8. **Handoff placement.** While the agent waits on a `Handoff` ask, the live handoff card replaces the `AskRow` in
   Chat's dock (`data-chat-ask`), where the plain choices are today, so it shows even before the tool call reaches the
   transcript. In the conversation an unanswered `handoff` part draws nothing while the agent is live, and a static
   card otherwise (an exited agent, an ended session). Once answered it is `✓ Handoff · <choice>`, or
   `✓ Handoff · You replied` (the typed text as its title) for a typed answer. A row click sends the agent's own option
   index (rows are drawn in the fixed order, mapped back by label with the `(Recommended)` suffix dropped,
   case-insensitive); a fixed row the agent did not offer is drawn disabled.
9. **Handoff facts.** Plan path: the first `*.md` path in the question text (backticked or bare); relative paths
   resolve against the agent's working directory. Title: the plan's `# ` heading. Tasks: `### Task N` / `## Task N`
   headings. "Up to W at once": the widest level of the Depends graph (no Depends line = after the previous task,
   `none` = level 0, otherwise 1 + the deepest listed task). Runs: `RunQueueListCommand`'s `active` and `maxactive`
   (`2 of 3 runs active`). Each missing piece is left out of the line; the card always draws. Row details: the agent's
   option description when it gave one, else the board's sentence.
10. **Run cards.** A conversation's runs are the runs whose `origintranscript` equals its transcript path, plus
    `brainstorm.run`, by id, deduplicated; the brainstorm's run keeps its brainstorm place and is not drawn again. A
    `runstart` part whose anchor is `started run <id>` draws that run's card; `queued <entryId>` draws the queued card
    (`Queued`, `Queued · after <run title>`, `Queued · blocked: <reason>`) from `runQueueAtom`, and once the entry has
    left the queue it follows the run `runQueueStartedAtom` names, else the oldest run of this conversation created
    after the anchor that no anchor claims. A conversation run that no anchor claims draws at the end of the
    conversation, before the brainstorm's card. A card folds in place into its ✓ row when the run is landed, complete
    or cancelled. The queued stage is the card's own (`data-chat-bscard-run-stage="queued"`); `runStage` gains none.
11. **The run-ended message.** A user (or `sent`) item whose first line matches
    `^\[arc\] Run ([0-9a-f]{8})( "…")? (landed: …|held: …|held\.)` and whose id prefixes a run card of this
    conversation (brainstorm's run included) draws nothing; that run's ✓ row reads `Run <id8> landed · <what follows
    "landed: " up to the line's end, trailing period dropped>` or `Run <id8> held: <reason>`, and opens (a caret,
    `aria-expanded`) to the message as written. With no such message the ✓ row is the existing `runDoneLine`. A
    message that pairs no card stays a bubble. Eight characters, as the message and `shortRunId` print it (the spec's
    `3fa2…` is an illustration).
12. **Scenario.** The CDP steps go into a scenario of their own, `chat-verdict-handoff`
    (`scripts/cdp/scenarios-chat-verdict-handoff.mjs`), registered in `scenarios.mjs` with the `CBR_KIT` kit, instead
    of new steps in `agent-chat`. Why: the precedent of `chat-brainstorm-review` (a 69k-line shared file other plans
    edit, and a scenario that runs alone); `agent-chat` still runs in the Final, unchanged.
13. **Static cards.** An exited agent or an ended session (`showSession`, `endedtranscript.tsx`) draws every card
    static: no amber dot, no ticks, no buttons, still the links (Open the plan, Open the review, Open run).

## DOM contract

```
verdict card   [data-chat-bscard-kind="verdict"][data-chat-bscard-state="waiting|working|static"][data-chat-vcard="<key>"]
               [data-chat-vcard-chip="changes|approved"], [data-chat-vcard-note], [data-chat-vcard-open] (Open the review)
               [data-chat-vcard-finding="<i>"][data-severity="Critical|Important|Minor"]
                 [data-chat-vcard-tick][aria-checked], [data-chat-vcard-loc] (file:line link), [data-chat-vcard-summary]
               [data-chat-vcard-fix] (its text "Fix N selected" / "Fix none"), [data-chat-vcard-skip], [data-chat-vcard-error]
handoff card   [data-chat-bscard-kind="handoff"][data-chat-bscard-state="waiting|static"]
               [data-chat-hcard-plan-open], [data-chat-hcard-title], [data-chat-hcard-facts]
               [data-chat-hcard-row="A|B|C|D"][data-choice="<label>"] (a button, disabled when not offered),
                 [data-chat-hcard-recommended] inside the recommended row
run card       [data-chat-bscard-kind="run"][data-chat-run-card="<runId or entryId>"], [data-chat-bscard-run-stage="<RunStageKey>|queued"],
               [data-chat-run-queued] (the Queued line), [data-chat-bscard-run-open]
✓ rows         [data-chat-bscard-done="verdict|handoff|run"]; a run row with an ended message also
               [data-chat-run-ended][aria-expanded] and, open, [data-chat-run-ended-text]
```

### Task 1: Verdict model and the verdict send record
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatverdict.ts`, `frontend/app/view/agents/chatverdict.test.ts`, `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/chatbrainstormwire.ts`, `frontend/app/view/agents/chatbrainstormwire.test.ts`

New pure `chatverdict.ts` (decisions 3–7). Exports other tasks rely on:

```ts
export const REVIEW_LANG = "arc-review";
export const VERDICT_TOPIC = "arc:verdict";
export type Severity = "Critical" | "Important" | "Minor";
export type VerdictFinding = { severity: Severity; file: string; line?: number; summary: string };
export type Verdict = { kind: "code" | "plan"; reviewer: string; pass: boolean; note: string; findings: VerdictFinding[]; subagent?: string };
export type ReviewerCall = { description: string; subagentType?: string; toolUseId?: string; index: number };
export type VerdictOutcome = { kind: "fix"; fixed: number } | { kind: "skip" } | { kind: "replied" } | { kind: "moved-on" };
export type VerdictMode = { mode: "waiting" | "working" | "static" } | { mode: "folded"; outcome: VerdictOutcome | null };
export function parseReviewBlock(raw: string): Verdict | null;            // null: broken JSON, no boolean `pass`, bad kind
export function splitReviewBlocks(text: string): ({ kind: "prose"; text: string } | { kind: "verdict"; verdict: Verdict })[];
export function verdictFromFindings(input: unknown): Verdict | null;     // ReportFindings tool input
export function pairReviewer(v: Verdict, calls: readonly ReviewerCall[], blockIndex: number): ReviewerCall | null;
export function initialTicks(v: Verdict): Set<number>;
export function verdictMode(i: { last: boolean; live: boolean; working: boolean; nextIsYou: boolean; record: Pick<PairedAnswer, "verdictOutcome" | "fixed"> | null; v: Verdict }): VerdictMode;
export function verdictHead(v: Verdict): string;                          // "Code review · code-reviewer"
export function verdictChip(v: Verdict): "Changes requested" | "Approved";
export function fixLabel(n: number): string;                              // "Fix 2 selected" | "Fix none"
export function fixLine(v: Verdict, ticked: readonly number[]): string;
export function skipLine(): string;
export function verdictDoneLine(v: Verdict, outcome: VerdictOutcome | null): string; // "Code review · Changes requested · 3 findings — Fix 2"
export function verdictRecord(key: string, outcome: "fix" | "skip", fixed: number, line: string, seen: number, now: number): SentAnswer;
```

In `chatbrainstorm.ts`: `RecordKind` gains `"verdict"`; `SentAnswer` and `PairedAnswer` gain `verdictKey?`,
`verdictOutcome?: "fix" | "skip"`, `fixed?`; the stored-record parser keeps them when well-typed; `pairedOf` copies
them. In `chatbrainstormwire.ts`: `pairedHidden` hides a `"verdict"` record. A record without the new fields reads as
before.

Tests (`npx vitest run frontend/app/view/agents/chatverdict.test.ts frontend/app/view/agents/chatbrainstorm.test.ts frontend/app/view/agents/chatbrainstormwire.test.ts`):
a block parsed (with and without `findings`, `subagent`); broken JSON, missing `pass`, wrong `kind` → null; prose
split around two fences and around one broken fence (kept as prose); `ReportFindings` mapped (CONFIRMED / PLAUSIBLE /
none, empty → pass); initial ticks; every `verdictMode` branch, the approved-with-no-findings fold included; each ✓
row text; fix / skip lines; pairing by `subagent` and by nearest reviewer call, none before the block → null; a
verdict record stored, reloaded, paired and hidden; an old record still reads as an answer.

### Task 2: Handoff model
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chathandoff.ts`, `frontend/app/view/agents/chathandoff.test.ts`

New pure `chathandoff.ts` (decisions 8–9, spec section 3):

```ts
export const HANDOFF_HEADER = "Handoff";
export const HANDOFF_CHOICES = ["Arc engine", "Arc engine, queued", "Inline in this session", "Subagent-driven"] as const;
export type HandoffChoice = (typeof HANDOFF_CHOICES)[number];
export function isHandoffAsk(questions: readonly { header?: string }[] | undefined): boolean; // exactly one question, header "Handoff"
export type HandoffRow = { letter: "A" | "B" | "C" | "D"; label: HandoffChoice; detail: string; recommended: boolean; optionIndex: number | null };
export function handoffRows(q: { options?: readonly { label: string; description?: string }[] }): HandoffRow[];
export function planPathOf(question: string): string | null;
export type PlanFacts = { title?: string; tasks?: number; width?: number };
export function planFacts(planText: string): PlanFacts;
export function factsLine(i: { path?: string | null; facts?: PlanFacts | null; runs?: { active: number; max: number } | null }): string;
export function isEngineChoice(choice: string): boolean;
export function handoffDoneLine(a: { picked: readonly string[]; typed?: string }): string; // "Handoff · Arc engine" | "Handoff · You replied"
```

The facts line follows the board: `<file name> · 5 tasks, up to 3 at once · 2 of 3 runs active`, parts left out
when unknown. Never the word "Native".

Tests (`npx vitest run frontend/app/view/agents/chathandoff.test.ts`): recognition (header `Handoff`, another
header, two questions); rows in fixed order whatever order the agent sent, `Recommended` taken from the
`(Recommended)` suffix and the suffix dropped, a choice the agent left out → `optionIndex` null, the agent's
description used and the default used; plan path in backticks, bare, absent; facts of a serial plan, a plan with
`none` and listed Depends (width), a plan with no tasks; the facts line with and without each piece; the ✓ row text
for each choice and for a typed answer.

### Task 3: Run-card model
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatruncards.ts`, `frontend/app/view/agents/chatruncards.test.ts`

New pure `chatruncards.ts` (decisions 10–11, spec sections 4–5):

```ts
export type RunAnchor = { kind: "started"; runId: string } | { kind: "queued"; entryId: string };
export function runStartAnchor(command: string, output: string): RunAnchor | null; // `wsh runs start …` and its "started run <id>" / "queued <id>" line
export function conversationRuns(transcriptPath: string | undefined, runs: readonly Pick<Run, "oid" | "origintranscript" | "createdts">[], brainstormRun?: string | null): string[];
export type RunCardSlot = { runId: string } | { entryId: string; runId?: string };
export function placeRunCards(i: { anchors: readonly { key: string; anchor: RunAnchor; order: number }[]; runs: readonly { runId: string; createdTs?: number }[]; brainstormRun?: string | null; queued: readonly Pick<RunQueueEntry, "id">[]; started: Readonly<Record<string, string>> }): { byAnchor: Map<string, RunCardSlot>; trailing: string[] };
export type QueuedView = { state: "waiting"; after?: string } | { state: "blocked"; reason: string } | { state: "started"; runId: string } | { state: "gone" };
export function queuedView(entryId: string, queue: readonly RunQueueEntry[], started: Readonly<Record<string, string>>, afterTitle: (runOrEntryId: string) => string | undefined): QueuedView;
export function queuedLabel(v: QueuedView): string; // "Queued" | "Queued · after <title>" | "Queued · blocked: <reason>"
export type RunEnded = { id8: string; landed: boolean; detail: string; text: string };
export function parseRunEnded(text: string): RunEnded | null;
export function pairRunEnded(messages: readonly { key: string; text: string }[], runIds: readonly string[]): Map<string, { runId: string; ended: RunEnded }>;
export function runEndedLine(runId: string, ended: RunEnded): string; // "Run 3fa21b0c landed · merged into main" | "Run 3fa21b0c held: <reason>"
```

Match `originMessage` in `pkg/wshrpc/wshserver/wshserver_originnotify.go` (an optional quoted goal sits between the id
and `landed:` / `held`) and the `wsh runs start` output in `cmd/wsh/cmd/wshcmd-runs.go` (`started run`, `queued <id>`,
`queued <id> (#n in line) — …`, `queued <id> — blocked: …`).

Tests (`npx vitest run frontend/app/view/agents/chatruncards.test.ts`): anchors from each output shape, a command
that is not `wsh runs start`, output that only quotes an id; runs found by transcript plus the brainstorm run,
deduplicated, another transcript's left out; placement (started anchor, queued anchor that started per `started`,
one that started with no `started` entry claiming the oldest later run, a trailing run, the brainstorm run excluded);
the queued view waiting, after a run, blocked, started, gone; the ended message landed, held with a reason, bare
held, with a goal, a message for a run of another conversation (not paired), a typed message that only quotes the
prefix mid-text (not paired).

### Task 4: Project ReportFindings and subagent calls
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/transcriptprojection.ts`, `frontend/app/view/agents/transcriptprojection.test.ts`

The action entry (`AgentEntry` kind `action`) gains two optional fields, not new `ActionDetail` kinds (so no switch
over `detail.kind` changes): `findings?: ReportedFinding[]` (`{ file: string; line?: number; summary: string;
verdict?: string; category?: string }`) on a `ReportFindings` call, from its input; and `subagent?: { description:
string; subagentType?: string; toolUseId?: string }` on a `Task` / `Agent` call. `transcriptprojection.ts` fills them
at the `tool_use` record (beside the `AskUserQuestion` branch); bad input leaves the field off. Check that the Bash
action's `bash` detail carries the command and output a `wsh runs start` call needs (Task 8 reads them); if it does
not, add them in the same place.

Tests (`npx vitest run frontend/app/view/agents/transcriptprojection.test.ts`): a `ReportFindings` call projected with
its findings, one with malformed input (no field), an `Agent` call with description and type, a `Task` call.

### Task 5: Card shell and ✓ row for the new cards
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstormparts.tsx`

`CardKind` gains `"verdict"` and `"handoff"`. `CardShell` takes an optional `action?: ReactNode` drawn where
`OpenButton` is (the header's right end), and `agent` becomes optional: `OpenButton` (Open in Brainstorm) shows only
for a brainstorm card (no `action`, an `agent`). `DoneRow`'s `kind` gains `"verdict"` and `"handoff"`, and it takes an
optional `detail?: string`: when given, the row is a button with a caret and `aria-expanded` that opens the detail
text under it (pre-wrapped, muted), with `data-chat-run-ended` / `data-chat-run-ended-text` on a run row. Existing
callers and their attributes are unchanged. Motion stays the spring the question card uses.

Acceptance: `task check:ts` clean; the `chat-brainstorm-review` scenario's card and ✓ row steps still pass in the
Final (no visual change to existing cards).

### Task 6: The arc:handoff skill
**Depends on:** none
**Model:** sonnet
**Files:** `skills/handoff/SKILL.md`, `skills/skills.go`, `skills/skills_test.go`, `AGENTS.md`, `docs/guide/agent-integration.md`, `docs/guide/setup.md`

New skill `skills/handoff/SKILL.md` (frontmatter `name: handoff`), spec section 6 "Skill": its description fires
when `superpowers:writing-plans` finishes a plan inside Arc (`wsh` on PATH) and when a review returns inside Arc,
riding on them the way `skills/brainstorm/SKILL.md` rides on brainstorming. Two sections:

- **Handoff**: in place of writing-plans' own two-option handoff, ask with `AskUserQuestion`, header `Handoff`, the
  question naming the plan file path, four options in this order and wording: `Arc engine`, `Arc engine, queued`,
  `Inline in this session`, `Subagent-driven`, each with a one-sentence description; mark one `(Recommended)` by the
  rules `AGENTS.md` keeps today ("A finished plan offers the engine first": move them here whole, `--after`, a Mac
  hand check, `runs:maxactive` included); never call Inline "Native"; picking an engine choice is the yes for the
  fan-out cost; then run `wsh runs start --plan <file>` (or `--queue` / `--after`) yourself.
- **arc-review**: after every review subagent (`superpowers:code-reviewer`, `review-plan`, any reviewer), write
  one fenced block tagged `arc-review` in the reply holding one JSON object `{kind: "code"|"plan", reviewer, pass, note,
  findings?: [{severity: "Critical"|"Important"|"Minor", file, line, summary}], subagent}`, with `subagent` the
  `description` of the `Agent` call it judges; then stop and wait when findings need the user's pick. `/code-review`
  needs no block (its `ReportFindings` is read directly).

Register `handoff` in the `//go:embed` line of `skills/skills.go` and assert it embeds in `skills/skills_test.go`
(as `doc-review` is). In `AGENTS.md` replace the "A finished plan offers the engine first" bullet's rule with a
one-line pointer to `arc:handoff` (keep the "A handoff written for a new session names the chosen method" sentence),
and add `handoff` to the skills list bullet. Add the `arc:handoff` row to the skill tables of
`docs/guide/agent-integration.md` and `docs/guide/setup.md` (Vietnamese, as those pages are) and to their name lists.

Tests: add the `handoff` assertion to `TestShippedSkills` and run `go test ./skills -run '^TestShippedSkills$'`.

### Task 7: The chat-verdict-handoff scenario
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-verdict-handoff.mjs`, `scripts/cdp/scenarios.mjs`

A scenario of its own (decision 12), modelled on `scripts/cdp/scenarios-chat-brainstorm-review.mjs` (its fixture
agent over a real tab with a shell controller, mock roster row, fixture transcript appended the way Claude Code
writes it, `fstWriteRun` for fixture runs, the send record read back from `localStorage['chat.brainstorm.sent']`),
written against the DOM contract above, registered in `scenarios.mjs` beside `chatBrainstormReviewScenarios(CBR_KIT)`.
Teardown puts the roster, localStorage keys, runs and tabs back. Steps, each with its own shot and assert:

1. Verdict card waiting: the transcript ends on a reply with an `arc-review` block (3 findings: 2 Important, 1
   Minor) after an `Agent` call with `subagent_type` `superpowers:code-reviewer`; roster row idle. Assert the card
   state `waiting`, chip `changes`, the note, 3 finding rows, the two Important ticked and the Minor not, `Fix 2
   selected`, `Skip the review`.
2. Tick the Minor, then untick both Important: `Fix 1 selected`; click Fix: the record (topic `arc:verdict`, kind
   `verdict`, outcome `fix`, fixed 1) is in localStorage; append the line as the user message; assert the card is
   gone, `[data-chat-bscard-done="verdict"]` reads `Code review · Changes requested · 3 findings — Fix 1`, and the
   line draws no bubble.
3. A `ReportFindings` verdict the agent wrote on after (a later reply): folded at once, no ticks.
4. Handoff card waiting: roster row asking with a `Handoff` `AskUserQuestion` whose question names a fixture plan
   file (5 tasks, two parallel), options in the agent's order with `Arc engine (Recommended)` first. Assert the card
   in `[data-chat-ask]`, title, facts line (`5 tasks`, `at once`), rows A–D in fixed order, `Recommended` on A.
5. Click row A: the mock records the ask answer with the agent's option index for `Arc engine`.
6. Handoff folded: the transcript holds the answered `AskUserQuestion` (picked `Arc engine`) and a Bash
   `wsh runs start --plan …` call whose result is `started run <id> (…)` for a fixture run whose `origintranscript` is
   the fixture transcript; roster row idle. Assert `✓ Handoff · Arc engine` followed by the run card
   (`data-chat-run-card="<id>"`, a stage, Open run).
7. A run started outside a brainstorm or handoff (a plain Bash `wsh runs start` call, no ask before it) draws its run
   card; then the run is landed and an `[arc] Run <id8> landed: merged into main.` user message is appended: the
   card folds into `[data-chat-bscard-done="run"]` reading `Run <id8> landed · merged into main`, the message draws
   no bubble, and clicking `[data-chat-run-ended]` opens `[data-chat-run-ended-text]` with the message.
8. A queued run: a Bash call whose result is `queued <entryId> (#1 in line) — …` and a queue entry for it (seed the
   page's `runQueueAtom` the way the agent-tree queued scenarios do): the card shows `[data-chat-run-queued]`
   `Queued`.

Acceptance: `node scripts/cdp/verify.mjs chat-verdict-handoff` runs (it will fail until Tasks 8–13 land; that is
expected for this task alone); `node --check scripts/cdp/scenarios-chat-verdict-handoff.mjs` passes.

### Task 8: Chat model parts for the three moments
**Depends on:** Task 1 (uses splitReviewBlocks, verdictFromFindings, pairReviewer), Task 2 (uses isHandoffAsk), Task 3 (uses runStartAnchor), Task 4 (uses the findings and subagent fields on actions)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/chatitemeq.ts`, `frontend/app/view/agents/chatitemeq.test.ts`, `frontend/app/view/agents/chatconversation.tsx`

Decisions 1–2. `AgentPart` gains:

```ts
| { kind: "verdict"; key: string; verdict: Verdict; reviewer?: ReviewerCall }
| { kind: "handoff"; key: string; question: AskQuestionDetail }
| { kind: "runstart"; key: string; anchor: RunAnchor }
```

`chatItems` makes them as decision 1 says; a work stretch emptied by the cut leaves no empty work part; files parts
stay after their work. `chatitemeq.ts` compares the new parts (by key and content) so a kept element redraws only
when they change. In `chatconversation.tsx`, `drawPart` returns `null` for the three new kinds (Task 12 draws them);
nothing else there changes.

Tests (`npx vitest run frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatitemeq.test.ts`): a
reply with an `arc-review` block between two paragraphs (three parts), a broken block (one prose part), a
`ReportFindings` call mid-stretch (work, verdict, work), the reviewer paired by `subagent` and by nearest call, a
`Handoff` ask answered and unanswered, a plain `AskUserQuestion` left in the work, a `wsh runs start` call
(work, runstart) and one with no id in its output (no part), keys stable as entries append.

### Task 9: The verdict card
**Depends on:** Task 1 (uses the verdict model and record), Task 5 (uses CardShell's action and DoneRow's kinds)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatverdictcard.tsx`, `frontend/app/view/agents/chatverdictsend.ts`, `frontend/app/view/agents/chatverdictsend.test.ts`

Board `B-pick-and-send.dc.html`. `chatverdictsend.ts`: `sendVerdict(agent, key, outcome, line, io = tauriPromptIO,
now)` sends the line (wake when asleep, else prompt, as `sendBrainstorm` does), then keeps `verdictRecord(...)` with
`recordBrainstormAnswer`; a failure throws with the agent's name, nothing recorded. `chatverdictcard.tsx` exports:

```tsx
export function ChatVerdictCard(p: { verdictKey: string; verdict: Verdict; mode: VerdictMode; agent?: AgentVM; model?: AgentsViewModel; reviewer?: ReviewerCall | null }): ReactNode
```

A folded mode draws `DoneRow kind="verdict"` with `verdictDoneLine`. Otherwise `CardShell kind="verdict"` (state from
the mode; `data-chat-vcard`), head icon + `verdictHead`, the chip (warning tint for Changes requested, success for
Approved, tokens only), the note, one row per finding (severity pill, `file:line` opening the file the way Chat's file
pill does, summary), and in `waiting` only: a tick box per finding (`TickBox` from the parts file, initial ticks from
`initialTicks`, kept per verdict key in a module-level jotai atom so a remount keeps them), `Fix N selected` (primary
button) and `Skip the review`, an `Or type below what to change` hint, and the send error on the card. `Open the
review` (header action) opens the paired subagent's transcript the way the Agent surface opens a subagent's interior
(find it from `scripts/cdp/scenarios-agent-subagents.mjs` and the subagent rows in `agentrailpanel.tsx`); left out when
`reviewer` is null or does not resolve.

Tests (`npx vitest run frontend/app/view/agents/chatverdictsend.test.ts`): a sent fix keeps its record with the right
`seen`; a sleeping agent is woken with the line; a failed prompt throws and records nothing. The card is shown by the
`chat-verdict-handoff` scenario steps 1–3.

### Task 10: The handoff card
**Depends on:** Task 2 (uses the handoff model), Task 5 (uses CardShell's action and DoneRow's kinds)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chathandoffcard.tsx`, `frontend/app/view/agents/chathandoffstore.ts`

Board `H-A-rows.dc.html`. `chathandoffstore.ts`: `usePlanFacts(path: string | null, cwd: string | undefined):
PlanFacts | null` (one `FileReadCommand` per resolved path, cached in a module atom; a failed read is logged once and
leaves the facts out) and `useRunSlots(): { active: number; max: number } | null` (`RunQueueListCommand` on mount,
re-read on `runqueue:changed`; failure → null). `chathandoffcard.tsx` exports:

```tsx
export function ChatHandoffCard(p: { question: { question: string; options?: AgentAskOption[] }; state: "waiting" | "static"; agent?: AgentVM; onPick?: (optionIndex: number) => void }): ReactNode
export function ChatHandoffDone(p: { picked: readonly string[]; typed?: string }): ReactNode
```

Header: icon, `Plan ready`, the amber `Waiting on you` tag only when waiting, `Open the plan` (opens the plan file as
Chat opens a file; left out with no path). Then the title and the facts line, the four lettered rows
(`OptionRows` look from the parts file: letter, label, detail, `Recommended` pill on the recommended row, accent
border on it as the board has), a row with `optionIndex` null disabled, rows disabled in `static`, and the hint
`Or type below to answer in your own words`. `ChatHandoffDone` is `DoneRow kind="handoff"` with `handoffDoneLine`.

Acceptance: shown by the `chat-verdict-handoff` scenario steps 4–6.

### Task 11: Run cards for every run of the conversation
**Depends on:** Task 3 (uses the run-card model), Task 5 (uses CardShell's action and DoneRow's detail)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatruncard.tsx`, `frontend/app/view/agents/chatbrainstormrun.tsx`, `frontend/app/view/agents/runoriginstore.ts`

`runoriginstore.ts`: `useConversationRuns(transcriptPath: string | undefined): Run[]` — the origin-run index
(`watchOriginRuns`, live run objects, as `useRunsStartedBy` does) filtered by `conversationRuns`. `chatruncard.tsx`
exports:

```tsx
export function ChatRunCard(p: { slot: RunCardSlot; model?: AgentsViewModel; agent?: AgentVM; live: boolean; ended?: RunEnded | null; rowProps?: ComponentProps<typeof motion.div> }): ReactNode
```

It draws the run card (move `RunCardBox` here from `chatbrainstormrun.tsx` and share it, with `CardShell`'s `action`
holding Open run so it needs no agent; `data-chat-run-card`), the queued state (`queuedView` / `queuedLabel` over
`runQueueAtom`, `runQueueStartedAtom`, the after-run titles `queuedRowsAtom` already resolves; `data-chat-run-queued`,
stage `queued`, then the run's own stage once started), and once the run is done, in place, `DoneRow kind="run"` with
`runEndedLine` and the message as `detail` when `ended` is given, else `runDoneLine`. `live` false makes the card
static. Make sure the run queue is loaded (the store's existing mount hook). `chatbrainstormrun.tsx` keeps its
exports and attributes and uses the shared box; `ChatBrainstormRunDone` takes an optional `ended` the same way.

Acceptance: `task check:ts`; the brainstorm run card steps of `chat-brainstorm-review` unchanged; shown by
`chat-verdict-handoff` steps 6–8.

### Task 12: Draw the cards in the conversation
**Depends on:** Task 8 (shares chatconversation.tsx), Task 1 (pairs verdict records and uses verdictMode), Task 9 (draws ChatVerdictCard), Task 10 (draws ChatHandoffCard and ChatHandoffDone), Task 11 (draws ChatRunCard and uses useConversationRuns)
**Model:** sonnet
**Chunk:** Chat: the reviewer's verdict as a card (plan review, code review)
**Files:** `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/endedtranscript.tsx`, `CHANGELOG.md`

In `ChatConversation`: read the agent's records (`brainstormAnswersAtom(agent.id)`, none without an agent) and pair
the `VERDICT_TOPIC` ones with `pairAnswers` beside the brainstorm pairing, so verdict lines draw nothing; find each
verdict's record by `verdictKey` and its mode with `verdictMode` (last = the last part of the last drawn item; live =
an agent that has not exited; working = `toolsLive`; nextIsYou from the next item). Draw `verdict` parts with
`ChatVerdictCard`; `handoff` parts with `ChatHandoffDone` when answered, nothing when unanswered and the agent is live,
a static `ChatHandoffCard` otherwise; `runstart` parts with `ChatRunCard` per `placeRunCards` (runs from
`useConversationRuns` over the agent's transcript path, or a new `transcriptPath` prop for an ended session; the
brainstorm's run from the brainstorm prop), and the trailing runs at the end before the brainstorm card. Hide each
user or sent item `pairRunEnded` pairs with a run card of this conversation (no wrapper, as `drawnVisible` leaves a
hidden line), and hand its `RunEnded` to that run's card (or to `ChatBrainstormRunDone` for the brainstorm's run).
Extend the kept-element compare (`answerKey` / `DrawnItem`) so a mode or record change redraws. In
`endedtranscript.tsx` pass the session's transcript path so its cards draw, static.

`CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top has a date), written for the
user: Chat draws a reviewer's verdict as a card you tick and send, the plan handoff as four choices, and a card for
every run the agent starts, each folding to a ✓ row.

Acceptance: `task check:ts`; `npx vitest run frontend/app/view/agents/chatverdict.test.ts frontend/app/view/agents/chatruncards.test.ts`;
shown by `chat-verdict-handoff` steps 1–3 and 6–8.

### Task 13: The live handoff card in Chat's dock
**Depends on:** Task 10 (draws ChatHandoffCard), Task 12 (its card folds into the ✓ Handoff row Task 12 draws; the two chunks need both)
**Model:** sonnet
**Chunk:** Chat: the plan handoff as a card (Arc engine, queued, inline, subagent-driven)
**Files:** `frontend/app/view/agents/chatpane.tsx`

In `chatpane.tsx`, where the live ask draws (`asking` → `AskRow` inside `data-chat-ask`): when
`isHandoffAsk(agent.ask.questions)`, draw `ChatHandoffCard` with state `waiting` (`static` for an exited agent) in
place of `AskRow`, keeping the `data-chat-ask` wrapper. `onPick(optionIndex)` answers through
`answerAgentAsk(model, agent.id, { 0: new Set([optionIndex]) }, {})` (askanswer.ts), which locks a second click; a
false return (already sent, ask gone) leaves the card as it is. Typing in the box still answers the ask in words as it
does for any ask today. The placeholder and Permission card logic are unchanged.

Acceptance: `task check:ts`; shown by `chat-verdict-handoff` steps 4–5 (card in the dock, click answers with the
agent's option index).
