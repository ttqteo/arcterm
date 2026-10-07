// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// review focus 4: a commit is audited once, so later scans re-check its finding against the tree alone.
func TestCarriedFindingLifecycle(t *testing.T) {
	dir := newRepo(t)
	commitFix(t, dir, "src/a.go")
	var seen calls
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		seen.add(commit)
		return hitReply(siblingFile, 3), nil
	})
	sibling := filepath.Join(dir, filepath.FromSlash(siblingFile))
	remove := func() {
		t.Helper()
		if err := os.Remove(sibling); err != nil {
			t.Fatal(err)
		}
	}
	step := func(what, group string, misses int) {
		t.Helper()
		got := scan(t, dir)
		if got.Status != StatusCompleted || len(got.Findings) != 1 || got.Findings[0].Group != group || got.Findings[0].MissCount != misses {
			t.Fatalf("%s: want one %s finding with %d misses, got status %q findings %+v", what, group, misses, got.Status, got.Findings)
		}
	}

	step("first scan", GroupNew, 0)
	step("second scan, commit not audited again", GroupRecurring, 0)
	remove()
	step("file deleted", GroupRecurring, 1)
	writeFile(t, dir, siblingFile, "package src\n\nfunc sibling() {}\n")
	step("file restored before the second miss", GroupRecurring, 0)
	remove()
	step("first miss", GroupRecurring, 1)
	step("second miss", GroupNoLonger, 2)
	if got := scan(t, dir); got.Status != StatusCompleted || len(got.Findings) != 0 {
		t.Fatalf("a no-longer-detected finding missed again is dropped, got %+v", got.Findings)
	}
	if n := len(seen.list()); n != 1 {
		t.Fatalf("the commit must be audited once across every scan, got %d audits", n)
	}
}

func TestRescanKeepsUserState(t *testing.T) {
	ctx := context.Background()
	dir := newRepo(t)
	writeFile(t, dir, "src/other.go", "package src\n")
	first := commitFix(t, dir, "src/a.go")
	commitFix(t, dir, "src/b.go")
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		if commit == first {
			return hitReply(siblingFile, 3), nil
		}
		return hitReply("src/other.go", 1), nil
	})
	rpt := scan(t, dir)
	if len(rpt.Findings) != 2 {
		t.Fatalf("fixture: want two findings, got %+v", rpt.Findings)
	}
	dismissed, suppressed := rpt.Findings[0], rpt.Findings[1]
	if err := SetDisposition(ctx, rpt.OID, dismissed.ID, "dismiss", "false-positive", "n"); err != nil {
		t.Fatal(err)
	}
	if err := SetDisposition(ctx, rpt.OID, suppressed.ID, "suppress", "wontfix", ""); err != nil {
		t.Fatal(err)
	}
	inv := waveobj.RadarInvestigation{RunID: "r1", ChannelID: "c1", Status: "done", FilesTouched: 2}
	if err := RecordInvestigation(ctx, dir, dismissed.Fingerprint, inv); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 2; i++ {
		got := scan(t, dir)
		byFP := map[string]waveobj.RadarFinding{}
		for _, f := range got.Findings {
			byFP[f.Fingerprint] = f
		}
		d, s := byFP[dismissed.Fingerprint], byFP[suppressed.Fingerprint]
		if len(got.Findings) != 2 || d.Group != GroupDismissed || d.Disposition == nil || d.Disposition.Reason != "false-positive" {
			t.Fatalf("rescan %d: the dismissal must hold, got %+v", i+1, d)
		}
		if s.Group != GroupSuppressed || s.Disposition == nil || s.Disposition.Action != "suppress" {
			t.Fatalf("rescan %d: the suppression must hold, got %+v", i+1, s)
		}
		if d.Investigation == nil || d.Investigation.RunID != "r1" || s.Investigation != nil {
			t.Fatalf("rescan %d: the investigation must stay on its finding, got %+v / %+v", i+1, d.Investigation, s.Investigation)
		}
		if len(got.Signals) != 2 {
			t.Fatalf("rescan %d: both carried findings keep their signal, got %+v", i+1, got.Signals)
		}
	}
}

func TestLegacyFindingsDropped(t *testing.T) {
	dir := newRepo(t)
	fakeSessions(t, func(context.Context, string) (auditSessionResult, error) { return cleanReply(), nil })
	kept, sig := carried("RAD-kept", GroupRecurring)
	legacy, _ := carried("RAD-legacy", GroupRecurring)
	legacy.SourceCommit = "" // written by the retired collectors
	seedBaseline(t, dir, []waveobj.RadarSignal{sig}, legacy, kept)

	got := scan(t, dir)
	if len(got.Findings) != 1 || got.Findings[0].Fingerprint != "RAD-kept" {
		t.Fatalf("a baseline finding with no source commit must be dropped, got %+v", got.Findings)
	}
}

func TestPruneReportsKeepsNewestAndBaseline(t *testing.T) {
	ctx := context.Background()
	pp := "/repos/prune"
	var ids []string
	for i := 0; i < ReportsKeptPerProject+3; i++ {
		rpt, _ := wstore.CreateRadarReport(ctx, "prune", pp)
		status := StatusFailed
		if i == 0 {
			status = StatusCompleted // the oldest report is the only successful one, so it is the baseline
		}
		wstore.UpdateRadarReport(ctx, rpt.OID, func(r *waveobj.RadarReport) {
			r.Status = status
			r.StartedTs = int64(1000 + i)
		})
		ids = append(ids, rpt.OID)
	}
	pruneReports(ctx, pp, ids[1])

	got, _ := wstore.GetRadarReports(ctx, pp)
	kept := map[string]bool{}
	for _, r := range got {
		kept[r.OID] = true
	}
	if len(got) != ReportsKeptPerProject+2 || !kept[ids[0]] || !kept[ids[1]] || kept[ids[2]] {
		t.Fatalf("want the newest %d plus the baseline and the finalized report, got %d (baseline=%v finalized=%v pruned-kept=%v)",
			ReportsKeptPerProject, len(got), kept[ids[0]], kept[ids[1]], kept[ids[2]])
	}
}
