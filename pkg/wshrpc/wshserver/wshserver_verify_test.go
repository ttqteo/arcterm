// pkg/wshrpc/wshserver/wshserver_verify_test.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/verifyruns"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// the rpc dispatcher finds a command by its method name: until these exist every Verify call answers "command not
// implemented". Checked at compile time, so a rename of either side breaks the build of the tests.
var _ wshrpc.VerifyCommands = (*WshServer)(nil)

// verifyFixture is a Verify store in a temp dir that the server reads, and the block ids its change hook named.
type verifyFixture struct {
	store *verifyruns.Store
	dir   string
	mu    sync.Mutex
	saw   []string
}

func (f *verifyFixture) published() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.saw...)
}

func useVerifyStore(t *testing.T) *verifyFixture {
	t.Helper()
	f := &verifyFixture{dir: t.TempDir()}
	f.store = verifyruns.NewStore(f.dir)
	f.store.SetOnChange(func(blockId string) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.saw = append(f.saw, blockId)
	})
	SetVerifyStore(f.store)
	t.Cleanup(func() { SetVerifyStore(nil) })
	return f
}

// verifyBlock makes a block in the object store: a report is kept only for a block that exists.
func verifyBlock(t *testing.T) string {
	t.Helper()
	blockId := uuid.NewString()
	block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + uuid.NewString()}
	if err := wstore.DBInsert(context.Background(), block); err != nil {
		t.Fatal(err)
	}
	return blockId
}

func verifyGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func verifyWrite(t *testing.T, dir, rel, body string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// verifyRepo is a repo on main with a Verify config watching ui/*.tsx and a committed ui/a.tsx.
func verifyRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	verifyGit(t, dir, "init", "-q", "-b", "main")
	verifyWrite(t, dir, ".arc/verify.json", `{"watch":["ui/**/*.tsx"],"rerun":"task verify:ui -- <name>"}`)
	verifyWrite(t, dir, "ui/a.tsx", "a\n")
	verifyGit(t, dir, "add", ".")
	verifyGit(t, dir, "commit", "-q", "-m", "init")
	return dir
}

func endReport(blockId, runId, scenario string, steps ...wshrpc.VerifyStepData) wshrpc.CommandVerifyReportData {
	return wshrpc.CommandVerifyReportData{
		BlockId: blockId, RunId: runId, Phase: verifyruns.PhaseEnd, Command: "task verify:ui -- " + scenario,
		ShotsDir: "/shots/" + runId,
		Scenarios: []wshrpc.VerifyScenarioData{{
			Name: scenario, Files: []string{"01.png", "02.png"}, Steps: steps, Done: true,
		}},
	}
}

func pass(step string) wshrpc.VerifyStepData { return wshrpc.VerifyStepData{Step: step, State: "pass"} }
func fail(step string) wshrpc.VerifyStepData { return wshrpc.VerifyStepData{Step: step, State: "fail"} }

func TestVerifyReportThenState(t *testing.T) {
	f := useVerifyStore(t)
	ctx := context.Background()
	ws := &WshServer{}
	blockId := verifyBlock(t)
	repo := verifyRepo(t)

	start := wshrpc.CommandVerifyReportData{
		BlockId: blockId, RunId: "run-1", Phase: verifyruns.PhaseStart, Pid: os.Getpid(), Cwd: repo,
		Scenarios: []wshrpc.VerifyScenarioData{{Name: "rail-verify"}},
	}
	if err := ws.VerifyReportCommand(ctx, start); err != nil {
		t.Fatal(err)
	}
	st, err := ws.GetVerifyStateCommand(ctx, wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: repo})
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Rows) != 1 || st.Rows[0].State != verifyruns.StateRunning || st.Verdict != verifyruns.VerdictRunning {
		t.Fatalf("a started run (this process is its pid): %+v", st)
	}
	if st.Rows[0].Of != 1 || st.Rows[0].Done != 0 {
		t.Fatalf("running row done/of = %d/%d, want 0/1", st.Rows[0].Done, st.Rows[0].Of)
	}

	end := endReport(blockId, "run-1", "rail-verify", pass("1. opens"), pass("2. shows the tile"), fail("3. skips"))
	if err := ws.VerifyReportCommand(ctx, end); err != nil {
		t.Fatal(err)
	}
	st, err = ws.GetVerifyStateCommand(ctx, wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: repo})
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Rows) != 1 {
		t.Fatalf("rows: %+v", st.Rows)
	}
	row := st.Rows[0]
	if row.Scenario != "rail-verify" || row.State != verifyruns.StateFailed || row.Passed != 2 || row.Total != 3 {
		t.Fatalf("row: %+v", row)
	}
	if len(row.Failed) != 1 || row.Failed[0] != "3. skips" {
		t.Fatalf("failed texts: %+v", row.Failed)
	}
	if row.Command != "task verify:ui -- rail-verify" || row.ShotsDir != "/shots/run-1" || row.Shots != 2 {
		t.Fatalf("row carries its command, shots dir and shot count: %+v", row)
	}
	if row.Started == 0 || row.Ended == 0 || row.Ended < row.Started {
		t.Fatalf("started %d ended %d: want ms, ended not before started", row.Started, row.Ended)
	}
	if st.Verdict != verifyruns.VerdictRed {
		t.Fatalf("verdict %q, want red", st.Verdict)
	}
	if got := f.published(); len(got) != 2 || got[0] != blockId || got[1] != blockId {
		t.Fatalf("change hook ran for %v, want the block twice", got)
	}
}

func TestVerifyReportForAnUnknownBlockIsDropped(t *testing.T) {
	f := useVerifyStore(t)
	ws := &WshServer{}
	gone := uuid.NewString() // a block that was never made, or has closed since
	err := ws.VerifyReportCommand(context.Background(), endReport(gone, "run-1", "a", pass("1. x")))
	if err != nil {
		t.Fatalf("a report for a block that no longer exists is dropped without an error: %v", err)
	}
	if entries, _ := os.ReadDir(f.dir); len(entries) != 0 {
		t.Fatalf("a dropped report left %d file(s) in the store", len(entries))
	}
	if got := f.published(); len(got) != 0 {
		t.Fatalf("a dropped report told the cockpit about %v", got)
	}
}

// the cockpit draws `rows` as an array: a nil slice would marshal to null and break its model
func TestVerifyStateRowsAreNeverNull(t *testing.T) {
	useVerifyStore(t)
	ws := &WshServer{}
	blockId := verifyBlock(t)
	bare := t.TempDir() // not a repo: nothing opted in
	for name, cwd := range map[string]string{"no repo": bare, "no cwd": ""} {
		st, err := ws.GetVerifyStateCommand(context.Background(), wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: cwd})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if st == nil || st.Rows == nil || len(st.Rows) != 0 || st.Verdict != "" || st.NotRun {
			t.Fatalf("%s: state %+v, want an empty one with a non-nil rows slice", name, st)
		}
		raw, _ := json.Marshal(st)
		if !strings.Contains(string(raw), `"rows":[]`) {
			t.Fatalf("%s: wire %s has no empty rows array", name, raw)
		}
	}
}

// watched files changed and no scenario ran: the not-run line, with the files newest first and the project's rerun
func TestVerifyStateNotRunCarriesTheChangedFilesAndRerun(t *testing.T) {
	useVerifyStore(t)
	ws := &WshServer{}
	blockId := verifyBlock(t)
	repo := verifyRepo(t)
	verifyWrite(t, repo, "ui/a.tsx", "edited\n")
	verifyWrite(t, repo, "ui/new.tsx", "new\n")

	st, err := ws.GetVerifyStateCommand(context.Background(), wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: repo})
	if err != nil {
		t.Fatal(err)
	}
	if !st.NotRun || st.NotRunSkipped || len(st.Rows) != 0 || st.Verdict != verifyruns.VerdictAmber {
		t.Fatalf("state %+v, want not run, not skipped, no rows, amber", st)
	}
	if len(st.Changed) != 2 {
		t.Fatalf("changed %v, want both watched files", st.Changed)
	}
	if st.Rerun != "task verify:ui -- <name>" {
		t.Fatalf("rerun %q, want the config's command", st.Rerun)
	}
}

// a skip sets the row aside and tells the cockpit; undo brings it back
func TestVerifySkipSetsARowAsideAndPublishes(t *testing.T) {
	f := useVerifyStore(t)
	ctx := context.Background()
	ws := &WshServer{}
	blockId := verifyBlock(t)
	repo := verifyRepo(t)
	if err := ws.VerifyReportCommand(ctx, endReport(blockId, "run-1", "rail-verify", fail("1. x"))); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond) // a skip counts only when it is later than the run, in ms
	published := len(f.published())

	if err := ws.VerifySkipCommand(ctx, wshrpc.CommandVerifySkipData{BlockId: blockId, Scenario: "rail-verify"}); err != nil {
		t.Fatal(err)
	}
	st, err := ws.GetVerifyStateCommand(ctx, wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: repo})
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Rows) != 1 || st.Rows[0].State != verifyruns.StateSkipped || st.Verdict != verifyruns.VerdictPassed {
		t.Fatalf("a skipped failed row: %+v", st)
	}
	if got := f.published(); len(got) != published+1 || got[len(got)-1] != blockId {
		t.Fatalf("a skip told the cockpit about %v, want one more for the block", got)
	}

	if err := ws.VerifySkipCommand(ctx, wshrpc.CommandVerifySkipData{BlockId: blockId, Scenario: "rail-verify", Undo: true}); err != nil {
		t.Fatal(err)
	}
	st, err = ws.GetVerifyStateCommand(ctx, wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: repo})
	if err != nil {
		t.Fatal(err)
	}
	if st.Rows[0].State != verifyruns.StateFailed || st.Verdict != verifyruns.VerdictRed {
		t.Fatalf("after Undo: %+v", st)
	}
}

func TestVerifySkipForAnUnknownBlockIsDropped(t *testing.T) {
	f := useVerifyStore(t)
	ws := &WshServer{}
	err := ws.VerifySkipCommand(context.Background(), wshrpc.CommandVerifySkipData{BlockId: uuid.NewString(), Scenario: "a"})
	if err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(f.dir); len(entries) != 0 {
		t.Fatalf("a dropped skip left %d file(s) in the store", len(entries))
	}
}

func TestVerifyGateAsksOnlyOnTheDefaultBranch(t *testing.T) {
	useVerifyStore(t)
	ctx := context.Background()
	ws := &WshServer{}
	blockId := verifyBlock(t)
	repo := verifyRepo(t) // on main, the default branch
	if err := ws.VerifyReportCommand(ctx, endReport(blockId, "run-1", "rail-verify",
		pass("1. a"), pass("2. b"), fail("7. c"), fail("8. d"))); err != nil {
		t.Fatal(err)
	}
	gate := wshrpc.CommandVerifyGateData{BlockId: blockId, Cwd: repo, Command: "git merge wave/x"}

	got, err := ws.VerifyGateCommand(ctx, gate)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Ask || got.Reason != "Verify: rail-verify failed steps 7, 8. Merge anyway?" {
		t.Fatalf("on main with a red verdict: %+v", got)
	}

	verifyGit(t, repo, "switch", "-q", "-c", "feature")
	got, err = ws.VerifyGateCommand(ctx, gate)
	if err != nil {
		t.Fatal(err)
	}
	if got.Ask || got.Reason != "" {
		t.Fatalf("a merge on a branch that is not the default one must never ask: %+v", got)
	}
}

// a skipped row counts as passed, so the gate lets a merge through
func TestVerifyGateDoesNotAskForAPassedOrSkippedVerify(t *testing.T) {
	useVerifyStore(t)
	ctx := context.Background()
	ws := &WshServer{}
	blockId := verifyBlock(t)
	repo := verifyRepo(t)
	gate := wshrpc.CommandVerifyGateData{BlockId: blockId, Cwd: repo, Command: "git merge wave/x"}

	if got, err := ws.VerifyGateCommand(ctx, gate); err != nil || got.Ask {
		t.Fatalf("nothing changed, nothing ran: %+v %v", got, err)
	}
	if err := ws.VerifyReportCommand(ctx, endReport(blockId, "run-1", "a", pass("1. x"))); err != nil {
		t.Fatal(err)
	}
	if got, err := ws.VerifyGateCommand(ctx, gate); err != nil || got.Ask {
		t.Fatalf("a passed run: %+v %v", got, err)
	}

	// a failed run asks; once the person skips that row, the merge goes through
	if err := ws.VerifyReportCommand(ctx, endReport(blockId, "run-2", "b", fail("4. y"))); err != nil {
		t.Fatal(err)
	}
	if got, err := ws.VerifyGateCommand(ctx, gate); err != nil || !got.Ask {
		t.Fatalf("a failed run: %+v %v", got, err)
	}
	time.Sleep(5 * time.Millisecond) // a skip counts only when it is later than the run, in ms
	if err := ws.VerifySkipCommand(ctx, wshrpc.CommandVerifySkipData{BlockId: blockId, Scenario: "b"}); err != nil {
		t.Fatal(err)
	}
	if got, err := ws.VerifyGateCommand(ctx, gate); err != nil || got.Ask {
		t.Fatalf("a failed run the person skipped: %+v %v", got, err)
	}
}

// the gate and the tile read one rule: a change after a passed run is an out-of-date row, and both ask
func TestVerifyGateAndTileAgreeOnOutOfDate(t *testing.T) {
	useVerifyStore(t)
	ctx := context.Background()
	ws := &WshServer{}
	blockId := verifyBlock(t)
	repo := verifyRepo(t)
	if err := ws.VerifyReportCommand(ctx, endReport(blockId, "run-1", "a", pass("1. x"))); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	verifyWrite(t, repo, "ui/a.tsx", "edited after the run\n")

	st, err := ws.GetVerifyStateCommand(ctx, wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: repo})
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Rows) != 1 || st.Rows[0].State != verifyruns.StateOutOfDate || st.Rows[0].ChangedFile != "ui/a.tsx" || st.Verdict != verifyruns.VerdictAmber {
		t.Fatalf("state %+v, want one out-of-date row naming ui/a.tsx, amber", st)
	}
	got, err := ws.VerifyGateCommand(ctx, wshrpc.CommandVerifyGateData{BlockId: blockId, Cwd: repo, Command: "git merge wave/x"})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Ask || !strings.Contains(got.Reason, "a passed before ui/a.tsx changed") {
		t.Fatalf("gate: %+v", got)
	}
}

func TestVerifyChangedEventNamesTheBlock(t *testing.T) {
	ev := verifyChangedEvent("blk-1")
	data, ok := ev.Data.(wshrpc.VerifyChangedData)
	if ev.Event != wps.Event_VerifyChanged || !ok || data.BlockId != "blk-1" {
		t.Fatalf("event %+v", ev)
	}
}

// a server that never started Verify answers with an error and does not panic
func TestVerifyCommandsWithoutAStoreError(t *testing.T) {
	SetVerifyStore(nil)
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.VerifyReportCommand(ctx, wshrpc.CommandVerifyReportData{BlockId: uuid.NewString(), RunId: "r", Phase: "start"}); err == nil {
		t.Fatal("report with no store: want an error")
	}
	if _, err := ws.GetVerifyStateCommand(ctx, wshrpc.CommandVerifyStateData{BlockId: "b"}); err == nil {
		t.Fatal("state with no store: want an error")
	}
	if err := ws.VerifySkipCommand(ctx, wshrpc.CommandVerifySkipData{BlockId: "b"}); err == nil {
		t.Fatal("skip with no store: want an error")
	}
	if _, err := ws.VerifyGateCommand(ctx, wshrpc.CommandVerifyGateData{BlockId: "b"}); err == nil {
		t.Fatal("gate with no store: want an error")
	}
}
