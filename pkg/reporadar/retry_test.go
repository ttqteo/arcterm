// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// partialReport scans a repo with two fix commits: one audit fails, the other finds a sibling.
func partialReport(t *testing.T) (dir, failed string, rpt *waveobj.RadarReport) {
	t.Helper()
	dir = newRepo(t)
	failed = commitFix(t, dir, "src/a.go")
	commitFix(t, dir, "src/b.go")
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		if commit == failed {
			return auditSessionResult{}, errors.New("boom")
		}
		return hitReply(siblingFile, 3), nil
	})
	rpt = scan(t, dir)
	if rpt.Status != StatusPartial || len(rpt.Findings) != 1 {
		t.Fatalf("fixture: status %q findings %d", rpt.Status, len(rpt.Findings))
	}
	return dir, failed, rpt
}

func TestRetryReauditsFailedOnly(t *testing.T) {
	ctx := context.Background()
	_, failed, rpt := partialReport(t)
	if err := SetDisposition(ctx, rpt.OID, rpt.Findings[0].ID, "dismiss", "false-positive", ""); err != nil {
		t.Fatal(err)
	}
	var seen calls
	fakeSessions(t, func(_ context.Context, commit string) (auditSessionResult, error) {
		seen.add(commit)
		return hitReply("src/b.go", 1), nil
	})
	runRetry(ctx, rpt.OID, testRoute)

	if got := seen.list(); len(got) != 1 || got[0] != failed {
		t.Fatalf("a retry must audit only the failed commit, audited %v", got)
	}
	got := getReport(t, rpt.OID)
	if got.Status != StatusCompleted || got.ClusterError != "" || len(got.Candidates) != 0 || auditsByStatus(got)[AuditOK] != 2 {
		t.Fatalf("status %q clustererror %q candidates %d audits %+v", got.Status, got.ClusterError, len(got.Candidates), got.Audits)
	}
	if got.WindowEndTs != rpt.WindowEndTs || got.EndHead != rpt.EndHead {
		t.Errorf("a retry must keep the first pass's repository boundary")
	}
	if len(got.Findings) != 2 {
		t.Fatalf("want the kept finding and the new one, got %+v", got.Findings)
	}
	kept, added := got.Findings[0], got.Findings[1]
	if kept.ID != "f1" || kept.Fingerprint != rpt.Findings[0].Fingerprint || kept.Group != GroupDismissed || kept.Disposition == nil {
		t.Errorf("the other finding must keep its id and dismissal, got %+v", kept)
	}
	if added.ID != "f2" || added.Group != GroupNew || added.SourceCommit != failed {
		t.Errorf("the retried commit's finding must be added as new, got %+v", added)
	}
	if len(got.Signals) != 2 {
		t.Errorf("both findings' signals must be kept, got %+v", got.Signals)
	}
	if err := Retry(ctx, rpt.OID); err == nil {
		t.Error("a completed report is not retryable")
	}
}

func TestRetryRejectsWithoutFailedAudit(t *testing.T) {
	ctx := context.Background()
	fakeSessions(t, func(context.Context, string) (auditSessionResult, error) { return cleanReply(), nil })
	seed := func(fn func(r *waveobj.RadarReport)) string {
		id := newReport(t, "/repos/retry-reject")
		if err := wstore.UpdateRadarReport(ctx, id, fn); err != nil {
			t.Fatal(err)
		}
		return id
	}
	noFailed := seed(func(r *waveobj.RadarReport) {
		r.Status = StatusPartial
		r.Audits = []waveobj.RadarAudit{{Commit: "a", Status: AuditOK}}
	})
	if err := Retry(ctx, noFailed); err == nil {
		t.Error("a report with no failed audit has nothing to retry")
	}
	interrupted := seed(func(r *waveobj.RadarReport) {
		r.Status = StatusFailed
		r.FatalError = "scan-interrupted"
		r.Audits = []waveobj.RadarAudit{{Commit: "a", Status: AuditFailed}}
	})
	if err := Retry(ctx, interrupted); err == nil {
		t.Error("a report that never finished its scan must be rescanned, not retried")
	}
}

func TestRetryCancelRestoresStatus(t *testing.T) {
	_, failed, rpt := partialReport(t)
	entered := make(chan struct{})
	fakeSessions(t, func(ctx context.Context, _ string) (auditSessionResult, error) {
		close(entered)
		<-ctx.Done()
		return auditSessionResult{}, errors.New("context canceled")
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runRetry(ctx, rpt.OID, testRoute)
	}()
	<-entered
	if mid := getReport(t, rpt.OID); mid.Status != StatusClustering || auditOf(t, mid, failed).Status != AuditRunning {
		t.Errorf("mid-retry: status %q audit %q", mid.Status, auditOf(t, mid, failed).Status)
	}
	cancel()
	<-done

	got := getReport(t, rpt.OID)
	if got.Status != StatusPartial || len(got.Findings) != 1 {
		t.Fatalf("a cancelled retry must leave the report partial with its findings, got %q / %d", got.Status, len(got.Findings))
	}
	if a := auditOf(t, got, failed); a.Status != AuditFailed || a.Error != auditOf(t, rpt, failed).Error {
		t.Fatalf("the failed audit must stay retryable as it was, got %+v", a)
	}
}

// hotspotPartial scans hotRepo with every sibling finding a site in the hot file and the hotspot audit failing.
func hotspotPartial(t *testing.T) (dir, revision string, rpt *waveobj.RadarReport) {
	t.Helper()
	dir, revision = hotRepo(t)
	fakeKindSessions(t, func(_ context.Context, kind, _, _ string) (auditSessionResult, error) {
		if kind == KindHotspot {
			return auditSessionResult{TotalTokens: 3}, errors.New("boom")
		}
		return hitReply("src/hot.go", 3), nil
	})
	rpt = scan(t, dir)
	if rpt.Status != StatusPartial || len(rpt.Findings) != 2 || len(failedAuditTargets(rpt)) != 1 {
		t.Fatalf("fixture: status %q findings %d audits %+v", rpt.Status, len(rpt.Findings), rpt.Audits)
	}
	return dir, revision, rpt
}

func hotspotAudit(t *testing.T, rpt *waveobj.RadarReport) waveobj.RadarAudit {
	t.Helper()
	for _, a := range rpt.Audits {
		if a.Kind == KindHotspot {
			return a
		}
	}
	t.Fatalf("no hotspot audit in %+v", rpt.Audits)
	return waveobj.RadarAudit{}
}

func TestRetryHotspotAudit(t *testing.T) {
	_, revision, rpt := hotspotPartial(t)
	var seen calls
	var prompt string
	fakeKindSessions(t, func(_ context.Context, kind, ref, p string) (auditSessionResult, error) {
		seen.add(kind + " " + ref)
		prompt = p
		return rootCauseHitReply("retries pile up", "src/hot.go", 2), nil
	})
	runRetry(context.Background(), rpt.OID, testRoute)

	if s := seen.list(); len(s) != 1 || s[0] != KindHotspot+" src/hot.go" {
		t.Fatalf("a retry must re-run only the failed hotspot audit, ran %v", s)
	}
	for _, want := range []string{"- fix: b\n- fix: a\n", knownSitesBegin, "- line 3: same nil row"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the retried prompt lacks %q:\n%s", want, prompt)
		}
	}
	got := getReport(t, rpt.OID)
	if got.Status != StatusCompleted || got.ClusterError != "" || len(got.Candidates) != 0 {
		t.Fatalf("status %q clustererror %q candidates %+v", got.Status, got.ClusterError, got.Candidates)
	}
	a := hotspotAudit(t, got)
	if a.Status != AuditOK || a.Commit != revision || targetFile(targetOfAudit(a)) != "src/hot.go" || len(a.FixSubjects) != 2 || a.RootCause != "retries pile up" {
		t.Errorf("hotspot audit = %+v", a)
	}
	if len(got.Findings) != 3 {
		t.Fatalf("want both sibling findings and the hotspot one, got %+v", got.Findings)
	}
	f := findingOfKind(t, got, RiskHotspotBug)
	if f.ID != "f3" || f.Group != GroupNew || f.SourceCommit != revision || strings.Join(f.FixSubjects, "|") != "fix: b|fix: a" {
		t.Errorf("hotspot finding = %+v", f)
	}
}

// review focus 4: a hotspot file gone before the retry fails that audit cleanly, naming the file.
func TestRetryHotspotFileGone(t *testing.T) {
	dir, revision, rpt := hotspotPartial(t)
	if err := os.Remove(filepath.Join(dir, "src", "hot.go")); err != nil {
		t.Fatal(err)
	}
	fakeKindSessions(t, func(_ context.Context, kind, ref, _ string) (auditSessionResult, error) {
		t.Errorf("no session may run for a missing file: %s %s", kind, ref)
		return auditSessionResult{}, nil
	})
	runRetry(context.Background(), rpt.OID, testRoute)

	got := getReport(t, rpt.OID)
	a := hotspotAudit(t, got)
	if got.Status != StatusPartial || a.Status != AuditFailed || !strings.Contains(a.Error, "src/hot.go") {
		t.Fatalf("status %q hotspot audit %+v", got.Status, a)
	}
	if !strings.HasPrefix(got.ClusterError, "src/hot.go: ") {
		t.Errorf("clustererror must name the file, got %q", got.ClusterError)
	}
	if len(got.Candidates) != 1 || got.Candidates[0].SourceRef != "hotspot:"+revision+":src/hot.go" {
		t.Errorf("candidates = %+v", got.Candidates)
	}
	if len(failedAuditTargets(got)) != 1 {
		t.Error("the failed hotspot audit stays retryable")
	}
}

func TestFailedAuditTargets(t *testing.T) {
	rpt := &waveobj.RadarReport{Audits: []waveobj.RadarAudit{
		{Commit: "legacy", Status: AuditFailed},
		{Kind: KindSibling, Commit: "ok", Status: AuditOK},
		{Kind: KindIntroduced, Commit: "intro", Subject: "feat: x", CommitTs: 5, Files: []string{"a.go"}, Status: AuditFailed},
		{Kind: KindHotspot, Commit: "rev", Files: []string{"hot.go"}, FixSubjects: []string{"fix: a", "fix: b"}, Status: AuditFailed},
	}}
	got := failedAuditTargets(rpt)
	want := []auditTarget{
		{Kind: KindSibling, Commit: "legacy"},
		{Kind: KindIntroduced, Commit: "intro", Subject: "feat: x", Ts: 5, Files: []string{"a.go"}},
		{Kind: KindHotspot, Commit: "rev", Files: []string{"hot.go"}, FixSubjects: []string{"fix: a", "fix: b"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
	if failedAuditTargets(&waveobj.RadarReport{Audits: []waveobj.RadarAudit{{Commit: "ok", Status: AuditOK}}}) != nil {
		t.Error("no failed audit, no target")
	}
}
