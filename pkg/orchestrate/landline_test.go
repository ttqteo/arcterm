// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// addLandRun gives f's project another done run on its own branch, wave/<id>, that adds file. It has no dag, so
// its land has no Check or Verify to re-run.
func (f *mergeFixture) addLandRun(t *testing.T, file string) string {
	t.Helper()
	run := jarvis.NewRun("add "+file, "ws-1", f.projectPath(t), nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(f.ctx, f.channel, run); err != nil {
		t.Fatal(err)
	}
	base := gitCmd(t, f.project, "rev-parse", "main")
	tree, err := CreateRunWorktree(f.ctx, f.project, run.ID, base)
	if err != nil {
		t.Fatal(err)
	}
	commitOnBranch(t, tree, file, file+"\n")
	if err := wstore.UpdateRun(f.ctx, f.channel, run.ID, func(r *waveobj.Run) error {
		r.LandPath, r.BaseBranch, r.BaseCommit, r.Status = tree, "main", base, jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return run.ID
}

func (f *mergeFixture) landOf(t *testing.T, runID string) *waveobj.RunLand {
	t.Helper()
	run, err := wstore.GetRun(f.ctx, f.channel, runID)
	if err != nil {
		t.Fatal(err)
	}
	return run.Land
}

func (f *mergeFixture) seedLand(t *testing.T, runID string, land *waveobj.RunLand) {
	t.Helper()
	if err := saveLand(f.ctx, f.channel, runID, land); err != nil {
		t.Fatal(err)
	}
}

// driveLandLineUntil drives the line until none of ids is queued or pending, then waits for the lands it started.
func (f *mergeFixture) driveLandLineUntil(t *testing.T, ids ...string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		driveLandLine(f.ctx)
		waiting := false
		for _, id := range ids {
			if land := f.landOf(t, id); land == nil || land.State == LandState_Queued || land.State == LandState_Pending {
				waiting = true
			}
		}
		if !waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("lands still waiting after 30s: %v", ids)
		}
		time.Sleep(20 * time.Millisecond)
	}
	waitStages(t)
}

// landedOrder is the runs the checkout's first-parent merges landed, oldest first.
func landedOrder(t *testing.T, project string) []string {
	t.Helper()
	var ids []string
	for line := range strings.SplitSeq(gitCmd(t, project, "log", "--first-parent", "--reverse", "--merges", "--format=%B"), "\n") {
		if id, ok := strings.CutPrefix(strings.TrimSpace(line), "Arc-Run: "); ok {
			ids = append(ids, id)
		}
	}
	return ids
}

func TestLandLineThreeAtOnce(t *testing.T) {
	asked := func(t *testing.T, f *mergeFixture, files []string) (ids []string, lands []*waveobj.RunLand) {
		t.Helper()
		for _, file := range files {
			ids = append(ids, f.addLandRun(t, file))
		}
		lands = make([]*waveobj.RunLand, len(ids))
		var wg sync.WaitGroup
		for i, id := range ids {
			wg.Go(func() {
				land, err := LandRun(f.ctx, f.channel, id, false)
				if err != nil {
					t.Error(err)
				}
				lands[i] = land
			})
		}
		wg.Wait()
		return ids, lands
	}
	files := []string{"a.txt", "b.txt", "c.txt"}
	newProject := func(t *testing.T) *mergeFixture {
		return newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	}
	check := func(t *testing.T, f *mergeFixture, ids []string) {
		t.Helper()
		for _, id := range ids {
			if land := f.landOf(t, id); land == nil || land.State != LandState_Landed {
				t.Fatalf("run %s land = %+v, want landed", id, land)
			}
		}
		if got := landedOrder(t, f.project); len(got) != 3 || !slices.Equal(slices.Sorted(slices.Values(got)), slices.Sorted(slices.Values(ids))) {
			t.Fatalf("first-parent merges = %v, want one for each of %v", got, ids)
		}
		for _, file := range files {
			if got := gitCmd(t, f.project, "ls-files", "--", file); got != file {
				t.Fatalf("%s is not on main after the lands", file)
			}
		}
	}

	t.Run("the line is free", func(t *testing.T) {
		f := newProject(t)
		ids, _ := asked(t, f, files)
		f.driveLandLineUntil(t, ids...)
		check(t, f, ids)
	})
	t.Run("the line is busy, so all three queue and land in the order they asked", func(t *testing.T) {
		f := newProject(t)
		if !tryTakeTurn(f.projectPath(t), "someone-else") {
			t.Fatal("the turn was not free")
		}
		ids, lands := asked(t, f, files)
		for i, land := range lands {
			if land == nil || land.State != LandState_Queued || land.QueuedTs == 0 {
				t.Fatalf("run %s land = %+v, want queued", ids[i], land)
			}
			if stored := f.landOf(t, ids[i]); stored.State != LandState_Queued {
				t.Fatalf("run %s stored land = %+v, want queued", ids[i], stored)
			}
			if n := countEvents(t, f.ctx, f.channel, ids[i], waveobj.RunEventKindLandQueued); n != 1 {
				t.Fatalf("run %s has %d land-queued events, want 1", ids[i], n)
			}
		}
		inLine := slices.Clone(ids)
		slices.SortFunc(inLine, func(a, b string) int {
			if d := f.landOf(t, a).QueuedTs - f.landOf(t, b).QueuedTs; d != 0 {
				return int(d)
			}
			return strings.Compare(a, b)
		})
		// the line does not move while someone else is in their turn
		driveLandLine(f.ctx)
		waitStages(t)
		for _, id := range ids {
			if land := f.landOf(t, id); land.State != LandState_Queued {
				t.Fatalf("run %s land = %+v, want it still queued", id, land)
			}
		}
		releaseTurn(f.projectPath(t), "someone-else")
		f.driveLandLineUntil(t, ids...)
		check(t, f, ids)
		if got := landedOrder(t, f.project); !slices.Equal(got, inLine) {
			t.Fatalf("landed %v, want the order they asked in, %v", got, inLine)
		}
	})
}

func TestLandRunQueuesBehindOlder(t *testing.T) {
	f, _ := landFixture(t)
	second := f.addLandRun(t, "second.txt")
	f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Queued, QueuedTs: 10})

	land, err := LandRun(f.ctx, f.channel, second, false)
	if err != nil {
		t.Fatal(err)
	}
	if land == nil || land.State != LandState_Queued || land.QueuedTs == 0 {
		t.Fatalf("land = %+v, want queued behind the older one though the turn is free", land)
	}
	f.driveLandLineUntil(t, f.ownerID, second)
	if got, want := landedOrder(t, f.project), []string{f.ownerID, second}; !slices.Equal(got, want) {
		t.Fatalf("landed %v, want the older one first, %v", got, want)
	}
}

func TestLandRunTakesTheTurnWhenItIsTheOldestQueued(t *testing.T) {
	f, _ := landFixture(t)
	f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Queued, QueuedTs: 10})
	if land := f.landRun(t, false); land.State != LandState_Landed {
		t.Fatalf("land = %+v, want the oldest queued land to land when asked again", land)
	}
}

func TestClaimBusyRequeues(t *testing.T) {
	t.Run("a land keeps its place", func(t *testing.T) {
		f, _ := landFixture(t)
		claim, err := claimProject(f.projectPath(t), "other-dag", "t-0")
		if err != nil {
			t.Fatal(err)
		}
		f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Queued, QueuedTs: 10})

		land := f.landRun(t, false)
		if land.State != LandState_Queued || land.QueuedTs != 10 {
			t.Fatalf("land = %+v, want queued with its first QueuedTs", land)
		}
		driveLandLine(f.ctx)
		waitStages(t)
		if got := f.landOf(t, f.ownerID); got.State != LandState_Queued || got.QueuedTs != 10 {
			t.Fatalf("land = %+v after a drive, want it still queued at its place", got)
		}
		if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLandHeld); n != 0 {
			t.Fatalf("%d land-held events, want none: a busy checkout only makes it wait", n)
		}

		releaseProject(f.projectPath(t), claim)
		f.driveLandLineUntil(t, f.ownerID)
		if got := f.landOf(t, f.ownerID); got.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed once the claim is released", got)
		}
	})
	t.Run("a land that asked now is stamped now", func(t *testing.T) {
		f, _ := landFixture(t)
		claim, err := claimProject(f.projectPath(t), "other-dag", "t-0")
		if err != nil {
			t.Fatal(err)
		}
		defer releaseProject(f.projectPath(t), claim)
		if land := f.landRun(t, false); land.State != LandState_Queued || land.QueuedTs == 0 {
			t.Fatalf("land = %+v, want queued and stamped", land)
		}
	})
}

func TestDirtyRetryQueues(t *testing.T) {
	cases := []struct {
		name  string
		force bool
	}{{"a dirty hold", false}, {"a forced dirty hold keeps its force", true}}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, _ := landFixture(t)
			if c.force {
				f.setFinal(t, &waveobj.FinalStage{State: FinalState_Failed, Round: 2, Detail: "Check failed"})
			}
			writeFile(t, filepath.Join(f.project, "other.txt"), "another session's work\n")
			gitCmd(t, f.project, "add", "other.txt")
			if land := f.landRun(t, c.force); land.State != LandState_Held || !land.Dirty {
				t.Fatalf("land = %+v, want a dirty hold", land)
			}
			gitCmd(t, f.project, "commit", "-m", "another session's work")

			// someone else's turn, so the retry shows as queued before the driver lands it
			if !tryTakeTurn(f.projectPath(t), "someone-else") {
				t.Fatal("the turn was not free")
			}
			retryDirtyLands(f.ctx)
			waitStages(t)
			land := f.landOf(t, f.ownerID)
			if land.State != LandState_Queued || land.QueuedTs == 0 || land.Dirty || land.Force != c.force {
				t.Fatalf("land = %+v, want queued, stamped, no longer dirty, force %v", land, c.force)
			}
			releaseTurn(f.projectPath(t), "someone-else")
			f.driveLandLineUntil(t, f.ownerID)
			if got := f.landOf(t, f.ownerID); got.State != LandState_Landed {
				t.Fatalf("land = %+v, want landed", got)
			}
		})
	}
}

func TestLandLineRequeuesAPendingLandAfterARestart(t *testing.T) {
	f, _ := landFixture(t)
	landLineBoot = sync.Once{}
	f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Pending, Force: true, ResolverTried: true})
	if !tryTakeTurn(f.projectPath(t), "someone-else") {
		t.Fatal("the turn was not free")
	}

	driveLandLine(f.ctx)
	waitStages(t)
	land := f.landOf(t, f.ownerID)
	if land.State != LandState_Queued || land.QueuedTs == 0 || !land.Force || !land.ResolverTried {
		t.Fatalf("land = %+v, want queued again with its force and resolver flags", land)
	}

	// only the first pass looks for them: a later pending land is a land under way
	f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Pending})
	driveLandLine(f.ctx)
	waitStages(t)
	if got := f.landOf(t, f.ownerID); got.State != LandState_Pending {
		t.Fatalf("land = %+v, want a pending land left alone after the first pass", got)
	}

	f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Queued, QueuedTs: 5})
	releaseTurn(f.projectPath(t), "someone-else")
	f.driveLandLineUntil(t, f.ownerID)
}

func TestLandLineSkipsFixture(t *testing.T) {
	f, _ := landFixture(t)
	queued := f.addLandRun(t, "queued.txt")
	pending := f.addLandRun(t, "pending.txt")
	live := f.addLandRun(t, "live.txt")
	fixtureQueued := &waveobj.RunLand{State: LandState_Queued, QueuedTs: 1, Fixture: true}
	fixturePending := &waveobj.RunLand{State: LandState_Pending, Fixture: true}
	f.seedLand(t, queued, fixtureQueued)
	f.seedLand(t, pending, fixturePending)

	landLineBoot = sync.Once{}
	driveLandLine(f.ctx)
	waitStages(t)
	for id, want := range map[string]*waveobj.RunLand{queued: fixtureQueued, pending: fixturePending} {
		if got := f.landOf(t, id); fmt.Sprintf("%+v", got) != fmt.Sprintf("%+v", want) {
			t.Fatalf("fixture land = %+v after a drive, want it unchanged %+v", got, want)
		}
	}
	driveLandLine(f.ctx) // and not on a later pass either
	waitStages(t)
	if got := f.landOf(t, queued); got.State != LandState_Queued || !got.Fixture {
		t.Fatalf("fixture land = %+v after a second drive, want it unchanged", got)
	}

	// a fixture older than a real land does not hold it back
	if land, err := LandRun(f.ctx, f.channel, live, false); err != nil || land.State != LandState_Landed {
		t.Fatalf("land = %+v, %v, want landed past an older fixture", land, err)
	}
}

func TestLandPlace(t *testing.T) {
	run := func(id, project, state string, ts int64) *waveobj.Run {
		r := &waveobj.Run{ID: id, ProjectPath: project}
		if state != "" {
			r.Land = &waveobj.RunLand{State: state, QueuedTs: ts}
		}
		return r
	}
	inTurn := run("r-turn", "/p", LandState_Pending, 0)
	first := run("r-first", "/p", LandState_Queued, 10)
	second := run("r-second", "/p", LandState_Queued, 20)
	other := run("r-other", "/q", LandState_Queued, 5)
	held := run("r-held", "/p", LandState_Held, 0)
	runs := []*waveobj.Run{second, other, held, first, inTurn, run("r-none", "/p", "", 0)}

	cases := []struct {
		id    string
		place int
		ahead *waveobj.Run
	}{
		{"r-turn", 0, nil},
		{"r-first", 2, inTurn},
		{"r-second", 3, first},
		{"r-other", 1, nil},
		{"r-held", 0, nil},
		{"r-none", 0, nil},
		{"missing", 0, nil},
	}
	for _, c := range cases {
		t.Run(c.id, func(t *testing.T) {
			place, ahead := LandPlace(runs, c.id)
			if place != c.place || ahead != c.ahead {
				t.Fatalf("LandPlace(%s) = %d, %v, want %d, %v", c.id, place, ahead, c.place, c.ahead)
			}
		})
	}
	t.Run("the first queued land is first when no land is in its turn", func(t *testing.T) {
		if place, ahead := LandPlace([]*waveobj.Run{second, first}, "r-first"); place != 1 || ahead != nil {
			t.Fatalf("LandPlace = %d, %v, want 1, nil", place, ahead)
		}
	})
	t.Run("equal times fall back to the run id", func(t *testing.T) {
		a, b := run("a", "/p", LandState_Queued, 7), run("b", "/p", LandState_Queued, 7)
		if place, ahead := LandPlace([]*waveobj.Run{b, a}, "b"); place != 2 || ahead != a {
			t.Fatalf("LandPlace = %d, %v, want 2 behind a", place, ahead)
		}
	})
	t.Run("a project path is compared cleaned", func(t *testing.T) {
		a, b := run("a", "/p/x/..", LandState_Queued, 1), run("b", "/p", LandState_Queued, 2)
		if place, _ := LandPlace([]*waveobj.Run{a, b}, "b"); place != 2 {
			t.Fatalf("LandPlace = %d, want 2: both are the same checkout", place)
		}
	})
}
