// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func pinEffort(oid string, pinnedTs int64) *waveobj.Effort {
	return &waveobj.Effort{OID: oid, Title: "title " + oid, Status: "active", PinnedTs: pinnedTs}
}

// six pinned (p1 oldest), plus the target t
func fullPins() []*waveobj.Effort {
	var all []*waveobj.Effort
	for i := MaxPinnedEfforts; i >= 1; i-- {
		all = append(all, pinEffort(fmt.Sprintf("p%d", i), int64(100*i)))
	}
	return append(all, pinEffort("t", 0))
}

func TestPlanPinStampsUnderTheCap(t *testing.T) {
	plan, err := PlanPin([]*waveobj.Effort{pinEffort("a", 50), pinEffort("t", 0)}, "t", true, false, 900)
	if err != nil {
		t.Fatal(err)
	}
	want := PinPlan{Stamp: "t", StampTs: 900, Pinned: true}
	if !reflect.DeepEqual(plan, want) {
		t.Fatalf("plan = %+v, want %+v", plan, want)
	}
}

func TestPlanPinCapReachedReturnsOldestAndChangesNothing(t *testing.T) {
	plan, err := PlanPin(fullPins(), "t", true, false, 900)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.CapReached || plan.Pinned || plan.Stamp != "" || len(plan.Clear) != 0 {
		t.Fatalf("plan = %+v, want a refusal that changes nothing", plan)
	}
	if plan.Oldest == nil || plan.Oldest.OID != "p1" {
		t.Fatalf("oldest = %+v, want p1 (the smallest PinnedTs)", plan.Oldest)
	}
}

func TestPlanPinReplaceOldestUnpinsTheSmallestPinnedTs(t *testing.T) {
	plan, err := PlanPin(fullPins(), "t", true, true, 900)
	if err != nil {
		t.Fatal(err)
	}
	want := PinPlan{Clear: []string{"p1"}, Stamp: "t", StampTs: 900, Pinned: true}
	if !reflect.DeepEqual(plan, want) {
		t.Fatalf("plan = %+v, want %+v", plan, want)
	}
}

func TestPlanPinRePinKeepsItsTime(t *testing.T) {
	plan, err := PlanPin([]*waveobj.Effort{pinEffort("t", 42)}, "t", true, false, 900)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Stamp != "" || len(plan.Clear) != 0 || !plan.Pinned {
		t.Fatalf("plan = %+v, want no change and still pinned", plan)
	}
	// even at the cap: re-pinning one of the six is not a seventh
	all := fullPins()
	plan, err = PlanPin(all, "p3", true, false, 900)
	if err != nil {
		t.Fatal(err)
	}
	if plan.CapReached || plan.Stamp != "" || !plan.Pinned {
		t.Fatalf("re-pin at the cap: plan = %+v", plan)
	}
}

func TestPlanPinUnpinClears(t *testing.T) {
	plan, err := PlanPin([]*waveobj.Effort{pinEffort("t", 42)}, "t", false, false, 900)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(plan, PinPlan{Clear: []string{"t"}}) {
		t.Fatalf("plan = %+v", plan)
	}
	plan, err = PlanPin([]*waveobj.Effort{pinEffort("t", 0)}, "t", false, false, 900)
	if err != nil || !reflect.DeepEqual(plan, PinPlan{}) {
		t.Fatalf("unpinning an unpinned effort: plan = %+v err = %v, want a no-op", plan, err)
	}
}

func TestPlanPinArchivedNeitherCountsNorGetsPinned(t *testing.T) {
	all := fullPins()
	all[0].Status = "archived" // p6, still carrying a stale pin
	plan, err := PlanPin(all, "t", true, false, 900)
	if err != nil {
		t.Fatal(err)
	}
	if plan.CapReached || plan.Stamp != "t" {
		t.Fatalf("an archived pin counted toward the cap: plan = %+v", plan)
	}
	archived := pinEffort("t", 0)
	archived.Status = "archived"
	if _, err := PlanPin([]*waveobj.Effort{archived}, "t", true, false, 900); err == nil {
		t.Fatal("pinning an archived effort succeeded")
	}
}

func TestPlanPinUnknownTarget(t *testing.T) {
	if _, err := PlanPin(nil, "nope", true, false, 900); err == nil {
		t.Fatal("pinning an unknown effort succeeded")
	}
}
