// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"context"
	"errors"
	"log"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// TokenSecretName is the secret-store name of the bot token; the Settings row sets it with SetSecretsCommand.
const TokenSecretName = "telegram_bottoken"

const (
	pollTimeoutSecs = 50
	defaultTick     = 2 * time.Second

	// A wrong /start code counts as a guess. Past pairMissLimit of them from one chat inside pairMissWindow the bot
	// ignores that chat's /start until the window has room again, so a stranger who knows the bot's name blocks only
	// their own chat, never the person's. pairMissGlobalLimit caps the guesses from every chat together, so many chats
	// still cannot brute-force a live 6-digit code: at most ~600 guesses over its 10 minutes, a 0.06% chance.
	pairMissLimit       = 5
	pairMissGlobalLimit = 60
	pairMissWindow      = time.Minute

	errTokenRejected = "Token rejected by Telegram"
	errAnotherPoller = "Another app is polling this bot"

	replyPaired        = "Paired. Agent questions will arrive here."
	replyPairFailed    = "Could not pair. Try again from arcterm."
	editCouldNotAnswer = "Could not answer — open arcterm"

	// The edit of a question left open when the allowed time ends; the first is followed by the next start, "Mon 08:00".
	editOffUntil  = "— Telegram is off until "
	editOffNoNext = "— Telegram is off; answer in arcterm"
)

// backoffMin and backoffMax bound the wait after a failed call; a var, not a const, so a test can shrink them.
var backoffMin, backoffMax = time.Second, 60 * time.Second

// idleLinger is how long a session stays up with nothing to do before it disconnects, and how long a session held
// by a pairing code outlives the code, so the "Paired." reply is never cut off; a var so a test can shrink it.
var idleLinger = 30 * time.Second

// validateTimeout bounds the one getMe a new token or a switch-on makes outside any session.
const validateTimeout = 20 * time.Second

// validateBackoffMin and validateBackoffMax bound the wait before a tick makes that getMe again after it failed on the
// network (a 401 is not retried by a tick, and a poke retries either at once); vars so a test can shrink them.
var validateBackoffMin, validateBackoffMax = time.Minute, 30 * time.Minute

// Deps is everything the bot takes from wavesrv, as funcs so the test drives it with fakes.
type Deps struct {
	Pending  func(ctx context.Context) map[string]agentask.PendingAsk // live, non-dead asks
	Deliver  func(oref, askID string, answers []baseds.AgentAnswerItem) (bool, error)
	Who      func(ctx context.Context, oref string) string // "api-refactor · arcterm", or "agent"
	Settings func() Settings                               // Enabled, ChatID (int64, 0 = unpaired), When
	Token    func() string                                 // "" = none stored
	SavePair func(chatID int64, chatName string) error
	APIBase  string        // "" = defaultAPIBase; a fake Bot API in tests and the CDP scenario
	Tick     time.Duration // 2 s in production
	// Now is the clock When.Allowed and the allowed-time-end edit read; nil is time.Now. The grace and the pairing
	// keep time.Now.
	Now func() time.Time
}

type Settings struct {
	Enabled bool
	ChatID  int64
	When    When // when it may connect
}

// NewWhen reads the telegram:mode, telegram:schedule and telegram:onuntil settings. A schedule that does not parse
// reads as office hours (the error says why, for the caller to log); onUntil is UnixMilli, and nil or 0 is none.
func NewWhen(mode, schedule string, onUntil *int64) (When, error) {
	sc, err := ParseSchedule(schedule)
	if err != nil {
		sc, _ = ParseSchedule("")
	}
	w := When{Mode: mode, Schedule: sc}
	if onUntil != nil && *onUntil > 0 {
		w.OnUntil = time.UnixMilli(*onUntil)
	}
	return w, err
}

// Status is what the Settings row shows. BotName is the bot's username without the "@"; the times are UnixMilli
// (0 = none). Connected is a session that is up and polling; Open counts the questions open in Telegram.
type Status struct {
	Enabled         bool   `json:"enabled"`
	HasToken        bool   `json:"hastoken"`
	Connected       bool   `json:"connected"`
	Allowed         bool   `json:"allowed"`
	AllowedUntil    int64  `json:"alloweduntil,omitempty"`
	NextAllowed     int64  `json:"nextallowed,omitempty"`
	Open            int    `json:"open,omitempty"`
	BotName         string `json:"botname,omitempty"`
	PairCode        string `json:"paircode,omitempty"`
	PairCodeExpires int64  `json:"paircodeexpires,omitempty"`
	LastError       string `json:"lasterror,omitempty"`
}

var Default *Bot

type Bot struct {
	d    Deps
	poke chan struct{}
	pair Pairer

	smu       sync.Mutex // guards the fields below
	connected bool
	botName   string
	pollErr   string // the poll loop's last failure; "" once a call succeeds
	sendErr   string // the last failed send or edit; "" once one succeeds

	// The tracker of what was sent lives here, not on a session, so a reconnect keeps it and a tap on a question sent
	// before the reconnect still delivers. It is replaced only with no session up (or by the reconcile pass itself).
	tmu       sync.Mutex // guards tr and its chat
	tr        *tracker
	trChat    int64 // the chat tr's messages went to
	trChatSet bool
	// work serialises the passes that send and edit for the tracker: reconcile and the allowed-time-end edit.
	work sync.Mutex

	pairMu     sync.Mutex
	pairMisses map[int64][]time.Time // chat id -> its wrong codes inside pairMissWindow
}

func New(d Deps) *Bot {
	if d.Tick <= 0 {
		d.Tick = defaultTick
	}
	b := &Bot{d: d, poke: make(chan struct{}, 1), tr: newSessionTracker()}
	b.poke <- struct{}{} // the first pass reads the settings as they stand, so Run needs no poke to start
	return b
}

// now is the clock the allowed time reads.
func (b *Bot) now() time.Time {
	if b.d.Now != nil {
		return b.d.Now()
	}
	return time.Now()
}

// Poke tells Run the settings or the token changed: it re-reads them and starts, restarts or stops the session.
func (b *Bot) Poke() {
	select {
	case b.poke <- struct{}{}:
	default: // one is already waiting, and it will read the newest settings
	}
}

// Pair makes a fresh pairing code, valid for PairTTL, and pokes Run: a live code connects in any mode, so it need not
// wait for the next tick.
func (b *Bot) Pair() (code string, expires time.Time) {
	code, expires = b.pair.New(time.Now())
	b.Poke()
	return code, expires
}

func (b *Bot) Status() Status {
	set := b.d.Settings()
	st := Status{Enabled: set.Enabled, HasToken: b.d.Token() != ""}
	if set.Enabled {
		allowed, until, next := set.When.Allowed(b.now())
		st.Allowed, st.AllowedUntil, st.NextAllowed = allowed, millis(until), millis(next)
	}
	b.smu.Lock()
	st.Connected, st.BotName = b.connected, b.botName
	st.LastError = b.pollErr
	if st.LastError == "" {
		st.LastError = b.sendErr
	}
	b.smu.Unlock()
	st.Open = b.openAsks()
	if code, exp := b.pair.Pending(time.Now()); code != "" {
		st.PairCode, st.PairCodeExpires = code, exp.UnixMilli()
	}
	return st
}

// millis is t as UnixMilli, 0 for the zero time.
func millis(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

// hasDue reports a pending ask that reconcile would send now.
func (b *Bot) hasDue(pending map[string]agentask.PendingAsk, now int64) bool {
	b.tmu.Lock()
	defer b.tmu.Unlock()
	return b.tr.hasDue(pending, now)
}

// openAsks counts the asks being answered in Telegram.
func (b *Bot) openAsks() int {
	b.tmu.Lock()
	defer b.tmu.Unlock()
	return len(b.tr.byAsk)
}

// syncChat replaces the tracker when the paired chat changed: message ids are per chat, so the old chat's ids mean
// nothing in the new one. The caller makes sure no reconcile pass is running, or is that pass.
func (b *Bot) syncChat(chat int64) {
	b.tmu.Lock()
	defer b.tmu.Unlock()
	if b.trChatSet && b.trChat != chat {
		b.tr = newSessionTracker()
	}
	b.trChat, b.trChatSet = chat, true
}

// resetTracker forgets every sent question, for a new token: the messages went through another bot. The caller makes
// sure no session is up.
func (b *Bot) resetTracker() {
	b.tmu.Lock()
	b.tr = newSessionTracker()
	b.tmu.Unlock()
}

func (b *Bot) setConnected(v bool) {
	b.smu.Lock()
	b.connected = v
	b.smu.Unlock()
}

func (b *Bot) setBotName(name string) {
	b.smu.Lock()
	b.botName = name
	b.smu.Unlock()
}

// setErr records msg in slot ("" clears it) and logs it when it is new. msg never holds the token: the client
// redacts every error it returns.
func (b *Bot) setErr(slot *string, msg string) {
	b.smu.Lock()
	changed := *slot != msg
	*slot = msg
	b.smu.Unlock()
	if changed && msg != "" {
		log.Printf("[telebot] %s", msg)
	}
}

// resetStatus is what the row shows with nothing running: no bot, no error.
func (b *Bot) resetStatus() {
	b.smu.Lock()
	b.connected, b.botName, b.pollErr, b.sendErr = false, "", "", ""
	b.smu.Unlock()
}

// pairBlocked reports a chat that has used up its guesses, or every chat when all of them together have.
func (b *Bot) pairBlocked(chat int64, now time.Time) bool {
	b.pairMu.Lock()
	defer b.pairMu.Unlock()
	total := 0
	for id, misses := range b.pairMisses {
		misses = slices.DeleteFunc(misses, func(t time.Time) bool { return now.Sub(t) >= pairMissWindow })
		if len(misses) == 0 {
			delete(b.pairMisses, id)
			continue
		}
		b.pairMisses[id] = misses
		total += len(misses)
	}
	return len(b.pairMisses[chat]) >= pairMissLimit || total >= pairMissGlobalLimit
}

func (b *Bot) notePairMiss(chat int64, now time.Time) {
	b.pairMu.Lock()
	defer b.pairMu.Unlock()
	if b.pairMisses == nil {
		b.pairMisses = map[int64][]time.Time{}
	}
	b.pairMisses[chat] = append(b.pairMisses[chat], now)
}

// session is one run of the bot on one token: a getMe, a backlog drop, then the poll and reconcile loops. It ends when
// its context does or when Telegram rejects the token. What it has sent lives on the Bot.
type session struct {
	b        *Bot
	api      *Client
	token    string
	cancel   context.CancelFunc
	done     chan struct{} // closed once every goroutine of the session has returned
	rejected atomic.Bool   // Telegram answered 401: the session is ending, and the token is not retried until a poke
}

func (s *session) ended() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

// Run decides on every tick and every poke whether a session should be up, starts and stops it, and returns when ctx
// ends. The first pass runs without a poke.
func (b *Bot) Run(ctx context.Context) {
	sv := &supervisor{b: b, ctx: ctx}
	defer sv.stop()
	t := time.NewTicker(b.d.Tick)
	defer t.Stop()
	for {
		poked := false
		select {
		case <-ctx.Done():
			return
		case <-b.poke:
			poked = true
		case <-t.C:
		}
		sv.step(poked)
	}
}

// supervisor is Run's state. It reads only the settings, the local ask registry and the clock to decide, so an idle
// bot makes no request.
type supervisor struct {
	b   *Bot
	ctx context.Context
	cur *session

	rejectedTok string    // the token Telegram answered 401, until a poke
	knownTok    string    // the token Telegram answered a getMe for (a 401 too) or a session started on; "" after a network failure
	trackedTok  string    // the token the tracker's messages went through
	lastWanted  time.Time // the last pass that wanted a session
	lastPairing time.Time // the last pass that saw a live pairing code

	// The wait before a tick retries a validation that failed on the network: failTok is the token it failed on ("" =
	// none), failWait the wait that follows the latest failure, retryAt when it ends.
	failTok  string
	failWait time.Duration
	retryAt  time.Time
}

func (sv *supervisor) stop() {
	if sv.cur != nil {
		sv.cur.cancel()
		<-sv.cur.done
		sv.cur = nil
	}
}

// step is one pass. poked says a settings or token change (or a Pair) woke it, rather than the tick.
func (sv *supervisor) step(poked bool) {
	defer func() { _ = panichandler.PanicHandler("telebot.step", recover()) }()
	b := sv.b
	set, tok := b.d.Settings(), b.d.Token()

	// A session that ended on a 401 is not restarted by a tick; a poke, the same token too, tries again.
	if sv.cur != nil && sv.cur.rejected.Load() {
		rejTok := sv.cur.token // the token Telegram refused, which is not the current one if it changed meanwhile
		sv.stop()
		sv.rejectedTok = rejTok
	}
	if sv.cur != nil && sv.cur.ended() {
		sv.cur = nil
	}
	wasRejected := false
	if poked && sv.rejectedTok != "" {
		wasRejected, sv.rejectedTok = true, ""
	}
	if !set.Enabled || tok == "" {
		sv.stop()
		b.resetStatus()
		sv.knownTok, sv.rejectedTok, sv.failTok = "", "", ""
		return
	}
	rejected := sv.rejectedTok == tok

	if sv.cur != nil && sv.cur.token != tok {
		sv.stop()
	}
	if sv.cur == nil {
		// No session means no reconcile pass is running: the tracker may be replaced.
		if sv.trackedTok != "" && sv.trackedTok != tok {
			b.resetTracker()
		}
		b.syncChat(set.ChatID)
	}
	sv.trackedTok = tok

	wall := time.Now()
	allowed, _, next := set.When.Allowed(b.now())
	pairing := false
	if code, _ := b.pair.Pending(wall); code != "" {
		pairing = true
		sv.lastPairing = wall
	}
	// need: a question is open in Telegram or waits past the grace. With no paired chat there is nowhere to send one.
	open := b.openAsks()
	need := false
	if set.ChatID != 0 && !rejected && (open > 0 || allowed) {
		need = open > 0 || b.hasDue(b.d.Pending(sv.ctx), wall.UnixMilli())
	}
	want := !rejected && ((allowed && need) || pairing)

	if want {
		sv.lastWanted = wall
		if sv.cur == nil {
			sv.start(tok)
		}
		return
	}
	if sv.cur != nil {
		sv.wind(allowed, pairing, next, wall)
		return
	}
	// Nothing to do, so nothing is connected. Switching on or a new token (and a poke after a rejection) makes one
	// getMe to show the bot's name and catch a wrong token, in every mode, and then nothing more. One that failed on the
	// network is tried again on the next poke, and on a tick once its wait is over.
	if (tok != sv.knownTok || wasRejected) && (poked || !sv.validateWaits(tok, wall)) {
		sv.validate(tok)
	}
}

// validateWaits reports that tok's validation failed on the network and a tick must still wait to retry it.
func (sv *supervisor) validateWaits(tok string, wall time.Time) bool {
	return sv.failTok == tok && wall.Before(sv.retryAt)
}

// wind ends the session that has nothing to do: at once when the allowed time ended (no code in play), else once it
// has been idle for idleLinger. A code that was used or ran out counts as idle time, so the "Paired." reply goes out.
func (sv *supervisor) wind(allowed, pairing bool, next, wall time.Time) {
	b := sv.b
	if !allowed && !pairing && b.openAsks() > 0 {
		sv.cur.endAllowed(sv.ctx, next)
	}
	recentPairing := !sv.lastPairing.IsZero() && wall.Sub(sv.lastPairing) < idleLinger
	if (!allowed && !recentPairing) || wall.Sub(sv.lastWanted) >= idleLinger {
		sv.stop()
	}
}

func (sv *supervisor) start(tok string) {
	sctx, cancel := context.WithCancel(sv.ctx)
	sv.cur = &session{
		b:      sv.b,
		api:    &Client{Base: sv.b.d.APIBase, Token: tok},
		token:  tok,
		cancel: cancel,
		done:   make(chan struct{}),
	}
	sv.knownTok, sv.failTok = tok, "" // the session makes its own getMe, and retries it itself
	go sv.cur.run(sctx)
}

// validate is the one getMe a bot with nothing to do makes: the name for the row, or the 401. Either answer settles
// the token; a network failure does not, so the token stays unknown and is retried (see validateBackoffMin).
func (sv *supervisor) validate(tok string) {
	b := sv.b
	ctx, cancel := context.WithTimeout(sv.ctx, validateTimeout)
	defer cancel()
	api := &Client{Base: b.d.APIBase, Token: tok}
	me, err := api.GetMe(ctx)
	if sv.ctx.Err() != nil {
		return
	}
	var ae *APIError
	switch {
	case err == nil:
		sv.knownTok, sv.failTok = tok, ""
		b.setBotName(me.Username)
		b.setErr(&b.pollErr, "")
	case errors.As(err, &ae) && ae.Code == 401:
		sv.knownTok, sv.failTok = tok, ""
		b.setErr(&b.pollErr, errTokenRejected)
		sv.rejectedTok = tok
	default:
		sv.knownTok = ""
		if sv.failTok != tok { // a new token starts the wait over
			sv.failTok, sv.failWait = tok, validateBackoffMin
		} else {
			sv.failWait = min(sv.failWait*2, validateBackoffMax)
		}
		sv.retryAt = time.Now().Add(sv.failWait)
		b.setErr(&b.pollErr, err.Error())
	}
}

// newSessionTracker seeds the counter from the clock. Callback data carries only the counter, and Telegram keeps the
// buttons of a message sent before a restart: a tap on one must not match an ask the new process numbered.
func newSessionTracker() *tracker {
	t := newTracker()
	t.next = int(time.Now().Unix())
	return t
}

func (s *session) run(ctx context.Context) {
	defer close(s.done)
	defer s.cancel()
	defer s.b.setConnected(false)

	var me User
	if !s.call(ctx, func() (err error) { me, err = s.api.GetMe(ctx); return }) {
		return
	}
	s.b.setBotName(me.Username)
	// Drop what piled up while arcterm was closed: those taps refer to asks this process never sent. The call returns
	// the last update, and polling starts after it.
	var last []Update
	if !s.call(ctx, func() (err error) { last, err = s.api.GetUpdates(ctx, -1, 0); return }) {
		return
	}
	offset := 0
	if n := len(last); n > 0 {
		offset = last[n-1].UpdateID + 1
	}
	s.b.setConnected(true)

	var wg sync.WaitGroup
	wg.Go(func() { s.reconcileLoop(ctx) })
	s.poll(ctx, offset)
	s.cancel() // a rejected token ends the reconcile loop too
	wg.Wait()
}

// call runs fn until it succeeds, waiting backoffMin doubling to backoffMax between failures. It returns false when
// ctx ends or Telegram rejects the token, and the session ends with it.
func (s *session) call(ctx context.Context, fn func() error) bool {
	wait := backoffMin
	for {
		err := fn()
		if err == nil {
			s.b.setErr(&s.b.pollErr, "")
			return true
		}
		if ctx.Err() != nil {
			return false
		}
		var ae *APIError
		switch {
		case errors.As(err, &ae) && ae.Code == 401:
			s.rejected.Store(true) // before the message: whoever sees the message finds the flag set
			s.b.setErr(&s.b.pollErr, errTokenRejected)
			return false
		case errors.As(err, &ae) && ae.Code == 409:
			s.b.setErr(&s.b.pollErr, errAnotherPoller)
		default:
			s.b.setErr(&s.b.pollErr, err.Error())
		}
		if !sleep(ctx, wait) {
			return false
		}
		wait = min(wait*2, backoffMax)
	}
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func (s *session) poll(ctx context.Context, offset int) {
	for {
		var ups []Update
		if !s.call(ctx, func() (err error) { ups, err = s.api.GetUpdates(ctx, offset, pollTimeoutSecs); return }) {
			return
		}
		for _, u := range ups {
			if ctx.Err() != nil {
				return
			}
			s.handle(ctx, u)
			offset = u.UpdateID + 1
		}
	}
}

func (s *session) reconcileLoop(ctx context.Context) {
	t := time.NewTicker(s.b.d.Tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.reconcile(ctx)
		}
	}
}

type sendJob struct {
	a    *askMsg
	oref string
	q    baseds.AgentAskQuestion
	kb   [][]Button
}

// reconcile compares the registry with what the bot has sent: an ask that left it is edited to say so, and one that has
// waited out the grace goes out, but only while the time is allowed (a session held by a pairing code outside it sends
// nothing but its "Paired." reply). It does nothing until a chat is paired.
func (s *session) reconcile(ctx context.Context) {
	defer func() { _ = panichandler.PanicHandler("telebot.reconcile", recover()) }()
	b := s.b
	b.work.Lock()
	defer b.work.Unlock()
	set := b.d.Settings()
	b.syncChat(set.ChatID)
	chat := set.ChatID
	if chat == 0 {
		return
	}
	allowed, _, _ := set.When.Allowed(b.now())
	pending := b.d.Pending(ctx)
	now := time.Now().UnixMilli()

	b.tmu.Lock()
	gone := b.tr.gone(pending)
	var jobs []sendJob
	if allowed {
		for _, d := range b.tr.due(pending, now) {
			a := b.tr.track(d)
			jobs = append(jobs, sendJob{a: a, oref: d.Oref, q: d.Questions[0], kb: keyboard(a)})
		}
	}
	b.tmu.Unlock()

	for _, a := range gone {
		// only the question still open: an earlier one of a multi-question ask was answered here and keeps its "✓ <label>"
		for _, id := range a.msgIDs[min(a.q, len(a.msgIDs)):] {
			s.edit(ctx, chat, id, editAnsweredInApp, nil)
		}
	}
	for i, j := range jobs {
		id, ok := s.send(ctx, chat, questionText(s.who(ctx, j.oref), j.q), j.kb)
		b.tmu.Lock()
		if ok {
			b.tr.sent(j.a, id)
		} else {
			// Untracked, the ask is due again next tick; the rest wait with it.
			for _, rest := range jobs[i:] {
				b.tr.drop(rest.a)
			}
		}
		b.tmu.Unlock()
		if !ok {
			return
		}
	}
}

// editTimeout bounds the edits the end of the allowed time makes: the session is stopped right after them.
const editTimeout = 15 * time.Second

// endAllowed runs when the allowed time ended with questions open in Telegram: each one's open message is edited to
// say Telegram is off (until next, or "answer in arcterm" when nothing will turn it back on), and the ask is forgotten
// without a tombstone, so one that is still pending is sent again as a new message when the time comes back.
func (s *session) endAllowed(ctx context.Context, next time.Time) {
	defer func() { _ = panichandler.PanicHandler("telebot.endAllowed", recover()) }()
	ctx, cancel := context.WithTimeout(ctx, editTimeout)
	defer cancel()
	b := s.b
	b.work.Lock()
	defer b.work.Unlock()
	text := editOffNoNext
	if !next.IsZero() {
		text = editOffUntil + next.Format("Mon 15:04")
	}

	b.tmu.Lock()
	chat := b.trChat
	open := b.tr.all()
	for _, a := range open {
		b.tr.drop(a)
	}
	b.tmu.Unlock()

	for _, a := range open {
		for _, id := range a.msgIDs[min(a.q, len(a.msgIDs)):] {
			s.edit(ctx, chat, id, text, nil)
		}
	}
}

func (s *session) who(ctx context.Context, oref string) string {
	if s.b.d.Who == nil {
		return ""
	}
	return s.b.d.Who(ctx, oref)
}

func (s *session) sendFailed(ctx context.Context, err error) {
	if ctx.Err() == nil {
		s.b.setErr(&s.b.sendErr, err.Error())
	}
}

func (s *session) send(ctx context.Context, chat int64, text string, kb [][]Button) (int, bool) {
	id, err := s.api.SendMessage(ctx, chat, text, kb)
	if err != nil {
		s.sendFailed(ctx, err)
		return 0, false
	}
	s.b.setErr(&s.b.sendErr, "")
	return id, true
}

// edit replaces a message's text and keyboard. Telegram's 400 "message is not modified" means the message already
// says it, which is what the caller wanted.
func (s *session) edit(ctx context.Context, chat int64, msgID int, text string, kb [][]Button) {
	err := s.api.EditMessage(ctx, chat, msgID, text, kb)
	if err == nil {
		s.b.setErr(&s.b.sendErr, "")
		return
	}
	var ae *APIError
	if errors.As(err, &ae) && ae.Code == 400 && strings.Contains(ae.Desc, "not modified") {
		return
	}
	s.sendFailed(ctx, err)
}

func (s *session) handle(ctx context.Context, u Update) {
	defer func() { _ = panichandler.PanicHandler("telebot.handle", recover()) }()
	switch {
	case u.Callback != nil:
		s.onCallback(ctx, u.Callback)
	case u.Message != nil:
		s.onMessage(ctx, u.Message)
	}
}

// result is what a step needs from its ask, copied while the tracker lock is held.
type result struct {
	st      step
	a       *askMsg
	oref    string
	askID   string
	answers []baseds.AgentAnswerItem // set for Deliver
	q       baseds.AgentAskQuestion  // the question on screen, set for Next and Rekey
	kb      [][]Button               // its keyboard
}

// resolve reads what the step's follow-up needs; the caller holds the bot's tracker lock.
func (s *session) resolve(a *askMsg, st step) result {
	r := result{st: st, a: a}
	if a == nil {
		return r
	}
	r.oref, r.askID = a.oref, a.askID
	if st.Deliver {
		r.answers = slices.Clone(a.answers)
	}
	if (st.Rekey || st.Next) && a.q < len(a.questions) {
		r.q, r.kb = a.questions[a.q], keyboard(a)
	}
	return r
}

func chatName(c Chat) string {
	switch {
	case c.Title != "":
		return c.Title
	case c.Username != "":
		return "@" + c.Username
	}
	return c.FirstName
}

func (s *session) paired(chat int64) bool {
	id := s.b.d.Settings().ChatID
	return id != 0 && chat == id
}

func (s *session) onMessage(ctx context.Context, m *Message) {
	if f := strings.Fields(m.Text); len(f) > 0 && f[0] == "/start" {
		s.onStart(ctx, m, len(f) == 2)
		return
	}
	if !s.paired(m.Chat.ID) {
		return
	}
	r, replied := result{st: step{Reply: FixedReply}}, 0
	if m.ReplyTo != nil {
		replied = m.ReplyTo.MessageID
		s.b.tmu.Lock()
		a, st := s.b.tr.onReply(replied, m.Text)
		r = s.resolve(a, st)
		s.b.tmu.Unlock()
	}
	s.finish(ctx, m.Chat.ID, replied, r)
}

// onStart pairs the chat when text is "/start <code>" for the live code. Any other /start gets no reply, from the
// paired chat as from a stranger.
func (s *session) onStart(ctx context.Context, m *Message, hasCode bool) {
	now := time.Now()
	if s.b.pairBlocked(m.Chat.ID, now) {
		return
	}
	if !s.b.pair.Match(m.Text, now) {
		if hasCode {
			s.b.notePairMiss(m.Chat.ID, now)
		}
		return
	}
	if err := s.b.d.SavePair(m.Chat.ID, chatName(m.Chat)); err != nil {
		s.b.setErr(&s.b.sendErr, "Could not save the pairing: "+err.Error())
		s.send(ctx, m.Chat.ID, replyPairFailed, nil)
		return
	}
	s.send(ctx, m.Chat.ID, replyPaired, nil)
}

func (s *session) onCallback(ctx context.Context, cb *CallbackQuery) {
	if cb.Message == nil || !s.paired(cb.Message.Chat.ID) {
		return
	}
	s.b.tmu.Lock()
	a, st := s.b.tr.onCallback(cb.Data)
	r := s.resolve(a, st)
	s.b.tmu.Unlock()
	// Clears the spinner on the button. A failure here is a token that expired, which says nothing about the bot.
	_ = s.api.AnswerCallback(ctx, cb.ID, st.Toast)
	s.finish(ctx, cb.Message.Chat.ID, cb.Message.MessageID, r)
}

// finish does what a tap or a reply decided. msgID is the message tapped or replied to (0 for none): the one the
// step edits, and the one a failed delivery is reported on.
func (s *session) finish(ctx context.Context, chat int64, msgID int, r result) {
	st := r.st
	if st.Edit != "" && msgID != 0 {
		s.edit(ctx, chat, msgID, st.Edit, nil)
	}
	if st.Reply != "" {
		s.send(ctx, chat, st.Reply, nil)
	}
	if r.a == nil {
		return
	}
	who := ""
	if st.Rekey || st.Next {
		who = s.who(ctx, r.oref)
	}
	if st.Rekey && msgID != 0 {
		s.edit(ctx, chat, msgID, questionText(who, r.q), r.kb)
	}
	if st.Next {
		id, ok := s.send(ctx, chat, questionText(who, r.q), r.kb)
		s.b.tmu.Lock()
		if ok {
			s.b.tr.sent(r.a, id)
		} else {
			// Untracked, the ask is due again and goes out from its first question.
			s.b.tr.drop(r.a)
		}
		s.b.tmu.Unlock()
	}
	if st.Deliver {
		s.deliver(ctx, chat, msgID, r)
	}
}

// deliver hands the answers to the agent through the same path the cockpit uses, and reports a failure on the last
// message. The ask was forgotten when its last question was answered, so a slow delivery cannot send it again.
func (s *session) deliver(ctx context.Context, chat int64, msgID int, r result) {
	ok, err := s.b.d.Deliver(r.oref, r.askID, r.answers)
	if err == nil && ok {
		return
	}
	log.Printf("[telebot] delivering the answer for %s failed: %v", r.oref, err)
	text := editCouldNotAnswer
	if errors.Is(err, agentask.ErrNoPendingAsk) {
		text = editAnsweredInApp // answered in the app between the tap and the delivery
	}
	if msgID != 0 {
		s.edit(ctx, chat, msgID, text, nil)
	}
}
