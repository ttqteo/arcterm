// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/util/asciifold"
)

// The report's cite check. CheckEvidence marks the cites an expert lists as evidence, and only reads a quote when the
// expert gave one; the coordinator's prose cites ("… prints a verdict (results/curve.json:12).") are never read at all.
// AuditReportCites reads every `path:line` in the finished document instead, with no model: the file must be there under
// one of the council's folders, the line inside it, and a keyword of the sentence that cites it on or near the line. The
// document then carries the tally in its own section (writeCiteCheck), and `wsh council cites` runs the same check on a
// report already saved.

// The verdicts of one cited place.
const (
	CiteHolds   = "holds"   // the file and the line are there, and a keyword of a citing sentence is on or near it
	CiteNoMatch = "nomatch" // the line is there, but no keyword of any sentence citing it is near it
	CiteBroken  = "wrong"   // no such file, a folder, or a line past the end
	CiteOutside = "outside" // the path lies outside every folder the council reads: not checked
)

// auditWindowCap caps how many lines one cited range is read over, so a cite of a whole file's range stays cheap.
const auditWindowCap = 400

// reportRefRe finds a `path:line` or `path:a-b` in prose: a file name with an extension, under any folders, optionally
// absolute (a Windows drive or a leading slash), the line written plain or as L42, a column after it allowed. A path
// holds no spaces. Letters are any script's, so a council report's own name ("2026-11-02-hướng-….md") is a path.
var reportRefRe = regexp.MustCompile(`(?:[A-Za-z]:[\\/]|/)?(?:[\p{L}\p{M}\p{N}_.~\-]+[\\/])*[\p{L}\p{M}\p{N}_\-][\p{L}\p{M}\p{N}_.\-]*\.[A-Za-z][A-Za-z0-9]{0,7}:L?\d+(?:-L?\d+)?(?::\d+)?`)

// wrongCiteNoteRe is the note docEvidenceText puts after a wrong evidence cite: it is the check's words, not a claim's.
var wrongCiteNoteRe = regexp.MustCompile(`\(wrong cite[^)]*\)`)

// ReportCite is one place the report cites, with every sentence that cites it.
type ReportCite struct {
	Ref      string   // as first written: "results/curve.json:12"
	Where    []string // the part of the report each citing sentence is in: "Directions", "Related work proposes · P1"
	Verdict  string   // a Cite* verdict above
	Note     string   // why it is wrong, or the keywords looked for when none was found
	Keywords []string // the keywords found near the line, when it holds
	Times    int      // how many times the report cites it
}

// CiteAudit is the check of a whole report.
type CiteAudit struct {
	Cites []ReportCite // one per place, in the order first cited
}

// Count is how many places got verdict v.
func (a CiteAudit) Count(v string) int {
	n := 0
	for _, c := range a.Cites {
		if c.Verdict == v {
			n++
		}
	}
	return n
}

// Times is how many cites the report holds in all, a place cited twice counting twice.
func (a CiteAudit) Times() int {
	n := 0
	for _, c := range a.Cites {
		n += c.Times
	}
	return n
}

// reportBlock is one item of the report: a direction, a line under Also raised, a message of the discussion. Its
// sentences are read for keywords when a cite of it stands in a sentence with too few words of its own (an Evidence line).
type reportBlock struct {
	where      string
	lines      []string
	discussion bool // a message of the discussion, whose first line opens with who said it
}

// blockStartRe opens an item at the start of a line: "1. ", "- ".
var blockStartRe = regexp.MustCompile(`^(?:\d+\.|-) `)

// discussionWhoRe reads who said a message of the discussion and what it is: "- **Planner** agrees · on P28 · …".
var discussionWhoRe = regexp.MustCompile(`^- \*\*(.+?)\*\* (.+?)(?: · |$)(?:on )?(P\d+)?`)

// splitReport cuts a document into its items, each named by where it stands. The run facts, and the person's own
// question, cite nothing a check should read, so they are left out; so are headings and the matrix (its cells are cut
// short, and their claims stand whole in the discussion).
func splitReport(doc string) []reportBlock {
	var blocks []reportBlock
	section := ""
	var cur *reportBlock
	flush := func() {
		if cur != nil && len(cur.lines) > 0 {
			blocks = append(blocks, *cur)
		}
		cur = nil
	}
	for line := range strings.SplitSeq(strings.ReplaceAll(doc, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(line, "## ") {
			flush()
			section = strings.TrimSpace(strings.TrimPrefix(line, "## "))
			continue
		}
		if section == "Run facts" || section == "Cite check" || section == "Matrix" || strings.HasPrefix(line, "# ") ||
			strings.HasPrefix(line, "You asked: ") {
			continue
		}
		if blockStartRe.MatchString(line) || cur == nil {
			flush()
			cur = &reportBlock{where: blockWhere(section, line), discussion: section == "The discussion"}
		}
		cur.lines = append(cur.lines, line)
	}
	flush()
	return blocks
}

// blockWhere names an item for the check's list: the discussion's speaker and what they did, else the section.
func blockWhere(section, line string) string {
	if section == "The discussion" {
		if m := discussionWhoRe.FindStringSubmatch(line); m != nil {
			w := m[1] + " " + strings.TrimSpace(m[2])
			if m[3] != "" && !strings.Contains(w, m[3]) {
				w += " · " + m[3]
			}
			return w
		}
	}
	if section == "" {
		return "Summary"
	}
	return section
}

// refAt is one ref found in a line: where it sits and the ref taken apart.
type refAt struct {
	lo, hi int
	ref    string
}

// refsIn finds the refs of a line. A match glued to a path character before it is part of something else (a URL's
// host, a longer word) and is skipped.
func refsIn(line string) []refAt {
	var out []refAt
	for _, m := range reportRefRe.FindAllStringIndex(line, -1) {
		if m[0] > 0 {
			prev := line[m[0]-1]
			if prev == '/' || prev == '\\' || prev == ':' || prev == '.' || isWordByte(prev) {
				continue
			}
		}
		if m[1] < len(line) && isWordByte(line[m[1]]) {
			continue
		}
		out = append(out, refAt{m[0], m[1], line[m[0]:m[1]]})
	}
	return out
}

func isWordByte(b byte) bool {
	return b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= 0x80
}

// sentenceAround is the sentence of line that holds byte range [lo, hi): from the last ". " (or "; ", or the line's
// start) before it to the next one after it. A ref holds no space, so its own dots never end a sentence.
func sentenceAround(line string, lo, hi int) string {
	start := 0
	for _, sep := range []string{". ", "; ", "? ", "! "} {
		if i := strings.LastIndex(line[:lo], sep); i >= 0 && i+len(sep) > start {
			start = i + len(sep)
		}
	}
	end := len(line)
	for _, sep := range []string{". ", "; ", "? ", "! "} {
		if i := strings.Index(line[hi:], sep); i >= 0 && hi+i+1 < end {
			end = hi + i + 1
		}
	}
	return line[start:end]
}

// auditStopwords are common words of five letters or more, English and Vietnamese with its diacritics dropped, that
// say nothing about which line a sentence means.
var auditStopwords = map[string]bool{}

func init() {
	for w := range strings.FieldsSeq(`about above after again against because before being below between could every
		first other their there these those through under until where which while would should still since without
		within never always maybe really cases evidence check council report proposal proposals direction directions
		khong trong nhung duoc nhieu nguoi chung chuan truoc thanh nhuoc hoac nhung theo cung giong khac cach phan
		nhanh chua chi cho voi tren duoi hien trong viec nghia muon nghi thang tuan`) {
		auditStopwords[w] = true
	}
}

// auditTokenRe is a word of a folded sentence: letters, digits and the joins an identifier uses.
var auditTokenRe = regexp.MustCompile(`[a-z0-9_][a-z0-9_.\-]*[a-z0-9_]|[a-z0-9]`)

// keywordsOf are the words of text worth looking for at a cited line: identifiers (with an underscore or a dot between
// letters), numbers of two digits or more, and other words of five letters or more that are not stopwords. Every word is
// folded (lower case, no diacritics), refs and the check's own notes are dropped first, and so is every word of the
// cited path itself: a line of curve.json seldom says "curve".
func keywordsOf(text string, path string) []string {
	text = wrongCiteNoteRe.ReplaceAllString(text, " ")
	text = reportRefRe.ReplaceAllString(text, " ")
	skip := map[string]bool{}
	for _, w := range auditTokenRe.FindAllString(asciifold.Lower(path), -1) {
		skip[w] = true
		for _, part := range strings.FieldsFunc(w, func(r rune) bool { return r == '.' || r == '-' || r == '_' }) {
			skip[part] = true
		}
	}
	var out []string
	for _, w := range auditTokenRe.FindAllString(asciifold.Lower(text), -1) {
		w = strings.Trim(w, ".-")
		if w == "" || skip[w] || auditStopwords[w] || slices.Contains(out, w) {
			continue
		}
		if isKeyword(w) {
			out = append(out, w)
		}
	}
	return out
}

func isKeyword(w string) bool {
	digits, letters := 0, 0
	for _, r := range w {
		switch {
		case unicode.IsDigit(r):
			digits++
		case unicode.IsLetter(r):
			letters++
		}
	}
	switch {
	case letters == 0:
		return digits >= 2
	case strings.Contains(w, "_"):
		return true
	case strings.Contains(w, ".") && letters > 0 && digits == 0:
		return true
	}
	return len(w) >= 5 && digits == 0
}

// foundIn says keyword w is in the folded window: a number only as a whole number (33 is not in 133), a word anywhere.
func foundIn(window, w string) bool {
	if strings.Trim(w, "0123456789.") != "" {
		return strings.Contains(window, w)
	}
	for i := 0; ; {
		j := strings.Index(window[i:], w)
		if j < 0 {
			return false
		}
		at := i + j
		before := at == 0 || !unicode.IsDigit(rune(window[at-1]))
		after := at+len(w) >= len(window) || !unicode.IsDigit(rune(window[at+len(w)]))
		if before && after {
			return true
		}
		i = at + 1
	}
}

// minSentenceKeywords is how many keywords a citing sentence must hold to stand on its own: fewer, and the item it is
// in is read instead (an Evidence line is all refs; its claim is the message above it).
const minSentenceKeywords = 2

// AuditReportCites checks every `path:line` of a council document against roots (see CheckEvidence for what roots
// are). It reads the files and nothing else, and calls no model.
func AuditReportCites(doc string, roots []string) CiteAudit {
	type place struct {
		cite     ReportCite
		ref      citeRef
		contexts []string
	}
	var order []string
	places := map[string]*place{}
	blocks := splitReport(doc)
	common := commonWords(blocks)
	for _, blk := range blocks {
		whole := blockText(blk)
		for _, line := range blk.lines {
			for _, r := range refsIn(line) {
				cr := splitCiteRef(r.ref)
				key := strings.ToLower(filepathSlash(cr.Path)) + fmt.Sprintf(":%d-%d", cr.From, cr.To)
				p := places[key]
				if p == nil {
					p = &place{cite: ReportCite{Ref: r.ref}, ref: cr}
					places[key] = p
					order = append(order, key)
				}
				p.cite.Times++
				if !slices.Contains(p.cite.Where, blk.where) {
					p.cite.Where = append(p.cite.Where, blk.where)
				}
				ctx := sentenceAround(line, r.lo, r.hi)
				if len(distinctive(keywordsOf(ctx, cr.Path), common)) < minSentenceKeywords {
					ctx = whole
				}
				p.contexts = append(p.contexts, ctx)
			}
		}
	}
	var audit CiteAudit
	for _, key := range order {
		p := places[key]
		p.cite.Verdict, p.cite.Note, p.cite.Keywords = auditPlace(p.ref, p.contexts, roots, common)
		audit.Cites = append(audit.Cites, p.cite)
	}
	return audit
}

// blockText is an item's text as its cites are read against: a discussion message's header keeps only its title, since
// the speaker's name and "proposes" say nothing about the line cited.
func blockText(blk reportBlock) string {
	lines := slices.Clone(blk.lines)
	if blk.discussion && len(lines) > 0 {
		if m := discussionHeadRe.FindStringIndex(lines[0]); m != nil {
			lines[0] = lines[0][m[1]:]
		}
	}
	return strings.Join(lines, "\n")
}

// discussionHeadRe is a discussion message's header up to its title: "- **Planner** agrees · on P28 · ".
var discussionHeadRe = regexp.MustCompile(`^- \*\*.+?\*\* [^·]*(?:· (?:on )?P\d+ · )?`)

// commonShare is the share of the report's items a word may appear in and still count as a keyword: a word of the topic
// itself ("harness", the benchmark's name) is near every line of the project, so finding it proves nothing.
const commonShare = 10 // one item in ten

// commonWords are the keywords that appear in more than one item in commonShare (and in more than three).
func commonWords(blocks []reportBlock) map[string]bool {
	df := map[string]int{}
	for _, blk := range blocks {
		for _, w := range keywordsOf(blockText(blk), "") {
			df[w]++
		}
	}
	limit := max(3, len(blocks)/commonShare)
	common := map[string]bool{}
	for w, n := range df {
		if n > limit {
			common[w] = true
		}
	}
	return common
}

// distinctive is ws without the common words.
func distinctive(ws []string, common map[string]bool) []string {
	return slices.DeleteFunc(slices.Clone(ws), func(w string) bool { return common[w] })
}

func filepathSlash(p string) string { return strings.ReplaceAll(p, `\`, "/") }

// auditPlace is the verdict on one cited place, read from the sentences that cite it.
func auditPlace(r citeRef, contexts []string, roots []string, common map[string]bool) (verdict, note string, found []string) {
	full, why := findCited(r.Path, roots)
	switch {
	case why == "path is outside the folders this council reads":
		return CiteOutside, why, nil
	case why != "":
		return CiteBroken, why, nil
	case r.From < 1:
		return CiteBroken, fmt.Sprintf("line %d is not a line", r.From), nil
	}
	lo := max(1, r.From-quoteSlack)
	hi := min(r.To+quoteSlack, lo+auditWindowCap)
	lines, total, err := readLines(full, lo, hi)
	if err != nil {
		return CiteBroken, "the file could not be read", nil
	}
	if total >= 0 && total < r.To {
		return CiteBroken, fmt.Sprintf("line %d is past the end (%d lines)", r.To, total), nil
	}
	window := asciifold.Lower(strings.Join(lines, "\n"))
	var looked []string
	for _, ctx := range contexts {
		for _, w := range distinctive(keywordsOf(ctx, r.Path), common) {
			if foundIn(window, w) {
				if !slices.Contains(found, w) {
					found = append(found, w)
				}
			} else if !slices.Contains(looked, w) {
				looked = append(looked, w)
			}
		}
	}
	if len(found) > 0 {
		return CiteHolds, "", found
	}
	if len(looked) == 0 {
		return CiteHolds, "no keyword to look for: the line is there", nil
	}
	return CiteNoMatch, "looked for " + strings.Join(firstN(looked, 6), ", ") + " " + nearText(r), nil
}

func firstN(s []string, n int) []string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// citeCheckListCap caps how many places each list of the section names; the tally counts them all.
const citeCheckListCap = 25

// writeCiteCheck writes the "Cite check" section: the tally, then the wrong places, the places with no keyword near them
// and the ones outside the council's folders, each with where the report cites it. It writes nothing for a report that
// cites no `path:line`.
func writeCiteCheck(b *strings.Builder, a CiteAudit) {
	if len(a.Cites) == 0 {
		return
	}
	b.WriteString("## Cite check\n\n")
	fmt.Fprintf(b, "Go read every `path:line` this report cites, with no model: %d places, cited %d times. "+
		"%d hold (the file is there, the line is in it, and a keyword of a sentence citing it is on or within %d lines of it), "+
		"%d have no such keyword near the line, %d are wrong, %d are outside the folders this council reads.\n",
		len(a.Cites), a.Times(), a.Count(CiteHolds), quoteSlack, a.Count(CiteNoMatch), a.Count(CiteBroken), a.Count(CiteOutside))
	for _, group := range []struct{ verdict, title string }{
		{CiteBroken, "Wrong"},
		{CiteNoMatch, "No keyword near the line (read these by hand)"},
		{CiteOutside, "Outside the council's folders (not checked)"},
	} {
		var lines []string
		for _, c := range a.Cites {
			if c.Verdict == group.verdict {
				lines = append(lines, fmt.Sprintf("- `%s` (%s): %s", c.Ref, strings.Join(c.Where, "; "), c.Note))
			}
		}
		if len(lines) == 0 {
			continue
		}
		fmt.Fprintf(b, "\n%s:\n\n", group.title)
		if len(lines) > citeCheckListCap {
			more := len(lines) - citeCheckListCap
			lines = append(lines[:citeCheckListCap], fmt.Sprintf("- … and %d more", more))
		}
		b.WriteString(strings.Join(lines, "\n") + "\n")
	}
	b.WriteString("\n")
}

// CiteCheckSection is the "Cite check" section for a document already written, as `wsh council cites` prints it.
func CiteCheckSection(doc string, roots []string) string {
	var b strings.Builder
	writeCiteCheck(&b, AuditReportCites(doc, roots))
	return b.String()
}
