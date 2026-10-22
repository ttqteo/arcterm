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

// Run runs the plan opts picks over the cases in dataDir, one council at a time: it builds the item's council, starts
// it, waits for its end, judges a done one, appends its row to the results file and goes on to the next. Councils never
// overlap, so a council the start queued behind the person's own is waited on, and nothing else starts meanwhile.
//
// A case whose project folder or key is gone is skipped with a log line (LoadCases). A council that fails or is stopped
// still gets its row, with its state and spend and no scores. When opts.Cases is empty and every item has run, remind is
// called once. Run returns early, without it, when ctx ends or the results file cannot be written.
func Run(ctx context.Context, dataDir string, opts Options, start StartFunc, wait WaitFunc, judge JudgeFunc, remind RemindFunc) error {
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

	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		row, err := runItem(ctx, byId[item.Case], item, start, wait, judge)
		if err != nil {
			return err
		}
		if err := AppendResult(dataDir, row); err != nil {
			return fmt.Errorf("saving the bench result for %s: %w", itemName(item), err)
		}
		log.Printf("[council-bench] %s: %s", itemName(item), describeRow(row))
	}

	if len(opts.Cases) == 0 && remind != nil {
		if err := remind(ctx); err != nil {
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

// runItem is one council of the plan, as a row. Its error is ctx's, the one thing that stops the bench: every other
// failure becomes a failed row, because a council that did not finish is a result, and one case's trouble must not end
// the bench for the rest.
func runItem(ctx context.Context, c Case, item CouncilBenchPlanItem, start StartFunc, wait WaitFunc, judge JudgeFunc) (CouncilBenchResult, error) {
	name := itemName(item)
	// a council that never began has no harness version of its own: it is the one this binary runs
	row := CouncilBenchResult{Harness: council.HarnessVersion, Case: item.Case, Variant: item.Variant, Run: item.Run, State: string(council.StateFailed)}

	bc, err := benchCouncil(c, item.Variant)
	if err != nil {
		log.Printf("[council-bench] %s not run: %v", name, err)
		return row, nil
	}
	started, err := start(ctx, bc)
	if err != nil {
		if ctx.Err() != nil {
			return row, ctx.Err()
		}
		log.Printf("[council-bench] %s not started: %v", name, err)
		return row, nil
	}
	row.Council = started.Id

	ended, err := wait(ctx, started.Id)
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

	verdict, err := judge(ctx, c, ended)
	if err != nil {
		if ctx.Err() != nil {
			return row, ctx.Err()
		}
		// done but unscored is not a result to read as done with nothing found
		log.Printf("[council-bench] %s: judging council %s failed: %v", name, ended.Id, err)
		row.State = string(council.StateFailed)
		return row, nil
	}
	row.Keys = len(c.KeyLines)
	row.Recall = verdict.Recall()
	row.Kept = verdict.KeptMatched()
	row.Wrong = verdict.Wrong()
	return row, nil
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
