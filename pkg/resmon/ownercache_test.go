// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

func TestOwnerCacheResolvesOncePerTTL(t *testing.T) {
	a := jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: "a"}
	b := jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: "b"}
	calls := map[jobobject.Owner]int{}
	label := "first"
	resolve := func(_ context.Context, o jobobject.Owner) OwnerInfo {
		calls[o]++
		return OwnerInfo{Label: o.Id + ":" + label}
	}
	// two jobs of one owner resolve it once
	jobs := []jobobject.LiveJob{{Owner: a, RootPid: 1}, {Owner: a, RootPid: 2}, {Owner: b, RootPid: 3}}
	c := newOwnerCache()
	t0 := time.Unix(1000, 0)

	got := c.resolveAll(context.Background(), resolve, jobs, t0)
	if got[a].Label != "a:first" || got[b].Label != "b:first" {
		t.Fatalf("first snapshot labels = %v", got)
	}
	label = "renamed"
	got = c.resolveAll(context.Background(), resolve, jobs, t0.Add(ownerInfoTTL-time.Second))
	if calls[a] != 1 || calls[b] != 1 {
		t.Fatalf("a poll inside the ttl resolved again: %v", calls)
	}
	if got[a].Label != "a:first" {
		t.Fatalf("a poll inside the ttl changed the label to %q", got[a].Label)
	}

	got = c.resolveAll(context.Background(), resolve, jobs, t0.Add(ownerInfoTTL))
	if calls[a] != 2 || got[a].Label != "a:renamed" {
		t.Fatalf("after the ttl: calls=%v label=%q, want a rename to show", calls, got[a].Label)
	}
}

func TestOwnerCacheForgetsEndedJobs(t *testing.T) {
	a := jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: "a"}
	calls := 0
	resolve := func(_ context.Context, o jobobject.Owner) OwnerInfo {
		calls++
		return OwnerInfo{Label: o.Id}
	}
	c := newOwnerCache()
	t0 := time.Unix(1000, 0)
	c.resolveAll(context.Background(), resolve, []jobobject.LiveJob{{Owner: a, RootPid: 1}}, t0)
	c.resolveAll(context.Background(), resolve, nil, t0.Add(time.Second))
	// the owner's job ended, so a new job under the same owner is resolved afresh
	c.resolveAll(context.Background(), resolve, []jobobject.LiveJob{{Owner: a, RootPid: 2}}, t0.Add(2*time.Second))
	if calls != 2 {
		t.Fatalf("resolve calls = %d, want 2: an ended owner must not be served from the cache", calls)
	}
}
