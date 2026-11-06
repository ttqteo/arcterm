// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	reasonMinToken    = 4  // a shorter token matches too much to mean anything
	reasonMaxDocHits  = 10 // a token in more lines of one doc than this is too common there
	reasonMaxDocLines = 5

	reasonKindFile    = "file"
	reasonKindCommand = "command"

	reasonStillExists = "What it names still exists: "
	reasonGone        = "Names a file that is gone: "
	reasonDatedClaim  = "Dated claim: "
	reasonMaxGone     = 3
)

var reasonCodeSpanRe = regexp.MustCompile("`([^`\n]+)`")

// Reason builds a memory's reason section in code, with no model call: one verdict sentence from the
// signals already gathered on m, and the instruction-doc lines that name what it names. judgeSaw is
// true only when the caller knows the judge judged this exact version and proposed nothing.
func Reason(m Memory, sessions int, docs map[string]string, judgeSaw bool) (string, []wshrpc.MemDocLine) {
	now := evidenceNow()
	lines, perDoc, kinds := reasonDocLines(m.Body, docs)

	var sentences []string
	first := reasonReads(m, sessions, now)
	if part := reasonDocsPart(m.Body, docs, perDoc, kinds); part != "" {
		switch {
		case first == "":
			first = part
		case strings.HasPrefix(part, "nothing"):
			first += "; " + part
		default:
			first += ", and " + part
		}
	}
	if first != "" {
		sentences = append(sentences, reasonCapitalize(first)+".")
	}
	if s := reasonReferences(m); s != "" {
		sentences = append(sentences, s)
	}
	if s := reasonDates(m); s != "" {
		sentences = append(sentences, s)
	}
	if judgeSaw {
		if names := reasonDocNames(docs); len(names) > 0 {
			sentences = append(sentences, "The judge saw this version beside "+reasonJoin(names, "and")+" and proposed nothing.")
		} else {
			sentences = append(sentences, "The judge saw this version and proposed nothing.")
		}
	}
	return strings.Join(sentences, " "), lines
}

// reasonReads is how often sessions read the memory and how long it has sat untouched.
func reasonReads(m Memory, sessions int, now time.Time) string {
	since := ""
	stale := false
	days := 0
	if m.Touched > 0 {
		touched := time.UnixMilli(m.Touched)
		since = evidenceShortDate(touched, now)
		days = int(now.Sub(touched).Hours() / 24)
		stale = days >= reviewStaleDays
	}
	switch {
	case sessions > 0 && m.Reads == 0:
		s := "Read in none of " + evidenceCount(sessions) + " sessions"
		if since != "" {
			s += " since " + since
		}
		return s
	case sessions > 0:
		s := fmt.Sprintf("Read in %s of %s sessions", evidenceCount(m.Reads), evidenceCount(sessions))
		if stale {
			s += ", untouched since " + since
		}
		return s
	case since != "":
		return fmt.Sprintf("Untouched for %s %s, since %s", evidenceCount(days), reasonPlural(days, "day", "days"), since)
	}
	return ""
}

// reasonDocsPart says which docs name what the memory names, and in how many places. it is "" when
// there are no docs, or when the memory names nothing a doc could.
func reasonDocsPart(body string, docs map[string]string, perDoc map[string]int, kinds map[string]string) string {
	names := reasonDocNames(docs)
	if len(names) == 0 || len(reasonTokens(body)) == 0 {
		return ""
	}
	if len(perDoc) == 0 {
		return "nothing in " + reasonJoin(names, "or") + " names what it names"
	}
	var paths []string
	for p := range perDoc {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var parts []string
	for i, p := range paths {
		n := perDoc[p]
		places := fmt.Sprintf("in %d %s", n, reasonPlural(n, "place", "places"))
		if i == 0 {
			parts = append(parts, fmt.Sprintf("%s names the same %s %s", filepath.Base(p), kinds[p], places))
		} else {
			parts = append(parts, filepath.Base(p)+" "+places)
		}
	}
	return reasonJoin(parts, "and")
}

// reasonReferences says whether what the memory names still exists, from the references evidence.
func reasonReferences(m Memory) string {
	var gone []string
	exists := false
	for _, ev := range m.Evidence {
		switch {
		case ev.Tone == evidenceToneWarn && ev.Text == reasonGone:
			gone = append(gone, ev.Code)
		case ev.Tone == evidenceToneOK && ev.Text == reasonStillExists:
			exists = true
		}
	}
	switch {
	case len(gone) == 1:
		return "It names " + gone[0] + ", which is gone."
	case len(gone) > reasonMaxGone:
		return fmt.Sprintf("It names %s and %d more files that are gone.", strings.Join(gone[:reasonMaxGone], ", "), len(gone)-reasonMaxGone)
	case len(gone) > 1:
		return "It names " + reasonJoin(gone, "and") + ", which are gone."
	case exists:
		return "What it names still exists."
	}
	return ""
}

// reasonDates names the memory's dated claim, or counts them when there are several.
func reasonDates(m Memory) string {
	var claims []string
	for _, ev := range m.Evidence {
		if strings.HasPrefix(ev.Text, reasonDatedClaim) {
			claims = append(claims, strings.TrimPrefix(ev.Text, reasonDatedClaim))
		}
	}
	switch len(claims) {
	case 0:
		return ""
	case 1:
		return "It makes a dated claim: " + claims[0] + "."
	}
	return fmt.Sprintf("It makes %d dated claims.", len(claims))
}

// reasonTokens is what the body names that a doc could name too: its code spans, the first word of
// a multi-word span (the command's name), and its repo paths, each with its kind. tokens shorter than
// reasonMinToken are left out.
func reasonTokens(body string) map[string]string {
	out := map[string]string{}
	add := func(tok, kind string) {
		tok = strings.TrimSpace(tok)
		if len(tok) < reasonMinToken {
			return
		}
		if prev, ok := out[tok]; ok && prev == reasonKindFile {
			return
		}
		out[tok] = kind
	}
	for _, sm := range reasonCodeSpanRe.FindAllStringSubmatch(body, -1) {
		span := strings.TrimSpace(sm[1])
		add(span, reasonKindCommand)
		if fields := strings.Fields(span); len(fields) > 1 {
			add(fields[0], reasonKindCommand)
		}
	}
	for _, p := range evidenceBodyPaths(body) {
		add(p.ref, reasonKindFile)
	}
	return out
}

// reasonDocLines looks each token up in the docs, longest token first, and lists at most
// reasonMaxDocLines hits, each doc line once. perDoc counts every matched line per doc, past the cap
// too, and kinds is the kind of the longest token each doc matched.
func reasonDocLines(body string, docs map[string]string) ([]wshrpc.MemDocLine, map[string]int, map[string]string) {
	lines := []wshrpc.MemDocLine{}
	perDoc := map[string]int{}
	kinds := map[string]string{}
	tokens := reasonTokens(body)
	if len(tokens) == 0 || len(docs) == 0 {
		return lines, perDoc, kinds
	}
	order := make([]string, 0, len(tokens))
	for tok := range tokens {
		order = append(order, tok)
	}
	sort.Slice(order, func(i, j int) bool {
		if len(order[i]) != len(order[j]) {
			return len(order[i]) > len(order[j])
		}
		return order[i] < order[j]
	})
	paths := make([]string, 0, len(docs))
	for p := range docs {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	split := map[string][]string{}
	for _, p := range paths {
		split[p] = strings.Split(docs[p], "\n")
	}

	matched := map[string]bool{} // doc + "\x00" + line
	for _, tok := range order {
		for _, p := range paths {
			var hits []int
			for i, line := range split[p] {
				if strings.Contains(line, tok) {
					hits = append(hits, i)
				}
			}
			if len(hits) == 0 || len(hits) > reasonMaxDocHits {
				continue
			}
			for _, i := range hits {
				key := fmt.Sprintf("%s\x00%d", p, i)
				if matched[key] {
					continue
				}
				matched[key] = true
				if _, ok := kinds[p]; !ok {
					kinds[p] = tokens[tok]
				}
				perDoc[p]++
				if len(lines) < reasonMaxDocLines {
					lines = append(lines, wshrpc.MemDocLine{Doc: p, Line: i + 1, Text: strings.TrimSpace(split[p][i])})
				}
			}
		}
	}
	return lines, perDoc, kinds
}

// reasonDocNames is the docs' base names, sorted and each once (AGENTS.md, CLAUDE.md).
func reasonDocNames(docs map[string]string) []string {
	seen := map[string]bool{}
	var out []string
	for p := range docs {
		name := filepath.Base(p)
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

// reasonJoin joins a list the way a sentence does: "a", "a or b", "a, b or c".
func reasonJoin(items []string, conj string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	}
	return strings.Join(items[:len(items)-1], ", ") + " " + conj + " " + items[len(items)-1]
}

func reasonPlural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func reasonCapitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
