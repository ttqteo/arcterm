// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestSetDispositionDismissAndReopen(t *testing.T) {
	ctx := context.Background()
	rpt, _ := wstore.CreateRadarReport(ctx, "pay", "/repos/pay")
	wstore.UpdateRadarReport(ctx, rpt.OID, func(r *waveobj.RadarReport) {
		r.Findings = []waveobj.RadarFinding{{ID: "f1", Fingerprint: "RAD-abc", Group: GroupNew}}
	})
	if err := SetDisposition(ctx, rpt.OID, "f1", "dismiss", "false-positive", "n"); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	got, _ := wstore.GetRadarReport(ctx, rpt.OID)
	if got.Findings[0].Group != GroupDismissed || got.Findings[0].Disposition == nil {
		t.Fatalf("expected dismissed w/ disposition, got %+v", got.Findings[0])
	}
	if got.Findings[0].Disposition.Reason != "false-positive" || got.Findings[0].Disposition.Ts == 0 {
		t.Fatalf("disposition must record reason + ts, got %+v", got.Findings[0].Disposition)
	}
	if err := SetDisposition(ctx, rpt.OID, "f1", "reopen", "", ""); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	got, _ = wstore.GetRadarReport(ctx, rpt.OID)
	if got.Findings[0].Group != GroupRecurring || got.Findings[0].Disposition != nil {
		t.Fatalf("expected reopened, got %+v", got.Findings[0])
	}
}

func TestSetDispositionUnsuppressReturnsToRecurring(t *testing.T) {
	ctx := context.Background()
	rpt, _ := wstore.CreateRadarReport(ctx, "pay", "/repos/pay")
	wstore.UpdateRadarReport(ctx, rpt.OID, func(r *waveobj.RadarReport) {
		r.Findings = []waveobj.RadarFinding{{ID: "f1", Fingerprint: "RAD-abc", Group: GroupNew}}
	})
	if err := SetDisposition(ctx, rpt.OID, "f1", "suppress", "Intentional", ""); err != nil {
		t.Fatalf("suppress: %v", err)
	}
	if err := SetDisposition(ctx, rpt.OID, "f1", "unsuppress", "", ""); err != nil {
		t.Fatalf("unsuppress: %v", err)
	}
	got, _ := wstore.GetRadarReport(ctx, rpt.OID)
	if got.Findings[0].Group != GroupRecurring || got.Findings[0].Disposition != nil {
		t.Fatalf("expected recurring with no disposition, got %+v", got.Findings[0])
	}
}

func TestApplyDispositionRejectsUnknownAction(t *testing.T) {
	ctx := context.Background()
	rpt, _ := wstore.CreateRadarReport(ctx, "pay", "/repos/pay")
	if err := ApplyDisposition(ctx, rpt.OID, "f1", "bogus", "", ""); err == nil {
		t.Fatal("unknown disposition action must error")
	}
}
