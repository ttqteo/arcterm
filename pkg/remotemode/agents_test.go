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
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

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
// exited closes when the last call returns. froms holds the offset each call was asked to start from.
type agentsTestTail struct {
	backlog []string
	calls   chan string
	froms   chan int64
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
	tail := &agentsTestTail{backlog: backlog, calls: make(chan string, 4), froms: make(chan int64, 4), exited: make(chan struct{})}
	prev := TranscriptHook
	TranscriptHook = func(ctx context.Context, path string, from int64, send func(TranscriptChunk) error) error {
		defer close(tail.exited)
		tail.calls <- path
		tail.froms <- from
		if err := send(TranscriptChunk{Lines: tail.backlog, Backlog: true}); err != nil {
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
	lines  chan TranscriptChunk
}

func agentsTestNewSink() *agentsTestSink {
	return &agentsTestSink{agents: make(chan HandedAgent, 16), lines: make(chan TranscriptChunk, 16)}
}

func (s *agentsTestSink) Agent(a HandedAgent) error     { s.agents <- a; return nil }
func (s *agentsTestSink) Lines(c TranscriptChunk) error { s.lines <- c; return nil }

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
	go func() { done <- remoteStream(ctx, "tab-a", -1, sink) }()

	if got := agentsTestRecv(t, sink.agents, "agent"); got.State != PhoneIdle {
		t.Errorf("first agent state %q, want idle", got.State)
	}
	if got := agentsTestRecv(t, tail.calls, "tail call"); got != a.TranscriptPath {
		t.Errorf("tailed %q, want %q", got, a.TranscriptPath)
	}
	if got := agentsTestRecv(t, sink.lines, "lines"); !slices.Equal(got.Lines, []string{`{"type":"user"}`}) || !got.Backlog {
		t.Errorf("lines %+v, want the backlog chunk with the one line", got)
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

// a reconnecting page's Last-Event-ID reaches the transcript tail as its start offset, and -1 (none) asks for
// the last 200 lines
func TestStreamPassesFromToTranscript(t *testing.T) {
	for _, from := range []int64{-1, 0, 57} {
		t.Run(strconv.FormatInt(from, 10), func(t *testing.T) {
			a := handTestClaude("tab-a")
			a.TranscriptPath = "C:/t/session.jsonl"
			handTestEnv(t, a)
			handTestHand(t, "tab-a")
			agentsTestPoll(t, 20*time.Millisecond)
			tail := agentsTestScriptTail(t)
			sink := agentsTestNewSink()
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- remoteStream(ctx, "tab-a", from, sink) }()
			if got := agentsTestRecv(t, tail.froms, "tail from"); got != from {
				t.Errorf("the tail was asked to start from %d, want %d", got, from)
			}
			cancel()
			agentsTestRecv(t, done, "stream end")
		})
	}
}

func TestStreamWithoutTranscriptWaits(t *testing.T) {
	handTestEnv(t, handTestClaude("tab-a"))
	handTestHand(t, "tab-a")
	agentsTestPoll(t, 20*time.Millisecond)
	tail := agentsTestScriptTail(t)
	sink := agentsTestNewSink()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- remoteStream(ctx, "tab-a", -1, sink) }()
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
	go func() { done <- remoteStream(context.Background(), "tab-a", -1, sink) }()
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

// listTestAgent is a roster agent with a terminal block, as BuildAgentList reads it.
func listTestAgent(tab, name, harness string, st baseds.AgentStatusData, stream bool) Agent {
	return Agent{TabId: tab, BlockId: "blk-" + tab, Name: name, Harness: harness, Status: st, HasStream: stream}
}

func listTestTabs[T any](rows []T, tab func(T) string) []string {
	tabs := []string{}
	for _, r := range rows {
		tabs = append(tabs, tab(r))
	}
	return tabs
}

func TestBuildAgentList(t *testing.T) {
	agent := listTestAgent
	codex := agent("t-codex", "codex", "codex", baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: 200}, false)
	noBlock := agent("t-noblock", "no block", harnessClaude, baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: 400}, true)
	noBlock.BlockId = ""
	agents := []Agent{
		agent("t-idle-new", "b-idle", harnessPi, baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: 300}, false),
		agent("t-work", "work", harnessClaude, baseds.AgentStatusData{State: baseds.AgentState_Working, Detail: "running tests", Ts: 900}, true),
		agent("t-gone", "gone", harnessClaude, baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: 50}, false),
		agent("t-idle-old", "a-idle", harnessClaude, baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: 100}, true),
		agent("t-perm", "perm", harnessClaude, baseds.AgentStatusData{
			State: baseds.AgentState_Waiting, Hook: baseds.AgentHook_Notification,
			NotificationType: notificationPermissionPrompt, Detail: "running npm test", Ts: 700,
		}, true),
		agent("t-pi-ended", "pi-ended", harnessPi, baseds.AgentStatusData{State: baseds.AgentState_Idle, Ended: true, Ts: 10}, false),
		codex,
		noBlock,
		agent("t-codex-ended", "codex ended", "codex", baseds.AgentStatusData{State: baseds.AgentState_Idle, Ended: true, Ts: 20}, false),
	}
	got, runs := BuildAgentList(agents, map[string]bool{"t-work": true})
	if len(runs) != 0 {
		t.Errorf("runs = %+v, want none", runs)
	}
	// an exited session (claude with no stream, any harness that reported its end) is left out
	want := []string{"t-perm", "t-work", "t-idle-old", "t-codex", "t-idle-new", "t-noblock"}
	if tabs := listTestTabs(got, func(a ListedAgent) string { return a.Tab }); !slices.Equal(tabs, want) {
		t.Fatalf("order %v, want %v", tabs, want)
	}
	byTab := map[string]ListedAgent{}
	for _, a := range got {
		byTab[a.Tab] = a
	}
	if w := byTab["t-work"]; w.State != PhoneWorking || w.Since != 0 || w.Line != "Running tests" || !w.Handed || !w.Takeable {
		t.Errorf("working agent %+v", w)
	}
	if p := byTab["t-perm"]; p.State != PhonePermission || p.Since != 700 || p.Line != "Wants to run: npm test" || p.Handed || !p.Takeable {
		t.Errorf("permission agent %+v", p)
	}
	if i := byTab["t-idle-new"]; i.State != PhoneIdle || i.Runtime != harnessPi || !i.Takeable {
		t.Errorf("idle pi %+v", i)
	}
	// a live agent Eligible refuses for another reason than being a run worker stays listed, untakeable
	if c := byTab["t-codex"]; c.State != PhoneIdle || c.Takeable || c.Runtime != "codex" {
		t.Errorf("codex agent %+v, want listed and not takeable", c)
	}
	if n := byTab["t-noblock"]; n.Takeable {
		t.Errorf("an agent with no terminal block %+v, want not takeable", n)
	}
}

func TestBuildAgentListLines(t *testing.T) {
	answer := agentsTestTranscript(t, `"\n\nDeployed to staging. The smoke tests pass.\nMore after."`)
	withAnswer := func(a Agent) Agent { a.TranscriptPath = answer; return a }
	asking := agentsTestAsking("t-ask")
	asking.Ask = "Which database should the migration use?"
	askingNoText := agentsTestAsking("t-ask-bare")
	input := withAnswer(agentsTestInput("t-input"))
	inputWithDetail := agentsTestInput("t-input-detail")
	inputWithDetail.Status.Detail = "needs your input"
	rows, _ := BuildAgentList([]Agent{
		withAnswer(handTestClaude("t-idle")), handTestClaude("t-idle-none"), agentsTestWorking("t-work"),
		agentsTestPermission("t-perm"), asking, askingNoText, input, inputWithDetail,
	}, nil)
	lines := map[string]string{}
	for _, r := range rows {
		lines[r.Tab] = r.Line
	}
	for tab, want := range map[string]string{
		"t-idle":         "Deployed to staging.",
		"t-idle-none":    "",
		"t-work":         "Running node build.mjs",
		"t-perm":         "Wants to run: ssh deploy@siem-236 'systemctl restart siem'",
		"t-ask":          "Which database should the migration use?",
		"t-ask-bare":     "Asking you a question",
		"t-input":        "Deployed to staging.",
		"t-input-detail": "Needs your input",
	} {
		if lines[tab] != want {
			t.Errorf("%s: Line = %q, want %q", tab, lines[tab], want)
		}
	}
	// a hand-over of the same agent words its line by the same rule
	if got := handedAgent(asking, 5).Line; got != asking.Ask {
		t.Errorf("handed asking Line = %q, want the question %q", got, asking.Ask)
	}
	if got := handedAgent(askingNoText, 5).Line; got != "Asking you a question" {
		t.Errorf("handed asking with no ask text Line = %q", got)
	}
}

func TestBuildAgentListRuns(t *testing.T) {
	worker := func(tab, name, key, runName, label string, st baseds.AgentStatusData) Agent {
		a := listTestAgent(tab, name, harnessClaude, st, true)
		a.RunWorker, a.RunKey, a.RunName, a.RunLine = true, key, runName, label
		return a
	}
	working := func(detail string, ts int64) baseds.AgentStatusData {
		return baseds.AgentStatusData{State: baseds.AgentState_Working, Detail: detail, Ts: ts}
	}
	permission := baseds.AgentStatusData{
		State: baseds.AgentState_Waiting, Hook: baseds.AgentHook_Notification,
		NotificationType: notificationPermissionPrompt, Detail: "running go test", Ts: 500,
	}
	idle := func(ts int64) baseds.AgentStatusData {
		return baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: ts}
	}
	asking := worker("w-ask", "ask", "dag-b", "Build the shaper", "Plan reviewer", idle(10))
	asking.OpenAsk = true
	plain := listTestAgent("t-plain", "plain", harnessClaude, idle(100), true)
	agents := []Agent{
		worker("w-1", "one", "dag-a", "Ship the phone list", "Roster", working("reading a.go", 900)),
		worker("w-2", "two", "dag-a", "Ship the phone list", "Review: Roster", working("running tests", 800)),
		worker("w-idle", "idle", "dag-a", "Ship the phone list", "Verifier", idle(300)),
		asking,
		worker("w-perm", "perm", "dag-b", "Build the shaper", "Shaper", permission),
		worker("w-input", "input", "lead:tab:lead", "lead agent", "do a thing", baseds.AgentStatusData{
			State: baseds.AgentState_Waiting, Hook: baseds.AgentHook_Notification, NotificationType: "elicitation_dialog", Ts: 40}),
		// an exited worker is not live, and a run that has only exited workers has no row
		worker("w-gone", "gone", "dag-c", "Old run", "Task", idle(5)),
		plain,
		worker("w-zzz", "zzz", "dag-z", "A calm run", "Task", working("editing", 1)),
		worker("w-aaa", "aaa", "dag-y", "A calm run", "Task", working("editing", 2)),
	}
	agents[6].HasStream = false
	rows, runs := BuildAgentList(agents, nil)
	if tabs := listTestTabs(rows, func(a ListedAgent) string { return a.Tab }); !slices.Equal(tabs, []string{"t-plain"}) {
		t.Errorf("agent rows %v, want only the plain agent: a run worker is never an agent row", tabs)
	}
	var keys []string
	for _, r := range runs {
		keys = append(keys, r.Key)
	}
	// needs-you runs first (by name: "Build the shaper" before "lead agent"), then the calm ones by name,
	// then key ("A calm run" twice: dag-y before dag-z); dag-c has no live worker
	if want := []string{"dag-b", "lead:tab:lead", "dag-y", "dag-z", "dag-a"}; !slices.Equal(keys, want) {
		t.Fatalf("run order %v, want %v", keys, want)
	}
	byKey := map[string]ListedRun{}
	for _, r := range runs {
		byKey[r.Key] = r
	}
	a := byKey["dag-a"]
	if a.Name != "Ship the phone list" || a.NeedsYou {
		t.Errorf("run a = %+v", a)
	}
	// workers sort like agent rows: working first (state order), the two working ones tie on Since (0) and
	// fall to the agent's name, then idle
	if tabs := listTestTabs(a.Workers, func(w RunWorkerRow) string { return w.Tab }); !slices.Equal(tabs, []string{"w-1", "w-2", "w-idle"}) {
		t.Errorf("run a workers %v, want w-1, w-2, w-idle", tabs)
	}
	for _, w := range a.Workers {
		switch w.Tab {
		case "w-1":
			if w.Label != "Roster" || w.State != PhoneWorking || w.Line != "Reading a.go" || w.Since != 0 {
				t.Errorf("worker w-1 = %+v", w)
			}
		case "w-2":
			if w.Label != "Review: Roster" || w.Line != "Running tests" {
				t.Errorf("worker w-2 = %+v", w)
			}
		case "w-idle":
			if w.State != PhoneIdle || w.Since != 300 || w.Label != "Verifier" {
				t.Errorf("worker w-idle = %+v", w)
			}
		}
	}
	b := byKey["dag-b"]
	if !b.NeedsYou || b.Name != "Build the shaper" || len(b.Workers) != 2 {
		t.Fatalf("run b = %+v, want it to need you with its two workers", b)
	}
	// asking sorts before permission
	if b.Workers[0].Tab != "w-ask" || b.Workers[0].State != PhoneAsking || b.Workers[1].Tab != "w-perm" ||
		b.Workers[1].State != PhonePermission || b.Workers[1].Line != "Wants to run: go test" {
		t.Errorf("run b workers = %+v", b.Workers)
	}
	if l := byKey["lead:tab:lead"]; !l.NeedsYou || l.Name != "lead agent" || len(l.Workers) != 1 || l.Workers[0].State != PhoneInput {
		t.Errorf("a worker waiting for input makes its run need you: %+v", l)
	}
	if byKey["dag-y"].NeedsYou || byKey["dag-z"].NeedsYou {
		t.Errorf("a working run needs nothing: %+v %+v", byKey["dag-y"], byKey["dag-z"])
	}
}

func TestReplyLine(t *testing.T) {
	long := strings.Repeat("word ", 60)
	cases := []struct {
		name, text, want string
	}{
		{"first sentence of the first line", "Deployed to staging. The smoke tests pass.\nMore.", "Deployed to staging."},
		{"skips blank lines", "\n  \n\tFixed it!  Done\n", "Fixed it!"},
		{"a question", "Which one? Pick.", "Which one?"},
		{"a dot inside a name is not a sentence end", "Edited pkg/main.go and bumped v1.2 today", "Edited pkg/main.go and bumped v1.2 today"},
		{"the number of a list item is not a sentence", "1. Fixed the roster. Then more", "1. Fixed the roster."},
		{"a line with no end", "Waiting on the build", "Waiting on the build"},
		{"a sentence end at the end of the line", "All green.\nNext line.", "All green."},
		{"empty", "", ""},
		{"only blanks", " \n\t\n", ""},
		{"capped at 160 characters", long, strings.Repeat("word ", 31) + "word…"},
		{"counts characters, not bytes", strings.Repeat("é", 200), strings.Repeat("é", 159) + "…"},
	}
	for _, c := range cases {
		got := firstSentence(c.text)
		if got != c.want {
			t.Errorf("%s: firstSentence = %q, want %q", c.name, got, c.want)
		}
		if n := utf8.RuneCountInString(got); n > replyLineMax {
			t.Errorf("%s: %d characters, want at most %d", c.name, n, replyLineMax)
		}
	}
}

// the 10 s poll reads a transcript only when it changed: unchanged size and mod time is a cache hit
func TestIdleLineCache(t *testing.T) {
	path := agentsTestTranscript(t, `"First reply. Detail."`)
	reads := 0
	prevRead := replyRead
	replyRead = func(p, harness string) (string, int64) { reads++; return prevRead(p, harness) }
	replyCacheReset()
	t.Cleanup(func() { replyRead = prevRead; replyCacheReset() })

	a := handTestClaude("t-a")
	a.TranscriptPath = path
	line := func() string {
		rows, _ := BuildAgentList([]Agent{a}, nil)
		return rows[0].Line
	}
	if got := line(); got != "First reply." {
		t.Fatalf("line = %q", got)
	}
	for range 3 {
		if got := line(); got != "First reply." {
			t.Errorf("cached line = %q", got)
		}
	}
	if reads != 1 {
		t.Errorf("an unchanged transcript was read %d times over 4 polls, want 1", reads)
	}
	// the handed-over row reads through the same cache
	if got := handedAgent(a, 1).Line; got != "First reply." || reads != 1 {
		t.Errorf("handed line = %q after %d reads, want the cached line and still 1 read", got, reads)
	}

	// a new reply grows the file: it is read again
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	more := `{"type":"assistant","timestamp":"2026-11-03T11:00:00Z","message":{"content":[{"type":"text","text":"Second reply. More."}]}}` + "\n"
	if _, err := f.WriteString(more); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if got := line(); got != "Second reply." || reads != 2 {
		t.Errorf("after an append line = %q after %d reads, want the new reply and 2 reads", got, reads)
	}

	// a state that shows no reply never reads
	working := agentsTestWorking("t-a")
	working.TranscriptPath = path
	before := reads
	BuildAgentList([]Agent{working}, nil)
	if reads != before {
		t.Errorf("a working row read the transcript")
	}

	// a transcript that is gone gives no line
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got := line(); got != "" {
		t.Errorf("a missing transcript gave %q, want no line", got)
	}
}
