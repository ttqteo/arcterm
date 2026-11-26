// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"path/filepath"
	"strings"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// maxCommits is how many commit subjects the prompt carries: the project's last 200.
const maxCommits = 200

// Initiative is one initiative of the session's project as the prompt lists it: its OID (what an idea's effort names),
// its title and its chunk labels.
type Initiative struct {
	OID    string
	Title  string
	Chunks []string
}

// ProjectContext is what a session's project already holds, so the model leaves out an idea that is decided: its
// initiatives and their chunks, its ideas, its specs and plans, its deferred headings, its commits and the ideas the
// store already knows. Name and Root say which project that is.
type ProjectContext struct {
	Name        string       // the registered project that holds the session's folder; "" when none does
	Root        string       // that project's folder (a worktree folds to its main checkout); "" when unknown
	Initiatives []Initiative // the open initiatives that have chunks: what an idea can belong to
	Ideas       []string     // the titles of the initiatives that have no chunk yet
	Specs       []string     // file names under docs/superpowers/specs
	Plans       []string     // file names under docs/superpowers/plans
	Deferred    []string     // the ## and ### headings of docs/deferred.md
	Commits     []string     // the last 200 commit subjects
	Known       []string     // gists already in the store for this project, in any state; ScanNow fills it
}

// EffortFacts is an initiative as the caller read it from the effort store.
type EffortFacts struct {
	OID    string
	Title  string
	Chunks []string // labels
}

// BuildProjectContext arranges what the caller read for one project: an initiative with chunks is an Initiative, one
// without is an idea (its title only); deferredMD is docs/deferred.md and gitLog the output of `git log --format=%s`.
func BuildProjectContext(efforts []EffortFacts, specs, plans []string, deferredMD, gitLog string) ProjectContext {
	var pc ProjectContext
	for _, e := range efforts {
		if len(e.Chunks) == 0 {
			pc.Ideas = append(pc.Ideas, e.Title)
			continue
		}
		pc.Initiatives = append(pc.Initiatives, Initiative{OID: e.OID, Title: e.Title, Chunks: e.Chunks})
	}
	pc.Specs, pc.Plans = specs, plans
	pc.Deferred = DeferredHeadings(deferredMD)
	pc.Commits = CommitSubjects(gitLog)
	return pc
}

// DeferredHeadings is the ## and ### headings of a markdown file, without their marks; a line inside a code fence is no
// heading.
func DeferredHeadings(md string) []string {
	var out []string
	fenced := false
	for line := range strings.SplitSeq(md, "\n") {
		line = strings.TrimRight(line, " \t\r")
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			fenced = !fenced
			continue
		}
		if fenced {
			continue
		}
		var text string
		switch {
		case strings.HasPrefix(line, "### "):
			text = line[4:]
		case strings.HasPrefix(line, "## "):
			text = line[3:]
		default:
			continue
		}
		if text = strings.TrimSpace(text); text != "" {
			out = append(out, text)
		}
	}
	return out
}

// CommitSubjects is the subject lines of `git log --format=%s` output, newest first, at most 200.
func CommitSubjects(gitLog string) []string {
	var out []string
	for line := range strings.SplitSeq(gitLog, "\n") {
		if line = strings.TrimSpace(line); line == "" {
			continue
		}
		out = append(out, line)
		if len(out) == maxCommits {
			break
		}
	}
	return out
}

// KnownGists is the gists of the ideas the store holds for one project, in any state: a dropped idea is not proposed
// again, a kept one is already on an initiative.
func KnownGists(ideas []wshrpc.SessionIdea, projectPath string) []string {
	var out []string
	for _, i := range ideas {
		if samePath(i.ProjectPath, projectPath) {
			out = append(out, i.Gist)
		}
	}
	return out
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.ToSlash(filepath.Clean(a)), filepath.ToSlash(filepath.Clean(b)))
}

// gistKey is a gist as it is compared: lower case, letters and digits only, so a model's rewording of spacing or
// punctuation is still the same idea.
func gistKey(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}
