// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// The citation check. Go reads each `path:line` an expert cited against the tree the experts read and marks the cite
// ok or wrong; the label of a claim (LabelOf) is then counted from those marks and from the verify runs, never taken
// from a model. Nothing here writes a file.

// quoteSlack is how many lines either side of a cited line or range a quote may sit and still count as found: an
// expert's line number is often a few lines off, a quote that is nowhere near is not the code it says it read.
const quoteSlack = 3

// maxCiteLine caps a parsed line number, so the arithmetic around it cannot overflow.
const maxCiteLine = 1 << 30

// citeRefRe splits a ref into its path and its line or range: "pkg/x/y.go:42", "pkg/x/y.go:42-50", also written
// "y.go:L42-L50" or "y.go:42:7" (a column after the line). The path is matched lazily so a Windows drive's colon
// ("C:\repo\y.go:42") stays in it.
var citeRefRe = regexp.MustCompile(`^(.+?):L?(\d+)(?:-L?(\d+))?(?::\d+)?$`)

// citeRef is a ref taken apart. A ref with no line (a bare path) has HasLine false and From and To 0.
type citeRef struct {
	Path     string
	From, To int
	HasLine  bool
}

// splitCiteRef reads a ref. From is the lower end of a range, so a range written backwards reads as its two ends.
func splitCiteRef(ref string) citeRef {
	m := citeRefRe.FindStringSubmatch(ref)
	if m == nil {
		return citeRef{Path: ref}
	}
	from := atoiCapped(m[2])
	to := from
	if m[3] != "" {
		to = atoiCapped(m[3])
	}
	if to < from {
		from, to = to, from
	}
	return citeRef{Path: m[1], From: from, To: to, HasLine: true}
}

// atoiCapped reads digits as a number no larger than maxCiteLine.
func atoiCapped(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n > maxCiteLine {
		return maxCiteLine
	}
	return n
}

// checkable says a ref names a place in a file. A screenshot ("screenshot:<file>#<region>"), a link and an empty ref
// name none: they are neither read nor counted.
func checkable(ref string) bool {
	if ref == "" || strings.Contains(ref, "://") {
		return false
	}
	return !strings.HasPrefix(strings.ToLower(ref), "screenshot:")
}

// CheckEvidence marks each `path:line` (or `path:a-b`, or a bare path) in ev ok or wrong. A cite is ok when the file
// exists under one of roots, the line (or both ends of the range) is in the file, and a Quote, with its whitespace
// collapsed, is found in the cited lines or within quoteSlack lines of them, case counting. Otherwise it is wrong, and
// CiteNote says why. A screenshot ref, a link and an empty ref are left unchecked, and so is everything when roots is
// empty (there is no tree to check against).
//
// roots are absolute folders or files: the project first, then the attached folders and files, or an agent seat's own
// working directory. A relative ref is read against each folder in turn; an absolute one must lie under a root. It
// returns a new slice and starts every item from scratch (an earlier Cite and CiteNote are dropped), so it can run
// again after each reply pass.
func CheckEvidence(ev []CouncilEvidence, roots []string) []CouncilEvidence {
	if len(ev) == 0 {
		return ev
	}
	out := make([]CouncilEvidence, len(ev))
	for i, e := range ev {
		e.Cite, e.CiteNote = "", ""
		if ref := strings.TrimSpace(e.Ref); len(roots) > 0 && checkable(ref) {
			e.Cite, e.CiteNote = checkCite(splitCiteRef(ref), e.Quote, roots)
		}
		out[i] = e
	}
	return out
}

// checkCite is the verdict on one ref: CiteOK and no note, or CiteWrong and the reason.
func checkCite(r citeRef, quote string, roots []string) (string, string) {
	full, why := findCited(r.Path, roots)
	if why != "" {
		return CiteWrong, why
	}
	q := collapseSpace(quote)
	if !r.HasLine && q == "" {
		return CiteOK, "" // a bare path: the file is there, which is all there is to check
	}
	lo, hi := 1, maxCiteLine // a bare path with a quote looks for it anywhere in the file
	if r.HasLine {
		if r.From < 1 {
			return CiteWrong, fmt.Sprintf("line %d is not a line", r.From)
		}
		lo, hi = max(1, r.From-quoteSlack), r.To+quoteSlack
	}
	lines, total, err := readLines(full, lo, hi)
	if err != nil {
		return CiteWrong, "the file could not be read"
	}
	if r.HasLine && total >= 0 && total < r.To {
		return CiteWrong, fmt.Sprintf("line %d is past the end (%d lines)", r.To, total)
	}
	if q != "" && !strings.Contains(collapseSpace(strings.Join(lines, "\n")), q) {
		return CiteWrong, "quote not found " + nearText(r)
	}
	return CiteOK, ""
}

// nearText is where a quote was looked for: "near line 42", "near lines 5-8", "in the file".
func nearText(r citeRef) string {
	switch {
	case !r.HasLine:
		return "in the file"
	case r.From == r.To:
		return fmt.Sprintf("near line %d", r.From)
	default:
		return fmt.Sprintf("near lines %d-%d", r.From, r.To)
	}
}

// findCited resolves a ref's path against roots: the file's full path, or "" and why there is none. A relative path is
// joined to each root in turn, an absolute one must lie under a root, and a root that is itself a file matches only that
// file. Nothing that leaves its root counts.
func findCited(path string, roots []string) (full, why string) {
	inside, sawDir := false, false
	for _, root := range roots {
		if root = strings.TrimSpace(root); root == "" {
			continue
		}
		cand := filepath.Clean(path)
		if !filepath.IsAbs(cand) {
			cand = filepath.Join(root, cand)
		}
		rel, err := filepath.Rel(root, cand)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		inside = true
		info, err := os.Stat(cand)
		switch {
		case err != nil:
		case info.IsDir():
			sawDir = true
		default:
			return cand, ""
		}
	}
	switch {
	case sawDir:
		return "", "a folder, not a file"
	case inside:
		return "", "file not found"
	default:
		return "", "path is outside the folders this council reads"
	}
}

// readLines streams the file and returns its lines numbered lo to hi (1-based, line ends dropped) without keeping the
// rest. total is the number of lines in the file when the read reached its end, and -1 when it stopped at line hi first.
// A last line with no newline counts as a line.
func readLines(path string, lo, hi int) (lines []string, total int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	rd := bufio.NewReader(f)
	n := 0
	for {
		s, err := rd.ReadString('\n')
		if s != "" {
			n++
			if n >= lo && n <= hi {
				lines = append(lines, strings.TrimRight(s, "\r\n"))
			}
		}
		if err == io.EOF {
			return lines, n, nil
		}
		if err != nil {
			return nil, 0, err
		}
		if n >= hi {
			return lines, -1, nil
		}
	}
}

// collapseSpace turns every run of whitespace into one space and trims the ends, so a quote matches whatever the file
// indents or wraps differently.
func collapseSpace(s string) string { return strings.Join(strings.Fields(s), " ") }

// LabelOf is the label of one claim, counted from what Go checked: LabelDisproved when a verify run that tested the
// claim (state pass or fail) came out other than the expert expected, else LabelRan when one came out as expected, else
// LabelRead when at least one cite is ok, else LabelGuess. A run that did not test it (state not-run, or still a
// request) never counts, so a command that timed out leaves the claim Read or Guess; a wrong cite never counts either.
// A run matched when its state equals what the expert expected, so Expect must already be RunPass or RunFail.
func LabelOf(ev []CouncilEvidence, runs []CouncilRun) string {
	ran := false
	for _, r := range runs {
		if r.State != RunPass && r.State != RunFail {
			continue
		}
		if r.State != r.Expect {
			return LabelDisproved
		}
		ran = true
	}
	if ran {
		return LabelRan
	}
	for _, e := range ev {
		if e.Cite == CiteOK {
			return LabelRead
		}
	}
	return LabelGuess
}

// ApplyChecks checks the cites of every sent proposal and of every reply that takes a stance, and sets their labels.
// rootsFor gives the folders one expert's cites are read against (the project and the attached folders and files, or an
// agent seat's own working directory); nil, or an empty answer, leaves that expert's cites unchecked, and a label then
// follows from the runs alone. A held or dropped proposal, a plain reply (an answer to the person) and everything in a
// Brainstorm council are left exactly as they are: a Brainstorm asks for no evidence. It checks from scratch each time.
func ApplyChecks(c *Council, rootsFor func(expertId string) []string) {
	if c == nil || isBrainstorm(c) {
		return
	}
	roots := func(id string) []string {
		if rootsFor == nil {
			return nil
		}
		return rootsFor(id)
	}
	for i := range c.Proposals {
		p := &c.Proposals[i]
		if !Sent(p.Draft) {
			continue
		}
		p.Evidence = CheckEvidence(p.Evidence, roots(p.Author))
		p.Label = LabelOf(p.Evidence, p.Runs)
	}
	for i := range c.Replies {
		r := &c.Replies[i]
		if r.Stance == "" {
			continue
		}
		r.Evidence = CheckEvidence(r.Evidence, roots(r.Author))
		r.Label = LabelOf(r.Evidence, nil)
	}
}
