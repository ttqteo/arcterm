// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func setFastTrack(t *testing.T, ctx context.Context, dagID string) {
	t.Helper()
	if err := wstore.UpdateDag(ctx, dagID, func(g *waveobj.TaskGroup) error {
		g.FastTrack = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// wakeText flushes the lead's queued lines with one wake and returns everything typed to it.
func wakeText(t *testing.T, ctx context.Context, f *fakeLead, channelID, runID string) string {
	t.Helper()
	PostWake(ctx, channelID, runID, "wake: next")
	return strings.Join(f.sends, "\n")
}

func TestFastTrackWorkerWithACommitSkipsReview(t *testing.T) {
	for _, tc := range []struct {
		name      string
		fastTrack bool
		fixRound  bool
		want      string
	}{
		{name: "fast track", fastTrack: true, want: TaskState_Done},
		{name: "fast-track fix round", fastTrack: true, fixRound: true, want: TaskState_Done},
		{name: "full track", want: TaskState_Reviewing},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, dag, worker := seedReviewDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.FastTrack = tc.fastTrack
				if tc.fixRound {
					g.Final = &waveobj.FinalStage{Round: 2}
					g.Tasks[0].Description = fmt.Sprintf(fixRoundLineFmt, 2, 1, "docs/fix.md")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			stubReviewTree(t, worker.EndCommit)
			calls := captureSpawns(t)
			schedule(t, ctx, dag.OID)
			got := firstTask(t, ctx, dag.OID)
			if got.State != tc.want {
				t.Fatalf("want %s, got %s", tc.want, got.State)
			}
			if spawned := len(*calls) > 0; spawned != (tc.want == TaskState_Reviewing) {
				t.Fatalf("a reviewer starts only on the full track, got %d spawns", len(*calls))
			}
		})
	}
}

func TestFastTrackCommittedTaskGetsNoNoCommitLine(t *testing.T) {
	for _, tc := range []struct {
		name      string
		endCommit string
		want      bool
	}{
		{name: "committed", endCommit: "work111", want: false},
		{name: "no commit", endCommit: "", want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, dag, worker := seedReviewDag(t)
			setFastTrack(t, ctx, dag.OID)
			if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
				r.EndCommit = tc.endCommit
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			captureSpawns(t)
			f := newFakeLead(t)
			schedule(t, ctx, dag.OID)
			joined := wakeText(t, ctx, f, dag.ChannelId, dag.RunID)
			if got := strings.Contains(joined, "t-0 finished without reporting a commit"); got != tc.want {
				t.Fatalf("want the no-commit line %v, got %q", tc.want, f.sends)
			}
		})
	}
}

// outside git nothing merges, so the lines a merge would post go out when the task is done
func TestFastTrackTaskWithNoMergePostsItsLinesWhenDone(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	setFastTrack(t, ctx, dag.OID)
	setWorkerReport(t, ctx, dag.ChannelId, worker.ID, structuredReport("Added fmtDate.", "Used time.Format.", "The CDP shot.", "None", "Flaky clock test."))
	captureSpawns(t)
	f := newFakeLead(t)
	schedule(t, ctx, dag.OID)
	joined := wakeText(t, ctx, f, dag.ChannelId, dag.RunID)
	want := "Unverified:\nt-0 Differs from plan: Used time.Format.\nt-0 Not verified: The CDP shot.\nt-0 Found not fixed: Flaky clock test.\nSince your last wake:\nt-0 done"
	if !strings.Contains(joined, want) {
		t.Fatalf("want %q, got %q", want, f.sends)
	}
	if strings.Contains(joined, "Added fmtDate") {
		t.Fatalf("Done is not the lead's, got %q", f.sends)
	}
}

// a fast-track task has no reviewer, so the final stage's caveats come from its worker alone
func TestFastTrackTaskWorkerNotVerifiedIsAFinalCaveat(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	setFastTrack(t, ctx, dag.OID)
	setWorkerReport(t, ctx, dag.ChannelId, worker.ID, structuredReport("Added fmtDate.", "None", "The CDP shot.", "None", "None"))
	captureSpawns(t)
	newFakeLead(t)
	schedule(t, ctx, dag.OID)
	g, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got := dagCaveatLines(ctx, g); !slices.Equal(got, []string{"t-0: The CDP shot."}) {
		t.Fatalf("want the worker's Not verified as t-0's caveat, got %q", got)
	}
}

// fastTrackMerge is a merge-required fast-track dag whose named tasks' workers just finished with a commit.
func fastTrackMerge(t *testing.T, tasks []waveobj.TaskNode, reports map[string]string) (*mergeFixture, *fakeLead, *[]string) {
	t.Helper()
	f := newMergeFixture(t, tasks)
	setFastTrack(t, f.ctx, f.dagID)
	for id, report := range reports {
		child := jarvis.NewRun("child goal", "ws-1", f.project, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
		child.Status = jarvis.RunStatus_Done
		child.BaseCommit, child.EndCommit = "base000", "work-"+id
		child.DagORef = f.dagID
		child.Evidence = &waveobj.RunEvidence{Summary: report}
		if err := wstore.AppendRun(f.ctx, f.channel, child); err != nil {
			t.Fatal(err)
		}
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			task := taskByID(cur, id)
			task.State, task.RunID = TaskState_Running, child.ID
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	var spawned []string
	stubSpawn(t, &spawned)
	lead := newFakeLead(t)
	// the first tick sees the workers done, the second lands their lane and dispatches what it unblocked
	for range 2 {
		if err := Schedule(f.ctx, f.dagID); err != nil {
			t.Fatal(err)
		}
	}
	return f, lead, &spawned
}

func TestFastTrackMergePostsTheTasksLines(t *testing.T) {
	report := structuredReport("Added fmtDate.", "Used time.Format.", "None", "None", "Flaky clock test.")
	f, lead, _ := fastTrackMerge(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}}, map[string]string{"t-0": report})
	if !f.dag(t).Tasks[0].Merged {
		t.Fatal("fixture: t-0 must be merged")
	}
	joined := wakeText(t, f.ctx, lead, f.channel, f.dag(t).RunID)
	want := "Unverified:\nt-0 Differs from plan: Used time.Format.\nt-0 Found not fixed: Flaky clock test.\nSince your last wake:\nt-0 merged"
	if !strings.Contains(joined, want) {
		t.Fatalf("want %q, got %q", want, lead.sends)
	}
	if strings.Contains(joined, "Not verified") || strings.Contains(joined, "finished without reporting a commit") {
		t.Fatalf("a None section and the no-commit line are not posted, got %q", lead.sends)
	}
	if n := strings.Count(joined, "t-0 merged"); n != 1 {
		t.Fatalf("want one merged line, got %d in %q", n, lead.sends)
	}
}

// a lane lands as one merge, and each task in it gets its lines; the lane's later task read the first's For later
// tasks at dispatch, so the section is nobody's to be told
func TestFastTrackLaneMergePostsTheLinesOfEveryTaskItLands(t *testing.T) {
	f, lead, _ := fastTrackMerge(t,
		[]waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second", Deps: []string{"t-0"}}},
		map[string]string{
			"t-0": structuredReport("Added fmtDate.", "Used time.Format.", "None", forLaterText, "None"),
			"t-1": structuredReport("Used fmtDate.", "None", "The CDP shot.", "None", "None"),
		})
	joined := wakeText(t, f.ctx, lead, f.channel, f.dag(t).RunID)
	for _, want := range []string{"t-0 merged", "t-1 merged", "t-0 Differs from plan: Used time.Format.", "t-1 Not verified: The CDP shot."} {
		if !strings.Contains(joined, want) {
			t.Fatalf("want %q, got %q", want, lead.sends)
		}
	}
	if strings.Contains(joined, forLaterText) {
		t.Fatalf("t-1 read t-0's For later tasks at dispatch, so the lead is not given it, got %q", lead.sends)
	}
}

func TestFastTrackMergeHandsForLaterToTheLeadOnlyWithNoTaskAfterIt(t *testing.T) {
	report := structuredReport("Added fmtDate.", "None", "None", forLaterText, "None")
	t.Run("no task after it", func(t *testing.T) {
		f, lead, _ := fastTrackMerge(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}}, map[string]string{"t-0": report})
		joined := wakeText(t, f.ctx, lead, f.channel, f.dag(t).RunID)
		if want := "t-0 For later tasks: " + forLaterText; !strings.Contains(joined, want) {
			t.Fatalf("want %q, got %q", want, lead.sends)
		}
	})
	t.Run("an unfinished task after it", func(t *testing.T) {
		f, lead, spawned := fastTrackMerge(t, []waveobj.TaskNode{
			{ID: "t-0", Label: "first"},
			// two dependents make t-0 a lane of its own, so it lands before either starts
			{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
			{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
		}, map[string]string{"t-0": report})
		joined := wakeText(t, f.ctx, lead, f.channel, f.dag(t).RunID)
		if strings.Contains(joined, forLaterText) {
			t.Fatalf("a later task reads the section at dispatch, so nobody is told it, got %q", lead.sends)
		}
		if len(*spawned) == 0 {
			t.Fatal("fixture: t-0's merge must dispatch its dependents")
		}
		for _, prompt := range *spawned {
			if !strings.Contains(prompt, "Its For later tasks: "+forLaterText) {
				t.Fatalf("a dependent's dispatch prompt must carry t-0's For later tasks, got:\n%s", prompt)
			}
		}
	})
}
