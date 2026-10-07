// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestRadarReportRoundTrip(t *testing.T) {
	ctx := context.Background()
	rpt, err := CreateRadarReport(ctx, "payments-api", "/repos/payments-api")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if rpt.OID == "" || rpt.Status != "collecting" {
		t.Fatalf("bad new report: %+v", rpt)
	}
	if err := UpdateRadarReport(ctx, rpt.OID, func(r *waveobj.RadarReport) {
		r.Status = "completed"
	}); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := GetRadarReport(ctx, rpt.OID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != "completed" {
		t.Fatalf("update not persisted: %q", got.Status)
	}
	all, err := GetRadarReports(ctx, "/repos/payments-api")
	if err != nil || len(all) != 1 {
		t.Fatalf("list: %v n=%d", err, len(all))
	}
	if err := DeleteRadarReport(ctx, rpt.OID); err != nil {
		t.Fatalf("delete: %v", err)
	}
}

// reports stored by the lens pipeline carry keys the type no longer has; they must still load
func TestRadarReportLoadsRetiredWireFields(t *testing.T) {
	ctx := context.Background()
	rpt, err := CreateRadarReport(ctx, "payments-api", "/repos/payments-api")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	legacy := `{"otype":"radarreport","oid":"` + rpt.OID + `","version":1,"projectname":"payments-api","projectpath":"/repos/payments-api",` +
		`"status":"completed","startedts":1,"coverage":{"git":"ok"},"partialsources":["git"],"payloadtokens":900,` +
		`"totaltokensestimated":true,"moderuns":[{"mode":"security","status":"completed"}],"lensprogress":{"security":"ok"},` +
		`"findings":[{"id":"f1","fingerprint":"RAD-1","group":"new","mode":"security","strength":"strong",` +
		`"boundarylabel":"auth","signalids":[],"files":["a.go"],"mission":"m"}],"meta":{}}`
	if err := WithTx(ctx, func(tx *TxWrap) error {
		tx.Exec("UPDATE db_radarreport SET data = ? WHERE oid = ?", legacy, rpt.OID)
		return nil
	}); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, err := GetRadarReport(ctx, rpt.OID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(got.Findings) != 1 || got.Findings[0].ID != "f1" || got.Status != "completed" {
		t.Fatalf("findings lost: %+v", got)
	}
	if err := DeleteRadarReport(ctx, rpt.OID); err != nil {
		t.Fatalf("delete: %v", err)
	}
}
