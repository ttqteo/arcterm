// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"os"
	"path/filepath"
	"testing"
)

// TestAuditARealReport runs the cite check on a saved council report, for calibrating the keyword rule by hand:
// ARC_COUNCIL_AUDIT_DOC=<report.md> go test ./pkg/council -run TestAuditARealReport -v. The project is the folder two
// above docs/council/. It is skipped without the variable, so the suite never reads outside the repo.
func TestAuditARealReport(t *testing.T) {
	doc := os.Getenv("ARC_COUNCIL_AUDIT_DOC")
	if doc == "" {
		t.Skip("ARC_COUNCIL_AUDIT_DOC is not set")
	}
	data, err := os.ReadFile(doc)
	if err != nil {
		t.Fatal(err)
	}
	project := filepath.Dir(filepath.Dir(filepath.Dir(doc)))
	a := AuditReportCites(string(data), []string{project})
	t.Log("\n" + CiteCheckSection(string(data), []string{project}))
	if os.Getenv("ARC_COUNCIL_AUDIT_ALL") != "" {
		for _, c := range a.Cites {
			t.Logf("%-8s %s  [%v] %s", c.Verdict, c.Ref, c.Keywords, c.Note)
		}
	}
}
