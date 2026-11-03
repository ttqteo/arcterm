// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const failFirst = "the worker skipped the watch it fail first step"

type fixtureRun struct {
	id      string
	days    float64
	project string
	reason  string
}

// corpusOf builds a corpus holding one land-held line per run
func corpusOf(t *testing.T, runs ...fixtureRun) Corpus {
	t.Helper()
	var infos []RunInfo
	var events []waveobj.RunEvent
	for _, f := range runs {
		r := testRun(f.id, daysAgo(f.days))
		infos = append(infos, info(r, f.project))
		events = append(events, ev(r.OID, "land-held", r.CreatedTs, map[string]any{"reason": f.reason}))
	}
	c := BuildCorpus(infos, events, testNow, 14)
	if len(c.Blocks) != len(runs) {
		t.Fatalf("corpus has %d blocks, want %d", len(c.Blocks), len(runs))
	}
	return c
}

func runId(n int) string {
	return fmt.Sprintf("%08x-0000-0000-0000-000000000000", n)
}

func short(n int) string {
	return runId(n)[:8]
}

func cite(n int, quote string) Citation {
	return Citation{Run: short(n), Quote: quote}
}

func TestRecountNormalizes(t *testing.T) {
	c := corpusOf(t,
		fixtureRun{runId(1), 1, "p", failFirst},
		fixtureRun{runId(2), 2, "p", failFirst},
		fixtureRun{runId(3), 3, "p", failFirst},
	)
	cand := Candidate{Title: "skipped red step", FixTarget: "engine.go · workerContract", Citations: []Citation{
		cite(1, "The Worker skipped the\nwatch it   FAIL first step"),
		cite(2, failFirst),
		cite(3, "  worker skipped the watch it fail\tfirst "),
	}}
	survivors, under := Recount(c, []Candidate{cand})
	if len(survivors) != 1 || len(under) != 0 {
		t.Fatalf("survivors=%+v under=%+v", survivors, under)
	}
	if survivors[0].Runs != 3 {
		t.Errorf("runs = %d, want 3", survivors[0].Runs)
	}
}

func TestRecountOneCountPerRun(t *testing.T) {
	c := corpusOf(t,
		fixtureRun{runId(1), 1, "p", failFirst},
		fixtureRun{runId(2), 2, "p", failFirst},
	)
	cand := Candidate{Title: "x", Citations: []Citation{cite(1, failFirst), cite(1, failFirst), cite(2, failFirst)}}
	_, under := Recount(c, []Candidate{cand})
	if len(under) != 1 || under[0].Runs != 2 || len(under[0].Quotes) != 2 {
		t.Errorf("under = %+v, want one row of 2 runs and 2 quotes", under)
	}
}

func TestRecountFloor(t *testing.T) {
	c := corpusOf(t,
		fixtureRun{runId(1), 1, "p", failFirst},
		fixtureRun{runId(2), 2, "p", failFirst},
		fixtureRun{runId(3), 3, "p", failFirst},
	)
	two := Candidate{Title: "two", Citations: []Citation{cite(1, failFirst), cite(2, failFirst)}}
	three := Candidate{Title: "three", Citations: []Citation{cite(1, failFirst), cite(2, failFirst), cite(3, failFirst)}}
	survivors, under := Recount(c, []Candidate{two, three})
	if len(survivors) != 1 || survivors[0].Title != "three" {
		t.Errorf("survivors = %+v, want only three", survivors)
	}
	if len(under) != 1 || under[0].Title != "two" || under[0].Id != "" {
		t.Errorf("under = %+v, want two with no id", under)
	}
}

func TestRecountShortQuote(t *testing.T) {
	quote := "watch it fail first ste" // 23 chars
	if len(quote) != MinQuoteChars-1 {
		t.Fatalf("fixture quote is %d chars", len(quote))
	}
	c := corpusOf(t,
		fixtureRun{runId(1), 1, "p", failFirst},
		fixtureRun{runId(2), 2, "p", failFirst},
		fixtureRun{runId(3), 3, "p", failFirst},
	)
	cand := Candidate{Title: "x", Citations: []Citation{cite(1, quote), cite(2, failFirst), cite(3, failFirst)}}
	survivors, under := Recount(c, []Candidate{cand})
	if len(survivors) != 0 || len(under) != 1 || under[0].Runs != 2 {
		t.Errorf("survivors=%+v under=%+v, want the short quote unverified", survivors, under)
	}
}

func TestRecountAmbiguousRunId(t *testing.T) {
	// two runs whose ids share the first 8 chars
	a := "abcdef01-0000-0000-0000-00000000000a"
	b := "abcdef01-0000-0000-0000-00000000000b"
	c := corpusOf(t,
		fixtureRun{a, 1, "p", failFirst},
		fixtureRun{b, 2, "p", failFirst},
		fixtureRun{runId(3), 3, "p", failFirst},
		fixtureRun{runId(4), 4, "p", failFirst},
	)
	cand := Candidate{Title: "x", Citations: []Citation{
		{Run: "abcdef01", Quote: failFirst}, cite(3, failFirst), cite(4, failFirst),
	}}
	survivors, under := Recount(c, []Candidate{cand})
	if len(survivors) != 0 || len(under) != 1 || under[0].Runs != 2 {
		t.Fatalf("survivors=%+v under=%+v, want the shared prefix unverified", survivors, under)
	}
	for _, q := range under[0].Quotes {
		if q.RunId == a || q.RunId == b {
			t.Errorf("ambiguous citation counted for %s", q.RunId)
		}
	}
}

func TestRecountWrongRun(t *testing.T) {
	c := corpusOf(t,
		fixtureRun{runId(1), 1, "p", failFirst},
		fixtureRun{runId(2), 2, "p", failFirst},
		fixtureRun{runId(3), 3, "p", "something else entirely happened in this run"},
	)
	cand := Candidate{Title: "x", Citations: []Citation{cite(1, failFirst), cite(2, failFirst), cite(3, failFirst)}}
	survivors, under := Recount(c, []Candidate{cand})
	if len(survivors) != 0 || len(under) != 1 || under[0].Runs != 2 {
		t.Errorf("survivors=%+v under=%+v, want the misattributed quote unverified", survivors, under)
	}
}

func TestRecountIdsAndDays(t *testing.T) {
	other := "a final scenario read data the empty store lacks"
	c := corpusOf(t,
		fixtureRun{runId(1), 1.1, "waveterm", failFirst + "; " + other},
		fixtureRun{runId(2), 1.2, "siem", failFirst + "; " + other},
		fixtureRun{runId(3), 3, "siem", failFirst + "; " + other},
		fixtureRun{runId(4), 4, "siem", failFirst},
	)
	three := Candidate{Title: "store", FixTarget: "AGENTS.md · plan format", Citations: []Citation{cite(1, other), cite(2, other), cite(3, other)}}
	four := Candidate{Title: "red step", FixTarget: "engine.go · workerContract", Citations: []Citation{
		cite(1, failFirst), cite(2, failFirst), cite(3, failFirst), cite(4, failFirst),
	}}
	survivors, _ := Recount(c, []Candidate{three, four})
	if len(survivors) != 2 {
		t.Fatalf("survivors = %+v", survivors)
	}
	first, second := survivors[0], survivors[1]
	if first.Id != "p1" || first.Title != "red step" || first.Runs != 4 || second.Id != "p2" || second.Title != "store" {
		t.Errorf("order/ids: %s %s %d, %s %s", first.Id, first.Title, first.Runs, second.Id, second.Title)
	}
	// runs 1 and 2 share 10-25, so 4 runs fall on 3 days
	if first.Days != 3 || second.Days != 2 {
		t.Errorf("days = %d and %d, want 3 and 2", first.Days, second.Days)
	}
	wantProjects := []waveobj.WorkflowScanProject{{Name: "siem", Runs: 3}, {Name: "waveterm", Runs: 1}}
	if !reflect.DeepEqual(first.Projects, wantProjects) {
		t.Errorf("projects = %+v, want %+v", first.Projects, wantProjects)
	}
	if first.FixTarget != "engine.go · workerContract" {
		t.Errorf("fix target = %q", first.FixTarget)
	}
	// quotes follow the corpus, oldest run first
	q := first.Quotes[0]
	if q.RunId != runId(4) || q.Text != failFirst || q.Date != "2026-10-22" || q.Project != "siem" {
		t.Errorf("quote = %+v", q)
	}
	for _, q := range first.Quotes {
		if len(q.RunId) != len(runId(1)) {
			t.Errorf("quote run id %q is not the full id", q.RunId)
		}
	}
}
