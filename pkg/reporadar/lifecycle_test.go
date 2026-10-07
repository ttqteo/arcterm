// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func find(file string) waveobj.RadarFinding {
	return waveobj.RadarFinding{
		ID: "f", Fingerprint: siblingFingerprint("/repos/pay", "c0ffee", file), Group: GroupNew, RiskKind: RiskSiblingBug,
		Files: []string{file}, Severity: SeverityHigh, SourceCommit: "c0ffee",
	}
}

func withGroup(f waveobj.RadarFinding, group string) waveobj.RadarFinding {
	f.Group = group
	if group == GroupDismissed || group == GroupSuppressed {
		f.Disposition = &waveobj.RadarDisposition{Action: group, Ts: 500}
	}
	return f
}

func byFile(fs []waveobj.RadarFinding) map[string]waveobj.RadarFinding {
	out := map[string]waveobj.RadarFinding{}
	for _, f := range fs {
		out[f.Files[0]] = f
	}
	return out
}

func TestReconcileClassifies(t *testing.T) {
	baseline := []waveobj.RadarFinding{find("src/coupons.go"), withGroup(find("src/gone.go"), GroupNoLonger), find("src/checkout.go")}
	// coupons and gone are detected again, auth is new, checkout was missed
	detected := []waveobj.RadarFinding{find("src/coupons.go"), find("src/gone.go"), find("src/auth.go")}
	out := byFile(reconcile(detected, baseline))

	if out["src/coupons.go"].Group != GroupRecurring {
		t.Fatalf("coupons should recur, got %q", out["src/coupons.go"].Group)
	}
	if out["src/gone.go"].Group != GroupRecurring {
		t.Fatalf("a no-longer-detected finding detected again recurs, got %q", out["src/gone.go"].Group)
	}
	if out["src/auth.go"].Group != GroupNew {
		t.Fatalf("auth should be new, got %q", out["src/auth.go"].Group)
	}
	if c := out["src/checkout.go"]; c.Group != GroupNew || c.MissCount != 1 {
		t.Fatalf("checkout should stay open after one miss, got group=%q misses=%d", c.Group, c.MissCount)
	}
}

func TestReconcileMovesToNoLongerAfterConsecutiveMisses(t *testing.T) {
	scan1 := reconcile(nil, []waveobj.RadarFinding{find("src/checkout.go")})
	scan2 := reconcile(nil, scan1)
	if len(scan2) != 1 || scan2[0].Group != GroupNoLonger {
		t.Fatalf("a second consecutive miss must move it to no-longer-detected, got %+v", scan2)
	}
	if scan3 := reconcile(nil, scan2); len(scan3) != 0 {
		t.Fatalf("a no-longer-detected finding missed again is dropped, got %+v", scan3)
	}
}

func TestReconcileRedetectionResetsMisses(t *testing.T) {
	missed := reconcile(nil, []waveobj.RadarFinding{find("src/checkout.go")})
	back := reconcile(missed, missed)
	if len(back) != 1 || back[0].Group != GroupRecurring || back[0].MissCount != 0 {
		t.Fatalf("a detected finding must recur with its misses reset, got %+v", back)
	}
}

func TestReconcileKeepsDecisions(t *testing.T) {
	baseline := []waveobj.RadarFinding{withGroup(find("src/a.go"), GroupDismissed), withGroup(find("src/b.go"), GroupSuppressed)}

	// detected again, as a fresh audit would report them: no group, no disposition
	out := byFile(reconcile([]waveobj.RadarFinding{find("src/a.go"), find("src/b.go")}, baseline))
	if a := out["src/a.go"]; a.Group != GroupDismissed || a.Disposition == nil {
		t.Fatalf("a dismissal never reopens: a commit's time does not change, got %+v", a)
	}
	if b := out["src/b.go"]; b.Group != GroupSuppressed || b.Disposition == nil {
		t.Fatalf("a suppression must hold, got %+v", b)
	}

	// a user decision outlives detection, however many scans miss it
	missed := baseline
	for i := 0; i < NoLongerAfterMisses+1; i++ {
		missed = reconcile(nil, missed)
	}
	out = byFile(missed)
	if a := out["src/a.go"]; a.Group != GroupDismissed || a.Disposition == nil || a.MissCount != NoLongerAfterMisses+1 {
		t.Fatalf("an undetected dismissal is carried, got %+v", a)
	}
	if b := out["src/b.go"]; b.Group != GroupSuppressed || b.Disposition == nil {
		t.Fatalf("an undetected suppression is carried, got %+v", b)
	}
}

func TestReconcileCarriesInvestigationForward(t *testing.T) {
	base := find("src/a.go")
	base.Investigation = &waveobj.RadarInvestigation{RunID: "r1", Status: "done"}
	out := reconcile([]waveobj.RadarFinding{find("src/a.go"), find("src/new.go")}, []waveobj.RadarFinding{base})
	got := byFile(out)
	if inv := got["src/a.go"].Investigation; inv == nil || inv.RunID != "r1" {
		t.Fatalf("the investigation must carry forward, got %+v", inv)
	}
	if got["src/new.go"].Investigation != nil {
		t.Fatalf("a new finding has no investigation, got %+v", got["src/new.go"].Investigation)
	}
}

func TestAssignFindingIDsUniqueAndDeterministic(t *testing.T) {
	fs := assignFindingIDs([]waveobj.RadarFinding{{ID: "f1"}, {ID: "f1"}, {ID: "f7"}})
	for i, want := range []string{"f1", "f2", "f3"} {
		if fs[i].ID != want {
			t.Fatalf("ids must be renumbered in order, got %q at %d", fs[i].ID, i)
		}
	}
}
