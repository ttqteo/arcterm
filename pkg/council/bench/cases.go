// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package bench is the council benchmark: the cases Phase 0 left in the data dir, the plan of runs over them, and the
// results file, council-bench.jsonl, which also takes the real councils' ratings. This package is the file's one owner:
// it writes both line kinds and reads them back. pkg/council never imports it.
package bench

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// BenchDir holds cases.json and the keys, under the data dir; the cases' project folders live outside it.
const BenchDir = "council-bench"

// CasesFile is the cases' list inside BenchDir.
const CasesFile = "cases.json"

// The variants. A variant is a way of running a case: solo is one agent (Phase 0's V0, the case's solo_group), council
// is today's harness (V2, the case's group). A new variant is one more name in variantTokens and one more branch in
// the run, nothing else.
const (
	VariantSolo    = "solo"
	VariantCouncil = "council"
)

// Phase 0's measured cost of one run of a case, in pkg/consult's token count: solo came to 0.54M, a council to 1.4M.
// `wsh council estimate` reads low (a flat 0.3M for solo), so the plan prices from these.
var variantTokens = map[string]int64{
	VariantSolo:    550_000,
	VariantCouncil: 1_400_000,
}

// AllVariants are the variants a bench runs when none is named, in the order they run.
func AllVariants() []string { return []string{VariantSolo, VariantCouncil} }

// KeyLine is one line of a case's answer key: the id the judge answers with (K1) and what the line says.
type KeyLine struct {
	Id   string
	Text string
}

// Case is one benchmark case in Phase 0's shape (cases.json), plus the key lines read from its key file.
type Case struct {
	Id        string `json:"id"`
	Mode      string `json:"mode"`       // council.ModeReview or council.ModeBrainstorm
	Project   string `json:"project"`    // the folder the experts work in: a snapshot of the code before the fix, or at the decision
	Group     string `json:"group"`      // the panel of the council variant
	SoloGroup string `json:"solo_group"` // the one-agent panel of the solo variant
	Feature   string `json:"feature"`
	Question  string `json:"question"`
	Files     string `json:"files"` // comma-separated, as `wsh council start --files` takes them
	Key       string `json:"key"`   // the key file's path

	KeyLines []KeyLine `json:"-"`
}

// FileList is the case's files as the council takes them: trimmed, empty items dropped.
func (c Case) FileList() []string {
	var out []string
	for f := range strings.SplitSeq(c.Files, ",") {
		if f = strings.TrimSpace(f); f != "" {
			out = append(out, f)
		}
	}
	return out
}

// keyLineRe is a key file's line: `K1: Open a finished council on its report first.` An optional list marker is allowed.
var keyLineRe = regexp.MustCompile(`^\s*(?:[-*]\s+)?(K\d+)\s*:\s*(.+?)\s*$`)

// parseKey reads the K lines of a key file; any other line is ignored.
func parseKey(data []byte) []KeyLine {
	var out []KeyLine
	for line := range strings.SplitSeq(string(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))), "\n") {
		if m := keyLineRe.FindStringSubmatch(strings.TrimRight(line, "\r")); m != nil {
			out = append(out, KeyLine{Id: m[1], Text: m[2]})
		}
	}
	return out
}

// CasesPath is where cases.json lives under a data dir.
func CasesPath(dataDir string) string {
	return filepath.Join(dataDir, BenchDir, CasesFile)
}

// LoadCases reads <dataDir>/council-bench/cases.json and each case's key. A case whose project folder or key is gone,
// or that cannot be used (no id, an unknown mode, a repeated id), is left out with one warning that names it; the rest
// load. A missing cases.json is an error that names the path (it wraps fs.ErrNotExist).
func LoadCases(dataDir string) ([]Case, []string, error) {
	path := CasesPath(dataDir)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil, fmt.Errorf("no benchmark cases at %s; Phase 0b's tasks 1–2 build them: %w", path, err)
		}
		return nil, nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var entries []Case
	if err := json.Unmarshal(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), &entries); err != nil {
		return nil, nil, fmt.Errorf("%s is not a JSON list of cases: %w", path, err)
	}

	var cases []Case
	var warnings []string
	seen := map[string]bool{}
	for i, c := range entries {
		skip := func(format string, args ...any) {
			warnings = append(warnings, fmt.Sprintf("skipped case %s: %s", caseName(c, i), fmt.Sprintf(format, args...)))
		}
		if c.Id == "" {
			skip("no id")
			continue
		}
		if c.Mode == "" {
			c.Mode = council.ModeReview
		}
		if c.Mode != council.ModeReview && c.Mode != council.ModeBrainstorm {
			skip("unknown mode %q (review or brainstorm)", c.Mode)
			continue
		}
		if seen[c.Id] {
			skip("its id is used by an earlier case")
			continue
		}
		if st, err := os.Stat(c.Project); err != nil || !st.IsDir() {
			skip("project folder %s is missing", c.Project)
			continue
		}
		key, err := os.ReadFile(c.Key)
		if err != nil {
			skip("key file %s cannot be read", c.Key)
			continue
		}
		c.KeyLines = parseKey(key)
		if len(c.KeyLines) == 0 {
			skip("key file %s has no key lines (K1: …)", c.Key)
			continue
		}
		seen[c.Id] = true
		cases = append(cases, c)
	}
	return cases, warnings, nil
}

// caseName names a case in a warning: its id, or its place in the list when it has none.
func caseName(c Case, i int) string {
	if c.Id != "" {
		return c.Id
	}
	return fmt.Sprintf("#%d", i+1)
}

// Options picks what a bench runs. Empty Cases means every case, empty Variants all of AllVariants, and Runs 0 reads as 1.
type Options struct {
	Cases    []string
	Variants []string
	Runs     int
}

// CouncilBenchPlanItem is one run of the plan: a case, a variant and which run of that pair this is (from 1). It
// crosses the wire, in the dry run's answer, so it carries the Council prefix.
type CouncilBenchPlanItem struct {
	Case    string `json:"case"`
	Variant string `json:"variant"`
	Run     int    `json:"run"`
}

// Plan lists the runs in order, case by case, each case's variants in turn, each variant's runs in turn, and the sum
// of their token estimates. A case or variant name that is not known is an error; a name given twice counts once.
func Plan(cases []Case, opts Options) ([]CouncilBenchPlanItem, int64, error) {
	if opts.Runs < 0 {
		return nil, 0, fmt.Errorf("runs must be 1 or more, got %d", opts.Runs)
	}
	runs := max(opts.Runs, 1)

	ids := make([]string, len(cases))
	for i, c := range cases {
		ids[i] = c.Id
	}
	selected := ids
	if len(opts.Cases) > 0 {
		selected = nil
		for _, name := range dedupe(opts.Cases) {
			if !slices.Contains(ids, name) {
				return nil, 0, fmt.Errorf("unknown case %q (cases: %s)", name, strings.Join(ids, ", "))
			}
			selected = append(selected, name)
		}
	}
	variants := AllVariants()
	if len(opts.Variants) > 0 {
		variants = nil
		for _, name := range dedupe(opts.Variants) {
			if _, ok := variantTokens[name]; !ok {
				return nil, 0, fmt.Errorf("unknown variant %q (variants: %s)", name, strings.Join(AllVariants(), ", "))
			}
			variants = append(variants, name)
		}
	}

	var items []CouncilBenchPlanItem
	var estimate int64
	for _, id := range selected {
		for _, v := range variants {
			for r := 1; r <= runs; r++ {
				items = append(items, CouncilBenchPlanItem{Case: id, Variant: v, Run: r})
				estimate += variantTokens[v]
			}
		}
	}
	return items, estimate, nil
}

func dedupe(names []string) []string {
	var out []string
	for _, n := range names {
		if !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	return out
}
