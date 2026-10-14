// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// landFixture is a done, branch-landed run on main whose branch added feature.txt, and whose final stage
// passed on the branch's head. Its checkout is clean.
func landFixture(t *testing.T) (*mergeFixture, string) {
	t.Helper()
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	base := gitCmd(t, f.project, "rev-parse", "HEAD")
	tree := f.land(t)
	writeFile(t, filepath.Join(tree, "feature.txt"), "feature\n")
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "feat(coupons): add feature")
	head := gitCmd(t, tree, "rev-parse", "HEAD")
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.BaseBranch, r.BaseCommit, r.Status = "main", base, jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	f.setFinal(t, &waveobj.FinalStage{State: FinalState_Passed, Round: 1, Commit: head})
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Title = "Coupon codes"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return f, tree
}

// markResolverTried marks the run's land as one a resolver already tried, so a conflict holds for a human instead of
// starting another session.
func (f *mergeFixture) markResolverTried(t *testing.T) {
	t.Helper()
	f.seedLand(t, f.ownerID, &waveobj.RunLand{State: LandState_Held, ResolverTried: true})
}

func (f *mergeFixture) setFinal(t *testing.T, final *waveobj.FinalStage) {
	t.Helper()
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Final = final
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// commitOnBranch commits file on the run's branch, as a lane or the lead's wrap-up would.
func commitOnBranch(t *testing.T, tree, file, content string) {
	t.Helper()
	writeFile(t, filepath.Join(tree, file), content)
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "change "+file)
}

func (f *mergeFixture) landRun(t *testing.T, force bool) *waveobj.RunLand {
	t.Helper()
	land, err := LandRun(f.ctx, f.channel, f.ownerID, force)
	if err != nil {
		t.Fatal(err)
	}
	return land
}

// landRunByID lands another run of the fixture's project, as a human's `wsh runs land` would.
func (f *mergeFixture) landRunByID(t *testing.T, id string) *waveobj.RunLand {
	t.Helper()
	land, err := LandRun(f.ctx, f.channel, id, false)
	if err != nil {
		t.Fatal(err)
	}
	return land
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func branchExists(dir, branch string) bool {
	return exec.Command("git", "-C", dir, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch).Run() == nil
}

// assertHeld checks a held land's reason, that it is stored on the run with a land-held event, and that the
// checkout's branch did not move.
func (f *mergeFixture) assertHeld(t *testing.T, land *waveobj.RunLand, head, want string) {
	t.Helper()
	if land == nil || land.State != LandState_Held || !strings.Contains(land.Reason, want) {
		t.Fatalf("land = %+v, want held with %q", land, want)
	}
	if got := f.owner(t).Land; !reflect.DeepEqual(got, land) {
		t.Fatalf("stored land = %+v, want %+v", got, land)
	}
	if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLandHeld); n != 1 {
		t.Fatalf("%d land-held events, want 1", n)
	}
	if got := gitCmd(t, f.project, "rev-parse", "main"); got != head {
		t.Fatalf("main moved from %s to %s", head, got)
	}
	if !branchExists(f.project, "wave/"+f.ownerID) {
		t.Fatal("a held land deleted the run's branch")
	}
}

func TestLandMergesTheBranchIntoACleanCheckout(t *testing.T) {
	f, tree := landFixture(t)
	land := f.landRun(t, false)

	if land == nil || land.State != LandState_Landed || land.Reason != "" || len(land.Notes) != 0 {
		t.Fatalf("land = %+v, want landed with no notes", land)
	}
	head := gitCmd(t, f.project, "rev-parse", "HEAD")
	if land.Commit != head {
		t.Fatalf("land commit %s, want the checkout's new head %s", land.Commit, head)
	}
	if parents := strings.Fields(gitCmd(t, f.project, "log", "-1", "--format=%P")); len(parents) != 2 {
		t.Fatalf("head has parents %v, want a --no-ff merge", parents)
	}
	msg := gitCmd(t, f.project, "log", "-1", "--format=%B")
	if !strings.HasPrefix(msg, "feat(coupons): Coupon codes\n") || !strings.Contains(msg, "Arc-Run: "+f.ownerID) {
		t.Fatalf("merge message %q, want the plan title typed from the branch and the Arc-Run line", msg)
	}
	// core.autocrlf may check it out with CRLF
	if got := strings.ReplaceAll(readFile(t, filepath.Join(f.project, "feature.txt")), "\r\n", "\n"); got != "feature\n" {
		t.Fatalf("feature.txt = %q after the land", got)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("the landing tree is still there: %v", err)
	}
	if branchExists(f.project, "wave/"+f.ownerID) {
		t.Fatal("the run's branch was not deleted")
	}
	if got := f.owner(t).Land; !reflect.DeepEqual(got, land) {
		t.Fatalf("stored land = %+v, want %+v", got, land)
	}
	// a second call finds it landed and does nothing
	if again := f.landRun(t, false); !reflect.DeepEqual(again, land) {
		t.Fatalf("second land = %+v, want the first %+v", again, land)
	}
	if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLanded); n != 1 {
		t.Fatalf("%d landed events, want 1", n)
	}
}

// the land runs while the lead is still finishing in its landing tree, so the first removal fails; four runs left
// an empty directory under .waveterm/worktrees this way
func TestLandRemovesALandingTreeItsLeadHeldOnceItLetsGo(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("only Windows refuses to delete a directory holding an open file")
	}
	every, attempts := landTreeRetryEvery, landTreeRetryAttempts
	landTreeRetryEvery, landTreeRetryAttempts = 20*time.Millisecond, 500
	restoreAfterStages(t, func() { landTreeRetryEvery, landTreeRetryAttempts = every, attempts })
	f, tree := landFixture(t)
	held, err := os.Open(filepath.Join(tree, "feature.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if land := f.landRun(t, false); land.State != LandState_Landed {
		held.Close()
		t.Fatalf("land = %+v, want landed", land)
	}
	if _, err := os.Stat(tree); err != nil {
		held.Close()
		t.Fatalf("the held tree must survive the land's own removal: %v", err)
	}
	held.Close()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if _, err := os.Stat(tree); os.IsNotExist(err) {
			return
		}
	}
	t.Fatalf("the landing tree %s is still there after its lead let go", tree)
}

func TestLandTitleNamesTheChangeOnOneLine(t *testing.T) {
	// a subject git log --oneline shows whole
	const subjectLen = 72
	long := strings.Repeat("fix the orchestrator findings ", 40)
	goal2993 := `Close the last open orchestrator gaps in C:\Users\cktra\Projects\waveterm\docs\orchestrator-findings-2026-09-25.md and C:\Users\cktra\Projects\waveterm\docs\orchestrator-redesign-flaws.md. 1. Finding 22 known gap: a worker resuming after a long ask`
	cases := []struct {
		name, title, goal, want string
	}{
		{"the plan's title", "Coupon codes", "a goal", "chore: Coupon codes"},
		{"the template's suffix dropped", "Orchestrator small findings Implementation Plan", "", "chore: Orchestrator small findings"},
		{"a title that is only the suffix", " Implementation Plan", "Add coupons\nmore", "chore: Implementation Plan"},
		{"the goal's first line with no title", "", "Add coupons\nand more", "chore: Add coupons"},
		{"run 2993e463's goal is cut before the path", "", goal2993, "chore: Close the last open orchestrator gaps in…"},
		{"an absolute path becomes its base name", "", `Fix the land title in C:\x\pkg\orchestrate\land.go`, "chore: Fix the land title in land.go"},
		{"a unix path becomes its base name", "", "Fix /home/u/src/land.go, then ship", "chore: Fix land.go, then ship"},
		{"the first sentence only", "", "Fix it. Then more", "chore: Fix it"},
		{"a question keeps its mark", "", "Why does it hang? Find out", "chore: Why does it hang?"},
		{"a long goal is cut at a word", "", long, "chore: fix the orchestrator findings fix the orchestrator findings fix…"},
		{"a long title is cut at a word", long, "", "chore: fix the orchestrator findings fix the orchestrator findings fix…"},
		{"one long token is clipped", "", strings.Repeat("x", 100), "chore: " + strings.Repeat("x", 64) + "…"},
		{"a conventional title is kept", "fix(land): type the merge", "", "fix(land): type the merge"},
		{"nothing to go on", "", "", "chore: Land run r-1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := landTitle(&waveobj.Run{ID: "r-1", Goal: c.goal}, &waveobj.TaskGroup{Title: c.title}, nil)
			if got != c.want {
				t.Fatalf("landTitle = %q, want %q", got, c.want)
			}
			if n := len([]rune(got)); n > subjectLen {
				t.Fatalf("landTitle is %d runes, over %d", n, subjectLen)
			}
		})
	}
}

// a land is typed by the most telling change on its branch: run 1062afff's feat(agents) lanes, with a
// fix(jarvis) and the docs snapshot beside them, landed as a bare "Shell Task Standing-By"
func TestConventionalPrefixTypesTheBranch(t *testing.T) {
	cases := []struct {
		name     string
		subjects []string
		want     string
	}{
		{"a feature outranks its fixes and docs", []string{"docs: spec and plan for X", "feat(agents): a", "fix(jarvis): b", "feat(agents): c", "test(agents): d"}, "feat(agents): "},
		{"the scope its type uses most", []string{"fix(ui): a", "fix(land): b", "fix(land): c"}, "fix(land): "},
		{"a scope tie names none", []string{"feat(schema): a", "feat(ui): b"}, "feat: "},
		{"unscoped commits name no scope", []string{"fix: a", "docs(x): b"}, "fix: "},
		{"a breaking mark still types it", []string{"refactor(api)!: a"}, "refactor(api): "},
		{"no conventional subject", []string{"add feature", "Merge branch 'main'", "WIP: x"}, "chore: "},
		{"no subjects", nil, "chore: "},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := conventionalPrefix(c.subjects); got != c.want {
				t.Fatalf("conventionalPrefix = %q, want %q", got, c.want)
			}
		})
	}
}

func TestLandHoldsWhatItCannotMergeSafely(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, f *mergeFixture, tree string)
		want  string
	}{
		{"checkout on another branch", func(t *testing.T, f *mergeFixture, _ string) {
			gitCmd(t, f.project, "checkout", "-b", "x")
		}, "checkout is on x, not main"},
		{"staged change", func(t *testing.T, f *mergeFixture, _ string) {
			writeFile(t, filepath.Join(f.project, "base.txt"), "staged\n")
			gitCmd(t, f.project, "add", "base.txt")
		}, "staged"},
		{"merge in progress", func(t *testing.T, f *mergeFixture, _ string) {
			sha := gitCmd(t, f.project, "rev-parse", "HEAD")
			writeFile(t, filepath.Join(f.project, ".git", "MERGE_HEAD"), sha+"\n")
		}, "a merge is in progress"},
		{"rebase in progress", func(t *testing.T, f *mergeFixture, _ string) {
			if err := os.MkdirAll(filepath.Join(f.project, ".git", "rebase-merge"), 0o755); err != nil {
				t.Fatal(err)
			}
		}, "a rebase is in progress"},
		{"final stage failed", func(t *testing.T, f *mergeFixture, _ string) {
			f.setFinal(t, &waveobj.FinalStage{State: FinalState_Failed, Round: 2, Detail: "Check failed"})
		}, "the final stage failed"},
		{"final stage not finished", func(t *testing.T, f *mergeFixture, _ string) {
			f.setFinal(t, &waveobj.FinalStage{State: FinalState_Verifying, Round: 1})
		}, "the final stage has not finished"},
		{"detached base", func(t *testing.T, f *mergeFixture, _ string) {
			if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
				r.BaseBranch = ""
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		}, "the run started on a detached HEAD"},
		{"untracked file that differs from the branch's", func(t *testing.T, f *mergeFixture, _ string) {
			writeFile(t, filepath.Join(f.project, "feature.txt"), "mine\n")
		}, "an untracked feature.txt in the checkout differs"},
		{"conflict", func(t *testing.T, f *mergeFixture, tree string) {
			f.markResolverTried(t)
			commitOnBranch(t, tree, "base.txt", "branch\n")
			f.setFinal(t, &waveobj.FinalStage{State: FinalState_Passed, Round: 1, Commit: gitCmd(t, tree, "rev-parse", "HEAD")})
			commitOnBranch(t, f.project, "base.txt", "main\n")
		}, "base.txt"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, tree := landFixture(t)
			c.setup(t, f, tree)
			head := gitCmd(t, f.project, "rev-parse", "main")
			f.assertHeld(t, f.landRun(t, false), head, c.want)
		})
	}
}

func TestLandConflictsPredictsTheLandsConflicts(t *testing.T) {
	t.Run("every file both sides changed, with no tree touched", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "base.txt", "branch\n")
		commitOnBranch(t, tree, "list.txt", "branch\n")
		commitOnBase(t, f.project, "base.txt", "main\n")
		commitOnBase(t, f.project, "list.txt", "main\n")
		head := gitCmd(t, f.project, "rev-parse", "main")

		got, err := LandConflicts(f.ctx, f.owner(t))
		if err != nil {
			t.Fatal(err)
		}
		if want := []string{"base.txt", "list.txt"}; !slices.Equal(got, want) {
			t.Fatalf("LandConflicts = %v, want %v", got, want)
		}
		if gitCmd(t, f.project, "rev-parse", "main") != head || mergeInProgress(f.project) || mergeInProgress(tree) {
			t.Fatal("predicting the land touched the checkout or the landing tree")
		}
	})
	t.Run("none when the base moved elsewhere", func(t *testing.T) {
		f, _ := landFixture(t)
		commitOnBase(t, f.project, "upstream.txt", "base\n")
		if got, err := LandConflicts(f.ctx, f.owner(t)); err != nil || got != nil {
			t.Fatalf("LandConflicts = %v, %v, want none", got, err)
		}
	})
	t.Run("none for a run that lands in the checkout", func(t *testing.T) {
		f, _ := landFixture(t)
		run := f.owner(t)
		run.LandPath = ""
		if got, err := LandConflicts(f.ctx, run); err != nil || got != nil {
			t.Fatalf("LandConflicts = %v, %v, want none", got, err)
		}
	})
	t.Run("an error for a branch that is gone", func(t *testing.T) {
		f, _ := landFixture(t)
		run := f.owner(t)
		run.BaseBranch = "no-such-branch"
		if _, err := LandConflicts(f.ctx, run); err == nil {
			t.Fatal("LandConflicts against a missing base returned no error")
		}
	})
}

func TestLandAbortsAConflictedMerge(t *testing.T) {
	f, tree := landFixture(t)
	f.markResolverTried(t)
	commitOnBranch(t, tree, "base.txt", "branch\n")
	f.setFinal(t, &waveobj.FinalStage{State: FinalState_Passed, Round: 1, Commit: gitCmd(t, tree, "rev-parse", "HEAD")})
	commitOnBranch(t, f.project, "base.txt", "main\n")

	land := f.landRun(t, false)
	if land.State != LandState_Held || !strings.Contains(land.Reason, "conflict") {
		t.Fatalf("land = %+v, want a held conflict", land)
	}
	if status := gitCmd(t, f.project, "status", "--porcelain"); status != "" {
		t.Fatalf("checkout left dirty after the abort:\n%s", status)
	}
	if _, err := os.Stat(filepath.Join(f.project, ".git", "MERGE_HEAD")); !os.IsNotExist(err) {
		t.Fatal("the conflicted merge was not aborted")
	}
}

func TestLandKeepsUncommittedEdits(t *testing.T) {
	// run d9a7d94b re-ran Check and Verify for ~7 min before git merge refused the human's unstaged edit
	t.Run("an edit to a file the branch changes holds the land before Verify", func(t *testing.T) {
		f, tree := landFixture(t)
		// after the final stage, so the land would re-run Verify
		commitOnBranch(t, tree, "base.txt", "branch\n")
		out := filepath.ToSlash(t.TempDir())
		f.setLandCommands(t, "", "echo verify > "+out+"/verify")
		edit := "the human's edit\r\nwith odd bytes \x00\n"
		writeFile(t, filepath.Join(f.project, "base.txt"), edit)
		head := gitCmd(t, f.project, "rev-parse", "main")

		land := f.landRun(t, false)
		f.assertHeld(t, land, head, "unstaged edits to files the run changes: base.txt")
		if !land.Dirty {
			t.Fatalf("land = %+v, want a dirty hold the engine retries", land)
		}
		if _, err := os.Stat(filepath.Join(out, "verify")); !os.IsNotExist(err) {
			t.Fatalf("Verify ran before the hold: %v", err)
		}
		if got := readFile(t, filepath.Join(f.project, "base.txt")); got != edit {
			t.Fatalf("base.txt = %q, want the edit byte-identical", got)
		}
	})
	// run ee18a780 held on cmd/wsh/cmd/claude-mod copies that every dev build rewrites, already the branch's bytes
	t.Run("an edit that is already the branch's version lands", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "base.txt", "branch\n")
		f.setLandCommands(t, "", "true")
		writeFile(t, filepath.Join(f.project, "base.txt"), "branch\n")

		run, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
		if err != nil {
			t.Fatal(err)
		}
		if hold := landPrecheck(f.ctx, run); hold != nil {
			t.Fatalf("landPrecheck = %+v, want no hold for a copy of the branch's version", hold)
		}
		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", land)
		}
		if got := strings.ReplaceAll(readFile(t, filepath.Join(f.project, "base.txt")), "\r\n", "\n"); got != "branch\n" {
			t.Fatalf("base.txt = %q, want the branch's version", got)
		}
		if status := gitCmd(t, f.project, "status", "--porcelain"); status != "" {
			t.Fatalf("checkout left dirty after the land:\n%s", status)
		}
	})
	t.Run("a copy of the branch's version beside a real edit still holds", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBase(t, f.project, "other.txt", "base other\n")
		gitCmd(t, tree, "merge", "--no-edit", "main")
		commitOnBranch(t, tree, "base.txt", "branch\n")
		commitOnBranch(t, tree, "other.txt", "branch other\n")
		f.setLandCommands(t, "", "true")
		writeFile(t, filepath.Join(f.project, "base.txt"), "branch\n")
		writeFile(t, filepath.Join(f.project, "other.txt"), "the human's edit\n")
		head := gitCmd(t, f.project, "rev-parse", "main")

		land := f.landRun(t, false)
		f.assertHeld(t, land, head, "unstaged edits to files the run changes: other.txt")
		if got := readFile(t, filepath.Join(f.project, "other.txt")); got != "the human's edit\n" {
			t.Fatalf("other.txt = %q, want the edit intact", got)
		}
	})
	t.Run("an edit to an unrelated file lands around it", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "wrapup.txt", "wrap-up\n")
		f.setLandCommands(t, "", "true")
		writeFile(t, filepath.Join(f.project, "base.txt"), "the human's edit\n")

		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", land)
		}
		if got := readFile(t, filepath.Join(f.project, "base.txt")); got != "the human's edit\n" {
			t.Fatalf("base.txt = %q, want the edit intact", got)
		}
	})
}

// git() trims each line of git's output, so the files are found by the lines around them, not by git's tab
func TestOverwrittenFilesReadsGitsRefusal(t *testing.T) {
	cases := []struct {
		name, out string
		files     []string
		untracked bool
	}{
		{"uncommitted", "git [merge]: exit status 2: error: Your local changes to the following files would be overwritten by merge:\nCHANGELOG.md\npkg/a.go\nPlease commit your changes or stash them before you merge.\nAborting\nMerge with strategy ort failed.", []string{"CHANGELOG.md", "pkg/a.go"}, false},
		{"untracked", "error: The following untracked working tree files would be overwritten by merge:\n\tnew.txt\nPlease move or remove them before you merge.\nAborting", []string{"new.txt"}, true},
		{"anything else", "fatal: refusing to merge unrelated histories", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			files, untracked := overwrittenFiles(c.out)
			if !slices.Equal(files, c.files) || untracked != c.untracked {
				t.Fatalf("overwrittenFiles = %v, %v, want %v, %v", files, untracked, c.files, c.untracked)
			}
		})
	}
}

// the lead writes its spec or plan in the checkout before submit, and the engine commits the same file on
// the run's branch; the untracked copy is the one git would refuse to overwrite
func TestLandRemovesAnUntrackedCopyOfWhatTheBranchAdds(t *testing.T) {
	f, _ := landFixture(t)
	writeFile(t, filepath.Join(f.project, "feature.txt"), "feature\n")

	if land := f.landRun(t, false); land.State != LandState_Landed {
		t.Fatalf("land = %+v, want landed", land)
	}
	if got := gitCmd(t, f.project, "ls-files", "feature.txt"); got != "feature.txt" {
		t.Fatalf("feature.txt is not tracked after the land: %q", got)
	}
}

// the lead adopts a spec from the checkout and the run revises it: the untracked original is an earlier version
// of the run's file, so the land replaces it (run dca34385 held on it); a file the run never held stays the human's
func TestLandUntrackedEarlierVersionOfWhatTheBranchAdds(t *testing.T) {
	t.Run("a revision on the branch replaces the original", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "feature.txt", "feature, revised\n")
		writeFile(t, filepath.Join(f.project, "feature.txt"), "feature\n")

		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", land)
		}
		if got := strings.ReplaceAll(readFile(t, filepath.Join(f.project, "feature.txt")), "\r\n", "\n"); got != "feature, revised\n" {
			t.Fatalf("feature.txt = %q, want the run's revision", got)
		}
	})
	t.Run("a snapshot a resubmit amended away replaces the original", func(t *testing.T) {
		f, tree := landFixture(t)
		writeFile(t, filepath.Join(tree, "feature.txt"), "feature, revised\n")
		gitCmd(t, tree, "commit", "-a", "--amend", "--no-edit")
		writeFile(t, filepath.Join(f.project, "feature.txt"), "feature\n")

		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", land)
		}
		if got := strings.ReplaceAll(readFile(t, filepath.Join(f.project, "feature.txt")), "\r\n", "\n"); got != "feature, revised\n" {
			t.Fatalf("feature.txt = %q, want the run's revision", got)
		}
	})
	t.Run("a version the run never held holds the land", func(t *testing.T) {
		f, _ := landFixture(t)
		writeFile(t, filepath.Join(f.project, "feature.txt"), "the human's feature\n")
		head := gitCmd(t, f.project, "rev-parse", "main")

		f.assertHeld(t, f.landRun(t, false), head, "an untracked feature.txt in the checkout differs from the one the run adds")
		if got := readFile(t, filepath.Join(f.project, "feature.txt")); got != "the human's feature\n" {
			t.Fatalf("feature.txt = %q, want the human's file intact", got)
		}
	})
}

func TestLandForceLandsAFailedOutcome(t *testing.T) {
	f, _ := landFixture(t)
	f.setFinal(t, &waveobj.FinalStage{State: FinalState_Failed, Round: 2, Detail: "Check failed"})
	if land := f.landRun(t, true); land.State != LandState_Landed {
		t.Fatalf("land = %+v, want landed under force", land)
	}
}

func TestLandReverifiesCommitsAfterTheFinalStage(t *testing.T) {
	t.Run("a failing Verify holds", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "wrapup.txt", "wrap-up\n")
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			cur.Verify = "exit 1"
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		head := gitCmd(t, f.project, "rev-parse", "main")
		f.assertHeld(t, f.landRun(t, false), head, "Verify `exit 1` failed")
	})
	t.Run("a passing Check and Verify land", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "wrapup.txt", "wrap-up\n")
		out := filepath.ToSlash(t.TempDir())
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			cur.Check = "test -f wrapup.txt && echo check > " + out + "/check"
			cur.Verify = "test -f wrapup.txt && echo verify > " + out + "/verify"
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", land)
		}
		for _, name := range []string{"check", "verify"} {
			if _, err := os.Stat(filepath.Join(out, name)); err != nil {
				t.Fatalf("%s did not run in the landing tree: %v", name, err)
			}
		}
	})
	// run 33880f82's docs-only wrap-ups paid for a whole Check (tsc, go vet, a build) that Markdown cannot break
	t.Run("a docs-only wrap-up skips Check and still runs Verify", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "docs/wrapup.md", "wrap-up\n")
		out := filepath.ToSlash(t.TempDir())
		f.setLandCommands(t, "exit 1", "echo verify > "+out+"/verify")
		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed without Check", land)
		}
		if _, err := os.Stat(filepath.Join(out, "verify")); err != nil {
			t.Fatalf("Verify did not run: %v", err)
		}
	})
	t.Run("a wrap-up with code beside its docs runs Check", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "wrapup.md", "wrap-up\n")
		commitOnBranch(t, tree, "code.txt", "code\n")
		f.setLandCommands(t, "exit 1", "true")
		head := gitCmd(t, f.project, "rev-parse", "main")
		f.assertHeld(t, f.landRun(t, false), head, "Check `exit 1` failed")
	})
	t.Run("a docs-only wrap-up on a moved base runs Check", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "wrapup.md", "wrap-up\n")
		commitOnBase(t, f.project, "upstream.txt", "base\n")
		f.setLandCommands(t, "exit 1", "true")
		head := gitCmd(t, f.project, "rev-parse", "main")
		f.assertHeld(t, f.landRun(t, false), head, "Check `exit 1` failed")
	})
	t.Run("a verified commit that cannot be listed runs Check", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "wrapup.md", "wrap-up\n")
		f.setFinal(t, &waveobj.FinalStage{State: FinalState_Passed, Round: 1, Commit: strings.Repeat("0", 40)})
		f.setLandCommands(t, "exit 1", "true")
		head := gitCmd(t, f.project, "rev-parse", "main")
		f.assertHeld(t, f.landRun(t, false), head, "Check `exit 1` failed")
	})
	// run c84aa179's Check was killed from outside mid-land, and the hold read as a failure of the run's work
	t.Run("a Check killed from outside holds with a retry", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "code.txt", "code\n")
		f.setLandCommands(t, "task check:ts", "true")
		orig := runPlanCommand
		runPlanCommand = func(ctx context.Context, dir, command string, env []string, timeout time.Duration, progress planProgress) (string, error) {
			if command == "task check:ts" {
				return "", &planCommandError{exitCode: 1073807364, killed: "exit 0x40010004"}
			}
			return orig(ctx, dir, command, env, timeout, progress)
		}
		restoreAfterStages(t, func() { runPlanCommand = orig })
		head := gitCmd(t, f.project, "rev-parse", "main")
		land := f.landRun(t, false)
		f.assertHeld(t, land, head, "Check `task check:ts` did not finish")
		for _, want := range []string{"killed from outside (exit 0x40010004)", "`wsh runs land " + f.ownerID + "` runs it again"} {
			if !strings.Contains(land.Reason, want) {
				t.Fatalf("held reason %q, want it to contain %q", land.Reason, want)
			}
		}
	})
	t.Run("an unmoved branch runs nothing", func(t *testing.T) {
		f, _ := landFixture(t)
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			cur.Verify = "exit 1"
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed without re-running Verify", land)
		}
	})
}

func (f *mergeFixture) setLandCommands(t *testing.T, check, verify string) {
	t.Helper()
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Check, cur.Verify = check, verify
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// commitOnBase commits file on the checkout's branch, as another session would. Only that file: "." would also
// commit the landing tree nested under .waveterm, which a real base never holds.
func commitOnBase(t *testing.T, project, file, content string) {
	t.Helper()
	writeFile(t, filepath.Join(project, file), content)
	gitCmd(t, project, "add", "--", file)
	gitCmd(t, project, "commit", "-m", "change "+file)
}

// mergeInProgress reports whether dir is stopped inside a merge.
func mergeInProgress(dir string) bool {
	return exec.Command("git", "-C", dir, "rev-parse", "-q", "--verify", "MERGE_HEAD").Run() == nil
}

func TestLandChecksTheRunMergedWithItsMovedBase(t *testing.T) {
	t.Run("the check sees the base's commits and lands with no note", func(t *testing.T) {
		f, _ := landFixture(t)
		commitOnBase(t, f.project, "upstream.txt", "base\n")
		f.setLandCommands(t, "", "test -f upstream.txt && test -f feature.txt")
		land := f.landRun(t, false)
		if land.State != LandState_Landed || len(land.Notes) != 0 {
			t.Fatalf("land = %+v, want landed with no unverified-combination note", land)
		}
	})
	t.Run("a Verify that fails on the combination holds, with the base merged into the branch", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBase(t, f.project, "upstream.txt", "base\n")
		f.setLandCommands(t, "", "test ! -f upstream.txt")
		head := gitCmd(t, f.project, "rev-parse", "main")
		f.assertHeld(t, f.landRun(t, false), head, "Verify `test ! -f upstream.txt` failed")
		if mergeInProgress(tree) {
			t.Fatal("the landing tree is left mid-merge")
		}
		// the merge is a commit of the run's branch, so the next land finds the base in it
		if err := exec.Command("git", "-C", tree, "merge-base", "--is-ancestor", head, "HEAD").Run(); err != nil {
			t.Fatalf("the base is not merged into the run's branch: %v", err)
		}
		if _, err := os.Stat(filepath.Join(tree, "upstream.txt")); err != nil {
			t.Fatalf("the base's file is not in the landing tree: %v", err)
		}
	})
	t.Run("a conflict with the base holds, and the tree is put back", func(t *testing.T) {
		f, tree := landFixture(t)
		f.markResolverTried(t)
		commitOnBase(t, f.project, "feature.txt", "the base's own feature\n")
		f.setLandCommands(t, "", "true")
		head := gitCmd(t, f.project, "rev-parse", "main")
		branchHead := gitCmd(t, tree, "rev-parse", "HEAD")
		land := f.landRun(t, false)
		f.assertHeld(t, land, head, "feature.txt")
		if mergeInProgress(tree) || gitCmd(t, tree, "rev-parse", "HEAD") != branchHead {
			t.Fatal("the landing tree is left mid-merge or moved")
		}
	})
	t.Run("Verify is scoped to what changed since the verified commit", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "wrapup.md", "wrap-up\n")
		commitOnBase(t, f.project, "upstream.txt", "base\n")
		out := filepath.ToSlash(t.TempDir())
		f.setLandCommands(t, "", `cat "$ARC_VERIFY_CHANGED" > `+out+`/changed`)
		if land := f.landRun(t, false); land.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", land)
		}
		if got := strings.Fields(readFile(t, filepath.Join(out, "changed"))); !reflect.DeepEqual(got, []string{"upstream.txt", "wrapup.md"}) {
			t.Fatalf("the scope is the wrap-up plus the base's change, got %q", got)
		}
	})
	t.Run("a base commit that lands during the check is still noted", func(t *testing.T) {
		f, _ := landFixture(t)
		commitOnBase(t, f.project, "upstream.txt", "base\n")
		// the check itself moves main, the way another session's commit would
		f.setLandCommands(t, "git -C '"+filepath.ToSlash(f.project)+"' commit -q --allow-empty -m late", "true")
		land := f.landRun(t, false)
		want := []string{"merged onto 1 commit that landed on main during the run; the combination was not verified"}
		if land.State != LandState_Landed || !reflect.DeepEqual(land.Notes, want) {
			t.Fatalf("land = %+v, want landed noting only the late commit", land)
		}
	})
}

// commitProjectFiles commits files, given as path to content, on the project's branch.
func commitProjectFiles(t *testing.T, project string, files map[string]string) {
	t.Helper()
	var paths []string
	for p, content := range files {
		writeFile(t, filepath.Join(project, filepath.FromSlash(p)), content)
		paths = append(paths, p)
	}
	gitCmd(t, project, append([]string{"add", "--"}, paths...)...)
	gitCmd(t, project, "commit", "-m", "add "+strings.Join(paths, ", "))
}

// two runs that appended to the changelog conflict where the second lands; the project lists the file, so the
// land merges the base into the run's branch itself, the landed run's line first
func TestLandMergesMovedBase(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	commitProjectFiles(t, f.project, map[string]string{
		".arc/union-merge": "CHANGELOG.md\n",
		"CHANGELOG.md":     "# Changelog\n\n## Unreleased\n\n- first\n",
	})
	a := f.addLandRunWriting(t, "CHANGELOG.md", "# Changelog\n\n## Unreleased\n\n- first\n- from a\n")
	b := f.addLandRunWriting(t, "CHANGELOG.md", "# Changelog\n\n## Unreleased\n\n- first\n- from b\n")

	for _, id := range []string{a, b} {
		if land, err := LandRun(f.ctx, f.channel, id, false); err != nil || land == nil || land.State != LandState_Landed {
			t.Fatalf("run %s: land = %+v, err %v, want landed", id, land, err)
		}
	}
	if got := landedOrder(t, f.project); !slices.Equal(got, []string{a, b}) {
		t.Fatalf("first-parent merges = %v, want %v", got, []string{a, b})
	}
	// core.autocrlf may check it out with CRLF
	if got, want := strings.ReplaceAll(readFile(t, filepath.Join(f.project, "CHANGELOG.md")), "\r\n", "\n"), "# Changelog\n\n## Unreleased\n\n- first\n- from a\n- from b\n"; got != want {
		t.Fatalf("CHANGELOG.md = %q, want %q", got, want)
	}
	if subjects := gitCmd(t, f.project, "log", "--format=%s", "main"); !strings.Contains(subjects, "Merge main into wave/"+b+" before landing") {
		t.Fatalf("no merge of main into wave/%s in the history:\n%s", b, subjects)
	}
	if subjects := gitCmd(t, f.project, "log", "--format=%s", "main"); strings.Contains(subjects, "Merge main into wave/"+a) {
		t.Fatalf("run %s landed on an unmoved base and needed no merge:\n%s", a, subjects)
	}
	if mergeMsg := gitCmd(t, f.project, "log", "-1", "--format=%B", "--grep", "before landing", "main"); !strings.Contains(mergeMsg, "Arc-Run: "+b) {
		t.Fatalf("the base merge carries no Arc-Run line: %q", mergeMsg)
	}
}

// a file the project does not list is a real conflict: the land holds with the files named, and neither the landing
// tree nor the checkout is left mid-merge
func TestLandRealConflictHolds(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	commitProjectFiles(t, f.project, map[string]string{"notes.md": "one\ntwo\nthree\n"})
	a := f.addLandRunWriting(t, "notes.md", "one\na two\nthree\n")
	b := f.addLandRunWriting(t, "notes.md", "one\nb two\nthree\n")
	if land := f.landRunByID(t, a); land.State != LandState_Landed {
		t.Fatalf("run %s: land = %+v, want landed", a, land)
	}
	head := gitCmd(t, f.project, "rev-parse", "main")

	land := f.landRunByID(t, b)
	if land.State != LandState_Held || !slices.Equal(land.Conflicts, []string{"notes.md"}) || !strings.Contains(land.Reason, "notes.md") {
		t.Fatalf("land = %+v, want held with notes.md as the conflict", land)
	}
	tree := worktreeDir(f.project, b)
	if mergeInProgress(tree) {
		t.Fatal("the landing tree is left mid-merge")
	}
	if got := gitCmd(t, f.project, "rev-parse", "main"); got != head {
		t.Fatalf("main moved from %s to %s", head, got)
	}
	if mergeInProgress(f.project) || gitCmd(t, f.project, "status", "--porcelain", "--untracked-files=no") != "" {
		t.Fatal("the checkout was touched")
	}
	if !branchExists(f.project, "wave/"+b) {
		t.Fatal("a held land deleted the run's branch")
	}
}

// the re-run of Check and Verify sees the base's commits that the final stage never did
func TestLandMovedBaseRechecks(t *testing.T) {
	f, tree := landFixture(t)
	commitProjectFiles(t, f.project, map[string]string{"marker.txt": "from the base\n"})
	f.setLandCommands(t, "", "test ! -f marker.txt")

	head := gitCmd(t, f.project, "rev-parse", "main")
	f.assertHeld(t, f.landRun(t, false), head, "Verify `test ! -f marker.txt` failed")
	if subject := gitCmd(t, tree, "log", "-1", "--format=%s"); subject != "Merge main into wave/"+f.ownerID+" before landing" {
		t.Fatalf("the check ran on %q, want the base merged into the branch", subject)
	}
}

// a Check the base already failed at submit fails on the merged base too; holding on it would leave no way to land
func TestLandNotesACheckFailureTheBaseShares(t *testing.T) {
	setup := func(t *testing.T, verify string) *mergeFixture {
		f, _ := landFixture(t)
		commitOnBase(t, f.project, "upstream.txt", "base\n")
		f.setLandCommands(t, "echo 'error TS2307: three'; exit 2", verify)
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
			cur.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Failed, Commit: "abc", Detail: "exit 2: error TS2307"}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		return f
	}
	t.Run("it lands with a note", func(t *testing.T) {
		land := setup(t, "true").landRun(t, false)
		if land.State != LandState_Landed || !slices.ContainsFunc(land.Notes, func(n string) bool {
			return strings.Contains(n, "already failed on the base") && strings.Contains(n, "TS2307")
		}) {
			t.Fatalf("land = %+v, want landed with a note on the shared Check failure", land)
		}
	})
	t.Run("a failing Verify still holds", func(t *testing.T) {
		f := setup(t, "exit 1")
		head := gitCmd(t, f.project, "rev-parse", "main")
		f.assertHeld(t, f.landRun(t, false), head, "Verify `exit 1` failed")
	})
}

// a landing tree someone left mid-merge is not a tree the check can speak for
func TestLandHoldsALandingTreeLeftMidMerge(t *testing.T) {
	f, tree := landFixture(t)
	commitOnBranch(t, tree, "wrapup.md", "wrap-up\n")
	gitCmd(t, f.project, "branch", "side", "main")
	gitCmd(t, f.project, "switch", "-q", "side")
	commitOnBase(t, f.project, "side.txt", "side\n")
	gitCmd(t, f.project, "switch", "-q", "main")
	gitCmd(t, tree, "merge", "--no-commit", "--no-ff", "side")
	f.setLandCommands(t, "", "true")
	head := gitCmd(t, f.project, "rev-parse", "main")
	f.assertHeld(t, f.landRun(t, false), head, "mid-merge")
}

func TestLandNotesCommitsThatLandedOnTheBaseDuringTheRun(t *testing.T) {
	f, _ := landFixture(t)
	commitOnBranch(t, f.project, "one.txt", "1\n")
	commitOnBranch(t, f.project, "two.txt", "2\n")

	land := f.landRun(t, false)
	want := []string{"merged onto 2 commits that landed on main during the run; the combination was not verified"}
	if land.State != LandState_Landed || !reflect.DeepEqual(land.Notes, want) {
		t.Fatalf("land = %+v, want landed with notes %q", land, want)
	}
}

func TestLandLeavesACheckoutLandedRunAlone(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.BaseBranch, r.Status = "main", jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if land := f.landRun(t, false); land != nil {
		t.Fatalf("land = %+v, want nothing for a checkout-landed run", land)
	}
	if got := f.owner(t).Land; got != nil {
		t.Fatalf("stored land = %+v, want none", got)
	}
}

// a held land the human merged by hand, after its branch and tree were removed, is landed on the merge that took in
// the commit the run completed on, whatever the final stage said
func TestLandRecognizesAHandMergeAfterItsBranchIsGone(t *testing.T) {
	f, tree := landFixture(t)
	f.setFinal(t, &waveobj.FinalStage{State: FinalState_Failed, Round: 2})
	tip := gitCmd(t, tree, "rev-parse", "HEAD")
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.EndCommit = tip
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	f.assertHeld(t, f.landRun(t, false), gitCmd(t, f.project, "rev-parse", "main"), "final stage failed")

	gitCmd(t, f.project, "merge", "--no-ff", "-m", "by hand", "wave/"+f.ownerID)
	merge := gitCmd(t, f.project, "rev-parse", "HEAD")
	commitOnBase(t, f.project, "later.txt", "later\n")
	if err := RemoveRunWorktree(f.ctx, f.project, f.ownerID); err != nil {
		t.Fatal(err)
	}
	head := gitCmd(t, f.project, "rev-parse", "HEAD")

	land := f.landRun(t, false)
	if land.State != LandState_Landed || land.Commit != merge || land.Reason != "" || len(land.Notes) != 0 {
		t.Fatalf("land = %+v, want landed on the hand merge %s", land, merge)
	}
	if got := gitCmd(t, f.project, "rev-parse", "HEAD"); got != head {
		t.Fatalf("main moved from %s to %s", head, got)
	}
}

// a branch merged by hand while it still exists lands without a second merge, and its tree and branch go
func TestLandRecognizesAHandMergedBranch(t *testing.T) {
	f, tree := landFixture(t)
	gitCmd(t, f.project, "merge", "--ff-only", "wave/"+f.ownerID)
	head := gitCmd(t, f.project, "rev-parse", "HEAD")

	land := f.landRun(t, false)
	if land.State != LandState_Landed || land.Commit != head {
		t.Fatalf("land = %+v, want landed on the fast-forwarded tip %s", land, head)
	}
	if got := gitCmd(t, f.project, "rev-parse", "HEAD"); got != head {
		t.Fatalf("main moved from %s to %s", head, got)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("the landing tree is still there: %v", err)
	}
	if branchExists(f.project, "wave/"+f.ownerID) {
		t.Fatal("the run's branch was not deleted")
	}
}

// run 1409ee43: another session's edits held the land, that session then committed them, and the run sat held
// until the human asked how to land it. A hold made only by uncommitted changes retries once they are gone.
func TestADirtyHoldLandsOnceTheCheckoutIsClean(t *testing.T) {
	t.Run("a staged change another session then commits", func(t *testing.T) {
		f, _ := landFixture(t)
		writeFile(t, filepath.Join(f.project, "other.txt"), "another session's work\n")
		gitCmd(t, f.project, "add", "other.txt")
		head := gitCmd(t, f.project, "rev-parse", "main")
		land := f.landRun(t, false)
		f.assertHeld(t, land, head, "staged changes")
		if !land.Dirty {
			t.Fatalf("land = %+v, want a dirty hold", land)
		}

		retryDirtyLands(f.ctx)
		waitStages(t)
		f.assertHeld(t, f.owner(t).Land, head, "staged changes")

		gitCmd(t, f.project, "commit", "-m", "another session's work")
		retryDirtyLands(f.ctx)
		waitStages(t)
		if got := f.owner(t).Land; got == nil || got.State != LandState_Landed || got.Commit != gitCmd(t, f.project, "rev-parse", "HEAD") {
			t.Fatalf("land = %+v, want landed on the checkout's new head", got)
		}
	})
	t.Run("an unstaged edit another session then reverts", func(t *testing.T) {
		f, tree := landFixture(t)
		commitOnBranch(t, tree, "base.txt", "branch\n")
		f.setFinal(t, &waveobj.FinalStage{State: FinalState_Passed, Round: 1, Commit: gitCmd(t, tree, "rev-parse", "HEAD")})
		writeFile(t, filepath.Join(f.project, "base.txt"), "another session's edit\n")
		if land := f.landRun(t, false); land.State != LandState_Held || !land.Dirty {
			t.Fatalf("land = %+v, want a dirty hold", land)
		}

		gitCmd(t, f.project, "checkout", "--", "base.txt")
		retryDirtyLands(f.ctx)
		waitStages(t)
		if got := f.owner(t).Land; got == nil || got.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed", got)
		}
	})
	t.Run("a forced land keeps its force", func(t *testing.T) {
		f, _ := landFixture(t)
		f.setFinal(t, &waveobj.FinalStage{State: FinalState_Failed, Round: 2, Detail: "Check failed"})
		writeFile(t, filepath.Join(f.project, "other.txt"), "staged\n")
		gitCmd(t, f.project, "add", "other.txt")
		if land := f.landRun(t, true); land.State != LandState_Held || !land.Dirty || !land.Force {
			t.Fatalf("land = %+v, want a forced dirty hold", land)
		}

		gitCmd(t, f.project, "commit", "-m", "staged")
		retryDirtyLands(f.ctx)
		waitStages(t)
		if got := f.owner(t).Land; got == nil || got.State != LandState_Landed {
			t.Fatalf("land = %+v, want landed past the failed final stage", got)
		}
	})
	t.Run("a hold that is not a dirty checkout waits for the human", func(t *testing.T) {
		f, _ := landFixture(t)
		gitCmd(t, f.project, "checkout", "-b", "x")
		head := gitCmd(t, f.project, "rev-parse", "main")
		if land := f.landRun(t, false); land.State != LandState_Held || land.Dirty {
			t.Fatalf("land = %+v, want a hold that is not dirty", land)
		}

		gitCmd(t, f.project, "checkout", "main")
		retryDirtyLands(f.ctx)
		waitStages(t)
		f.assertHeld(t, f.owner(t).Land, head, "checkout is on x, not main")
	})
}
