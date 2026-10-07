// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestNotifyChildOutcomeCallsHookAndContainsError(t *testing.T) {
	old := ChildOutcomeHook
	t.Cleanup(func() { ChildOutcomeHook = old })
	called := false
	ChildOutcomeHook = func(_ context.Context, worker string, data OutcomeData) error {
		called = true
		if worker != "tab:worker" || data.Status != "failed" {
			t.Fatalf("unexpected hook data: %q %+v", worker, data)
		}
		return errors.New("engine unavailable")
	}
	notifyChildOutcome(context.Background(), "tab:worker", OutcomeData{Status: "failed"})
	if !called {
		t.Fatal("child outcome hook was not called")
	}
}

func TestOutcomeStatus(t *testing.T) {
	cases := map[string]string{"done": "done", "failed": "failed", "waiting": "waiting", "": "done"}
	for in, want := range cases {
		if got := OutcomeStatus(in); got != want {
			t.Errorf("OutcomeStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAlreadyHasFreshOutcome(t *testing.T) {
	// outcome newer than the latest dispatch -> fresh (skip re-post)
	fresh := []*waveobj.ChannelMessage{
		{Kind: "dispatch", RefORef: "tab:w1", Ts: 1},
		{Kind: "outcome", RefORef: "tab:w1", Ts: 2},
	}
	if !alreadyHasFreshOutcome(fresh) {
		t.Error("want fresh=true when outcome is newer than dispatch")
	}
	// re-dispatched after the outcome -> not fresh (should post again)
	redispatched := []*waveobj.ChannelMessage{
		{Kind: "outcome", RefORef: "tab:w1", Ts: 2},
		{Kind: "dispatch", RefORef: "tab:w1", Ts: 3},
	}
	if alreadyHasFreshOutcome(redispatched) {
		t.Error("want fresh=false when a newer dispatch supersedes the outcome")
	}
}

// Two worker-exit signals for one worker race to post its outcome: the freshness check and the insert
// share one write transaction, so the second sees the first's message and exactly one outcome lands.
func TestPostOutcomePostsOnceWhenPostsRace(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "oc-race", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	worker := seedWorkerTab(t, ctx)
	if _, err := wstore.PostChannelMessage(ctx, ch.OID, wstore.NewChannelMessage("dispatch", "claude", "task", worker, 10)); err != nil {
		t.Fatalf("post dispatch: %v", err)
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			PostOutcome(ch, worker, "claude", OutcomeData{Status: "done", Summary: "s"})
		}()
	}
	wg.Wait()
	if got := countOutcomes(t, ctx, ch.OID, worker); got != 1 {
		t.Fatalf("racing posts must leave exactly 1 outcome, got %d", got)
	}
}
