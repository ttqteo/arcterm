# Telegram answers for agent asks — design

Effort: `98752683-b111-4834-a78b-3af712f5660e` ("tele asking to remote control"). Its four `Decide:` chunks hold
the decisions this spec builds on.

## Goal

When an agent stops on a question (an ask), the question reaches the person's phone in Telegram. They tap an option,
or reply with a few words of feedback, and the agent carries on. Nothing else: Telegram cannot send a prompt, start a
run, stop an agent, or read a transcript. It answers the asks that are already waiting.

## Decisions (from the effort)

1. **Scope:** answer a pending ask by an option or a short free-text reply. No new work from Telegram.
2. **Transport:** wavesrv long-polls the Bot API (`getUpdates`). No open port, no relay, no webhook.
3. **Pairing:** the bot token is stored by arcterm, off by default. The app shows a one-time code; `/start <code>`
   sent to the bot pairs that chat, and only that chat is answered.
4. **What is sent:** every ask that is waiting on the person. Answering it in the app first edits the Telegram message
   to say so.

One refinement of decision 3: the token goes in the encrypted secret store (`pkg/secretstore`, as the OpenRouter key
does, `pkg/consult/openrouter.go:25`), not in `settings.json`. The non-secret parts (on/off, paired chat) are settings.

## What the person sees

Setup, once:

1. In Telegram, `@BotFather` → `/newbot` → a token.
2. Settings → General → Notifications → **Telegram**: paste the token, switch it on, press **Pair**. The row shows a
   code valid for 10 minutes.
3. Send `/start <code>` to the bot. The row turns to "Paired with <chat name>" and the bot replies "Paired. Agent
   questions will arrive here." **Unpair** clears the chat.

Then, per ask:

```
🤖 api-refactor · arcterm
Which migration strategy?

[ Expand-contract ]  [ Big bang ]
[ Feature flag ]

Reply to this message to answer in your own words.
```

- Tapping a button answers at once; the message is edited to `✓ Expand-contract` with the buttons removed.
- Replying (Telegram's reply-to) to the message with text answers with that text (the "Type something" row in Claude
  Code, a text answer for pi's prose asks); the message is edited to `✓ "<text>"`.
- A multi-select question shows toggle buttons (`☐ A` / `☑ A`) and a **Send** button.
- An ask with several questions is sent one question per message, in order; the answers are delivered together after
  the last one, exactly as the cockpit's panel delivers them.
- Answered in the app, by the Gatekeeper, by a dag lead, or the agent moved on: the message becomes
  `✓ Answered in arcterm` with no buttons. The bot cannot tell these apart, so there is one wording for all of them.
- A tap on a message whose ask is gone edits that message the same way and shows the toast "Already answered". A
  reply to one gets the bot's reply "Already answered." (Telegram has no toast for a reply).

## Architecture

New package `pkg/telebot`, started from `cmd/server/main-server.go` next to the job queue, one goroutine for the
poller and one for the reconcile loop. It only runs when `telegram:enabled` is true and a token is stored; a config
change (`wconfig.ConfigHook`) pokes it to start, stop, or pick up a new token.

### Bot API client (`pkg/telebot/api.go`)

A thin HTTP client over `https://api.telegram.org/bot<token>/`: `getMe`, `getUpdates` (long poll, `timeout=50`,
`allowed_updates=["message","callback_query"]`), `sendMessage` (with `reply_markup` inline keyboard), `editMessageText`,
`answerCallbackQuery`. Backoff on errors: 1s doubling to 60s; a 401 (bad token) stops polling and reports the error
until the token changes. The token is never logged; errors are logged with it redacted.

On start it calls `getUpdates` with `offset=-1` once, to drop a backlog from while arcterm was closed (old taps refer
to asks this process never sent, and would only answer "Already answered"). That call returns the last update; polling
then starts at its `update_id + 1`, so the last one is dropped too.

A 401 stops polling whether `getMe` or `getUpdates` returns it. A 409 on `getUpdates` keeps backing off and reports
"Another app is polling this bot".

The API base (`https://api.telegram.org`) can be overridden by the env var `ARC_TELEGRAM_API_BASE`, read only when
`wavebase.NoGlobalInstall()` is true (the test harnesses' dev app: `final-verify.mjs` and `browser-app.mjs` set
`ARC_DEV_NO_GLOBAL_INSTALL`, a packaged build never does), so the CDP scenario can run a fake Bot API. A packaged build
ignores it.

### Pairing (`pkg/telebot/pair.go`)

`TelegramPairCommand` (wshrpc) makes a 6-digit code, kept in memory for 10 minutes. A `/start <code>` message from any
chat with the right code writes that chat's id and title to settings (`telegram:chatid`, `telegram:chatname`) through
`wconfig.SetBaseConfigValue`, and clears the code. Every other message or callback from a chat that is not the paired
one is ignored without a reply. A paired chat's message that is neither `/start` nor a reply to an open ask message
gets one fixed reply: "I only answer agent questions. Reply to a question message to answer it." A reply to a
message whose ask is gone gets "Already answered." instead.

After 5 wrong `/start <code>` messages from one chat inside a minute, that chat's `/start` is ignored until the minute
clears; a stranger who knows the bot's name blocks only their own chat. 60 wrong codes a minute from all chats together
stop every `/start` for the rest of the minute, which caps guesses at about 600 per code (0.06% of 10^6).

### Reconcile loop (`pkg/telebot/state.go`, run by `bot.go`)

Every 2 s it compares the registry with what it has sent (the 8 s grace below makes an event-driven trigger buy
nothing):

- **Which asks count:** `agentask.GlobalRegistry.List()` filtered like the attention list (`pkg/jarvis/attention.go:385`):
  skip `Owner == lead`, skip blocks that no longer exist (reuse `livePendingAsks`, exported for this). An ask whose
  owner moves from lead to user (`orchestrate/wake.go:690`) is picked up on the next tick; polling the registry
  rather than hooking each publish path is why it needs no extra wiring there.
- **Grace:** an ask is sent only after it has been pending 8 s, so one the Gatekeeper answers in a few seconds never
  reaches the phone.
- **New:** send the first question's message; remember `askId → {oref, chat, message ids, question index, partial
  answers, multi-select picks}` in memory.
- **Gone or replaced** (oref missing, or a different `AskId`): edit the old ask's open question to "✓ Answered in
  arcterm" and forget it; an earlier question of the same ask answered in Telegram keeps its `✓ <label>`. An ask the bot itself delivered is forgotten when it delivers, so its `✓ <label>` stays.

State is memory only. After a restart the still-pending asks are sent again as new messages; that is acceptable for v1.

### Answering (`pkg/telebot/state.go`, delivered by `bot.go`)

Callback data is short (`a:<n>:<q>:<o>`, `t:<n>:<q>:<o>` toggle, `s:<n>:<q>` send), where `<n>` is a per-process
counter mapped to the ask id, because Telegram caps callback data at 64 bytes. The counter starts at the Unix time,
so a tap on a button sent before a restart matches no ask and reads "Already answered" instead of answering a new ask
that took the same number.

When the last question is answered, it calls `agentask.DeliverAnswer(oref, askId, answers)` with
`[]baseds.AgentAnswerItem` (`SelectedIndexes` for buttons, `Text` for a reply). Passing the ask id makes a stale
answer to a replaced ask fail instead of answering the new one. It is the same claim-then-deliver path the cockpit,
the Gatekeeper and the dag lead use (`pkg/agentask/deliver.go:52`), so the answer hook records the lifecycle row and
publishes the clear; a dag child's ask that went back to the lead is no longer counted, and `DeliverAnswer` refuses
a claimed one. A delivery error edits the message to "Could not answer — open arcterm" and keeps the buttons off, except a refusal
wrapping `agentask.ErrNoPendingAsk` (answered elsewhere between the tap and the delivery), which edits it to
"✓ Answered in arcterm".

### Message text

- Header: the agent's display name, the source from `jarvis.ResolveAskOwner(ctx, jarvis.ChannelOwnerORef(ctx, oref))`
  (the same name the Needs you row shows, `attention.go:933`; `agent` when it is empty, as for a standalone agent), then
  ` · ` and the name of the channel that owns it, when one does.
- Body: the question's `Header` and `Question`, collapsed to plain text, capped at 1,000 characters. Option previews
  and descriptions are not sent. Sent as plain text (no `parse_mode`), so nothing in a question is interpreted.
- No transcript, no file contents, no tool input. A held command's card (`Hold`) shows its question text only, which
  is what the cockpit card shows.

### Settings and RPC

New settings in `pkg/wconfig/settingsconfig.go`: `telegram:enabled` (bool), `telegram:chatid` (string: a chat id can
pass 2^53, which a JSON number does not hold exactly), `telegram:chatname` (string). Secret name `telegram_bottoken`.

All three `telegram:*` keys are machine-local (`machineLocalKeys` in `pkg/wconfig/vaultlayer.go`): never written to the
vault layer and ignored if found there. The token they go with lives only in this machine's secret store, so a second
machine that synced `enabled` and `chatid` would poll the same bot without it (or with its own token: a 409 loop between
the two pollers).

New wshrpc commands (`pkg/wshrpc/wshrpctypes_telegram.go`, then `task generate`):

- `TelegramStatusCommand` → `{ enabled, hastoken, polling, botname, chatname, paircode, paircodeexpires, lasterror }`
- `TelegramPairCommand` → `{ code, expires }`
- `TelegramUnpairCommand`

The token itself is set and cleared through the existing `SetSecretsCommand`.

### Frontend

A **Telegram** row under Settings → General → Notifications (`settingsmodel.ts`, `settingspages/general.tsx`), a
`telegramrow.tsx` beside them with its pure state in `telegrammodel.ts` (+ test): token field (`SecretInput`), on/off
switch, status line, Pair / Unpair. It polls `TelegramStatusCommand` every 2 s while the page is open so the row flips
to "Paired" without a reload.

## Error handling

| Case | Behaviour |
|---|---|
| No token / switched off | Nothing runs; the row says why. |
| Bad token (401) | Polling stops; row shows "Token rejected by Telegram". |
| Network down | Backoff to 60 s; row shows the last error; asks are sent once it is back if still pending. |
| Two arcterm installs on one token | Telegram returns 409 on `getUpdates`; row shows "Another app is polling this bot". |
| Tap on an answered ask | Edit to "✓ Answered in arcterm", toast "Already answered". |
| Reply to an answered ask | Bot replies "Already answered." |
| Delivery fails | Edit to "Could not answer — open arcterm"; the ask stays in the cockpit. |

## Testing

- Go unit tests with an `httptest` server standing in for the Bot API: pairing, ignoring other chats, grace, send →
  answer → `DeliverAnswer` called with the right items, multi-select, multi-question, gone ask edits, stale callback,
  401 (from `getMe` and from `getUpdates`) / 409 handling, the backlog drop, a plain message's fixed reply, token
  redaction in logs.
- vitest for `telegrammodel.ts`.
- A CDP scenario that opens Settings → General and walks the Telegram row through every state against a fake Bot API
  (node, started by the scenario; the Final starts the dev app with `ARC_TELEGRAM_API_BASE` pointing at it): no token,
  token saved (off), switched on (connecting, then unpaired), Pair (code shown), `/start <code>` through the fake
  (paired), Unpair, and a 401 (error), with a screenshot of each.
- Hand check with a real bot: pair, answer by button, answer by reply, answer in the app and see the edit.

## Cost

One goroutine long-polling one HTTP connection, one ticker, a small map of open asks. Measure wavesrv RAM with it on
and add a "RAM watch" line in `docs/open-issues.md`.

## When it connects (added 2026-10-16)

A steady long-poll to `api.telegram.org` from a work machine reads as a command-and-control channel to corporate
network monitoring. So the bot connects only when there is something to do, and only inside a time the person
allowed. Effort chunk "Decide: when Telegram may connect" holds the decision.

**Allowed time.** `telegram:enabled` stays the master switch. Inside it, `telegram:mode` picks when the bot may connect:

- `manual` (unset reads as this): only until `telegram:onuntil` (UnixMilli), set from the row's **On for 1h / 2h / 4h**
  or a typed number of hours; **Turn off now** clears it.
- `schedule`: inside `telegram:schedule`, a string `"<days> <HH:MM>-<HH:MM>"` in local time, days a comma list of
  `mon`…`sun`. Unset reads as office hours, `"mon,tue,wed,thu,fri 08:00-17:30"`. An end at or before the start runs
  past midnight, and the days name the day a window starts (`"mon,tue,wed,thu,fri 17:30-08:00"` is outside office
  hours). A live `telegram:onuntil` also allows it outside the schedule.
- `always`: whenever it is switched on.

**Connect on demand.** Inside an allowed time the bot holds a session (getMe, backlog drop, long poll) only while it
has something to do: a question waiting past the grace or still open in Telegram, or a live pairing code. With
neither, it disconnects after 30 s, and no request leaves the machine until the next question. Switching it on or
storing a new token makes one `getMe`, to show the bot's name and catch a wrong token, and nothing more. The
tracker of sent questions lives on the bot, not the session, so a reconnect does not resend them. The 2 s tick that
decides all this reads only the local ask registry and the clock.

**When the allowed time ends** with a question open in Telegram, its message is edited to
`— Telegram is off until Mon 08:00` (or `— Telegram is off; answer in arcterm` when nothing will turn it back on), it is
forgotten, and the bot disconnects. If the question is still waiting when the time comes back, it is sent again.

**Status** adds `allowed`, `alloweduntil` (UnixMilli, 0 = no end), `nextallowed` (UnixMilli, 0 = none), `connected` and
`open` (questions open in Telegram). The row says: `Off until Mon 08:00`, `On until 15:40 · Turn off`, `Paired with
<chat> · connects only when an agent asks`, or `Connected · 1 question open`.

## Out of scope

Sending prompts, starting or stopping anything, other notifications (run done/failed, Needs you items other than
asks), several paired chats, group chats with several people, webhooks, keeping message state across restarts.
