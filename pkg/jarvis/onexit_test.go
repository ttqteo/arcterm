// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestOutcomeSummary(t *testing.T) {
	t.Run("prefers the last event text", func(t *testing.T) {
		sess := &agentsessions.SessionInfo{
			Task: "the task",
			Events: []agentsessions.SessionEvent{
				{Text: "started"},
				{Text: "finished cleanly"},
			},
		}
		if got := outcomeSummary(sess); got != "finished cleanly" {
			t.Errorf("got %q, want last event text", got)
		}
	})

	t.Run("falls back to the task when there are no events", func(t *testing.T) {
		sess := &agentsessions.SessionInfo{Task: "the task"}
		if got := outcomeSummary(sess); got != "the task" {
			t.Errorf("got %q, want the task", got)
		}
	})

	t.Run("falls back to the task when the last event text is empty", func(t *testing.T) {
		sess := &agentsessions.SessionInfo{
			Task:   "the task",
			Events: []agentsessions.SessionEvent{{Text: "started"}, {Text: ""}},
		}
		if got := outcomeSummary(sess); got != "the task" {
			t.Errorf("got %q, want the task fallback", got)
		}
	})

	t.Run("truncates to 160 chars", func(t *testing.T) {
		long := strings.Repeat("x", 200)
		sess := &agentsessions.SessionInfo{Events: []agentsessions.SessionEvent{{Text: long}}}
		if got := outcomeSummary(sess); len(got) != 160 {
			t.Errorf("got len %d, want 160", len(got))
		}
	})
}

// Guards J5: abnormal exit paths must log — a silent outcome is indistinguishable from
// "worker produced nothing". Uses an unknown block id to force the block-load failure branch.
func TestOnWorkerExit_LogsUnreadableBlock(t *testing.T) {
	var buf bytes.Buffer
	oldOut := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(oldOut)

	OnWorkerExit("no-such-block", 0)

	if !strings.Contains(buf.String(), "jarvis onexit") {
		t.Fatalf("expected failure log, got %q", buf.String())
	}
}

// The documented-normal no-transcript path stays silent.
func TestOnWorkerExit_NoTranscriptStaysSilent(t *testing.T) {
	ctx := context.Background()
	tabOID, blockOID := uuid.NewString(), uuid.NewString()
	tabORef := waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabOID, BlockIds: []string{blockOID}, Meta: waveobj.MetaMapType{"session:agent": "claude"}}); err != nil {
		t.Fatalf("seed tab: %v", err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockOID, ParentORef: tabORef, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatalf("seed block: %v", err)
	}
	var buf bytes.Buffer
	oldOut := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(oldOut)

	OnWorkerExit(blockOID, 0)

	if strings.Contains(buf.String(), "jarvis onexit") {
		t.Fatalf("normal no-transcript path should not log: %q", buf.String())
	}
}

// An agent that exits non-zero having stamped no transcript died before its first token (rejected
// model, missing entitlement, auth failure). Nothing else can see it: liveness has no mtime to age,
// so the work reads healthy until the stall threshold expires. This is the signal that used to be
// discarded at the same early return that skips ordinary non-agent blocks.
func TestExitOutcomeReportsDeathBeforeFirstToken(t *testing.T) {
	data, ok := exitOutcome("", "codex", 1)
	if !ok {
		t.Fatal("a non-zero exit with no transcript must be reported")
	}
	if data.Status != "failed" {
		t.Fatalf("want failed, got %q", data.Status)
	}
	if !data.NoTranscript {
		t.Fatal("NoTranscript must mark the outcome the transcript cannot describe")
	}
	if data.ExitCode != 1 {
		t.Fatalf("want the exit code carried through, got %d", data.ExitCode)
	}
	if !strings.Contains(data.Summary, "first token") {
		t.Fatalf("summary must say what happened, got %q", data.Summary)
	}
}

// A clean exit with no transcript is a runtime whose reporter hook is not installed, not a failure.
// Reporting those would turn every hook-less agent exit into a spurious failure.
func TestExitOutcomeIgnoresCleanExitWithoutTranscript(t *testing.T) {
	if _, ok := exitOutcome("", "codex", 0); ok {
		t.Fatal("a clean exit with no transcript must stay silent")
	}
}

// a lead can exit before its transcript exists on disk; its run still has to learn that it is gone
func TestOnWorkerExitReportsALeadExitBeforeTheTranscriptParses(t *testing.T) {
	ctx := context.Background()
	tabOID, blockOID := uuid.NewString(), uuid.NewString()
	tabORef := waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabOID, BlockIds: []string{blockOID}, Meta: waveobj.MetaMapType{"session:agent": "claude"}}); err != nil {
		t.Fatalf("seed tab: %v", err)
	}
	block := &waveobj.Block{OID: blockOID, ParentORef: tabORef, Meta: waveobj.MetaMapType{
		waveobj.MetaKey_AgentTranscriptPath: filepath.Join(t.TempDir(), "never-written.jsonl"),
	}}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatalf("seed block: %v", err)
	}
	old := RunWorkerExitHook
	t.Cleanup(func() { RunWorkerExitHook = old })
	var got []string
	RunWorkerExitHook = func(_ context.Context, worker string, _ WorkerExit) error {
		got = append(got, worker)
		return nil
	}

	OnWorkerExit(blockOID, 0)

	if len(got) != 1 || got[0] != tabORef {
		t.Fatalf("run worker exit hook calls = %v, want [%s]", got, tabORef)
	}
}

// seedDispatchedWorker seeds a claude worker tab whose block stamps a finished transcript, dispatched from a
// channel, and returns the block and channel ids.
func seedDispatchedWorker(t *testing.T) (string, string) {
	t.Helper()
	ctx := context.Background()
	tpath := filepath.Join(t.TempDir(), "session.jsonl")
	transcript := `{"type":"user","cwd":"/repo","message":{"content":"do the thing"}}` + "\n" +
		`{"type":"assistant","message":{"model":"claude-opus","content":[{"type":"text","text":"done."}]}}` + "\n"
	if err := os.WriteFile(tpath, []byte(transcript), 0o644); err != nil {
		t.Fatalf("write transcript: %v", err)
	}
	tabOID, blockOID := uuid.NewString(), uuid.NewString()
	worker := waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabOID, BlockIds: []string{blockOID}, Meta: waveobj.MetaMapType{"session:agent": "claude"}}); err != nil {
		t.Fatalf("seed tab: %v", err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockOID, ParentORef: worker, Meta: waveobj.MetaMapType{waveobj.MetaKey_AgentTranscriptPath: tpath}}); err != nil {
		t.Fatalf("seed block: %v", err)
	}
	ch, err := wstore.CreateChannel(ctx, "onexit-dispatch", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, err := wstore.PostChannelMessage(ctx, ch.OID, wstore.NewChannelMessage("dispatch", "claude", "do the thing", worker, 10)); err != nil {
		t.Fatalf("post dispatch: %v", err)
	}
	return blockOID, ch.OID
}

func channelHasOutcome(t *testing.T, channelOID string) bool {
	t.Helper()
	msgs, err := wstore.GetChannelMessages(context.Background(), channelOID, 0, 0)
	if err != nil {
		t.Fatalf("load messages: %v", err)
	}
	for _, m := range msgs {
		if m.Kind == "outcome" {
			return true
		}
	}
	return false
}

func TestOnWorkerExitPostsTheOutcomeWhenTheHookOutlivesTheDeadline(t *testing.T) {
	blockOID, channelOID := seedDispatchedWorker(t)
	// wide enough for the exit's own reads, which include a cold scan of every channel; only the hook may outlive it
	oldTimeout := exitReadTimeout
	exitReadTimeout = time.Second
	t.Cleanup(func() { exitReadTimeout = oldTimeout })
	oldHook := ChildOutcomeHook
	t.Cleanup(func() { ChildOutcomeHook = oldHook })
	ChildOutcomeHook = func(ctx context.Context, _ string, _ OutcomeData) error {
		<-ctx.Done() // a dag lock held past the exit's deadline
		return nil
	}

	OnWorkerExit(blockOID, 0)

	if !channelHasOutcome(t, channelOID) {
		t.Fatal("the outcome was not posted to the dispatch channel")
	}
}

// reapOnExit makes the run worker exit hook delete the worker's tab, as a merge's concurrent reap can after
// OnWorkerExit reads the tab and before it resolves the dispatch channel.
func reapOnExit(t *testing.T, tabOID string) {
	t.Helper()
	oldHook := RunWorkerExitHook
	t.Cleanup(func() { RunWorkerExitHook = oldHook })
	RunWorkerExitHook = func(context.Context, string, WorkerExit) error {
		return wstore.DBDelete(context.Background(), waveobj.OType_Tab, tabOID)
	}
}

// an engine worker has no dispatch message, so it never gets a channel outcome; its reaped exit is normal, not
// a lost outcome, and must not log as one (run 6c7652be's t-2 and t-3)
func TestAReapedEngineWorkersExitPostsNothingAndLogsNothing(t *testing.T) {
	ctx := context.Background()
	tpath := filepath.Join(t.TempDir(), "session.jsonl")
	transcript := `{"type":"user","cwd":"/repo","message":{"content":"do the thing"}}` + "\n" +
		`{"type":"assistant","message":{"model":"claude-opus","content":[{"type":"text","text":"done."}]}}` + "\n"
	if err := os.WriteFile(tpath, []byte(transcript), 0o644); err != nil {
		t.Fatal(err)
	}
	tabOID, blockOID := uuid.NewString(), uuid.NewString()
	worker := waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabOID, BlockIds: []string{blockOID}, Meta: waveobj.MetaMapType{"session:agent": "claude"}}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockOID, ParentORef: worker, Meta: waveobj.MetaMapType{waveobj.MetaKey_AgentTranscriptPath: tpath}}); err != nil {
		t.Fatal(err)
	}
	ch, err := wstore.CreateChannel(ctx, "onexit-engine-worker", "/p")
	if err != nil {
		t.Fatal(err)
	}
	runORef := waveobj.MakeORef(waveobj.OType_Run, uuid.NewString()).String()
	if err := wstore.StampWorkerOwner(ctx, worker, runORef, waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String()); err != nil {
		t.Fatal(err)
	}
	reapOnExit(t, tabOID)
	var buf bytes.Buffer
	oldOut := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(oldOut)

	OnWorkerExit(blockOID, 0)
	// the reap's DBDelete logs from a goroutine of its own: stop capturing before reading the buffer
	log.SetOutput(oldOut)

	if channelHasOutcome(t, ch.OID) {
		t.Fatal("an engine worker never gets a channel outcome")
	}
	if strings.Contains(buf.String(), "jarvis onexit") {
		t.Fatalf("a reaped engine worker's exit is normal and must not log: %q", buf.String())
	}
}

// a worker a channel dispatched keeps its outcome when the reap deletes its tab before the channel is resolved
func TestADispatchedWorkersOutcomeSurvivesTheReap(t *testing.T) {
	blockOID, channelOID := seedDispatchedWorker(t)
	tabOID, err := wstore.DBFindTabForBlockId(context.Background(), blockOID)
	if err != nil {
		t.Fatal(err)
	}
	reapOnExit(t, tabOID)

	OnWorkerExit(blockOID, 0)

	if !channelHasOutcome(t, channelOID) {
		t.Fatal("the outcome was not posted to the dispatching channel")
	}
}

func TestOutputTailKeepsTheLastPlainLines(t *testing.T) {
	raw := "\x1b[31merror: unknown option '--session-id'\x1b[0m\r\n\r\n  try --help  \r\n[command exited (exit code 1)]\r\n"
	want := "error: unknown option '--session-id'\ntry --help\n[command exited (exit code 1)]"
	if got := outputTail(raw); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}

	var long strings.Builder
	for i := 0; i < workerOutputMaxLines+5; i++ {
		fmt.Fprintf(&long, "line %d\n", i)
	}
	lines := strings.Split(outputTail(long.String()), "\n")
	if len(lines) != workerOutputMaxLines || lines[len(lines)-1] != fmt.Sprintf("line %d", workerOutputMaxLines+4) {
		t.Fatalf("want the last %d lines, got %d ending %q", workerOutputMaxLines, len(lines), lines[len(lines)-1])
	}

	if got := outputTail(strings.Repeat("é", workerOutputMaxBytes)); len(got) > workerOutputMaxBytes || !utf8.ValidString(got) {
		t.Fatalf("a long line is cut to %d valid bytes, got %d", workerOutputMaxBytes, len(got))
	}
}

// an agent worker's tab closes itself two seconds after a failing exit and takes its terminal with it, so the
// exit hook is handed what the worker printed. Run d8fe96ab's t-2 exited 1 a second after its spawn and left
// no account of why.
func TestOnWorkerExitHandsAFailingWorkersOutputToTheRun(t *testing.T) {
	ctx := context.Background()
	seed := func() (string, string) {
		tabOID, blockOID := uuid.NewString(), uuid.NewString()
		tabORef := waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
		if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabOID, BlockIds: []string{blockOID}, Meta: waveobj.MetaMapType{"session:agent": "claude"}}); err != nil {
			t.Fatalf("seed tab: %v", err)
		}
		if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockOID, ParentORef: tabORef, Meta: waveobj.MetaMapType{}}); err != nil {
			t.Fatalf("seed block: %v", err)
		}
		return tabORef, blockOID
	}
	oldHook, oldRead, oldChild := RunWorkerExitHook, readWorkerTerminal, ChildOutcomeHook
	t.Cleanup(func() { RunWorkerExitHook, readWorkerTerminal, ChildOutcomeHook = oldHook, oldRead, oldChild })
	ChildOutcomeHook = nil
	reads := 0
	readWorkerTerminal = func(context.Context, string) ([]byte, error) {
		reads++
		return []byte("Error: session id already in use\r\n"), nil
	}
	got := map[string]WorkerExit{}
	RunWorkerExitHook = func(_ context.Context, worker string, exit WorkerExit) error {
		got[worker] = exit
		return nil
	}

	failed, failedBlock := seed()
	OnWorkerExit(failedBlock, 1)
	if want := (WorkerExit{ExitCode: 1, Output: "Error: session id already in use"}); got[failed] != want {
		t.Fatalf("a failing exit: got %+v, want %+v", got[failed], want)
	}

	clean, cleanBlock := seed()
	OnWorkerExit(cleanBlock, 0)
	if exit, heard := got[clean]; !heard || exit != (WorkerExit{}) || reads != 1 {
		t.Fatalf("a clean exit reads no terminal: got %+v heard=%v reads=%d", exit, heard, reads)
	}
}
