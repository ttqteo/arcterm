// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

func TestSealReportClassifyTokensAndHotspotError(t *testing.T) {
	const sha = "0123456789abcdef0123456789abcdef01234567"
	r := &waveobj.RadarReport{
		ClassifyTokens: 50,
		Audits: []waveobj.RadarAudit{
			{Kind: KindSibling, Commit: "feedbeef", Status: AuditOK, TotalTokens: 100, ResolvedModel: "claude-sonnet-5-5"},
			{Kind: KindIntroduced, Commit: sha, Status: AuditFailed, TotalTokens: 20, Error: "bad reply"},
			{Kind: KindHotspot, Commit: sha, Files: []string{"src/hot.go"}, Status: AuditFailed, TotalTokens: 3, Error: "boom"},
		},
	}
	sealReport(r, testRoute, nil)
	if r.Status != StatusPartial || r.TotalTokens != 50+100+20+3 || r.ResolvedModel != "claude-sonnet-5-5" {
		t.Errorf("status %q tokens %d model %q", r.Status, r.TotalTokens, r.ResolvedModel)
	}
	if want := shortCommit(sha) + ": bad reply; src/hot.go: boom"; r.ClusterError != want {
		t.Errorf("clustererror = %q, want %q", r.ClusterError, want)
	}
	if len(r.Candidates) != 2 || r.Candidates[0].SourceRef != "introduced:"+sha || r.Candidates[1].SourceRef != "hotspot:"+sha+":src/hot.go" {
		t.Errorf("candidates = %+v", r.Candidates)
	}

	r.Audits = r.Audits[:1]
	r.ClassifyError = "commit classification: rate limited"
	sealReport(r, testRoute, nil)
	if r.Status != StatusCompleted || r.ClusterError != "" {
		t.Errorf("status comes from the audits alone: %q %q", r.Status, r.ClusterError)
	}
}

func TestHotspotKnownSitesFromBaseline(t *testing.T) {
	dir, _ := hotRepo(t)
	known := func(fp, group, riskKind, risk, file string, line int) waveobj.RadarFinding {
		return waveobj.RadarFinding{Fingerprint: fp, Group: group, RiskKind: riskKind, Risk: risk, Files: []string{file},
			SourceCommit: "feedbeef" + fp, Sites: []waveobj.RadarSite{{Line: line, Trigger: "x"}}}
	}
	seedBaseline(t, dir, nil,
		known("RAD-k1", GroupDismissed, RiskSiblingBug, "a dismissed risk", "src/hot.go", 2),
		known("RAD-k2", GroupNew, RiskIntroducedBug, "an open risk", "src/hot.go", 3),
		known("RAD-k3", GroupNew, RiskSiblingBug, "elsewhere", siblingFile, 3),
	)
	var prompt string
	fakeKindSessions(t, func(_ context.Context, kind, _, p string) (auditSessionResult, error) {
		if kind == KindHotspot {
			prompt = p
		}
		return cleanReply(), nil
	})
	if got := scan(t, dir); got.Status != StatusCompleted {
		t.Fatalf("status %q", got.Status)
	}
	for _, want := range []string{knownSitesBegin, "- line 2: a dismissed risk", "- line 3: an open risk"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("hotspot prompt lacks %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "elsewhere") {
		t.Error("a finding in another file is not a known site of this one")
	}
}
