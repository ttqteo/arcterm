# Judge for choice questions in Chat

**Spec:** `docs/superpowers/specs/2026-11-25-chat-choice-judge-design.md` (read its "Decisions made while planning" section: every task builds on the shapes it fixes)
**Verify:** `node scripts/verify.mjs ./pkg/chatsuggest/... ./pkg/chatjudge/... ./pkg/wshrpc/... ./claude/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-judge agent-chat chat-code-box`
**Prototype:** .superpowers/design/chat-choice-judge/project/C-under-reply.dc.html

Shape of the work: Task 1 lands the wire interface (RPC types, stub handlers, generated bindings). Then three tasks run
side by side: Task 2 (the haiku call's pick and descriptions, `pkg/chatsuggest`), Task 3 (the record store and the deep
judge, new `pkg/chatjudge`) and Task 5 (Chat's pure logic and store). Task 4 wires wavesrv once 2 and 3 land. Task 6
(the chips) and Task 7 (the line under the message, key, docs) build the UI on Task 5.

Rules for every task:

- Principles: simple and direct, KISS, YAGNI, DRY, one source of truth; measure before optimizing; no abstraction for
  a single implementation; handle errors at the boundaries and never swallow one silently (a failed judge says so on
  the line; a failed store write is logged in waveapp.log and returned).
- Never hand-edit generated files (`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`): edit the Go types and run `task generate`.
- Go tests on Windows: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '^TestName$'`.
- Frontend: pure logic in `.ts` with `.test.ts` beside it (`npx vitest run <file>`), no jsdom render tests. Colors from
  `@theme` tokens only, Tailwind over SCSS, `DESIGN.md` for layout and motion. `task check:ts` with a 4-minute
  timeout. Lint and format only the paths you touched; never run prettier on `scripts/*.mjs`.
- Copy follows the person's language (`writesVietnamese`): the spec's Vietnamese strings, and their English twins.
- Commits carry no attribution trailer.

### Task 1: The wire interface: RPC types, stub handlers, generated bindings
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_chatsuggest.go`, `pkg/wshrpc/wshserver/wshserver_chatjudge.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

Add to `pkg/wshrpc/wshrpctypes_chatsuggest.go` (every other task relies on these exact names and json tags):

- `CommandChatSuggestData` gains `Key string \`json:"key,omitempty"\`` (Chat's `suggestKey`) and
  `Choice bool \`json:"choice,omitempty"\`` (ends in a question that is not yes-or-no).
- `CommandChatSuggestRtnData` gains `Judge *ChatJudgeRecord \`json:"judge,omitempty"\``.
- `ChatJudgeOption{Text string "text"; Desc string "desc,omitempty"}`.
- `ChatJudgeAdded{Label string "label"; Desc string "desc"; Facts []string "facts,omitempty"}`.
- `ChatJudgeDeep{State string "state"` (`reading` | `done` | `failed` | `stopped`, as exported consts
  `ChatJudgeState_Reading` etc.)`; StartTs int64 "startts"; EndTs int64 "endts,omitempty"; Pick string "pick,omitempty"`
  (an option's text, or `Added.Label` when the added option is the pick)`; Reason string "reason,omitempty"; Added
  *ChatJudgeAdded "added,omitempty"; Model string "model,omitempty"; Tokens int "tokens,omitempty"; Files int
  "files,omitempty"; Error string "error,omitempty"}`.
- `ChatJudgeRecord{Key "key"; BlockId "blockid,omitempty"; Ts int64 "ts"; Question string "question"; Recent []string
  "recent,omitempty"; Options []ChatJudgeOption "options"; Pick string "pick,omitempty"; Reason string
  "reason,omitempty"; Deep *ChatJudgeDeep "deep,omitempty"}`.
- `CommandChatJudgeData{Key "key"; Cwd "cwd"; Retry bool "retry,omitempty"}`, `CommandChatJudgeStopData{Key "key"}`,
  `CommandChatJudgeListData{AgentId "agentid"}`, `CommandChatJudgeListRtnData{Records []ChatJudgeRecord "records"}`.
- On `ChatSuggestCommands`: `ChatJudgeCommand(ctx, CommandChatJudgeData) (*ChatJudgeRecord, error)`,
  `ChatJudgeStopCommand(ctx, CommandChatJudgeStopData) error`,
  `ChatJudgeListCommand(ctx, CommandChatJudgeListData) (*CommandChatJudgeListRtnData, error)`.

`pkg/wshrpc/wshserver/wshserver_chatjudge.go`: the three methods on `*WshServer`, each returning
`errors.New("chat judge: not wired yet")` (Task 4 replaces them). Run `task generate` and commit what it writes.

Acceptance: `task generate` leaves no further diff; `go build ./pkg/... ./cmd/...` passes; `task check:ts` passes;
`RpcApi.ChatJudgeCommand`, `ChatJudgeStopCommand`, `ChatJudgeListCommand` and the `ChatJudgeRecord` type exist in the
generated TS.

### Task 2: The light mark: haiku names a pick, a reason and each option's description
**Depends on:** none
**Files:** `pkg/chatsuggest/chatsuggest.go`, `pkg/chatsuggest/chatsuggest_test.go`, `pkg/chatsuggest/hook.go`, `pkg/chatsuggest/hook_test.go`, `pkg/wshrpc/wshserver/wshserver_chatsuggest.go`, `claude/arc-mod/hooks/suggest-core.ts`

- `systemPrompt`: drop "First the answer the agent recommends"; the model orders the answers as it sees fit and picks
  for itself. For a question that offers options (not yes-or-no), after each reply it writes one line
  `= <what this option does, one neutral line: no praise or blame, no word on which one the agent prefers>`, and last
  one line `PICK <n>: <one sentence why>`, `n` the 1-based number of the reply. For any other turn the output stays as
  today (no `=` or `PICK` lines). Keep every other rule in the prompt as it is.
- `type Answer struct { Replies []string; Descs []string; Pick string; Reason string }`. `ParseAnswer(text string,
  question bool) Answer` replaces `Parse`: `Replies` follows today's rules unchanged (never nil); a `=` line is the
  description of the reply line right before it and is read before the reply rules (so it never becomes a chip), and is
  dropped with its reply when that reply is dropped (too long, NONE, duplicate, past the limit); `Descs` is parallel to
  `Replies` ("" where none was written; nil when no reply has one); the `PICK` line (case-insensitive, `:`/`-`/`—`
  after the number) sets `Pick` to the text of the reply `n` names in the model's numbering, or "" when that reply was
  dropped or `n` is out of range; `Reason` is its text, "" with no pick. Only a question's answer reads `=` and `PICK`.
  Delete `Parse` and move its callers and tests to `ParseAnswer` (grep: `chatsuggest.go` `do`, `hook.go` `End`, both
  test files).
- `hook.go`: export `QuestionSentence(reply string) string` beside `EndsWithQuestion`, sharing its regexes: the **last
  sentence** of the reply's last prose line when that line ends in `?`/`？` (fenced code left out, the trailing emphasis
  marks stripped as `EndsWithQuestion` strips them; sentences split after `.`, `!`, `?`, `…`, `。` followed by space, as
  `frontend/app/view/agents/chatsuggest.ts` `lastSentenceWords` reads the last sentence), trimmed; "" when the reply
  does not end in a question. Never the sentences before it: they may hold the agent's lean, and the deep judge reads
  this. Task 4 stores it in the record.
- `Suggester.Suggest` returns `(Answer, error)` and caches `Answer`; `Hooks.End` stores an `Answer`;
  `Hooks.Await` returns `(Answer, bool)` and `AwaitWhy` returns `(Answer, bool, string, bool)`.
- `wshserver_chatsuggest.go`: adapt `ChatSuggestCommand` to the new returns, still answering `Replies` only (Task 4 adds
  the record). Its log line gains `pick=<true|false>`.
- `claude/arc-mod/hooks/suggest-core.ts`: `SUGGEST_MAX_TOKENS` 2048 → 3072, with a comment that the answer now carries a
  description per chip and a pick line. Run `claude plugin validate claude/arc-mod`.

Tests (Go, `pkg/chatsuggest`): `TestParseAnswerPickAndDescs` (descs attach to their reply; pick by number maps to text),
`TestParseAnswerDescOfDroppedReply` (a dropped reply's `=` line and a pick naming it give no desc and no pick),
`TestParseAnswerNoPickOutsideQuestion` (a non-question answer ignores `=`/`PICK`, and `=` lines never become replies),
`TestBuildPromptNoRecommendFirst` (the system prompt no longer contains "First the answer the agent recommends" and
asks for `PICK`; do not assert on the word "recommends" alone, the kept rule "even when the agent recommends another"
stays), `TestQuestionSentence` ("…B nhỏ hơn. Mình nghiêng A. A hay B?" gives "A hay B?"; fenced code after the
question; emphasis marks; a reply not ending in a question gives ""), plus every
existing `Parse`/`Suggest`/`Await` test moved to the new shapes and still passing. Run them by name.

### Task 3: `pkg/chatjudge`: the per-turn record store and the deep judge
**Depends on:** Task 1 (uses the `wshrpc.ChatJudge*` types)
**Files:** `pkg/chatjudge/store.go`, `pkg/chatjudge/store_test.go`, `pkg/chatjudge/judge.go`, `pkg/chatjudge/judge_test.go`, `pkg/chatjudge/judge-prompt.md`, `pkg/consult/consult.go`, `pkg/consult/consult_test.go`

New package, no wavesrv globals (Task 4 owns those). Exported interface Task 4 relies on:

- `const Role = "chat-judge"`; `const Model = "sonnet"`.
- `Qualifies(choice bool, replies []string) bool`: `choice && len(replies) >= 2`.
- `NewRecord(key, blockID, question string, recent []string, replies, descs []string, pick, reason string) wshrpc.ChatJudgeRecord`
  (`question` is the question sentence, which Task 4 gets from Task 2's `chatsuggest.QuestionSentence`; this package
  never sees the reply).
- `Store`: `OpenStore(path string) (*Store, error)` reads the file (missing = empty; unreadable JSON = error, logged by
  the caller, and the store starts empty rather than failing wavesrv), turns every record whose deep state is
  `reading` into `failed` with error "Arc restarted while the judge read"; `Get(key) (wshrpc.ChatJudgeRecord, bool)`;
  `Put(rec) error` (keeps at most 500, oldest by `Ts` dropped; writes the whole file through a temp file + rename);
  `List(agentID) []wshrpc.ChatJudgeRecord` (keys whose part before the first `:` is `agentID`, oldest first);
  `SetDeep(key string, deep wshrpc.ChatJudgeDeep) (wshrpc.ChatJudgeRecord, error)`. Safe for concurrent use.
- `JudgePrompt(rec wshrpc.ChatJudgeRecord, shuffle func(n int, swap func(i, j int))) (prompt string, letters map[string]string)`:
  the embedded `judge-prompt.md` filled with the question, the options in shuffled order labelled with opaque ids `o1`,
  `o2`, … (never letters: option texts often start "A, …" and the question says "A hay B?"; the prompt says the ids are
  the judge's own labels and carry no order) each with its description, and the recent messages. It never contains the
  reply text or the light pick. `letters` maps each id to its option's text.
- `ParseResult(text string, letters map[string]string) (pick, reason string, added *wshrpc.ChatJudgeAdded, err error)`:
  the last JSON object in the text (a code fence around it tolerated); `pick` an id → that option's text, `NEW` →
  `added.Label` (error when `added` is missing); an unknown id, empty reason, or no object is an error naming what
  was wrong. An `added` with an empty label is an error; at most one added option by construction.
- `pkg/consult/consult.go`: `CallOpts` gains `ExtraArgs []string`, which `ClaudeArgs` appends after `--add-dir` and
  before `--tools`; `RunClaude`'s signature is unchanged (it already returns the token total and calls `onTool` per
  tool event). Test in `consult_test.go`: `TestClaudeArgsExtraArgs` (the args appear once, in that place; none when
  empty, so every existing caller's argument list is unchanged).
- `Runner func(ctx, cwd, prompt string, onTool func(string)) (text string, tokens int, err error)`; `RunSonnet` is the
  production one: `consult.RunClaude(ctx, cwd, prompt, CallOpts{Model: Model, Tools: []string{"Read", "Grep",
  "Glob"}, ExtraArgs: []string{"--setting-sources", "", "--no-session-persistence", "--disable-slash-commands"}},
  onTool)`: no hooks or plugins (the arc mod) load in the judge, and no session lands in the project's history.
- `Judges`: `NewJudges(store *Store, run Runner, timeout time.Duration)`. `Judge(ctx, key, cwd string, retry bool)
  (wshrpc.ChatJudgeRecord, error)`: no record → error; deep `done` (or `failed`/`stopped` without `retry`) → the record
  as is; a judge already reading for `key` → wait on it (the caller's ctx ending stops only the wait); otherwise set deep
  `reading` (StartTs now), run on its own context with `timeout` (180 s in production), count `files` as the distinct
  base names in the `Read <base name>` tool descriptions (`describeClaudeTool` gives the base name only; two files with
  one name count once, which the line can bear), then `SetDeep` to `done` (pick, reason, added, model, tokens, files, EndTs) or `failed`
  (error: the run's error, "timed out after 3m0s", or the parse error). `Stop(key) error` cancels a reading judge and
  sets `stopped`; no judge reading is a no-op. Each judge's end logs
  `chatjudge: key=<first 16> role=chat-judge state=… model=sonnet tokens=… files=… took=…`.
- `judge-prompt.md`: in the spirit of `pkg/brainstormcheck/judge-prompt.md`: an independent reader of the project in
  the current directory; change no file; never read `.superpowers/`; verify in the code the facts the choice turns on;
  first ask whether an approach would beat every listed one, and add at most one; ground the reason in facts with
  `file:line`, one or two sentences in the language the question is written in; end with only the JSON object of the
  spec's decision (`{"pick":"B","reason":"…","added":null}` or `{"pick":"NEW",…,"added":{"label","desc","facts"}}`),
  the label short (a few words, like a chip).

Tests (`go test ./pkg/chatjudge -run '…'`): `TestStoreRoundTripAndCap` (Put/Get/List by agent, file reread, 501st drops the oldest),
`TestStoreOpenTurnsReadingIntoFailed`, `TestJudgePromptBlind` (prompt holds every option and its desc, never the reply
text or the light pick; a fixed shuffle gives the expected ids; no option is labelled with a bare letter), `TestParseResult` (id, NEW with added, fenced
JSON, unknown id, NEW without added, no JSON), `TestJudgesJoinAndStop` (fake runner blocking on a channel: a second
`Judge` joins the first and both get the same record; `Stop` ends it as `stopped`; `retry` reruns a failed one),
`TestJudgesTimeout` (fake runner that never returns, 50 ms timeout → `failed`, "timed out").

### Task 4: wavesrv wiring: the record on the chips' answer, the judge commands
**Depends on:** Task 2, Task 3 (uses `pkg/chatjudge`'s Store and Judges)
**Files:** `pkg/wshrpc/wshserver/wshserver_chatsuggest.go`, `pkg/wshrpc/wshserver/wshserver_chatjudge.go`

- `wshserver_chatjudge.go`: one `chatJudgeStore` (`sync.OnceValue`, `chatjudge.OpenStore(<data dir>/chatjudge.json)`;
  an open error is logged and an empty store used) and one `chatJudges` (`chatjudge.NewJudges(store, chatjudge.RunSonnet,
  180*time.Second)`). Replace Task 1's stubs: `ChatJudgeCommand` → `chatJudges().Judge(ctx, key, cwd, retry)` (an empty
  key or cwd is an error); `ChatJudgeStopCommand` → `Stop`; `ChatJudgeListCommand` → `List`. The deep judge does not go
  through `wsh tokengate` (it is the person's press).
- `ChatSuggestCommand`: with `data.Key` set and a stored record, answer `{Replies: <the record's option texts>, Judge:
  &rec}` at once, no model call, and log `via=record`. Otherwise answer as today; when `chatjudge.Qualifies(data.Choice,
  answer.Replies)`, build `chatjudge.NewRecord(data.Key, data.BlockId, chatsuggest.QuestionSentence(data.Reply), data.Recent, answer.Replies,
  answer.Descs, answer.Pick, answer.Reason)`, `Put` it (a write error is logged and the chips still answer, without
  `Judge`), and return it as `Judge`. No key: never store.

Acceptance: `go build ./pkg/... ./cmd/...` passes; `go test ./pkg/chatjudge ./pkg/chatsuggest -run '.'` still passes;
`go vet ./pkg/wshrpc/wshserver/` reports nothing new. No new handler test (the logic it calls is tested in Tasks 2 and
3); say in the report that a real sonnet judge was not run end to end.

### Task 5: Chat's judge logic and store
**Depends on:** Task 1 (uses the generated `ChatJudgeRecord` types and `RpcApi.ChatJudge*`)
**Files:** `frontend/app/view/agents/chatjudge.ts`, `frontend/app/view/agents/chatjudge.test.ts`, `frontend/app/view/agents/chatsuggest.ts`, `frontend/app/view/agents/chatsuggest.test.ts`, `frontend/app/view/agents/chatsuggeststore.ts`, `frontend/app/view/agents/chatsuggeststore.test.ts`, `frontend/app/view/agents/chatcomposer.tsx`

- `chatsuggest.ts`: `ChatChip` gains `judged?: boolean` and `send?: string`, and `source` gains `"judge"` (the added
  chip). `ChipIcon` gains `"judge"`; `chipIcon` answers `"judge"` for a judged chip (before the build hammer).
  `ModelSuggest` is unchanged (the record lives only in `chatJudgeAtom`). `pickedHint(chip, editable, reason?)`: with a reason,
  the line says it after what Enter sends. In `chatcomposer.tsx` only add `judge: Scale` (lucide, 13 px as the others)
  to `SUGGEST_ICONS` so the `Record<ChipIcon, …>` still typechecks; nothing else there (Task 6 owns the rest).
- `chatjudge.ts` (pure):
  - `choiceTurn(reply: string): boolean` = `endsWithQuestion && !yesNoQuestion`.
  - `judgedChips(chips: ChatChip[], rec: ChatJudgeRecord | undefined): ChatChip[]`: no record → as given. The deep
    pick when deep is `done`, else the light pick: that chip gets `judged: true` and moves first; with a deep added
    option a new chip `{text: added.label, kind: "reply", source: "judge", send: addedSend(added)}` goes first when it is
    the pick, else right after the judged chip. Only one chip is ever `judged`. A pick naming no chip changes nothing.
  - `addedSend(a: ChatJudgeAdded): string` = `` `${label}: ${desc}` `` plus `` ` (${facts.join("; ")})` `` when there are facts.
  - `judgeReason(rec): string | null`: the reason of whichever pick is shown (deep done over light).
  - `judgeLine(rec, now: number, vi: boolean, live: boolean): JudgeLine` with
    `type JudgeLine = { state: "none" } | { state: "light" | "reading" | "done" | "failed"; head?: string; name?: string;
    hint?: string; tail?: string; note?: string; reason?: string; source?: string; action?: "judge" | "stop" | "retry" }`: `none` without a record, or
    with neither a light pick nor a deep result on an old turn (`live` false); with a record, no light pick and no deep
    result on the live turn: `{state: "light", action: "judge"}` with no head or name (the action alone, so the deep
    judge is reachable when haiku wrote no `PICK`); `light`: head "Gợi ý" / "Suggested", name = the light pick, `hint` "rê vào để xem lý do" / "hover for why",
    `source` "haiku, chỉ đọc reply" / "haiku, read the reply only" (the tooltip's note), action `judge` when `live`; `reading`: head "Judge đang đọc code, không thấy agent khuyên gì" / "Judge is reading the code,
    blind to the agent's lean", tail the elapsed seconds (`34 s`), action `stop` when live; `done`: head "Judge chọn" /
    "Judge picks", name the deep pick, note "agent không nêu" / "the agent did not name it" when the pick is the added
    option, tail `sonnet · 14 file · 41 s` (en: `14 files`), `source` the same text for the tooltip, no action; `failed`: the light mark's head and name when
    there is one, note "Judge không xong: <error>" / "Judge failed: <error>", action `retry` when live; `stopped` reads
    as `light`.
- `chatsuggeststore.ts`:
  - `requestModelSuggest(key, data)` sends `key` and `choice: choiceTurn(data.reply)` with the data, and puts
    `rtn.judge` into `chatJudgeAtom` under `key` (the done state keeps only the replies, as today). `__chatSuggestFake` may answer `string[]` (as today) or a whole
    `CommandChatSuggestRtnData`.
  - `chatJudgeAtom: Record<key, ChatJudgeRecord>` (the record of each turn, from the chips' answer, the list and the
    judge); `useChatJudge(key)`; `loadChatJudges(agentId)` (once per agent per app life, `ChatJudgeListCommand`);
    `requestDeepJudge(key, cwd, retry = false)`: sets the record's deep to `reading` (StartTs now) at once, calls
    `ChatJudgeCommand` (timeout 200 s) with `retry: true` whenever the record's deep state is `stopped` or `failed` (so
    Stop then Judge kỹ runs again, never a silent no-op), and stores the answer; an RPC error sets deep `failed` with its message; a
    second call while one is in flight for the key does nothing. `stopDeepJudge(key)` calls `ChatJudgeStopCommand` and
    sets deep `stopped` at once. A record that arrives `reading` with no call in flight here (another window, a
    remount after reload) is joined by `requestDeepJudge(key, cwd)` from Task 7's line.
  - `liveJudgeAtom: Record<agentId, { key: string; cwd: string; action: "judge" | "retry" | "stop" } | undefined>`:
    the pane's live turn as the line offers it, written by `chatpane.tsx` (Task 7) and read by the Alt+J binding, which
    cannot see the pane's state. `runLiveJudge(agentId)` runs its action (judge/retry → `requestDeepJudge`, stop →
    `stopDeepJudge`).
  - DEV: `window.__chatJudgeReset?.()` empties `chatJudgeAtom` and `loadChatJudges`' once-per-agent memo (the
    scenario's stand-in for an app restart).
  - DEV: `window.__chatJudgeFake?: (cmd: "judge" | "stop" | "list", data) => unknown | Promise<unknown>` answers the
    three commands in place of wavesrv when set, as `__chatSuggestFake` does.

Tests: `chatjudge.test.ts`: `choiceTurn` (A-or-B question yes, yes-no no, statement no); `judgedChips` (light pick
first with `judged`; deep pick replaces it and the light chip loses `judged`; added pick first with its `send`; added
not picked sits second; pick naming no chip leaves the row); `addedSend` (with and without facts, the spec's example);
`judgeLine` in each state, both languages, `live` false shows no action, elapsed seconds ticking from `now`.
`chatsuggest.test.ts`: `chipIcon` judge; `pickedHint` with a reason. `chatsuggeststore.test.ts`: the ask carries
`key`/`choice`; a returned `judge` lands in the atom; `requestDeepJudge` goes `reading` → the answered record, an
error → `failed`, a second call while in flight sends nothing, a call on a `stopped` or `failed` record sends
`retry: true`; `stopDeepJudge` → `stopped`; `runLiveJudge` runs the atom's action; `loadChatJudges` asks once per agent
and again after `__chatJudgeReset` (use `__chatJudgeFake`). `judgeLine`'s no-pick live case shows the action alone.

### Task 6: The chips: the judged chip first, the added chip, stopping on an answer
**Depends on:** Task 5 (uses `judgedChips`, the store and the chip fields; shares `chatcomposer.tsx`)
**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `scripts/cdp/scenarios-chat-judge.mjs`, `scripts/cdp/scenarios.mjs`

- `chatpane.tsx`: on mount for an agent, `loadChatJudges(agent.id)`. The row is `judgedChips(chatChips(...), rec)` with
  `rec = useChatJudge(turnKey)` when the turn is a choice turn (`choiceTurn(reply)`), else `chatChips` as today.
  `fitChips` is unchanged and keeps the first chip. When the person sends anything (a chip, Cmd/Ctrl+Enter, or typed
  text) while the live turn's record has deep `reading`, call `stopDeepJudge(turnKey)`.
- `chatcomposer.tsx`: a chip's send uses `c.send ?? c.text` everywhere a reply chip sends or is put in the box
  (click, Enter on the picked chip, `quickChip` with Cmd/Ctrl+Enter; Shift+Enter edit puts `send ?? text` in the box);
  `chipPickLogLine` still logs the chip's label. A judged chip draws `Scale` via `chipIcon`. The picked-chip hint passes
  `judgeReason(rec)` to `pickedHint` when the picked chip is the judged one (pass the reason down as a prop). The
  judged chip moving to first rides the row's existing `AnimatePresence`/layout: add no new motion.
- New scenario file `scripts/cdp/scenarios-chat-judge.mjs` (pattern: `scenarios-chat-suggest-card.mjs`, its kit and
  `AC` fixtures; register it in `scenarios.mjs` beside `chatSuggestCardScenarios`), scenario `chat-judge`, a fixture
  Claude agent whose last reply ends as board C's does ("…A sửa đúng gốc nhưng đụng ba nơi gọi parseFrame; B nhỏ hơn.
  Mình nghiêng A. A hay B?") and fakes (`__chatSuggestFake` answering a `CommandChatSuggestRtnData` with the chips
  "B, bỏ cache", "A, sửa parseFrame", "cả hai luôn" in that order and a light pick on "A, sửa parseFrame", so moving it
  first is visible; `__chatJudgeFake`). Steps this task adds, each asserting the DOM: "judged chip first" (the light pick's chip is the
  row's first and carries the scale icon, `data-chat-suggest-judged`); "Cmd+Enter sends the judged chip" (the sent
  text equals that chip's text); "Tab shows the reason" (Tab to the judged chip, the box's hint line holds the reason);
  "added chip sends its full text" (fake a deep `done` with an added pick: it is first, and a click sends `addedSend`'s
  text); "answering stops the judge" (with deep `reading`, sending a chip calls the fake's `stop`). Add
  `data-chat-suggest-judged` on a judged chip.

Acceptance: `task check:ts` passes; the five steps above pass in `node scripts/cdp/final-verify.mjs chat-judge` on a
dev app (if no dev app can run in the worker's tree, say exactly which steps were not run).

### Task 7: The line under the message, its key, docs and CHANGELOG
**Files:** `frontend/app/view/agents/chatjudgeline.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-chat-judge.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

Match the board `C-under-reply` (the Prototype); `A-on-chip` and `B-strip` are rejected.

- `chatjudgeline.tsx` draws `judgeLine(...)` as board C does: one line, 12.5 px, muted ink, `padding-top` 6 px under a
  hairline top rule (the edge token), no box; the scale icon (lucide `Scale`, 13 px) before it in the light, done and
  failed states, a spinner icon while reading; the bold name in high ink with a dotted underline, the hover target; in
  the light state the dim `hint` after it ("· rê vào để xem lý do" / "· hover for why"); the note; the tail in
  `tabular-nums` (reading's seconds tick once a second); the action at the line's end: "Judge kỹ"/"Judge it" an accent
  text button, "Dừng"/"Stop" and "Thử lại"/"Retry" muted and underlined. All three call `runLiveJudge(agent.id)`
  (Task 5), which passes `retry` itself for a stopped or failed record. The no-pick live case is the action alone.
  Hover on the name shows the app's tooltip (`element/titletiphost.tsx` behaviour, solid `surface-raised` chip, edge
  strong border, at most ~420 px wide) holding the reason and, under it, the dim `source` ("haiku, chỉ đọc reply" /
  "haiku, read the reply only", or the deep judge's "sonnet · 14 file · 41 s"). A record that is `reading` with no call
  in flight here joins it (`requestDeepJudge`). Colors from tokens only. Motion: the line fades in with the chips
  (opacity, Fluid ease, `durMicro`); reading → done cross-fades the text (`durMicro`); a line growing to hold a longer
  label rides `springReveal`; reduced motion mounts at the end state. Attributes for the scenario:
  `data-chat-judge-line` with `data-state`, `data-chat-judge-name`, `data-chat-judge-action`, `data-chat-judge-tip`.
- `chatconversation.tsx`: the line is drawn **beside** a row, after it, the way `endedAfter(item.key)` places run and
  council cards after an item (~line 1826), never inside the item's cached element (`drawnItems` / `DrawnItem`, ~1814
  to 1885), so a record arriving or the live key changing redraws the line only and the item's cache keys stay as they
  are. An `agent` item matches a record when one of its `prose` parts' `text` gives a `suggestKey(agent.id, text)` that
  `chatJudgeAtom` holds. The prose part's `text` is the message entry's whole text when the reply holds no
  `arc-review` block (`chatmodel.ts` ~404), which is the text `lastReply` reads; a reply split around a review block is
  not matched (say so in a comment; such a reply ends in a verdict, not a choice question). The pane passes
  `liveJudgeKey` (its current turn key while its chips show, else null) and `cwd`; the line under that key is `live`.
  With `cwd` null there is no action (the line still shows what was judged). Old turns' lines stay after the person
  answers, with no action. The composer gets no judge line.
- `chatpane.tsx`: writes `liveJudgeAtom[agent.id]` (Task 5) from the live turn's line: `{key, cwd, action}` while the
  live line offers an action and `cwd` is known, else undefined (cleared on unmount and when the turn changes).
- Key: `Alt+J`, id `agent:chat-judge`, an Agent-surface binding (`useKeybindings`) whose `when` reads
  `liveJudgeAtom[focused agent]?.action` and is active only for `judge` or `retry`; `run` calls `runLiveJudge`. Extend
  `bindings.test.ts` where it lists Agent bindings. Add the row to `docs/keyboard-shortcuts.md`.
- Scenario steps added to `chat-judge`, each asserting the DOM: "light line" (the line under the question message reads
  Gợi ý + the light pick + the hover hint, has a top rule and the scale icon, action Judge kỹ, and no judge line in the
  composer); "hover shows the reason" (the tooltip holds the light reason and "haiku, chỉ đọc reply"); "no pick still
  offers Judge kỹ" (a record without a light pick on the live turn shows the action alone); "reading ticks" (Judge kỹ →
  `data-state="reading"`, spinner icon, the seconds change between two reads, action Dừng); "Stop returns to light"
  (click Dừng → the fake's `stop` was called, `data-state="light"`, Judge kỹ back; pressing it again calls the fake's
  `judge` with `retry: true`); "done with an added option" (the fake resolves with an added pick: Judge chọn + label +
  "agent không nêu" + `sonnet · N file · N s`, no action); "failed offers Retry" (a fake error: the light mark stays,
  the error and Thử lại show; Retry calls the fake's `judge` with `retry: true`); "Alt+J judges" (on a fresh turn Alt+J
  starts the judge); "history keeps the line" (after a chip is sent, the old message still shows its line with no
  action); "the line survives a restart" (`__chatJudgeReset()`, `__chatJudgeFake('list')` answers the stored record, and
  the line under the old message comes back); "reduced motion" (with reduced motion emulated the line mounts at its end
  state). Last step: `await h.whatsnewShot("chat-judge", { selector: <the question message and its line> })`.
- `CHANGELOG.md` Unreleased → Added, one line for the person: when an agent ends on a choice question, Chat shows under
  its message a suggested answer and why (hover), with Judge it (Alt+J) for a fresh sonnet that reads the code without
  seeing the agent's lean and may name a better option; the judged chip sits first so Cmd/Ctrl+Enter sends it. End it
  `<!-- big --> <!-- shot: none -->`.
- `docs/hand-checks.md`: `- [ ] (arcterm) …` lines for what the Final cannot check: a real haiku turn giving a pick,
  reason and descriptions (both the mod and the headless path); a real deep judge on a project (files and seconds in
  the line, waveapp.log's `role=chat-judge` line, no hooks firing in the judge); and the What's new picture: commit
  the `public/whatsnew/<version>-chat-judge.webp` the Final's `chat-judge` scenario writes and change the CHANGELOG
  line's `<!-- shot: none -->` to that file.

Acceptance: `task check:ts`; `npx vitest run frontend/app/store/keybindings/bindings.test.ts
frontend/app/cockpit/whatsnew.test.ts`; every `chat-judge` step passes in `node scripts/cdp/final-verify.mjs chat-judge`
on a dev app (if none can run in the worker's tree, say which steps were not run); run the `arc:ux-check` skill on the
line's states before calling it done.
