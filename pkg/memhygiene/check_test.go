// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	checkTestNoChanges  = `{"changes": []}`
	checkTestSortPrefix = "Several projects in one git repo share"
)

// checkTestEnv points the claude home, the registry and the model at test values.
type checkTestEnv struct {
	claudeHome string
	registry   map[string]string
	mu         sync.Mutex
	prompts    []string
	reply      func(prompt string) (string, error)
}

func checkTestSetup(t *testing.T) *checkTestEnv {
	t.Helper()
	storeSetup(t)
	env := &checkTestEnv{claudeHome: t.TempDir(), registry: map[string]string{}}
	env.reply = func(string) (string, error) { return checkTestNoChanges, nil }
	oldHome, oldRegistry, oldModel := claudeHomeFn, registryFn, runModel
	claudeHomeFn = func() string { return env.claudeHome }
	registryFn = func() map[string]string {
		env.mu.Lock()
		defer env.mu.Unlock()
		return maps.Clone(env.registry)
	}
	runModel = func(ctx context.Context, prompt string) (string, error) {
		env.mu.Lock()
		env.prompts = append(env.prompts, prompt)
		reply := env.reply
		env.mu.Unlock()
		return reply(prompt)
	}
	t.Cleanup(func() { claudeHomeFn, registryFn, runModel = oldHome, oldRegistry, oldModel })
	return env
}

// project registers name at path and returns the memory folder discovery resolves it to, created.
func (e *checkTestEnv) project(t *testing.T, name, path string) string {
	t.Helper()
	e.mu.Lock()
	e.registry[name] = path
	e.mu.Unlock()
	folder := Discover(map[string]string{name: path}, e.claudeHome)[0].Folder
	if folder == "" {
		t.Fatalf("discovery resolved no folder for %s at %s", name, path)
	}
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	return folder
}

// judgePrompts are the judge calls made so far, leaving out sort calls.
func (e *checkTestEnv) judgePrompts() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []string
	for _, p := range e.prompts {
		if !strings.HasPrefix(p, checkTestSortPrefix) {
			out = append(out, p)
		}
	}
	return out
}

func (e *checkTestEnv) setReply(reply func(prompt string) (string, error)) {
	e.mu.Lock()
	e.reply = reply
	e.mu.Unlock()
}

// checkTestSimple registers name on its own repo with two linked memories, a.md and b.md.
func checkTestSimple(t *testing.T, env *checkTestEnv, name string) string {
	t.Helper()
	folder := env.project(t, name, initRepo(t))
	writeFile(t, filepath.Join(folder, "MEMORY.md"), "- [A](a.md) — alpha\n- [B](b.md) — beta\n")
	writeFile(t, filepath.Join(folder, "a.md"), "alpha rule\n")
	writeFile(t, filepath.Join(folder, "b.md"), "beta rule\n")
	return folder
}

// checkTestSharing registers ca and det, two subprojects of one repo that load its one memory folder,
// with ca's own folder holding a leftover. The model sorts hk.md to ca and det.md to det.
func checkTestSharing(t *testing.T, env *checkTestEnv) (repo, shared, own string) {
	t.Helper()
	repo = initRepo(t)
	commit(t, repo, "subprojects", map[string]string{"ca/README.md": "ca\n", "det/README.md": "det\n"})
	shared = env.project(t, "ca", filepath.Join(repo, "ca"))
	env.project(t, "det", filepath.Join(repo, "det"))
	writeFile(t, filepath.Join(shared, "MEMORY.md"), "- [HK](hk.md) — turn latency\n- [Det](det.md) — detector\n")
	writeFile(t, filepath.Join(shared, "hk.md"), "---\ndescription: hk probe\n---\nhk latency\n")
	writeFile(t, filepath.Join(shared, "det.md"), "---\ndescription: detector\n---\ndetector rule\n")
	own = OwnFolderFor(filepath.Join(repo, "ca"), env.claudeHome)
	writeFile(t, filepath.Join(own, "old.md"), "a leftover\n")
	env.setReply(func(p string) (string, error) {
		switch {
		case strings.HasPrefix(p, checkTestSortPrefix):
			return `{"sort": {"hk.md": ["ca"], "det.md": ["det"]}}`, nil
		case strings.Contains(p, "### old.md"):
			return checkTestDelete("old.md"), nil
		}
		return checkTestNoChanges, nil
	})
	return repo, shared, own
}

func checkTestDelete(name string) string {
	return fmt.Sprintf(`{"changes": [{"kind": "delete", "title": "stale %s", "files": [%q]}]}`, name, name)
}

func checkTestLoad(t *testing.T, project string) *State {
	t.Helper()
	st, err := Load(project)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func checkTestRun(t *testing.T, env *checkTestEnv, project string) {
	t.Helper()
	if err := runCheck(context.Background(), project, env.claudeHome); err != nil {
		t.Fatalf("check of %s: %v", project, err)
	}
}

func checkTestFind(t *testing.T, st *State, kind string) wshrpc.MemChange {
	t.Helper()
	for _, c := range st.Changes {
		if c.Kind == kind {
			return c
		}
	}
	t.Fatalf("no %s change in %+v", kind, st.Changes)
	return wshrpc.MemChange{}
}

func checkTestDecide(t *testing.T, project, id, verdict string) *wshrpc.MemHygieneProject {
	t.Helper()
	p, err := Decide(project, id, verdict)
	if err != nil {
		t.Fatalf("%s on %s: %v", verdict, id, err)
	}
	return p
}

func TestCheckStoresChanges(t *testing.T) {
	env := checkTestSetup(t)
	folder := checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	before := time.Now().UnixMilli()

	checkTestRun(t, env, "p")

	st := checkTestLoad(t, "p")
	if len(st.Changes) != 1 {
		t.Fatalf("want 1 change, got %+v", st.Changes)
	}
	c := st.Changes[0]
	if c.Kind != "delete" || c.Status != "open" || c.Op.Memories[0] != "a.md" {
		t.Fatalf("change = %+v", c)
	}
	if st.Checking || st.LastError != "" || st.CheckedAt < before {
		t.Fatalf("checking/lasterror/checkedat = %v/%q/%d", st.Checking, st.LastError, st.CheckedAt)
	}
	if st.NextCheckAt != st.CheckedAt+checkInterval.Milliseconds() {
		t.Fatalf("next check %d is not a week after %d", st.NextCheckAt, st.CheckedAt)
	}
	if st.Folder != folder || st.Memories != 2 || !st.Index.Exists || st.Index.Lines != 2 {
		t.Fatalf("folder/memories/index = %q/%d/%+v", st.Folder, st.Memories, st.Index)
	}
	if len(st.Seen) != 2 {
		t.Fatalf("seen = %v, want both memories", st.Seen)
	}
}

func TestCheckHashGateSkipsUnchanged(t *testing.T) {
	env := checkTestSetup(t)
	folder := checkTestSimple(t, env, "p")
	checkTestRun(t, env, "p")
	if n := len(env.judgePrompts()); n != 1 {
		t.Fatalf("first check made %d judge calls, want 1", n)
	}

	checkTestRun(t, env, "p")
	if n := len(env.judgePrompts()); n != 1 {
		t.Fatalf("an unchanged folder was judged again (%d calls)", n)
	}

	writeFile(t, filepath.Join(folder, "b.md"), "beta rule, revised\n")
	checkTestRun(t, env, "p")
	prompts := env.judgePrompts()
	if len(prompts) != 2 {
		t.Fatalf("want a judge call for the changed memory, got %d calls", len(prompts))
	}
	if last := prompts[1]; !strings.Contains(last, "### b.md") || strings.Contains(last, "### a.md") {
		t.Fatalf("the third check should send only b.md:\n%s", last)
	}
}

func TestCheckKeptStaysKeptUntilFileChanges(t *testing.T) {
	env := checkTestSetup(t)
	folder := checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	checkTestRun(t, env, "p")
	kept := checkTestLoad(t, "p").Changes[0]
	checkTestDecide(t, "p", kept.Id, "keep")

	checkTestRun(t, env, "p")
	st := checkTestLoad(t, "p")
	if len(st.Changes) != 1 || st.Changes[0].Id != kept.Id || st.Changes[0].Status != "kept" {
		t.Fatalf("the kept change didn't stay kept: %+v", st.Changes)
	}
	if n := len(env.judgePrompts()); n != 1 {
		t.Fatalf("a kept, unchanged memory was judged again (%d calls)", n)
	}

	writeFile(t, filepath.Join(folder, "a.md"), "alpha rule, revised\n")
	checkTestRun(t, env, "p")
	st = checkTestLoad(t, "p")
	if len(st.Changes) != 1 || st.Changes[0].Id == kept.Id || st.Changes[0].Status != "open" {
		t.Fatalf("after its file changed, want one new open change, got %+v", st.Changes)
	}
}

func TestCheckFailureKeepsLastResult(t *testing.T) {
	env := checkTestSetup(t)
	checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	checkTestRun(t, env, "p")
	good := checkTestLoad(t, "p")

	for name, reply := range map[string]func(string) (string, error){
		"model error": func(string) (string, error) { return "", errors.New("model down") },
		"truncated":   func(string) (string, error) { return `{"changes": [{"kind": "delete", "files": ["a.md"]`, nil },
	} {
		t.Run(name, func(t *testing.T) {
			env.setReply(reply)
			if err := entryBegin("p"); err != nil {
				t.Fatal(err)
			}
			if err := runCheck(context.Background(), "p", env.claudeHome); err == nil {
				t.Fatal("want the check to fail")
			}
			st := checkTestLoad(t, "p")
			if st.Checking || st.LastError == "" {
				t.Fatalf("checking/lasterror = %v/%q", st.Checking, st.LastError)
			}
			if name == "model error" && !strings.Contains(st.LastError, "model down") {
				t.Fatalf("lasterror %q doesn't give the reason", st.LastError)
			}
			if st.CheckedAt != good.CheckedAt || len(st.Changes) != 1 || st.Changes[0].Id != good.Changes[0].Id {
				t.Fatalf("the last good result was not kept: %+v", st.MemHygieneProject)
			}
		})
	}
}

func TestCheckMergeKeepsDecisionMadeDuringCheck(t *testing.T) {
	env := checkTestSetup(t)
	folder := checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	checkTestRun(t, env, "p")
	open := checkTestLoad(t, "p").Changes[0]

	env.setReply(func(string) (string, error) {
		// the user applies while the model runs, between the check's read and its store
		if _, err := Decide("p", open.Id, "apply"); err != nil {
			return "", err
		}
		return checkTestDelete("a.md"), nil
	})
	checkTestRun(t, env, "p")

	st := checkTestLoad(t, "p")
	if len(st.Changes) != 1 || st.Changes[0].Id != open.Id || st.Changes[0].Status != "applied" || st.Changes[0].ApplyId == "" {
		t.Fatalf("the apply made during the check didn't survive it: %+v", st.Changes)
	}
	if st.Index.Lines != 1 {
		t.Fatalf("index lines = %d, want 1 after the apply", st.Index.Lines)
	}
	if _, err := os.Stat(filepath.Join(folder, "a.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a.md should be deleted: %v", err)
	}
}

func TestCheckSharingProjectProducesSplit(t *testing.T) {
	env := checkTestSetup(t)
	_, shared, own := checkTestSharing(t, env)

	checkTestRun(t, env, "ca")

	st := checkTestLoad(t, "ca")
	byGroup := map[string][]string{}
	for _, c := range st.Changes {
		byGroup[c.Group] = append(byGroup[c.Group], c.Kind)
	}
	want := map[string][]string{"shared": {"move-here"}, "switch": {"settings"}, "own": {"delete"}}
	if fmt.Sprint(byGroup) != fmt.Sprint(want) {
		t.Fatalf("changes by group = %v, want %v", byGroup, want)
	}
	move := checkTestFind(t, st, "move-here")
	if move.Op.Memories[0] != "hk.md" || move.Op.ToFolder != own {
		t.Fatalf("move = %+v", move.Op)
	}
	if st.Folder != shared || st.OwnFolder != own || fmt.Sprint(st.SharedWith) != "[det]" || st.OwnIndex == nil {
		t.Fatalf("folder/own/sharedwith/ownindex = %q/%q/%v/%v", st.Folder, st.OwnFolder, st.SharedWith, st.OwnIndex)
	}
	if len(st.Sort) != 2 || st.Sort["hk.md"].Sha256 == "" {
		t.Fatalf("sort not stored: %+v", st.Sort)
	}

	// a stored sort isn't asked again
	checkTestRun(t, env, "ca")
	sorts := 0
	for _, p := range env.prompts {
		if strings.HasPrefix(p, checkTestSortPrefix) {
			sorts++
		}
	}
	if sorts != 1 {
		t.Fatalf("an unchanged shared folder was sorted %d times", sorts)
	}
}

func TestCheckSortMissingMemoryFails(t *testing.T) {
	env := checkTestSetup(t)
	checkTestSharing(t, env)
	env.setReply(func(p string) (string, error) {
		if strings.HasPrefix(p, checkTestSortPrefix) {
			return `{"sort": {"hk.md": ["ca"]}}`, nil
		}
		return checkTestNoChanges, nil
	})

	if err := runCheck(context.Background(), "ca", env.claudeHome); err == nil {
		t.Fatal("a sort that leaves out a memory must fail the check")
	}
	st := checkTestLoad(t, "ca")
	if !strings.Contains(st.LastError, "det.md") || len(st.Changes) != 0 {
		t.Fatalf("lasterror/changes = %q/%+v", st.LastError, st.Changes)
	}
}

func TestCheckRemoveSharedPerMemory(t *testing.T) {
	env := checkTestSetup(t)
	repo := initRepo(t)
	commit(t, repo, "subprojects", map[string]string{"x/a": "x\n", "y/a": "y\n", "z/a": "z\n"})
	var shared string
	for _, name := range []string{"x", "y", "z"} {
		shared = env.project(t, name, filepath.Join(repo, name))
	}
	writeFile(t, filepath.Join(shared, "MEMORY.md"), "- [A](A.md) — for x and y\n- [B](B.md) — for z\n")
	writeFile(t, filepath.Join(shared, "A.md"), "a\n")
	writeFile(t, filepath.Join(shared, "B.md"), "b\n")
	for name, at := range map[string]int64{"x": 100, "y": 200} {
		own := filepath.Join(t.TempDir(), name+"-memory")
		if err := os.MkdirAll(own, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := SetAutoMemoryDirectory(filepath.Join(repo, name, ".claude", "settings.local.json"), own); err != nil {
			t.Fatal(err)
		}
		if _, err := Update(name, func(st *State) error {
			st.FormerShared, st.SwitchedAt = shared, at
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	env.setReply(func(p string) (string, error) {
		if strings.HasPrefix(p, checkTestSortPrefix) {
			return `{"sort": {"A.md": ["x", "y"], "B.md": ["z"]}}`, nil
		}
		return checkTestNoChanges, nil
	})

	checkTestRun(t, env, "x")
	checkTestRun(t, env, "y")

	if c := checkTestLoad(t, "x").Changes; len(c) != 0 {
		t.Fatalf("x switched first, so it lists no removal: %+v", c)
	}
	st := checkTestLoad(t, "y")
	if len(st.Changes) != 1 {
		t.Fatalf("y switched last: want one removal, got %+v", st.Changes)
	}
	c := st.Changes[0]
	if c.Kind != "remove-shared" || c.Group != "shared" || fmt.Sprint(c.Op.Memories) != "[A.md]" {
		t.Fatalf("removal = %+v", c)
	}
	if c.IndexDelta != (wshrpc.MemIndexDelta{}) {
		t.Fatalf("a removal edits the shared index, not y's: delta %+v", c.IndexDelta)
	}
}

func TestDecideApplyConflict(t *testing.T) {
	env := checkTestSetup(t)
	folder := checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	checkTestRun(t, env, "p")
	c := checkTestLoad(t, "p").Changes[0]
	path := filepath.Join(folder, "a.md")
	writeFile(t, path, "edited by hand\n")

	p := checkTestDecide(t, "p", c.Id, "apply")

	got := p.Changes[0]
	if got.Status != "conflict" || got.ConflictFile != path || got.ApplyId != "" {
		t.Fatalf("status/conflictfile/applyid = %q/%q/%q", got.Status, got.ConflictFile, got.ApplyId)
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "edited by hand\n" {
		t.Fatalf("the edited file was touched: %q, %v", data, err)
	}
}

func TestDecideSettingsGated(t *testing.T) {
	env := checkTestSetup(t)
	repo, shared, _ := checkTestSharing(t, env)
	checkTestRun(t, env, "ca")
	st := checkTestLoad(t, "ca")
	settings, move := checkTestFind(t, st, "settings"), checkTestFind(t, st, "move-here")

	if _, err := Decide("ca", settings.Id, "apply"); err == nil {
		t.Fatal("the switch-over applied while a shared change was still to review")
	}
	settingsPath := filepath.Join(repo, "ca", ".claude", "settings.local.json")
	if _, err := os.Stat(settingsPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a refused switch wrote the settings file: %v", err)
	}

	checkTestDecide(t, "ca", move.Id, "keep")
	p := checkTestDecide(t, "ca", settings.Id, "apply")
	if p.FormerShared != shared || p.SwitchedAt == 0 {
		t.Fatalf("formershared/switchedat = %q/%d", p.FormerShared, p.SwitchedAt)
	}
	data, err := os.ReadFile(settingsPath)
	if err != nil || !strings.Contains(string(data), "autoMemoryDirectory") {
		t.Fatalf("settings file = %q, %v", data, err)
	}
}

func TestDecideUndoSettingsClearsSwitch(t *testing.T) {
	env := checkTestSetup(t)
	repo, _, _ := checkTestSharing(t, env)
	checkTestRun(t, env, "ca")
	st := checkTestLoad(t, "ca")
	settings := checkTestFind(t, st, "settings")
	checkTestDecide(t, "ca", checkTestFind(t, st, "move-here").Id, "keep")
	checkTestDecide(t, "ca", settings.Id, "apply")

	p := checkTestDecide(t, "ca", settings.Id, "undo")

	if p.FormerShared != "" || p.SwitchedAt != 0 {
		t.Fatalf("undo left the switch recorded: %q/%d", p.FormerShared, p.SwitchedAt)
	}
	for _, c := range p.Changes {
		if c.Id == settings.Id && c.Status != "open" {
			t.Fatalf("undone settings change is %q, want open", c.Status)
		}
	}
	if _, err := os.Stat(filepath.Join(repo, "ca", ".claude", "settings.local.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("undo left the settings file: %v", err)
	}
}

func TestDecideUndoRemeasuresIndex(t *testing.T) {
	env := checkTestSetup(t)
	folder := checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	checkTestRun(t, env, "p")
	c := checkTestLoad(t, "p").Changes[0]

	p := checkTestDecide(t, "p", c.Id, "apply")
	if p.Index.Lines != 1 || p.Changes[0].Status != "applied" {
		t.Fatalf("after apply: index %+v, status %q", p.Index, p.Changes[0].Status)
	}
	p = checkTestDecide(t, "p", c.Id, "undo")
	if p.Index.Lines != 2 || p.Changes[0].Status != "open" || p.Changes[0].ApplyId != "" {
		t.Fatalf("after undo: index %+v, change %+v", p.Index, p.Changes[0])
	}
	if _, err := os.Stat(filepath.Join(folder, "a.md")); err != nil {
		t.Fatalf("undo didn't restore a.md: %v", err)
	}
}

func TestDecideRefusesUnknown(t *testing.T) {
	env := checkTestSetup(t)
	checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	checkTestRun(t, env, "p")
	id := checkTestLoad(t, "p").Changes[0].Id

	if _, err := Decide("p", id, "approve"); err == nil || !strings.Contains(err.Error(), `"approve"`) {
		t.Fatalf("unknown verdict: %v", err)
	}
	if _, err := Decide("p", "nope", "keep"); err == nil || !strings.Contains(err.Error(), "nope") {
		t.Fatalf("unknown change id: %v", err)
	}
	if _, err := Decide("p", id, "undo"); err == nil {
		t.Fatal("undo of a change that isn't applied must fail")
	}
}
