package brainstormcheck

import (
	_ "embed"
	"path/filepath"
	"strings"
)

const (
	reportFileName = "builder-check.md"
	lineHead       = "brainstorm: builder questions "
)

//go:embed builder-check-prompt.md
var promptTemplate string

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
