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
// is today's harness (V2, the case's group), team is a Claude Code agent team with the council's roles (V3), brainstorm
// is Arc's brainstorm skill driven by a simulated person (Brainstorm-mode cases only). A new variant is one more name in
// variantTokens and variantOrder and one more branch in the run, nothing else.
const (
	VariantSolo       = "solo"
	VariantCouncil    = "council"
	VariantTeam       = "team"
	VariantBrainstorm = "brainstorm"
)

// TeamPassTag marks the cases built for the pass that weighs the council against an agent team; the verdict reads only
// the cases that carry it.
const TeamPassTag = "team-bench-2026-11"

// TokenCap is the most a bench spends when Options.Cap names none: it starts no new item once its rows' tokens (judge
// calls included) reach it. An item already running when the cap is reached finishes.
const TokenCap int64 = 50_000_000

// The cost of one run of a case, in pkg/consult's token count, from Phase 0b's measured means (docs/council-phase0.md):
// solo 2.3M (V0), council 8.8M (V2) and team 4.5M (V3). The council's mean is pulled up by one 17.5M run; its median is
// 4.4M. `wsh council estimate` reads low (a flat 0.3M for solo), so the plan prices from these. Brainstorm has no
// Phase 0b mean: its 5M is a guess (the agent's turns plus the skill's judge and the builder reviewer), to re-measure
// after the first bench.
var variantTokens = map[string]int64{
	VariantSolo:       2_300_000,
	VariantCouncil:    8_800_000,
	VariantTeam:       4_500_000,
	VariantBrainstorm: 5_000_000,
}

// variantOrder is every variant a plan accepts, in the order a results table lists them.
var variantOrder = []string{VariantSolo, VariantCouncil, VariantTeam, VariantBrainstorm}

// AllVariants are the variants a bench runs when none is named, in the order they run: the council, then the team it is
// weighed against, then Arc's brainstorm skill (which Plan keeps for Brainstorm-mode cases only). Solo stays runnable
// when named in Options.Variants.
func AllVariants() []string { return []string{VariantCouncil, VariantTeam, VariantBrainstorm} }

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
	Files     string `json:"files"`             // comma-separated, as `wsh council start --files` takes them
	Key       string `json:"key"`               // the key file's path
	Retired   bool   `json:"retired,omitempty"` // set aside: a bare bench skips it, one that names it with Options.Cases runs it
	Tag       string `json:"tag,omitempty"`     // names the pass the case was built for (TeamPassTag)

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
			return nil, nil, fmt.Errorf("no benchmark cases at %s; scripts/council-bench-cases.mjs builds them: %w", path, err)
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

// Options picks what a bench runs. Empty Cases means every case that is not retired, empty Variants all of AllVariants,
// Runs 0 reads as 1 and Cap 0 reads as TokenCap.
type Options struct {
	Cases    []string
	Variants []string
	Runs     int
	Cap      int64
}

// CouncilBenchPlanItem is one run of the plan: a case, a variant and which run of that pair this is (from 1). It
// crosses the wire, in the dry run's answer, so it carries the Council prefix.
type CouncilBenchPlanItem struct {
	Case    string `json:"case"`
	Variant string `json:"variant"`
	Run     int    `json:"run"`
}

// Plan lists the runs in order, run by run: run 1 of every case and variant before any run 2, each run's cases in turn and
// each case's variants in turn, so a case's council and team are back to back and a bench cut short leaves whole pairs.
// It also returns the sum of the items' token estimates. A retired case is left out unless opts.Cases names it. A case or
// variant name that is not known is an error; a name given twice counts once. The brainstorm variant runs only on a
// Brainstorm-mode case: for any other (a Review case, or one with no mode) its item is left out, named or not, and its
// price with it.
func Plan(cases []Case, opts Options) ([]CouncilBenchPlanItem, int64, error) {
	if opts.Runs < 0 {
		return nil, 0, fmt.Errorf("runs must be 1 or more, got %d", opts.Runs)
	}
	if opts.Cap < 0 {
		return nil, 0, fmt.Errorf("the token cap must be 0 (the default) or more, got %d", opts.Cap)
	}
	runs := max(opts.Runs, 1)

	ids := make([]string, len(cases))
	modes := make(map[string]string, len(cases)) // case id -> mode, for the variants that run on one mode only
	var current []string                         // the cases a bare plan runs
	for i, c := range cases {
		ids[i] = c.Id
		modes[c.Id] = c.Mode
		if !c.Retired {
			current = append(current, c.Id)
		}
	}
	selected := current
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
				return nil, 0, fmt.Errorf("unknown variant %q (variants: %s)", name, strings.Join(variantOrder, ", "))
			}
			variants = append(variants, name)
		}
	}

	var items []CouncilBenchPlanItem
	var estimate int64
	for r := 1; r <= runs; r++ {
		for _, id := range selected {
			for _, v := range variants {
				if v == VariantBrainstorm && modes[id] != council.ModeBrainstorm {
					continue
				}
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
