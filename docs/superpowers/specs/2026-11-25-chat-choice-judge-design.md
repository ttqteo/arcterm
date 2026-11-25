# Judge for choice questions in Chat

Date: 2026-11-25. Brainstorm: `.superpowers/brainstorm/chat-choice-judge/brainstorm.json`.
Design board: `.superpowers/design/chat-choice-judge/project/C-under-reply.dc.html` (the only board the build matches;
`A-on-chip` and `B-strip` are rejected options).

## Intent

When an agent's reply ends in a choice question written as prose ("A hay B?"), not an AskUserQuestion card, Chat shows
a judge's suggestion of which answer is reasonable, and why. Today the suggested-reply chips (Chat's chatsuggest) put the
answer the agent recommends first, so the person only ever sees the agent's own lean.

## What runs today

- Chips: `frontend/app/view/agents/chatsuggest.ts` (rules, merge, `endsWithQuestion`, `yesNoQuestion`, `chatChips`,
  `fitChips`, `quickChip`), `chatsuggeststore.ts` (one `ChatSuggestCommand` per turn, kept by `suggestKey`),
  `chatcomposer.tsx` (`SuggestChips`, `Chip`).
- Model half: `pkg/chatsuggest/chatsuggest.go` (haiku, `--effort low`, the last 1500 runes of the reply, up to 5
  answers, `systemPrompt` says "First the answer the agent recommends"). A Claude agent's arc mod makes the same call at
  the end of its turn (`pkg/chatsuggest/hook.go`, `claude/arc-mod/hooks/register.ts` `suggestReplies`).
- The brainstorm judge (`pkg/brainstormcheck/judge.go`, `judge-prompt.md`, `BrainstormJudgeCommand` in
  `pkg/wshrpc/wshserver/wshserver_brainstorm.go`) is a fresh session that never sees the agent's favourite and gets the
  approaches shuffled. This feature reuses that idea, not that code path (it is tied to brainstorm.json).

## Decisions

### Two judges (answer 1)

- **Light mark, automatic.** The haiku call that already makes the chips also names the reasonable answer and gives a
  one-sentence reason. It costs no extra call and arrives with the chips.
- **Deep judge, on demand.** A "Judge kỹ" / "Judge it" action starts a fresh session that reads the project and judges
  the options. It costs a call per press (30-90 s).

### The deep judge reads blind (answer 2)

The deep judge gets only: the question sentence, the options (the chips' texts, shuffled), each with a neutral one-line
description, the person's recent messages, and the project to read. It never gets the agent's reply text or which
option the agent recommended. The light mark reads the reply as today: it has nothing else to read.

**Option descriptions (builder question 1).** Chips are short replies in the person's voice ("hướng 1 đi"), so the
meaning of an option lives in the reply. The existing haiku call (headless and mod paths) also writes, per answer chip,
one neutral line saying what that option does, with no praise or blame and no word on which one the agent prefers.
`Parse` reads these as a third kind of line beside the replies and the pick line; the mod path's token budget
(`SUGGEST_MAX_TOKENS` in `claude/arc-mod/hooks/register.ts`) grows to fit. The descriptions are stored with the turn
(below) and are what the deep judge reads in place of the reply.

### What the deep judge returns (answer 3)

One pick with one or two sentences of reasons grounded in facts from the code (file:line). When it finds a better way
the agent did not name, it adds it as a new option (short label, one-sentence description, its facts), and that new
option may be the pick. At most one added option.

### Model (answer 4)

The deep judge is a fresh **sonnet** session with read-only tools (no write, no shell that changes files), working
directory the agent's project.

### Where it shows (answer 5, reworked by two pushbacks; board C)

- One faint line at the end of the agent's last message (the message holding the question), in the conversation, not in
  the composer. It names the pick only: "Gợi ý **A, sửa parseFrame**" for the light mark, "Judge chọn **C, …** (agent
  không nêu)" for a deep pick the agent did not name, with "sonnet · 14 file · 41 s" at its end once the deep judge is
  done. "Judge kỹ" sits at the line's end while no deep judge has run.
- **The reason shows on hover** over the picked option's name, as the app's tooltip (solid `surface-raised` chip,
  `element/titletiphost.tsx` behaviour). Keyboard: Tab to the judged chip shows the reason in the empty box's hint line
  (`pickedHint`).
- While the deep judge reads: the line says "Judge đang đọc code, không thấy agent khuyên gì · 34 s" with a Dừng / Stop
  action. Elapsed time ticks in `tabular-nums`.
- The line stays in the transcript after the person answers, so the history shows what the judge said.
- The composer gets no judge line.

### Which questions (answer 7)

Only a reply that ends in a question (`endsWithQuestion`) that is **not** yes-or-no (`yesNoQuestion` false) and has at
least two model chips. Yes-or-no questions and turns that do not end in a question get nothing.

### The chips (answer 9)

- The judged chip, light or deep, carries the scale icon (lucide `Scale`, 13 px, like the other chip icons via
  `chipIcon`) and is **first** in the row, so Cmd/Ctrl+Enter (`quickChip`) sends it.
- When the deep judge finishes, its pick takes the first place from the light mark's; the light mark's icon goes away.
  An added option becomes a new chip, first when it is the pick.
- The row's one-line fit (`fitChips`) is unchanged; the first chip is always kept.

### What an added chip sends (answer 6)

A chip the deep judge added sends its label plus the judge's description and facts, so the agent understands an option
it never named (e.g. "C, gom byte ở readLoop: readLoop đã gom đủ byte cho mọi khung khác (conn.go:212), sửa ở đó thay
vì ở ba nơi gọi parseFrame"). Every other chip, the judged one included, sends exactly its text, as today.

## Left to the builder (confirmed)

- Light mark: extend the existing haiku prompt (`pkg/chatsuggest/chatsuggest.go`, and the mod path in `hook.go`) to
  output one pick line with a one-sentence reason, parsed apart from the reply lines. Drop the "first the answer the
  agent recommends" rule; the model picks for itself.
- Deep judge: a headless sonnet call through `pkg/consult`, read-only tools, cwd = the agent's project; its prompt is
  built in the spirit of `pkg/brainstormcheck/judge-prompt.md` (options shuffled, no agent recommendation). Result: the
  pick, the reason, and at most one added option (label, description, facts).
- **One durable record per choice-question turn (builder question 2).** For a turn that qualifies (Which questions,
  above), wavesrv stores one record keyed by the turn (`suggestKey`): the chips, their neutral descriptions, the light
  pick and its reason, and the deep judge's result once there is one. Chat reads that record before it asks again, so
  the line under the message survives a pane unmount, a surface switch and an app restart, and a pick always matches
  the chip it judged. Turns that do not qualify keep today's in-memory chip path. The storage form (a waveobj with its
  SQL migration in `db/migrations-wstore/`, or a file under the data dir) is the builder's call.
- The deep judge replaces the light mark when it finishes. On error or timeout the line says what happened and offers
  Retry; the light mark stays. If the person answers before the deep judge finishes, stop it (as
  `BrainstormJudgeStopCommand` does).
- The deep judge is a press by the person, so it does not wait on a Token burn card; record its usage under a role of
  its own so its cost can be counted.
- A keyboard shortcut for "Judge kỹ", and the exact wording an added chip sends: builder's choice; document the shortcut
  in `docs/keyboard-shortcuts.md` and bind it in `frontend/app/store/keybindings/bindings.ts`.
- Copy follows the person's language as the chips do (`writesVietnamese`): Vietnamese strings above, English
  equivalents ("Suggested", "Judge picks", "Judge it", "the agent did not name it", "Stop", "Retry").

## Motion

- The light mark's line appears with the chips: opacity on the Fluid ease at `durMicro`.
- Reading → done: the line's text cross-fades (`durMicro`); a line that grows to hold a longer label rides `springReveal`.
- The judged chip moving to first place: the row's existing `AnimatePresence` / layout behaviour; no new motion.
- Reduced motion: all of the above mount at their end state.

## Testing

- Pure logic in `.ts` with `.test.ts` beside it: which replies qualify, chip order with a light or deep pick, the added
  chip's sent text, the judge line's state model (none / light / reading / done / failed).
- Go: prompt building and parsing for the pick line and the deep judge's result; the store keyed by turn.
- UI: a CDP scenario that fakes both judges (as `__chatSuggestFake` does) and shows the line under the message in each
  state (light, reading, done with an added chip, failed), the hover tooltip, and the judged chip first.

## Decisions made while planning (2026-11-25, autonomous run)

Each was the builder's call above, made here so every task builds on the same shapes.

### Light mark: the haiku answer's format

For a question that offers options the model writes, after each reply, one line `= <neutral description>`, and last
one line `PICK <n>: <one-sentence reason>`, `n` the 1-based number of the reply it picks. `Parse` becomes
`ParseAnswer(text, question) Answer` with `Answer{Replies, Descs, Pick, Reason}`: `Descs` parallel to `Replies` (""
where the model wrote none), `Pick` the picked reply's **text** ("" when there is none, or `n` names a reply Parse
dropped), so a pick always names a chip. `=` lines are read before the reply rules, so they never become chips. The
system prompt drops "First the answer the agent recommends" and asks the model to pick for itself, with no word on
which one the agent prefers in a description. `Suggester.Suggest` and `Hooks.Await`/`AwaitWhy` carry an `Answer`.
Why: one call, the mod path keeps parsing in wavesrv (it only forwards text), and a text pick cannot point at a moved
chip. The mod's budget is `SUGGEST_MAX_TOKENS` in `claude/arc-mod/hooks/suggest-core.ts` (the spec named
register.ts, which imports it); it grows from 2048 to 3072.

### The durable record: a JSON file, owned by `pkg/chatjudge`

`<data dir>/chatjudge.json`, one `wshrpc.ChatJudgeRecord` per qualifying turn keyed by Chat's `suggestKey`
(`<agentId>:<len>:<hash>`), at most 500 records, oldest dropped, written whole through a temp file and rename. Why
not a waveobj: nothing else reads it, it needs no event fan-out, and a file needs no migration (YAGNI). wavesrv treats
the key as opaque, except that its part before the first `:` is the agent id, which the list command filters on.

- `ChatSuggestCommand` gains `key` and `choice` (`endsWithQuestion && !yesNoQuestion`, worked out in
  `chatsuggeststore.ts`, the one place that knows `yesNoQuestion`). With a key whose record exists, wavesrv answers
  from the record and runs no model. Otherwise it answers as today and, when `choice` holds and there are at least two
  replies, stores a record. The return gains `judge` (the record) beside `replies`.
- The record holds: key, block id, timestamp, the question sentence (the last sentence of the reply's last prose line, when it ends in `?`: never the sentences before it, which may hold the agent's lean, "Mình nghiêng A. A hay B?" stores "A hay B?"), the
  person's recent messages (as sent), the options (each chip's text and description, in the model's order), the light
  pick and reason, and `deep` once a deep judge ran.
- `ChatJudgeListCommand{agentid}` answers an agent's records, so the line under an old message survives a restart and
  shows in history after the person answered.

### The deep judge: one command, joinable

- `ChatJudgeCommand{key, cwd, retry}` blocks until the judge ends and answers the record. A second call for a key
  whose judge is reading joins it (a remounted pane, a second window); a call for a key whose deep result is done
  answers the record; `retry` restarts a failed or stopped one. `ChatJudgeStopCommand{key}` cancels it; the record's
  deep state becomes `stopped` and the line goes back to the light mark. Why: the same join-the-call-in-flight shape
  `Suggester` already has, and no event plumbing.
- Deep states: `reading` (with its start time), `done`, `failed` (with the error), `stopped`. When wavesrv loads the
  file, a record left `reading` becomes `failed` "Arc restarted while the judge read", so Retry is offered.
- The run: `consult.RunClaude` with `Model: "sonnet"`, `Tools: Read, Grep, Glob` (no Bash, no Edit, no Write), cwd =
  the agent's cwd as Chat knows it (`chatpane.tsx` `cwd`; with no cwd known there is no Judge action), plus
  `--setting-sources ""`, `--no-session-persistence` and `--disable-slash-commands` as the chips' call has (no hooks,
  no plugins, and no session that would appear in the project's conversation history). `consult.CallOpts` gains
  `ExtraArgs []string`, appended by `ClaudeArgs`, so `RunClaude` keeps giving the token total and the tool events.
  Timeout 180 s.
- The prompt (`pkg/chatjudge/judge-prompt.md`, embedded): the question sentence, the options labelled A, B, C… in a
  fresh random order each with its description, labelled with opaque ids `o1`, `o2`, … (never letters: the options' own texts often start "A, …", and the prompt says the ids are the judge's labels only), the person's recent messages, and the rules: verify in the code,
  never read `.superpowers/`, change nothing, first ask whether an approach beats every listed one. It ends with one
  JSON object as the final message: `{"pick":"o2","reason":"…","added":null}` or
  `{"pick":"NEW","reason":"…","added":{"label":"…","desc":"…","facts":["conn.go:212 …"]}}`. The id maps back to the
  chip's text; `NEW` is the added option. A reply with no valid object, an id that names no option, or `NEW` with
  no `added` fails the judge with that error.
- Usage: the record's `deep` keeps `model`, `tokens` (the result event's total), `files` (distinct base names of the files read, from
  the tool events' `Read <base name>` descriptions: two files with one name count once, which the line can bear) and the elapsed seconds, and waveapp.log gets one line per judge,
  `chatjudge: key=… role=chat-judge state=… model=sonnet tokens=… files=… took=…`. Why: the run keeps no transcript
  for usagestats to read, and the role names the cost apart from the chips' haiku.
- At most one judge per key; no global cap (measured need first).
- A stopped or failed judge runs again on the next press: Chat passes `retry` whenever the record's deep state is
  `stopped` or `failed`, so Stop then Judge kỹ is never a silent no-op.

### Chat

- Pure logic in `frontend/app/view/agents/chatjudge.ts`: whether a turn qualifies, the row's order with a light or
  deep pick (`judgedChips`), the added chip (`kind: "reply"`, `source: "judge"`, `send` = `<label>: <desc> (<facts
  joined by "; ">)`, the parenthesis left out with no facts), the line's state model (none / light / reading / done /
  failed) with its copy in the person's language.
- The record lives in one jotai atom (`chatJudgeAtom` in `chatsuggeststore.ts`), filled by the chips' answer, the
  list and the judge; `ModelSuggest` does not carry it (one source of truth).
- A turn with a record but no light pick (haiku wrote no `PICK`) still offers Judge kỹ on the live turn: the line is
  the action alone. An old turn with neither pick nor deep result draws nothing.
- The line as board C draws it: a hairline top rule, the scale icon before it (a spinner while reading), the name in
  high ink with a dotted underline as the hover target, and in the light state a dim "· rê vào để xem lý do" / "· hover
  for why". The tooltip holds the reason and its source: "haiku, chỉ đọc reply" / "haiku, read the reply only", or
  the deep judge's "sonnet · 14 file · 41 s". Judge kỹ is an accent text button; Dừng and Thử lại are muted underlined.
- `ChatChip` gains `judged?: boolean` (draws the scale icon: `chipIcon` answers `"judge"`) and `send?: string` (what a
  click sends when it differs from the label; only the added chip has one). `pickedHint` on a judged chip says the
  reason after what Enter sends.
- The line under the message is `chatjudgeline.tsx`, drawn by `chatconversation.tsx` under each assistant message whose
  `suggestKey(agent.id, text)` has a record. "Judge kỹ", Stop and Retry show only on the live turn (the pane's
  current turn, its chips showing); an old turn's line shows what was judged, with no action. Why: judging a question
  already answered helps nobody.
- The person sending anything (chip or typed) while the live turn's deep judge reads stops it.
- Keyboard: `Alt+J` (`agent:chat-judge`, an Agent-surface binding) runs "Judge kỹ" on the focused agent's live turn,
  or Retry after a failure; inactive otherwise. It reads a shared atom (`liveJudgeAtom`, per agent: the live key, the
  cwd and the action) that the pane writes, since bindings cannot see the pane's state.
- The line is drawn beside a conversation row, after it (as the run and council cards placed after an item are), never
  inside the item's cached element, so a record arriving or the live key changing redraws only the line.
- DEV fakes for the scenario: `__chatSuggestFake` may answer `string[]` (as today) or a whole
  `CommandChatSuggestRtnData`; a new `__chatJudgeFake(cmd: "judge" | "stop" | "list", data)` answers the judge
  commands.
- CHANGELOG: one `Added` line, `<!-- big --> <!-- shot: none -->` until the Final run's `chat-judge` scenario writes
  the picture (a `docs/hand-checks.md` line says to swap it in), as the boards feature did.
