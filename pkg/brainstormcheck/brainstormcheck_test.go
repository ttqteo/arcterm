package brainstormcheck

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestDecide(t *testing.T) {
	tests := []struct {
		name string
		run  *waveobj.Run
		lost string
		want Action
	}{
		{"done with a report delivers", &waveobj.Run{Status: jarvis.RunStatus_Done, Report: "1. what?"}, "", Action{Kind: Deliver}},
		{"done with an empty report fails", &waveobj.Run{Status: jarvis.RunStatus_Done}, "", Action{Kind: Fail, Reason: EmptyReportReason}},
		{"done with a blank report fails", &waveobj.Run{Status: jarvis.RunStatus_Done, Report: " \n\t"}, "", Action{Kind: Fail, Reason: EmptyReportReason}},
		{"done with a report beats a lost reason", &waveobj.Run{Status: jarvis.RunStatus_Done, Report: "q"}, "worker exited", Action{Kind: Deliver}},
		{"a lost reason fails with it", &waveobj.Run{Status: jarvis.RunStatus_Executing}, "the route refused it", Action{Kind: Fail, Reason: "the route refused it"}},
		{"a lost reason with no run fails with it", nil, "gone", Action{Kind: Fail, Reason: "gone"}},
		{"a working run waits", &waveobj.Run{Status: jarvis.RunStatus_Executing}, "", Action{Kind: Wait}},
		{"no run yet waits", nil, "", Action{Kind: Wait}},
		{"a report on an unfinished run waits", &waveobj.Run{Status: jarvis.RunStatus_Executing, Report: "q"}, "", Action{Kind: Wait}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Decide(tt.run, tt.lost); got != tt.want {
				t.Fatalf("Decide = %+v, want %+v", got, tt.want)
			}
		})
	}
}

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
