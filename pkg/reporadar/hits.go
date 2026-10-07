// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// canonFile makes a model-supplied file path forward-slashed, so a backslash escape is judged like a slash one.
func canonFile(file string) string {
	return canonPath(strings.ReplaceAll(file, "\\", "/"))
}

// siblingFingerprint is a finding's cross-scan identity: project, source fix commit, file. Never the line.
func siblingFingerprint(projectPath, commit, file string) string {
	return "RAD-" + shortHash(canonPath(projectPath) + "\x00" + commit + "\x00" + canonFile(file))[:8]
}

// siteLineCount returns the line count of a regular file inside the project, or false when the
// file is absolute, escapes the project, is missing or is not a regular file.
func siteLineCount(projectPath, file string) (int, bool) {
	rel := canonFile(file)
	if !filepath.IsLocal(filepath.FromSlash(rel)) {
		return 0, false
	}
	full := filepath.Join(projectPath, filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil || !info.Mode().IsRegular() {
		return 0, false
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return 0, false
	}
	n := strings.Count(string(data), "\n")
	if len(data) > 0 && data[len(data)-1] != '\n' {
		n++
	}
	return n, true
}

// validSite is the gate: file inside the project and present, line within the file, trigger not blank.
func validSite(projectPath, file string, line int, trigger string) bool {
	if strings.TrimSpace(trigger) == "" || line < 1 {
		return false
	}
	n, ok := siteLineCount(projectPath, file)
	return ok && line <= n
}

// commitSignal is the git signal a finding cites for its source fix.
func commitSignal(c fixCommit) waveobj.RadarSignal {
	files := append([]string(nil), c.Files...)
	summary := fmt.Sprintf("fix commit %s: %s", shortCommit(c.Hash), clip(Redact(c.Subject), maxEvidenceTextLen))
	facts := map[string]any{"subject": Redact(c.Subject), "files": files}
	return newSignal(CollectorGit, "commit:"+c.Hash, c.Ts, files, summary, facts, "")
}

func shortCommit(hash string) string {
	if len(hash) > 7 {
		return hash[:7]
	}
	return hash
}

// findingsFromAudit turns a reply's hits into findings: one per file, extra hits in a file as extra sites.
// kept is the number of hits that passed the gate.
func findingsFromAudit(projectPath string, c fixCommit, reply *auditReply) (findings []waveobj.RadarFinding, kept int) {
	if reply == nil {
		return nil, 0
	}
	byFile := map[string][]auditHit{}
	var order []string
	for _, h := range reply.Hits {
		if !validSite(projectPath, h.File, h.Line, h.Trigger) {
			continue
		}
		kept++
		file := canonFile(h.File)
		if _, seen := byFile[file]; !seen {
			order = append(order, file)
		}
		byFile[file] = append(byFile[file], h)
	}
	sigID := commitSignal(c).ID
	rootCause := Redact(reply.RootCause)
	for _, file := range order {
		findings = append(findings, buildSiblingFinding(projectPath, c, sigID, rootCause, file, byFile[file]))
	}
	return findings, kept
}

func buildSiblingFinding(projectPath string, c fixCommit, sigID, rootCause, file string, hits []auditHit) waveobj.RadarFinding {
	severity := ""
	sites := make([]waveobj.RadarSite, 0, len(hits))
	var mission strings.Builder
	fmt.Fprintf(&mission, "Fix commit %s (%s) fixed a bug; root cause: %s\n\nThe same bug may remain at:\n",
		shortCommit(c.Hash), Redact(c.Subject), rootCause)
	for _, h := range hits {
		s := waveobj.RadarSite{
			Line:          h.Line,
			Trigger:       Redact(h.Trigger),
			Actual:        Redact(h.Actual),
			Expected:      Redact(h.Expected),
			WhyNotCovered: Redact(h.WhyNotCovered),
		}
		sites = append(sites, s)
		fmt.Fprintf(&mission, "- %s:%d trigger: %s; actual: %s; expected: %s\n", file, s.Line, s.Trigger, s.Actual, s.Expected)
		if sev := normalizeSeverity(h.Severity); severityRank[sev] > severityRank[severity] {
			severity = sev
		}
	}
	return waveobj.RadarFinding{
		Fingerprint:   siblingFingerprint(projectPath, c.Hash, file),
		Group:         GroupNew,
		RiskKind:      RiskSiblingBug,
		Subsystem:     subsystemForPaths([]string{file}),
		Risk:          Redact(hits[0].Title),
		Why:           sites[0].WhyNotCovered,
		Severity:      severity,
		SignalIDs:     []string{sigID},
		Files:         []string{file},
		Mission:       mission.String(),
		SourceCommit:  c.Hash,
		SourceSubject: Redact(c.Subject),
		RootCause:     rootCause,
		Sites:         sites,
	}
}

// stillDetected re-runs the gate on a carried finding against the current tree: true when any site passes.
func stillDetected(projectPath string, f waveobj.RadarFinding) bool {
	if len(f.Files) == 0 {
		return false
	}
	for _, s := range f.Sites {
		if validSite(projectPath, f.Files[0], s.Line, s.Trigger) {
			return true
		}
	}
	return false
}
