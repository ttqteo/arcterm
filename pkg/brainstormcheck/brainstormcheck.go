package brainstormcheck

import (
	_ "embed"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	reportFileName = "builder-check.md"
	lineHead       = "brainstorm: builder questions "

	// EmptyReportReason is why a check fails when the reviewer ended its session with no report.
	EmptyReportReason = "The builder ended without its questions."
)

//go:embed builder-check-prompt.md
var promptTemplate string

type ActionKind int

const (
	Wait ActionKind = iota
	Deliver
	Fail
)

// Action is what one watcher tick does. Reason is set for Fail.
type Action struct {
	Kind   ActionKind
	Reason string
}

// Prompt is the reviewer's prompt for the spec at specPath, which ends with its report written to reportPath.
func Prompt(specPath, reportPath string) string {
	return strings.NewReplacer("[DOCUMENT_PATH]", specPath, "[REPORT_PATH]", reportPath).Replace(promptTemplate)
}

// ReportPath is where the reviewer's report is delivered: beside the brainstorm's file.
func ReportPath(brainstormFile string) string {
	return filepath.Join(filepath.Dir(brainstormFile), reportFileName)
}

// Line is the one line that hands the report at path to the brainstorming agent.
func Line(path string) string {
	return lineHead + path
}

// Decide judges the reviewer's run. lostReason is JudgingSessionLost's verdict, "" while the session still works.
// A finished run is judged before a lost reason: a reviewer that reported and then exited is not lost.
func Decide(run *waveobj.Run, lostReason string) Action {
	return decide(run, lostReason, EmptyReportReason)
}

// decide is Decide for any session Arc launches; emptyReason is why a finished run with no report fails.
func decide(run *waveobj.Run, lostReason, emptyReason string) Action {
	if run != nil && run.Status == jarvis.RunStatus_Done {
		if strings.TrimSpace(run.Report) == "" {
			return Action{Kind: Fail, Reason: emptyReason}
		}
		return Action{Kind: Deliver}
	}
	if lostReason != "" {
		return Action{Kind: Fail, Reason: lostReason}
	}
	return Action{Kind: Wait}
}
