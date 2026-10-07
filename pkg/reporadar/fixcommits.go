// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

var fixSubjectRe = regexp.MustCompile(`(?i)^fix(\([^)]*\))?!?:`)

var docExts = []string{".md", ".mdx", ".txt", ".rst"}

type gitFile struct {
	path string
	adds int
	dels int
}

type gitCommit struct {
	hash    string
	ts      int64
	subject string
	files   []gitFile
}

// parseGitLog parses `git log --pretty=format:%H\x1f%ct\x1f%s --numstat -z`. Records are separated by
// the NUL that -z appends after each commit's numstat block; within a record, the header line is
// %H\x1f%ct\x1f%s then numstat rows "adds\tdels\tpath".
func parseGitLog(out string) []gitCommit {
	var commits []gitCommit
	blocks := strings.Split(out, "\x00")
	var cur *gitCommit
	flush := func() {
		if cur != nil {
			commits = append(commits, *cur)
			cur = nil
		}
	}
	for _, block := range blocks {
		block = strings.Trim(block, "\n")
		if block == "" {
			continue
		}
		lines := strings.Split(block, "\n")
		for _, line := range lines {
			if strings.Contains(line, "\x1f") {
				flush()
				parts := strings.SplitN(line, "\x1f", 3)
				ts, _ := strconv.ParseInt(parts[1], 10, 64)
				cur = &gitCommit{hash: parts[0], ts: ts, subject: parts[2]}
				continue
			}
			cols := strings.Split(line, "\t")
			if len(cols) == 3 && cur != nil {
				adds, _ := strconv.Atoi(cols[0]) // "-" (binary) -> 0
				dels, _ := strconv.Atoi(cols[1])
				cur.files = append(cur.files, gitFile{path: cols[2], adds: adds, dels: dels})
			}
		}
	}
	flush()
	return commits
}

func isTestPath(p string) bool {
	p = strings.ToLower(p)
	return strings.Contains(p, "_test.") || strings.Contains(p, ".test.") ||
		strings.Contains(p, ".spec.") || strings.Contains(p, "/tests/") || strings.Contains(p, "/test/")
}

// clip bounds untrusted text to n bytes without splitting a rune.
func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := n
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}

// listWindowCommits returns the non-merge commits since sinceTs (unix millis), newest first.
func listWindowCommits(ctx context.Context, projectPath string, sinceTs int64) ([]gitCommit, error) {
	args := []string{"log", "--no-color", "--no-merges", "--pretty=format:%H%x1f%ct%x1f%s", "--numstat", "-z"}
	if sinceTs > 0 {
		args = append(args, "--since", strconv.FormatInt(sinceTs/1000, 10))
	} else {
		args = append(args, "--since", "30 days ago")
	}
	out, err := git(ctx, projectPath, args...)
	if err != nil {
		return nil, fmt.Errorf("git log: %w", err)
	}
	return parseGitLog(out), nil
}

func isDocPath(p string) bool {
	p = strings.ToLower(p)
	if strings.HasPrefix(p, "docs/") {
		return true
	}
	for _, ext := range docExts {
		if strings.HasSuffix(p, ext) {
			return true
		}
	}
	return false
}

func codeFiles(c gitCommit) []string {
	var files []string
	for _, f := range c.files {
		if !isDocPath(f.path) && !isTestPath(f.path) {
			files = append(files, f.path)
		}
	}
	sort.Strings(files)
	return files
}

// selectFixCommits applies the spec's trigger: fix subjects, code files only, ranked, audited ones removed, capped.
func selectFixCommits(commits []gitCommit, audited map[string]bool, limit int) []fixCommit {
	var fixes []fixCommit
	fileFixes := map[string]int{}
	for _, c := range commits {
		if !fixSubjectRe.MatchString(c.subject) {
			continue
		}
		files := codeFiles(c)
		if len(files) == 0 {
			continue
		}
		for _, f := range files {
			fileFixes[f]++
		}
		fixes = append(fixes, fixCommit{Hash: c.hash, Subject: c.subject, Ts: c.ts * 1000, Files: files})
	}
	score := func(fc fixCommit) int {
		best := 0
		for _, f := range fc.Files {
			best = max(best, fileFixes[f])
		}
		return best
	}
	var kept []fixCommit
	for _, fc := range fixes {
		if !audited[fc.Hash] {
			kept = append(kept, fc)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool {
		a, b := kept[i], kept[j]
		if sa, sb := score(a), score(b); sa != sb {
			return sa > sb
		}
		if a.Ts != b.Ts {
			return a.Ts > b.Ts
		}
		return a.Hash < b.Hash
	})
	if limit >= 0 && len(kept) > limit {
		kept = kept[:limit]
	}
	return kept
}
