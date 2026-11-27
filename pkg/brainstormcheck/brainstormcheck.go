package brainstormcheck

import (
	_ "embed"
	"fmt"
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

// Openings is how the prompts of the two sessions Arc runs on a brainstorm begin: the first line of each template,
// which holds no placeholder. Both sessions run as claude in a tab like the person's own, so a transcript reader tells
// them apart by their first prompt (pkg/sessionideas).
func Openings() []string {
	return []string{firstLine(promptTemplate), firstLine(judgePromptTemplate)}
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return strings.TrimSpace(line)
}

// Project is the project a brainstorm's file belongs to: the directory above the .superpowers it sits under. A
// brainstorm's relative spec path is relative to it.
func Project(brainstormFile string) (string, error) {
	for dir := filepath.Dir(brainstormFile); filepath.Dir(dir) != dir; dir = filepath.Dir(dir) {
		if filepath.Base(dir) == ".superpowers" {
			return filepath.Dir(dir), nil
		}
	}
	return "", fmt.Errorf("%s is not under a .superpowers directory", brainstormFile)
}

// ReportPath is where the reviewer's report is delivered: beside the brainstorm's file.
func ReportPath(brainstormFile string) string {
	return filepath.Join(filepath.Dir(brainstormFile), reportFileName)
}

// Line is the one line that hands the report at path to the brainstorming agent.
func Line(path string) string {
	return lineHead + path
}
