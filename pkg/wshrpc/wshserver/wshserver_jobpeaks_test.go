// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jobmeter"
	"github.com/wavetermdev/waveterm/pkg/jobpeaks"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// repoAt makes a repository root: a directory with a .git directory in it.
func repoAt(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

// linkedWorktreeOf makes a worktree of main the way `git worktree add` lays it out: a `.git` file pointing at
// <main>/.git/worktrees/<name>, whose commondir and gitdir files point back.
func linkedWorktreeOf(t *testing.T, main string) string {
	t.Helper()
	wt := t.TempDir()
	admin := filepath.Join(main, ".git", "worktrees", "wt")
	if err := os.MkdirAll(admin, 0o755); err != nil {
		t.Fatal(err)
	}
	// git writes forward slashes into these files, on Windows too
	write := func(path, content string) {
		if err := os.WriteFile(path, []byte(content+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(wt, ".git"), "gitdir: "+filepath.ToSlash(admin))
	write(filepath.Join(admin, "commondir"), "../..")
	write(filepath.Join(admin, "gitdir"), filepath.ToSlash(filepath.Join(wt, ".git")))
	return wt
}

// blockWithCwd stores an agent block whose cmd:cwd is cwd and returns its id.
func blockWithCwd(t *testing.T, cwd string) string {
	t.Helper()
	block := &waveobj.Block{
		OID:        uuid.NewString(),
		ParentORef: "tab:" + uuid.NewString(),
		Meta:       waveobj.MetaMapType{waveobj.MetaKey_CmdCwd: cwd},
	}
	if err := wstore.DBInsert(context.Background(), block); err != nil {
		t.Fatal(err)
	}
	return block.OID
}

// installPeaks swaps in an in-memory peak store, restoring the default when the test ends.
func installPeaks(t *testing.T) *jobpeaks.Store {
	t.Helper()
	saved := jobpeaks.Default
	s := jobpeaks.Open("", "", time.Now)
	jobpeaks.Default = s
	t.Cleanup(func() { jobpeaks.Default = saved })
	return s
}

func TestJobProjectIsTheRepositoryRootOfTheBlocksCwd(t *testing.T) {
	ctx := context.Background()
	main := repoAt(t)
	sub := filepath.Join(main, "pkg", "x")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := jobProject(ctx, blockWithCwd(t, main)); got != main {
		t.Fatalf("project of the root = %q, want %q", got, main)
	}
	if got := jobProject(ctx, blockWithCwd(t, sub)); got != main {
		t.Fatalf("project of a subfolder = %q, want %q", got, main)
	}
}

// a run worker works in a linked worktree: what it measures must be the main checkout's, or no run would ever reuse it
func TestJobProjectMapsALinkedWorktreeToTheMainCheckout(t *testing.T) {
	ctx := context.Background()
	main := repoAt(t)
	wt := linkedWorktreeOf(t, main)
	inside := filepath.Join(wt, "frontend")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, cwd := range []string{wt, inside} {
		if got := jobProject(ctx, blockWithCwd(t, cwd)); got != main {
			t.Fatalf("project of %q = %q, want the main checkout %q", cwd, got, main)
		}
	}
}

// lowerDrive writes p's drive letter in lower case, as VS Code and some gitdir files do ("d:/src/…").
func lowerDrive(p string) string {
	if v := filepath.VolumeName(p); len(v) == 2 && v[1] == ':' {
		return strings.ToLower(v) + p[2:]
	}
	return p
}

// Windows paths ignore case, and a drive letter comes either way: a worktree's gitdir file written "d:/…" and a main
// block whose cwd reads "D:\…" are one project, or what a run measures never reaches the main checkout's agents
func TestJobProjectIgnoresTheDriveLettersCase(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("drive letters are a Windows thing")
	}
	ctx := context.Background()
	main := repoAt(t)
	if lowerDrive(main) == main {
		t.Fatalf("temp dir %q has no upper-case drive letter to test with", main)
	}
	wt := linkedWorktreeOf(t, main)
	admin := filepath.Join(main, ".git", "worktrees", "wt")
	if err := os.WriteFile(filepath.Join(wt, ".git"), []byte("gitdir: "+filepath.ToSlash(lowerDrive(admin))+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, cwd := range []string{main, lowerDrive(main), wt, lowerDrive(wt)} {
		if got := jobProject(ctx, blockWithCwd(t, cwd)); got != main {
			t.Fatalf("project of %q = %q, want %q", cwd, got, main)
		}
	}
}

func TestJobProjectIsEmptyOutsideARepositoryAndWithoutABlock(t *testing.T) {
	ctx := context.Background()
	// under the volume's root, not the temp dir: a .git in some ancestor of the temp dir (a dotfiles repo in the home
	// folder) would read as the project
	outside := filepath.Join(filepath.VolumeName(t.TempDir())+string(filepath.Separator), "arcterm-no-such-dir", "work")
	if got := jobProject(ctx, blockWithCwd(t, outside)); got != "" {
		t.Fatalf("project outside a repository = %q, want the empty no-project key", got)
	}
	if got := jobProject(ctx, blockWithCwd(t, "")); got != "" {
		t.Fatalf("project of a block with no cwd = %q, want empty", got)
	}
	// a relative cwd would resolve against wavesrv's own working directory, which says nothing about the agent
	if got := jobProject(ctx, blockWithCwd(t, filepath.Join("pkg", "x"))); got != "" {
		t.Fatalf("project of a relative cwd = %q, want empty", got)
	}
	if got := jobProject(ctx, ""); got != "" {
		t.Fatalf("project with no block = %q, want empty", got)
	}
	if got := jobProject(ctx, uuid.NewString()); got != "" {
		t.Fatalf("project of a block the store does not know = %q, want empty", got)
	}
}

// the answer for a cwd is kept: a second look reads no file
func TestJobProjectIsCachedPerCwd(t *testing.T) {
	ctx := context.Background()
	main := repoAt(t)
	block := blockWithCwd(t, main)
	if got := jobProject(ctx, block); got != main {
		t.Fatalf("project = %q, want %q", got, main)
	}
	if err := os.RemoveAll(filepath.Join(main, ".git")); err != nil {
		t.Fatal(err)
	}
	if got := jobProject(ctx, block); got != main {
		t.Fatalf("project after the .git went = %q, want the cached %q", got, main)
	}
}

// what the meter reports when a command ends is recorded under its pattern and its project
func TestJobPeaksOnDoneRecordsTheMeasuredCommands(t *testing.T) {
	store := installPeaks(t)
	main := repoAt(t)
	block := blockWithCwd(t, main)
	onDone := JobMeterConfig().OnDone

	// a command in the table that never ran (skipped, refused): its bash alone, under a tenth of the table's 3 GB
	onDone(jobmeter.Done{BlockId: block, Command: "task check:ts", Peak: 14 * testGB / 1024})
	if got, basis := store.Estimate("task check:ts", main, 3*testGB); got != 3*testGB || basis.Measured {
		t.Fatalf("estimate after a run that never ran = %d %+v, want the table's figure", got, basis)
	}

	// one that ran: kept under its table name and the block's project, however light next to the table
	onDone(jobmeter.Done{BlockId: block, Command: "task check:ts", Peak: 400 * testGB / 1024})
	got, basis := store.Estimate("task check:ts", main, 3*testGB)
	if want := 400*testGB/1024 + 400*testGB/1024/5; got != want || !basis.Measured || basis.Elsewhere {
		t.Fatalf("estimate for the known command = %d %+v, want %d measured", got, basis, want)
	}
	if got, basis := store.Estimate("task check:ts", "", 3*testGB); got != 3*testGB || basis.Measured {
		t.Fatalf("estimate in no project = %d %+v, want the table's figure: the run was in %s", got, basis, main)
	}

	// an unknown command that read heavy is learned
	onDone(jobmeter.Done{BlockId: block, Command: "make build", Peak: 2 * testGB})
	if !store.Learned()["make build"] {
		t.Fatalf("learned = %v, want make build after a 2 GB run", store.Learned())
	}
	if got, basis := store.Estimate("make build", main, testGB); got != 2*testGB+2*testGB/5 || !basis.Measured {
		t.Fatalf("estimate for make build = %d %+v, want 2.4 GB measured", got, basis)
	}

	// an unknown command that stayed light is not kept
	onDone(jobmeter.Done{BlockId: block, Command: "ls src", Peak: 40 * testGB / 1024})
	if store.Learned()["ls src"] {
		t.Fatalf("learned = %v, want no ls src", store.Learned())
	}
}

// the tree's peak cannot be split between two commands, so a compound is not recorded under either
func TestJobPeaksOnDoneRecordsNothingForACompound(t *testing.T) {
	store := installPeaks(t)
	main := repoAt(t)
	block := blockWithCwd(t, main)
	JobMeterConfig().OnDone(jobmeter.Done{BlockId: block, Command: "make build && gradle test", Peak: 3 * testGB})
	if learned := store.Learned(); len(learned) != 0 {
		t.Fatalf("learned = %v after a compound, want none", learned)
	}
	for _, name := range []string{"make build", "gradle test", "make build && gradle test"} {
		if got, basis := store.Estimate(name, main, testGB); got != testGB || basis.Measured {
			t.Fatalf("estimate for %q = %d %+v, want the table's figure, not measured", name, got, basis)
		}
	}
	// a known command's chained work step is dropped, not split: `cd x && task check:ts` is task check:ts
	JobMeterConfig().OnDone(jobmeter.Done{BlockId: block, Command: "cd web && task check:ts", Peak: testGB})
	if _, basis := store.Estimate("task check:ts", main, 3*testGB); !basis.Measured {
		t.Fatal("a command behind a cd was not recorded")
	}
}

// no store (tests, a wavesrv that has not opened one yet) means no measurement, and no panic
func TestJobPeaksOnDoneWithoutAStore(t *testing.T) {
	saved := jobpeaks.Default
	jobpeaks.Default = nil
	t.Cleanup(func() { jobpeaks.Default = saved })
	JobMeterConfig().OnDone(jobmeter.Done{Command: "task check:ts", Peak: testGB})
}

// the meter watches the agents the roster lists, each by its own process, and reads the roster at most every 10 s
func TestJobPeaksAgentsAreTheLiveRosterRowsAndTheRosterIsReadEvery10s(t *testing.T) {
	facts := threeAgents()
	reads := 0
	scriptAgents(t, facts)
	scripted := loadAgentRosterFacts
	loadAgentRosterFacts = func(ctx context.Context) (*agentRosterFacts, error) {
		reads++
		return scripted(ctx)
	}
	oldPid, oldShell := consumerBlockPid, meterIsShell
	t.Cleanup(func() { consumerBlockPid, meterIsShell = oldPid, oldShell })
	// A runs claude 101 under its shell 100 (fish keeps the shell); B is claude 200 itself; C's shell has exited
	consumerBlockPid = func(blockId string) int {
		return map[string]int{agentsBlockA: 100, agentsBlockB: 200}[blockId]
	}
	meterIsShell = func(pid int32) bool { return pid == 100 }
	table := memusage.NewTable(map[int32]int32{100: 1, 101: 100, 200: 1, 201: 200, 202: 200})

	now := time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)
	agents := newMeterAgents(func() time.Time { return now })
	want := []jobmeter.Agent{{BlockId: agentsBlockA, Pid: 101}, {BlockId: agentsBlockB, Pid: 200}}
	check := func(label string) {
		t.Helper()
		got := agents(table)
		if len(got) != len(want) {
			t.Fatalf("%s: agents = %+v, want %+v", label, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s: agents = %+v, want %+v", label, got, want)
			}
		}
	}
	check("first poll")
	if reads != 1 {
		t.Fatalf("roster reads after the first poll = %d, want 1", reads)
	}
	now = now.Add(4 * time.Second)
	check("second poll")
	now = now.Add(4 * time.Second)
	check("third poll")
	if reads != 1 {
		t.Fatalf("roster reads after 8 s = %d, want still 1", reads)
	}

	// an agent whose shell has since exited has no block pid: it drops out at once, before the next roster read
	consumerBlockPid = func(blockId string) int { return map[string]int{agentsBlockA: 100}[blockId] }
	want = []jobmeter.Agent{{BlockId: agentsBlockA, Pid: 101}}
	check("after B ended")

	now = now.Add(3 * time.Second) // 11 s since the read
	check("poll past 10 s")
	if reads != 2 {
		t.Fatalf("roster reads after 11 s = %d, want 2", reads)
	}
}

// a roster that cannot be read leaves the meter with the agents it knew, and is read again after the same 10 s
func TestJobPeaksAgentsKeepsTheLastRosterWhenOneCannotBeRead(t *testing.T) {
	scriptAgents(t, threeAgents())
	good := loadAgentRosterFacts
	failing := false
	loadAgentRosterFacts = func(ctx context.Context) (*agentRosterFacts, error) {
		if failing {
			return nil, context.DeadlineExceeded
		}
		return good(ctx)
	}
	oldPid := consumerBlockPid
	t.Cleanup(func() { consumerBlockPid = oldPid })
	consumerBlockPid = func(blockId string) int { return map[string]int{agentsBlockA: 100}[blockId] }
	table := memusage.NewTable(map[int32]int32{100: 1})

	now := time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)
	agents := newMeterAgents(func() time.Time { return now })
	if got := agents(table); len(got) != 1 {
		t.Fatalf("first poll: agents = %+v, want agent A", got)
	}
	failing = true
	now = now.Add(11 * time.Second)
	if got := agents(table); len(got) != 1 || got[0].BlockId != agentsBlockA {
		t.Fatalf("poll with an unreadable roster: agents = %+v, want agent A kept", got)
	}
}
