// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
)

const (
	pairedChat = int64(42)
	otherChat  = int64(99)
)

// tgCall is one request the fake Bot API received.
type tgCall struct {
	Method string
	Token  string
	Body   map[string]any
	MsgID  int // the message id a sendMessage was given
}

func (c tgCall) str(key string) string { s, _ := c.Body[key].(string); return s }

func (c tgCall) num(key string) int { n, _ := c.Body[key].(float64); return int(n) }

// buttons is the callback data of the keyboard the call carried, row by row.
func (c tgCall) buttons() [][]string {
	markup, _ := c.Body["reply_markup"].(map[string]any)
	rows, _ := markup["inline_keyboard"].([]any)
	out := make([][]string, 0, len(rows))
	for _, row := range rows {
		var r []string
		for _, b := range row.([]any) {
			r = append(r, b.(map[string]any)["callback_data"].(string))
		}
		out = append(out, r)
	}
	return out
}

// labels is the text of the keyboard's buttons, row by row.
func (c tgCall) labels() []string {
	markup, _ := c.Body["reply_markup"].(map[string]any)
	rows, _ := markup["inline_keyboard"].([]any)
	var out []string
	for _, row := range rows {
		for _, b := range row.([]any) {
			out = append(out, b.(map[string]any)["text"].(string))
		}
	}
	return out
}

// fakeTelegram is an httptest Bot API: getUpdates serves a queue the test fills and holds a long poll for a few
// milliseconds, and every request is recorded.
type fakeTelegram struct {
	srv *httptest.Server

	mu          sync.Mutex
	calls       []tgCall
	queue       []Update
	lastUpdate  int
	lastMsg     int
	getUpdateN  int
	getMeCode   int             // 0 = ok, else the error code getMe answers with
	updatesCode func(n int) int // the error code for the n-th getUpdates (1 = the backlog drop), 0 = ok
	sendCode    func(n int) int // the error code for the n-th sendMessage, 0 = ok
	sendN       int
}

func newFakeTelegram(t *testing.T) *fakeTelegram {
	t.Helper()
	f := &fakeTelegram{}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func tgFail(w http.ResponseWriter, code int) {
	w.WriteHeader(code)
	_, _ = fmt.Fprintf(w, `{"ok":false,"error_code":%d,"description":"fake %d"}`, code, code)
}

func tgOK(w http.ResponseWriter, result any) {
	raw, _ := json.Marshal(result)
	_, _ = fmt.Fprintf(w, `{"ok":true,"result":%s}`, raw)
}

func (f *fakeTelegram) serve(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	path := strings.TrimPrefix(r.URL.Path, "/bot")
	token, method, _ := strings.Cut(path, "/")
	call := tgCall{Method: method, Token: token, Body: body}
	w.Header().Set("Content-Type", "application/json")

	f.mu.Lock()
	switch method {
	case "getMe":
		code := f.getMeCode
		f.calls = append(f.calls, call)
		f.mu.Unlock()
		if code != 0 {
			tgFail(w, code)
			return
		}
		tgOK(w, map[string]any{"id": 1, "username": "arc_test_bot"})
	case "getUpdates":
		f.getUpdateN++
		n := f.getUpdateN
		f.calls = append(f.calls, call)
		var code int
		if f.updatesCode != nil {
			code = f.updatesCode(n)
		}
		f.mu.Unlock()
		if code != 0 {
			tgFail(w, code)
			return
		}
		offset, _ := body["offset"].(float64)
		wait, _ := body["timeout"].(float64)
		deadline := time.Now().Add(25 * time.Millisecond)
		for {
			f.mu.Lock()
			ups := f.updatesFrom(int(offset))
			f.mu.Unlock()
			if len(ups) > 0 || wait == 0 || time.Now().After(deadline) || r.Context().Err() != nil {
				tgOK(w, ups)
				return
			}
			time.Sleep(3 * time.Millisecond)
		}
	case "sendMessage":
		f.sendN++
		code := 0
		if f.sendCode != nil {
			code = f.sendCode(f.sendN)
		}
		if code == 0 {
			f.lastMsg++
			call.MsgID = 1000 + f.lastMsg
		}
		f.calls = append(f.calls, call)
		f.mu.Unlock()
		if code != 0 {
			tgFail(w, code)
			return
		}
		tgOK(w, map[string]any{"message_id": call.MsgID})
	default: // editMessageText, answerCallbackQuery
		f.calls = append(f.calls, call)
		f.mu.Unlock()
		tgOK(w, true)
	}
}

// updatesFrom follows Telegram: a positive offset confirms every update before it, a negative one returns the last
// update without confirming it. The caller holds f.mu.
func (f *fakeTelegram) updatesFrom(offset int) []Update {
	if offset < 0 {
		if len(f.queue) == 0 {
			return nil
		}
		return []Update{f.queue[len(f.queue)-1]}
	}
	kept := f.queue[:0]
	for _, u := range f.queue {
		if u.UpdateID >= offset {
			kept = append(kept, u)
		}
	}
	f.queue = kept
	return append([]Update(nil), kept...)
}

// push queues an update and returns its id.
func (f *fakeTelegram) push(u Update) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastUpdate++
	u.UpdateID = f.lastUpdate
	f.queue = append(f.queue, u)
	return u.UpdateID
}

// pushAt queues an update under a chosen id.
func (f *fakeTelegram) pushAt(id int, u Update) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u.UpdateID = id
	f.lastUpdate = id
	f.queue = append(f.queue, u)
}

func (f *fakeTelegram) callsOf(method string) []tgCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []tgCall
	for _, c := range f.calls {
		if c.Method == method {
			out = append(out, c)
		}
	}
	return out
}

func (f *fakeTelegram) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

// editsOf is the text of every edit made to message id, oldest first.
func (f *fakeTelegram) editsOf(id int) []string {
	var out []string
	for _, c := range f.callsOf("editMessageText") {
		if c.num("message_id") == id {
			out = append(out, c.str("text"))
		}
	}
	return out
}

func say(chat int64, msgID int, s string) Update {
	return Update{Message: &Message{MessageID: msgID, Chat: Chat{ID: chat}, Text: s}}
}

func tap(chat int64, msgID int, data string) Update {
	return Update{Callback: &CallbackQuery{ID: fmt.Sprintf("cb-%d-%s", msgID, data), Data: data,
		Message: &Message{MessageID: msgID, Chat: Chat{ID: chat}}}}
}

func replyTo(chat int64, msgID, toMsg int, s string) Update {
	return Update{Message: &Message{MessageID: msgID, Chat: Chat{ID: chat}, Text: s,
		ReplyTo: &Message{MessageID: toMsg, Chat: Chat{ID: chat}}}}
}

type delivery struct {
	Oref    string
	AskID   string
	Answers []baseds.AgentAnswerItem
}

type savedPair struct {
	Chat int64
	Name string
}

// rig is a Bot wired to a fake Bot API and an in-memory registry.
type rig struct {
	t   *testing.T
	tg  *fakeTelegram
	bot *Bot

	mu        sync.Mutex
	pending   map[string]agentask.PendingAsk
	set       Settings
	token     string
	clock     time.Time // the clock the allowed time reads; zero is the real one
	delivered []delivery
	saved     []savedPair
	// deliver, when set, replaces the default delivery, which records the answer and then clears the ask the way
	// agentask.DeliverAnswer does.
	deliver func(oref, askID string, answers []baseds.AgentAnswerItem) (bool, error)
}

func newRig(t *testing.T) *rig {
	t.Helper()
	return &rig{
		t:       t,
		tg:      newFakeTelegram(t),
		pending: map[string]agentask.PendingAsk{},
		set:     Settings{Enabled: true, ChatID: pairedChat, When: When{Mode: ModeAlways}},
		token:   "TKN",
	}
}

func (r *rig) deps() Deps {
	return Deps{
		Pending: func(ctx context.Context) map[string]agentask.PendingAsk {
			r.mu.Lock()
			defer r.mu.Unlock()
			out := make(map[string]agentask.PendingAsk, len(r.pending))
			maps.Copy(out, r.pending)
			return out
		},
		Deliver: func(oref, askID string, answers []baseds.AgentAnswerItem) (bool, error) {
			r.mu.Lock()
			fn := r.deliver
			r.mu.Unlock()
			if fn != nil {
				return fn(oref, askID, answers)
			}
			r.recordDelivery(oref, askID, answers)
			r.remove(oref)
			return true, nil
		},
		Who: func(ctx context.Context, oref string) string { return "api-refactor · arcterm" },
		Settings: func() Settings {
			r.mu.Lock()
			defer r.mu.Unlock()
			return r.set
		},
		Token: func() string {
			r.mu.Lock()
			defer r.mu.Unlock()
			return r.token
		},
		SavePair: func(chatID int64, name string) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.saved = append(r.saved, savedPair{chatID, name})
			r.set.ChatID = chatID
			return nil
		},
		APIBase: r.tg.srv.URL,
		Tick:    10 * time.Millisecond,
		Now:     r.now,
	}
}

// now is Deps.Now: the fake clock once setClock has set one.
func (r *rig) now() time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.clock.IsZero() {
		return time.Now()
	}
	return r.clock
}

// setClock freezes the allowed time's clock at t.
func (r *rig) setClock(t time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clock = t
}

// setWhen changes the allowed-time settings only.
func (r *rig) setWhen(w When) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.set.When = w
}

// start runs the bot until the test ends.
func (r *rig) start() {
	r.t.Helper()
	r.bot = New(r.deps())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.bot.Run(ctx)
	}()
	r.t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			r.t.Error("Run did not return after its context ended")
		}
	})
}

// ready waits until the bot has dropped the backlog and polls: an update pushed before that is backlog, and is dropped.
func (r *rig) ready() {
	r.t.Helper()
	r.waitFor("the bot to poll", func() bool { return r.bot.Status().Connected })
}

func (r *rig) recordDelivery(oref, askID string, answers []baseds.AgentAnswerItem) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.delivered = append(r.delivered, delivery{oref, askID, answers})
}

func (r *rig) deliveries() []delivery {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]delivery(nil), r.delivered...)
}

func (r *rig) saves() []savedPair {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]savedPair(nil), r.saved...)
}

func (r *rig) add(oref string, p agentask.PendingAsk) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pending[oref] = p
}

func (r *rig) remove(oref string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.pending, oref)
}

func (r *rig) setSettings(s Settings, token string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.set, r.token = s, token
}

// waitFor polls cond for up to 2 s.
func (r *rig) waitFor(what string, cond func() bool) {
	r.t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			r.t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// waitSent waits for n sendMessage calls and returns them.
func (r *rig) waitSent(n int) []tgCall {
	r.t.Helper()
	r.waitFor(fmt.Sprintf("%d sendMessage calls", n), func() bool { return len(r.tg.callsOf("sendMessage")) >= n })
	return r.tg.callsOf("sendMessage")
}

// waitHandled waits until the bot has moved past update id, which it only does once the update is handled.
func (r *rig) waitHandled(id int) {
	r.t.Helper()
	r.waitFor(fmt.Sprintf("update %d to be handled", id), func() bool {
		for _, c := range r.tg.callsOf("getUpdates") {
			if c.num("offset") > id {
				return true
			}
		}
		return false
	})
}

// old is an ask that has waited past the grace.
func old(id string, qs ...baseds.AgentAskQuestion) agentask.PendingAsk {
	return ask(id, time.Now().UnixMilli()-9000, qs...)
}

func answerItems(idx ...int) baseds.AgentAnswerItem {
	return baseds.AgentAnswerItem{SelectedIndexes: idx}
}

func TestSendsDueAskAfterGrace(t *testing.T) {
	r := newRig(t)
	r.add("block:old", old("old", single("Which strategy?", "Expand-contract", "Big bang")))
	r.add("block:young", ask("young", time.Now().UnixMilli()-1000, single("too early?", "yes")))
	r.start()

	r.waitSent(1)
	time.Sleep(60 * time.Millisecond) // six ticks: nothing else may go out, the young ask is still inside the grace
	sent := r.tg.callsOf("sendMessage")
	if len(sent) != 1 {
		t.Fatalf("sendMessage calls = %d, want 1 (the 1 s old ask must wait out the grace)", len(sent))
	}
	c := sent[0]
	if c.num("chat_id") != int(pairedChat) {
		t.Errorf("chat_id = %v, want %d", c.Body["chat_id"], pairedChat)
	}
	want := "🤖 api-refactor · arcterm\nWhich strategy?\n\nReply to this message to answer in your own words."
	if got := c.str("text"); got != want {
		t.Errorf("text = %q, want %q", got, want)
	}
	if got := c.labels(); !reflect.DeepEqual(got, []string{"Expand-contract", "Big bang"}) {
		t.Errorf("buttons = %v, want the two options", got)
	}
	if _, has := c.Body["parse_mode"]; has {
		t.Errorf("parse_mode is set: a question goes out as plain text")
	}
}

func TestTapDeliversAndEdits(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which strategy?", "Expand-contract", "Big bang")))
	r.start()
	msg := r.waitSent(1)[0]

	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[0][0]))
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })

	want := delivery{"block:a", "a1", []baseds.AgentAnswerItem{answerItems(0)}}
	if got := r.deliveries()[0]; !reflect.DeepEqual(got, want) {
		t.Errorf("Deliver got %+v, want %+v", got, want)
	}
	r.waitFor("the edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) > 0 })
	edits := r.tg.callsOf("editMessageText")
	if got := edits[0].str("text"); got != "✓ Expand-contract" {
		t.Errorf("edited text = %q, want %q", got, "✓ Expand-contract")
	}
	if kb := edits[0].buttons(); len(kb) != 0 {
		t.Errorf("the edit kept the keyboard: %v", kb)
	}
	cb := r.tg.callsOf("answerCallbackQuery")
	if len(cb) != 1 || cb[0].str("callback_query_id") == "" {
		t.Errorf("answerCallbackQuery calls = %+v, want one with the callback's id", cb)
	}
}

func TestAnsweredInAppEditsMessage(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]

	r.remove("block:a")
	r.waitFor("the edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) > 0 })
	edits := r.tg.callsOf("editMessageText")
	if got := edits[0].str("text"); got != "✓ Answered in arcterm" {
		t.Errorf("edited text = %q, want %q", got, "✓ Answered in arcterm")
	}
	if kb := edits[0].buttons(); len(kb) != 0 {
		t.Errorf("the edit kept the keyboard: %v", kb)
	}
	time.Sleep(50 * time.Millisecond)
	if n := len(r.tg.editsOf(msg.MsgID)); n != 1 {
		t.Errorf("the message was edited %d times, want once", n)
	}
	if len(r.deliveries()) != 0 {
		t.Errorf("Deliver was called for an ask answered in the app")
	}
}

func TestFinishedInAppKeepsEarlierTick(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("First?", "x", "y"), single("Second?", "p", "q")))
	r.start()
	first := r.waitSent(1)[0]
	r.tg.push(tap(r.set.ChatID, first.MsgID, first.buttons()[0][0]))
	second := r.waitSent(2)[1]

	r.remove("block:a")
	r.waitFor("the second question's edit", func() bool { return len(r.tg.editsOf(second.MsgID)) > 0 })
	if got := r.tg.editsOf(second.MsgID)[0]; got != "✓ Answered in arcterm" {
		t.Errorf("the open question was edited to %q, want %q", got, "✓ Answered in arcterm")
	}
	time.Sleep(50 * time.Millisecond)
	if edits := r.tg.editsOf(first.MsgID); len(edits) != 1 || edits[0] != "✓ x" {
		t.Errorf("the first question's edits = %q, want only its ✓ x", edits)
	}
}

func TestOtherChatIgnored(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]

	r.tg.push(tap(otherChat, msg.MsgID, msg.buttons()[0][0]))
	r.tg.push(say(otherChat, 5, "hello"))
	last := r.tg.push(replyTo(otherChat, 6, msg.MsgID, "go"))
	r.waitHandled(last)

	if len(r.deliveries()) != 0 {
		t.Errorf("a stranger's tap or reply was delivered: %+v", r.deliveries())
	}
	for _, m := range []string{"answerCallbackQuery", "editMessageText"} {
		if n := len(r.tg.callsOf(m)); n != 0 {
			t.Errorf("%s calls = %d, want none for another chat", m, n)
		}
	}
	if n := len(r.tg.callsOf("sendMessage")); n != 1 {
		t.Errorf("sendMessage calls = %d, want only the ask itself", n)
	}
}

func TestPairingSavesChat(t *testing.T) {
	r := newRig(t)
	r.set.ChatID = 0
	r.start()
	code, _ := r.bot.Pair() // a live code is what holds the session
	r.ready()
	wrong := code[:5] + string('0'+(code[5]-'0'+1)%10)

	bad := r.tg.push(say(42, 10, "/start "+wrong))
	r.waitHandled(bad)
	if len(r.saves()) != 0 {
		t.Fatalf("a wrong code paired the chat: %+v", r.saves())
	}
	r.tg.pushAt(bad+1, Update{Message: &Message{MessageID: 11, Text: "/start " + code,
		Chat: Chat{ID: 42, Title: "Quang's phone", Username: "ignored"}}})
	r.waitFor("the pairing", func() bool { return len(r.saves()) == 1 })

	if got, want := r.saves()[0], (savedPair{42, "Quang's phone"}); got != want {
		t.Errorf("SavePair got %+v, want %+v", got, want)
	}
	sent := r.waitSent(1)
	if sent[0].num("chat_id") != 42 || sent[0].str("text") != "Paired. Agent questions will arrive here." {
		t.Errorf("reply = chat %v %q, want the pairing line to chat 42", sent[0].Body["chat_id"], sent[0].str("text"))
	}
	if st := r.bot.Status(); st.PairCode != "" {
		t.Errorf("the code is still shown after it was used: %+v", st)
	}
}

func TestPairingChatNameFallsBack(t *testing.T) {
	for _, tc := range []struct {
		chat Chat
		want string
	}{
		{Chat{Title: "Team"}, "Team"},
		{Chat{Username: "quang", FirstName: "Q"}, "@quang"},
		{Chat{FirstName: "Quang"}, "Quang"},
	} {
		if got := chatName(tc.chat); got != tc.want {
			t.Errorf("chatName(%+v) = %q, want %q", tc.chat, got, tc.want)
		}
	}
}

func TestPairingGuessesAreLimited(t *testing.T) {
	r := newRig(t)
	r.set.ChatID = 0
	r.start()
	code, _ := r.bot.Pair()
	r.ready()
	wrong := "/start " + code[:5] + string('0'+(code[5]-'0'+1)%10)

	for i := range pairMissLimit {
		r.tg.push(say(otherChat, 20+i, wrong))
	}
	last := r.tg.push(say(otherChat, 30, "/start "+code))
	r.waitHandled(last)

	if len(r.saves()) != 0 {
		t.Errorf("the right code paired after %d wrong ones inside the minute: %+v", pairMissLimit, r.saves())
	}
	if n := len(r.tg.callsOf("sendMessage")); n != 0 {
		t.Errorf("sendMessage calls = %d, want none to an unpaired chat", n)
	}
}

func TestPairingGuessesBlockOnlyTheGuessingChat(t *testing.T) {
	r := newRig(t)
	r.set.ChatID = 0
	r.start()
	code, _ := r.bot.Pair()
	r.ready()
	wrong := "/start " + code[:5] + string('0'+(code[5]-'0'+1)%10)

	for i := range pairMissLimit + 3 {
		r.tg.push(say(otherChat, 20+i, wrong))
	}
	last := r.tg.push(say(42, 40, "/start "+code))
	r.waitHandled(last)

	if s := r.saves(); len(s) != 1 || s[0].Chat != 42 {
		t.Errorf("a stranger's wrong codes kept chat 42 from pairing: saves %+v", s)
	}
}

func TestPairingGuessesCappedAcrossChats(t *testing.T) {
	b := New(Deps{})
	now := time.Now()
	for i := range pairMissGlobalLimit {
		chat := int64(1000 + i/(pairMissLimit-1)) // each chat stays under its own limit
		if b.pairBlocked(chat, now) {
			t.Fatalf("blocked after %d guesses, before the global limit", i)
		}
		b.notePairMiss(chat, now)
	}
	if !b.pairBlocked(42, now) {
		t.Errorf("a fresh chat could still guess past %d guesses from all chats inside the window", pairMissGlobalLimit)
	}
	if b.pairBlocked(42, now.Add(pairMissWindow)) {
		t.Errorf("still blocked once the window passed")
	}
}

func TestUnauthorizedStops(t *testing.T) {
	r := newRig(t)
	r.tg.getMeCode = 401
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what starts the session
	r.start()

	r.waitFor("the rejected token", func() bool { return r.bot.Status().LastError == "Token rejected by Telegram" })
	time.Sleep(50 * time.Millisecond)
	if st := r.bot.Status(); st.Connected {
		t.Errorf("Polling = true after a rejected token")
	}
	if n := len(r.tg.callsOf("getUpdates")); n != 0 {
		t.Errorf("getUpdates calls = %d, want none after getMe was rejected", n)
	}
	if n := len(r.tg.callsOf("getMe")); n != 1 {
		t.Errorf("getMe calls = %d, want 1 (stopped, not retried)", n)
	}
}

func TestUnauthorizedOnUpdatesStops(t *testing.T) {
	r := newRig(t)
	r.tg.updatesCode = func(n int) int {
		if n >= 2 { // the first call is the backlog drop
			return 401
		}
		return 0
	}
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what holds the session
	r.start()

	r.waitFor("the rejected token and the session's end", func() bool {
		st := r.bot.Status()
		return st.LastError == "Token rejected by Telegram" && !st.Connected
	})
	calls := len(r.tg.callsOf("getUpdates"))
	time.Sleep(300 * time.Millisecond)
	if got := len(r.tg.callsOf("getUpdates")); got != calls {
		t.Errorf("getUpdates calls went from %d to %d after the 401", calls, got)
	}
}

func TestConflictReportsAnotherApp(t *testing.T) {
	r := newRig(t)
	r.tg.updatesCode = func(n int) int {
		if n >= 2 {
			return 409
		}
		return 0
	}
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what holds the session
	r.start()

	r.waitFor("the conflict", func() bool { return r.bot.Status().LastError == "Another app is polling this bot" })
	if st := r.bot.Status(); !st.Connected {
		t.Errorf("Polling = false on a 409: the bot keeps backing off, it does not stop")
	}
}

func TestLastErrorClearsOnSuccess(t *testing.T) {
	oldMin := backoffMin
	backoffMin = 5 * time.Millisecond
	t.Cleanup(func() { backoffMin = oldMin })

	r := newRig(t)
	r.tg.updatesCode = func(n int) int {
		if n >= 2 && n <= 4 {
			return 409
		}
		return 0
	}
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what holds the session
	r.start()

	r.waitFor("the conflict", func() bool { return r.bot.Status().LastError == "Another app is polling this bot" })
	r.waitFor("the error to clear", func() bool { return r.bot.Status().LastError == "" })
}

func TestBacklogDroppedFirst(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.tg.pushAt(7, tap(pairedChat, 555, "a:1:0:0"))
	r.start()

	r.waitFor("a poll past the backlog", func() bool { return len(r.tg.callsOf("getUpdates")) >= 3 })
	polls := r.tg.callsOf("getUpdates")
	if got := polls[0].num("offset"); got != -1 {
		t.Errorf("first getUpdates offset = %d, want -1", got)
	}
	if got := polls[1].num("offset"); got != 8 {
		t.Errorf("second getUpdates offset = %d, want 8 (past the last backlog update)", got)
	}
	if n := len(r.tg.callsOf("answerCallbackQuery")); n != 0 {
		t.Errorf("answerCallbackQuery calls = %d: the backlog update was handled", n)
	}
	if len(r.deliveries()) != 0 {
		t.Errorf("the backlog update was delivered: %+v", r.deliveries())
	}
}

func TestNonReplyGetsFixedLine(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what holds the session
	r.start()
	r.waitSent(1)

	r.tg.push(say(pairedChat, 5, "hello there"))
	sent := r.waitSent(2)
	if sent[1].num("chat_id") != int(pairedChat) || sent[1].str("text") != FixedReply {
		t.Errorf("reply = chat %v %q, want FixedReply to the paired chat", sent[1].Body["chat_id"], sent[1].str("text"))
	}
}

func TestDeliveredAskNotEditedAsGone(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "Expand-contract", "Big bang")))
	r.start()
	msg := r.waitSent(1)[0]

	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[1][0]))
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })
	r.waitFor("the tap's edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) > 0 })
	time.Sleep(80 * time.Millisecond) // the delivery cleared the ask: several ticks see it gone

	edits := r.tg.editsOf(msg.MsgID)
	if got := edits[len(edits)-1]; got != "✓ Big bang" {
		t.Errorf("last edit = %q, want %q (edits: %q)", got, "✓ Big bang", edits)
	}
	if n := len(r.tg.callsOf("sendMessage")); n != 1 {
		t.Errorf("sendMessage calls = %d, want 1", n)
	}
}

func TestSlowDeliverSendsOnce(t *testing.T) {
	r := newRig(t)
	r.deliver = func(oref, askID string, answers []baseds.AgentAnswerItem) (bool, error) {
		time.Sleep(300 * time.Millisecond) // the ask stays in the pending map meanwhile
		r.recordDelivery(oref, askID, answers)
		return true, nil
	}
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]

	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[0][0]))
	r.waitFor("the slow delivery", func() bool { return len(r.deliveries()) == 1 })
	if n := len(r.tg.callsOf("sendMessage")); n != 1 {
		t.Errorf("sendMessage calls = %d after the tap, want 1: the answered ask was sent again", n)
	}

	r.remove("block:a") // the agent cleared it
	time.Sleep(80 * time.Millisecond)
	for _, e := range r.tg.editsOf(msg.MsgID) {
		if strings.Contains(e, "Answered in arcterm") {
			t.Errorf("a delivered ask was edited as answered in the app: %q", r.tg.editsOf(msg.MsgID))
		}
	}
	if n := len(r.tg.callsOf("sendMessage")); n != 1 {
		t.Errorf("sendMessage calls = %d at the end, want 1", n)
	}
}

func TestStaleTapEditsTappedMessage(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what holds the session
	r.start()
	r.ready()

	r.tg.push(tap(pairedChat, 555, "a:999:0:0"))
	r.waitFor("the edit", func() bool { return len(r.tg.editsOf(555)) > 0 })

	if got := r.tg.editsOf(555)[0]; got != "✓ Answered in arcterm" {
		t.Errorf("edit = %q, want %q", got, "✓ Answered in arcterm")
	}
	cb := r.tg.callsOf("answerCallbackQuery")
	if len(cb) != 1 || cb[0].str("text") != "Already answered" {
		t.Errorf("answerCallbackQuery calls = %+v, want one with the toast \"Already answered\"", cb)
	}
	if len(r.deliveries()) != 0 {
		t.Errorf("a stale tap was delivered")
	}
}

func TestDeliverErrorEdits(t *testing.T) {
	r := newRig(t)
	r.deliver = func(string, string, []baseds.AgentAnswerItem) (bool, error) { return false, fmt.Errorf("pty closed") }
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]

	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[0][0]))
	r.waitFor("both edits", func() bool { return len(r.tg.editsOf(msg.MsgID)) == 2 })

	edits := r.tg.editsOf(msg.MsgID)
	if want := []string{"✓ x", "Could not answer — open arcterm"}; !reflect.DeepEqual(edits, want) {
		t.Errorf("edits = %q, want %q", edits, want)
	}
}

func TestDeliverRefusedAsAnsweredEditsAsAnswered(t *testing.T) {
	r := newRig(t)
	r.deliver = func(oref string, _ string, _ []baseds.AgentAnswerItem) (bool, error) {
		return false, fmt.Errorf("%w for %s", agentask.ErrNoPendingAsk, oref)
	}
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]

	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[0][0]))
	r.waitFor("both edits", func() bool { return len(r.tg.editsOf(msg.MsgID)) == 2 })

	if got := r.tg.editsOf(msg.MsgID)[1]; got != "✓ Answered in arcterm" {
		t.Errorf("last edit = %q, want %q: the ask was answered in the app first", got, "✓ Answered in arcterm")
	}
}

func TestOffOrNoTokenDoesNothing(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.set.Enabled = false
	r.start()
	time.Sleep(100 * time.Millisecond)
	if n := r.tg.total(); n != 0 {
		t.Fatalf("%d requests reached the API with the bot switched off", n)
	}
	if st := r.bot.Status(); st.Enabled || !st.HasToken || st.Connected {
		t.Errorf("Status = %+v, want off with a token and not polling", st)
	}

	r.setSettings(Settings{Enabled: true, ChatID: pairedChat, When: When{Mode: ModeAlways}}, "")
	r.bot.Poke()
	time.Sleep(100 * time.Millisecond)
	if n := r.tg.total(); n != 0 {
		t.Fatalf("%d requests reached the API with no token", n)
	}
	if st := r.bot.Status(); !st.Enabled || st.HasToken || st.Connected {
		t.Errorf("Status = %+v, want on with no token and not polling", st)
	}

	r.setSettings(Settings{Enabled: true, ChatID: pairedChat, When: When{Mode: ModeAlways}}, "TKN")
	r.bot.Poke()
	r.waitSent(1) // switched on with a token, the pending ask goes out
	if st := r.bot.Status(); !st.Connected || st.BotName != "arc_test_bot" {
		t.Errorf("Status = %+v, want polling as arc_test_bot", st)
	}

	r.setSettings(Settings{Enabled: false, ChatID: pairedChat, When: When{Mode: ModeAlways}}, "TKN")
	r.bot.Poke()
	r.waitFor("polling to stop", func() bool { return !r.bot.Status().Connected })
	calls := r.tg.total()
	time.Sleep(100 * time.Millisecond)
	if got := r.tg.total(); got != calls {
		t.Errorf("%d requests reached the API after the bot was switched off", got-calls)
	}
}

func TestTokenChangeRestartsSession(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what holds the session
	r.start()
	r.waitFor("polling", func() bool { return r.bot.Status().Connected })

	r.setSettings(Settings{Enabled: true, ChatID: pairedChat, When: When{Mode: ModeAlways}}, "NEW")
	r.bot.Poke()
	r.waitFor("a poll on the new token", func() bool {
		for _, c := range r.tg.callsOf("getUpdates") {
			if c.Token == "NEW" {
				return true
			}
		}
		return false
	})
	for _, c := range r.tg.callsOf("getMe") {
		if c.Token != "TKN" && c.Token != "NEW" {
			t.Errorf("getMe used token %q", c.Token)
		}
	}
	if n := len(r.tg.callsOf("getMe")); n != 2 {
		t.Errorf("getMe calls = %d, want 2 (one per token)", n)
	}

	// An unchanged token keeps the running session.
	r.bot.Poke()
	time.Sleep(60 * time.Millisecond)
	if n := len(r.tg.callsOf("getMe")); n != 2 {
		t.Errorf("getMe calls = %d after a poke with the same token, want 2", n)
	}
}

func TestRejectedTokenIsRetriedOnPoke(t *testing.T) {
	r := newRig(t)
	r.tg.getMeCode = 401
	r.add("block:a", old("a1", single("Which?", "x", "y"))) // a question is what holds the session
	r.start()
	r.waitFor("the rejected token", func() bool { return r.bot.Status().LastError == "Token rejected by Telegram" })

	r.tg.mu.Lock()
	r.tg.getMeCode = 0
	r.tg.mu.Unlock()
	r.bot.Poke() // same token: the user fixed it on BotFather's side
	r.waitFor("polling", func() bool { return r.bot.Status().Connected })
	if st := r.bot.Status(); st.LastError != "" {
		t.Errorf("LastError = %q after a good getMe, want none", st.LastError)
	}
}

func TestReplyDeliversText(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]
	time.Sleep(20 * time.Millisecond) // the bot records a message's id just after Telegram answers; a reply keys on it

	r.tg.push(replyTo(pairedChat, 7000, msg.MsgID, "  go ahead, but keep the old column  "))
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })

	want := delivery{"block:a", "a1", []baseds.AgentAnswerItem{{Text: "go ahead, but keep the old column"}}}
	if got := r.deliveries()[0]; !reflect.DeepEqual(got, want) {
		t.Errorf("Deliver got %+v, want %+v", got, want)
	}
	r.waitFor("the edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) > 0 })
	if got := r.tg.editsOf(msg.MsgID)[0]; got != `✓ "go ahead, but keep the old column"` {
		t.Errorf("edit = %q", got)
	}
}

func TestReplyToAnsweredQuestionGetsAlreadyAnswered(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]
	time.Sleep(20 * time.Millisecond) // the bot records a message's id just after Telegram answers
	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[0][0]))
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })

	r.tg.push(replyTo(pairedChat, 7001, msg.MsgID, "actually, the other one"))
	sent := r.waitSent(2)
	if got := sent[1].str("text"); got != "Already answered." {
		t.Errorf("reply = %q, want %q", got, "Already answered.")
	}
	if n := len(r.deliveries()); n != 1 {
		t.Errorf("deliveries = %d, want 1", n)
	}
}

func TestTwoQuestionsDeliverTogether(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("First?", "a", "b"), single("Second?", "c", "d")))
	r.start()
	first := r.waitSent(1)[0]

	r.tg.push(tap(pairedChat, first.MsgID, first.buttons()[1][0]))
	second := r.waitSent(2)[1]
	if !strings.Contains(second.str("text"), "Second?") {
		t.Errorf("second message = %q, want the second question", second.str("text"))
	}
	if n := len(r.deliveries()); n != 0 {
		t.Fatalf("delivered after one of two questions: %+v", r.deliveries())
	}
	if got := r.tg.editsOf(first.MsgID); !reflect.DeepEqual(got, []string{"✓ b"}) {
		t.Errorf("first message edits = %q, want [✓ b]", got)
	}

	r.tg.push(tap(pairedChat, second.MsgID, second.buttons()[0][0]))
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })
	want := delivery{"block:a", "a1", []baseds.AgentAnswerItem{answerItems(1), answerItems(0)}}
	if got := r.deliveries()[0]; !reflect.DeepEqual(got, want) {
		t.Errorf("Deliver got %+v, want %+v", got, want)
	}
}

func TestMultiSelectToggleRekeys(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", multi("Which files?", "A", "B", "C")))
	r.start()
	msg := r.waitSent(1)[0]
	rows := msg.buttons()

	r.tg.push(tap(pairedChat, msg.MsgID, rows[0][0])) // toggle A on
	r.waitFor("the keyboard edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) == 1 })
	edit := r.tg.callsOf("editMessageText")[0]
	if got := edit.labels(); !reflect.DeepEqual(got, []string{"☑ A", "☐ B", "☐ C", "Send"}) {
		t.Errorf("keyboard after the toggle = %q", got)
	}
	if got := edit.str("text"); got != msg.str("text") {
		t.Errorf("the toggle changed the text: %q, want %q", got, msg.str("text"))
	}
	if n := len(r.deliveries()); n != 0 {
		t.Fatalf("a toggle delivered: %+v", r.deliveries())
	}

	r.tg.push(tap(pairedChat, msg.MsgID, rows[2][0])) // toggle C on
	r.tg.push(tap(pairedChat, msg.MsgID, rows[3][0])) // Send
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })
	want := delivery{"block:a", "a1", []baseds.AgentAnswerItem{answerItems(0, 2)}}
	if got := r.deliveries()[0]; !reflect.DeepEqual(got, want) {
		t.Errorf("Deliver got %+v, want %+v", got, want)
	}
}

func TestFailedSendIsRetried(t *testing.T) {
	r := newRig(t)
	r.tg.sendCode = func(n int) int {
		if n <= 2 {
			return 500
		}
		return 0
	}
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()

	r.waitFor("a send error", func() bool { return r.bot.Status().LastError != "" })
	r.waitFor("the third try to land", func() bool {
		return len(r.tg.callsOf("sendMessage")) == 3 && r.bot.Status().LastError == ""
	})
	time.Sleep(60 * time.Millisecond)
	if n := len(r.tg.callsOf("sendMessage")); n != 3 {
		t.Errorf("sendMessage calls = %d, want 3 (two failures, then one message that is not sent again)", n)
	}
	msg := r.tg.callsOf("sendMessage")[2]
	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[0][0]))
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })
}

func TestRepairingToAnotherChatForgetsOldMessages(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	r.waitSent(1)

	r.setSettings(Settings{Enabled: true, ChatID: otherChat, When: When{Mode: ModeAlways}}, "TKN")
	sent := r.waitSent(2)
	if got := sent[1].num("chat_id"); got != int(otherChat) {
		t.Errorf("the ask went to chat %d after re-pairing, want %d", got, otherChat)
	}
	r.remove("block:a")
	time.Sleep(60 * time.Millisecond)
	for _, c := range r.tg.callsOf("editMessageText") {
		if c.num("chat_id") == int(otherChat) && c.num("message_id") == sent[0].MsgID {
			t.Errorf("an old chat's message id was edited in the new chat: %+v", c.Body)
		}
	}
}

// withLinger shrinks idleLinger for the test. Call it before r.start(): the start's cleanup then runs first, with Run
// returned before the old value comes back.
func withLinger(t *testing.T, d time.Duration) {
	t.Helper()
	was := idleLinger
	idleLinger = d
	t.Cleanup(func() { idleLinger = was })
}

// wed returns h:m on Wednesday 2026-10-14 in the local zone; thu is the day after.
func wed(h, m int) time.Time { return time.Date(2026, 10, 14, h, m, 0, 0, time.Local) }

func thu(h, m int) time.Time { return time.Date(2026, 10, 15, h, m, 0, 0, time.Local) }

func officeHours(t *testing.T) When {
	t.Helper()
	sc, err := ParseSchedule("")
	if err != nil {
		t.Fatalf("ParseSchedule(\"\"): %v", err)
	}
	return When{Mode: ModeSchedule, Schedule: sc}
}

// waitName waits for the bot to learn its name, which the idle bot's one getMe does.
func (r *rig) waitName() {
	r.t.Helper()
	r.waitFor("the bot's name", func() bool { return r.bot.Status().BotName == "arc_test_bot" })
}

func TestNewWhenReadsSettings(t *testing.T) {
	until := int64(1_800_000_000_000)
	w, err := NewWhen("schedule", "mon,wed 09:00-12:00", &until)
	if err != nil {
		t.Fatalf("NewWhen: %v", err)
	}
	if w.Mode != ModeSchedule || !w.OnUntil.Equal(time.UnixMilli(until)) || !w.Schedule.Days[time.Monday] ||
		w.Schedule.Days[time.Tuesday] || w.Schedule.Start != 9*60 || w.Schedule.End != 12*60 {
		t.Errorf("When = %+v, want schedule mon,wed 09:00-12:00 until %d", w, until)
	}

	office, _ := ParseSchedule("")
	w, err = NewWhen("", "", nil)
	if err != nil || w.Mode != "" || w.Schedule != office || !w.OnUntil.IsZero() {
		t.Errorf("NewWhen of nothing = %+v, %v; want manual, office hours, no OnUntil", w, err)
	}

	zero := int64(0)
	w, _ = NewWhen("", "", &zero)
	if !w.OnUntil.IsZero() {
		t.Errorf("OnUntil 0 = %v, want none", w.OnUntil)
	}

	w, err = NewWhen("schedule", "funday 9-5", nil)
	if err == nil || w.Schedule != office {
		t.Errorf("a bad schedule = %+v, %v; want office hours and the parse error", w, err)
	}
}

func TestIdleWithoutQuestionsMakesNoRequests(t *testing.T) {
	r := newRig(t)
	r.start()
	r.waitName()

	time.Sleep(100 * time.Millisecond) // ten ticks
	if n := len(r.tg.callsOf("getMe")); n != 1 {
		t.Errorf("getMe calls = %d, want 1 (the validation)", n)
	}
	if n := len(r.tg.callsOf("getUpdates")); n != 0 {
		t.Errorf("getUpdates calls = %d, want none with no question open", n)
	}
	if st := r.bot.Status(); st.Connected || !st.Allowed || st.Open != 0 {
		t.Errorf("Status = %+v, want allowed, not connected, nothing open", st)
	}
}

func TestValidationRejectsOnce(t *testing.T) {
	r := newRig(t)
	r.set.When = When{Mode: ModeManual}
	r.tg.getMeCode = 401
	r.start()
	r.waitFor("the rejected token", func() bool { return r.bot.Status().LastError == "Token rejected by Telegram" })

	time.Sleep(100 * time.Millisecond)
	if n := len(r.tg.callsOf("getMe")); n != 1 {
		t.Errorf("getMe calls = %d after ten ticks, want 1", n)
	}

	r.bot.Poke() // the same token: the person fixed it on BotFather's side
	r.waitFor("a second getMe", func() bool { return len(r.tg.callsOf("getMe")) == 2 })
	time.Sleep(50 * time.Millisecond)
	if n := len(r.tg.callsOf("getMe")); n != 2 {
		t.Errorf("getMe calls = %d, want 2 (one per poke)", n)
	}
	if n := len(r.tg.callsOf("getUpdates")); n != 0 {
		t.Errorf("getUpdates calls = %d, want none", n)
	}
}

func TestValidationNamesTheBotOnSwitchOn(t *testing.T) {
	r := newRig(t)
	r.set.Enabled = false
	r.start()
	time.Sleep(50 * time.Millisecond)
	if n := r.tg.total(); n != 0 {
		t.Fatalf("%d requests with the bot off", n)
	}

	r.setSettings(Settings{Enabled: true, ChatID: pairedChat, When: When{Mode: ModeManual}}, "TKN")
	r.bot.Poke()
	r.waitName()
	time.Sleep(50 * time.Millisecond)
	if n := r.tg.total(); n != 1 {
		t.Errorf("requests = %d, want 1 getMe outside the allowed time", n)
	}
}

func TestQuestionConnectsThenDisconnects(t *testing.T) {
	withLinger(t, 150*time.Millisecond)
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]
	if n := len(r.tg.callsOf("getMe")); n != 1 {
		t.Errorf("getMe calls = %d, want 1", n)
	}
	if n := len(r.tg.callsOf("getUpdates")); n == 0 {
		t.Errorf("no getUpdates: the session never polled")
	}
	r.waitFor("one question open", func() bool { return r.bot.Status().Open == 1 })

	r.remove("block:a")
	r.waitFor("the edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) > 0 })
	r.waitFor("the disconnect", func() bool { return !r.bot.Status().Connected })
	if st := r.bot.Status(); st.Open != 0 {
		t.Errorf("Open = %d after the ask left, want 0", st.Open)
	}
	calls := r.tg.total()
	time.Sleep(100 * time.Millisecond)
	if got := r.tg.total(); got != calls {
		t.Errorf("%d requests after the disconnect, want none", got-calls)
	}

	r.add("block:b", old("b1", single("Again?", "x", "y")))
	r.waitSent(2) // a new question connects again
	if n := len(r.tg.callsOf("getMe")); n != 2 {
		t.Errorf("getMe calls = %d, want 2 (one per session)", n)
	}
}

func TestNotAllowedNeverConnects(t *testing.T) {
	r := newRig(t)
	r.set.When = When{Mode: ModeManual}
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	r.waitName()

	time.Sleep(100 * time.Millisecond)
	for _, m := range []string{"getUpdates", "sendMessage"} {
		if n := len(r.tg.callsOf(m)); n != 0 {
			t.Errorf("%s calls = %d outside the allowed time, want none", m, n)
		}
	}
	if st := r.bot.Status(); st.Allowed || st.Connected {
		t.Errorf("Status = %+v, want not allowed and not connected", st)
	}
}

func TestUnpairedAskDoesNotConnect(t *testing.T) {
	r := newRig(t)
	r.set.ChatID = 0
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	r.waitName()

	time.Sleep(100 * time.Millisecond)
	if n := len(r.tg.callsOf("getUpdates")); n != 0 {
		t.Errorf("getUpdates calls = %d with no paired chat to send to, want none", n)
	}
}

func TestManualOnUntilAllowsThenEnds(t *testing.T) {
	r := newRig(t)
	r.set.When = When{Mode: ModeManual, OnUntil: time.Now().Add(500 * time.Millisecond)}
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]
	if st := r.bot.Status(); !st.Allowed || st.AllowedUntil == 0 {
		t.Errorf("Status = %+v, want allowed with an end", st)
	}

	r.waitFor("the closing edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) > 0 })
	if got := r.tg.editsOf(msg.MsgID)[0]; got != "— Telegram is off; answer in arcterm" {
		t.Errorf("edit = %q, want the off line with no next start", got)
	}
	r.waitFor("the disconnect", func() bool { return !r.bot.Status().Connected })
	if st := r.bot.Status(); st.Allowed || st.Open != 0 {
		t.Errorf("Status = %+v, want not allowed and nothing open", st)
	}
	calls := r.tg.total()
	time.Sleep(100 * time.Millisecond)
	if got := r.tg.total(); got != calls {
		t.Errorf("%d requests after the allowed time ended, want none", got-calls)
	}
}

func TestScheduleEndEditsWithNextStart(t *testing.T) {
	r := newRig(t)
	r.set.When = officeHours(t)
	r.setClock(wed(17, 29))
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]

	r.setClock(wed(17, 31))
	r.waitFor("the closing edit", func() bool { return len(r.tg.editsOf(msg.MsgID)) > 0 })
	if got := r.tg.editsOf(msg.MsgID)[0]; got != "— Telegram is off until Thu 08:00" {
		t.Errorf("edit = %q, want the off line with Thursday's start", got)
	}
	r.waitFor("the disconnect", func() bool { return !r.bot.Status().Connected })
	st := r.bot.Status()
	if st.Allowed || st.NextAllowed != thu(8, 0).UnixMilli() || st.Open != 0 {
		t.Errorf("Status = %+v, want not allowed, next Thu 08:00 (%d), nothing open", st, thu(8, 0).UnixMilli())
	}
	if n := len(r.tg.callsOf("sendMessage")); n != 1 {
		t.Fatalf("sendMessage calls = %d while off, want 1", n)
	}

	r.setClock(thu(8, 1)) // the ask is still pending: it goes out again, as a new message
	again := r.waitSent(2)[1]
	if again.MsgID == msg.MsgID || !strings.Contains(again.str("text"), "Which?") {
		t.Errorf("second send = %+v, want a new message with the question", again)
	}
	r.waitFor("the reconnect", func() bool { return r.bot.Status().Connected })
}

func TestStatusReportsAllowedTime(t *testing.T) {
	r := newRig(t)
	r.set.When = officeHours(t)
	r.setClock(wed(10, 0))
	r.start()

	st := r.bot.Status()
	if !st.Allowed || st.AllowedUntil != wed(17, 30).UnixMilli() || st.NextAllowed != 0 {
		t.Errorf("Status = %+v, want allowed until Wed 17:30 (%d) with no next start", st, wed(17, 30).UnixMilli())
	}

	r.setClock(wed(18, 0))
	st = r.bot.Status()
	if st.Allowed || st.AllowedUntil != 0 || st.NextAllowed != thu(8, 0).UnixMilli() {
		t.Errorf("Status = %+v, want not allowed, next Thu 08:00 (%d)", st, thu(8, 0).UnixMilli())
	}

	r.setSettings(Settings{Enabled: false, ChatID: pairedChat, When: officeHours(t)}, "TKN")
	if st := r.bot.Status(); st.Allowed || st.NextAllowed != 0 {
		t.Errorf("Status = %+v with the bot off, want no allowed time", st)
	}
}

func TestPairCodeConnectsOutsideAllowedTime(t *testing.T) {
	withLinger(t, 150*time.Millisecond)
	r := newRig(t)
	r.set.ChatID = 0
	r.set.When = When{Mode: ModeManual}
	r.start()
	r.waitName()
	if n := len(r.tg.callsOf("getUpdates")); n != 0 {
		t.Fatalf("getUpdates calls = %d before a code, want none", n)
	}

	code, _ := r.bot.Pair()
	r.ready()
	r.tg.push(say(pairedChat, 10, "/start "+code))
	r.waitFor("the pairing", func() bool { return len(r.saves()) == 1 })
	if sent := r.waitSent(1); sent[0].str("text") != replyPaired {
		t.Errorf("reply = %q, want the pairing line", sent[0].str("text"))
	}

	r.waitFor("the session to stop once the code was used", func() bool { return !r.bot.Status().Connected })
	calls := r.tg.total()
	time.Sleep(100 * time.Millisecond)
	if got := r.tg.total(); got != calls {
		t.Errorf("%d requests after the pairing, want none", got-calls)
	}
}

func TestPairingOutsideAllowedTimeSendsNoQuestions(t *testing.T) {
	withLinger(t, 150*time.Millisecond)
	r := newRig(t)
	r.set.ChatID = 0
	r.set.When = When{Mode: ModeManual}
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	r.waitName()

	code, _ := r.bot.Pair()
	r.ready()
	r.tg.push(say(pairedChat, 10, "/start "+code))
	r.waitFor("the pairing", func() bool { return len(r.saves()) == 1 })
	r.waitSent(1)

	time.Sleep(100 * time.Millisecond) // the chat is paired now: several ticks must still send no question
	sent := r.tg.callsOf("sendMessage")
	if len(sent) != 1 || sent[0].str("text") != replyPaired {
		t.Errorf("sendMessage calls = %+v, want only the pairing reply", sent)
	}
	if st := r.bot.Status(); st.Open != 0 {
		t.Errorf("Open = %d, want 0 outside the allowed time", st.Open)
	}
}

func TestReconnectDoesNotResend(t *testing.T) {
	r := newRig(t)
	failing := false // read by the fake under its lock
	r.tg.updatesCode = func(n int) int {
		if failing {
			return 401
		}
		return 0
	}
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	msg := r.waitSent(1)[0]
	time.Sleep(20 * time.Millisecond) // the bot records a message's id just after Telegram answers

	r.tg.mu.Lock()
	failing = true
	r.tg.mu.Unlock()
	r.waitFor("the session to end on the 401", func() bool {
		st := r.bot.Status()
		return st.LastError == "Token rejected by Telegram" && !st.Connected
	})
	if st := r.bot.Status(); st.Open != 1 {
		t.Errorf("Open = %d after the session ended, want the question kept", st.Open)
	}

	r.tg.mu.Lock()
	failing = false
	r.tg.mu.Unlock()
	polls := len(r.tg.callsOf("getUpdates"))
	r.bot.Poke() // the same token
	r.waitFor("a new session", func() bool { return r.bot.Status().Connected && len(r.tg.callsOf("getUpdates")) > polls })
	time.Sleep(60 * time.Millisecond)
	if n := len(r.tg.callsOf("sendMessage")); n != 1 {
		t.Errorf("sendMessage calls = %d after the reconnect, want 1 (the question was not sent again)", n)
	}

	r.tg.push(tap(pairedChat, msg.MsgID, msg.buttons()[0][0]))
	r.waitFor("the delivery", func() bool { return len(r.deliveries()) == 1 })
	want := delivery{"block:a", "a1", []baseds.AgentAnswerItem{answerItems(0)}}
	if got := r.deliveries()[0]; !reflect.DeepEqual(got, want) {
		t.Errorf("Deliver got %+v, want %+v", got, want)
	}
}

func TestNewTokenSendsOpenQuestionsAgain(t *testing.T) {
	r := newRig(t)
	r.add("block:a", old("a1", single("Which?", "x", "y")))
	r.start()
	r.waitSent(1)

	r.setSettings(Settings{Enabled: true, ChatID: pairedChat, When: When{Mode: ModeAlways}}, "NEW")
	r.bot.Poke()
	sent := r.waitSent(2) // another bot never saw the first message
	if sent[1].Token != "NEW" {
		t.Errorf("second send used token %q, want the new one", sent[1].Token)
	}
}
