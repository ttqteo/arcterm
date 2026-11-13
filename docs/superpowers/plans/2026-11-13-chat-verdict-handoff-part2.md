# Reviewer verdict and plan handoff cards in Chat — plan, part 2 (the cards and their wiring)

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md` (all of it; the decisions below settle what it leaves open)
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-verdict-handoff chat-brainstorm-review chat-redesign agent-chat`
**Prototype:** .superpowers/design/chat-verdict-handoff/project

Goal: in a Claude agent's Chat, a reviewer's verdict (an ```` ```arc-review ```` block or a `ReportFindings` call) draws
as a verdict card with ticks and Fix / Skip, the plan handoff (`AskUserQuestion` with header `Handoff`) draws as a
four-row handoff card, and every run the conversation started draws as a run card at the `wsh runs start` call that
started it (queued state included). Each folds into its own ✓ row. A new arc skill (`arc:handoff`) teaches agents to
ask the handoff and write the block. Frontend plus one skill; no wavesrv change, no RPC, no migration.

Part 1 (run 911b6d3a, plan `docs/superpowers/plans/2026-11-13-chat-verdict-handoff.md`, Tasks 1–6) has landed in
this run's base: the pure models `chatverdict.ts` (verdict, `VERDICT_TOPIC`, `verdictMode`, the lines and ✓ rows,
`pairReviewer`; the `"verdict"` send record in `chatbrainstorm.ts` / `chatbrainstormwire.ts`), `chathandoff.ts`,
`chatruncards.ts`; the `findings` and `subagent` fields on projected actions (`agentsviewmodel.ts`,
`transcriptprojection.ts`); `CardShell`'s `action` and `DoneRow`'s `verdict` / `handoff` kinds and `detail`
(`chatbrainstormparts.tsx`); and the `arc:handoff` skill. Read those files for the exact exports before you start:
where they differ from the signatures quoted in a task below, the landed code wins. This part is the old Tasks 7–13,
renumbered 1–7; the decisions and the DOM contract are unchanged.

Rules for every task:

- Read `DESIGN.md`, the spec, and for any view the two boards in the Prototype folder (open the `.dc.html` source; its
  sample copy is Vietnamese, the UI strings are the spec's English ones, section 7). Colours only from `@theme` tokens.
- Pure logic goes in a `.ts` with a `.test.ts` beside it; the `.tsx` stays thin. No jsdom render tests.
- Use the DOM contract below exactly: the scenario (Task 1) is written against it in parallel with the UI.
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
   subagent transcript Arc can open; `/code-review` and `review-plan` have none. The call resolves by its tool-use id:
   `SubagentVM` today has no link to the `Agent` / `Task` call that spawned it (`correlateSubagents` pairs files to
   spawns by prompt text, which a `ReviewerCall` does not carry), so `SubagentVM` gains `toolUseId`, set from the
   matched spawn, and the card finds the subagent whose `toolUseId` equals `ReviewerCall.toolUseId`.
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
    or cancelled, or when a run-ended message is paired with it (a held run never reaches a done stage; its
    `[arc] Run … held:` message is what folds it). The brainstorm's run folds the same way: a paired message hides
    its live card (`ChatBrainstormRunRow`) and makes its `brainstorm: run` line draw the ✓ row
    (`ChatBrainstormRunDone`), as a done run does. The queued stage is the card's own (`data-chat-bscard-run-stage="queued"`); `runStage` gains none.
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
13. **Static cards.** An exited agent draws every card static: no amber dot, no ticks, no buttons, still the links
    (Open the plan, Open the review, Open run). An ended session in Conversation History (`showSession`) draws through
    `CompactTranscript`, not Chat, and is out of scope (the spec was corrected to say so in part 1).
14. **Open in Brainstorm stays.** `CardShell` shows `OpenButton` whenever an agent is passed, beside an `action`; the
    brainstorm run card keeps `[data-chat-bscard-open]`. Only cards with no agent show the action alone.
15. **No cap.** `runs:maxactive` 0 means no cap: the facts line leaves the runs part out.

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

### Task 1: The chat-verdict-handoff scenario
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-verdict-handoff.mjs`, `scripts/cdp/scenarios.mjs`

A scenario of its own (decision 12), modelled on `scripts/cdp/scenarios-chat-brainstorm-review.mjs` (its fixture
agent over a real tab with a shell controller, mock roster row, fixture transcript appended the way Claude Code
writes it, `fstWriteRun` for fixture runs, the send record read back from `localStorage['chat.brainstorm.sent']`),
written against the DOM contract above, registered in `scenarios.mjs` beside `chatBrainstormReviewScenarios(CBR_KIT)`.
Teardown puts the roster, localStorage keys, runs and tabs back. Every fixture run the conversation started sets both
`origintranscript` (the fixture transcript) and `origintabid` (the fixture agent's tab), as `CreateRunCommand` does
(`pkg/wshrpc/wshserver/wshserver_runs.go`, `run.OriginTabId` / `run.OriginTranscript`): the origin-run index
(`runoriginstore.ts`) keeps only runs with an `origintabid`, so a run with the transcript alone never reaches
`useConversationRuns`. Steps, each with its own shot and assert:

1. Verdict card waiting: the transcript ends on a reply with an `arc-review` block (3 findings: 2 Important, 1
   Minor; `subagent` naming the call) after an `Agent` call with `subagent_type` `superpowers:code-reviewer`, with a
   subagent transcript written beside the fixture transcript where Claude Code writes one (see
   `scripts/cdp/scenarios-agent-subagents.mjs` for the layout), its first prompt the `Agent` call's prompt word for
   word (`correlateSubagents` pairs a file to its call by that text); roster row idle. Assert the card state `waiting`, chip
   `changes`, the note, 3 finding rows, the two Important ticked and the Minor not, `Fix 2 selected`,
   `Skip the review`, and `[data-chat-vcard-open]` present.
1b. Click `[data-chat-vcard-open]`: the subagent's interior opens (assert what the Agent surface shows for it). Back
   in Chat, click the first `[data-chat-vcard-loc]`: the file opens (assert the file view or pill target the click
   leads to, as Chat's file pill does).
2. Tick the Minor, then untick both Important: `Fix 1 selected`; click Fix: the record (topic `arc:verdict`, kind
   `verdict`, outcome `fix`, fixed 1) is in localStorage; append the line as the user message; assert the card is
   gone, `[data-chat-bscard-done="verdict"]` reads `Code review · Changes requested · 3 findings — Fix 1`, and the
   line draws no bubble.
2b. Skip: a second waiting verdict (a new reply with another `arc-review` block); click `[data-chat-vcard-skip]`: the
   record has outcome `skip`; append the line; the ✓ row ends `— Skipped` and the line draws no bubble.
3. A `ReportFindings` verdict the agent wrote on after (a later reply): folded at once, no ticks.
3b. Static: the roster row's agent exited (as the brainstorm-review scenario marks one) with a waiting verdict last:
   the card is `data-chat-bscard-state="static"`, has no `[data-chat-vcard-tick]`, no `[data-chat-vcard-fix]` or
   `[data-chat-vcard-skip]`, and keeps `[data-chat-vcard-open]`.
4. Handoff card waiting: write a fixture plan file (5 tasks, two parallel) at the path the question names; roster row
   asking with a `Handoff` `AskUserQuestion` whose question names it, options in the agent's order with
   `Arc engine (Recommended)` first. Assert the card in `[data-chat-ask]`, `[data-chat-hcard-plan-open]`, title, facts
   line (`5 tasks`, `at once`, and `runs active` with the counts `RunQueueListCommand` returns, unless its max is 0),
   rows A–D in fixed order, `Recommended` on A. Click `[data-chat-hcard-plan-open]`: the plan file opens.
5. Click row A: the mock records the ask answer with the agent's option index for `Arc engine`.
6. Handoff folded: the transcript holds the answered `AskUserQuestion` (picked `Arc engine`) and a Bash
   `wsh runs start --plan …` call whose result is `started run <id> (…)` for a fixture run whose `origintranscript` is
   the fixture transcript; roster row idle. Assert `✓ Handoff · Arc engine` followed by the run card
   (`data-chat-run-card="<id>"`, a stage, Open run).
7. A run started outside a brainstorm or handoff (a plain Bash `wsh runs start` call, no ask before it) draws its run
   card; then the run is landed and an `[arc] Run <id8> landed: merged into main.` user message is appended: the
   card folds into `[data-chat-bscard-done="run"]` reading `Run <id8> landed · merged into main`, the message draws
   no bubble, and clicking `[data-chat-run-ended]` opens `[data-chat-run-ended-text]` with the message.
7b. A held run: another run card whose run is held (not landed), then an `[arc] Run <id8> held: <reason>.` message:
   the card folds into `Run <id8> held: <reason>` and the message draws no bubble.
7c. A held brainstorm run: the fixture conversation's brainstorm state names a fixture run (`brainstorm.run`, as
   `chat-brainstorm-review` sets `file.run`) whose run is held, then an `[arc] Run <id8> held: <reason>.` message
   is appended: the brainstorm's live run card is gone, its `brainstorm: run` line draws
   `[data-chat-bscard-done="run"]` reading `Run <id8> held: <reason>`, and the message draws no bubble.
8. A queued run: a Bash call whose result is `queued <entryId> (#1 in line) — …` and a real queue entry for it,
   added with the `runqueueadd` RPC with `after` set to a fixture run that never lands, so it stays queued (as the
   queued scenarios in `scenarios.mjs` around line 59696 do); `runqueueremove` it in teardown. The card shows
   `[data-chat-run-queued]` `Queued · after <that run's title>`.

Acceptance: `node --check scripts/cdp/scenarios-chat-verdict-handoff.mjs` passes. The scenario itself runs in the
Final, once every task has landed.

### Task 2: Chat model parts for the three moments
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/chatitemeq.ts`, `frontend/app/view/agents/chatitemeq.test.ts`, `frontend/app/view/agents/chatconversation.tsx`

Decisions 1–2. `AgentPart` gains:

```ts
| { kind: "verdict"; key: string; verdict: Verdict; reviewer?: ReviewerCall }
| { kind: "handoff"; key: string; question: AskQuestionDetail }
| { kind: "runstart"; key: string; anchor: RunAnchor }
```

`chatItems` makes them as decision 1 says, the reviewer calls it pairs carrying the action's `toolUseId` (Task 3 opens
the review by it, decision 7); a work stretch emptied by the cut leaves no empty work part; files parts
stay after their work. `chatitemeq.ts` compares the new parts (by key and content) so a kept element redraws only
when they change. In `chatconversation.tsx`, `drawPart` returns `null` for the three new kinds (Task 6 draws them);
nothing else there changes.

Tests (`npx vitest run frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatitemeq.test.ts`): a
reply with an `arc-review` block between two paragraphs (three parts), a broken block (one prose part), a
`ReportFindings` call mid-stretch (work, verdict, work), the reviewer paired by `subagent` and by nearest call, a
`Handoff` ask answered and unanswered, a plain `AskUserQuestion` left in the work, a `wsh runs start` call
(work, runstart) and one with no id in its output (no part), keys stable as entries append.

### Task 3: The verdict card
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatverdictcard.tsx`, `frontend/app/view/agents/chatverdictsend.ts`, `frontend/app/view/agents/chatverdictsend.test.ts`, `frontend/app/view/agents/brainstormsend.ts`, `frontend/app/view/agents/chatbrainstormparts.tsx`, `frontend/app/view/agents/session-models/sessionviewmodel.ts`, `frontend/app/view/agents/subagentcorrelate.ts`, `frontend/app/view/agents/subagentcorrelate.test.ts`

Board `B-pick-and-send.dc.html`. First the link from a reviewer call to its subagent (decision 7): `SubagentVM`
(`session-models/sessionviewmodel.ts`) gains `toolUseId?: string`, which `correlateSubagents` sets from the matched
spawn's `toolUseId` (an unmatched file has none); a test in `subagentcorrelate.test.ts` covers both. Second,
`TickBox` in `chatbrainstormparts.tsx` hardcodes `data-chat-bscard-tick` and `Combine <letter>`: give it optional
`attrs` (replacing that attribute when given) and `label` props, the brainstorm card's output unchanged, and the
verdict card passes `{ "data-chat-vcard-tick": "" }` and `Select finding <n>`. Export `PromptIO` and `tauriPromptIO` from `brainstormsend.ts` (they are module
private today) and reuse them; nothing else there changes. `chatverdictsend.ts`: `sendVerdict(agent, key, outcome, line, io = tauriPromptIO,
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
review` (header action) finds the subagent in `subagentsByIdAtom[agent.id]` whose `toolUseId` equals
`reviewer.toolUseId` (calling `refreshSubagents(agent.id, agent.transcriptPath)` on mount, as Chat's local card does
in `chatlocalcards.tsx`) and opens its interior by setting `focusSubagentAtom` with `parentId`, `agentId`,
`transcriptPath` and `label`, as `chatlocalcards.tsx` and `agentdetailsrail.tsx` (the subagent rows) do; left out when
`reviewer` is null, has no `toolUseId`, or no subagent with a `transcriptPath` matches.

Tests (`npx vitest run frontend/app/view/agents/chatverdictsend.test.ts frontend/app/view/agents/subagentcorrelate.test.ts`): the `toolUseId` carried and left out as above; a sent fix keeps its record with the right
`seen`; a sleeping agent is woken with the line; a failed prompt throws and records nothing. The card is shown by the
`chat-verdict-handoff` scenario steps 1, 1b (Open the review, the file:line link), 2, 2b (Skip), 3 and 3b (static).

### Task 4: The handoff card
**Depends on:** none
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

Acceptance: shown by the `chat-verdict-handoff` scenario steps 4 (card, facts with runs, Open the plan click) to 6.

### Task 5: Run cards for every run of the conversation
**Depends on:** none
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
stage `queued`, then the run's own stage once started), and once the run is done or an `ended` message is given
(decision 11; a held run folds only by its message), in place, `DoneRow kind="run"` with `runEndedLine` and the
message as `detail` when `ended` is given, else `runDoneLine`. `live` false makes the card
static. Make sure the run queue is loaded (the store's existing mount hook). `chatbrainstormrun.tsx` keeps its
exports and attributes and uses the shared box. The brainstorm's run folds by its message too (decision 10), since a
held run is never done: `ChatBrainstormRunRow` takes an optional `ended` and returns nothing when it is given, as it
does for a done run, and `ChatBrainstormRunDone` takes an optional `ended` and, when given, draws the ✓ row with
`runEndedLine` and the message as `detail` whether or not the run is done.

Acceptance: `task check:ts`; the brainstorm run card steps of `chat-brainstorm-review` unchanged; shown by
`chat-verdict-handoff` steps 6, 7 (ended row's caret), 7b (held), 7c (held brainstorm run) and 8.

### Task 6: Draw the cards in the conversation
**Depends on:** Task 2 (shares chatconversation.tsx), Task 3 (draws ChatVerdictCard), Task 4 (draws ChatHandoffCard and ChatHandoffDone), Task 5 (draws ChatRunCard and uses useConversationRuns)
**Model:** sonnet
**Chunk:** Chat: the reviewer's verdict as a card (plan review, code review)
**Files:** `frontend/app/view/agents/chatconversation.tsx`, `CHANGELOG.md`

In `ChatConversation`: read the agent's records (`brainstormAnswersAtom(agent.id)`, none without an agent) and pair
the `VERDICT_TOPIC` ones with `pairAnswers` beside the brainstorm pairing, so verdict lines draw nothing; find each
verdict's record by `verdictKey` and its mode with `verdictMode` (last = the last part of the last drawn item; live =
an agent that has not exited; working = `toolsLive`; nextIsYou from the next item). Draw `verdict` parts with
`ChatVerdictCard`; `handoff` parts with `ChatHandoffDone` when answered, nothing when unanswered and the agent is live,
a static `ChatHandoffCard` otherwise; `runstart` parts with `ChatRunCard` per `placeRunCards` (runs from
`useConversationRuns` over the agent's transcript path; the brainstorm's run from the brainstorm prop), and the trailing runs at the end before the brainstorm card. Hide each
user or sent item `pairRunEnded` pairs with a run card of this conversation (no wrapper, as `drawnVisible` leaves a
hidden line), and hand its `RunEnded` to that run's card. For the brainstorm's run, hand it to both
`ChatBrainstormRunRow` and `ChatBrainstormRunDone`, and count the run as done where the conversation reads
`useDoneRuns` (its id joins the done set when it has an ended message), so its `brainstorm: run` line draws the ✓ row
instead of nothing (decision 10).
Extend the kept-element compare (`answerKey` / `DrawnItem`) so a mode or record change redraws. An exited agent
draws every card static (decision 13).

`CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top has a date), written for the
user: Chat draws a reviewer's verdict as a card you tick and send, the plan handoff as four choices, and a card for
every run the agent starts, each folding to a ✓ row.

Acceptance: `task check:ts`; `npx vitest run frontend/app/view/agents/chatverdict.test.ts frontend/app/view/agents/chatruncards.test.ts`;
shown by `chat-verdict-handoff` steps 1–3b and 6–8 (7b for the held fold, 7c for the held brainstorm run).

### Task 7: The live handoff card in Chat's dock
**Depends on:** Task 4 (draws ChatHandoffCard)
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
