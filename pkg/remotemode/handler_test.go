// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

const (
	handlerTestOrigin = "https://arc.example.com"
	handlerTestVapid  = "BPubKey"
)

type handlerFake struct {
	mu         sync.Mutex
	verifyErr  error
	answerErr  error
	answered   []handlerAnswerBody
	subscribed []PushSubscription
	offCalls   chan struct{}
	handed     []HandedAgent
	stream     func(ctx context.Context, tab string, sink StreamSink) error
	actErr     error
	acted      []handlerActCall
	takenBack  []string
}

type handlerActCall struct {
	tab string
	act AgentAction
}

func handlerNewFake() *handlerFake {
	return &handlerFake{offCalls: make(chan struct{}, 4)}
}

func (f *handlerFake) handler() http.Handler {
	return NewHandler(Deps{
		Static: fstest.MapFS{
			"index.html":           {Data: []byte("<html>phone</html>")},
			"phone.js":             {Data: []byte("export {}")},
			"manifest.webmanifest": {Data: []byte(`{"name":"Arc"}`)},
			"fonts/a.woff2":        {Data: []byte("not really a font")},
		},
		Verify:      func(*http.Request) error { return f.verifyErr },
		Origin:      handlerTestOrigin,
		VapidPublic: handlerTestVapid,
		Waiting: func(context.Context) (WaitingList, error) {
			return WaitingList{Questions: []WaitingQuestion{{Key: "ask:b", ORef: "b", AskId: "a1"}}}, nil
		},
		Answer: func(_ context.Context, oref, askID string, answers []baseds.AgentAnswerItem) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.answered = append(f.answered, handlerAnswerBody{ORef: oref, AskId: askID, Answers: answers})
			return f.answerErr
		},
		Off: func(context.Context) error {
			f.offCalls <- struct{}{}
			return nil
		},
		Subscribe: func(_ context.Context, sub PushSubscription) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.subscribed = append(f.subscribed, sub)
			return nil
		},
		Handed: func(context.Context) ([]HandedAgent, error) { return f.handed, nil },
		Stream: func(ctx context.Context, tab string, sink StreamSink) error {
			return f.stream(ctx, tab, sink)
		},
		Act: func(_ context.Context, tab string, act AgentAction) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.acted = append(f.acted, handlerActCall{tab, act})
			return f.actErr
		},
		TakeBack: func(_ context.Context, tab string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.takenBack = append(f.takenBack, tab)
			return f.actErr
		},
	})
}

func handlerDo(t *testing.T, h http.Handler, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func handlerPostJSON(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	return handlerDo(t, h, http.MethodPost, path, body, map[string]string{"Content-Type": "application/json", "Origin": handlerTestOrigin})
}

const handlerTestAnswer = `{"oref":"block:1","askid":"a1","answers":[{"selectedindexes":[0,2]},{"text":"own words"}]}`

const handlerTestSub = `{"endpoint":"https://push.example.com/sub/1","expirationTime":null,"keys":{"p256dh":"P","auth":"A"}}`

func TestHandlerRefusesEveryRouteWithoutAccess(t *testing.T) {
	f := handlerNewFake()
	f.verifyErr = errors.New("missing header")
	h := f.handler()
	for _, rt := range []struct{ method, path, body string }{
		{http.MethodGet, "/", ""},
		{http.MethodGet, "/index.html", ""},
		{http.MethodGet, "/phone.js", ""},
		{http.MethodGet, "/no-such-file", ""},
		{http.MethodGet, "/api/waiting", ""},
		{http.MethodPost, "/api/answer", handlerTestAnswer},
		{http.MethodPost, "/api/off", "{}"},
		{http.MethodPost, "/api/subscribe", handlerTestSub},
	} {
		rec := handlerDo(t, h, rt.method, rt.path, rt.body, map[string]string{"Content-Type": "application/json", "Origin": handlerTestOrigin})
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: got %d, want 403", rt.method, rt.path, rec.Code)
		}
		if rec.Body.Len() != 0 {
			t.Errorf("%s %s: 403 body should be bare, got %q", rt.method, rt.path, rec.Body.String())
		}
	}
	if len(f.answered) != 0 || len(f.subscribed) != 0 || len(f.offCalls) != 0 {
		t.Fatalf("a refused request reached a dep: %+v", f)
	}
}

func TestHandlerServesStatic(t *testing.T) {
	h := handlerNewFake().handler()
	for path, want := range map[string]string{"/": "<html>phone</html>", "/phone.js": "export {}"} {
		rec := handlerDo(t, h, http.MethodGet, path, "", nil)
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Errorf("GET %s: got %d %q", path, rec.Code, rec.Body.String())
		}
	}
}

func TestHandlerStaticContentTypes(t *testing.T) {
	h := handlerNewFake().handler()
	for path, want := range map[string]string{
		"/manifest.webmanifest": "application/manifest+json",
		"/fonts/a.woff2":        "font/woff2",
		"/phone.js":             "text/javascript; charset=utf-8",
	} {
		rec := handlerDo(t, h, http.MethodGet, path, "", nil)
		if got := rec.Header().Get("Content-Type"); rec.Code != http.StatusOK || got != want {
			t.Errorf("GET %s: got %d %q, want %q", path, rec.Code, got, want)
		}
	}
}

func TestHandlerPostRefusesNonJSON(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	for _, path := range []string{"/api/answer", "/api/off", "/api/subscribe"} {
		rec := handlerDo(t, h, http.MethodPost, path, handlerTestAnswer, map[string]string{"Content-Type": "text/plain", "Origin": handlerTestOrigin})
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Errorf("POST %s text/plain: got %d, want 415", path, rec.Code)
		}
	}
	if len(f.answered) != 0 || len(f.offCalls) != 0 {
		t.Fatalf("a non-json post reached a dep")
	}
}

func TestHandlerPostChecksOrigin(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	for _, origin := range []string{"https://evil.example", "", "http://arc.example.com", handlerTestOrigin + ".evil.example"} {
		rec := handlerDo(t, h, http.MethodPost, "/api/answer", handlerTestAnswer, map[string]string{"Content-Type": "application/json", "Origin": origin})
		if rec.Code != http.StatusForbidden {
			t.Errorf("origin %q: got %d, want 403", origin, rec.Code)
		}
	}
	if len(f.answered) != 0 {
		t.Fatalf("a cross-origin post reached Answer")
	}
	rec := handlerDo(t, h, http.MethodPost, "/api/answer", handlerTestAnswer, map[string]string{"Content-Type": "application/json; charset=utf-8", "Origin": handlerTestOrigin})
	if rec.Code != http.StatusOK {
		t.Fatalf("own origin: got %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandlerAnswer(t *testing.T) {
	f := handlerNewFake()
	rec := handlerPostJSON(t, f.handler(), "/api/answer", handlerTestAnswer)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	want := []handlerAnswerBody{{ORef: "block:1", AskId: "a1", Answers: []baseds.AgentAnswerItem{{SelectedIndexes: []int{0, 2}}, {Text: "own words"}}}}
	if !reflect.DeepEqual(f.answered, want) {
		t.Fatalf("Answer got %+v, want %+v", f.answered, want)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control %q", cc)
	}
}

func TestHandlerAnswerGone(t *testing.T) {
	f := handlerNewFake()
	f.answerErr = ErrAskGone
	rec := handlerPostJSON(t, f.handler(), "/api/answer", handlerTestAnswer)
	if rec.Code != http.StatusConflict || strings.TrimSpace(rec.Body.String()) != `{"error":"gone"}` {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestHandlerAnswerMalformed(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	for _, body := range []string{
		`not json`,
		`{"askid":"a1","answers":[{"text":"x"}]}`,
		`{"oref":"block:1","answers":[{"text":"x"}]}`,
		`{"oref":"block:1","askid":"a1","answers":[]}`,
		`{"oref":"block:1","askid":"a1"}`,
	} {
		if rec := handlerPostJSON(t, h, "/api/answer", body); rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: got %d, want 400", body, rec.Code)
		}
	}
	if len(f.answered) != 0 {
		t.Fatalf("a malformed answer reached Answer: %+v", f.answered)
	}
}

func TestHandlerWaiting(t *testing.T) {
	rec := handlerDo(t, handlerNewFake().handler(), http.MethodGet, "/api/waiting", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control %q", cc)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(got["vapidpublic"]) != `"`+handlerTestVapid+`"` {
		t.Errorf("vapidpublic %s", got["vapidpublic"])
	}
	if string(got["shown"]) != "[]" {
		t.Errorf("shown should be [] when the list has none, got %s", got["shown"])
	}
	if !strings.Contains(string(got["questions"]), `"askid":"a1"`) {
		t.Errorf("questions %s", got["questions"])
	}
}

func TestHandlerOff(t *testing.T) {
	f := handlerNewFake()
	rec := handlerPostJSON(t, f.handler(), "/api/off", "{}")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	select {
	case <-f.offCalls:
	case <-time.After(2 * time.Second):
		t.Fatal("Off was not called")
	}
	select {
	case <-f.offCalls:
		t.Fatal("Off was called twice")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHandlerSubscribe(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	rec := handlerPostJSON(t, h, "/api/subscribe", handlerTestSub)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	var want PushSubscription
	want.Endpoint = "https://push.example.com/sub/1"
	want.Keys.P256dh = "P"
	want.Keys.Auth = "A"
	if !reflect.DeepEqual(f.subscribed, []PushSubscription{want}) {
		t.Fatalf("Subscribe got %+v", f.subscribed)
	}
	for _, body := range []string{
		`{"endpoint":"http://push.example.com/x","keys":{"p256dh":"P","auth":"A"}}`,
		`{"endpoint":"https://push.example.com/x","keys":{"auth":"A"}}`,
		`{"keys":{"p256dh":"P","auth":"A"}}`,
	} {
		if rec := handlerPostJSON(t, h, "/api/subscribe", body); rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: got %d, want 400", body, rec.Code)
		}
	}
	if len(f.subscribed) != 1 {
		t.Fatalf("an invalid subscription reached Subscribe: %+v", f.subscribed)
	}
}

func TestWaitingIncludesHanded(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	decode := func() map[string]json.RawMessage {
		rec := handlerDo(t, h, http.MethodGet, "/api/waiting", "", nil)
		var got map[string]json.RawMessage
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
			t.Fatalf("GET /api/waiting = %d %s", rec.Code, rec.Body.String())
		}
		return got
	}
	if got := decode(); string(got["handed"]) != "[]" {
		t.Errorf("handed should be [] when none is handed over, got %s", got["handed"])
	}
	f.handed = []HandedAgent{{Tab: "tab-a", Name: "siem-deploy", Runtime: "claude", State: PhonePermission, Since: 5, Line: "Wants to run: ssh"}}
	want := `[{"tab":"tab-a","name":"siem-deploy","project":"","runtime":"claude","state":"permission","since":5,"line":"Wants to run: ssh"}]`
	if got := decode(); string(got["handed"]) != want {
		t.Errorf("handed = %s, want %s", got["handed"], want)
	}
}

// handlerSSEEvent is one SSE frame; a comment frame has only comment set.
type handlerSSEEvent struct{ name, data, comment string }

func handlerReadEvent(br *bufio.Reader) (handlerSSEEvent, error) {
	var ev handlerSSEEvent
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return ev, err
		}
		line = strings.TrimSuffix(line, "\n")
		switch {
		case line == "":
			return ev, nil
		case strings.HasPrefix(line, ":"):
			ev.comment = strings.TrimSpace(line[1:])
		case strings.HasPrefix(line, "event: "):
			ev.name = line[len("event: "):]
		case strings.HasPrefix(line, "data: "):
			ev.data = line[len("data: "):]
		}
	}
}

func handlerOpenStream(t *testing.T, h http.Handler, tab string) (*http.Response, *bufio.Reader) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	resp, err := http.Get(srv.URL + "/api/agents/" + tab + "/stream")
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp, bufio.NewReader(resp.Body)
}

func TestStreamFramesAgentLinesAndEnded(t *testing.T) {
	f := handlerNewFake()
	var gotTab string
	f.stream = func(_ context.Context, tab string, sink StreamSink) error {
		gotTab = tab
		if err := sink.Agent(HandedAgent{Tab: tab, Name: "phone-chat", State: PhoneWorking}); err != nil {
			return err
		}
		if err := sink.Lines([]string{`{"type":"user"}`, `{"type":"assistant"}`}); err != nil {
			return err
		}
		return &GoneError{Reason: EndExited}
	}
	resp, br := handlerOpenStream(t, f.handler(), "tab-a")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	for k, want := range map[string]string{"Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no"} {
		if got := resp.Header.Get(k); got != want {
			t.Errorf("header %s = %q, want %q", k, got, want)
		}
	}
	want := []handlerSSEEvent{
		{name: "agent", data: `{"tab":"tab-a","name":"phone-chat","project":"","runtime":"","state":"working","since":0,"line":""}`},
		{name: "lines", data: `{"lines":["{\"type\":\"user\"}","{\"type\":\"assistant\"}"]}`},
		{name: "ended", data: `{"reason":"exited"}`},
	}
	for i, w := range want {
		ev, err := handlerReadEvent(br)
		if err != nil || ev != w {
			t.Fatalf("event %d = %+v (err %v), want %+v", i, ev, err, w)
		}
	}
	if _, err := handlerReadEvent(br); !errors.Is(err, io.EOF) {
		t.Errorf("the stream must close after ended, got %v", err)
	}
	if gotTab != "tab-a" {
		t.Errorf("Stream got tab %q", gotTab)
	}
}

func TestStreamHeartbeat(t *testing.T) {
	prev := remoteStreamHeartbeat
	remoteStreamHeartbeat = 50 * time.Millisecond
	t.Cleanup(func() { remoteStreamHeartbeat = prev })
	f := handlerNewFake()
	returned := make(chan error, 1)
	f.stream = func(ctx context.Context, _ string, _ StreamSink) error {
		<-ctx.Done()
		returned <- nil
		return nil
	}
	resp, br := handlerOpenStream(t, f.handler(), "tab-a")
	ev, err := handlerReadEvent(br)
	if err != nil || ev != (handlerSSEEvent{comment: "ping"}) {
		t.Fatalf("first frame = %+v (err %v), want a ping comment", ev, err)
	}
	resp.Body.Close()
	select {
	case <-returned:
	case <-time.After(remoteTestTimeout):
		t.Fatal("Stream did not end when the phone disconnected")
	}
}

func TestStreamGoneIsOneEndedEvent(t *testing.T) {
	f := handlerNewFake()
	f.stream = func(context.Context, string, StreamSink) error { return &GoneError{Reason: EndTaken} }
	resp, br := handlerOpenStream(t, f.handler(), "tab-a")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("a gone tab must still answer 200 so EventSource can read why, got %d", resp.StatusCode)
	}
	ev, err := handlerReadEvent(br)
	if err != nil || ev != (handlerSSEEvent{name: "ended", data: `{"reason":"taken"}`}) {
		t.Fatalf("event = %+v (err %v), want one ended taken", ev, err)
	}
	if _, err := handlerReadEvent(br); !errors.Is(err, io.EOF) {
		t.Errorf("want EOF after the one ended event, got %v", err)
	}
}

var handlerAgentPosts = []string{
	"/api/agents/tab-a/send",
	"/api/agents/tab-a/stop",
	"/api/agents/tab-a/approve",
	"/api/agents/tab-a/deny",
	"/api/agents/tab-a/takeback",
}

func TestAgentPostsNeedOriginAndJSON(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	const body = `{"text":"hi"}`
	for _, path := range handlerAgentPosts {
		if rec := handlerDo(t, h, http.MethodPost, path, body, map[string]string{"Content-Type": "application/json"}); rec.Code != http.StatusForbidden {
			t.Errorf("POST %s without Origin: got %d, want 403", path, rec.Code)
		}
		form := map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Origin": handlerTestOrigin}
		if rec := handlerDo(t, h, http.MethodPost, path, "text=hi", form); rec.Code != http.StatusUnsupportedMediaType {
			t.Errorf("POST %s as a form: got %d, want 415", path, rec.Code)
		}
	}
	if len(f.acted) != 0 || len(f.takenBack) != 0 {
		t.Fatalf("a refused post reached a dep: acted %+v, taken back %v", f.acted, f.takenBack)
	}
}

func TestActStatusCodes(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()

	if rec := handlerPostJSON(t, h, "/api/agents/tab-a/send", `{"text":"  run the tests\n"}`); rec.Code != http.StatusOK {
		t.Fatalf("ok send: got %d %s", rec.Code, rec.Body.String())
	}
	handlerPostJSON(t, h, "/api/agents/tab-a/stop", `{}`)
	handlerPostJSON(t, h, "/api/agents/tab-a/approve", `{}`)
	handlerPostJSON(t, h, "/api/agents/tab-a/deny", `{"text":"use staging"}`)
	want := []handlerActCall{
		{"tab-a", AgentAction{Kind: ActionSend, Text: "run the tests"}},
		{"tab-a", AgentAction{Kind: ActionStop}},
		{"tab-a", AgentAction{Kind: ActionApprove}},
		{"tab-a", AgentAction{Kind: ActionDeny, Text: "use staging"}},
	}
	if !reflect.DeepEqual(f.acted, want) {
		t.Fatalf("Act got %+v, want %+v", f.acted, want)
	}

	for _, body := range []string{`{"text":"   "}`, `{}`, `not json`} {
		if rec := handlerPostJSON(t, h, "/api/agents/tab-a/send", body); rec.Code != http.StatusBadRequest {
			t.Errorf("send %s: got %d, want 400", body, rec.Code)
		}
	}
	if len(f.acted) != len(want) {
		t.Fatalf("a refused send reached Act: %+v", f.acted[len(want):])
	}

	f.actErr = fmt.Errorf("%w: it is working", ErrWrongState)
	if rec := handlerPostJSON(t, h, "/api/agents/tab-a/approve", `{}`); rec.Code != http.StatusConflict {
		t.Errorf("wrong state: got %d %s, want 409", rec.Code, rec.Body.String())
	}

	f.actErr = &GoneError{Reason: EndExited}
	for _, path := range handlerAgentPosts {
		rec := handlerPostJSON(t, h, path, `{"text":"hi"}`)
		if rec.Code != http.StatusGone || strings.TrimSpace(rec.Body.String()) != `{"error":"gone","reason":"exited"}` {
			t.Errorf("POST %s gone: got %d %s, want 410 with the reason", path, rec.Code, rec.Body.String())
		}
	}

	f.actErr = nil
	if rec := handlerPostJSON(t, h, "/api/agents/tab-a/takeback", `{}`); rec.Code != http.StatusOK {
		t.Errorf("ok takeback: got %d %s", rec.Code, rec.Body.String())
	}
	if !slices.Contains(f.takenBack, "tab-a") {
		t.Errorf("TakeBack got %v", f.takenBack)
	}
}
