# Chat: a summary line after long turns, and a usage-limit strip above the composer

Date: 2026-11-18. Brainstorm: `.superpowers/brainstorm/chat-suggest-card/brainstorm.json`.

Two things borrowed from Claude Desktop's chat, for arcterm's Chat view of a Claude agent:

1. A one-or-two-sentence **summary line** of where things stand, after long turns.
2. A **usage-limit strip** just above the Chat composer when the account's weekly or 5-hour window runs low, naming
   the account and offering to switch to another.

Nothing else of Claude Desktop's suggestion card is taken: no repeated question in bold, no primary button with
Ctrl+Enter, no framed card with an X. The suggested-reply chip row (`chatsuggest.ts`, drawn by `chatcomposer.tsx`)
stays as it is.

## What is there today

- Suggested-reply chips after each turn: `frontend/app/view/agents/chatsuggest.ts` (pure rules and merge: commit /
  push / initiative chips, `lastReply`, `endsWithQuestion`, `recentPrompts`), `chatsuggeststore.ts` (the model half:
  `requestModelSuggest`, `useModelSuggest`, kept per turn by `suggestKey`), `chatpane.tsx` (~line 844-960 wires them),
  `chatcomposer.tsx` (draws the row: `SuggestChips`, Tab walks the chips).
- The model call: `pkg/chatsuggest/chatsuggest.go`, one haiku call per turn (`RunClaude`, `systemPrompt`,
  `BuildPrompt`, `Parse`), answers cached by prompt hash in `Suggester`. It returns reply lines only.
- Usage windows: `claudequota.ts` polls wavesrv's `pkg/claudequota` every 5 minutes and records the claude snapshot;
  `ratelimitstore.ts` keeps `fivehourpct`, `fivehourreset`, `weekpct`, `weekreset` per Claude account
  (`savedRateLimitsAtom`, `activeClaudeKeyAtom`, `claudeQuotaKey`, `agentQuotaKey`); live `AgentUsage` from a running
  session is merged over the saved snapshot.
- Accounts: `claudeaccount.ts` (`rowQuota`, `quotaLine`, `QUOTA_WARN_PCT = 90`, `restartCandidates`,
  `restartOnAccount`, `CLAUDE_ACCOUNT_META`), `claudeaccountrestart.tsx` (the dialog that resumes running agents on the
  new account). The switch itself is `select` in `settingspages/agents.tsx` (~line 302): it writes
  `claude:activeaccount`, then opens `ClaudeAccountRestartModal` for the agents still on the old account, leaving out
  projects pinned to their own account.
- Chat has no usage-limit warning today. The app bar has the 5-hour meter.

## 1. The summary line

**Look.** One or two sentences in muted text directly above the chip row, no frame, no X. It says what the turn did
and what it did not do, e.g. "Lỗi BOOT ERROR là do một arcterm thứ hai được mở khi cái đầu vẫn đang chạy dưới khay hệ
thống. Mình chưa sửa code và chưa dừng tiến trình nào." It is written in the person's language (the same rule the
chips follow: their last messages).

**When.** Only after a *long* turn: the agent's closing reply is longer than about one screen of Chat, or the turn ran
many commands. A short turn shows only the chips, as now. The exact threshold is a pure function with a test
(`isLongTurn` or similar, beside `chatsuggest.ts`), taking the reply text and the turn's tool-call count; the builder
picks the numbers (a starting point: reply over ~1,200 characters, or 8+ tool calls in the turn).

**Where it comes from.** The same haiku call that writes the chips writes the summary: no second call.

- `chatsuggest.Request` gains `Summary bool`; `BuildPrompt` asks, only when it is set, for one extra first line
  `SUMMARY: <one or two sentences>` (or similar marker), in the person's language, at most ~240 characters, saying what
  the turn did and what it left undone, never repeating the question the reply ends on.
- `Parse` splits that line off; the call's answer carries `summary` beside `replies`. The prompt hash already keys the
  cache, so a turn asked with and without a summary are two entries.
- The wshrpc command's return type gains the summary field (Go types, then `task generate`).
- `ModelSuggest`'s `done` state carries `summary?: string`; `chatpane.tsx` passes it to the composer with the chips.

**States.** While the call is on its way there is no line (no skeleton). A failed call, or an answer with no summary,
shows no line. The line belongs to the turn: once the person sends a new message it goes, as the chips do. Sending a
chip also removes it. A turn the model call is not asked for (`wantsModelSuggest` false) has no summary.

**Cost.** The summary adds output tokens to a call already made, and the reply tail sent may need to grow for a long
turn: the call sends the reply's last 1,500 runes today (`replyTailRunes`). Agent's call: for a summary request send
the reply's head (first ~600 runes) as well as its tail, so the summary can say what the turn set out to do; keep the
total under ~2,500 runes.

## 2. The usage-limit strip

**When it shows.** The Claude account's weekly window is at 80% or more, or its 5-hour window at 90% or more. When
both are past their thresholds the strip names the weekly one (it lasts longer) and adds the 5-hour one in the same
line.

**Which account.** Agent's call: the strip reads the window of the account *this agent* runs on (`agentQuotaKey`, its
block's `agent:claudeaccount` or login email), falling back to the active account; an agent launched on a different
account from the active one must not warn about the wrong one. Readings are the merged live-over-saved snapshot
`ratelimitstore.ts` already builds; a reading whose window has reset (past `weekreset` / `fivehourreset`) counts as
0%.

**Where.** A thin strip directly above the Chat composer, in every Claude agent viewed in Chat. An agent viewed as a
terminal has no strip. Not shown for non-Claude agents.

**What it says.** An icon, then "Approaching weekly usage limit · 84% · resets Thu, Nov 19, 1:00 AM" (5-hour: "5-hour
limit · 92% · resets 2:30 PM"), with the reset time in local time. Agent's call: the strip is English, as the rest of
Chat's chrome is (toasts, buttons); it is about the account and shared across agents, so it does not follow a
conversation's language. The summary line still follows the person's language, since haiku writes it.

**The account, and a switch.** When more than one Claude account is configured
(`ClaudeAccountListCommand` lists two or more, Default included), the strip also names the account the agent runs on
(its label, or its email) and offers "Chuyển sang <account>": the other account with the most room left, judged on the
same window by the saved snapshots (`rowQuota` per account). An account with no saved reading is offered only when no
account has one; an account itself past the threshold is not offered. The target may be the account that is already
active (an agent launched on B while A is active is offered A).

Clicking it does two things (builder question 1):

- **The app-wide switch, as settings does.** Extract `select` from `settingspages/agents.tsx` into a shared function
  (e.g. `switchClaudeAccount(id)` in a new `claudeaccountswitch.ts`) that both call. It writes
  `claude:activeaccount` (nothing when the target is already active) and opens `ClaudeAccountRestartModal` for the
  other agents still on the old account, leaving out pinned projects, exactly as settings does.
- **This agent moves too, always.** The agent the strip is shown in is restarted on the target account
  (`restartOnAccount`, with its block's `agent:claudeaccount` set to the target), even when the target was already
  active, and it is left out of the modal's list so it is not offered twice.

An agent in a project pinned to its own account (`projectsWithOwnAccount`) gets no switch button: the strip names its
account and the window, nothing else. With one account, no switch is offered.

**Snoozing (answer 6).** The strip has no X. In its place a small "Snooze" control opens three choices: 1 hour,
4 hours, until tomorrow (the next local 8:00 AM, or the next day's if past it; the builder may pick the hour). Snoozing
hides the strip in every agent (it is about the account, not the agent) for that time, whatever the window does
meanwhile: crossing a higher percentage does not bring it back early. When the time is up the strip shows again if the
window is still past its threshold. The snooze is kept per account as `{ until }` (epoch ms) in localStorage (wrapped in
try/catch; a lost value only shows the strip again). The "should it show" rule is a pure function with tests (e.g.
`limitStrip(reading, snoozedUntil, now)` in a new `chatlimitstrip.ts`), drawn by a thin `chatlimitstrip.tsx`.

**Styling.** Per `DESIGN.md`: colors from `@theme` tokens only (a warning tone for the icon or text, not a filled red
band), the composer's width, small text. It must not shift the composer when it appears beyond its own height, and it
sits above the chip row.

## Left to the builder

Agent's call: the builder decides these.

- The "long turn" numbers (characters, tool-call count), as a tested pure function.
- How `Parse` marks the summary line, and carrying the summary through the Go cache and `__chatSuggestFake`.
- The stacking order of strip, summary line and chips (the strip sits above both).
- The strip's exact English wording.
- The localStorage key for the snooze, and the "until tomorrow" hour.
- The strip's layout and tokens, following `DESIGN.md`.

## Testing

- vitest: the long-turn rule; the strip's show/hide logic (thresholds, a snooze hides it until its time, a reset
  window falls below the threshold, both windows past); the switch-target pick (most room, skips accounts past the threshold, no
  offer with one account); `ModelSuggest` carrying a summary through the merge.
- Go: `BuildPrompt` asks for the summary only when `Summary` is set; `Parse` splits the summary line and ignores it
  when absent or malformed; a reply line is never taken as the summary.
- `task check:ts`, after `task generate`.
- CDP: a scenario that shows a Chat with a long finished turn (summary line above the chips, the model call faked with
  `window.__chatSuggestFake`, extended to return a summary) and one with the strip shown for a weekly reading at 84%
  with two accounts (strip with the account and the switch offer), each with a screenshot.
- `CHANGELOG.md`: two `Added` lines (summary line after long turns; usage-limit warning above the Chat composer with
  account switch).

## Builder's decisions (2026-11-18, autonomous run)

The run had nobody at the cockpit; these are the calls left to the builder above, made by the run's lead, each with why.

1. **Long turn:** `isLongTurn(reply, toolCalls)` is true when the reply is over 1,200 characters or the turn made 8 or
   more tool calls. The tool calls are `turnToolCount(entries)`: the `action` entries after the last `user` entry.
   Why: the spec's starting point; 1,200 characters is about one screen of the 600px Chat column, and the count needs
   no new data (`runningActions` walks the same entries).
2. **Summary marker:** the model writes `SUMMARY: <text>` as its first line when asked. Only a line that starts with
   that marker (case-insensitive) is the summary, and only when `Summary` was set; such a line is never a reply chip,
   asked or not. A summary over 240 runes is cut at a word with an ellipsis rather than dropped (a summary half-said is
   still useful, unlike a chip that would send half a sentence). Why: an explicit prefix keeps a reply line from ever
   being taken for the summary, which the spec asks the tests to prove.
3. **Go shape:** `Parse(text string, question, summary bool) Answer` and `Suggester.Suggest` returns `(Answer, error)`,
   `Answer{Replies []string; Summary string}`; the cache keeps the `Answer`. `CommandChatSuggestData` gains
   `Summary bool json:"summary,omitempty"`, `CommandChatSuggestRtnData` gains `Summary string json:"summary,omitempty"`.
   Why: one value through the cache and the wire, no parallel maps.
4. **Prompt for a summary:** the reply sent is its head (first 600 runes) and its tail (last 1,800 runes) joined by an
   ellipsis line when the reply is longer than both; a summary request's system-prompt rule is in the user message,
   so the system prompt (and the cache hits of chip-only calls) stays as it is. Why: the spec's ~2,500-rune cap.
5. **The fake:** `window.__chatSuggestFake` may return `string[]` (as today) or `{ replies: string[]; summary?: string }`.
   Why: the existing scenarios keep working untouched.
6. **Where the summary line draws:** inside `ChatComposer`'s wrapper, directly above the chip row, as a `summary`
   prop. It shows while the composer would show the suggested chips' row (not while the running agent's action chips
   show, not while waking or dozing, not with an attachment in), even when the row has no chip. It goes when the turn
   does: `chatpane.tsx` passes it only alongside `chips`. Why: tying it to the chip row's own conditions gives "goes
   when the person sends, or sends a chip" for free.
7. **Stacking:** strip, then summary line, then chips, then the box. The strip is drawn by `chatpane.tsx` directly
   above `<ChatComposer>`, outside the composer. Why: it is about the account, not the turn, and it keeps the strip
   out of the composer's file.
8. **The strip's English, and the switch label:** "Approaching weekly usage limit · 84% · resets Thu, Nov 19, 1:00 AM";
   with the 5-hour window past too, "… · 5-hour 92%"; the 5-hour alone, "Approaching 5-hour usage limit · 92% · resets
   2:30 PM". With two or more accounts, " · <account>" follows, and the button reads "Switch to <account>". Why: the
   spec's own call that the strip is English like the rest of Chat's chrome; its Vietnamese "Chuyển sang" sample is
   read as the meaning, not the words.
9. **Which account the agent is on:** `agent.usage?.account` when the agent has reported, else its block's
   `agent:claudeaccount` (`login` meaning Default), else the active account; its quota key is
   `agentQuotaKey(account, agent.loginEmail, identity)`. The reading is the agent's live `usage` windows where it
   carries them, the saved snapshot for that key otherwise (`savedWindows`, which counts a reset window as 0%).
10. **Account count:** the switch is offered when `launchAccountChoices(identity)` is not empty (Default plus at least
    one account with its token). The target is the choice, other than the agent's own account (by quota key), with
    the lowest reading on the triggering window (weekly when it is past, else 5-hour); one at or past that window's
    threshold is skipped; one with no saved reading is offered only when no choice has one.
11. **The switch:** `switchClaudeAccount(id, opts)` in `claudeaccountswitch.ts` does what settings' `select` did
    (write `claude:activeaccount` unless already active; open `ClaudeAccountRestartModal` for the remaining
    candidates, pinned projects left out), with an `exclude` tab id the strip passes. `restartOnAccount` gains an
    optional account id: it writes `agent:claudeaccount` as that account (`login` for Default) instead of clearing it.
    Why: one switch path for both callers, and the agent moves to the target even before wavesrv sees the new setting.
12. **Snooze:** localStorage key `arc.chatLimitSnooze`, a map from quota key to `{ until }`; choices "1 hour",
    "4 hours", "Until tomorrow" (the next local 8:00 AM). Why: 8 AM is the start of a working day.
13. **CDP:** two scenarios, `chat-summary-line` and `chat-limit-strip`, in a new `scripts/cdp/scenarios-chat-suggest-card.mjs`.
    The strip's scenario feeds the identity, the saved snapshots and the active account through a DEV-only
    `window.__chatLimitFake`, since a dev store holds no second account.
14. **Edges of the strip (plan review, round 1):** the strip re-reads the time once a minute while it shows or is
    snoozed, so a snooze running out or a window resetting changes it without another event. Switch is hidden when this
    agent is not a restart candidate for the target (`restartCandidates([agent], target)` empty: no session to resume, no
    block), since the agent could not move with it. `agentAccountId` tests `usage != null` before reading
    `usage.account` (Default's usage leaves `account` out, which means `""`, not "unknown"). Settings keeps its own
    early return when the picked account is already active; the shared switch still opens the restart dialog in that
    case, which the strip needs. The switch's decisions are a pure, tested `switchPlan` beside the effectful function.
