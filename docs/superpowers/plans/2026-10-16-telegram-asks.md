# Telegram answers for agent asks — implementation plan

**Verify:** `node scripts/verify.mjs ./pkg/telebot ./pkg/jarvis ./pkg/wconfig ./pkg/wshrpc/... ./cmd/server/...`

**Check:** `task check:ts`

**Final:** `ARC_TELEGRAM_API_BASE=http://127.0.0.1:18765 node scripts/cdp/final-verify.mjs settings-telegram surface-smoke`

**Goal:** an agent's pending ask reaches the paired Telegram chat; tapping an option or replying with text answers it
through the same `agentask.DeliverAnswer` path the cockpit uses, and the agent carries on. Nothing else is
controllable from Telegram.

**Spec:** `docs/superpowers/specs/2026-10-16-telegram-asks-design.md`. Effort `98752683-b111-4834-a78b-3af712f5660e`.

**Architecture:** a new Go package `pkg/telebot`, in three layers so most of it is tested without a network:
`api.go` (a thin Bot API HTTP client), `state.go` (pure: which asks to send, what each message says, what a tap or a
reply turns into), `bot.go` (the runtime: one long-poll goroutine and one 2 s reconcile ticker, its dependencies
injected as funcs). `wavesrv` wires it at startup with the real registry, delivery, names and settings; three wshrpc
commands back a Telegram row under Settings → General → Notifications.

**Facts the tasks rely on (checked 2026-10-16):**

- `agentask.GlobalRegistry.List()` (`pkg/agentask/agentask.go:149`) returns every pending ask keyed by block oref;
  `PendingAsk` has `AskId`, `Questions`, `Ts` (UnixMilli), `Prose`, `Hold`, `Owner` (`agentask.AskOwner_Lead` = a dag
  child's ask still with its lead).
- `agentask.DeliverAnswer(oref, askid string, answers []baseds.AgentAnswerItem) (bool, error)`
  (`pkg/agentask/deliver.go:52`) claims and delivers; with `askid` set a replaced ask is refused; the answer hook
  publishes the clear and records the lifecycle row.
- `baseds.AgentAnswerItem{SelectedIndexes []int; Text string}` — one per question, exactly one field set
  (`pkg/baseds/baseds.go:149`). A `Prose` ask takes the option **label** as `Text` instead of an index (the cockpit
  does the same).
- Display name: `jarvis.ResolveAskOwner(ctx, jarvis.ChannelOwnerORef(ctx, oref))` returns `(channel, _, source)`
  (`pkg/jarvis/watcher.go:88,108`), used the same way at `pkg/jarvis/attention.go:933-942`. Dead blocks are filtered by
  the unexported `livePendingAsks` (`attention.go:996`), called at `attention.go:914` and in
  `pkg/jarvis/attention_askprune_test.go:49`. A standalone agent's ask resolves to `(nil, "", "")`; the Needs you row
  then falls back to a fixed word (`attention.go:391`).
- Secrets: `secretstore.GetSecret(name) (string, bool, error)` (`pkg/secretstore/secretstore.go:176`); the frontend sets
  one with `RpcApi.SetSecretsCommand(TabRpcClient, { name: value })` and deletes with `null`
  (`frontend/app/view/agents/settingspages/backgroundai.tsx:106,121`).
- Settings write from Go: `wconfig.SetBaseConfigValue(waveobj.MetaMapType{...})` (`pkg/wconfig/settingsconfig.go:654`);
  read: `wconfig.GetWatcher().GetFullConfig().Settings`. `wconfig.ConfigHook` in `cmd/server/main-server.go:393` is where
  a config change pokes services.
- `task generate` depends on `build:schema` (`Taskfile.yml:389`), which rewrites the tracked `schema/settings.json`
  from `SettingsType`; `TestSettingsKeysInSync` (`pkg/wconfig/settingskeysync_test.go`) fails if they drift.
- `frontend/app/view/agents/settingsmodel.test.ts` pins the rows of each card (`general/notifications` at ~l.315) and
  the total row count (~l.376).
- `CHANGELOG.md` has no `## Unreleased` section today: its top section is `## 0.15.14 — 2026-10-16`, which already has
  5 `<!-- big -->` lines, the most `whatsnew.test.ts` allows.
- Dev app of the test harnesses: `wavebase.NoGlobalInstall()` (`pkg/wavebase/wavebase.go:120`), set by
  `ARC_DEV_NO_GLOBAL_INSTALL`, which `final-verify.mjs` and `browser-app.mjs` set and a packaged build never does.
  `wavebase.IsDevMode()` needs `WAVETERM_DEV`, which nothing in the repo sets: don't gate on it.
- wshrpc command groups are interfaces in `pkg/wshrpc/wshrpctypes_*.go`, composed in `WshRpcInterface`
  (`pkg/wshrpc/wshrpctypes.go:34`); handlers live in `pkg/wshrpc/wshserver/wshserver_*.go`. Run `task generate` after.

---

### Task 1: Bot API client

**Depends on:** none

**Files:** `pkg/telebot/api.go`, `pkg/telebot/api_test.go`

A minimal client over the five Bot API methods the bot needs. No third-party library.

```go
// Package telebot sends an agent's pending ask to the paired Telegram chat and turns a tap or a reply there into
// the same answer the cockpit delivers. It answers asks only: it never sends a prompt or starts anything.
package telebot

const defaultAPIBase = "https://api.telegram.org"

type Client struct {
	Base  string // defaultAPIBase in production, an httptest URL in tests
	Token string
	HTTP  *http.Client
}

// APIError is a Bot API "ok": false reply. Code 401 means the token is wrong; 409 means another process polls it.
type APIError struct {
	Code int
	Desc string
}

func (e *APIError) Error() string { return fmt.Sprintf("telegram: %d %s", e.Code, e.Desc) }

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}
type Chat struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
}
type Message struct {
	MessageID int      `json:"message_id"`
	Chat      Chat     `json:"chat"`
	Text      string   `json:"text"`
	ReplyTo   *Message `json:"reply_to_message"`
}
type CallbackQuery struct {
	ID      string   `json:"id"`
	Message *Message `json:"message"`
	Data    string   `json:"data"`
}
type Update struct {
	UpdateID int            `json:"update_id"`
	Message  *Message       `json:"message"`
	Callback *CallbackQuery `json:"callback_query"`
}
type Button struct {
	Text string `json:"text"`
	Data string `json:"callback_data"`
}

func (c *Client) GetMe(ctx context.Context) (User, error)
// GetUpdates long-polls: timeout is seconds, allowed_updates is ["message","callback_query"].
func (c *Client) GetUpdates(ctx context.Context, offset, timeout int) ([]Update, error)
func (c *Client) SendMessage(ctx context.Context, chatID int64, text string, kb [][]Button) (int, error)
// EditMessage replaces the text; a nil kb removes the keyboard.
func (c *Client) EditMessage(ctx context.Context, chatID int64, msgID int, text string, kb [][]Button) error
func (c *Client) AnswerCallback(ctx context.Context, id, text string) error
```

Each method POSTs JSON to `<Base>/bot<Token>/<method>` and decodes `{"ok":bool,"result":...,"error_code":int,"description":string}`;
`ok: false` → `*APIError`. Text is sent plain (no `parse_mode`). `reply_markup` is `{"inline_keyboard": kb}` and is
omitted when `kb` is nil on send; on edit a nil `kb` sends `{"inline_keyboard": []}` so the buttons go away.
`HTTP` defaults to a client with a 70 s timeout (above the 50 s long poll).

Every error that leaves the package goes through `redact(err, token)`, which replaces the token with `<token>`:
`net/http` errors quote the URL, and the URL holds the token.

**Tests (`api_test.go`, an `httptest.Server` that records requests):**

- `TestSendMessageSendsKeyboardAndReturnsID` — path is `/botTKN/sendMessage`, body has `chat_id`, `text`,
  `reply_markup.inline_keyboard[0][0].callback_data`; returns the `message_id` from the fake.
- `TestEditMessageNilKeyboardClearsButtons` — body has `"inline_keyboard":[]`.
- `TestAPIErrorCarriesCode` — fake returns `{"ok":false,"error_code":409,"description":"Conflict"}` →
  `errors.As(err, &apiErr)` with `Code == 409`.
- `TestErrorsNeverContainToken` — point `Base` at a closed server; `err.Error()` does not contain the token.
- `TestGetUpdatesPassesOffsetAndTimeout`.

Run: `go test ./pkg/telebot -run 'TestSend|TestEdit|TestAPIError|TestErrors|TestGetUpdates'` → PASS.

Commit: `feat(telebot): Bot API client`.

---

### Task 2: Ask state — what to send, what a tap or reply means

**Depends on:** Task 1

**Files:** `pkg/telebot/state.go`, `pkg/telebot/state_test.go`, `pkg/telebot/pair.go`, `pkg/telebot/pair_test.go`

Pure logic, no network, no clock (time is passed in). It uses Task 1's `Button`.

```go
// GraceMs is how long an ask waits before it is sent: the Gatekeeper answers most it can within a few seconds, and
// those should never reach the phone.
const GraceMs = 8000

// askMsg is one ask being answered in Telegram: its questions go out one message at a time, and the answers are
// delivered together after the last, as the cockpit's panel does.
type askMsg struct {
	n         int // short id in callback data (Telegram caps it at 64 bytes)
	oref      string
	askID     string
	prose     bool
	questions []baseds.AgentAskQuestion
	q         int // the question now on screen
	answers   []baseds.AgentAnswerItem
	picks     map[int]bool // multi-select toggles of question q
	msgIDs    []int        // one per question sent, in order
}

type tracker struct {
	next  int
	byAsk map[string]*askMsg // askID
	byN   map[int]*askMsg
	byMsg map[int]*askMsg // Telegram message id → ask
	closed map[int]bool   // message ids of forgotten asks, so a reply to one gets "Already answered."; capped at 1000
}

func newTracker() *tracker

// due returns the pending asks to send now, oldest first: not owned by a dag lead, pending at least GraceMs, with
// at least one question, and not already tracked.
func (t *tracker) due(pending map[string]agentask.PendingAsk, now int64) []dueAsk // dueAsk{Oref string; agentask.PendingAsk}

// gone returns tracked asks no longer pending under the same AskId (answered elsewhere, replaced, or the agent moved
// on), and forgets them.
func (t *tracker) gone(pending map[string]agentask.PendingAsk) []*askMsg

// track starts tracking a due ask and returns it; the caller sends questionText/keyboard and records the message id
// with sent(a, msgID).
func (t *tracker) track(d dueAsk) *askMsg
func (t *tracker) sent(a *askMsg, msgID int)
// forget drops the ask and moves its message ids into closed.
func (t *tracker) forget(a *askMsg)

// questionText is the message body for question q: "🤖 <who>\n<header>\n<question>\n\nReply to this message to answer
// in your own words." Whitespace runs collapse, and the question is capped at 1000 runes with "…".
func questionText(who string, q baseds.AgentAskQuestion) string

// keyboard is one button per option, label capped at 40 runes. Callback data: "a:<n>:<q>:<o>" picks option o;
// a multi-select question shows "☐ label"/"☑ label" toggles "t:<n>:<q>:<o>" and a last row "Send" "s:<n>:<q>".
func keyboard(a *askMsg) [][]Button

// step is what one tap or reply did.
type step struct {
	Toast   string   // answerCallbackQuery text; "" for none
	Edit    string   // new text for the message tapped/replied to; "" leaves it
	Reply   string   // a message the bot sends to the chat; "" for none
	Rekey   bool     // re-render the keyboard (a toggle)
	Next    bool     // send question a.q (already advanced)
	Deliver bool     // all questions answered: deliver a.answers
}

// onCallback applies a tap. Unknown n (answered, restarted) → nil ask, Toast "Already answered", Edit "✓ Answered in
// arcterm" (the caller edits the tapped message, cb.Message, since there is no ask).
// A tap on an earlier question → Toast "Answer the latest question". "a": the item is SelectedIndexes [o], or for a
// prose ask Text = option label; Edit "✓ <label>". "t": flips picks[o], Rekey. "s" with no picks → Toast "Pick at
// least one"; else SelectedIndexes sorted (prose: Text = labels joined ", "), Edit "✓ <labels>".
func (t *tracker) onCallback(data string) (*askMsg, step)

// onReply applies a text reply to message replyTo. A message of a forgotten ask (in closed) → Reply "Already
// answered.". An earlier question of a live ask → Reply "Answer the latest question.". Not one of ours → Reply
// FixedReply. The current question → Text = trimmed text, Edit `✓ "<text>"`.
func (t *tracker) onReply(replyTo int, text string) (*askMsg, step)

// FixedReply answers a paired chat's message that is neither /start nor a reply to a question message.
const FixedReply = "I only answer agent questions. Reply to a question message to answer it."
```

After an answer, `a.q++`; `Next` when `a.q < len(questions)`, else `Deliver`. A step with `Deliver` has already
forgotten the ask (under the tracker, before it returns), so the reconcile loop never sees it as gone and never
overwrites its `✓ <label>` with "✓ Answered in arcterm"; a delivery error is reported by the caller, which keeps the
ask's last message id from the step.

`pair.go`:

```go
// Pairer holds the one pairing code in play. A code lasts PairTTL and is used once.
const PairTTL = 10 * time.Minute

type Pairer struct {
	code    string
	expires time.Time
}

func (p *Pairer) New(now time.Time) (code string, expires time.Time) // 6 digits from crypto/rand
func (p *Pairer) Pending(now time.Time) (string, time.Time)        // "" when none or expired
// Match reports whether text is "/start <code>" for the live code, and clears the code when it is.
func (p *Pairer) Match(text string, now time.Time) bool
```

**Tests (`state_test.go`, `pair_test.go`):**

- `TestDueSkipsLeadOwnedGraceAndTracked` — a lead-owned ask, an ask 3 s old, a tracked ask, an ask with no questions
  are all skipped; an 8 s old user ask is returned.
- `TestGoneOnAnswerElsewhereAndReplace` — oref missing → gone; same oref, new AskId → gone; both forgotten.
- `TestTapSingleSelectDelivers` — one question, tap `a:<n>:0:1` → `SelectedIndexes [1]`, `Deliver`, Edit `✓ <label>`.
- `TestProseTapDeliversLabelAsText`.
- `TestMultiSelectToggleThenSend` — toggles 2 then 0, Send → `SelectedIndexes [0 2]`; Send with none → Toast.
- `TestMultiQuestionAdvances` — two questions: first tap → `Next` with `a.q == 1`, no Deliver; second → Deliver with
  two items.
- `TestReplyOnlyToCurrentQuestion` — reply to question 0's message after it advanced → Reply "Answer the latest
  question."; reply to the current one → `Text`; reply to a message id never sent → Reply `FixedReply`.
- `TestReplyToForgottenAsk` — after `forget`, a reply to one of its messages → Reply "Already answered.".
- `TestDeliverForgetsAsk` — the step that delivers leaves the ask untracked: `gone` on a pending map without it
  returns nothing.
- `TestStaleCallback` — unknown n → nil ask, Toast "Already answered", Edit "✓ Answered in arcterm".
- `TestKeyboardCallbackDataUnder64Bytes` — n=999999, q=9, o=99.
- `TestQuestionTextCollapsesAndCaps`.
- `TestPairMatchOnceAndExpires` — wrong code false; right code true then false; past `PairTTL` false.

Run: `go test ./pkg/telebot -run 'TestDue|TestGone|TestTap|TestProse|TestMulti|TestReply|TestDeliver|TestStale|TestKeyboard|TestQuestion|TestPair'` → PASS.

Commit: `feat(telebot): ask tracking, answers and pairing`.

---

### Task 3: Bot runtime

**Depends on:** Task 1, Task 2

**Files:** `pkg/telebot/bot.go`, `pkg/telebot/bot_test.go`

```go
// TokenSecretName is the secret-store name of the bot token; the Settings row sets it with SetSecretsCommand.
const TokenSecretName = "telegram_bottoken"

// Deps is everything the bot takes from wavesrv, as funcs so the test drives it with fakes.
type Deps struct {
	Pending  func(ctx context.Context) map[string]agentask.PendingAsk // live, non-dead asks
	Deliver  func(oref, askID string, answers []baseds.AgentAnswerItem) (bool, error)
	Who      func(ctx context.Context, oref string) string // "api-refactor · arcterm", or "agent"
	Settings func() Settings                                // Enabled, ChatID (int64, 0 = unpaired)
	Token    func() string                                  // "" = none stored
	SavePair func(chatID int64, chatName string) error
	APIBase  string // "" = defaultAPIBase; a fake Bot API in tests and the CDP scenario
	Tick     time.Duration // 2 s in production
}

type Settings struct {
	Enabled bool
	ChatID  int64
}

type Status struct {
	Enabled         bool   `json:"enabled"`
	HasToken        bool   `json:"hastoken"`
	Polling         bool   `json:"polling"`
	BotName         string `json:"botname,omitempty"`
	PairCode        string `json:"paircode,omitempty"`
	PairCodeExpires int64  `json:"paircodeexpires,omitempty"`
	LastError       string `json:"lasterror,omitempty"`
}

var Default *Bot

func New(d Deps) *Bot
func (b *Bot) Run(ctx context.Context) // returns when ctx ends
func (b *Bot) Poke()                   // config or token changed: re-read and (re)start or stop the loops
func (b *Bot) Status() Status
func (b *Bot) Pair() (code string, expires time.Time)
```

`Run` waits on a poke channel. On each poke it reads `Settings()` and `Token()`; if off or no token it cancels the
running session and records why. If the token changed (or nothing runs) it cancels the old session and starts a new
one: `GetMe` (401 → `LastError = "Token rejected by Telegram"`, stay stopped until the next poke), then
`GetUpdates(offset=-1, timeout=0)` once to drop the backlog (it returns the last update; polling starts at its
`update_id + 1`, or 0 when it returns none), then two goroutines under the session context:

- **poll:** `GetUpdates(offset, 50)` in a loop; each update goes to `handle` and moves `offset` past it. Errors back
  off 1 s doubling to 60 s; 409 → `LastError = "Another app is polling this bot"` and keep backing off; 401 →
  `LastError = "Token rejected by Telegram"`, `Polling = false`, and the session ends until the next poke (as a 401 on
  `GetMe` does).
- **reconcile:** every `Tick`, only when paired: `gone` → `EditMessage(…, "✓ Answered in arcterm", nil)` on each of the
  ask's messages; `due` → `track`, `SendMessage(questionText(Who(oref), q0), keyboard)`, `sent`.

`handle`:

- message `/start <code>` that `Pairer.Match`es → `SavePair(chat.ID, chatName(chat))`, reply "Paired. Agent questions
  will arrive here." (`chatName`: title, else @username, else first name).
- any update from a chat other than `Settings().ChatID` → ignored, no reply.
- callback → `onCallback`, then `AnswerCallback(Toast)`, apply `Edit` (to `cb.Message` when the ask is nil, a stale
  tap) and `Rekey`, `Next` → send the next question, `Deliver` → `Deliver(oref, askID, answers)`; an error edits the
  last message to "Could not answer — open arcterm". Tracker access is under one mutex shared with reconcile; network
  calls happen outside it.
- reply message → `onReply`; send its `Reply` when set, apply `Edit`, `Next`, `Deliver` as for a callback.
- any other message from the paired chat (not `/start`, not a reply) → send `FixedReply`.

`LastError` clears on the next successful call.

**Tests (`bot_test.go`):** a fake Bot API (`httptest`) that queues updates for `getUpdates` and records every
send/edit/answerCallback; `Deps` with an in-memory pending map and a recording `Deliver`; `Tick` 10 ms; drive with
`Run` in a goroutine and poll the recorder with a 2 s deadline.

- `TestSendsDueAskAfterGrace` — an ask with `Ts` 9 s ago is sent once, with the keyboard; one 1 s old is not.
- `TestTapDeliversAndEdits` — queue a callback for it → `Deliver` called with `(oref, askID, [{SelectedIndexes:[0]}])`,
  message edited to `✓ <label>`.
- `TestAnsweredInAppEditsMessage` — remove the ask from the pending map → edited to "✓ Answered in arcterm".
- `TestOtherChatIgnored` — a callback from another chat id → no `Deliver`, no reply.
- `TestPairingSavesChat` — `Pair()`, queue `/start <code>` from chat 42 → `SavePair(42, …)` and the reply.
- `TestUnauthorizedStops` — fake answers `getMe` with 401 → `Status().LastError == "Token rejected by Telegram"`,
  `Polling == false`.
- `TestUnauthorizedOnUpdatesStops` — `getMe` ok, then `getUpdates` 401 → same status, and no further `getUpdates`
  reaches the fake within 300 ms.
- `TestConflictReportsAnotherApp` — `getUpdates` 409 → `LastError == "Another app is polling this bot"`.
- `TestBacklogDroppedFirst` — the fake holds update 7 (a callback) before start: the first `getUpdates` has
  `offset=-1`, the next `offset=8`, and update 7 is never handled (no `answerCallbackQuery`).
- `TestNonReplyGetsFixedLine` — a plain message from the paired chat → `sendMessage` with `FixedReply`.
- `TestDeliveredAskNotEditedAsGone` — tap delivers, then the ask leaves the pending map → the message's last edit is
  still `✓ <label>`, never "✓ Answered in arcterm".
- `TestStaleTapEditsTappedMessage` — a callback with an unknown n → `answerCallbackQuery` "Already answered" and
  `editMessageText` on the callback's message id.
- `TestDeliverErrorEdits`.
- `TestOffOrNoTokenDoesNothing` — no request reaches the fake.

Run: `go test ./pkg/telebot` → PASS. (No `-race`: the repo builds with `CGO_ENABLED=0` and has no gcc.)

Commit: `feat(telebot): long-poll runtime that sends asks and delivers answers`.

---

### Task 4: Settings, RPC and wavesrv wiring

**Depends on:** Task 3

**Files:** `pkg/wconfig/settingsconfig.go`, `pkg/wshrpc/wshrpctypes_telegram.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_telegram.go`, `pkg/wshrpc/wshserver/wshserver_telegram_test.go`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_askprune_test.go`, `cmd/server/main-server.go`, `pkg/wshrpc/wshserver/wshserver_secrets.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `pkg/wconfig/metaconsts.go`, `pkg/wconfig/vaultlayer.go`, `pkg/wconfig/vaultlayer_test.go`, `schema/settings.json`

1. Settings (`SettingsType`, beside the `notify:*` fields at `settingsconfig.go:51`):

   ```go
   TelegramEnabled  *bool  `json:"telegram:enabled,omitempty"`  // send pending asks to the paired Telegram chat; unset is off
   TelegramChatID   string `json:"telegram:chatid,omitempty"`   // the paired chat's id, as a string (it can pass 2^53)
   TelegramChatName string `json:"telegram:chatname,omitempty"` // shown in Settings
   ```

2. `pkg/wshrpc/wshrpctypes_telegram.go`:

   ```go
   type TelegramCommands interface {
   	TelegramStatusCommand(ctx context.Context) (TelegramStatusData, error)
   	TelegramPairCommand(ctx context.Context) (TelegramPairData, error)
   	TelegramUnpairCommand(ctx context.Context) error
   }
   type TelegramStatusData struct { // mirrors telebot.Status plus the paired chat's name
   	Enabled         bool   `json:"enabled"`
   	HasToken        bool   `json:"hastoken"`
   	Polling         bool   `json:"polling"`
   	BotName         string `json:"botname,omitempty"`
   	ChatName        string `json:"chatname,omitempty"`
   	PairCode        string `json:"paircode,omitempty"`
   	PairCodeExpires int64  `json:"paircodeexpires,omitempty"`
   	LastError       string `json:"lasterror,omitempty"`
   }
   type TelegramPairData struct {
   	Code    string `json:"code"`
   	Expires int64  `json:"expires"`
   }
   ```

   Add `TelegramCommands` to `WshRpcInterface` (`wshrpctypes.go:34`).

3. `wshserver_telegram.go`: the three handlers over `telebot.Default` (nil → status `{}` / error "telegram is not
   running"). Unpair writes `unpairSettings()` with `wconfig.SetBaseConfigValue`, where `unpairSettings()` is a pure
   func returning `waveobj.MetaMapType{"telegram:chatid": nil, "telegram:chatname": nil}`. Use Task 3's
   `telebot.TokenSecretName`.

4. Export `livePendingAsks` as `LivePendingAsks` in `pkg/jarvis/attention.go` and update both callers:
   `attention.go:914` and `pkg/jarvis/attention_askprune_test.go:49,51`.

5. `cmd/server/main-server.go`: `startTelebot()` next to `startJobQueue()` (line ~385):

   ```go
   func startTelebot() {
   	telebot.Default = telebot.New(telebot.Deps{
   		Pending: func(ctx context.Context) map[string]agentask.PendingAsk {
   			p, err := jarvis.LivePendingAsks(ctx)
   			if err != nil {
   				return nil
   			}
   			return p
   		},
   		Deliver: agentask.DeliverAnswer,
   		Who: func(ctx context.Context, oref string) string {
   			ch, _, source := jarvis.ResolveAskOwner(ctx, jarvis.ChannelOwnerORef(ctx, oref))
   			if source == "" { // a standalone agent: no channel dispatched it
   				source = "agent"
   			}
   			if ch != nil && ch.Name != "" {
   				return source + " · " + ch.Name
   			}
   			return source
   		},
   		Settings: func() telebot.Settings {
   			s := wconfig.GetWatcher().GetFullConfig().Settings
   			id, _ := strconv.ParseInt(s.TelegramChatID, 10, 64)
   			return telebot.Settings{Enabled: s.TelegramEnabled != nil && *s.TelegramEnabled, ChatID: id}
   		},
   		Token: func() string {
   			v, ok, err := secretstore.GetSecret(telebot.TokenSecretName)
   			if err != nil || !ok {
   				return ""
   			}
   			return v
   		},
   		SavePair: func(chatID int64, name string) error {
   			return wconfig.SetBaseConfigValue(waveobj.MetaMapType{
   				"telegram:chatid": strconv.FormatInt(chatID, 10), "telegram:chatname": name,
   			})
   		},
   		APIBase: devTelegramAPIBase(),
   		Tick:    2 * time.Second,
   	})
   	go func() {
   		defer func() { panichandler.PanicHandler("telebot.Run", recover()) }()
   		telebot.Default.Run(context.Background())
   	}()
   	telebot.Default.Poke()
   }
   ```

   `devTelegramAPIBase()` returns `os.Getenv("ARC_TELEGRAM_API_BASE")` when `wavebase.NoGlobalInstall()`, else `""`: the CDP
   scenario points a dev app at a fake Bot API; a packaged build never reads it. Log once when it is set.

   Call `telebot.Default.Poke()` in `wconfig.ConfigHook` (line ~393). A token set through `SetSecretsCommand` does not
   fire the config hook: in `wshserver_secrets.go`'s `SetSecretsCommand`, poke `telebot.Default` when the map has
   `telebot.TokenSecretName`.

6. `task generate`. It also rewrites `schema/settings.json` with the three `telegram:*` keys; commit it.

7. Machine-local: add `ConfigKey_TelegramEnabled`, `ConfigKey_TelegramChatID` and `ConfigKey_TelegramChatName` to
   `machineLocalKeys` in `pkg/wconfig/vaultlayer.go`, with a comment that the token they go with lives only in this
   machine's secretstore (as `claude:activeaccount`'s does): otherwise a second machine syncing the vault inherits
   enabled + chatid and polls the same bot (a 409 loop). `TestVaultLayerIgnoresMachineLocalKeys` asserts
   `IsMachineLocalKey` for the three.

**Tests (`wshserver_telegram_test.go`):** `TestTelegramStatusWithoutBot` (nil Default → zero status, no panic);
`TestTelegramUnpairClearsSettings` (`unpairSettings()` has exactly the keys `telegram:chatid` and `telegram:chatname`,
both nil).

Run: `go test ./pkg/wshrpc/wshserver -run Telegram`, `go test ./pkg/wconfig -run TestSettingsKeysInSync`,
`go test ./pkg/jarvis -run LivePendingAsks`, `go build ./cmd/server/... ./cmd/wsh/...` → PASS.

Commit: `feat(telebot): settings, RPC and wavesrv wiring`.

---

### Task 5: Settings row, docs and changelog

**Depends on:** Task 4

**Files:** `frontend/app/view/agents/telegrammodel.ts`, `frontend/app/view/agents/telegrammodel.test.ts`, `frontend/app/view/agents/telegramrow.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/view/agents/settingspages/general.tsx`, `scripts/cdp/scenarios.mjs`, `docs/guide/settings.md`, `CHANGELOG.md`, `docs/open-issues.md`

1. `settingsmodel.ts`: add a row after `notifications.reply`:

   ```ts
   {
       id: "notifications.telegram",
       title: "Telegram",
       desc: "Send an agent's question to your Telegram and answer it there: tap an option or reply in your own words.",
   },
   ```

   (no `key`: the row draws its own control; copy how another key-less row is declared in this file, e.g. one with a
   custom card.) In `settingsmodel.test.ts`, append `"notifications.telegram"` to the `general/notifications` card's
   expected rows (~l.315) and raise the total in "keeps every row exactly once" from 54 to 55 (~l.376).

2. `telegrammodel.ts` (pure) + test:

   ```ts
   export type TelegramView =
       | { kind: "no-token" }
       | { kind: "off" }
       | { kind: "error"; text: string }
       | { kind: "connecting" }
       | { kind: "pairing"; code: string; minutesLeft: number; bot: string }
       | { kind: "unpaired"; bot: string }
       | { kind: "paired"; chat: string; bot: string };

   export function telegramView(s: TelegramStatusData | null, now: number): TelegramView;
   ```

   Order: no token → `no-token`; not enabled → `off`; `lasterror` → `error`; not polling → `connecting`; a pair code
   not expired → `pairing`; a chat name → `paired`; else `unpaired`. Tests cover each branch and the expiry.

3. `telegramrow.tsx`: inside `<SettingRow id="notifications.telegram">` — a `SecretInput` ("Bot token from @BotFather")
   that calls `RpcApi.SetSecretsCommand(TabRpcClient, { telegram_bottoken: v })`, a `Toggle` writing
   `telegram:enabled`, and the status line from `telegramView`: `pairing` shows the code large in mono with "Send
   /start <code> to @<bot> in Telegram"; `unpaired` shows a **Pair** button (`TelegramPairCommand`); `paired` shows
   "Paired with <chat>" and **Unpair** (`TelegramUnpairCommand`); a "Remove token" link sets the secret to `null`. Poll
   `TelegramStatusCommand` every 2 s while mounted (`useEffect` interval). Colors and type from DESIGN.md tokens only.
   Add `<TelegramRow />` at the end of `NotificationRows` in `settingspages/general.tsx`.

4. CDP scenario `settings-telegram` in `scripts/cdp/scenarios.mjs` (copy `settings-keepawake`'s shape: numbered `rec`
   steps, a shot per step; find the row by the attribute `SettingRow` actually renders, e.g.
   `[data-setting-row="notifications.telegram"]`). It runs a fake Bot API with `node:http` on `127.0.0.1:18765` (a
   constant, matching the Final line's `ARC_TELEGRAM_API_BASE`), started in `arrange` and closed in teardown. The fake
   answers `/bot<token>/<method>`: `getMe` → `{id, username: "arc_test_bot"}`, held until the scenario releases it;
   `getUpdates` → the queued updates, or `[]` after up to 1 s; `sendMessage` / `editMessageText` /
   `answerCallbackQuery` → ok, recorded; a switch makes every call answer 401. `arrange` saves the person's
   `telegram:enabled`, `telegram:chatid`, `telegram:chatname`, and fails (rather than overwrite) when
   `TelegramStatusCommand` says a token is already stored. Steps, each asserting the row's text and shooting
   `cdp-shots/settings-telegram-<n>.png` with the row scrolled into view:
   1. Settings → General, the row shows the token field and the no-token status.
   2. Type a token (`Input.insertText`) into the row's `SecretInput` and save → the status reads off, and
      `TelegramStatusCommand` has `hastoken: true`.
   3. Click the switch → `telegram:enabled` is stored true (poll `getfullconfig` as settings-keepawake does) and the
      status reads connecting while the fake holds `getMe`. If the fake sees no `getMe` within 10 s, fail with "the dev
      app was not started with ARC_TELEGRAM_API_BASE=http://127.0.0.1:18765".
   4. Release `getMe` → unpaired, with the Pair button.
   5. Click Pair → the code shows large, with "Send /start <code> to @arc_test_bot".
   6. Queue a `/start <code>` message from chat 4242 named "Verify chat" → "Paired with Verify chat", the fake recorded
      the "Paired." reply, and `telegram:chatid` is stored `"4242"`.
   7. Click Unpair → unpaired, and `telegram:chatid` / `telegram:chatname` are cleared.
   8. Switch the fake to 401 → "Token rejected by Telegram".
   9. Click Remove token → the no-token status, `hastoken: false`.
   Teardown deletes the secret (`setsecrets` with `null`), restores the three settings, and closes the fake.

   Task 5's acceptance is these nine steps passing with their shots; a real bot stays a hand check (item 7 below).

5. `docs/guide/settings.md`: a "Telegram" subsection under Notifications: the @BotFather steps, Pair, what is sent
   (question text only), what it cannot do (no prompts, no starting or stopping), Unpair.

6. `CHANGELOG.md`: open a new `## Unreleased` with `### Added` above `## 0.15.14 — 2026-10-16` (that release already
   has 5 big lines, the most `whatsnew.test.ts` allows), and add:
   `- Answer an agent's question from Telegram: pair a bot in Settings → General → Notifications, then tap an option or reply in your own words. <!-- big -->`

7. `docs/open-issues.md`: under "0 · Waiting on a hand check" add
   `- [ ] (arcterm) Telegram asks: pair a real bot, answer by button, by reply, and in the app (message edits)`;
   under "RAM watch" add `- (arcterm) telebot: one long-poll goroutine + 2 s ticker; measure wavesrv RSS on/off`.

Run: `npx vitest run frontend/app/view/agents/telegrammodel.test.ts frontend/app/view/agents/settingsmodel.test.ts frontend/app/cockpit/whatsnew.test.ts`
→ PASS; `task check:ts` (allow 4 min) → exit 0;
`npx eslint frontend/app/view/agents/telegram*.ts*` and `npx prettier --check` on the touched frontend files.

Commit: `feat(settings): Telegram row for answering asks from your phone`.
