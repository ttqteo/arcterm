// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

const (
	pusherTestQuestionText = "Which schema should the migration target?"
	pusherTestReason       = "merge conflict in pkg/secret/thing.go"
)

func pusherTestQuestion(key, askID, header string) WaitingQuestion {
	return WaitingQuestion{Key: key, AskId: askID, Source: "api-agent", Questions: []baseds.AgentAskQuestion{
		{Question: pusherTestQuestionText, Header: header},
	}}
}

func pusherTestHeld(key string) WaitingShown {
	return WaitingShown{Key: key, Kind: jarvis.AttentionRunLandHeld, Title: "run fix-login", Reason: pusherTestReason}
}

func pusherTestKeys(notes []PushNote) []string {
	var keys []string
	for _, n := range notes {
		keys = append(keys, n.Key)
	}
	return keys
}

func TestPushNotes(t *testing.T) {
	seen := map[string]bool{}
	first := WaitingList{
		Questions: []WaitingQuestion{pusherTestQuestion("ask:block:1", "a1", "Schema")},
		Shown:     []WaitingShown{pusherTestHeld("run-land-held:r1")},
	}
	notes := pushNotes(seen, first)
	want := []PushNote{
		{Title: "api-agent", Body: "Schema", Key: "ask:block:1"},
		{Title: "run fix-login", Body: "Run held", Key: "run-land-held:r1"},
	}
	if len(notes) != len(want) || notes[0] != want[0] || notes[1] != want[1] {
		t.Fatalf("first read notes = %+v, want %+v", notes, want)
	}
	if notes := pushNotes(seen, first); len(notes) != 0 {
		t.Errorf("a key seen before was pushed again: %v", pusherTestKeys(notes))
	}

	second := first
	second.Questions = append([]WaitingQuestion{}, first.Questions...)
	second.Questions = append(second.Questions, pusherTestQuestion("ask:block:2", "b1", ""))
	notes = pushNotes(seen, second)
	if len(notes) != 1 || notes[0].Key != "ask:block:2" || notes[0].Body != pusherQuestionWord {
		t.Fatalf("one new key: notes = %+v, want ask:block:2 with body %q", notes, pusherQuestionWord)
	}

	next := second
	next.Questions = []WaitingQuestion{pusherTestQuestion("ask:block:1", "a2", "Schema"), second.Questions[1]}
	if notes := pushNotes(seen, next); len(notes) != 1 || notes[0].Key != "ask:block:1" {
		t.Errorf("the agent's next ask on the same key: notes = %v, want ask:block:1", pusherTestKeys(notes))
	}

	pushNotes(seen, WaitingList{})
	if notes := pushNotes(seen, first); len(notes) != 2 {
		t.Errorf("items that left and came back: notes = %v, want both", pusherTestKeys(notes))
	}

	other := WaitingList{Shown: []WaitingShown{{Key: "x:1", Kind: "something-new", Title: "t"}}}
	if notes := pushNotes(map[string]bool{}, other); len(notes) != 1 || notes[0].Body != pusherWaitingWord {
		t.Errorf("unknown kind: notes = %+v, want body %q", notes, pusherWaitingWord)
	}

	all := pushNotes(map[string]bool{}, second)
	raw, _ := json.Marshal(all)
	if strings.Contains(string(raw), pusherTestQuestionText) || strings.Contains(string(raw), pusherTestReason) {
		t.Errorf("a note carries question text or a hold reason: %s", raw)
	}
}

// pusherTestSub is a browser-side push subscription whose pushes the test can decrypt.
type pusherTestSub struct {
	sub  PushSubscription
	ua   *ecdh.PrivateKey
	auth []byte
}

func pusherTestNewSub(t *testing.T, endpoint string) pusherTestSub {
	t.Helper()
	ua, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, pushAuthLen)
	rand.Read(auth)
	s := pusherTestSub{sub: PushSubscription{Endpoint: endpoint}, ua: ua, auth: auth}
	s.sub.Keys.P256dh = base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes())
	s.sub.Keys.Auth = base64.RawURLEncoding.EncodeToString(auth)
	if err := remoteSubscribe(s.sub); err != nil {
		t.Fatal(err)
	}
	return s
}

func pusherTestSetup(t *testing.T) {
	t.Helper()
	configUseTempDir(t)
	if _, err := Setup(configValidSetup()); err != nil {
		t.Fatal(err)
	}
}

func TestPushNotesSkipsSeedingRead(t *testing.T) {
	pusherTestSetup(t)
	var lock sync.Mutex
	var bodies [][]byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		lock.Lock()
		bodies = append(bodies, body)
		lock.Unlock()
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	sub := pusherTestNewSub(t, srv.URL+"/sub/1")

	waiting := WaitingList{Questions: []WaitingQuestion{pusherTestQuestion("ask:block:old", "a1", "Old")}}
	var reads atomic.Int32
	prevWaiting, prevInterval := remoteWaitingList, pusherInterval
	remoteWaitingList = func(context.Context) (WaitingList, error) {
		if reads.Add(1) == 1 {
			return waiting, nil
		}
		next := waiting
		next.Questions = append([]WaitingQuestion{}, waiting.Questions...)
		next.Questions = append(next.Questions, pusherTestQuestion("ask:block:new", "b1", "New"))
		return next, nil
	}
	pusherInterval = 10 * time.Millisecond
	t.Cleanup(func() { remoteWaitingList, pusherInterval = prevWaiting, prevInterval })

	stop := startPusher()
	deadline := time.Now().Add(remoteTestTimeout)
	for reads.Load() < 5 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	stop()

	lock.Lock()
	defer lock.Unlock()
	if len(bodies) != 1 {
		t.Fatalf("got %d pushes, want 1: what was waiting at the first read is never pushed", len(bodies))
	}
	var note PushNote
	if err := json.Unmarshal(pushTestDecrypt(t, bodies[0], sub.ua, sub.auth), &note); err != nil {
		t.Fatal(err)
	}
	if note != (PushNote{Title: "api-agent", Body: "New", Key: "ask:block:new"}) {
		t.Errorf("pushed %+v, want the new question", note)
	}
}

func TestGoneSubscriptionDropped(t *testing.T) {
	pusherTestSetup(t)
	var goneHits, okHits atomic.Int32
	gone := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		goneHits.Add(1)
		w.WriteHeader(http.StatusGone)
	}))
	defer gone.Close()
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		okHits.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer ok.Close()
	pusherTestNewSub(t, gone.URL+"/sub/gone")
	kept := pusherTestNewSub(t, ok.URL+"/sub/ok")

	pusherDeliver(context.Background(), []PushNote{{Title: "a", Body: "b", Key: "k1"}, {Title: "a", Body: "b", Key: "k2"}})

	if goneHits.Load() != 1 || okHits.Load() != 2 {
		t.Errorf("hits: gone %d, ok %d; want 1 and 2 (a gone subscription is not retried)", goneHits.Load(), okHits.Load())
	}
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Subscriptions) != 1 || cfg.Subscriptions[0].Endpoint != kept.sub.Endpoint {
		t.Errorf("stored subscriptions = %+v, want only %s", cfg.Subscriptions, kept.sub.Endpoint)
	}
}
