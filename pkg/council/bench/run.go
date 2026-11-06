// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// StartFunc starts a council the bench built and returns it as saved: running, or queued behind the council that runs
// (the person's own, in any project). The experts are the start's to fill in from the council's Group. A start that
// outlives ctx is stopped with it, so cancelling a bench ends the council it is on.
type StartFunc func(ctx context.Context, c *council.Council) (*council.Council, error)

// WaitFunc returns the council once nothing is working on it (council.Runner.Wait), a queued one included.
type WaitFunc func(ctx context.Context, id string) (*council.Council, error)

// JudgeFunc scores a done council's report against the case's key (Judge).
type JudgeFunc func(ctx context.Context, c Case, report *council.Council) (Verdict, error)

// RemindFunc adds the re-measure reminder a full bench ends with.
type RemindFunc func(ctx context.Context) error

// Funcs are the calls a bench makes: the real ones in wavesrv, fakes in a test. Start, Wait and Judge run a council
// variant; Team runs the team variant (a nil Team makes every team item a failed row); Remind may be nil.
type Funcs struct {
	Start  StartFunc
	Wait   WaitFunc
	Judge  JudgeFunc
	Remind RemindFunc
	Team   TeamFunc
}

// Run runs the plan opts picks over the cases in dataDir, one item at a time: a council variant builds its council,
// starts it, waits for its end; the team variant runs its team; a done one is judged, its row appended to the results
// file, and the next item follows. Items never overlap, so a council the start queued behind the person's own is waited
// on, and nothing else starts meanwhile.
//
// A case whose project folder or key is gone is skipped with a log line (LoadCases). An item that fails or is stopped
// still gets its row, with its state and spend and no scores. Before each item Run sums the tokens of the rows it has
// written (the judge's calls too); at opts.Cap (TokenCap when 0) or past it nothing more starts, one log line says what
// was spent and how many items did not run, and Run returns nil without the reminder: an item already running is never
// cut short by the cap. When opts.Cases is empty and every item has run, Remind is called once. Run returns early,
// without it, when ctx ends or the results file cannot be written.
func Run(ctx context.Context, dataDir string, opts Options, f Funcs) error {
	cases, warnings, err := LoadCases(dataDir)
	if err != nil {
		return err
	}
	for _, w := range warnings {
		log.Printf("[council-bench] %s", w)
	}
	items, _, err := Plan(cases, opts)
	if err != nil {
		return err
	}
	if len(items) == 0 {
		return errors.New("no benchmark cases to run")
	}
	byId := make(map[string]Case, len(cases))
	for _, c := range cases {
		byId[c.Id] = c
	}
	limit := opts.Cap
	if limit == 0 {
		limit = TokenCap
	}

	var spent int64
	for i, item := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		if spent >= limit {
			log.Printf("[council-bench] the token cap is reached: %d tokens spent of %d, %d of %d items not run", spent, limit, len(items)-i, len(items))
			return nil
		}
		row, err := runItem(ctx, byId[item.Case], item, f)
		if err != nil {
			return err
		}
		if err := AppendResult(dataDir, row); err != nil {
			return fmt.Errorf("saving the bench result for %s: %w", itemName(item), err)
		}
		spent += row.Tokens + row.JudgeTokens
		log.Printf("[council-bench] %s: %s", itemName(item), describeRow(row))
	}

	if len(opts.Cases) == 0 && f.Remind != nil {
		if err := f.Remind(ctx); err != nil {
			return fmt.Errorf("the bench finished and its results are saved, but its re-measure reminder was not added: %w", err)
		}
	}
	return nil
}

func itemName(item CouncilBenchPlanItem) string {
	return fmt.Sprintf("%s %s run %d", item.Case, item.Variant, item.Run)
}

func describeRow(r CouncilBenchResult) string {
	if r.State != string(council.StateDone) {
		return r.State
	}
	return fmt.Sprintf("done, recall %d/%d", r.Recall, r.Keys)
}

// runItem is one item of the plan, as a row. Its error is ctx's, the one thing that stops the bench: every other
// failure becomes a failed row, because an item that did not finish is a result, and one case's trouble must not end
// the bench for the rest.
func runItem(ctx context.Context, c Case, item CouncilBenchPlanItem, f Funcs) (CouncilBenchResult, error) {
	// an item that never began has no harness version of its own: it is the one this binary runs
	row := CouncilBenchResult{Harness: council.HarnessVersion, Case: item.Case, Variant: item.Variant, Run: item.Run, State: string(council.StateFailed)}
	if item.Variant == VariantTeam {
		return runTeamItem(ctx, c, item, f, row)
	}
	return runCouncilItem(ctx, c, item, f, row)
}

// runTeamItem is a team item as a row. A nil f.Team and an outcome that is not done are rows with no scores (the
// outcome's state, failed when it names none); a done one is judged on its report, wrapped as the council the Judge
// reads. Like a start's, TeamFunc's error ends the bench only when it is ctx's.
func runTeamItem(ctx context.Context, c Case, item CouncilBenchPlanItem, f Funcs, row CouncilBenchResult) (CouncilBenchResult, error) {
	name := itemName(item)
	if f.Team == nil {
		log.Printf("[council-bench] %s not run: the bench has no team runner", name)
		return row, nil
	}
	out, err := f.Team(ctx, c)
	if err != nil {
		if ctx.Err() != nil {
			return row, ctx.Err()
		}
		log.Printf("[council-bench] %s not run: %v", name, err)
		return row, nil
	}
	row.Council = out.Session
	row.Tokens = out.Tokens
	row.Minutes = out.Minutes
	row.Messages = out.Messages
	if out.State != "" {
		row.State = out.State
	}
	if out.State != TeamDone {
		return row, nil
	}
	err = judgeRow(ctx, f, c, name, &council.Council{Id: out.Session, Mode: c.Mode, Summary: out.Summary}, &row)
	return row, err
}

// runCouncilItem is a solo or council item as a row: its council built, started and waited on, then judged when done.
func runCouncilItem(ctx context.Context, c Case, item CouncilBenchPlanItem, f Funcs, row CouncilBenchResult) (CouncilBenchResult, error) {
	name := itemName(item)
	bc, err := benchCouncil(c, item.Variant)
	if err != nil {
		log.Printf("[council-bench] %s not run: %v", name, err)
		return row, nil
	}
	started, err := f.Start(ctx, bc)
	if err != nil {
		if ctx.Err() != nil {
			return row, ctx.Err()
		}
		log.Printf("[council-bench] %s not started: %v", name, err)
		return row, nil
	}
	row.Council = started.Id

	ended, err := f.Wait(ctx, started.Id)
	if err != nil && ctx.Err() != nil {
		return row, ctx.Err()
	}
	if ended == nil {
		ended = started
	}
	if ended.Harness != "" {
		row.Harness = ended.Harness
	}
	row.Tokens = ended.Tokens
	row.Minutes = minutesOf(ended)
	row.Messages = len(ended.Proposals) + len(ended.Replies)
	if err != nil {
		log.Printf("[council-bench] %s: waiting on council %s failed: %v", name, started.Id, err)
		return row, nil // a council nothing is running reads as failed, whatever state it was saved in
	}

	switch ended.State {
	case council.StateRunning, council.StateQueued, "":
		return row, nil // not an end state: failed
	}
	row.State = string(ended.State)
	if ended.State != council.StateDone {
		return row, nil
	}

	err = judgeRow(ctx, f, c, name, ended, &row)
	return row, err
}

// judgeRow judges a done item's report and puts the verdict's scores in its row, with which key lines matched and at
// what rank (Matches, KeptMatches), and what the judge's call spent (the bench's cap counts it). A judge that fails
// leaves the row failed with no scores and no matches: done but unscored is not a result to read as done with nothing
// found. Its error is ctx's.
func judgeRow(ctx context.Context, f Funcs, c Case, name string, report *council.Council, row *CouncilBenchResult) error {
	verdict, err := f.Judge(ctx, c, report)
	row.JudgeTokens = verdict.Tokens // spent whether or not the reply could be read
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		log.Printf("[council-bench] %s: judging report %s failed: %v", name, report.Id, err)
		row.State = string(council.StateFailed)
		return nil
	}
	row.Keys = len(c.KeyLines)
	row.Recall = verdict.Recall()
	row.Kept = verdict.KeptMatched()
	row.Wrong = verdict.Wrong()
	row.Matches = verdict.Matches
	row.KeptMatches = verdict.Kept
	return nil
}

// benchCouncil is the council a plan item starts: the case's project, files and question, on the variant's panel. It is
// marked Bench (no document in the project, never listed in the cockpit) and never pauses, so it never waits on the
// person.
func benchCouncil(c Case, variant string) (*council.Council, error) {
	var group string
	switch variant {
	case VariantSolo:
		group = c.SoloGroup
	case VariantCouncil:
		group = c.Group
	default:
		return nil, fmt.Errorf("the %q variant has no council to start", variant)
	}
	if strings.TrimSpace(group) == "" {
		return nil, fmt.Errorf("case %s has no group for the %s variant", c.Id, variant)
	}
	return &council.Council{
		Project:  c.Project,
		Feature:  c.Feature,
		Question: c.Question,
		Files:    c.FileList(),
		Group:    group,
		Mode:     c.Mode,
		Bench:    true,
	}, nil
}

// minutesOf is the wall time of a council's run, from the start of round 1 to its last save, to a tenth of a minute.
// Time spent queued is not in it, and a council that never began has none.
func minutesOf(c *council.Council) float64 {
	if c.Started <= 0 || c.Updated <= c.Started {
		return 0
	}
	return math.Round(float64(c.Updated-c.Started)/6000) / 10
}
