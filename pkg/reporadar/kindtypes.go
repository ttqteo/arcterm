// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	KindSibling    = "sibling"
	KindIntroduced = "introduced"
	KindHotspot    = "hotspot"

	RiskIntroducedBug = "introduced-bug"
	RiskHotspotBug    = "hotspot-bug"
)

// classifiedCommit is a window commit with at least one code file and a label.
type classifiedCommit struct {
	Hash, Subject string   // Subject is the original, bracket tags kept
	Ts            int64    // unix millis
	Code          []string // sorted code files, project-relative
	Churn         int      // adds + dels over Code
	Fix, Behavior bool
}

// auditTarget is what one audit session reviews. Commit kinds: Commit/Subject/Ts are the commit's, Files its
// code files. Hotspot: Commit/Subject/Ts are the file's last-touching revision, Files is the one file,
// FixSubjects the window's fix subjects for it.
type auditTarget struct {
	Kind        string
	Commit      string
	Subject     string
	Ts          int64
	Files       []string
	Churn       int
	FixSubjects []string
}

// Key identifies the target across scans. A hotspot's key carries its file, so a new revision of the same
// file is a new target.
func (t auditTarget) Key() string {
	kind := t.Kind
	if kind == "" {
		kind = KindSibling
	}
	key := kind + "\x00" + t.Commit
	if kind == KindHotspot && len(t.Files) > 0 {
		key += "\x00" + t.Files[0]
	}
	return key
}

// knownSite is an already-reported site the hotspot prompt lists as do-not-report.
type knownSite struct {
	Line int
	Risk string
}

var bracketTagsRe = regexp.MustCompile(`^(\s*\[[^\]]*\])+\s*`)

// normalizeSubject strips leading bracket tags ("[SIEM-1713][MPWeb] fix: x" -> "fix: x").
func normalizeSubject(s string) string {
	return bracketTagsRe.ReplaceAllString(s, "")
}

// extractJSONObject returns the reply's JSON object text: the first ``` fenced block's body when there is
// one, else the text from the first '{' to the last '}'.
func extractJSONObject(raw string) (string, error) {
	s := raw
	if _, rest, ok := strings.Cut(raw, "```"); ok {
		if body, _, ok := strings.Cut(rest, "```"); ok {
			s = body
		}
	}
	start, end := strings.Index(s, "{"), strings.LastIndex(s, "}")
	if start < 0 || end < start {
		return "", fmt.Errorf("malformed reply: no JSON object")
	}
	return s[start : end+1], nil
}
