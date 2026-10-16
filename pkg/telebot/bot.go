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
)

// backoffMin and backoffMax bound the wait after a failed call; a var, not a const, so a test can shrink them.
var backoffMin, backoffMax = time.Second, 60 * time.Second

// Deps is everything the bot takes from wavesrv, as funcs so the test drives it with fakes.
type Deps struct {
	Pending  func(ctx context.Context) map[string]agentask.PendingAsk // live, non-dead asks
	Deliver  func(oref, askID string, answers []baseds.AgentAnswerItem) (bool, error)
	Who      func(ctx context.Context, oref string) string // "api-refactor · arcterm", or "agent"
	Settings func() Settings                               // Enabled, ChatID (int64, 0 = unpaired)
	Token    func() string                                 // "" = none stored
	SavePair func(chatID int64, chatName string) error
	APIBase  string        // "" = defaultAPIBase; a fake Bot API in tests and the CDP scenario
	Tick     time.Duration // 2 s in production
}

type Settings struct {
	Enabled bool
	ChatID  int64
}

// Status is what the Settings row shows. BotName is the bot's username without the "@"; PairCodeExpires is UnixMilli.
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

type Bot struct {
	d    Deps
	poke chan struct{}
	pair Pairer

	smu     sync.Mutex // guards the fields below
	polling bool
	botName string
	pollErr string // the poll loop's last failure; "" once a call succeeds
	sendErr string // the last failed send or edit; "" once one succeeds

	pairMu     sync.Mutex
	pairMisses map[int64][]time.Time // chat id -> its wrong codes inside pairMissWindow
}

func New(d Deps) *Bot {
	if d.Tick <= 0 {
		d.Tick = defaultTick
	}
	b := &Bot{d: d, poke: make(chan struct{}, 1)}
	b.poke <- struct{}{} // the first pass reads the settings as they stand, so Run needs no poke to start
	return b
}

// Poke tells Run the settings or the token changed: it re-reads them and starts, restarts or stops the session.
func (b *Bot) Poke() {
	select {
	case b.poke <- struct{}{}:
	default: // one is already waiting, and it will read the newest settings
	}
}

// Pair makes a fresh pairing code, valid for PairTTL.
func (b *Bot) Pair() (code string, expires time.Time) { return b.pair.New(time.Now()) }

func (b *Bot) Status() Status {
	set := b.d.Settings()
	st := Status{Enabled: set.Enabled, HasToken: b.d.Token() != ""}
	b.smu.Lock()
	st.Polling, st.BotName = b.polling, b.botName
	st.LastError = b.pollErr
	if st.LastError == "" {
		st.LastError = b.sendErr
	}
	b.smu.Unlock()
	if code, exp := b.pair.Pending(time.Now()); code != "" {
		st.PairCode, st.PairCodeExpires = code, exp.UnixMilli()
	}
	return st
}

func (b *Bot) setPolling(v bool) {
	b.smu.Lock()
	b.polling = v
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
	b.polling, b.botName, b.pollErr, b.sendErr = false, "", "", ""
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
// its context does or when Telegram rejects the token.
type session struct {
	b      *Bot
	api    *Client
	token  string
	cancel context.CancelFunc
	done   chan struct{} // closed once every goroutine of the session has returned

	chat int64      // the chat tr's messages went to; only the reconcile goroutine touches it
	mu   sync.Mutex // guards tr: the poll goroutine and the reconcile ticker both use it
	tr   *tracker
}

func (s *session) ended() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

// Run starts, restarts and stops the session as pokes arrive, and returns when ctx ends. The first pass runs without
// a poke.
func (b *Bot) Run(ctx context.Context) {
	var cur *session
	stop := func() {
		if cur != nil {
			cur.cancel()
			<-cur.done
			cur = nil
		}
	}
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-b.poke:
		}
		set, tok := b.d.Settings(), b.d.Token()
		if !set.Enabled || tok == "" {
			stop()
			b.resetStatus()
			continue
		}
		// A session that ended on a rejected token is retried on the next poke, even with the same token.
		if cur != nil && cur.token == tok && !cur.ended() {
			continue
		}
		stop()
		sctx, cancel := context.WithCancel(ctx)
		cur = &session{
			b:      b,
			api:    &Client{Base: b.d.APIBase, Token: tok},
			token:  tok,
			cancel: cancel,
			done:   make(chan struct{}),
			chat:   set.ChatID,
			tr:     newSessionTracker(),
		}
		go cur.run(sctx)
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
	defer s.b.setPolling(false)

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
	s.b.setPolling(true)

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

// reconcile compares the registry with what the session has sent: an ask that left it is edited to say so, and one
// that has waited out the grace goes out. It does nothing until a chat is paired.
func (s *session) reconcile(ctx context.Context) {
	defer func() { _ = panichandler.PanicHandler("telebot.reconcile", recover()) }()
	chat := s.b.d.Settings().ChatID
	if chat != s.chat {
		// Message ids are per chat: the old chat's ids mean nothing in the new one.
		s.mu.Lock()
		s.tr = newSessionTracker()
		s.mu.Unlock()
		s.chat = chat
	}
	if chat == 0 {
		return
	}
	pending := s.b.d.Pending(ctx)
	now := time.Now().UnixMilli()

	s.mu.Lock()
	gone := s.tr.gone(pending)
	var jobs []sendJob
	for _, d := range s.tr.due(pending, now) {
		a := s.tr.track(d)
		jobs = append(jobs, sendJob{a: a, oref: d.Oref, q: d.Questions[0], kb: keyboard(a)})
	}
	s.mu.Unlock()

	for _, a := range gone {
		// only the question still open: an earlier one of a multi-question ask was answered here and keeps its "✓ <label>"
		for _, id := range a.msgIDs[min(a.q, len(a.msgIDs)):] {
			s.edit(ctx, chat, id, editAnsweredInApp, nil)
		}
	}
	for i, j := range jobs {
		id, ok := s.send(ctx, chat, questionText(s.who(ctx, j.oref), j.q), j.kb)
		s.mu.Lock()
		if ok {
			s.tr.sent(j.a, id)
		} else {
			// Untracked, the ask is due again next tick; the rest wait with it.
			for _, rest := range jobs[i:] {
				s.tr.drop(rest.a)
			}
		}
		s.mu.Unlock()
		if !ok {
			return
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

// resolve reads what the step's follow-up needs; the caller holds s.mu.
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
		s.mu.Lock()
		a, st := s.tr.onReply(replied, m.Text)
		r = s.resolve(a, st)
		s.mu.Unlock()
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
	s.mu.Lock()
	a, st := s.tr.onCallback(cb.Data)
	r := s.resolve(a, st)
	s.mu.Unlock()
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
		s.mu.Lock()
		if ok {
			s.tr.sent(r.a, id)
		} else {
			// Untracked, the ask is due again and goes out from its first question.
			s.tr.drop(r.a)
		}
		s.mu.Unlock()
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
