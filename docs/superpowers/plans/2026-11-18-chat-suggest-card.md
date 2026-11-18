# Chat summary line and usage-limit strip Implementation Plan

**Goal:** After a long turn Chat shows a one-or-two-sentence summary above the chips, written by the same haiku call
that writes them; and a strip above the Chat composer warns when the agent's Claude account nears its weekly or 5-hour
limit, with a switch to the account with the most room and a snooze.

**Architecture:** The wire fields land first; then the Go half (`pkg/chatsuggest`) learns to ask for and parse a
`SUMMARY:` line, beside the frontend's pure models (`chatsuggest.ts`, a new `chatlimitstrip.ts`) with vitest beside
them; thin views draw them; `chatpane.tsx` wires both into the Chat pane. Every design call the spec left to the builder
is in the spec's "Builder's decisions" section (1 to 14): follow it.

**Tech stack:** Go, wshrpc + `task generate`, React 19 + jotai + Tailwind tokens, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-18-chat-suggest-card-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/chatsuggest/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-summary-line chat-limit-strip agent-chat`

### Task 1: The summary's wire fields
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_chatsuggest.go`, `frontend/types/gotypes.d.ts`

Decision 3. `CommandChatSuggestData` gains `Summary bool \`json:"summary,omitempty"\`` (ask for a summary line);
`CommandChatSuggestRtnData` gains `Summary string \`json:"summary,omitempty"\`` (the line, "" when none). Doc comments
in the file's style. Run `task generate` and commit what it changes in `frontend/types/gotypes.d.ts` (nothing
hand-edited; if generate changes any other file, that is drift from main: leave it out and say so in the report).
Acceptance: `go build ./pkg/...` succeeds and `gotypes.d.ts` carries `summary?: boolean` and `summary?: string` on the
two types.

### Task 2: Go: the summary in the chat-suggest call
**Depends on:** Task 1 (uses the `Summary` fields on the wshrpc types)
**Files:** `pkg/chatsuggest/chatsuggest.go`, `pkg/chatsuggest/chatsuggest_test.go`, `pkg/wshrpc/wshserver/wshserver_chatsuggest.go`

Spec section 1 "Where it comes from" and "Cost"; decisions 2, 3 and 4.

- `Request` gains `Summary bool`. `BuildPrompt` adds, only when it is set, an instruction (in the user message, not the
  system prompt) to write first one line `SUMMARY: <one or two sentences>` in the person's language (their messages),
  at most 240 characters, saying what the turn did and what it left undone, never repeating the question the reply ends
  on; then the replies as today. For a summary request the reply sent is its first 600 runes plus its last 1,800 runes
  with a `…` line between them when the reply is longer than both together (else the whole reply); a request without
  `Summary` sends exactly what it sends today (the prompt text of a chip-only call must not change).
- New `type Answer struct { Replies []string; Summary string }`. `Parse(text string, question, summary bool) Answer`:
  a line whose trimmed text starts with `SUMMARY:` (case-insensitive) is never a reply; when `summary` is true the first
  such line's rest, trimmed and folded to one line, is the summary, cut at a word with `…` past 240 runes; empty or
  absent gives `""`. Every other rule of today's Parse stands.
- `Suggester.Suggest(ctx, req) (Answer, error)`; the cache, `call.out` and the empty-reply case hold an `Answer`
  (empty reply: `Answer{Replies: []string{}}`). `ChatSuggestCommand` passes `data.Summary` in and returns
  `Replies` and `Summary`.

Tests (`go test ./pkg/chatsuggest -run 'TestBuildPrompt|TestParse|TestSuggest'`, Windows cgo env per AGENTS.md if
needed): BuildPrompt has no SUMMARY instruction without `Summary` and has it with it; a long reply with `Summary` sends
its head and its tail and stays under 2,500 runes of reply; Parse with summary=true splits the SUMMARY line and returns
the replies without it; summary=false drops a SUMMARY line and returns `""`; a malformed marker (`SUMMARY` with no
colon, the marker mid-line) is not a summary; a plain reply line is never the summary; an over-long summary is cut;
the existing Parse and Suggest tests updated to the new signatures and still passing, plus one Suggest test that a
request with and without `Summary` are two cache entries.

### Task 3: Frontend: long-turn rule and the summary in the model state
**Depends on:** Task 1 (uses the generated `summary` fields on `CommandChatSuggestData` / `CommandChatSuggestRtnData`)
**Files:** `frontend/app/view/agents/chatsuggest.ts`, `frontend/app/view/agents/chatsuggest.test.ts`, `frontend/app/view/agents/chatsuggeststore.ts`

Spec section 1 "When" and "States"; decisions 1 and 5.

- `chatsuggest.ts`: `ModelSuggest`'s `done` state becomes `{ status: "done"; replies: string[]; summary?: string }`.
  Add pure `turnToolCount(entries: readonly AgentEntry[]): number` (the `action` entries after the last `user` entry)
  and `isLongTurn(reply: string, toolCalls: number): boolean` (reply over 1,200 characters, or 8+ tool calls), with the
  two numbers as named constants. Add pure `turnSummary(model: ModelSuggest | undefined): string | undefined` (the
  `done` state's non-empty summary, else undefined). `chatChips` is unchanged in behaviour.
- `chatsuggeststore.ts`: `requestModelSuggest` sends `data.summary` as given; the answer's `summary` is stored in the
  `done` state. `window.__chatSuggestFake`'s type becomes `(data) => string[] | { replies: string[]; summary?: string }`
  (or a Promise of either); an array answer means no summary.

Tests (`npx vitest run frontend/app/view/agents/chatsuggest.test.ts`): `isLongTurn` at and around both thresholds;
`turnToolCount` counts only after the last user entry; `turnSummary` gives the summary for done, undefined for
loading, failed, done-without-summary and an empty string; `chatChips` with a summary-carrying `done` state gives the
same chips as without one.

### Task 4: The usage-limit strip and the shared account switch
**Depends on:** none
**Files:** `frontend/app/view/agents/chatlimitstrip.ts`, `frontend/app/view/agents/chatlimitstrip.test.ts`, `frontend/app/view/agents/chatlimitstrip.tsx`, `frontend/app/view/agents/claudeaccountswitch.ts`, `frontend/app/view/agents/claudeaccountswitch.test.ts`, `frontend/app/view/agents/claudeaccount.ts`, `frontend/app/view/agents/claudeaccount.test.ts`, `frontend/app/view/agents/settingspages/agents.tsx`

Spec section 2; decisions 7 to 12 and 14.

- `chatlimitstrip.ts` (pure): thresholds `WEEK_WARN_PCT = 80`, `FIVEHOUR_WARN_PCT = 90`;
  `limitStrip(reading: { week: DonutWindow; fivehour: DonutWindow }, snoozedUntil: number | undefined, now: number)`
  returns null (below both thresholds, or snoozed until after `now`) or `{ window: "week" | "fivehour"; pct; reset;
  also?: { pct } }` (weekly first when both are past, the 5-hour in `also`); `stripText(strip)` gives the decision-8
  wording with local reset times; `switchTarget({ choices, ownKey, keyOf, saved, window, now })` per decision 10,
  returning the `AccountChoice` or null; `nextSnooze(choice: "1h" | "4h" | "tomorrow", now)` (tomorrow = next local
  8:00 AM); `agentReading(...)` merging the agent's live `usage` windows over `savedWindows` of its key (decision 9);
  `agentAccountId(usage, blockMeta, activeId)` (decision 9; tests `usage != null` first, decision 14).
- `claudeaccountswitch.ts`: pure `switchPlan(id, { agents, lineage, projects, accounts, identity, active, exclude? })`
  returning `{ writeActive: boolean; candidates: RestartCandidate[]; accountName: string }`: `writeActive` is
  `id !== active`; candidates are `restartCandidates(agents, id, lineage)` less pinned projects
  (`projectsWithOwnAccount`) less the `exclude` tab; `accountName` as settings computes it today. Effectful
  `switchClaudeAccount(id, opts)` applies it: writes `claude:activeaccount` when `writeActive`, then pushes
  `ClaudeAccountRestartModal` when candidates remain (also when `id === active`, which the strip needs).
  `settingspages/agents.tsx`'s `select` keeps its own `if (id === active) return`, then calls it, keeping only its local
  state updates (`setError`, `setList`).
- `claudeaccount.ts`: `restartOnAccount(c, account?: string)`: given an account id it writes `agent:claudeaccount` as
  that account (`DEFAULT_ACCOUNT_PICK` for `""`) instead of clearing it; without one, behaviour is unchanged (the
  restart dialog's call passes none). Put the meta in a small pure exported helper (`restartMeta`) so it is testable.
- `chatlimitstrip.tsx`: `ChatLimitStrip({ model, agent })`, rendering nothing for a non-Claude agent. It reads
  `savedRateLimitsAtom`, `claudeIdentityAtom`, `activeClaudeAccountAtom`, the agent's block meta, and the projects;
  a DEV-only `window.__chatLimitFake?: { identity: ClaudeIdentity; saved: Record<string, SavedSnapshot>; active: string;
  pinned?: boolean }` stands in for the first three and for the project pin (declare it in this file; read it on each
  render tick so a scenario can reseed it). Snooze kept per quota key under localStorage `arc.chatLimitSnooze` (every
  read and write in try/catch; a lost value only shows the strip again), shared by every pane through one jotai atom so
  a snooze hides it in every agent at once. A once-a-minute tick while the strip shows or a snooze is running re-reads
  the time (decision 14). Layout: one thin line at the composer's width, small text, a warning-tone icon/text from
  `@theme` tokens (no filled band, no raw colors), the account name with two or more accounts, a "Switch to <account>"
  button (none when pinned, no target, or the agent is not a restart candidate for the target, decision 14), and a
  "Snooze" control opening the three choices. Clicking Switch calls `switchClaudeAccount(target.id, { …, exclude:
  agent.id })` then `restartOnAccount(this agent's candidate, target.id)`, a failure surfacing as an error toast. DOM
  contract: `[data-chat-limit-strip="<agentId>"][data-chat-limit-window="week|fivehour"]`, `[data-chat-limit-text]`,
  `[data-chat-limit-account]`, `[data-chat-limit-switch]`, `[data-chat-limit-snooze]`, and each choice
  `[data-chat-limit-snooze-choice="1h|4h|tomorrow"]`. Follow `DESIGN.md`.

Tests (`npx vitest run frontend/app/view/agents/chatlimitstrip.test.ts frontend/app/view/agents/claudeaccountswitch.test.ts frontend/app/view/agents/claudeaccount.test.ts`):
limitStrip thresholds (79/80 week, 89/90 5-hour), both past names the week and carries the 5-hour, a snooze hides it
until its time and not after, a window past its reset reads 0 and hides it; stripText wording for week, 5-hour and
both; switchTarget picks the most room, skips one past the threshold and the agent's own account, offers an unread
account only when none has a reading, gives null with one account; nextSnooze before and after 8 AM; agentAccountId's
order, with a Default usage that has no `account`; switchPlan: `id === active` writes nothing but still lists
candidates, `exclude` and pinned projects left out, none left gives no candidates; restartMeta with and without an
account (`""` → `login`).

### Task 5: Wire both into Chat, the CDP scenarios, the changelog
**Depends on:** Task 3 (uses `isLongTurn`, `turnToolCount`, `turnSummary` and the `summary` request field), Task 4 (uses `ChatLimitStrip` from chatlimitstrip.tsx)
**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `scripts/cdp/scenarios-chat-suggest-card.mjs`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Spec sections 1 "Look" and "States", 2 "Where"; decisions 6, 7, 13 and 14.

- `chatpane.tsx`: compute `long = isLongTurn(reply, turnToolCount(entries))` (memoized) and pass `summary: long` in
  `requestModelSuggest`'s data; pass `summary={chips !== undefined && long ? turnSummary(modelSuggest) : undefined}` to
  `ChatComposer`; render `<ChatLimitStrip model={model} agent={agent} />` directly above `<ChatComposer>` (the strip is
  only in the Chat pane, so an agent shown as a terminal has none).
- `chatcomposer.tsx`: a `summary?: string` prop drawn as muted small text (one or two sentences, wrapping, no frame, no
  X) directly above the chip row, `[data-chat-summary]`. Its gate is exactly: `summary` set, not waking, not dozing,
  no attachment in, and the chip row is not `"actions"` — it shows when the row has no chip (decision 6: `row.kind`
  is `"suggest"` only with chips, so do not gate on it). No skeleton while loading.
- `scripts/cdp/scenarios-chat-suggest-card.mjs` (registered in `scripts/cdp/scenarios.mjs` as the other
  `scenarios-chat-*.mjs` files are), modelled on `scenarios-chat-initiative-band.mjs` (fixture agents over real tabs,
  its `setMockRpcClient` mock) and the `agent-chat` scenario's `__chatSuggestFake` use (scenarios.mjs ~46240, step 44b,
  which also shows how a chip send is stubbed):
  - `chat-summary-line`: (1) a fixture Claude agent whose transcript ends in a finished turn with a reply over 1,200
    characters, the fake returning `{ replies: [...], summary: "..." }`: the request carried `summary: true`;
    `[data-chat-summary]` shows the text above the `[data-chat-suggest-chip]`s; screenshot. (2) The fake returning
    `{ replies: [], summary: "..." }` for another long turn: the summary shows with no chip; screenshot. (3) Send a
    chip (Tab+Enter, with the send stubbed as step 44b does) and assert `[data-chat-summary]` is gone. (4) A short-turn
    agent: the request carried no `summary` and no line shows.
  - `chat-limit-strip`: (1) `__chatLimitFake` with two accounts, the agent's at week 84% and the other at 30%: the strip
    shows with `data-chat-limit-window="week"`, the account name and "Switch to <other>", above the chips and the box;
    screenshot. (2) Week 84% and 5-hour 92%: still `week`, the text carries the 5-hour too. (3) 5-hour 92% only:
    `data-chat-limit-window="fivehour"` and its wording. (4) Reseed with one account: the strip shows with no
    `[data-chat-limit-switch]`; screenshot. (5) Two accounts with `pinned: true`: no switch button. (6) Two accounts,
    the RPC mock intercepting `setconfig`, `setmeta`, `controllerdestroy` and `controllerresync` (nothing reaches
    wavesrv; the fixture agent's transcript path must carry a session id so it is a restart candidate): click Switch and
    assert `setconfig` got `claude:activeaccount` = the target and `setmeta` got `agent:claudeaccount` = the target for
    this agent's block; close any restart dialog it opened. (7) Snooze → 1 hour hides the strip in the pane.
    Teardown clears `arc.chatLimitSnooze`, the fakes and the mock.
- `CHANGELOG.md`: two `Added` lines under the top `Unreleased` section (open one above a dated top section): the
  summary line after long turns, and the usage-limit warning above the Chat composer with an account switch.

Acceptance: `npx vitest run frontend/app/view/agents/chatsuggest.test.ts frontend/app/view/agents/chatlimitstrip.test.ts`
passes; `task check:ts` is clean; every step above of `chat-summary-line` and `chat-limit-strip` passes in the Final,
and `agent-chat`'s existing chip steps still pass with the array-returning fake.
