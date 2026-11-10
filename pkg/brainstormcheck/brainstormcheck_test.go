package brainstormcheck

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestPromptFillsBothPaths(t *testing.T) {
	spec := filepath.Join("proj", "docs", "spec.md")
	report := filepath.Join("tmp", "report-uuid.md")
	got := Prompt(spec, report)

	if m := regexp.MustCompile(`\[[A-Z_]+\]`).FindString(got); m != "" {
		t.Fatalf("prompt left placeholder %s", m)
	}
	if !strings.Contains(got, "Read "+spec) {
		t.Errorf("prompt does not name the spec path %q", spec)
	}
	if want := "wsh jarvis complete --report " + report; !strings.Contains(got, want) {
		t.Errorf("prompt does not carry the complete command %q", want)
	}
	if !strings.Contains(got, "Write your report to "+report) {
		t.Errorf("prompt does not tell the reviewer to write its report to %q", report)
	}
	if !strings.Contains(got, "nothing important left") || !strings.Contains(got, "Change no file") {
		t.Errorf("prompt lost the empty-report allowance or the read-only rule")
	}
}

func TestReportPathBesideTheBrainstormFile(t *testing.T) {
	file := filepath.Join("proj", ".superpowers", "brainstorm", "topic", "brainstorm.json")
	want := filepath.Join("proj", ".superpowers", "brainstorm", "topic", "builder-check.md")
	if got := ReportPath(file); got != want {
		t.Fatalf("ReportPath = %q, want %q", got, want)
	}
}

func TestLine(t *testing.T) {
	if got, want := Line("/p/topic/builder-check.md"), "brainstorm: builder questions /p/topic/builder-check.md"; got != want {
		t.Fatalf("Line = %q, want %q", got, want)
	}
}
