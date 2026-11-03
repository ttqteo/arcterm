// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var survivorsP123 = []waveobj.WorkflowScanPattern{{Id: "p1"}, {Id: "p2"}, {Id: "p3"}}

func suggest(id string) waveobj.WorkflowScanVerdict {
	return waveobj.WorkflowScanVerdict{
		Id: id, Verdict: waveobj.WorkflowScanVerdict_Suggest,
		File: "AGENTS.md", Where: "Gotchas", FixProject: "arcterm", Edit: "- old line\n+ new line\n",
	}
}

func validSet() []waveobj.WorkflowScanVerdict {
	return []waveobj.WorkflowScanVerdict{
		suggest("p1"),
		{Id: "p2", Verdict: waveobj.WorkflowScanVerdict_Covered, Note: "covered by be564a7a"},
		{Id: "p3", Verdict: waveobj.WorkflowScanVerdict_Declined, DeclinedAt: 4},
	}
}

func TestValidateVerdicts(t *testing.T) {
	cases := []struct {
		name   string
		edit   func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict
		wantId string
	}{
		{"missing", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict { return vs[:2] }, "p3"},
		{"duplicate", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict { return append(vs, suggest("p1")) }, "p1"},
		{"unknown", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict { return append(vs, suggest("p9")) }, "p9"},
		{"4 plus lines", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict {
			vs[0].Edit = "+a\n+b\n+c\n+d"
			return vs
		}, "p1"},
		{"4 minus lines", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict {
			vs[0].Edit = "-a\n-b\n-c\n-d\n+e"
			return vs
		}, "p1"},
		{"no plus line", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict {
			vs[0].Edit = "-a"
			return vs
		}, "p1"},
		{"suggest with no file", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict {
			vs[0].File = " "
			return vs
		}, "p1"},
		{"covered with no note", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict {
			vs[1].Note = ""
			return vs
		}, "p2"},
		{"declined at 0", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict {
			vs[2].DeclinedAt = 0
			return vs
		}, "p3"},
		{"unknown verdict", func(vs []waveobj.WorkflowScanVerdict) []waveobj.WorkflowScanVerdict {
			vs[1].Verdict = "maybe"
			return vs
		}, "p2"},
	}
	for _, tc := range cases {
		err := ValidateVerdicts(survivorsP123, tc.edit(validSet()))
		if err == nil || !strings.Contains(err.Error(), tc.wantId) {
			t.Errorf("%s: err = %v, want one naming %s", tc.name, err, tc.wantId)
		}
	}

	raised := validSet()
	raised[0].DeclinedAt = 3
	if err := ValidateVerdicts(survivorsP123, raised); err != nil {
		t.Errorf("a suggest raised again: %v", err)
	}
	if err := ValidateVerdicts(survivorsP123, validSet()); err != nil {
		t.Errorf("valid set: %v", err)
	}
}
