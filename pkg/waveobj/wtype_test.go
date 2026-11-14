// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"encoding/json"
	"testing"
)

// TestRunDecodesRetiredRadarOrigin pins that a Run stored while Radar existed (it carries a "radarorigin" key)
// still decodes once the field is gone: encoding/json skips the unknown key.
func TestRunDecodesRetiredRadarOrigin(t *testing.T) {
	var out Run
	in := `{"otype":"run","oid":"r1","radarorigin":{"reportid":"x","findingid":"f6","fingerprint":"RAD-1"}}`
	if err := json.Unmarshal([]byte(in), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.OID != "r1" {
		t.Errorf("OID = %q, want r1", out.OID)
	}
}
