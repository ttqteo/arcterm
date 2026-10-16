// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	evidenceToneOK   = "ok"
	evidenceToneWarn = "warn"
	evidenceToneNone = "none"

	evidenceDay         = 24 * time.Hour
	evidenceMaxOKRefs   = 3
	evidenceClaudeDoc   = "CLAUDE.md"
	evidenceAgentsDoc   = "AGENTS.md"
	evidenceTranscripts = ".jsonl"
)

// test seam: dated claims are aged against this clock
var evidenceNow = time.Now

var evidenceHarvesterKeys = []string{"source", "source_hash", "harvested_at"}

var (
	// a repo path ends in a file extension and may carry a :line; it starts at a word boundary that
	// isn't a path separator, so absolute paths, ~ paths and urls never match.
	evidencePathRe   = regexp.MustCompile("(?:^|[\\s`'\"(\\[<])((?:[\\w.@-]+/)*[\\w@-][\\w.@-]*\\.[A-Za-z][A-Za-z0-9]*)(?::(\\d+))?")
	evidenceCommitRe = regexp.MustCompile(`\b[0-9a-f]{7,40}\b`)
	evidenceIsoRe    = regexp.MustCompile(`\b(?:(\d{4})-)?(\d{2})-(\d{2})\b`)
	evidenceMonthRe  = regexp.MustCompile(`\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.? (\d{1,2})\b(?:,? (\d{4})\b)?`)
	evidenceWordRe   = regexp.MustCompile(`([A-Za-z]+) $`)
)

// GatherEvidence appends the evidence a judge needs to each memory: what it names that is gone, the
// index's view of it, its provenance, its dates and how often sessions read it.
func GatherEvidence(inv *Inventory, projectPath, defaultBranch string, transcriptDirs []string) error {
	repo, err := evidenceLoadRepo(projectPath, defaultBranch)
	if err != nil {
		return err
	}
	dead := map[string]bool{}
	for _, d := range inv.DeadLinks {
		dead[d] = true
	}
	now := evidenceNow()
	for i := range inv.Memories {
		m := &inv.Memories[i]
		evidenceIndex(m, dead)
		if err := repo.references(m); err != nil {
			return err
		}
		if err := repo.commits(m); err != nil {
			return err
		}
		evidenceHarvester(m)
		evidenceDates(m, now)
	}
	return evidenceReads(inv, transcriptDirs)
}

func evidenceAdd(m *Memory, tone, text, code string) {
	m.Evidence = append(m.Evidence, wshrpc.MemEvidence{Tone: tone, Text: text, Code: code})
}

func evidenceIndex(m *Memory, dead map[string]bool) {
	if m.IndexLine == "" {
		evidenceAdd(m, evidenceToneWarn, "Not in the index, so no session loads it", "")
		return
	}
	for _, link := range IndexLinks(m.IndexLine) {
		name := filepath.ToSlash(filepath.Clean(link))
		if dead[name] {
			evidenceAdd(m, evidenceToneWarn, "Its index line also links a file that is gone: ", name)
		}
	}
}

func evidenceHarvester(m *Memory) {
	harvested := false
	for _, k := range evidenceHarvesterKeys {
		if _, ok := m.Frontmatter[k]; ok {
			harvested = true
		}
	}
	if !harvested {
		return
	}
	text := "Written by the old harvester"
	if at := m.Frontmatter["harvested_at"]; at != "" {
		text += " on " + at
	}
	if src := m.Frontmatter["source"]; src != "" {
		text += ", from " + src
	}
	evidenceAdd(m, evidenceToneNone, text, "")
}

// evidenceRepo is what reference and commit checks need from the project's repo, read once per check.
type evidenceRepo struct {
	top     string   // git toplevel; "" when the project isn't a repo
	roots   []string // dirs a relative path may start from
	tracked []string // toplevel-relative, slash-separated
	deleted []string // every path a commit on HEAD deleted
	branch  string   // the default branch; "" when it doesn't resolve
	lines   map[string]int
}

func evidenceLoadRepo(projectPath, defaultBranch string) (*evidenceRepo, error) {
	r := &evidenceRepo{roots: []string{projectPath}, lines: map[string]int{}}
	top, err := runGit(projectPath, "rev-parse", "--show-toplevel")
	if err != nil {
		// not a repo: paths are checked on disk only, and no commit can be looked up
		return r, nil
	}
	r.top = filepath.FromSlash(top)
	r.roots = append(r.roots, r.top)
	tracked, err := runGit(r.top, "-c", "core.quotepath=false", "ls-files")
	if err != nil {
		return nil, fmt.Errorf("listing tracked files for memory evidence: %w", err)
	}
	r.tracked = evidenceSplitLines(tracked)
	if _, err := runGit(r.top, "rev-parse", "--verify", "--quiet", "HEAD"); err != nil {
		// no commits yet: nothing was ever deleted, and no commit can be on a branch
		return r, nil
	}
	deleted, err := runGit(r.top, "-c", "core.quotepath=false", "log", "--diff-filter=D", "--no-renames", "--name-only", "--format=")
	if err != nil {
		return nil, fmt.Errorf("listing deleted files for memory evidence: %w", err)
	}
	r.deleted = evidenceSplitLines(deleted)
	if defaultBranch != "" {
		if _, err := runGit(r.top, "rev-parse", "--verify", "--quiet", defaultBranch+"^{commit}"); err == nil {
			r.branch = defaultBranch
		}
	}
	return r, nil
}

func evidenceSplitLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

// evidenceSuffixMatch returns the paths that are ref itself or end with "/"+ref, so a path relative to
// a subproject, or a partial path, still finds its repo file.
func evidenceSuffixMatch(paths []string, ref string) []string {
	var out []string
	for _, p := range paths {
		if p == ref || strings.HasSuffix(p, "/"+ref) {
			out = append(out, p)
		}
	}
	return out
}

// resolve finds the file a reference names. gone means the repo once had it and has it no longer. a
// reference that resolves to nothing and was never deleted isn't a repo path, so it says nothing.
func (r *evidenceRepo) resolve(ref string) (path string, gone bool) {
	for _, root := range r.roots {
		p := filepath.Join(root, filepath.FromSlash(ref))
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p, false
		}
	}
	if hits := evidenceSuffixMatch(r.tracked, ref); len(hits) > 0 {
		if len(hits) == 1 {
			return filepath.Join(r.top, filepath.FromSlash(hits[0])), false
		}
		// ambiguous: it exists, but which file a :line means can't be told
		return "", false
	}
	return "", len(evidenceSuffixMatch(r.deleted, ref)) > 0
}

func (r *evidenceRepo) lineCount(path string) (int, error) {
	if n, ok := r.lines[path]; ok {
		return n, nil
	}
	tf, err := ReadText(path)
	if err != nil {
		return 0, err
	}
	r.lines[path] = len(tf.Lines)
	return len(tf.Lines), nil
}

func (r *evidenceRepo) references(m *Memory) error {
	seen := map[string]bool{}
	var found []string
	flagged := false
	for _, idx := range evidencePathRe.FindAllStringSubmatchIndex(m.Body, -1) {
		end := idx[1]
		if end < len(m.Body) && strings.ContainsRune(`/\`, rune(m.Body[end])) {
			continue
		}
		ref := m.Body[idx[2]:idx[3]]
		lineRef := ""
		if idx[4] >= 0 {
			lineRef = m.Body[idx[4]:idx[5]]
		}
		shown := ref
		if lineRef != "" {
			shown += ":" + lineRef
		}
		if seen[shown] {
			continue
		}
		seen[shown] = true
		path, gone := r.resolve(ref)
		if gone {
			evidenceAdd(m, evidenceToneWarn, "Names a file that is gone: ", ref)
			flagged = true
			continue
		}
		if path == "" {
			continue
		}
		if lineRef != "" {
			n, err := r.lineCount(path)
			if err != nil {
				return fmt.Errorf("checking %s named by memory %s: %w", shown, m.Name, err)
			}
			if line, _ := strconv.Atoi(lineRef); line > n {
				evidenceAdd(m, evidenceToneWarn, fmt.Sprintf("Names a line past the end of its file, which has %d lines: ", n), shown)
				flagged = true
				continue
			}
		}
		found = append(found, shown)
	}
	if !flagged && len(found) > 0 {
		if len(found) > evidenceMaxOKRefs {
			found = append(found[:evidenceMaxOKRefs], "…")
		}
		evidenceAdd(m, evidenceToneOK, "What it names still exists: ", strings.Join(found, ", "))
	}
	return nil
}

func (r *evidenceRepo) commits(m *Memory) error {
	if r.branch == "" {
		return nil
	}
	seen := map[string]bool{}
	for _, h := range evidenceCommitRe.FindAllString(m.Body, -1) {
		// a word of hex letters only, or a plain number, is too likely not to be a hash
		if seen[h] || !strings.ContainsAny(h, "0123456789") || !strings.ContainsAny(h, "abcdef") {
			continue
		}
		seen[h] = true
		full, err := runGit(r.top, "rev-parse", "--verify", "--quiet", h+"^{commit}")
		if err != nil {
			continue // not a commit this repo has
		}
		_, err = runGit(r.top, "merge-base", "--is-ancestor", full, r.branch)
		if err == nil {
			continue
		}
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
			return fmt.Errorf("checking commit %s named by memory %s: %w", h, m.Name, err)
		}
		evidenceAdd(m, evidenceToneWarn, fmt.Sprintf("Names a commit that isn't on %s: ", r.branch), h)
	}
	return nil
}

// evidenceDates reports each date the body names with its age. age is evidence for the judge only.
func evidenceDates(m *Memory, now time.Time) {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	seen := map[string]bool{}
	add := func(start, end int, date time.Time) {
		text := m.Body[start:end]
		if seen[text] {
			return
		}
		seen[text] = true
		claim := text
		if w := evidenceWordRe.FindStringSubmatch(m.Body[:start]); w != nil {
			claim = strings.ToLower(w[1]) + " " + text
		}
		evidenceAdd(m, evidenceToneNone, fmt.Sprintf("Dated claim: %s, %s", claim, evidenceAge(today, date)), "")
	}
	for _, idx := range evidenceIsoRe.FindAllStringSubmatchIndex(m.Body, -1) {
		if !evidenceDateBounded(m.Body, idx[0], idx[1]) {
			continue
		}
		month, _ := strconv.Atoi(m.Body[idx[4]:idx[5]])
		day, _ := strconv.Atoi(m.Body[idx[6]:idx[7]])
		year := -1
		if idx[2] >= 0 {
			year, _ = strconv.Atoi(m.Body[idx[2]:idx[3]])
		}
		if date, ok := evidenceDate(today, year, month, day); ok {
			add(idx[0], idx[1], date)
		}
	}
	for _, idx := range evidenceMonthRe.FindAllStringSubmatchIndex(m.Body, -1) {
		month := evidenceMonth(m.Body[idx[2]:idx[3]])
		day, _ := strconv.Atoi(m.Body[idx[4]:idx[5]])
		year := -1
		if idx[6] >= 0 {
			year, _ = strconv.Atoi(m.Body[idx[6]:idx[7]])
		}
		if date, ok := evidenceDate(today, year, month, day); ok {
			add(idx[0], idx[1], date)
		}
	}
}

// evidenceDateBounded rejects a numeric date that is part of a version, path, time or longer number.
func evidenceDateBounded(s string, start, end int) bool {
	if start > 0 && strings.ContainsRune("-./:_", rune(s[start-1])) {
		return false
	}
	if end < len(s) {
		next := s[end]
		if strings.ContainsRune("-/:_", rune(next)) {
			return false
		}
		if next == '.' && end+1 < len(s) && s[end+1] >= '0' && s[end+1] <= '9' {
			return false
		}
	}
	return true
}

func evidenceMonth(name string) int {
	for m := time.January; m <= time.December; m++ {
		if strings.HasPrefix(m.String(), name[:3]) {
			return int(m)
		}
	}
	return 0
}

// evidenceDate builds a date; a date without a year is its latest occurrence on or before today.
func evidenceDate(today time.Time, year, month, day int) (time.Time, bool) {
	yearless := year < 0
	if yearless {
		year = today.Year()
	}
	if month < 1 || month > 12 || day < 1 {
		return time.Time{}, false
	}
	date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	if date.Day() != day {
		return time.Time{}, false // a day past the month's end
	}
	if yearless && date.After(today) {
		date = date.AddDate(-1, 0, 0)
	}
	return date, true
}

func evidenceAge(today, date time.Time) string {
	days := int(today.Sub(date) / evidenceDay)
	switch {
	case days == 0:
		return "today"
	case days == 1:
		return "1 day ago"
	case days > 1:
		return fmt.Sprintf("%d days ago", days)
	case days == -1:
		return "in 1 day"
	default:
		return fmt.Sprintf("in %d days", -days)
	}
}

// evidenceReads counts, per memory, the sessions whose transcript has a Read tool call on its file.
// the index text is in every session, so a name in text counts for nothing.
func evidenceReads(inv *Inventory, transcriptDirs []string) error {
	targets := map[string]int{}
	for i, m := range inv.Memories {
		targets[evidenceNormPath(m.Path)] = i
	}
	sessions := 0
	for _, dir := range transcriptDirs {
		entries, err := os.ReadDir(dir)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("reading transcripts in %s: %w", dir, err)
		}
		for _, e := range entries {
			if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), evidenceTranscripts) {
				continue
			}
			path := filepath.Join(dir, e.Name())
			reads, err := evidenceTranscriptReads(path, targets)
			if err != nil {
				// one unreadable transcript shouldn't fail the check; it just isn't counted
				log.Printf("memhygiene: skipping transcript %s: %v", path, err)
				continue
			}
			sessions++
			for i, at := range reads {
				m := &inv.Memories[i]
				m.Reads++
				if at > m.LastRead {
					m.LastRead = at
				}
			}
		}
	}
	inv.Sessions = sessions
	if sessions == 0 {
		return nil
	}
	now := evidenceNow()
	for i := range inv.Memories {
		m := &inv.Memories[i]
		text := fmt.Sprintf("Read in %s of %s sessions", evidenceCount(m.Reads), evidenceCount(sessions))
		if m.Reads > 0 && m.LastRead > 0 {
			text += ", last on " + evidenceShortDate(time.UnixMilli(m.LastRead), now)
		}
		evidenceAdd(m, evidenceToneNone, text, "")
	}
	return nil
}

type evidenceTranscriptLine struct {
	Timestamp string `json:"timestamp"`
	Message   struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

type evidenceToolUse struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Input struct {
		FilePath string `json:"file_path"`
	} `json:"input"`
}

var (
	evidenceReadMarker    = []byte(`"Read"`)
	evidenceToolUseMarker = []byte(`"tool_use"`)
)

// evidenceTranscriptReads returns the memories one transcript reads, each with its last read time.
func evidenceTranscriptReads(path string, targets map[string]int) (map[int]int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var fallback int64
	if info, err := f.Stat(); err == nil {
		fallback = info.ModTime().UnixMilli()
	}
	reads := map[int]int64{}
	br := bufio.NewReader(f)
	for {
		line, rerr := br.ReadBytes('\n')
		if bytes.Contains(line, evidenceReadMarker) && bytes.Contains(line, evidenceToolUseMarker) {
			evidenceLineReads(line, targets, fallback, reads)
		}
		if rerr == io.EOF {
			return reads, nil
		}
		if rerr != nil {
			return nil, rerr
		}
	}
}

func evidenceLineReads(line []byte, targets map[string]int, fallback int64, reads map[int]int64) {
	var rec evidenceTranscriptLine
	if json.Unmarshal(line, &rec) != nil {
		return
	}
	var blocks []evidenceToolUse
	if json.Unmarshal(rec.Message.Content, &blocks) != nil {
		return // string content: plain text, never a tool call
	}
	at := fallback
	if ts, err := time.Parse(time.RFC3339Nano, rec.Timestamp); err == nil {
		at = ts.UnixMilli()
	}
	for _, b := range blocks {
		if b.Type != "tool_use" || b.Name != "Read" || b.Input.FilePath == "" {
			continue
		}
		i, ok := targets[evidenceNormPath(b.Input.FilePath)]
		if !ok {
			continue
		}
		if prev, seen := reads[i]; !seen || at > prev {
			reads[i] = at
		}
	}
}

// claude code's Read takes absolute paths, spelled with either slash and any drive-letter case
func evidenceNormPath(p string) string {
	return strings.ToLower(filepath.Clean(filepath.FromSlash(p)))
}

func evidenceCount(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

func evidenceShortDate(t, now time.Time) string {
	if t.Year() != now.Year() {
		return t.Format("Jan 2, 2006")
	}
	return t.Format("Jan 2")
}

// InstructionDocs reads the project's CLAUDE.md and AGENTS.md and the global CLAUDE.md, those that
// exist, path to content, so the judge can spot a memory that repeats them.
func InstructionDocs(projectPath, claudeHome string) map[string]string {
	docs := map[string]string{}
	for _, p := range []string{
		filepath.Join(projectPath, evidenceClaudeDoc),
		filepath.Join(projectPath, evidenceAgentsDoc),
		filepath.Join(claudeHome, evidenceClaudeDoc),
	} {
		if info, err := os.Stat(p); err != nil || info.IsDir() {
			continue
		}
		tf, err := ReadText(p)
		if err != nil {
			log.Printf("memhygiene: skipping instruction doc: %v", err)
			continue
		}
		docs[p] = strings.Join(tf.Lines, "\n")
	}
	return docs
}

// DefaultBranch is the branch a commit must be on to count as landed: the local branch origin/HEAD
// names (origin/<name> when there's no local one), else main, else master.
func DefaultBranch(projectPath string) string {
	if ref, err := runGit(projectPath, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"); err == nil && ref != "" {
		name := strings.TrimPrefix(ref, "origin/")
		if evidenceHasBranch(projectPath, name) {
			return name
		}
		return ref
	}
	for _, name := range []string{"main", "master"} {
		if evidenceHasBranch(projectPath, name) {
			return name
		}
	}
	return "main"
}

func evidenceHasBranch(projectPath, name string) bool {
	_, err := runGit(projectPath, "rev-parse", "--verify", "--quiet", "refs/heads/"+name)
	return err == nil
}
