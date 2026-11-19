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
	stream     func(ctx context.Context, tab string, from int64, sink StreamSink) error
	actErr     error
	acted      []handlerActCall
	takenBack  []string
	agents     []ListedAgent
	runs       []ListedRun
	agentsErr  error
	takeErr    error
	taken      []string
	releaseErr error
	released   []string
	// transcript answers a page read; nil answers an empty page
	transcript      func(tab string, before int64) (TranscriptChunk, error)
	transcriptCalls []handlerTranscriptCall
	pcLockErr       error
	pcVolumeErr     error
	pcCalls         []string // "lock", or "volume <step>"
}

type handlerActCall struct {
	tab string
	act AgentAction
}

type handlerTranscriptCall struct {
	tab    string
	before int64
}

func handlerNewFake() *handlerFake {
	return &handlerFake{offCalls: make(chan struct{}, 4)}
}

func (f *handlerFake) handler() http.Handler {
	return NewHandler(f.deps())
}

// deps wires every dep to the fake; a test clears one to see its route answer 501.
func (f *handlerFake) deps() Deps {
	return Deps{
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
		Agents: func(context.Context) ([]ListedAgent, []ListedRun, error) { return f.agents, f.runs, f.agentsErr },
		Stream: func(ctx context.Context, tab string, from int64, sink StreamSink) error {
			return f.stream(ctx, tab, from, sink)
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
		Take: func(_ context.Context, tab string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.taken = append(f.taken, tab)
			return f.takeErr
		},
		Release: func(_ context.Context, tab string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.released = append(f.released, tab)
			return f.releaseErr
		},
		Transcript: func(_ context.Context, tab string, before int64) (TranscriptChunk, error) {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.transcriptCalls = append(f.transcriptCalls, handlerTranscriptCall{tab, before})
			if f.transcript == nil {
				return TranscriptChunk{}, nil
			}
			return f.transcript(tab, before)
		},
		PCLock: func(context.Context) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.pcCalls = append(f.pcCalls, "lock")
			return f.pcLockErr
		},
		PCVolume: func(_ context.Context, step string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.pcCalls = append(f.pcCalls, "volume "+step)
			return f.pcVolumeErr
		},
	}
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
		{http.MethodPost, "/api/agents/tab-a/hand", "{}"},
		{http.MethodPost, "/api/agents/tab-a/release", "{}"},
		{http.MethodGet, "/api/agents/tab-a/transcript?before=0", ""},
		{http.MethodPost, "/api/pc/lock", "{}"},
		{http.MethodPost, "/api/pc/volume", `{"step":"up"}`},
	} {
		rec := handlerDo(t, h, rt.method, rt.path, rt.body, map[string]string{"Content-Type": "application/json", "Origin": handlerTestOrigin})
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: got %d, want 403", rt.method, rt.path, rec.Code)
		}
		if rec.Body.Len() != 0 {
			t.Errorf("%s %s: 403 body should be bare, got %q", rt.method, rt.path, rec.Body.String())
		}
	}
	if len(f.answered) != 0 || len(f.subscribed) != 0 || len(f.offCalls) != 0 ||
		len(f.taken) != 0 || len(f.released) != 0 || len(f.transcriptCalls) != 0 || len(f.pcCalls) != 0 {
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
type handlerSSEEvent struct{ name, id, data, comment string }

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
		case strings.HasPrefix(line, "id: "):
			ev.id = line[len("id: "):]
		case strings.HasPrefix(line, "data: "):
			ev.data = line[len("data: "):]
		}
	}
}

func handlerOpenStream(t *testing.T, h http.Handler, tab string) (*http.Response, *bufio.Reader) {
	t.Helper()
	return handlerOpenStreamFrom(t, h, tab, "")
}

// handlerOpenStreamFrom opens the stream as a reconnecting EventSource does: with its Last-Event-ID when it
// has one.
func handlerOpenStreamFrom(t *testing.T, h http.Handler, tab, lastEventID string) (*http.Response, *bufio.Reader) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/agents/"+tab+"/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	if lastEventID != "" {
		req.Header.Set("Last-Event-ID", lastEventID)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp, bufio.NewReader(resp.Body)
}

func TestStreamFramesAgentLinesAndEnded(t *testing.T) {
	f := handlerNewFake()
	var gotTab string
	f.stream = func(_ context.Context, tab string, _ int64, sink StreamSink) error {
		gotTab = tab
		if err := sink.Agent(HandedAgent{Tab: tab, Name: "phone-chat", State: PhoneWorking}); err != nil {
			return err
		}
		if err := sink.Lines(TranscriptChunk{Lines: []string{`{"type":"user"}`, `{"type":"assistant"}`}, Cursor: 12, End: 57, Backlog: true}); err != nil {
			return err
		}
		if err := sink.Lines(TranscriptChunk{Lines: []string{`{"type":"user"}`}, End: 80}); err != nil {
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
		// a lines event carries the chunk and an id that is the byte offset after its last line; End itself
		// stays out of the data
		{name: "lines", id: "57", data: `{"lines":["{\"type\":\"user\"}","{\"type\":\"assistant\"}"],"cursor":12,"backlog":true}`},
		{name: "lines", id: "80", data: `{"lines":["{\"type\":\"user\"}"],"cursor":0,"backlog":false}`},
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
	f.stream = func(ctx context.Context, _ string, _ int64, _ StreamSink) error {
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
	f.stream = func(context.Context, string, int64, StreamSink) error { return &GoneError{Reason: EndTaken} }
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

func TestHandlerWaitingAgents(t *testing.T) {
	decode := func(f *handlerFake) string {
		t.Helper()
		rec := handlerDo(t, f.handler(), http.MethodGet, "/api/waiting", "", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("got %d %s", rec.Code, rec.Body.String())
		}
		var got map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return string(got["agents"])
	}
	f := handlerNewFake()
	if got := decode(f); got != "[]" {
		t.Errorf("no agents should send [], got %s", got)
	}
	f.agents = []ListedAgent{{Tab: "t1", Name: "docs", State: PhoneWorking, Handed: true}}
	if got := decode(f); !strings.Contains(got, `"tab":"t1"`) || !strings.Contains(got, `"handed":true`) {
		t.Errorf("agents %s", got)
	}
	// a roster that cannot be read must not take the questions down with it
	f.agentsErr = errors.New("roster down")
	if got := decode(f); got != "[]" {
		t.Errorf("a failed roster read should send [], got %s", got)
	}
}

func TestHandlerWaitingTakeableFlag(t *testing.T) {
	f := handlerNewFake()
	f.agents = []ListedAgent{{Tab: "t1", Name: "docs", State: PhoneIdle, Takeable: true}, {Tab: "t2", Name: "scan", State: PhoneIdle}}
	rec := handlerDo(t, f.handler(), http.MethodGet, "/api/waiting", "", nil)
	var got struct {
		Agents []map[string]any `json:"agents"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || len(got.Agents) != 2 {
		t.Fatalf("GET /api/waiting = %d %s (err %v)", rec.Code, rec.Body.String(), err)
	}
	if got.Agents[0]["takeable"] != true || got.Agents[1]["takeable"] != false {
		t.Errorf("takeable = %v and %v, want true and false", got.Agents[0]["takeable"], got.Agents[1]["takeable"])
	}
}

func handlerWaitingFields(t *testing.T, d Deps) map[string]string {
	t.Helper()
	rec := handlerDo(t, NewHandler(d), http.MethodGet, "/api/waiting", "", nil)
	var raw map[string]json.RawMessage
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &raw) != nil {
		t.Fatalf("GET /api/waiting = %d %s", rec.Code, rec.Body.String())
	}
	got := map[string]string{}
	for k, v := range raw {
		got[k] = string(v)
	}
	return got
}

func TestHandlerWaitingRuns(t *testing.T) {
	f := handlerNewFake()
	if got := handlerWaitingFields(t, f.deps())["runs"]; got != "[]" {
		t.Errorf("no runs should send [], got %s", got)
	}
	f.runs = []ListedRun{{
		Key: "dag-1", Name: "Phone agent list", NeedsYou: true,
		Workers: []RunWorkerRow{{Tab: "w1", Label: "Review: Roster", State: PhonePermission, Line: "Wants approval", Since: 9}},
	}}
	want := `[{"key":"dag-1","name":"Phone agent list","needsyou":true,"workers":[{"tab":"w1","label":"Review: Roster","state":"permission","line":"Wants approval","since":9}]}]`
	if got := handlerWaitingFields(t, f.deps())["runs"]; got != want {
		t.Errorf("runs = %s, want %s", got, want)
	}
	// a roster that cannot be read leaves the runs empty too
	f.agentsErr = errors.New("roster down")
	if got := handlerWaitingFields(t, f.deps())["runs"]; got != "[]" {
		t.Errorf("a failed roster read should send [] runs, got %s", got)
	}
	d := f.deps()
	d.Agents = nil
	if got := handlerWaitingFields(t, d)["runs"]; got != "[]" {
		t.Errorf("a handler with no roster dep should send [] runs, got %s", got)
	}
}

func TestHandlerWaitingPCFlag(t *testing.T) {
	f := handlerNewFake()
	both := f.deps()
	lockOnly, volumeOnly, neither := f.deps(), f.deps(), f.deps()
	lockOnly.PCVolume = nil
	volumeOnly.PCLock = nil
	neither.PCLock, neither.PCVolume = nil, nil
	for name, c := range map[string]struct {
		d    Deps
		want string
	}{"both": {both, "true"}, "lock only": {lockOnly, "false"}, "volume only": {volumeOnly, "false"}, "neither": {neither, "false"}} {
		if got := handlerWaitingFields(t, c.d)["pc"]; got != c.want {
			t.Errorf("%s: pc = %s, want %s", name, got, c.want)
		}
	}
}

// locked is the dep's answer, and null when there is no dep or its read fails, so the page says nothing then
func TestHandlerWaitingLocked(t *testing.T) {
	f := handlerNewFake()
	read := func(locked bool, err error) func(context.Context) (bool, error) {
		return func(context.Context) (bool, error) { return locked, err }
	}
	for name, c := range map[string]struct {
		dep  func(context.Context) (bool, error)
		want string
	}{
		"locked":    {read(true, nil), "true"},
		"unlocked":  {read(false, nil), "false"},
		"read fail": {read(true, errors.New("no session")), "null"},
		"no dep":    {nil, "null"},
	} {
		d := f.deps()
		d.PCLocked = c.dep
		if got := handlerWaitingFields(t, d)["locked"]; got != c.want {
			t.Errorf("%s: locked = %s, want %s", name, got, c.want)
		}
	}
}

// only a lines event carries an id, the byte offset after its last line; an id of 0 is still sent, and the
// agent and ended events leave the browser's last id alone
func TestHandlerStreamLinesCarryID(t *testing.T) {
	f := handlerNewFake()
	f.stream = func(_ context.Context, tab string, _ int64, sink StreamSink) error {
		if err := sink.Agent(HandedAgent{Tab: tab}); err != nil {
			return err
		}
		if err := sink.Lines(TranscriptChunk{Backlog: true}); err != nil {
			return err
		}
		if err := sink.Lines(TranscriptChunk{Lines: []string{"a"}, End: 1234567890123}); err != nil {
			return err
		}
		return &GoneError{Reason: EndOff}
	}
	_, br := handlerOpenStream(t, f.handler(), "tab-a")
	for i, want := range []struct{ name, id string }{{"agent", ""}, {"lines", "0"}, {"lines", "1234567890123"}, {"ended", ""}} {
		ev, err := handlerReadEvent(br)
		if err != nil || ev.name != want.name || ev.id != want.id {
			t.Fatalf("event %d = %+v (err %v), want %s with id %q", i, ev, err, want.name, want.id)
		}
	}
}

func TestHandlerStreamResumesFromLastEventID(t *testing.T) {
	for _, c := range []struct {
		header string
		want   int64
	}{
		{"", -1}, {"57", 57}, {"0", 0},
		// malformed or negative reads as no id: the backlog is then the last 200 lines
		{"abc", -1}, {"-3", -1}, {"12x", -1}, {"1.5", -1},
	} {
		f := handlerNewFake()
		froms := make(chan int64, 1)
		f.stream = func(_ context.Context, _ string, from int64, _ StreamSink) error {
			froms <- from
			return &GoneError{Reason: EndTaken}
		}
		_, br := handlerOpenStreamFrom(t, f.handler(), "tab-a", c.header)
		if _, err := handlerReadEvent(br); err != nil {
			t.Fatalf("Last-Event-ID %q: %v", c.header, err)
		}
		select {
		case got := <-froms:
			if got != c.want {
				t.Errorf("Last-Event-ID %q: Stream got from %d, want %d", c.header, got, c.want)
			}
		case <-time.After(remoteTestTimeout):
			t.Fatalf("Last-Event-ID %q: Stream was not called", c.header)
		}
	}
}

// the routes this plan adds, with a body each takes
var handlerNewPosts = []struct{ path, body string }{
	{"/api/agents/tab-a/hand", `{}`},
	{"/api/agents/tab-a/release", `{}`},
	{"/api/pc/lock", `{}`},
	{"/api/pc/volume", `{"step":"up"}`},
}

func TestHandlerNewPostsNeedOriginAndJSON(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	for _, p := range handlerNewPosts {
		if rec := handlerDo(t, h, http.MethodPost, p.path, p.body, map[string]string{"Content-Type": "application/json"}); rec.Code != http.StatusForbidden {
			t.Errorf("POST %s without Origin: got %d, want 403", p.path, rec.Code)
		}
		form := map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Origin": handlerTestOrigin}
		if rec := handlerDo(t, h, http.MethodPost, p.path, "step=up", form); rec.Code != http.StatusUnsupportedMediaType {
			t.Errorf("POST %s as a form: got %d, want 415", p.path, rec.Code)
		}
	}
	if len(f.taken) != 0 || len(f.released) != 0 || len(f.pcCalls) != 0 {
		t.Fatalf("a refused post reached a dep: %+v", f)
	}
}

func TestHandlerTake(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	rec := handlerPostJSON(t, h, "/api/agents/tab-a/hand", `{}`)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Fatalf("ok take: got %d %s", rec.Code, rec.Body.String())
	}
	if !slices.Equal(f.taken, []string{"tab-a"}) {
		t.Fatalf("Take got %v", f.taken)
	}

	// a refusal answers 409 with the text after the sentinel, quotes and all
	reason := `"lab-notes" (tab t-9) runs "codex": only claude and pi agents can be taken`
	f.takeErr = fmt.Errorf("%w: %s", ErrRefused, reason)
	rec = handlerPostJSON(t, h, "/api/agents/tab-b/hand", `{}`)
	var body map[string]string
	if rec.Code != http.StatusConflict || json.Unmarshal(rec.Body.Bytes(), &body) != nil ||
		!reflect.DeepEqual(body, map[string]string{"error": "refused", "reason": reason}) {
		t.Errorf("refused take: got %d %s, want 409 refused with the reason", rec.Code, rec.Body.String())
	}

	f.takeErr = errors.New("roster down")
	rec = handlerPostJSON(t, h, "/api/agents/tab-c/hand", `{}`)
	if rec.Code != http.StatusInternalServerError || strings.TrimSpace(rec.Body.String()) != `{"error":"roster down"}` {
		t.Errorf("failed take: got %d %s, want 500 with the error", rec.Code, rec.Body.String())
	}
	if !slices.Equal(f.taken, []string{"tab-a", "tab-b", "tab-c"}) {
		t.Errorf("Take got %v", f.taken)
	}
}

func TestHandlerRelease(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	if rec := handlerPostJSON(t, h, "/api/agents/tab-a/release", `{}`); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Fatalf("ok release: got %d %s", rec.Code, rec.Body.String())
	}
	// a tab that is no longer handed over has nothing to release, which is not a failure
	f.releaseErr = &GoneError{Reason: EndTaken}
	if rec := handlerPostJSON(t, h, "/api/agents/tab-b/release", `{}`); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Errorf("release of a gone tab: got %d %s, want 200 ok", rec.Code, rec.Body.String())
	}
	f.releaseErr = errors.New("roster down")
	if rec := handlerPostJSON(t, h, "/api/agents/tab-c/release", `{}`); rec.Code != http.StatusInternalServerError {
		t.Errorf("failed release: got %d %s, want 500", rec.Code, rec.Body.String())
	}
	if !slices.Equal(f.released, []string{"tab-a", "tab-b", "tab-c"}) {
		t.Errorf("Release got %v", f.released)
	}
}

func TestHandlerTranscript(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	get := func(query string) *httptest.ResponseRecorder {
		return handlerDo(t, h, http.MethodGet, "/api/agents/tab-a/transcript"+query, "", nil)
	}
	f.transcript = func(string, int64) (TranscriptChunk, error) {
		return TranscriptChunk{Lines: []string{`{"a":1}`, `{"b":2}`}, Cursor: 120, End: 999, Backlog: true}, nil
	}
	rec := get("?before=300")
	// only the lines and the cursor: End is internal and a page is never the stream's backlog
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"lines":["{\"a\":1}","{\"b\":2}"],"cursor":120}` {
		t.Fatalf("page: got %d %s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control %q", cc)
	}
	if want := []handlerTranscriptCall{{"tab-a", 300}}; !reflect.DeepEqual(f.transcriptCalls, want) {
		t.Fatalf("Transcript got %+v, want %+v", f.transcriptCalls, want)
	}

	// before 0 is a valid ask; an empty page sends [] and not null
	f.transcript = nil
	rec = get("?before=0")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"lines":[],"cursor":0}` {
		t.Errorf("before=0: got %d %s", rec.Code, rec.Body.String())
	}

	calls := len(f.transcriptCalls)
	for _, query := range []string{"", "?before=", "?before=abc", "?before=-1", "?before=1.5", "?before=99999999999999999999", "?after=5"} {
		if rec := get(query); rec.Code != http.StatusBadRequest {
			t.Errorf("GET transcript%s: got %d %s, want 400", query, rec.Code, rec.Body.String())
		}
	}
	if len(f.transcriptCalls) != calls {
		t.Fatalf("a malformed ask reached Transcript: %+v", f.transcriptCalls[calls:])
	}

	f.transcript = func(string, int64) (TranscriptChunk, error) { return TranscriptChunk{}, &GoneError{Reason: EndExited} }
	if rec := get("?before=10"); rec.Code != http.StatusGone || strings.TrimSpace(rec.Body.String()) != `{"error":"gone","reason":"exited"}` {
		t.Errorf("gone: got %d %s, want 410 with the reason", rec.Code, rec.Body.String())
	}
	f.transcript = func(string, int64) (TranscriptChunk, error) { return TranscriptChunk{}, errors.New("read failed") }
	if rec := get("?before=10"); rec.Code != http.StatusInternalServerError || strings.TrimSpace(rec.Body.String()) != `{"error":"read failed"}` {
		t.Errorf("failed read: got %d %s, want 500 with the error", rec.Code, rec.Body.String())
	}
}

func TestHandlerPC(t *testing.T) {
	f := handlerNewFake()
	h := f.handler()
	if rec := handlerPostJSON(t, h, "/api/pc/lock", `{}`); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"ok":true}` {
		t.Fatalf("lock: got %d %s", rec.Code, rec.Body.String())
	}
	for _, step := range []string{"down", "mute", "up"} {
		if rec := handlerPostJSON(t, h, "/api/pc/volume", `{"step":"`+step+`"}`); rec.Code != http.StatusOK {
			t.Errorf("volume %s: got %d %s", step, rec.Code, rec.Body.String())
		}
	}
	if want := []string{"lock", "volume down", "volume mute", "volume up"}; !slices.Equal(f.pcCalls, want) {
		t.Fatalf("PC got %v, want %v", f.pcCalls, want)
	}

	// a step the page never sends is the page's bug: 400, and nothing presses a key
	for _, body := range []string{`{"step":"louder"}`, `{"step":"DOWN"}`, `{"step":""}`, `{}`, `not json`} {
		if rec := handlerPostJSON(t, h, "/api/pc/volume", body); rec.Code != http.StatusBadRequest {
			t.Errorf("volume %s: got %d %s, want 400", body, rec.Code, rec.Body.String())
		}
	}
	if len(f.pcCalls) != 4 {
		t.Fatalf("a bad step reached PCVolume: %v", f.pcCalls[4:])
	}

	f.pcLockErr = errors.New("LockWorkStation failed: access denied")
	if rec := handlerPostJSON(t, h, "/api/pc/lock", `{}`); rec.Code != http.StatusInternalServerError || strings.TrimSpace(rec.Body.String()) != `{"error":"LockWorkStation failed: access denied"}` {
		t.Errorf("failed lock: got %d %s, want 500 with the error", rec.Code, rec.Body.String())
	}
	f.pcVolumeErr = errors.New("volume key refused")
	if rec := handlerPostJSON(t, h, "/api/pc/volume", `{"step":"mute"}`); rec.Code != http.StatusInternalServerError || strings.TrimSpace(rec.Body.String()) != `{"error":"volume key refused"}` {
		t.Errorf("failed volume: got %d %s, want 500 with the error", rec.Code, rec.Body.String())
	}
}

// a handler built without one of the new deps answers 501 on its route instead of panicking
func TestHandlerNilDepsAnswer501(t *testing.T) {
	for _, c := range []struct {
		name, method, path, body string
		clear                    func(*Deps)
	}{
		{"Take", http.MethodPost, "/api/agents/tab-a/hand", `{}`, func(d *Deps) { d.Take = nil }},
		{"Release", http.MethodPost, "/api/agents/tab-a/release", `{}`, func(d *Deps) { d.Release = nil }},
		{"Transcript", http.MethodGet, "/api/agents/tab-a/transcript?before=0", "", func(d *Deps) { d.Transcript = nil }},
		{"PCLock", http.MethodPost, "/api/pc/lock", `{}`, func(d *Deps) { d.PCLock = nil }},
		{"PCVolume", http.MethodPost, "/api/pc/volume", `{"step":"up"}`, func(d *Deps) { d.PCVolume = nil }},
		// the nil dep wins over a bad step: the computer cannot do any of it
		{"PCVolume with a bad step", http.MethodPost, "/api/pc/volume", `{"step":"louder"}`, func(d *Deps) { d.PCVolume = nil }},
	} {
		d := handlerNewFake().deps()
		c.clear(&d)
		rec := handlerDo(t, NewHandler(d), c.method, c.path, c.body, map[string]string{"Content-Type": "application/json", "Origin": handlerTestOrigin})
		if rec.Code != http.StatusNotImplemented || strings.TrimSpace(rec.Body.String()) != `{"error":"Not supported on this computer"}` {
			t.Errorf("nil %s: got %d %s, want 501", c.name, rec.Code, rec.Body.String())
		}
	}
}

// remoteDeps is what the running phone listener is built from: every route needs its dep, and the PC ones
// are wired only where the platform supports them.
func TestRemoteDepsWiresEveryRoute(t *testing.T) {
	d := remoteDeps(Config{Provider: ProviderTailscale}, context.Background())
	for name, wired := range map[string]bool{
		"Static": d.Static != nil, "Verify": d.Verify != nil, "Waiting": d.Waiting != nil, "Answer": d.Answer != nil,
		"Off": d.Off != nil, "Subscribe": d.Subscribe != nil, "Handed": d.Handed != nil, "Agents": d.Agents != nil,
		"Stream": d.Stream != nil, "Act": d.Act != nil, "TakeBack": d.TakeBack != nil,
		"Take": d.Take != nil, "Release": d.Release != nil, "Transcript": d.Transcript != nil,
	} {
		if !wired {
			t.Errorf("remoteDeps leaves %s unset", name)
		}
	}
	if (d.PCLock != nil) != pcSupported || (d.PCVolume != nil) != pcSupported {
		t.Errorf("PCLock set %v, PCVolume set %v, want both %v (pcSupported)", d.PCLock != nil, d.PCVolume != nil, pcSupported)
	}
}
