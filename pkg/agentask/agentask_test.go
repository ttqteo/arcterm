// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentask

import (
	"sync"
	"sync/atomic"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func mkPending(askId, blockId string) PendingAsk {
	return PendingAsk{
		AskId:     askId,
		BlockId:   blockId,
		Questions: []baseds.AgentAskQuestion{{Question: "pick"}},
	}
}

func TestSetThenGet(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:b1", mkPending("ask-1", "b1"))
	got, ok := r.Get("block:b1")
	if !ok {
		t.Fatalf("Get returned ok=false for a Set oref")
	}
	if got.AskId != "ask-1" || got.BlockId != "b1" {
		t.Fatalf("got %+v, want askId=ask-1 blockId=b1", got)
	}
}

func TestGetUnknownIsNotOk(t *testing.T) {
	r := MakeRegistry()
	if _, ok := r.Get("block:none"); ok {
		t.Fatalf("Get returned ok=true for an unknown oref")
	}
}

func TestDropRemoves(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:b2", mkPending("ask-2", "b2"))
	r.Drop("block:b2")
	if _, ok := r.Get("block:b2"); ok {
		t.Fatalf("Get returned ok=true after Drop")
	}
}

func TestSetOverwritesSameOref(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:b3", mkPending("ask-old", "b3"))
	r.Set("block:b3", mkPending("ask-new", "b3"))
	got, _ := r.Get("block:b3")
	if got.AskId != "ask-new" {
		t.Fatalf("got askId %q, want ask-new", got.AskId)
	}
}

func TestClaim_NoPendingIsFalse(t *testing.T) {
	r := MakeRegistry()
	if _, ok := r.Claim("block:none", ""); ok {
		t.Fatalf("Claim returned ok=true for an unknown oref")
	}
}

func TestClaim_EmptyAskidMatchesAndDeletes(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:b1", mkPending("ask-1", "b1"))
	got, ok := r.Claim("block:b1", "")
	if !ok || got.AskId != "ask-1" {
		t.Fatalf("Claim = (%+v,%v), want (ask-1,true)", got, ok)
	}
	if _, still := r.Get("block:b1"); still {
		t.Fatalf("Claim must delete the entry")
	}
}

func TestClaim_MatchingAskidDeletes(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:b1", mkPending("ask-1", "b1"))
	if _, ok := r.Claim("block:b1", "ask-1"); !ok {
		t.Fatalf("Claim with matching askid should win")
	}
	if _, still := r.Get("block:b1"); still {
		t.Fatalf("Claim must delete on a matching askid")
	}
}

func TestClaim_MismatchedAskidRetains(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:b1", mkPending("ask-1", "b1"))
	if _, ok := r.Claim("block:b1", "ask-2"); ok {
		t.Fatalf("Claim with a stale askid must not win")
	}
	if _, still := r.Get("block:b1"); !still {
		t.Fatalf("Claim must retain the entry on an askid mismatch")
	}
}

func TestRegistryListReturnsPendingAsksWithTimestamps(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:a", PendingAsk{AskId: "1", BlockId: "a", Ts: 1000})
	r.Set("block:b", PendingAsk{AskId: "2", BlockId: "b", Ts: 2000})

	all := r.List()
	if len(all) != 2 {
		t.Fatalf("want 2 pending, got %d", len(all))
	}
	if all["block:a"].Ts != 1000 {
		t.Fatalf("timestamp not stored: %+v", all["block:a"])
	}

	// a claimed ask is no longer waiting on anyone
	if _, ok := r.Claim("block:a", "1"); !ok {
		t.Fatal("claim should succeed")
	}
	if len(r.List()) != 1 {
		t.Fatalf("claimed ask still listed: %+v", r.List())
	}
}

func TestRegistryListIsACopy(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:a", PendingAsk{AskId: "1", Ts: 1})
	snapshot := r.List()
	r.Drop("block:a")
	if len(snapshot) != 1 {
		t.Fatal("List must return a copy the caller can hold past the lock")
	}
}

func TestClaim_ConcurrentExactlyOneWinner(t *testing.T) {
	r := MakeRegistry()
	r.Set("block:b1", mkPending("ask-1", "b1"))
	const n = 32
	var wins int32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			if _, ok := r.Claim("block:b1", ""); ok {
				atomic.AddInt32(&wins, 1)
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("concurrent Claim winners = %d, want exactly 1", wins)
	}
}

func TestSuspendMarksOnlyThePendingAsk(t *testing.T) {
	r := MakeRegistry()
	if r.Suspend("block:none") {
		t.Fatal("Suspend with nothing pending must report false")
	}
	r.Set("block:a", PendingAsk{AskId: "ask-1"})
	if !r.Suspend("block:a") {
		t.Fatal("Suspend must find the pending ask")
	}
	if !r.SuspendedAsk("block:a", "ask-1") {
		t.Fatal("the pending ask must read suspended")
	}
	if r.SuspendedAsk("block:a", "ask-0") {
		t.Fatal("another ask id is not the suspended ask")
	}
	// a new ask replaces the entry, and the mark with it
	r.Set("block:a", PendingAsk{AskId: "ask-2"})
	if r.SuspendedAsk("block:a", "ask-2") {
		t.Fatal("a new ask must not inherit the mark")
	}
}

// a sleep whose meta write failed undoes its Suspend: the process lives on, so its --wait caller must clear the ask
// as before
func TestUnsuspendClearsTheMarkOfThePendingAsk(t *testing.T) {
	r := MakeRegistry()
	if r.Unsuspend("block:none") {
		t.Fatal("Unsuspend with nothing pending must report false")
	}
	r.Set("block:a", PendingAsk{AskId: "ask-1", Ts: 7})
	r.Suspend("block:a")
	if !r.Unsuspend("block:a") {
		t.Fatal("Unsuspend must find the pending ask")
	}
	if r.SuspendedAsk("block:a", "ask-1") {
		t.Fatal("the ask must not read suspended after Unsuspend")
	}
	if p, ok := r.Get("block:a"); !ok || p.AskId != "ask-1" || p.Ts != 7 {
		t.Fatalf("Unsuspend must leave the ask itself pending, got %#v (pending=%v)", p, ok)
	}
}
