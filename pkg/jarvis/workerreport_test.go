// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"strings"
	"testing"
)

const validReport = "## Done\nlanded it\n\n## Differs from plan\nNone\n\n## Not verified\nnone.\n\n## For later tasks\n use X \n\n## Found not fixed\n NONE \n"

func TestWorkerReportParsesFields(t *testing.T) {
	rep, err := ParseWorkerReport(validReport)
	if err != nil {
		t.Fatal(err)
	}
	want := WorkerReport{Done: "landed it", ForLater: "use X"}
	if rep != want {
		t.Fatalf("got %+v, want %+v", rep, want)
	}
}

func TestWorkerReportAnyOrderAndCaseInsensitive(t *testing.T) {
	text := "## found NOT fixed\nbug\n## For later tasks\nNone\n## Not verified\nskipped e2e\n## differs from plan\nNone\n## DONE\nok\n"
	rep, err := ParseWorkerReport(text)
	if err != nil {
		t.Fatal(err)
	}
	if rep.FoundNotFixed != "bug" || rep.NotVerified != "skipped e2e" || rep.Done != "ok" || rep.ForLater != "" {
		t.Fatalf("got %+v", rep)
	}
}

func TestWorkerReportNoneWithTextIsContent(t *testing.T) {
	text := strings.Replace(validReport, "## Differs from plan\nNone", "## Differs from plan\nNone — nothing to add", 1)
	rep, err := ParseWorkerReport(text)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Differs != "None — nothing to add" {
		t.Fatalf("got %q", rep.Differs)
	}
}

func TestWorkerReportSubheadingIsContent(t *testing.T) {
	text := strings.Replace(validReport, "landed it", "landed it\n### sub\ndetail", 1)
	rep, err := ParseWorkerReport(text)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Done != "landed it\n### sub\ndetail" {
		t.Fatalf("got %q", rep.Done)
	}
}

func TestWorkerReportRefusals(t *testing.T) {
	cases := []struct {
		name, text, want string
	}{
		{"missing", strings.Replace(validReport, "## Not verified\nnone.\n\n", "", 1), "missing: Not verified"},
		{"duplicate", validReport + "## Done\nagain\n", "duplicate: Done"},
		{"unknown", validReport + "## Notes\nx\n", `unknown heading "## Notes"`},
		{"empty", strings.Replace(validReport, "use X", "", 1), "empty (write None): For later tasks"},
		{"stray", "Commit: 1a2b\n" + validReport, `text before the first heading: "Commit: 1a2b"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseWorkerReport(c.text)
			if err == nil || err.Error() != c.want {
				t.Fatalf("err = %v, want %q", err, c.want)
			}
		})
	}
}

func TestWorkerReportErrorNamesEveryProblem(t *testing.T) {
	text := "Commit: 1a2b\n## Done\nx\n## Done\ny\n## Notes\nz\n## Differs from plan\nNone\n## For later tasks\n\n## Found not fixed\nNone\n"
	_, err := ParseWorkerReport(text)
	want := `missing: Not verified; duplicate: Done; unknown heading "## Notes"; empty (write None): For later tasks; text before the first heading: "Commit: 1a2b"`
	if err == nil || err.Error() != want {
		t.Fatalf("err = %v\nwant  %s", err, want)
	}
}

func TestWorkerReportStrayTextQuoteIsCut(t *testing.T) {
	_, err := ParseWorkerReport(strings.Repeat("a", 200) + "\n" + validReport)
	if err == nil || strings.Count(err.Error(), "a") > 70 || !strings.Contains(err.Error(), "…") {
		t.Fatalf("err = %v", err)
	}
}

func TestWorkerReportCRLF(t *testing.T) {
	rep, err := ParseWorkerReport(strings.ReplaceAll(validReport, "\n", "\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	if rep.Done != "landed it" || strings.Contains(rep.ForLater, "\r") {
		t.Fatalf("got %+v", rep)
	}
}

func TestWorkerReportBOM(t *testing.T) {
	rep, err := ParseWorkerReport("\xef\xbb\xbf" + validReport)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Done != "landed it" {
		t.Fatalf("Done = %q, want the BOM stripped before the first heading", rep.Done)
	}
}

func TestWorkerReportFencedHeadingIsContent(t *testing.T) {
	text := strings.Replace(validReport, "landed it", "quoted:\n```md\n## Fake\n```\nend", 1)
	rep, err := ParseWorkerReport(text)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rep.Done, "## Fake") || !strings.HasSuffix(rep.Done, "end") {
		t.Fatalf("got %q", rep.Done)
	}
}

func TestWorkerReportSection(t *testing.T) {
	rep, _ := ParseWorkerReport(validReport)
	if got, ok := rep.Section("not-verified"); !ok || got != "" {
		t.Fatalf("not-verified = %q, %v", got, ok)
	}
	if got, ok := rep.Section("for-later"); !ok || got != "use X" {
		t.Fatalf("for-later = %q, %v", got, ok)
	}
	if _, ok := rep.Section("bogus"); ok {
		t.Fatal("bogus key reported ok")
	}
	for _, s := range WorkerReportSections {
		if _, ok := rep.Section(s.Key); !ok {
			t.Fatalf("declared key %q unknown to Section", s.Key)
		}
	}
}

func TestWorkerReportTemplateIsStructurallyValid(t *testing.T) {
	if _, err := ParseWorkerReport(WorkerReportTemplate); err != nil {
		t.Fatal(err)
	}
}

func TestReadWorkerReport(t *testing.T) {
	rep, un := ReadWorkerReport(validReport)
	if rep.Done != "landed it" || un != "" {
		t.Fatalf("structured: %+v %q", rep, un)
	}
	rep, un = ReadWorkerReport("  old free-form report \n")
	if rep != (WorkerReport{}) || un != "old free-form report" {
		t.Fatalf("legacy: %+v %q", rep, un)
	}
	rep, un = ReadWorkerReport("  ")
	if rep != (WorkerReport{}) || un != "" {
		t.Fatalf("empty: %+v %q", rep, un)
	}
}

// HEAD is not formatter-clean, so every task re-reported the same gofmt and prettier lines and leads filed them as
// open issues (about a fifth of all Found not fixed items, measured 2026-10-12)
func TestWorkerReportTemplateLeavesBaseFormatterStateOut(t *testing.T) {
	if !strings.Contains(WorkerReportTemplate, "not formatter or lint findings already on the base") {
		t.Fatalf("the Found not fixed placeholder must leave base formatter and lint state out:\n%s", WorkerReportTemplate)
	}
}
