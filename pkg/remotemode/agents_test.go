// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
)

// agentsTestTyped records what remoteSendInput typed, one entry per write.
type agentsTestTyped struct {
	mu     sync.Mutex
	blocks []string
	writes []string
}

func (r *agentsTestTyped) get() ([]string, []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.blocks), slices.Clone(r.writes)
}

// agentsTestTail is a scripted TranscriptHook: it sends its backlog, then waits for the stream to end;
// exited closes when the last call returns.
type agentsTestTail struct {
	backlog []string
	calls   chan string
	exited  chan struct{}
}

func agentsTestRecordInput(t *testing.T) *agentsTestTyped {
	t.Helper()
	rec := &agentsTestTyped{}
	prev := remoteSendInput
	remoteSendInput = func(blockId string, in *blockcontroller.BlockInputUnion) error {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		rec.blocks = append(rec.blocks, blockId)
		rec.writes = append(rec.writes, string(in.InputData))
		return nil
	}
	t.Cleanup(func() { remoteSendInput = prev })
	return rec
}

func agentsTestScriptTail(t *testing.T, backlog ...string) *agentsTestTail {
	t.Helper()
	tail := &agentsTestTail{backlog: backlog, calls: make(chan string, 4), exited: make(chan struct{})}
	prev := TranscriptHook
	TranscriptHook = func(ctx context.Context, path string, _ int, send func([]string) error) error {
		defer close(tail.exited)
		tail.calls <- path
		if err := send(tail.backlog); err != nil {
			return err
		}
		<-ctx.Done()
		return nil
	}
	t.Cleanup(func() { TranscriptHook = prev })
	return tail
}

func agentsTestPoll(t *testing.T, d time.Duration) {
	t.Helper()
	prev := remoteStreamPoll
	remoteStreamPoll = d
	t.Cleanup(func() { remoteStreamPoll = prev })
}

func agentsTestWorking(tab string) Agent {
	a := handTestClaude(tab)
	a.Status.State = baseds.AgentState_Working
	a.Status.Hook = baseds.AgentHook_PreToolUse
	a.Status.Detail = "running node build.mjs"
	return a
}

func agentsTestPermission(tab string) Agent {
	a := handTestClaude(tab)
	a.Status.State = baseds.AgentState_Waiting
	a.Status.Hook = baseds.AgentHook_Notification
	a.Status.NotificationType = "permission_prompt"
	a.Status.Detail = "running ssh deploy@siem-236 'systemctl restart siem'"
	return a
}

func agentsTestInput(tab string) Agent {
	a := handTestClaude(tab)
	a.Status.State = baseds.AgentState_Waiting
	a.Status.Hook = baseds.AgentHook_Notification
	a.Status.NotificationType = "idle_prompt"
	return a
}

func agentsTestAsking(tab string) Agent {
	a := handTestClaude(tab)
	a.OpenAsk = true
	return a
}

const (
	agentsTestPaste = "\x1b[200~"
	agentsTestEnd   = "\x1b[201~"
)

func TestActionKeystrokes(t *testing.T) {
	handTestEnv(t, handTestClaude("tab-idle"), agentsTestWorking("tab-work"), agentsTestPermission("tab-perm"))
	for _, tab := range []string{"tab-idle", "tab-work", "tab-perm"} {
		handTestHand(t, tab)
	}
	cases := []struct {
		name string
		tab  string
		act  AgentAction
		want []string
	}{
		{"send multi-line", "tab-idle", AgentAction{Kind: ActionSend, Text: "first line\nsecond line"}, []string{agentsTestPaste + "first line\nsecond line" + agentsTestEnd, "\r"}},
		{"send mid-turn", "tab-work", AgentAction{Kind: ActionSend, Text: "also this"}, []string{agentsTestPaste + "also this" + agentsTestEnd, "\r"}},
		{"stop", "tab-work", AgentAction{Kind: ActionStop}, []string{"\x1b"}},
		{"approve", "tab-perm", AgentAction{Kind: ActionApprove}, []string{"1"}},
		{"deny", "tab-perm", AgentAction{Kind: ActionDeny}, []string{"\x1b"}},
		{"deny with text", "tab-perm", AgentAction{Kind: ActionDeny, Text: "use the staging host"}, []string{"\x1b", agentsTestPaste + "use the staging host" + agentsTestEnd, "\r"}},
	}
	for _, c := range cases {
		rec := agentsTestRecordInput(t)
		if err := remoteAct(context.Background(), c.tab, c.act); err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		blocks, writes := rec.get()
		if !slices.Equal(writes, c.want) {
			t.Errorf("%s: typed %q, want %q", c.name, writes, c.want)
		}
		for _, b := range blocks {
			if b != "blk-"+c.tab {
				t.Errorf("%s: typed into block %q, want blk-%s", c.name, b, c.tab)
			}
		}
	}
}

func TestActionRefusedOutsideState(t *testing.T) {
	handTestEnv(t, handTestClaude("tab-idle"), agentsTestWorking("tab-work"), agentsTestPermission("tab-perm"),
		agentsTestInput("tab-input"), agentsTestAsking("tab-ask"))
	for _, tab := range []string{"tab-idle", "tab-work", "tab-perm", "tab-input", "tab-ask"} {
		handTestHand(t, tab)
	}
	rec := agentsTestRecordInput(t)
	cases := []struct {
		tab string
		act AgentAction
	}{
		{"tab-work", AgentAction{Kind: ActionApprove}},
		{"tab-work", AgentAction{Kind: ActionDeny}},
		{"tab-perm", AgentAction{Kind: ActionSend, Text: "hi"}},
		{"tab-input", AgentAction{Kind: ActionSend, Text: "hi"}},
		{"tab-ask", AgentAction{Kind: ActionSend, Text: "hi"}},
		{"tab-idle", AgentAction{Kind: ActionStop}},
		{"tab-idle", AgentAction{Kind: ActionApprove}},
	}
	for _, c := range cases {
		if err := remoteAct(context.Background(), c.tab, c.act); !errors.Is(err, ErrWrongState) {
			t.Errorf("%s on %s = %v, want ErrWrongState", c.act.Kind, c.tab, err)
		}
	}
	if _, writes := rec.get(); len(writes) != 0 {
		t.Errorf("a refused action typed %q", writes)
	}
	var gone *GoneError
	if err := remoteAct(context.Background(), "tab-never", AgentAction{Kind: ActionStop}); !errors.As(err, &gone) {
		t.Errorf("an action on a tab never handed over = %v, want a *GoneError", err)
	}
}

func agentsTestTranscript(t *testing.T, text string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "session.jsonl")
	line := `{"type":"assistant","timestamp":"2026-11-03T10:00:00Z","message":{"content":[{"type":"text","text":` + text + `}]}}` + "\n"
	if err := os.WriteFile(path, []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestHandedLine(t *testing.T) {
	answer := agentsTestTranscript(t, `"\n\nDeployed to staging.\nThe smoke tests pass."`)
	idle := handTestClaude("tab-a")
	idle.TranscriptPath = answer
	input := agentsTestInput("tab-a")
	input.TranscriptPath = answer
	editing := agentsTestPermission("tab-a")
	editing.Status.Detail = "editing main.go"
	cases := []struct {
		name string
		a    Agent
		want string
	}{
		{"working", agentsTestWorking("tab-a"), "Running node build.mjs"},
		{"permission for a command", agentsTestPermission("tab-a"), "Wants to run: ssh deploy@siem-236 'systemctl restart siem'"},
		{"permission for anything else", editing, "Wants approval: editing main.go"},
		{"idle", idle, "Deployed to staging."},
		{"input", input, "Deployed to staging."},
		{"idle with no transcript", handTestClaude("tab-a"), ""},
		{"asking", agentsTestAsking("tab-a"), "Asking you a question"},
	}
	for _, c := range cases {
		if got := handedAgent(c.a, 7).Line; got != c.want {
			t.Errorf("%s: Line = %q, want %q", c.name, got, c.want)
		}
	}
	a := agentsTestWorking("tab-a")
	a.Project = "waveterm"
	want := HandedAgent{Tab: "tab-a", Name: "agent tab-a", Project: "waveterm", Runtime: "claude", State: PhoneWorking, Since: 7, Line: "Running node build.mjs"}
	if got := handedAgent(a, 7); got != want {
		t.Errorf("handedAgent = %+v, want %+v", got, want)
	}
}

// agentsTestSink records what a stream sent.
type agentsTestSink struct {
	agents chan HandedAgent
	lines  chan []string
}

func agentsTestNewSink() *agentsTestSink {
	return &agentsTestSink{agents: make(chan HandedAgent, 16), lines: make(chan []string, 16)}
}

func (s *agentsTestSink) Agent(a HandedAgent) error { s.agents <- a; return nil }
func (s *agentsTestSink) Lines(l []string) error    { s.lines <- l; return nil }

func agentsTestRecv[T any](t *testing.T, ch <-chan T, what string) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(remoteTestTimeout):
		t.Fatalf("no %s arrived", what)
		panic("unreachable")
	}
}

func TestStreamSendsAgentLinesAndChanges(t *testing.T) {
	a := handTestClaude("tab-a")
	a.TranscriptPath = "C:/t/session.jsonl"
	_, roster := handTestEnv(t, a)
	handTestHand(t, "tab-a")
	agentsTestPoll(t, 20*time.Millisecond)
	tail := agentsTestScriptTail(t, `{"type":"user"}`)
	sink := agentsTestNewSink()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- remoteStream(ctx, "tab-a", sink) }()

	if got := agentsTestRecv(t, sink.agents, "agent"); got.State != PhoneIdle {
		t.Errorf("first agent state %q, want idle", got.State)
	}
	if got := agentsTestRecv(t, tail.calls, "tail call"); got != a.TranscriptPath {
		t.Errorf("tailed %q, want %q", got, a.TranscriptPath)
	}
	if got := agentsTestRecv(t, sink.lines, "lines"); !slices.Equal(got, []string{`{"type":"user"}`}) {
		t.Errorf("lines %q", got)
	}
	roster.edit("tab-a", func(a *Agent) {
		a.Status.State = baseds.AgentState_Working
		a.Status.Detail = "reading main.go"
	})
	if got := agentsTestRecv(t, sink.agents, "changed agent"); got.State != PhoneWorking || got.Line != "Reading main.go" {
		t.Errorf("changed agent = %+v, want working, Reading main.go", got)
	}
	select {
	case extra := <-sink.agents:
		t.Errorf("an unchanged agent was sent again: %+v", extra)
	case <-time.After(100 * time.Millisecond):
	}
	cancel()
	if err := agentsTestRecv(t, done, "stream end"); err != nil {
		t.Errorf("a cancelled stream = %v, want nil", err)
	}
	agentsTestRecv(t, tail.exited, "tail exit")
}

func TestStreamWithoutTranscriptWaits(t *testing.T) {
	handTestEnv(t, handTestClaude("tab-a"))
	handTestHand(t, "tab-a")
	agentsTestPoll(t, 20*time.Millisecond)
	tail := agentsTestScriptTail(t)
	sink := agentsTestNewSink()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- remoteStream(ctx, "tab-a", sink) }()
	agentsTestRecv(t, sink.agents, "agent")
	select {
	case err := <-done:
		t.Fatalf("a stream with no transcript path ended early: %v", err)
	case path := <-tail.calls:
		t.Fatalf("a stream with no transcript path tailed %q", path)
	case <-time.After(100 * time.Millisecond):
	}
	cancel()
	if err := agentsTestRecv(t, done, "stream end"); err != nil {
		t.Errorf("a cancelled stream = %v, want nil", err)
	}
}

func TestStreamEndsWhenAgentExits(t *testing.T) {
	a := handTestClaude("tab-a")
	a.TranscriptPath = "C:/t/session.jsonl"
	_, roster := handTestEnv(t, a)
	prevGrace := handAwayGraceMs
	handAwayGraceMs = 0
	t.Cleanup(func() { handAwayGraceMs = prevGrace })
	handTestHand(t, "tab-a")
	const poll = 100 * time.Millisecond
	agentsTestPoll(t, poll)
	tail := agentsTestScriptTail(t)
	sink := agentsTestNewSink()
	done := make(chan error, 1)
	go func() { done <- remoteStream(context.Background(), "tab-a", sink) }()
	agentsTestRecv(t, sink.agents, "agent")
	agentsTestRecv(t, tail.calls, "tail call")

	roster.set()
	start := time.Now()
	err := agentsTestRecv(t, done, "stream end")
	var gone *GoneError
	if !errors.As(err, &gone) || gone.Reason != EndExited {
		t.Fatalf("stream = %v, want gone with reason exited", err)
	}
	if took := time.Since(start); took > 5*poll {
		t.Errorf("the stream took %v to see the agent exit, want about one poll (%v)", took, poll)
	}
	agentsTestRecv(t, tail.exited, "tail exit")
}

func TestOffEndsStreams(t *testing.T) {
	_, port, token := remoteTestAccessEnv(t)
	a := handTestClaude("tab-a")
	a.TranscriptPath = "C:/t/session.jsonl"
	handTestScript(t, a)
	handTestHand(t, "tab-a")
	tail := agentsTestScriptTail(t, `{"type":"user"}`)

	req, err := http.NewRequest(http.MethodGet, remoteTestURL(port, "/api/agents/tab-a/stream"), nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(accessHeader, token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer resp.Body.Close()
	br := bufio.NewReader(resp.Body)
	if ev, err := handlerReadEvent(br); err != nil || ev.name != "agent" {
		t.Fatalf("first event = %+v (err %v), want agent", ev, err)
	}

	start := time.Now()
	if _, err := Off(); err != nil {
		t.Fatalf("Off: %v", err)
	}
	if took := time.Since(start); took >= remoteShutdownTimeout {
		t.Errorf("Off took %v with a stream open, want under %v", took, remoteShutdownTimeout)
	}
	for {
		ev, err := handlerReadEvent(br)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("reading the stream after Off: %v", err)
		}
		if ev.name == "ended" {
			t.Errorf("turning off must close the stream without an ended event, got %+v", ev)
		}
	}
	agentsTestRecv(t, tail.exited, "tail exit")
}
