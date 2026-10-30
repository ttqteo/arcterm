# Council Setup: Auto-generate from the seated agents' conversations

Brainstorm: `.superpowers/brainstorm/council-discuss-suggest/brainstorm.json`.

## Why

**Discuss together** (Agent sidebar: select agents, right-click → Discuss together) opens council Setup with those
agents in Seats and an empty composer. The person then has to type, by hand, a topic and a question that their agents
were already talking about. The coordinator's suggestion does not help here: it reads neither agent's conversation.

This adds one **Auto-generate** button to Setup that writes the topic, a suggested question and the mode from what the
seated agents were doing.

## What runs today

- Discuss together (`agenttree.tsx:3190`) calls `showCouncilSetupWithAgents` (`agentcenter.ts:126`). That builds the
  draft with `draftWithAgents` (`councilmodel.ts:792`), which fills only the agent seats. The topic and files stay
  empty.
- `suggestRequest` (`councilsetupmodel.ts:435`) asks the coordinator in only two cases. One is a topic plus at least
  one attached file. The other is a draft from Ask the council that carries a question.
- `Runner.Suggest` / `suggestPrompt` (`pkg/council/runner.go:2147`, `2260`) is one sonnet call with Read/Grep/Glob in
  the project. It returns files, up to two roles, a group and a mode. It is never given a transcript.
  `CommandCouncilSuggestData` (`pkg/wshrpc/wshrpctypes_council.go:108`) carries the project, feature, question and
  files.
- Code that already reads transcripts:
  - `agentsessions.HumanPrompts(path, runtime)` (`pkg/agentsessions/humanprompts.go:56`) returns the prompts a person
    really typed into a claude, pi or agy session. It drops tool output, skill bodies, slash commands, the compaction
    summary and messages from other agents (`wsh agents send`).
  - `jarvis.TranscriptPathForTab` (`pkg/jarvis/evidence.go:841`) finds a tab's transcript for **Claude only**, using
    the block's cwd.
  - `ExtractSession` (`pkg/agentsessions/agentsessions.go`) picks a parser for each runtime. `extractPiSession` reads
    pi files.
  - A compaction leaves an `isCompactSummary` record and a `compact_boundary` (`pkg/agentsleep/compact.go:80`).
- The harnesses that can be seated are claude and pi (`SEATABLE_HARNESSES`, `councilsetupmodel.ts:235`).

## Design

### What it fills

Auto-generate fills three things:

- the topic line;
- one suggested question;
- the mode, Review or Brainstorm.

They come from the seated agents' conversations. The person can edit all of them before Start.

The topic and question are written in the language of the conversations. If the agents were spoken to in Vietnamese,
they are written in Vietnamese (builder question: the person's answer). The haiku prompt asks for this, and the tests
do not assume English.

The mode follows Setup's existing mode rules (Agent's call, builder question 1):

- **A mode the person already flipped is kept.** If `modePicked` is set, Auto-generate leaves the mode unchanged and
  fills only the topic and question. A mode an earlier Auto-generate picked is not the person's pick: the next result
  replaces it, and the group follows again.
- **Otherwise, the generated mode counts as picked.** A Suggest that fires later (a draft with a file attached) does
  not replace it (`councilsetupmodel.ts:480`).
- **The group follows the mode as a flip does.** When Auto-generate picks Brainstorm, the group switches to Product
  ideas unless the person picked a group (`flipMode`, `councilsetupmodel.ts:136`).
- **The mode chip says "picked from the conversation"** (`modeChip`).

"Does not chain into Suggest" means Auto-generate never calls Suggest itself. A Suggest that the existing
`suggestRequest` rule fires afterwards is fine, because it no longer touches the mode.

### When it runs

It never runs when Setup opens. Once at least one agent is seated, Setup shows an **Auto-generate** button, and the
three things above are written only when the person presses it.

### The button

- It sits in the bar under the composer, beside Attach.
- It shows whenever Seats holds at least one agent, whether the agent came in through Discuss together or through Add
  agent.
- While the call runs, the button shows a spinner and is locked.

### When the composer already has text

- If the composer is empty, the result is filled in at once.
- If the composer holds any text, Setup asks **Replace / Keep** before overwriting it. The choice appears inline in the
  same bar, not in a dialog. Keep leaves the draft exactly as it was. Labels are English, like the rest of Setup
  (Agent's call, builder question 3).
- One exception: if the text is still exactly the last Auto-generate result, a second press replaces it without asking.
  The draft remembers that last result. Text handed in by Ask the council or by Run again counts as typed (Agent's
  call, builder question 2).
- If the person types while the call is running, the check runs again when the result arrives. The result is applied
  only once that check passes (Agent's call, builder question 2).

### Where it reads from, and with what

For each seated agent, wavesrv takes the agent's last few human prompts (`HumanPrompts`) and its last reply. It puts
them into one call with no tools, which writes the topic, question and mode. **Nothing is sent into any agent's
session.**

### Keeping the cost as low as possible

- The call runs on **haiku**, with no tools, and reads no code.
- Each agent contributes its **last 3 human prompts** and its **last reply**, each clipped short. The input is a few
  thousand tokens, so one press costs about a few thousand tokens.
- Pressing Auto-generate does **not** chain into Suggest. The dashed rows (files, experts) still need an attached file,
  as they do today.

### Errors

- If the call fails, or no seated agent has a prompt that can be read (the transcript is missing, or the harness is not
  supported), the composer is left unchanged. A one-line reason appears under the composer, and the person can press
  again.
- A seated agent whose transcript cannot be read is skipped, and the others are still used.

## Decided for the build

### The RPC

- `CouncilAutoGenerateCommand(ctx, CommandCouncilAutoGenerateData) (*council.CouncilAutoGenerate, error)` in
  `pkg/wshrpc/wshrpctypes_council.go`, then `task generate`. Never hand-edit the generated files.
- `CommandCouncilAutoGenerateData{Project string; Agents []string}`: the project folder (the call's cwd) and the seated
  agents' tab ids, in seat order (the same `Agent` field a seat carries).
- `council.CouncilAutoGenerate{Topic, Question, Mode string}` (json `topic`, `question`, `mode`), in
  `pkg/council/types.go`. `Mode` is always `review` or `brainstorm`.

### Reading the conversations (wavesrv)

- Each tab is resolved the way the council's live-agent link already does it (`liveAgentLink.find`,
  `wshserver_councilagents.go:38`): the agent roster, then `agentTranscriptPath` (`wshserver_agentmsg.go:395`), which
  already finds **both claude and pi** transcripts (the status's path, the block meta, then
  `agentsessions.TranscriptForSession`). No new pi lookup is needed; `TranscriptPathForTab` is not used.
- From that transcript: `agentsessions.HumanPrompts(path, harness)`, keeping the last 3 with text, and
  `agentsessions.LastAnswer(path, harness)`.
- A tab that is not a live agent, runs a harness other than claude or pi, has no transcript, or has no prompt is skipped.
  When every seat is skipped, the command fails with `none of the seated agents has a conversation to read`, before any
  model call.

### Clipping

- Each prompt keeps its first **600** characters (runes, not bytes); the last reply keeps its last **1,500**, where an
  answer usually lands on what it concluded or asks. A clipped piece is marked with `…`.
- At most 3 × 600 + 1,500 = 3,300 characters per agent: about 1k tokens each, so a four-agent Setup sends about 4k.

### The call

- `Runner.AutoGenerate(ctx, project string, convs []AgentConversation)` in a new `pkg/council/autogen.go`, beside
  `Suggest`: one call on `haiku`, `Tools: false` (ConsultCaller then passes `--tools ""` and takes no job slot). An
  `AgentConversation` is `{Name, Harness string; Prompts []string; Reply string}`, already clipped by wavesrv.
- The prompt lists each agent by name with its prompts (oldest first) and its last reply, and asks for one JSON block:
  a topic line (a short noun phrase naming what they were working on), one question for the council, and the mode by
  the same rule `suggestPrompt` uses (a problem or goal with no answer yet → brainstorm; a thing that exists to judge →
  review). It says to write the topic and question in the language the person wrote their prompts in.
- The reply goes through `decodeReply` (`parse.go:164`). It is an error when there is no JSON block, the topic is empty
  after trimming, or the mode is neither word (no fallback mode: a reply that names none is malformed). A missing
  question is an error too: the button promises one. Whitespace in the topic is folded to single spaces, since it
  becomes the composer's first line.

### The draft and the pure model

`CouncilSetupDraft` (`councilmodel.ts`) gains:

- `autoState?: "asking" | "confirm" | "failed"` (absent = idle),
- `autoError?: string`, the one-line reason while `failed`,
- `autoPending?: CouncilAutoGenerate`, a result waiting on Replace / Keep,
- `autoLast?: string`, the composer text the last applied result produced (`joinAsk` of it), for the second-press
  exception,
- `modeFrom?: "conversation"`, set when Auto-generate picked the mode; `flipMode` clears it.

`councilsetupmodel.ts` adds, with tests in `councilsetupmodel.test.ts`:

- `autoGenerateShown(draft)`: at least one seated agent.
- `autoGenerateRequest(draft)`: the request, or null while `asking`, with no agent or no project.
- `beginAutoGenerate(draft)`: `asking`, clearing a previous error or pending result.
- `settleAutoGenerate(draft, result, lib)`: run when the answer lands, and only on a draft that is `asking`. It decides
  then, not at the press, so text typed during the call is seen: an empty composer (`joinAsk` is blank) or one still
  exactly `autoLast` is replaced at once; anything else goes to `confirm` with the result in `autoPending`.
- `replaceAutoGenerate(draft, lib)` (Replace) applies `autoPending`; `keepAutoGenerate(draft)` (Keep) drops it and
  leaves every other field as it was.
- `failAutoGenerate(draft, reason)`: `failed` with the reason; the composer is untouched.
- Applying a result: the topic becomes `feature`, the question `question`, `autoLast` records the new composer text.
  If the person picked the mode (`modePicked` set and `modeFrom` not `"conversation"`), the mode and group stay.
  Otherwise (never picked, or picked by an earlier Auto-generate) the mode is the result's, `modePicked` becomes true,
  `modeFrom` becomes `"conversation"`, and the group follows as `flipMode` does: Product ideas for Brainstorm, the
  suggestion's group or the UI group for Review, unless `groupPicked`.
- `modeChip` reads `<Mode> · picked from the conversation` while `modeFrom` is set. `modeReason` stays empty for it.

### The view

- `councilsetup.tsx` stays thin: an `Auto-generate` button (a `Sparkles` icon, the same ghost style as Attach) right after
  Attach in `data-council-composer-bar`, with `data-council-autogen`. While asking it shows a spinner and is disabled.
- While `confirm`, the bar shows, after the button, `Replace the text?` with two small buttons, `Replace` and `Keep`
  (`data-council-autogen-replace`, `data-council-autogen-keep`).
- While `failed`, one muted line under the composer carries the reason (`data-council-autogen-error`): the error's first
  line, truncated to fit; the next press clears it.
- The RPC wrapper lives in `councilstore.ts` beside `suggestCouncil`. A late answer to a press that Setup has moved past
  (Cancel, Start, a newer press) is dropped, with the same pattern as `askCoordinator` but **its own per-project
  counter**, bumped only by a press, Cancel and Start. Sharing Suggest's counter would let a Suggest that fires during
  the call (a file attached) drop the answer and leave the button spinning for good. After a Replace,
  the composer's `typed` state is reset so it shows the new draft text.
- Theme tokens only, per `DESIGN.md`.

### Checking it

- Go: `pkg/council` tests for the prompt (every agent's prompts and reply appear, the language rule, no tools, haiku)
  and the parse (good reply, missing topic, missing question, bad mode, no JSON). `pkg/wshrpc/wshserver` tests for the
  gathering over a fake roster: the last 3 prompts, the clip lengths, a skipped seat, and the all-skipped error with no
  model call.
- Frontend: the model functions above in `councilsetupmodel.test.ts`, including the re-check (text typed during the
  call) and the last-result exception, and that the mode stays and the chip says "you picked it" when `modePicked` was
  already set.
- The `council-setup` CDP scenario gains steps after its live-agents steps, with `CouncilAutoGenerateCommand` stubbed
  (no tokens): the button shows with agents seated, a pending call shows the spinner, a result fills an empty composer
  and the chip reads "picked from the conversation", typed text brings up Replace / Keep and each choice does what it
  says, and a rejected call leaves the composer and shows the error line.
- `CHANGELOG.md` gets one `Added` line.

## Out of scope

- Running anything automatically when Setup opens, or when an agent is seated.
- Using transcripts to choose experts or files. That is still Suggest's job and still needs an attached file.
- Seating harnesses other than claude and pi.
