// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	maxEditAdds    = 3
	maxEditRemoves = 3
)

// ValidateVerdicts checks the scan agent's result: one verdict per survivor, each well formed. Its errors name
// the id, so the agent can fix its file and resend.
func ValidateVerdicts(survivors []waveobj.WorkflowScanPattern, vs []waveobj.WorkflowScanVerdict) error {
	known := map[string]bool{}
	for _, s := range survivors {
		known[s.Id] = true
	}
	seen := map[string]bool{}
	for _, v := range vs {
		if !known[v.Id] {
			return fmt.Errorf("verdict %q: no survivor has that id", v.Id)
		}
		if seen[v.Id] {
			return fmt.Errorf("verdict %q: given twice; send one verdict per survivor", v.Id)
		}
		seen[v.Id] = true
		if err := checkVerdict(v); err != nil {
			return fmt.Errorf("verdict %q: %w", v.Id, err)
		}
	}
	for _, s := range survivors {
		if !seen[s.Id] {
			return fmt.Errorf("verdict %q: missing; send one verdict per survivor", s.Id)
		}
	}
	return nil
}

func blank(s string) bool {
	return strings.TrimSpace(s) == ""
}

func checkVerdict(v waveobj.WorkflowScanVerdict) error {
	switch v.Verdict {
	case waveobj.WorkflowScanVerdict_Suggest:
		for _, f := range []struct{ name, val string }{{"file", v.File}, {"where", v.Where}, {"fixproject", v.FixProject}} {
			if blank(f.val) {
				return fmt.Errorf("a suggest needs a %s", f.name)
			}
		}
		return checkEdit(v.Edit)
	case waveobj.WorkflowScanVerdict_Covered:
		if blank(v.Note) {
			return fmt.Errorf("a covered verdict needs a note naming the commit or file that covers it")
		}
	case waveobj.WorkflowScanVerdict_Declined:
		if v.DeclinedAt <= 0 {
			return fmt.Errorf("a declined verdict needs declinedat, the verified runs its Declined entry recorded")
		}
	default:
		return fmt.Errorf("verdict is %q; want suggest, covered or declined", v.Verdict)
	}
	return nil
}

func checkEdit(edit string) error {
	adds, removes := 0, 0
	for l := range strings.SplitSeq(edit, "\n") {
		switch {
		case blank(l):
		case strings.HasPrefix(l, "+"):
			adds++
		case strings.HasPrefix(l, "-"):
			removes++
		default:
			return fmt.Errorf("edit line %q is neither + nor -", l)
		}
	}
	if adds < 1 || adds > maxEditAdds {
		return fmt.Errorf("the edit has %d + lines; want 1 to %d", adds, maxEditAdds)
	}
	if removes > maxEditRemoves {
		return fmt.Errorf("the edit has %d - lines; want at most %d", removes, maxEditRemoves)
	}
	return nil
}
