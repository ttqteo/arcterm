// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// runBench is the bench's seams, faked: start saves a council under c1, c2, … and checks nothing else is in flight,
// wait ends it, judge answers from the verdict hook. Every hook has a default that finishes the council done.
type runBench struct {
	t *testing.T

	mu       sync.Mutex
	inFlight int
	started  []*council.Council          // as start was given them, one per call, the refused ones too
	byId     map[string]*council.Council // the ones start accepted, by the id it gave them
	waited   []string
	judged   []string // the council ids judge was given
	reminds  int
	teamed   []string // the case ids team was given, one per call
	noTeam   bool     // leave Funcs.Team nil

	brainstormed []string // the case ids brainstorm was given, one per call
	noBrainstorm bool     // leave Funcs.Brainstorm nil

	team       func(n int, c Case) (TeamOutcome, error)                  // what the nth team call returns; default a done outcome
	brainstorm func(n int, c Case) (BrainstormOutcome, error)            // what the nth brainstorm call returns; default a done outcome
	startState func(n int) council.CouncilState                          // what start returns the nth council as; default running
	startErr   func(n int) error                                         // fail the nth start; default none
	end        func(n int, c *council.Council) (*council.Council, error) // what the nth wait returns; default a done council
	verdict    func(c Case, report *council.Council) (Verdict, error)    // what judge returns
	onWait     func(n int, id string)                                    // runs when the nth wait is entered, before it returns
	onRemind   func()                                                    // runs when remind is called
}

func newRunBench(t *testing.T) *runBench {
	t.Helper()
	return &runBench{t: t}
}

func (b *runBench) start(ctx context.Context, c *council.Council) (*council.Council, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.inFlight != 0 {
		b.t.Errorf("start called with a council still in flight (%d)", b.inFlight)
	}
	n := len(b.started) + 1
	given := *c // as the bench built it: the id start gives the saved copy below is not in it
	b.started = append(b.started, &given)
	cp := *c
	if b.startErr != nil {
		if err := b.startErr(n); err != nil {
			return nil, err
		}
	}
	b.inFlight++
	cp.Id = fmt.Sprintf("c%d", n)
	cp.State = council.StateRunning
	if b.startState != nil {
		cp.State = b.startState(n)
	}
	if b.byId == nil {
		b.byId = map[string]*council.Council{}
	}
	b.byId[cp.Id] = &cp
	out := cp
	return &out, nil
}

func (b *runBench) wait(ctx context.Context, id string) (*council.Council, error) {
	b.mu.Lock()
	b.waited = append(b.waited, id)
	n := len(b.waited)
	start := b.byId[id]
	b.mu.Unlock()
	if start == nil {
		b.t.Errorf("wait called on %q, which start never returned", id)
		return nil, fmt.Errorf("no council %s", id)
	}
	if b.onWait != nil {
		b.onWait(n, id)
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	b.mu.Lock()
	b.inFlight--
	b.mu.Unlock()
	if b.end != nil {
		return b.end(n, start)
	}
	return doneCouncil(id, start), nil
}

func (b *runBench) judge(ctx context.Context, c Case, report *council.Council) (Verdict, error) {
	b.mu.Lock()
	b.judged = append(b.judged, report.Id)
	b.mu.Unlock()
	if b.verdict != nil {
		return b.verdict(c, report)
	}
	return Verdict{Matches: map[string]int{"K1": 1}, Items: []ItemVerdict{{Rank: 1, Verdict: "key:K1"}, {Rank: 2, Verdict: "wrong"}}}, nil
}

func (b *runBench) remind(ctx context.Context) error {
	b.mu.Lock()
	b.reminds++
	b.mu.Unlock()
	if b.onRemind != nil {
		b.onRemind()
	}
	return nil
}

// teamRun is the team runner, faked: it checks nothing else is in flight and answers a done outcome with a report to
// judge, as the nth team (t1, t2, …), 4.5M tokens, 12.3 minutes and 7 messages.
func (b *runBench) teamRun(ctx context.Context, c Case) (TeamOutcome, error) {
	b.mu.Lock()
	if b.inFlight != 0 {
		b.t.Errorf("team called with a council still in flight (%d)", b.inFlight)
	}
	b.teamed = append(b.teamed, c.Id)
	n := len(b.teamed)
	b.mu.Unlock()
	if b.team != nil {
		return b.team(n, c)
	}
	return TeamOutcome{
		Session: fmt.Sprintf("t%d", n), State: TeamDone, Summary: &council.CouncilSummary{Answer: "team yes"},
		Tokens: 4_500_000, Minutes: 12.3, Messages: 7,
	}, nil
}

// brainstormRun is the brainstorm runner, faked: it checks nothing else is in flight and answers a done outcome as the nth
// session (b1, b2, …), scored 2 of the case's keys at the end and 1 at the done mark.
func (b *runBench) brainstormRun(ctx context.Context, c Case) (BrainstormOutcome, error) {
	b.mu.Lock()
	if b.inFlight != 0 {
		b.t.Errorf("brainstorm called with a council still in flight (%d)", b.inFlight)
	}
	b.brainstormed = append(b.brainstormed, c.Id)
	n := len(b.brainstormed)
	b.mu.Unlock()
	if b.brainstorm != nil {
		return b.brainstorm(n, c)
	}
	return BrainstormOutcome{
		Session: fmt.Sprintf("b%d", n), State: TeamDone, Skill: "3f9a01bc superpowers@4.0.3", Tokens: 3_900_000, JudgeTokens: 16_000,
		Minutes: 22.4, Turns: 14, Questions: 6, Decisions: 5,
		Final:  Verdict{Matches: map[string]int{"K1": 1, "K2": 3}, Items: []ItemVerdict{{Rank: 1, Verdict: "key:K1"}, {Rank: 2, Verdict: "valid"}, {Rank: 3, Verdict: "key:K2"}, {Rank: 4, Verdict: "wrong"}, {Rank: 5, Verdict: "valid"}}},
		AtDone: Verdict{Matches: map[string]int{"K1": 1}},
	}, nil
}

func (b *runBench) funcs() Funcs {
	f := Funcs{Start: b.start, Wait: b.wait, Judge: b.judge, Remind: b.remind}
	if !b.noTeam {
		f.Team = b.teamRun
	}
	if !b.noBrainstorm {
		f.Brainstorm = b.brainstormRun
	}
	return f
}

func (b *runBench) run(ctx context.Context, dir string, opts Options) error {
	return Run(ctx, dir, opts, b.funcs())
}

// rowNames is the results file's rows as case/variant/run, in file order.
func rowNames(t *testing.T, dir string) string {
	t.Helper()
	runs, _, err := LoadResults(dir)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, r := range runs {
		got = append(got, fmt.Sprintf("%s/%s/%d", r.Case, r.Variant, r.Run))
	}
	return strings.Join(got, " ")
}

// doneCouncil is the council as the store holds it after a clean run: 3 proposals and 2 replies, 1.5 minutes, 1.4M tokens.
func doneCouncil(id string, from *council.Council) *council.Council {
	c := *from
	c.Id, c.State = id, council.StateDone
	c.Harness = "2026-10-22.1"
	c.Tokens = 1_400_000
	c.Started, c.Updated = 1_000_000, 1_000_000+90_000
	c.Proposals = make([]council.CouncilProposal, 3)
	c.Replies = make([]council.CouncilReply, 2)
	c.Summary = &council.CouncilSummary{Answer: "yes"}
	return &c
}

// benchData writes a data dir with the named cases (id -> mode); each case's feature is its id, so a started council
// says which case it is.
func benchData(t *testing.T, cases ...[2]string) string {
	t.Helper()
	dir := t.TempDir()
	var entries []map[string]any
	keys := map[string]string{}
	for _, c := range cases {
		e := phase0Case(dir, c[0], c[1])
		e["feature"] = c[0]
		entries = append(entries, e)
		keys[c[0]] = newcomerKey
	}
	writeBench(t, dir, entries, keys)
	return dir
}

// captureLog sends the standard logger to the returned buffer for the rest of the test.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return &buf
}

func startedNames(b *runBench) []string {
	var out []string
	for _, c := range b.started {
		out = append(out, c.Feature+"/"+c.Group)
	}
	return out
}

func TestRunOneAtATime(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "brainstorm"})
	b := newRunBench(t)
	if err := b.run(context.Background(), dir, Options{Runs: 2}); err != nil {
		t.Fatal(err)
	}

	// plan order: run 1 of every cell before any run 2, a case's council, team and brainstorm back to back; brainstorm
	// runs on the Brainstorm case b only
	want := "a/council/1 a/team/1 b/council/1 b/team/1 b/brainstorm/1 a/council/2 a/team/2 b/council/2 b/team/2 b/brainstorm/2"
	if got := rowNames(t, dir); got != want {
		t.Errorf("rows in order\n got %s\nwant %s", got, want)
	}
	if got := strings.Join(startedNames(b), " "); got != "a/ui-feature b/ui-feature a/ui-feature b/ui-feature" {
		t.Errorf("councils started = %s, want the council items only, on the council panel", got)
	}
	if got := strings.Join(b.teamed, " "); got != "a b a b" {
		t.Errorf("teams run for cases %s, want a b a b", got)
	}
	if got := strings.Join(b.brainstormed, " "); got != "b b" {
		t.Errorf("brainstorms run for cases %s, want b b: a Review case never runs the variant", got)
	}
	if b.inFlight != 0 {
		t.Errorf("in flight at the end = %d, want 0", b.inFlight)
	}

	runs, _, _ := LoadResults(dir)
	var councilRow, teamRow, brainstormRow int
	for i, r := range runs {
		var want string
		switch r.Variant {
		case VariantTeam:
			teamRow++
			want = fmt.Sprintf("t%d", teamRow)
		case VariantBrainstorm:
			brainstormRow++
			want = fmt.Sprintf("b%d", brainstormRow)
		default:
			councilRow++
			want = fmt.Sprintf("c%d", councilRow)
		}
		if r.Council != want {
			t.Errorf("row %d council = %q, want %s", i, r.Council, want)
		}
	}
}

func TestRunRowsCarryTheirCasesMode(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "brainstorm"})
	b := newRunBench(t)
	b.noBrainstorm = true // a failed brainstorm row carries the mode too
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantSolo, VariantCouncil, VariantTeam, VariantBrainstorm}}); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil || len(runs) != 7 {
		t.Fatalf("rows = %+v, err = %v, want a's solo, council and team and b's solo, council, team and brainstorm", runs, err)
	}
	for _, r := range runs {
		want := map[string]string{"a": "review", "b": "brainstorm"}[r.Case]
		if r.Mode != want {
			t.Errorf("%s/%s row mode = %q, want %q", r.Case, r.Variant, r.Mode, want)
		}
	}
}

func TestRunSoloStillRunsWhenNamed(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"})
	b := newRunBench(t)
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantSolo}}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(startedNames(b), " "); got != "a/solo-ui" {
		t.Errorf("started %s, want the case's solo panel", got)
	}
	if got := rowNames(t, dir); got != "a/solo/1" || len(b.teamed) != 0 {
		t.Errorf("rows %s, teams %v, want one solo row and no team", got, b.teamed)
	}
}

func TestRunRowFields(t *testing.T) {
	dir := benchData(t, [2]string{"a", "brainstorm"})
	b := newRunBench(t)
	b.verdict = func(c Case, report *council.Council) (Verdict, error) {
		return Verdict{
			Matches: map[string]int{"K1": 1, "K3": 2},
			Kept:    map[string]int{"K2": 1},
			Items:   []ItemVerdict{{Rank: 1, Verdict: "key:K1"}, {Rank: 2, Verdict: "key:K3"}, {Rank: 3, Verdict: "wrong"}},
			Tokens:  123_456,
		}, nil
	}
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantCouncil}}); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil || len(runs) != 1 {
		t.Fatalf("rows = %v, err = %v, want 1", runs, err)
	}
	got := runs[0]
	want := CouncilBenchResult{
		Kind: KindRun, Date: got.Date, Harness: "2026-10-22.1", Case: "a", Variant: VariantCouncil, Run: 1, Council: "c1",
		State: "done", Recall: 2, Keys: 3, Kept: 1, Wrong: 1, Tokens: 1_400_000, Minutes: 1.5, Messages: 5, JudgeTokens: 123_456,
		Matches: map[string]int{"K1": 1, "K3": 2}, KeptMatches: map[string]int{"K2": 1}, Mode: "brainstorm",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("row\n got %+v\nwant %+v", got, want)
	}
	if got.Date == "" {
		t.Error("the row has no date")
	}
}

func TestJudgeRowKeepsTheMatches(t *testing.T) {
	c := Case{Id: "a", KeyLines: []KeyLine{{Id: "K1"}, {Id: "K2"}, {Id: "K3"}}}
	report := &council.Council{Id: "c1"}
	f := Funcs{Judge: func(ctx context.Context, c Case, report *council.Council) (Verdict, error) {
		return Verdict{
			Matches: map[string]int{"K1": 2, "K3": 1},
			Kept:    map[string]int{"K2": 1},
			Items:   []ItemVerdict{{Rank: 1, Verdict: "key:K3"}, {Rank: 2, Verdict: "key:K1"}, {Rank: 3, Verdict: "wrong"}},
			Tokens:  50_000,
		}, nil
	}}
	row := CouncilBenchResult{State: "done"}
	if err := judgeRow(context.Background(), f, c, "a", report, &row); err != nil {
		t.Fatal(err)
	}
	want := CouncilBenchResult{
		State: "done", Recall: 2, Keys: 3, Kept: 1, Wrong: 1, JudgeTokens: 50_000,
		Matches: map[string]int{"K1": 2, "K3": 1}, KeptMatches: map[string]int{"K2": 1},
	}
	if !reflect.DeepEqual(row, want) {
		t.Errorf("row\n got %+v\nwant %+v", row, want)
	}
}

func TestJudgeRowFailedJudgingKeepsNoMatches(t *testing.T) {
	c := Case{Id: "a", KeyLines: []KeyLine{{Id: "K1"}}}
	f := Funcs{Judge: func(ctx context.Context, c Case, report *council.Council) (Verdict, error) {
		// a reply that could not be read: what was parsed so far is not a result
		return Verdict{Matches: map[string]int{"K1": 1}, Kept: map[string]int{"K1": 1}, Tokens: 7_000}, errors.New("unreadable reply")
	}}
	row := CouncilBenchResult{State: "done"}
	if err := judgeRow(context.Background(), f, c, "a", &council.Council{Id: "c1"}, &row); err != nil {
		t.Fatal(err)
	}
	want := CouncilBenchResult{State: string(council.StateFailed), JudgeTokens: 7_000}
	if !reflect.DeepEqual(row, want) {
		t.Errorf("row\n got %+v\nwant %+v", row, want)
	}
}

func TestRunWaitsOnQueuedCouncil(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"})
	b := newRunBench(t)
	b.startState = func(n int) council.CouncilState {
		if n == 1 {
			return council.StateQueued // the person's own council runs, so the bench's waits its turn
		}
		return council.StateRunning
	}
	entered, release := make(chan string, 1), make(chan struct{})
	b.onWait = func(n int, id string) {
		if n == 1 {
			entered <- id
			<-release
		}
	}
	done := make(chan error, 1)
	go func() {
		done <- b.run(context.Background(), dir, Options{Variants: []string{VariantSolo, VariantCouncil}})
	}()

	select {
	case id := <-entered:
		if id != "c1" {
			t.Errorf("waited on %q, want the queued council c1", id)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run never waited on the queued council")
	}
	time.Sleep(50 * time.Millisecond)
	b.mu.Lock()
	startedMeanwhile := len(b.started)
	b.mu.Unlock()
	if startedMeanwhile != 1 {
		t.Errorf("%d councils started while the first waited in the queue, want 1", startedMeanwhile)
	}

	close(release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not finish once the queued council ended")
	}
	if len(b.started) != 2 {
		t.Errorf("started = %d councils, want solo and council for the one case", len(b.started))
	}
}

func TestRunFailedAndStoppedRows(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"})
	b := newRunBench(t)
	b.end = func(n int, from *council.Council) (*council.Council, error) {
		c := doneCouncil(fmt.Sprintf("c%d", n), from)
		switch n {
		case 1:
			c.State, c.Tokens, c.Error = council.StateFailed, 300_000, "the coordinator's call failed"
		case 2:
			c.State, c.Tokens = council.StateStopped, 150_000
		}
		return c, nil
	}
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantCouncil}, Runs: 3}); err != nil {
		t.Fatal(err)
	}

	if len(b.judged) != 1 || b.judged[0] != "c3" {
		t.Errorf("judged %v, want only the done council c3", b.judged)
	}
	runs, _, err := LoadResults(dir)
	if err != nil || len(runs) != 3 {
		t.Fatalf("rows = %v, err = %v, want 3", runs, err)
	}
	for i, wantState := range []string{"failed", "stopped"} {
		r := runs[i]
		if r.State != wantState {
			t.Errorf("row %d state = %q, want %q", i, r.State, wantState)
		}
		if r.Recall != 0 || r.Keys != 0 || r.Kept != 0 || r.Wrong != 0 {
			t.Errorf("row %d (%s) carries scores %+v: a council that did not finish has no recall, not a recall of 0", i, wantState, r)
		}
		if r.Council == "" || r.Tokens == 0 || r.Harness == "" {
			t.Errorf("row %d (%s) = %+v, want its council, tokens (real spend) and harness", i, wantState, r)
		}
	}
	if runs[2].State != "done" || runs[2].Recall != 1 || runs[2].Keys != 3 {
		t.Errorf("third row = %+v, want a scored done run", runs[2])
	}
	rows := Summarize(runs)
	if len(rows) != 1 || rows[0].Runs != 3 || rows[0].Scored != 1 || rows[0].Tokens != 300_000+150_000+1_400_000 {
		t.Errorf("summary = %+v, want 3 runs, 1 scored, every run's tokens", rows)
	}
}

func TestRunFailureShapesWriteFailedRows(t *testing.T) {
	t.Run("the judge fails on a done council", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		logs := captureLog(t)
		b := newRunBench(t)
		b.verdict = func(Case, *council.Council) (Verdict, error) {
			return Verdict{Tokens: 77_000}, errors.New("not the verdict JSON") // the call was made, so it was paid for
		}
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantSolo}}); err != nil {
			t.Fatal(err)
		}
		runs, _, _ := LoadResults(dir)
		if len(runs) != 1 || runs[0].State != "failed" || runs[0].Council != "c1" || runs[0].Recall != 0 || runs[0].Keys != 0 {
			t.Errorf("rows = %+v, want one failed row, with its council and no scores", runs)
		}
		if len(runs) == 1 && runs[0].JudgeTokens != 77_000 {
			t.Errorf("judge tokens = %d, want the failed judging's 77000 in the row", runs[0].JudgeTokens)
		}
		if !strings.Contains(logs.String(), "not the verdict JSON") {
			t.Errorf("log = %q, want the judge's error", logs.String())
		}
	})

	t.Run("start refuses one council", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		b := newRunBench(t)
		b.startErr = func(n int) error {
			if n == 1 {
				return errors.New(`council: no group "solo-ui"`)
			}
			return nil
		}
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantSolo, VariantCouncil}}); err != nil {
			t.Fatal(err)
		}
		runs, _, _ := LoadResults(dir)
		if len(runs) != 2 {
			t.Fatalf("rows = %+v, want one per plan item", runs)
		}
		if runs[0].State != "failed" || runs[0].Council != "" || runs[0].Harness != council.HarnessVersion {
			t.Errorf("first row = %+v, want failed, no council, and the harness this binary runs", runs[0])
		}
		if runs[1].State != "done" {
			t.Errorf("second row = %+v, want the rest to run", runs[1])
		}
	})

	t.Run("wait errors with the council", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		b := newRunBench(t)
		b.end = func(n int, from *council.Council) (*council.Council, error) {
			c := doneCouncil("c1", from)
			c.State = council.StateRunning
			return c, errors.New("council c1 is marked running but nothing is running it")
		}
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantSolo}}); err != nil {
			t.Fatal(err)
		}
		runs, _, _ := LoadResults(dir)
		if len(runs) != 1 || runs[0].State != "failed" || runs[0].Tokens == 0 || runs[0].Recall != 0 {
			t.Errorf("rows = %+v, want one failed row with the tokens spent", runs)
		}
		if len(b.judged) != 0 {
			t.Errorf("judged %v, want nothing", b.judged)
		}
	})
}

func TestRunMarksBenchCouncils(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "brainstorm"})
	b := newRunBench(t)
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantSolo, VariantCouncil}}); err != nil {
		t.Fatal(err)
	}
	cases, _, _ := LoadCases(dir)
	byId := map[string]Case{}
	for _, c := range cases {
		byId[c.Id] = c
	}
	if len(b.started) != 4 {
		t.Fatalf("started = %d councils, want 4", len(b.started))
	}
	for _, c := range b.started {
		src := byId[c.Feature]
		if !c.Bench {
			t.Errorf("council for %s/%s is not marked Bench: it would write a document into the case's project and show in the cockpit", c.Feature, c.Group)
		}
		if c.Project != src.Project || c.Question != src.Question || c.Mode != src.Mode {
			t.Errorf("council = project %q, question %q, mode %q; case has %q, %q, %q", c.Project, c.Question, c.Mode, src.Project, src.Question, src.Mode)
		}
		if strings.Join(c.Files, "|") != "frontend/a.tsx|frontend/b.tsx|docs/spec.md" {
			t.Errorf("council files = %v, want the case's list", c.Files)
		}
		if c.PauseAfterRound1 {
			t.Errorf("a bench council must not pause: a paused council is awaiting-you, which the Needs you list shows")
		}
		if c.Id != "" || c.SessionId != "" {
			t.Errorf("council id %q, session %q: the runner names it, and no agent session started it", c.Id, c.SessionId)
		}
	}
	if got := strings.Join(startedNames(b), " "); got != "a/solo-ui a/ui-feature b/solo-ui b/ui-feature" {
		t.Errorf("groups = %s, want solo_group for solo and group for council", got)
	}
}

func TestRunRemindsOnFullBenchOnly(t *testing.T) {
	t.Run("a full bench reminds once, after the last row", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		b := newRunBench(t)
		b.onRemind = func() {
			if runs, _, _ := LoadResults(dir); len(runs) != 2 {
				t.Errorf("remind ran with %d rows written, want all 2 first", len(runs))
			}
		}
		if err := b.run(context.Background(), dir, Options{}); err != nil {
			t.Fatal(err)
		}
		if b.reminds != 1 {
			t.Errorf("reminds = %d, want 1", b.reminds)
		}
	})

	t.Run("naming a case is a partial bench", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "review"})
		b := newRunBench(t)
		if err := b.run(context.Background(), dir, Options{Cases: []string{"b"}}); err != nil {
			t.Fatal(err)
		}
		if b.reminds != 0 {
			t.Errorf("reminds = %d, want 0 for a bench of one named case", b.reminds)
		}
	})

	t.Run("cancelled midway", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "review"})
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		b := newRunBench(t)
		b.onWait = func(n int, id string) {
			if n == 2 {
				cancel()
			}
		}
		err := b.run(ctx, dir, Options{Variants: []string{VariantSolo, VariantCouncil}})
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Run = %v, want context.Canceled", err)
		}
		if b.reminds != 0 {
			t.Errorf("reminds = %d, want 0 for a bench that did not finish", b.reminds)
		}
		runs, _, _ := LoadResults(dir)
		if len(runs) != 1 {
			t.Errorf("rows = %d, want only the one council that ended before the cancel", len(runs))
		}
		if len(b.started) != 2 {
			t.Errorf("started = %d councils, want none after the cancel", len(b.started))
		}
	})
}

func TestRunSkipsMissingCase(t *testing.T) {
	dir := benchData(t, [2]string{"gone", "review"}, [2]string{"kept", "review"})
	cases, _, _ := LoadCases(dir)
	if err := os.RemoveAll(cases[0].Project); err != nil {
		t.Fatal(err)
	}
	logs := captureLog(t)
	b := newRunBench(t)
	if err := b.run(context.Background(), dir, Options{}); err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(logs.String(), "gone") || !strings.Contains(logs.String(), "project folder") {
		t.Errorf("log = %q, want one line naming the skipped case and its project", logs.String())
	}
	if got := strings.Join(startedNames(b), " "); got != "kept/ui-feature" || strings.Join(b.teamed, " ") != "kept" {
		t.Errorf("started %s, teams %v, want only the case that is still there", got, b.teamed)
	}
	if got := rowNames(t, dir); got != "kept/council/1 kept/team/1" {
		t.Errorf("rows = %s, want kept's council and team", got)
	}
}

func TestRunNothingToRun(t *testing.T) {
	t.Run("no cases file", func(t *testing.T) {
		b := newRunBench(t)
		if err := b.run(context.Background(), t.TempDir(), Options{}); err == nil {
			t.Error("Run with no cases.json: want an error that names it")
		}
	})
	t.Run("every case skipped", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		cases, _, _ := LoadCases(dir)
		if err := os.RemoveAll(cases[0].Project); err != nil {
			t.Fatal(err)
		}
		b := newRunBench(t)
		if err := b.run(context.Background(), dir, Options{}); err == nil {
			t.Error("Run with no usable case: want an error")
		}
		if len(b.started) != 0 || b.reminds != 0 {
			t.Errorf("started %d, reminded %d, want nothing", len(b.started), b.reminds)
		}
	})
	t.Run("unknown case", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		b := newRunBench(t)
		if err := b.run(context.Background(), dir, Options{Cases: []string{"nope"}}); err == nil || !strings.Contains(err.Error(), "nope") {
			t.Errorf("Run = %v, want an error naming the case", err)
		}
		if len(b.started) != 0 {
			t.Errorf("started %d councils for an unknown case", len(b.started))
		}
	})
}

func TestRunTeamDoneOutcomeIsJudgedAndScored(t *testing.T) {
	dir := benchData(t, [2]string{"a", "brainstorm"})
	b := newRunBench(t)
	summary := &council.CouncilSummary{Answer: "team yes", Directions: []council.CouncilDirection{{Title: "retry"}}}
	b.team = func(n int, c Case) (TeamOutcome, error) {
		return TeamOutcome{Session: "lead-1", State: TeamDone, Summary: summary, Tokens: 4_100_000, Minutes: 31.4, Messages: 9}, nil
	}
	var judged *council.Council
	b.verdict = func(c Case, report *council.Council) (Verdict, error) {
		judged = report
		return Verdict{Matches: map[string]int{"K1": 1, "K2": 2}, Kept: map[string]int{"K3": 1}, Items: []ItemVerdict{{Rank: 1, Verdict: "key:K1"}, {Rank: 2, Verdict: "wrong"}}, Tokens: 90_000}, nil
	}
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantTeam}}); err != nil {
		t.Fatal(err)
	}

	if judged == nil || judged.Id != "lead-1" || judged.Mode != council.ModeBrainstorm || judged.Summary != summary {
		t.Errorf("the judge was given %+v, want the lead's session as the council id, the case's mode and the parsed summary", judged)
	}
	if len(b.started) != 0 {
		t.Errorf("a team item started %d councils", len(b.started))
	}
	runs, _, _ := LoadResults(dir)
	if len(runs) != 1 {
		t.Fatalf("rows = %+v, want 1", runs)
	}
	got := runs[0]
	want := CouncilBenchResult{
		Kind: KindRun, Date: got.Date, Harness: council.HarnessVersion, Case: "a", Variant: VariantTeam, Run: 1, Council: "lead-1",
		State: "done", Recall: 2, Keys: 3, Kept: 1, Wrong: 1, Tokens: 4_100_000, Minutes: 31.4, Messages: 9, JudgeTokens: 90_000,
		Matches: map[string]int{"K1": 1, "K2": 2}, KeptMatches: map[string]int{"K3": 1}, Mode: "brainstorm",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("row\n got %+v\nwant %+v", got, want)
	}
}

func TestRunTeamOutcomesThatAreNotDoneAreUnscoredRows(t *testing.T) {
	for _, tc := range []struct {
		name      string
		outcome   TeamOutcome
		wantState string
	}{
		{"failed", TeamOutcome{Session: "lead-f", State: TeamFailed, Tokens: 1_200_000, Minutes: 4.5, Messages: 2}, "failed"},
		{"timed out", TeamOutcome{Session: "lead-t", State: TeamTimedOut, Tokens: 6_000_000, Minutes: 45, Messages: 11}, "timed-out"},
		{"no state", TeamOutcome{Tokens: 300_000}, "failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := benchData(t, [2]string{"a", "review"})
			b := newRunBench(t)
			b.team = func(int, Case) (TeamOutcome, error) { return tc.outcome, nil }
			if err := b.run(context.Background(), dir, Options{Variants: []string{VariantTeam}}); err != nil {
				t.Fatal(err)
			}
			if len(b.judged) != 0 {
				t.Errorf("judged %v, want nothing: a team that did not finish has no report", b.judged)
			}
			runs, _, _ := LoadResults(dir)
			if len(runs) != 1 {
				t.Fatalf("rows = %+v, want 1", runs)
			}
			r := runs[0]
			if r.State != tc.wantState || r.Harness != council.HarnessVersion || r.Variant != VariantTeam {
				t.Errorf("row = %+v, want state %s, variant team and this binary's harness", r, tc.wantState)
			}
			if r.Recall != 0 || r.Keys != 0 || r.Kept != 0 || r.Wrong != 0 || r.JudgeTokens != 0 {
				t.Errorf("row = %+v, want no scores and no judge spend", r)
			}
			if r.Council != tc.outcome.Session || r.Tokens != tc.outcome.Tokens || r.Minutes != tc.outcome.Minutes || r.Messages != tc.outcome.Messages {
				t.Errorf("row = %+v, want the outcome's session, tokens, minutes and messages (real spend)", r)
			}
		})
	}
}

func TestRunTeamWithoutARunnerIsAFailedRow(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"})
	logs := captureLog(t)
	b := newRunBench(t)
	b.noTeam = true
	if err := b.run(context.Background(), dir, Options{}); err != nil {
		t.Fatal(err)
	}
	runs, _, _ := LoadResults(dir)
	if len(runs) != 2 || runs[0].Variant != VariantCouncil || runs[0].State != "done" {
		t.Fatalf("rows = %+v, want the council's done row, then the team's", runs)
	}
	r := runs[1]
	if r.Variant != VariantTeam || r.State != "failed" || r.Recall != 0 || r.Keys != 0 || r.Tokens != 0 || r.Harness != council.HarnessVersion {
		t.Errorf("team row = %+v, want a failed row with no scores", r)
	}
	if len(b.judged) != 1 {
		t.Errorf("judged %v, want only the council's report", b.judged)
	}
	if !strings.Contains(logs.String(), "a team run 1 not run") {
		t.Errorf("log = %q, want a line saying the team item was not run", logs.String())
	}
}

func TestRunTeamJudgeFailureIsAFailedRow(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"})
	logs := captureLog(t)
	b := newRunBench(t)
	b.verdict = func(Case, *council.Council) (Verdict, error) {
		return Verdict{Tokens: 55_000}, errors.New("not the verdict JSON")
	}
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantTeam}}); err != nil {
		t.Fatal(err)
	}
	runs, _, _ := LoadResults(dir)
	if len(runs) != 1 || runs[0].State != "failed" || runs[0].Council != "t1" || runs[0].Recall != 0 || runs[0].Keys != 0 {
		t.Fatalf("rows = %+v, want one failed row with the lead's session and no scores", runs)
	}
	if runs[0].Tokens != 4_500_000 || runs[0].JudgeTokens != 55_000 {
		t.Errorf("row = %+v, want the team's tokens and the failed judging's kept: both were spent", runs[0])
	}
	if !strings.Contains(logs.String(), "not the verdict JSON") {
		t.Errorf("log = %q, want the judge's error", logs.String())
	}
}

func TestRunTeamErrorEndsTheBenchOnlyWithTheContext(t *testing.T) {
	t.Run("the context ended", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "review"})
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		b := newRunBench(t)
		b.team = func(int, Case) (TeamOutcome, error) {
			cancel()
			return TeamOutcome{}, ctx.Err()
		}
		err := b.run(ctx, dir, Options{})
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Run = %v, want context.Canceled", err)
		}
		if b.reminds != 0 {
			t.Errorf("reminds = %d, want 0 for a bench that did not finish", b.reminds)
		}
		// the council item before it ended; the team cell the cancel cut has no row, and nothing started after it
		if got := rowNames(t, dir); got != "a/council/1" || len(b.started) != 1 || len(b.teamed) != 1 {
			t.Errorf("rows = %s, councils started = %d, teams = %d, want a/council/1, 1 and 1", got, len(b.started), len(b.teamed))
		}
	})
	t.Run("any other error is a failed row", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		logs := captureLog(t)
		b := newRunBench(t)
		b.team = func(int, Case) (TeamOutcome, error) { return TeamOutcome{}, errors.New("claude is not installed") }
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantTeam}, Runs: 2}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/team/1 a/team/2" {
			t.Errorf("rows = %s, want a failed row for each, the bench going on", got)
		}
		if runs, _, _ := LoadResults(dir); runs[0].State != "failed" || !strings.Contains(logs.String(), "claude is not installed") {
			t.Errorf("first row = %+v, log = %q, want it failed and the error logged", runs[0], logs.String())
		}
	})
}

func TestRunTokenCap(t *testing.T) {
	logLine := func(logs *bytes.Buffer) string {
		for line := range strings.SplitSeq(logs.String(), "\n") {
			if strings.Contains(line, "token cap") {
				return line
			}
		}
		return ""
	}

	t.Run("stops starting items once the rows' tokens plus judge tokens reach it", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		logs := captureLog(t)
		b := newRunBench(t)
		// each council item is 1.4M and its judging 100k: 1.5M an item, 4.5M after the third
		b.verdict = func(Case, *council.Council) (Verdict, error) {
			return Verdict{Matches: map[string]int{"K1": 1}, Tokens: 100_000}, nil
		}
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantCouncil}, Runs: 5, Cap: 4_000_000}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/council/1 a/council/2 a/council/3" {
			t.Errorf("rows = %s, want 3: the third started under the cap and finished past it, the fourth never started", got)
		}
		if len(b.started) != 3 {
			t.Errorf("started %d councils, want 3", len(b.started))
		}
		if b.reminds != 0 {
			t.Errorf("reminds = %d, want none: a bench the cap cut short is not a full bench", b.reminds)
		}
		line := logLine(logs)
		for _, want := range []string{"4500000", "4000000", "2 of 5"} {
			if !strings.Contains(line, want) {
				t.Errorf("cap log line = %q, want it to name the spend, the cap and the items not run (%s)", line, want)
			}
		}
	})

	t.Run("a spend exactly at the cap stops the next item", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		b := newRunBench(t)
		// 1.4M an item, the default verdict spends no judge tokens: 2.8M after two
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantCouncil}, Runs: 4, Cap: 2_800_000}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/council/1 a/council/2" {
			t.Errorf("rows = %s, want 2: the cap is reached, not exceeded, before the third", got)
		}
	})

	t.Run("judge tokens count", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		b := newRunBench(t)
		// the council alone is 1.4M, under the 3M cap three times over; with a 2M judging each item is 3.4M
		b.verdict = func(Case, *council.Council) (Verdict, error) { return Verdict{Tokens: 2_000_000}, nil }
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantCouncil}, Runs: 3, Cap: 3_000_000}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/council/1" {
			t.Errorf("rows = %s, want 1: the first item's 3.4M reached the cap", got)
		}
	})

	t.Run("team items count, and a cut leaves whole pairs", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "review"})
		b := newRunBench(t)
		// 1.4M for a council, 4.5M for a team: a's council leaves the bench under a 5M cap, so its team starts; the pair
		// is 5.9M, past the cap, so b's council never starts
		if err := b.run(context.Background(), dir, Options{Cap: 5_000_000}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/council/1 a/team/1" {
			t.Errorf("rows = %s, want a's council and team: the team's 4.5M took the spend past the cap", got)
		}
	})

	t.Run("a cap that is never reached runs every item and reminds", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		b := newRunBench(t)
		if err := b.run(context.Background(), dir, Options{Runs: 3, Cap: 1_000_000_000}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/council/1 a/team/1 a/council/2 a/team/2 a/council/3 a/team/3" {
			t.Errorf("rows = %s, want all 6", got)
		}
		if b.reminds != 1 {
			t.Errorf("reminds = %d, want 1", b.reminds)
		}
	})

	t.Run("no cap named is the 50M default", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "review"})
		logs := captureLog(t)
		b := newRunBench(t)
		// 20M a council: the third item starts at 40M, the fourth at 60M finds the 50M default reached
		b.end = func(n int, from *council.Council) (*council.Council, error) {
			c := doneCouncil(fmt.Sprintf("c%d", n), from)
			c.Tokens = 20_000_000
			return c, nil
		}
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantCouncil}, Runs: 5}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/council/1 a/council/2 a/council/3" {
			t.Errorf("rows = %s, want 3 under the default cap of %d", got, TokenCap)
		}
		if line := logLine(logs); !strings.Contains(line, "60000000") || !strings.Contains(line, "50000000") || !strings.Contains(line, "2 of 5") {
			t.Errorf("cap log line = %q, want 60000000 spent of 50000000 and 2 of 5 items not run", line)
		}
	})

	t.Run("brainstorm items count the agent's tokens and both bench judge calls", func(t *testing.T) {
		dir := benchData(t, [2]string{"a", "brainstorm"})
		b := newRunBench(t)
		// the default brainstorm outcome is 3.9M plus 16k of judging: 3.916M an item, 7.832M after two
		if err := b.run(context.Background(), dir, Options{Variants: []string{VariantBrainstorm}, Runs: 4, Cap: 7_832_000}); err != nil {
			t.Fatal(err)
		}
		if got := rowNames(t, dir); got != "a/brainstorm/1 a/brainstorm/2" {
			t.Errorf("rows = %s, want 2: the second item's 7.832M reached the cap", got)
		}
	})
}

// brainstormCase is a Brainstorm case with three key lines, as a loaded case holds them.
func brainstormCase() Case {
	return Case{Id: "a", Mode: council.ModeBrainstorm, KeyLines: []KeyLine{{Id: "K1"}, {Id: "K2"}, {Id: "K3"}}}
}

func brainstormItem() CouncilBenchPlanItem {
	return CouncilBenchPlanItem{Case: "a", Variant: VariantBrainstorm, Run: 1}
}

func TestRunBrainstormItemDoneOutcomeIsScoredFromItsMarks(t *testing.T) {
	out := BrainstormOutcome{
		Session: "9f0c-session", State: TeamDone, Skill: "3f9a01bc superpowers@4.0.3", Tokens: 4_200_000, JudgeTokens: 17_500,
		Minutes: 38.5, Turns: 21, Questions: 9, Decisions: 7,
		Final:  Verdict{Matches: map[string]int{"K1": 2, "K3": 5}, Kept: map[string]int{"K2": 1}, Items: []ItemVerdict{{Rank: 1, Verdict: "valid"}, {Rank: 2, Verdict: "key:K1"}, {Rank: 3, Verdict: "wrong"}, {Rank: 4, Verdict: "wrong"}, {Rank: 5, Verdict: "key:K3"}}},
		AtDone: Verdict{Matches: map[string]int{"K1": 2}, Items: []ItemVerdict{{Rank: 1, Verdict: "valid"}, {Rank: 2, Verdict: "key:K1"}, {Rank: 3, Verdict: "wrong"}}},
	}
	var asked []Case
	f := Funcs{Brainstorm: func(ctx context.Context, c Case) (BrainstormOutcome, error) {
		asked = append(asked, c)
		return out, nil
	}}
	row, err := runItem(context.Background(), brainstormCase(), brainstormItem(), f)
	if err != nil {
		t.Fatal(err)
	}
	if len(asked) != 1 || asked[0].Id != "a" {
		t.Errorf("brainstorm was asked for %+v, want the item's case once", asked)
	}
	want := CouncilBenchResult{
		Harness: council.HarnessVersion, Case: "a", Variant: VariantBrainstorm, Run: 1, Council: "9f0c-session", State: "done",
		Recall: 2, Keys: 3, Wrong: 2, Tokens: 4_200_000, Minutes: 38.5, Messages: 21, JudgeTokens: 17_500,
		Matches: map[string]int{"K1": 2, "K3": 5},
		Mode:    "brainstorm", Skill: "3f9a01bc superpowers@4.0.3", Decisions: 7, RecallDone: 1, MatchesDone: map[string]int{"K1": 2}, Questions: 9,
	}
	if !reflect.DeepEqual(row, want) {
		t.Errorf("row\n got %+v\nwant %+v", row, want)
	}
	if row.Kept != 0 || row.KeptMatches != nil {
		t.Errorf("row = %+v, want no kept ideas: a design is one answer, with no wild ideas kept aside", row)
	}
}

func TestRunBrainstormItemOutcomesThatAreNotDoneAreUnscoredRows(t *testing.T) {
	// each outcome also carries scores, as an outcome that failed after its done mark might: the row must not take them
	spent := func(state string) BrainstormOutcome {
		return BrainstormOutcome{
			Session: "s-" + state, State: state, Skill: "3f9a01bc superpowers@4.0.3", Tokens: 3_100_000, JudgeTokens: 8_000, Minutes: 60, Turns: 40, Questions: 12, Decisions: 4,
			Final:  Verdict{Matches: map[string]int{"K1": 1}, Items: []ItemVerdict{{Rank: 1, Verdict: "wrong"}}},
			AtDone: Verdict{Matches: map[string]int{"K2": 1}},
		}
	}
	noState := spent("")
	for _, tc := range []struct {
		name      string
		outcome   BrainstormOutcome
		wantState string
	}{
		{"failed", spent(TeamFailed), "failed"},
		{"timed out", spent(TeamTimedOut), "timed-out"},
		{"no state", noState, "failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := Funcs{Brainstorm: func(context.Context, Case) (BrainstormOutcome, error) { return tc.outcome, nil }}
			row, err := runItem(context.Background(), brainstormCase(), brainstormItem(), f)
			if err != nil {
				t.Fatal(err)
			}
			want := CouncilBenchResult{
				Harness: council.HarnessVersion, Case: "a", Variant: VariantBrainstorm, Run: 1, Council: tc.outcome.Session, State: tc.wantState,
				Tokens: 3_100_000, Minutes: 60, Messages: 40, JudgeTokens: 8_000,
				Mode: "brainstorm", Skill: "3f9a01bc superpowers@4.0.3", Questions: 12,
			}
			if !reflect.DeepEqual(row, want) {
				t.Errorf("row\n got %+v\nwant %+v", row, want)
			}
		})
	}
}

func TestRunBrainstormItemWithoutARunnerIsAFailedRow(t *testing.T) {
	logs := captureLog(t)
	row, err := runItem(context.Background(), brainstormCase(), brainstormItem(), Funcs{})
	if err != nil {
		t.Fatal(err)
	}
	want := CouncilBenchResult{Harness: council.HarnessVersion, Case: "a", Variant: VariantBrainstorm, Run: 1, State: "failed", Mode: "brainstorm"}
	if !reflect.DeepEqual(row, want) {
		t.Errorf("row\n got %+v\nwant %+v", row, want)
	}
	if !strings.Contains(logs.String(), "[council-bench]") || !strings.Contains(logs.String(), "a brainstorm run 1 not run") {
		t.Errorf("log = %q, want a [council-bench] line saying the brainstorm item was not run", logs.String())
	}
}

func TestRunBrainstormItemErrorEndsTheBenchOnlyWithTheContext(t *testing.T) {
	t.Run("the context ended", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		f := Funcs{Brainstorm: func(context.Context, Case) (BrainstormOutcome, error) {
			cancel()
			return BrainstormOutcome{}, ctx.Err()
		}}
		if _, err := runItem(ctx, brainstormCase(), brainstormItem(), f); !errors.Is(err, context.Canceled) {
			t.Errorf("runItem = %v, want context.Canceled", err)
		}
	})
	t.Run("any other error is a failed row, logged with the case", func(t *testing.T) {
		logs := captureLog(t)
		f := Funcs{Brainstorm: func(context.Context, Case) (BrainstormOutcome, error) {
			return BrainstormOutcome{Tokens: 1}, errors.New("claude is not installed")
		}}
		row, err := runItem(context.Background(), brainstormCase(), brainstormItem(), f)
		if err != nil {
			t.Fatal(err)
		}
		want := CouncilBenchResult{Harness: council.HarnessVersion, Case: "a", Variant: VariantBrainstorm, Run: 1, State: "failed", Mode: "brainstorm"}
		if !reflect.DeepEqual(row, want) {
			t.Errorf("row\n got %+v\nwant %+v: an errored call leaves no outcome to read", row, want)
		}
		if !strings.Contains(logs.String(), "claude is not installed") || !strings.Contains(logs.String(), "a brainstorm run 1") {
			t.Errorf("log = %q, want the error, with the item named", logs.String())
		}
	})
}

func TestRunBrainstormThroughRunWritesTheRow(t *testing.T) {
	dir := benchData(t, [2]string{"a", "review"}, [2]string{"b", "brainstorm"})
	b := newRunBench(t)
	if err := b.run(context.Background(), dir, Options{Variants: []string{VariantBrainstorm}}); err != nil {
		t.Fatal(err)
	}
	runs, _, err := LoadResults(dir)
	if err != nil || len(runs) != 1 {
		t.Fatalf("rows = %+v, err = %v, want the one Brainstorm case's row: the Review case has no brainstorm item", runs, err)
	}
	r := runs[0]
	if r.Case != "b" || r.Variant != VariantBrainstorm || r.Council != "b1" || r.State != "done" || r.Mode != "brainstorm" || r.Harness != council.HarnessVersion {
		t.Errorf("row = %+v, want b's done brainstorm row with its session, mode and this binary's harness", r)
	}
	if r.Recall != 2 || r.Keys != 3 || r.Wrong != 1 || r.RecallDone != 1 || r.Decisions != 5 || r.Questions != 6 || r.Messages != 14 || r.Skill == "" {
		t.Errorf("row = %+v, want the final mark's recall and wrong, the done mark's recall and the turns, questions and decisions", r)
	}
	if len(b.judged) != 0 || len(b.started) != 0 || len(b.teamed) != 0 {
		t.Errorf("judged %v, started %d, teamed %v, want only the brainstorm runner: it judges its own marks", b.judged, len(b.started), b.teamed)
	}
}
