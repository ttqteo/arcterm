// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// TestSessionIdeasMeasure measures what a first scan costs on this machine, without scanning: it builds the prompt of
// every session a first scan would read (the real candidates, digests and project context), then makes the real haiku
// call on a few of them, spread over the prompt sizes, and logs the tokens each used. Nothing is written to the
// person's store, so their first Scan my sessions is still theirs. ARC_MEASURE_HOME, ARC_MEASURE_CONFIG and ARC_MEASURE_DATA
// name the home and the install whose sessions, projects and initiatives the prompts read; ARC_SESSIONIDEAS_MEASURE_N is
// the number of calls (6). On Windows it needs cgo, as the package does.
func TestSessionIdeasMeasure(t *testing.T) {
	if os.Getenv("ARC_SESSIONIDEAS_MEASURE") != "1" {
		t.Skip("set ARC_SESSIONIDEAS_MEASURE=1 and ARC_MEASURE_HOME/CONFIG/DATA to measure on the real ~/.claude")
	}
	// TestMain put the package on a throwaway home, data dir and config: point it back at the install measured
	home, config, data := os.Getenv("ARC_MEASURE_HOME"), os.Getenv("ARC_MEASURE_CONFIG"), os.Getenv("ARC_MEASURE_DATA")
	if home == "" || config == "" || data == "" {
		t.Fatal("ARC_MEASURE_HOME, ARC_MEASURE_CONFIG and ARC_MEASURE_DATA name the real home, config dir and data dir")
	}
	for _, key := range []string{"HOME", "USERPROFILE"} {
		t.Setenv(key, home)
	}
	prevConfig, prevData := wavebase.ConfigHome_VarCache, wavebase.DataHome_VarCache
	wavebase.ConfigHome_VarCache, wavebase.DataHome_VarCache = config, data
	wconfig.GetWatcher().Reload()
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache, wavebase.DataHome_VarCache = prevConfig, prevData
		wconfig.GetWatcher().Reload()
	})
	n := 6
	if v := os.Getenv("ARC_SESSIONIDEAS_MEASURE_N"); v != "" {
		fmt.Sscan(v, &n)
	}
	ctx := context.Background()
	deps := realSessionIdeasDeps()
	stored, err := sessionideas.Default().Load()
	if err != nil {
		t.Fatal(err)
	}

	type sized struct {
		path, project string
		prompt        string
		chars         int
	}
	start := time.Now()
	cands := deps.Candidates()
	var work []sized
	skipped, unread := 0, 0
	projects := map[string]sessionideas.ProjectContext{}
	for _, c := range cands {
		if !sessionideas.Eligible(c, stored.Marks, start) {
			continue
		}
		dg, err := deps.Read(c.Path)
		if err != nil {
			unread++
			continue
		}
		if skip, _ := sessionideas.SkipContent(dg); skip || len(dg.Turns) == 0 {
			skipped++
			continue
		}
		var title, projectPath string
		if dg.Session != nil {
			title, projectPath = dg.Session.Task, dg.Session.ProjectPath
		}
		pc, ok := projects[projectPath]
		if !ok {
			pc, _ = deps.ProjectContext(ctx, projectPath)
			projects[projectPath] = pc
		}
		pc.Known = sessionideas.KnownGists(stored.Ideas, pc.Root)
		p := sessionideas.Prompt(title, dg.Turns, false, pc)
		work = append(work, sized{path: c.Path, project: pc.Name, prompt: p, chars: utf8.RuneCountInString(p)})
	}
	sort.Slice(work, func(i, j int) bool { return work[i].chars < work[j].chars })
	var allChars int
	for _, w := range work {
		allChars += w.chars
	}
	t.Logf("candidates %d, a first scan reads %d (passed over without a call %d, unreadable %d), %d projects; prompts built in %s",
		len(cands), len(work), skipped, unread, len(projects), time.Since(start).Round(time.Millisecond))
	// what each project's context adds to every one of its sessions' prompts, the biggest first
	type ctxSize struct {
		name  string
		parts string
		chars int
	}
	var ctxs []ctxSize
	seen := map[string]bool{} // the context is keyed by folder: a project's worktrees and subfolders repeat it
	for _, pc := range projects {
		if seen[pc.Root] {
			continue
		}
		seen[pc.Root] = true
		lines := func(items []string) int {
			c := 0
			for _, it := range items {
				c += utf8.RuneCountInString(it) + 3
			}
			return c
		}
		var in int
		for _, i := range pc.Initiatives {
			in += utf8.RuneCountInString(i.Title) + utf8.RuneCountInString(strings.Join(i.Chunks[max(0, len(i.Chunks)-60):], "; ")) + 50
		}
		parts := fmt.Sprintf("initiatives %d (%d), ideas %d, specs %d, plans %d, deferred %d, commits %d", in, len(pc.Initiatives),
			lines(pc.Ideas), lines(pc.Specs), lines(pc.Plans), lines(pc.Deferred), lines(pc.Commits))
		ctxs = append(ctxs, ctxSize{name: pc.Name, parts: parts, chars: utf8.RuneCountInString(sessionideas.Prompt("", nil, false, pc))})
	}
	sort.Slice(ctxs, func(i, j int) bool { return ctxs[i].chars > ctxs[j].chars })
	for _, c := range ctxs[:min(5, len(ctxs))] {
		t.Logf("prompt without turns, %s: %d chars: %s", projectLabel(c.name), c.chars, c.parts)
	}
	if len(work) == 0 {
		return
	}
	q := func(f float64) int { return work[int(f*float64(len(work)-1))].chars }
	t.Logf("prompt chars: min %d, p25 %d, median %d, p75 %d, p90 %d, max %d, total %d",
		work[0].chars, q(0.25), q(0.5), q(0.75), q(0.9), work[len(work)-1].chars, allChars)

	// the calls: spread over the sizes, smallest and largest included
	n = min(n, len(work))
	var xs, ys []float64
	for i := 0; i < n; i++ {
		idx := 0
		if n > 1 {
			idx = i * (len(work) - 1) / (n - 1)
		}
		w := work[idx]
		callStart := time.Now()
		reply, tokens, err := deps.Run(ctx, w.prompt)
		if err != nil {
			t.Fatalf("call on %s: %v", w.path, err)
		}
		parsed := "unusable reply"
		if ideas, err := sessionideas.ParseReply(reply); err == nil {
			parsed = fmt.Sprintf("%d ideas", len(ideas))
		}
		t.Logf("call %d: prompt %d chars (%s), %d tokens, %s, %s", i+1, w.chars, projectLabel(w.project), tokens,
			time.Since(callStart).Round(time.Millisecond), parsed)
		xs, ys = append(xs, float64(w.chars)), append(ys, float64(tokens))
	}
	if n < 2 {
		return
	}

	// tokens = fixed + perChar * chars (the fixed part is the CLI's own prompt), fitted on the calls by least squares
	var mx, my float64
	for i := range xs {
		mx, my = mx+xs[i]/float64(n), my+ys[i]/float64(n)
	}
	var sxy, sxx float64
	for i := range xs {
		sxy += (xs[i] - mx) * (ys[i] - my)
		sxx += (xs[i] - mx) * (xs[i] - mx)
	}
	perChar := 0.0
	if sxx > 0 {
		perChar = sxy / sxx
	}
	fixed := my - perChar*mx
	total := fixed*float64(len(work)) + perChar*float64(allChars)
	t.Logf("fit: %.0f tokens fixed + %.3f per prompt char; mean %.0f tokens per session; a first scan of %d sessions ~ %.0f tokens",
		fixed, perChar, total/float64(len(work)), len(work), total)
}

func projectLabel(name string) string {
	if name == "" {
		return "no project"
	}
	return name
}
