// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRunRadarOriginRoundTrips(t *testing.T) {
	in := Run{
		ID:   "r1",
		Goal: "investigate",
		RadarOrigin: &RunRadarOrigin{
			ReportID:    "report-1",
			FindingID:   "finding-1",
			Fingerprint: "fp-9",
		},
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out Run
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.RadarOrigin == nil {
		t.Fatalf("radar origin lost on round-trip")
	}
	if out.RadarOrigin.ReportID != "report-1" || out.RadarOrigin.FindingID != "finding-1" || out.RadarOrigin.Fingerprint != "fp-9" {
		t.Errorf("origin ids not preserved: %+v", out.RadarOrigin)
	}
}

func TestRunOmitsRadarOriginWhenNil(t *testing.T) {
	b, err := json.Marshal(Run{ID: "r1", Goal: "g"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), "radarorigin") {
		t.Errorf("nil origin must be omitted, got %s", b)
	}
	// an old run (no origin key) must deserialize with a nil origin
	var out Run
	if err := json.Unmarshal([]byte(`{"id":"r1","goal":"g","workspaceid":"w","projectpath":"/p","status":"done","phases":[],"createdts":1}`), &out); err != nil {
		t.Fatalf("legacy unmarshal: %v", err)
	}
	if out.RadarOrigin != nil {
		t.Errorf("legacy run must have nil origin, got %+v", out.RadarOrigin)
	}
}

func TestRadarFindingSitesRoundTrip(t *testing.T) {
	f := RadarFinding{
		ID: "f1", SourceCommit: "abc", SourceSubject: "fix x", RootCause: "rc",
		Sites: []RadarSite{{Line: 3, Trigger: "t1", Actual: "a1", Expected: "e1", WhyNotCovered: "w1"}, {Line: 9, Trigger: "t2"}},
	}
	r := RadarReport{OID: "r1", Audits: []RadarAudit{{Commit: "abc", Subject: "fix x", Status: "ok", Files: []string{"a.go"}, HitCount: 2}}, Findings: []RadarFinding{f}}
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out RadarReport
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(out.Findings) != 1 || len(out.Findings[0].Sites) != 2 || out.Findings[0].Sites[0].WhyNotCovered != "w1" || out.Findings[0].SourceCommit != "abc" {
		t.Fatalf("finding lost fields: %+v", out.Findings)
	}
	if len(out.Audits) != 1 || out.Audits[0].Commit != "abc" || out.Audits[0].HitCount != 2 {
		t.Fatalf("audit lost fields: %+v", out.Audits)
	}
	plain, err := json.Marshal(RadarFinding{ID: "f2"})
	if err != nil {
		t.Fatalf("marshal plain: %v", err)
	}
	for _, k := range []string{"sourcecommit", "sourcesubject", "rootcause", "sites"} {
		if strings.Contains(string(plain), `"`+k+`"`) {
			t.Fatalf("key %q present on a finding without the new fields: %s", k, plain)
		}
	}
}
