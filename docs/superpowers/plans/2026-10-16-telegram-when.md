# Telegram connects only when allowed and needed — implementation plan

**Verify:** `node scripts/verify.mjs ./pkg/telebot ./pkg/wconfig ./pkg/wshrpc/... ./cmd/server/...`

**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs settings-telegram`

**Goal:** the Telegram bot stops long-polling `api.telegram.org` around the clock. It may connect only inside a time
the person allowed (manual "on for", a schedule with an office-hours preset, or always), and inside that time only
while a question is open or a pairing code is live.

**Spec:** `docs/superpowers/specs/2026-10-16-telegram-asks-design.md`, section "When it connects". Effort
`98752683-b111-4834-a78b-3af712f5660e`, stage `when`.

**Architecture:** a pure `pkg/telebot/allowed.go` answers "may it connect at t, until when, and when next". `bot.go`'s
`Run` gains a 2 s supervisor tick that reads the local ask registry and that answer, and starts or stops the session;
the tracker moves from the session to the bot so a reconnect keeps it. Three new settings and five new status fields
feed a reworked Settings row.

**Facts (checked 2026-10-16):**

- `Bot.Run` (`pkg/telebot/bot.go:209`) today starts a session on any poke while `Enabled` and a token are set, and the
  session (`bot.go:258`) does getMe, `GetUpdates(-1, 0)`, then `poll` + `reconcileLoop` until cancelled. The tracker is
  `session.tr` (`bot.go:195`), rebuilt per session by `newSessionTracker` (`bot.go:252`).
- `session.reconcile` (`bot.go:366`) computes `gone` and `due` from `Deps.Pending` and sends / edits.
- `tracker.due` applies `GraceMs` and skips lead-owned asks (`pkg/telebot/state.go:87-100`).
- `Deps.Settings() Settings{Enabled, ChatID}` is built in `cmd/server/main-server.go` (`startTelebot`) from
  `wconfig…Settings.TelegramEnabled/TelegramChatID` (`pkg/wconfig/settingsconfig.go:53-55`).
- Status: `telebot.Status` (`bot.go:64`) mirrored by `wshrpc.TelegramStatusData` (`pkg/wshrpc/wshrpctypes_telegram.go`);
  the row's pure model is `frontend/app/view/agents/telegrammodel.ts`, drawn by `telegramrow.tsx`; the CDP scenario
  is `settings-telegram` in `scripts/cdp/scenarios.mjs` (fake Bot API on :18765, `gotoShot: false`).

---

### Task 1: Allowed-time model

**Depends on:** none

**Files:** `pkg/telebot/allowed.go`, `pkg/telebot/allowed_test.go`

```go
const (
	ModeManual   = "manual" // "" reads as this
	ModeSchedule = "schedule"
	ModeAlways   = "always"
	// OfficeHours is the schedule an unset telegram:schedule reads as.
	OfficeHours = "mon,tue,wed,thu,fri 08:00-17:30"
)

// Schedule is a weekly window in local time. End <= Start runs past midnight; Days name the day a window starts.
type Schedule struct {
	Days       [7]bool // indexed by time.Weekday
	Start, End int     // minutes after midnight
}

// ParseSchedule reads "<days> <HH:MM>-<HH:MM>"; days a comma list of mon…sun, case-insensitive. "" → OfficeHours.
func ParseSchedule(s string) (Schedule, error)
func (s Schedule) String() string

type When struct {
	Enabled  bool
	Mode     string
	Schedule Schedule
	OnUntil  time.Time // zero = none
}

// Allowed reports whether the bot may connect at now; until is when that ends (zero = no end: always, or a schedule
// with every day and a 24 h window), next is when it starts again (zero = nothing will start it). Exactly one of
// until/next is meaningful. A live OnUntil allows in every mode; until is then the later of OnUntil and the schedule
// window's end when both hold.
func (w When) Allowed(now time.Time) (allowed bool, until, next time.Time)
```

`Allowed` scans window starts and ends from the day before `now` through 8 days ahead (a wrapping window that started
yesterday covers early this morning), in `now`'s location. Daylight-saving days use wall-clock times
(`time.Date(...)`), which is what the person means by "08:00".

**Tests:** parse office hours; parse `"sat,sun 00:00-00:00"` (a full day: End == Start means 24 h); a bad string
errors; `""` → office hours. `Allowed`: Wed 10:00 inside office hours → until Wed 17:30; Wed 18:00 → next Thu 08:00;
Fri 18:00 → next Mon 08:00; wrap `"mon,tue,wed,thu,fri 17:30-08:00"`: Tue 07:00 allowed (Monday's window), Sat 07:00
allowed (Friday's), Sat 09:00 not, next Mon 17:30; manual with OnUntil 2 h ahead → allowed until it; manual with none →
not allowed, next zero; always → allowed, until zero; disabled → not allowed in every mode, next zero; schedule outside
the window with a live OnUntil → allowed until OnUntil.

Run: `go test ./pkg/telebot -run 'TestParseSchedule|TestAllowed'` → PASS.

Commit: `feat(telebot): allowed-time model for when Telegram may connect`.

---

### Task 2: On-demand session, settings and status

**Depends on:** Task 1

**Files:** `pkg/telebot/bot.go`, `pkg/telebot/bot_test.go`, `pkg/telebot/state.go`, `pkg/wconfig/settingsconfig.go`, `pkg/wshrpc/wshrpctypes_telegram.go`, `pkg/wshrpc/wshserver/wshserver_telegram.go`, `cmd/server/main-server.go`, `schema/settings.json`, `frontend/types/gotypes.d.ts`, `pkg/wconfig/metaconsts.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`

1. **Settings** beside `TelegramChatName` (`settingsconfig.go:55`):

   ```go
   TelegramMode     string `json:"telegram:mode,omitempty"`     // when the bot may connect: "manual" (unset), "schedule", "always"
   TelegramSchedule string `json:"telegram:schedule,omitempty"` // "<days> <HH:MM>-<HH:MM>", local time; unset is office hours
   TelegramOnUntil  *int64 `json:"telegram:onuntil,omitempty"`  // manual "on for" ends at this UnixMilli; 0 or past is off
   ```

   `telebot.Settings` gains `When When`; `startTelebot` fills it (a schedule that does not parse logs once and reads as
   office hours). Add the keys to `schema/settings.json` the way the other `telegram:*` keys are.

2. **Tracker on the bot.** Move `tr` (and its `mu`, and `chat`) from `session` to `Bot`; `newSessionTracker` runs once
   in `New` and again only when the paired chat changes. The session reads and writes the bot's tracker under the
   bot's mutex.

3. **Supervisor.** `Run` keeps its poke handling for token and enable changes and adds a ticker (`Deps.Tick`). On each
   tick and poke it computes, with no network:

   - `allowed, until, next := set.When.Allowed(now)`
   - `pairing` := a live pair code (`b.pair.Pending(now)`) — a live code counts as allowed: the person just pressed
     Pair.
   - `need` := `pairing` || the tracker has an open ask || `tr.due(pending, now)` would return one (add a
     `tr.hasDue(pending, now) bool` to `state.go` that does not track).
   - want a session ⇔ token set && enabled && (`allowed` || `pairing`) && `need`.

   No session wanted while one runs: stop it once `need` has been false for `idleLinger` (30 s, a var so tests shrink it);
   stop it at once when it is no longer allowed. Session wanted while none runs: start one (as today). `reconcile` moves
   from the session's own loop to this tick and runs only while a session is up; the session keeps `poll`.

4. **Validate once.** When a poke finds a new token, or `Enabled` turning on, and no session is wanted, run one
   `GetMe` (no polling) to set `BotName` or `LastError`, then nothing more.

5. **Allowed time ends** with asks open (allowed false, not pairing, tracker non-empty): edit each open ask's open
   question message to `— Telegram is off until <next>` (`Mon 08:00`, local, `Mon 15:04` layout) or
   `— Telegram is off; answer in arcterm` when `next` is zero; forget them; stop the session.

6. **Status** gains `Allowed bool`, `AllowedUntil int64`, `NextAllowed int64` (UnixMilli, 0 = none), `Connected bool`
   (the session is up and polling; keep `Polling` as an alias set to the same value for one release, or rename it
   everywhere it is read — the frontend reads it in `telegrammodel.ts`), `Open int` (asks tracked). Mirror them in
   `wshrpc.TelegramStatusData` and the handler, then `task generate`.

**Tests (`bot_test.go`, the existing rig):**

- `TestIdleWithoutQuestionsMakesNoRequests` — enabled, paired, mode always, no asks: after 10 ticks the fake saw one
  getMe (the validation) and no getUpdates.
- `TestQuestionConnectsThenDisconnects` — an ask past grace → getMe + getUpdates + sendMessage; remove the ask → edit,
  then after `idleLinger` no further getUpdates and `Status().Connected == false`.
- `TestNotAllowedNeverConnects` — mode manual, no OnUntil, an ask waiting: no getUpdates, no send.
- `TestManualOnUntilAllowsThenEnds` — OnUntil 300 ms ahead, an ask → sent; after it passes the message is edited to
  `— Telegram is off; answer in arcterm` and the session stops.
- `TestScheduleEndEditsWithNextStart` — a `When` whose window ends between ticks: edit text names the next start.
- `TestPairCodeConnectsOutsideAllowedTime` — mode manual, none: `Pair()` → getUpdates runs; `/start <code>` pairs.
- `TestReconnectDoesNotResend` — ask sent; the fake fails getUpdates a few times so the session restarts; the ask is
  still pending and tracked: no second sendMessage for it, and a tap on the first message still delivers.
- Existing tests keep passing; set `When{Enabled: true, Mode: ModeAlways}` in the rig's default settings where they
  assume an always-on bot.

Run: `go test ./pkg/telebot`, `go build ./cmd/server/... ./cmd/wsh/...` → PASS.

Commit: `feat(telebot): connect only while a question is open, inside the allowed time`.

---

### Task 3: Settings row for when, and the scenario

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/telegrammodel.ts`, `frontend/app/view/agents/telegrammodel.test.ts`, `frontend/app/view/agents/telegramrow.tsx`, `scripts/cdp/scenarios.mjs`, `docs/guide/settings.md`, `CHANGELOG.md`

1. **Model.** `telegramView` replaces `connecting`-when-not-polling (idle is now normal) with:
   - `asleep` — enabled, paired, not allowed: text `Off until <Mon 08:00>` or `Off — turn it on for a while` (no next).
   - `idle` — allowed, paired, not connected: `Paired with <chat> · connects only when an agent asks`, plus
     `· on until 15:40` when `alloweduntil` is set.
   - `connected` — `Connected · <n> question(s) open`.
   - `connecting` stays for a session starting (status says not connected while `open > 0` or a pair code is live).
   Add `formatWhen(ms, now)`: `15:40` today, `Mon 08:00` within a week, else a date. Pure; tests for every kind and
   for `formatWhen`.
   Add `parseSchedule`/`formatSchedule` mirrors of the Go format for the editor (days set + `HH:MM` pair), with tests
   that round-trip `OFFICE_HOURS = "mon,tue,wed,thu,fri 08:00-17:30"` and a wrapping window.

2. **Row** (`telegramrow.tsx`), under the existing token field and switch, shown when a token is stored:
   - A segmented control **Manual · Schedule · Always** writing `telegram:mode` (`writeConfig`).
   - **On for** buttons `1h` `2h` `4h` and a small number input (hours, 0.25–24) with **Start**, each writing
     `telegram:onuntil: Date.now() + h*3600000`; while it is live, `On until 15:40` and **Turn off now** (writes `null`).
     Shown in every mode (in Always it reads "already on" and is hidden).
   - In Schedule mode: seven day chips (Mon…Sun) and two `type="time"` inputs (from, to), writing
     `telegram:schedule`; an **Office hours** button that writes `OFFICE_HOURS`; a hint `Runs past midnight` when to ≤
     from.
   - The status line from `telegramView`.
   Colors and type from DESIGN.md tokens only; `data-testid`s: `telegram-mode-<mode>`, `telegram-on-<1h|2h|4h>`,
   `telegram-on-custom`, `telegram-on-start`, `telegram-turn-off`, `telegram-day-<mon…sun>`, `telegram-from`,
   `telegram-to`, `telegram-office-hours`.

3. **Scenario `settings-telegram`.** Keep steps 1–2. Rework the rest for on-demand: switching on shows the one-shot
   getMe (`connecting` while the fake holds it, then `asleep` with "Off — turn it on for a while" in Manual); Pair
   connects and pairs as today (steps 5–6); then new steps, each with a numbered `tgShot`:
   - **On for 1h** → stored `telegram:onuntil` ≈ now+1h, row reads `on until`; with no question the fake sees no
     `getUpdates` for 4 s (`idle`).
   - **Schedule** → day chips and times show office hours; **Office hours** stores `OFFICE_HOURS`; setting from 22:00
     to 06:00 shows `Runs past midnight`.
   - **Turn off now** clears `telegram:onuntil`.
   - Unpair and Remove token as today; the 401 step triggers through Pair (which connects) instead of an idle poll.
   Teardown also restores `telegram:mode`, `telegram:schedule`, `telegram:onuntil` (add them to `TG_KEYS`).

4. **Docs.** `docs/guide/settings.md`'s Telegram section: when it connects (only with a question open, inside the
   allowed time), the three modes, office hours, on for a while.

5. **CHANGELOG** under `## Unreleased` → `Changed`:
   `- Telegram connects only while an agent's question is open, and only when you allow it: for a while (1h, 2h, 4h or your own), on a schedule such as office hours, or always.`

Run: `npx vitest run frontend/app/view/agents/telegrammodel.test.ts` → PASS; `task check:ts` (allow 4 min) → exit 0;
`npx eslint` and `npx prettier --check` on the touched frontend files.

Commit: `feat(settings): choose when Telegram may connect`.
