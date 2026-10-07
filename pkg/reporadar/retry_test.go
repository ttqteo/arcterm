// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"errors"
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
