// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"cmp"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

// The project's instruction file (CLAUDE.md, else AGENTS.md) carries what its councils settled, in one block between
// these markers that arcterm writes from each council's Memory and rewrites when a Memory changes. Every agent of the
// project then starts from the decisions, not from a status line written weeks before them. The rest of the file is
// the agents' and the person's: arcterm never edits it.
const (
	docBegin = "<!-- arc:council-decisions:begin. arcterm writes this block from each council's Memory: change a " +
		"council's Memory, not these lines. -->"
	docBeginPrefix = "<!-- arc:council-decisions:begin"
	docEnd         = "<!-- arc:council-decisions:end -->"

	docCouncilsMax = 8   // the newest councils with a memory the block lists
	docTitleMax    = 160 // a council's topic in its heading
)

const docIntro = "What this project's councils settled, newest first. Where two councils differ, the newer one stands. " +
	"Each council's report is the file named under it."

// docSettled says a council has something settled to list: a chosen direction, or an Agreed or Ruled out entry. A
// council whose memory holds only Open lines has none, and one with no memory at all (nil) has none either.
func docSettled(c *Council) bool {
	if chosenDirectionOf(c) != "" {
		return true
	}
	if c.Memory == nil {
		return false
	}
	return len(c.Memory.EntriesOf(EntryAgreed)) > 0 || len(c.Memory.EntriesOf(EntryRuledOut)) > 0
}

// commitRe is a commit hash with the word that points at it: "merged as 786a11648", "ở 38d789b52", "in 5472f0692".
// The pointing word must start the text or follow whitespace, so "domain 786a11648" keeps "domain" (Go's \b is
// ASCII-only, which would not bound ở or tại). A run of 7–40 hex digits counts only when it holds a digit and a
// letter, so a number or a word is never taken. A hash quoted as code ("see `5472f0692`") goes with its backticks, so
// no empty pair is left.
var commitRe = regexp.MustCompile("(?i),?(?:(?:^|\\s+)(?:merged as|fixed in|in|at|as|ở|tại))?\\s*(?:`[0-9a-f]{7,40}`|\\b[0-9a-f]{7,40}\\b)")

// dropCommits is s with every commit hash, and the word that points at it, taken out, and its whitespace folded: a hash
// is the history of a decision, not the decision, and the branch it names is gone once it merged.
func dropCommits(s string) string {
	s = commitRe.ReplaceAllStringFunc(s, func(m string) string {
		hex := strings.Trim(strings.TrimLeft(m[strings.LastIndexAny(m, " \t\r\n\f")+1:], ","), "`")
		if !strings.ContainsAny(hex, "0123456789") || strings.Trim(strings.ToLower(hex), "0123456789") == "" {
			return m // a number or a word, not a hash
		}
		return ""
	})
	return routerFold(s)
}

// DocBlock is the block for a project's councils: those with a direction, an Agreed entry or a Ruled out entry in their
// Memory, bar a bench council, newest asked first, at most docCouncilsMax. Each is its date and topic, its report's
// path (slashes on every OS, relative to the project when inside it), then a line per Direction, Agreed and Ruled out
// (with its why) entry, none with a commit hash. No such council is no block ("").
func DocBlock(councils []*Council, project string) string {
	var shown []*Council
	for _, c := range councils {
		if c != nil && !c.Bench && docSettled(c) {
			shown = append(shown, c)
		}
	}
	if len(shown) == 0 {
		return ""
	}
	slices.SortStableFunc(shown, func(a, b *Council) int { return cmp.Compare(b.Created, a.Created) })
	shown = shown[:min(len(shown), docCouncilsMax)]

	var b strings.Builder
	b.WriteString(docBegin + "\n## Council decisions\n\n" + docIntro + "\n")
	for _, c := range shown {
		fmt.Fprintf(&b, "\n### %s · %s\n", time.UnixMilli(c.Created).Format("2006-01-02"), routerShown(dropCommits(c.Feature), docTitleMax))
		if c.DocPath != "" {
			fmt.Fprintf(&b, "Report: `%s`\n", docReportPath(c.DocPath, project))
		}
		b.WriteString("\n")
		if d := chosenDirectionOf(c); d != "" {
			b.WriteString("- Direction: " + dropCommits(d) + "\n")
		}
		// Open lines stay in the council's own Memory and in Library: in this block every agent would read them as
		// settled, and a question answered since would stay on the page. A council shown has a Memory (docSettled).
		for _, k := range []struct{ kind, label string }{{EntryAgreed, "Agreed"}, {EntryRuledOut, "Ruled out"}} {
			for _, e := range c.Memory.EntriesOf(k.kind) {
				line := "- " + k.label + ": " + dropCommits(e.Text)
				if why := dropCommits(e.Why); why != "" && k.kind == EntryRuledOut {
					line += " (why: " + why + ")"
				}
				b.WriteString(line + "\n")
			}
		}
	}
	b.WriteString(docEnd)
	return b.String()
}

// docReportPath is a council's report as the block names it, with slashes on every OS (the block is read by agents on
// any machine): relative to the project when it is inside it.
func docReportPath(path, project string) string {
	if rel, err := filepath.Rel(project, path); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel) {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(path)
}

// WithDocBlock is doc with block in place of the one it holds, or, with none, block appended under the file's own text
// after one blank line. An empty block takes the old one out and adds nothing. The rest of doc is kept as it was, and
// a file with Windows line endings gets the block with them. A begin marker with no end marker after it is an error: a
// rewrite would take everything after it.
func WithDocBlock(doc, block string) (string, error) {
	if strings.Contains(doc, "\r\n") {
		block = strings.ReplaceAll(block, "\n", "\r\n")
	}
	start := strings.Index(doc, docBeginPrefix)
	if start < 0 {
		if block == "" {
			return doc, nil
		}
		body := strings.TrimRight(doc, " \t\r\n")
		if body == "" {
			return block + eol(doc, block), nil
		}
		nl := eol(doc, block)
		return body + nl + nl + block + nl, nil
	}
	n := strings.Index(doc[start:], docEnd)
	if n < 0 {
		return "", errors.New("its council block has a begin marker and no end marker: put the end marker back, or remove the begin marker")
	}
	end := start + n + len(docEnd)
	if block != "" {
		return doc[:start] + block + doc[end:], nil
	}
	// the block goes with the line break after it, so the text around it closes up
	before, after := doc[:start], doc[end:]
	after = strings.TrimPrefix(strings.TrimPrefix(after, "\r\n"), "\n")
	after = strings.TrimLeft(after, "\r\n")
	if strings.TrimSpace(after) == "" {
		return strings.TrimRight(before, " \t\r\n") + eol(doc, block), nil
	}
	return before + after, nil
}

// eol is the line break doc uses: CRLF when it has one, else LF.
func eol(doc, block string) string {
	if strings.Contains(doc, "\r\n") || strings.Contains(block, "\r\n") {
		return "\r\n"
	}
	return "\n"
}

// DocTarget is the instruction file the block goes in: the project's CLAUDE.md, else its AGENTS.md (the one Claude Code
// loads when there is no CLAUDE.md), else a new CLAUDE.md.
func DocTarget(project string) string {
	claude := filepath.Join(project, "CLAUDE.md")
	for _, p := range []string{claude, filepath.Join(project, "AGENTS.md")} {
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			return p
		}
	}
	return claude
}

// docMu keeps two syncs from writing one file at once.
var docMu sync.Mutex

// SyncProjectDoc writes the block of project's councils into its instruction file (DocTarget) and says which file and
// whether it changed. A project folder that is not on this machine is left alone (no path), and so is a file the block
// would not change; a project with no council memory and no block in its file writes nothing. The file is written
// through a temp file and a rename, keeps its mode, and stays a link when it is one.
func SyncProjectDoc(project string) (string, bool, error) {
	if project == "" {
		return "", false, nil
	}
	if st, err := os.Stat(project); err != nil || !st.IsDir() {
		return "", false, nil
	}
	councils, err := List(project)
	if err != nil {
		return "", false, err
	}
	block := DocBlock(councils, project)

	docMu.Lock()
	defer docMu.Unlock()
	path := DocTarget(project)
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return path, false, err
		}
		real = path
	}
	old, err := os.ReadFile(real)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return path, false, err
	}
	doc, err := WithDocBlock(string(old), block)
	if err != nil {
		return path, false, fmt.Errorf("%s: %w", path, err)
	}
	if doc == string(old) {
		return path, false, nil
	}
	mode := fs.FileMode(0o644)
	if st, err := os.Stat(real); err == nil {
		mode = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(real), ".arc-council-*.tmp")
	if err != nil {
		return path, false, err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(doc); err != nil {
		tmp.Close()
		return path, false, err
	}
	if err := tmp.Close(); err != nil {
		return path, false, err
	}
	if err := os.Chmod(tmp.Name(), mode); err != nil {
		return path, false, err
	}
	// a reader holding the file (an agent launching in the project, an editor) would otherwise lose the rewrite until
	// the memory moves again
	if err := fileutil.RenameReplacing(tmp.Name(), real); err != nil {
		return path, false, err
	}
	return path, true, nil
}

// DocSection is what the block holds for one council, the key a caller compares to tell whether a save changed it: its
// own section of the block (empty with nothing settled). The project is part of it, so a council moved to another
// project counts as changed.
func DocSection(c *Council) string {
	if c == nil {
		return ""
	}
	return c.Project + "\x00" + DocBlock([]*Council{c}, c.Project)
}
