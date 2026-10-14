// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// resolverFixture is a done run whose base moved on with a change that conflicts with the run's own feature.txt, so
// its land starts a resolver, the spawn faked.
func resolverFixture(t *testing.T) (f *mergeFixture, tree string, calls *[]spawnCall, land *waveobj.RunLand) {
	t.Helper()
	f, tree = landFixture(t)
	calls = captureSpawns(t)
	commitOnBase(t, f.project, "feature.txt", "the base's own feature\n")
	land = f.landRun(t, false)
	if land == nil || land.State != LandState_Resolving {
		t.Fatalf("land = %+v, want resolving", land)
	}
	// the store outlives the test, and the driver tends every resolving land it finds
	t.Cleanup(func() { f.seedLand(t, f.ownerID, heldLand("the test is over")) })
	return f, tree, calls, land
}

// resolveInTree does what a resolver would: merge the base into the branch, settle file and commit the merge.
func resolveInTree(t *testing.T, tree, base, file, content string) {
	t.Helper()
	// the merge stops on the conflict, which is its exit status
	_ = exec.Command("git", "-C", tree, "merge", "--no-commit", "--no-ff", base).Run()
	if !mergeInProgress(tree) {
		t.Fatalf("merging %s into %s did not stop on a conflict", base, tree)
	}
	writeFile(t, filepath.Join(tree, file), content)
	gitCmd(t, tree, "add", "--", file)
	gitCmd(t, tree, "commit", "-m", "Merge branch '"+base+"'", "-m", "Arc-Run: resolver")
}

func (f *mergeFixture) setResolverStatus(t *testing.T, resolverID, status string) {
	t.Helper()
	if err := wstore.UpdateRun(f.ctx, f.channel, resolverID, func(r *waveobj.Run) error {
		r.Status = status
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// captureStops records the runs whose session the engine stops.
func captureStops(t *testing.T) *[]string {
	t.Helper()
	var stopped []string
	old := stopRunWorkers
	stopRunWorkers = func(_ context.Context, r *waveobj.Run) error {
		stopped = append(stopped, r.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = old })
	return &stopped
}

func TestLandConflictStartsAResolver(t *testing.T) {
	f, tree, calls, land := resolverFixture(t)
	run := f.owner(t)

	if len(*calls) != 1 {
		t.Fatalf("%d sessions spawned, want one resolver", len(*calls))
	}
	c := (*calls)[0]
	if c.cwd != tree || c.cwd != run.LandPath || c.opts.Label != "land resolver" || c.opts.TaskId != "" {
		t.Fatalf("spawned %+v, want the resolver in the landing tree %s", c, tree)
	}
	if !strings.HasPrefix(c.prompt, landResolverOpener+f.ownerID) || !strings.Contains(c.prompt, "feature.txt") {
		t.Fatalf("the prompt does not name the run and the conflicting file: %q", c.prompt)
	}
	if land.Resolver != c.opts.RunId || land.ResolverTs == 0 || !land.ResolverTried || land.QueuedTs == 0 || !slices.Equal(land.Conflicts, []string{"feature.txt"}) {
		t.Fatalf("land = %+v, want resolving with the resolver's run, its start, the conflicts and a place in line", land)
	}
	if !reflect.DeepEqual(run.Land, land) {
		t.Fatalf("stored land = %+v, want %+v", run.Land, land)
	}
	resolver, err := wstore.GetRun(f.ctx, f.channel, land.Resolver)
	if err != nil {
		t.Fatal(err)
	}
	if resolver.StageRole != jarvis.UsageRole_LandResolver || resolver.DagORef != f.dagID || resolver.TaskId != "" || resolver.ProjectPath != tree {
		t.Fatalf("resolver run = %+v, want a stage run of the dag, in the landing tree", resolver)
	}
	if resolver.BaseCommit != gitCmd(t, tree, "rev-parse", "HEAD") {
		t.Fatalf("resolver started from %q, want the landing tree's head", resolver.BaseCommit)
	}
	detail := firstEventDetail(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLandResolving)
	if detail["resolver"] != land.Resolver || fmt.Sprint(detail["files"]) != "[feature.txt]" {
		t.Fatalf("land-resolving detail = %v", detail)
	}
	if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLandHeld); n != 0 {
		t.Fatalf("%d land-held events, want none while a resolver works", n)
	}
	if mergeInProgress(tree) {
		t.Fatal("the landing tree was left mid-merge for the resolver to find")
	}
}

// a queued land that the driver finds in conflict goes on to its resolver with the place and the force it asked with
func TestResolvingLandKeepsItsPlaceAndForce(t *testing.T) {
	f, _ := landFixture(t)
	calls := captureSpawns(t)
	commitOnBase(t, f.project, "feature.txt", "the base's own feature\n")
	f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Queued, QueuedTs: 10, Force: true})
	t.Cleanup(func() { f.seedLand(t, f.ownerID, heldLand("the test is over")) })

	driveLandLine(f.ctx)
	waitStages(t)
	got := f.landOf(t, f.ownerID)
	if got.State != LandState_Resolving || got.QueuedTs != 10 || !got.Force || !got.ResolverTried || len(*calls) != 1 {
		t.Fatalf("land = %+v after %d spawns, want resolving at place 10 with its force", got, len(*calls))
	}
	if tryTakeTurn(f.projectPath(t), "someone-else") {
		releaseTurn(f.projectPath(t), "someone-else")
	} else {
		t.Fatal("the resolving land kept the project's turn")
	}
}

func TestLandConflictHoldsWhenNoResolverCanTry(t *testing.T) {
	t.Run("one already tried", func(t *testing.T) {
		f, _ := landFixture(t)
		calls := captureSpawns(t)
		commitOnBase(t, f.project, "feature.txt", "the base's own feature\n")
		f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Held, ResolverTried: true})
		head := gitCmd(t, f.project, "rev-parse", "main")

		land := f.landRun(t, false)
		f.assertHeld(t, land, head, "feature.txt")
		if !strings.HasSuffix(land.Reason, "; a resolver already tried") || !land.ResolverTried || !slices.Equal(land.Conflicts, []string{"feature.txt"}) {
			t.Fatalf("land = %+v, want the conflict held for a human, a resolver having tried", land)
		}
		if len(*calls) != 0 {
			t.Fatalf("%d sessions spawned, want none: one resolver per land", len(*calls))
		}
	})
	t.Run("a run with no dag", func(t *testing.T) {
		f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
		calls := captureSpawns(t)
		commitProjectFiles(t, f.project, map[string]string{"notes.md": "one\ntwo\nthree\n"})
		a := f.addLandRunWriting(t, "notes.md", "one\na two\nthree\n")
		b := f.addLandRunWriting(t, "notes.md", "one\nb two\nthree\n")
		if land := f.landRunByID(t, a); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", land)
		}
		land := f.landRunByID(t, b)
		if land.State != LandState_Held || land.ResolverTried || !strings.Contains(land.Reason, "notes.md") {
			t.Fatalf("land = %+v, want held on notes.md", land)
		}
		if len(*calls) != 0 {
			t.Fatalf("%d sessions spawned, want none: a resolver is a stage session of a dag", len(*calls))
		}
	})
	t.Run("the resolver could not start", func(t *testing.T) {
		f, _ := landFixture(t)
		allowWorkerHarnessForTest(t)
		old := spawnWorker
		spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
			return "", errors.New("no terminal")
		}
		restoreAfterStages(t, func() { spawnWorker = old })
		commitOnBase(t, f.project, "feature.txt", "the base's own feature\n")
		head := gitCmd(t, f.project, "rev-parse", "main")

		land := f.landRun(t, false)
		f.assertHeld(t, land, head, "feature.txt")
		if !strings.HasSuffix(land.Reason, "; the resolver could not start: no terminal") || land.ResolverTried {
			t.Fatalf("land = %+v, want held, the resolver not started and not counted as tried", land)
		}
	})
}

func TestResolvedLandGoesBackInLine(t *testing.T) {
	cases := []struct {
		name        string
		baseMovesOn bool
	}{{"the base is in the branch", false}, {"the base moved on while the resolver worked", true}}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, tree, _, land := resolverFixture(t)
			resolveInTree(t, tree, "main", "feature.txt", "both sides' feature\n")
			if c.baseMovesOn {
				commitOnBase(t, f.project, "later.txt", "another run landed\n")
			}
			f.setResolverStatus(t, land.Resolver, jarvis.RunStatus_Done)

			// someone else is in their turn, so the land shows as queued before it lands
			if !tryTakeTurn(f.projectPath(t), "someone-else") {
				t.Fatal("the turn was not free")
			}
			driveLandLine(f.ctx)
			waitStages(t)
			got := f.landOf(t, f.ownerID)
			if got.State != LandState_Queued || got.QueuedTs != land.QueuedTs || !got.ResolverTried {
				t.Fatalf("land = %+v, want queued again at its first place, a resolver having tried", got)
			}
			releaseTurn(f.projectPath(t), "someone-else")
			f.driveLandLineUntil(t, f.ownerID)

			if got := f.landOf(t, f.ownerID); got.State != LandState_Landed {
				t.Fatalf("land = %+v, want landed in its turn", got)
			}
			if landed := landedOrder(t, f.project); !slices.Equal(landed, []string{f.ownerID}) {
				t.Fatalf("first-parent merges = %v, want the run's", landed)
			}
			if got := strings.ReplaceAll(readFile(t, filepath.Join(f.project, "feature.txt")), "\r\n", "\n"); got != "both sides' feature\n" {
				t.Fatalf("feature.txt on main = %q, want the resolver's", got)
			}
		})
	}
}

func TestResolverThatMergedNothingHoldsTheLand(t *testing.T) {
	f, tree, _, land := resolverFixture(t)
	head := gitCmd(t, tree, "rev-parse", "HEAD")
	f.setResolverStatus(t, land.Resolver, jarvis.RunStatus_Done)

	driveLandLine(f.ctx)
	waitStages(t)
	got := f.landOf(t, f.ownerID)
	if got.State != LandState_Held || !strings.Contains(got.Reason, "the resolver ended without merging main") || !strings.Contains(got.Reason, "see its report") {
		t.Fatalf("land = %+v, want held: the resolver ended without merging main", got)
	}
	if !got.ResolverTried || !slices.Equal(got.Conflicts, []string{"feature.txt"}) {
		t.Fatalf("land = %+v, want the resolver and the conflicts kept on the hold", got)
	}
	if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLandHeld); n != 1 {
		t.Fatalf("%d land-held events, want 1", n)
	}
	if gitCmd(t, tree, "rev-parse", "HEAD") != head {
		t.Fatal("the engine moved the landing tree")
	}
	// a held land is the human's: the driver leaves it be on a later pass
	driveLandLine(f.ctx)
	waitStages(t)
	if after := f.landOf(t, f.ownerID); !reflect.DeepEqual(after, got) {
		t.Fatalf("land = %+v after a second drive, want %+v", after, got)
	}
}

func TestLostResolverHoldsTheLandAndIsStopped(t *testing.T) {
	cases := []struct {
		name string
		lose func(t *testing.T, f *mergeFixture, land *waveobj.RunLand)
		want string
	}{
		{"cancelled", func(t *testing.T, f *mergeFixture, land *waveobj.RunLand) {
			endRun(t, f.ctx, f.channel, land.Resolver)
		}, "and the resolver ended without finishing; merge it there, then Land again"},
		{"blocked", func(t *testing.T, f *mergeFixture, land *waveobj.RunLand) {
			f.setResolverStatus(t, land.Resolver, jarvis.RunStatus_Blocked)
		}, "and the resolver ended without finishing; merge it there, then Land again"},
		{"timed out", func(t *testing.T, f *mergeFixture, land *waveobj.RunLand) {
			aged := *land
			aged.ResolverTs -= ReviewTimeout.Milliseconds() + 1
			f.seedLand(t, f.ownerID, &aged)
		}, "and the resolver did not finish within " + ReviewTimeout.String() + "; merge it there, then Land again"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, _, _, land := resolverFixture(t)
			stopped := captureStops(t)
			c.lose(t, f, land)

			driveLandLine(f.ctx)
			waitStages(t)
			got := f.landOf(t, f.ownerID)
			want := fmt.Sprintf("merging main into wave/%s conflicts in feature.txt, %s", f.ownerID, c.want)
			if got.State != LandState_Held || got.Reason != want {
				t.Fatalf("land = %+v, want held with %q", got, want)
			}
			if !got.ResolverTried || !slices.Equal(got.Conflicts, []string{"feature.txt"}) {
				t.Fatalf("land = %+v, want the resolver and the conflicts kept on the hold", got)
			}
			if !slices.Equal(*stopped, []string{land.Resolver}) {
				t.Fatalf("stopped sessions = %v, want the resolver %s", *stopped, land.Resolver)
			}
			if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLandHeld); n != 1 {
				t.Fatalf("%d land-held events, want 1", n)
			}
		})
	}
}

// a resolver at work is left alone, and its land gives up the turn: the next land of the project goes meanwhile
func TestResolvingLandWaitsAndDoesNotHoldTheTurn(t *testing.T) {
	f, _, calls, land := resolverFixture(t)
	stopped := captureStops(t)
	second := f.addLandRun(t, "second.txt")

	driveLandLine(f.ctx)
	waitStages(t)
	if got := f.landOf(t, f.ownerID); !reflect.DeepEqual(got, land) {
		t.Fatalf("land = %+v after a drive, want a working resolver's land left as it was, %+v", got, land)
	}
	if got := f.landRunByID(t, second); got.State != LandState_Landed {
		t.Fatalf("second land = %+v, want landed while the first is being resolved", got)
	}
	// asked again, a land being resolved answers as it is: its resolver is mid-merge in the tree
	if got := f.landRun(t, false); got.State != LandState_Resolving || got.Resolver != land.Resolver {
		t.Fatalf("land asked again = %+v, want the resolving land as it was", got)
	}
	if len(*calls) != 1 || len(*stopped) != 0 {
		t.Fatalf("%d sessions spawned and %d stopped, want one and none", len(*calls), len(*stopped))
	}
}

func TestLandLineLeavesAFixtureResolvingLandAlone(t *testing.T) {
	f, _ := landFixture(t)
	stopped := captureStops(t)
	// started long ago and with no run behind it: a land the driver tended would be held as lost
	fixture := &waveobj.RunLand{State: LandState_Resolving, Resolver: "no-such-run", ResolverTs: 1, ResolverTried: true, Fixture: true}
	f.seedLand(t, f.ownerID, fixture)
	t.Cleanup(func() { f.seedLand(t, f.ownerID, heldLand("the test is over")) })

	for range 2 {
		driveLandLine(f.ctx)
		waitStages(t)
		if got := f.landOf(t, f.ownerID); fmt.Sprintf("%+v", got) != fmt.Sprintf("%+v", fixture) {
			t.Fatalf("fixture land = %+v after a drive, want it unchanged %+v", got, fixture)
		}
	}
	if len(*stopped) != 0 {
		t.Fatalf("stopped %v, want no session touched", *stopped)
	}
}

func TestLandResolverPromptBrief(t *testing.T) {
	run := &waveobj.Run{ID: originRun, BaseBranch: "main", LandPath: "/trees/run", DagORef: "dag-1"}
	prompt := landResolverPrompt(run, []string{"CHANGELOG.md", "pkg/a.go"})
	for _, want := range []string{
		landResolverOpener + originRun,
		"/trees/run",
		"wave/" + originRun,
		"`git merge main`",
		"CHANGELOG.md, pkg/a.go",
		"git merge-base HEAD main",
		unionMergeFile,
		"Arc-Run: " + originRun,
		"`git merge --abort`",
		"wsh jarvis complete --report",
		"never a whole package",
		"Do not push",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the prompt lacks %q:\n%s", want, prompt)
		}
	}
}
