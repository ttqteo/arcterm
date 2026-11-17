// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const handTestTs = int64(1_700_000_000_000)

// handTestRoster is the scripted roster AgentsHook reads; a test edits it to make an agent exit.
type handTestRoster struct {
	mu     sync.Mutex
	agents []Agent
}

func (r *handTestRoster) set(agents ...Agent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.agents = slices.Clone(agents)
}

func (r *handTestRoster) edit(tab string, fn func(*Agent)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.agents {
		if r.agents[i].TabId == tab {
			fn(&r.agents[i])
		}
	}
}

// handTestEnv is remoteTestEnv with a complete setup, remote mode off, the roster scripted and the
// hand-overs empty; it restores both when the test ends.
func handTestEnv(t *testing.T, agents ...Agent) (*remoteTestFakes, *handTestRoster) {
	t.Helper()
	fakes, _ := remoteTestEnv(t, configValidSetup())
	return fakes, handTestScript(t, agents...)
}

// handTestScript scripts AgentsHook with a roster and empties the hand-overs, restoring both when the
// test ends.
func handTestScript(t *testing.T, agents ...Agent) *handTestRoster {
	t.Helper()
	roster := &handTestRoster{}
	roster.set(agents...)
	prevHook, prevNow := AgentsHook, handNow
	AgentsHook = func(context.Context) ([]Agent, error) {
		roster.mu.Lock()
		defer roster.mu.Unlock()
		return slices.Clone(roster.agents), nil
	}
	handReset()
	t.Cleanup(func() {
		AgentsHook, handNow = prevHook, prevNow
		handReset()
	})
	return roster
}

func handTestClaude(tab string) Agent {
	return Agent{
		TabId: tab, BlockId: "blk-" + tab, Name: "agent " + tab, Harness: "claude", HasStream: true,
		Status: baseds.AgentStatusData{State: baseds.AgentState_Idle, Agent: "claude", Ts: handTestTs},
	}
}

func handTestPi(tab string) Agent {
	return Agent{
		TabId: tab, BlockId: "blk-" + tab, Name: "agent " + tab, Harness: "pi",
		Status: baseds.AgentStatusData{State: baseds.AgentState_Idle, Agent: "pi", Ts: handTestTs},
	}
}

func handTestGoneReason(t *testing.T, tab string) string {
	t.Helper()
	_, _, err := LookupHanded(context.Background(), tab)
	var gone *GoneError
	if !errors.As(err, &gone) {
		t.Fatalf("LookupHanded(%s) = %v, want a *GoneError", tab, err)
	}
	return gone.Reason
}

func handTestHand(t *testing.T, tab string) {
	t.Helper()
	if _, err := Hand(context.Background(), wshrpc.CommandRemoteHandData{Tab: tab}); err != nil {
		t.Fatalf("Hand(%s): %v", tab, err)
	}
}

func TestEligible(t *testing.T) {
	if err := Eligible(handTestClaude("t1")); err != nil {
		t.Errorf("a live claude agent must be eligible: %v", err)
	}
	if err := Eligible(handTestPi("t1")); err != nil {
		t.Errorf("a live pi agent must be eligible: %v", err)
	}
	cases := []struct {
		name  string
		agent Agent
		want  string
	}{
		{"run worker", func() Agent { a := handTestClaude("t1"); a.RunWorker = true; return a }(), "run worker"},
		{"no block", func() Agent { a := handTestClaude("t1"); a.BlockId = ""; return a }(), "block"},
		{"codex", func() Agent { a := handTestClaude("t1"); a.Harness = "codex"; return a }(), "codex"},
		{"claude exited to its shell", func() Agent { a := handTestClaude("t1"); a.HasStream = false; return a }(), "exited"},
		{"pi ended", func() Agent { a := handTestPi("t1"); a.Status.Ended = true; return a }(), "exited"},
	}
	for _, c := range cases {
		err := Eligible(c.agent)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: Eligible = %v, want an error naming %q", c.name, err, c.want)
		}
	}
}

func TestPhoneState(t *testing.T) {
	status := func(state, hook, ntype string) baseds.AgentStatusData {
		return baseds.AgentStatusData{State: state, Hook: hook, NotificationType: ntype}
	}
	cases := []struct {
		name string
		a    Agent
		want string
	}{
		{"open ask wins over working", Agent{OpenAsk: true, Status: status(baseds.AgentState_Working, "", "")}, PhoneAsking},
		{"asking status", Agent{Status: status(baseds.AgentState_Asking, "", "")}, PhoneAsking},
		{"permission prompt", Agent{Status: status(baseds.AgentState_Waiting, baseds.AgentHook_Notification, "permission_prompt")}, PhonePermission},
		{"permission type from another hook", Agent{Status: status(baseds.AgentState_Waiting, baseds.AgentHook_PreToolUse, "permission_prompt")}, PhoneInput},
		{"elicitation dialog", Agent{Status: status(baseds.AgentState_Waiting, baseds.AgentHook_Notification, "elicitation_dialog")}, PhoneInput},
		{"waiting with no type", Agent{Status: status(baseds.AgentState_Waiting, baseds.AgentHook_Notification, "")}, PhoneInput},
		{"working", Agent{Status: status(baseds.AgentState_Working, baseds.AgentHook_PreToolUse, "")}, PhoneWorking},
		{"idle", Agent{Status: status(baseds.AgentState_Idle, baseds.AgentHook_Stop, "")}, PhoneIdle},
	}
	for _, c := range cases {
		if got := PhoneState(c.a); got != c.want {
			t.Errorf("%s: PhoneState = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestHandTurnsOnAndPublishes(t *testing.T) {
	fakes, _ := handTestEnv(t, handTestClaude("tab-a"))
	if Status().On {
		t.Fatal("remote mode must start off")
	}
	st, err := Hand(context.Background(), wshrpc.CommandRemoteHandData{Tab: "tab-a"})
	if err != nil {
		t.Fatalf("Hand: %v", err)
	}
	if !st.On || fakes.starts.Load() != 1 {
		t.Errorf("Hand must turn remote mode on: on %v, tunnel starts %d", st.On, fakes.starts.Load())
	}
	if got := Status().Handed; !slices.Equal(got, []string{"tab-a"}) {
		t.Errorf("Status().Handed = %v, want [tab-a]", got)
	}
}

func TestHandRefusesIneligibleWithoutTurningOn(t *testing.T) {
	worker := handTestClaude("tab-w")
	worker.RunWorker = true
	codex := handTestClaude("tab-x")
	codex.Harness = "codex"
	fakes, _ := handTestEnv(t, worker, codex)
	for tab, want := range map[string]string{"tab-w": "run worker", "tab-x": "codex", "tab-closed": "no agent"} {
		_, err := Hand(context.Background(), wshrpc.CommandRemoteHandData{Tab: tab})
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("Hand(%s) = %v, want an error naming %q", tab, err, want)
		}
	}
	if fakes.starts.Load() != 0 || Status().On || remoteTestStoredOn(t) {
		t.Error("a refused hand-over must not turn remote mode on")
	}
	if got := Status().Handed; len(got) != 0 {
		t.Errorf("Status().Handed = %v, want none", got)
	}
}

func TestHandResolvesPrefixAndOwnTab(t *testing.T) {
	const ownBlock = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f"
	own := handTestClaude("xyz-333")
	own.BlockId = ownBlock
	handTestEnv(t, handTestClaude("abc-111"), handTestPi("abd-222"), own)
	handTestHand(t, "abc")
	if got := Status().Handed; !slices.Equal(got, []string{"abc-111"}) {
		t.Errorf("a unique prefix: Handed = %v, want [abc-111]", got)
	}
	_, err := Hand(context.Background(), wshrpc.CommandRemoteHandData{Tab: "ab"})
	if err == nil || !strings.Contains(err.Error(), "abc-111") || !strings.Contains(err.Error(), "abd-222") {
		t.Errorf("an ambiguous prefix = %v, want an error naming both tabs", err)
	}
	if _, err := Hand(context.Background(), wshrpc.CommandRemoteHandData{FromORef: "block:" + ownBlock}); err != nil {
		t.Fatalf("Hand of the calling block's tab: %v", err)
	}
	if got := Status().Handed; !slices.Equal(got, []string{"abc-111", "xyz-333"}) {
		t.Errorf("own tab: Handed = %v, want [abc-111 xyz-333]", got)
	}
}

func TestTakeBackRecordsTaken(t *testing.T) {
	handTestEnv(t, handTestClaude("tab-a"))
	handTestHand(t, "tab-a")
	if _, err := TakeBack(context.Background(), wshrpc.CommandRemoteHandData{Tab: "tab-a"}); err != nil {
		t.Fatalf("TakeBack: %v", err)
	}
	if got := handTestGoneReason(t, "tab-a"); got != EndTaken {
		t.Errorf("after TakeBack the reason = %q, want %q", got, EndTaken)
	}
	if got := Status().Handed; len(got) != 0 {
		t.Errorf("Status().Handed = %v, want none", got)
	}
	handTestHand(t, "tab-a")
	if _, _, err := LookupHanded(context.Background(), "tab-a"); err != nil {
		t.Errorf("handing over again must clear the reason: %v", err)
	}
}

// handTestClock pins handNow at handTestTs and returns a function that moves it by ms.
func handTestClock(t *testing.T) func(ms int64) {
	t.Helper()
	now := handTestTs
	handNow = func() int64 { return now }
	return func(ms int64) { now += ms }
}

// handTestPastGrace fails the check once, so the grace starts, then moves the clock past it.
func handTestPastGrace(t *testing.T, step func(int64)) {
	t.Helper()
	if _, _, err := ListHanded(context.Background()); err != nil {
		t.Fatalf("ListHanded: %v", err)
	}
	step(handAwayGraceMs)
}

func TestExitedIsPruned(t *testing.T) {
	_, roster := handTestEnv(t, handTestClaude("tab-a"), handTestClaude("tab-b"))
	step := handTestClock(t)
	handTestHand(t, "tab-a")
	handTestHand(t, "tab-b")
	roster.set(handTestClaude("tab-b"))
	handTestPastGrace(t, step)
	agents, _, err := ListHanded(context.Background())
	if err != nil {
		t.Fatalf("ListHanded: %v", err)
	}
	if len(agents) != 1 || agents[0].TabId != "tab-b" {
		t.Errorf("ListHanded = %v, want only tab-b", agents)
	}
	if got := handTestGoneReason(t, "tab-a"); got != EndExited {
		t.Errorf("an agent gone from the roster: reason %q, want %q", got, EndExited)
	}
}

func TestExitedToShellIsPruned(t *testing.T) {
	_, roster := handTestEnv(t, handTestClaude("tab-a"))
	step := handTestClock(t)
	handTestHand(t, "tab-a")
	roster.edit("tab-a", func(a *Agent) { a.HasStream = false })
	handTestPastGrace(t, step)
	if got := handTestGoneReason(t, "tab-a"); got != EndExited {
		t.Errorf("claude exited to its shell: reason %q, want %q", got, EndExited)
	}
	if got := Status().Handed; len(got) != 0 {
		t.Errorf("Status().Handed = %v, want none", got)
	}
}

func TestBriefAbsenceKeepsHandover(t *testing.T) {
	cases := []struct {
		name string
		away func(*handTestRoster)
	}{
		{"stream gap", func(r *handTestRoster) { r.edit("tab-a", func(a *Agent) { a.HasStream = false }) }},
		{"roster miss", func(r *handTestRoster) { r.set() }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, roster := handTestEnv(t, handTestClaude("tab-a"))
			step := handTestClock(t)
			handTestHand(t, "tab-a")
			c.away(roster)
			agents, _, err := ListHanded(context.Background())
			if err != nil || len(agents) != 1 || agents[0].TabId != "tab-a" {
				t.Fatalf("in its grace: ListHanded = %v, %v; want tab-a still listed", agents, err)
			}
			rec := agentsTestRecordInput(t)
			if err := remoteAct(context.Background(), "tab-a", AgentAction{Kind: ActionSend, Text: "ls"}); !errors.Is(err, ErrWrongState) {
				t.Errorf("a send in the grace = %v, want ErrWrongState", err)
			}
			if _, got := rec.get(); len(got) != 0 {
				t.Errorf("a send in the grace typed %q, want nothing", got)
			}
			step(handAwayGraceMs - 1)
			roster.set(handTestClaude("tab-a"))
			step(handAwayGraceMs)
			if _, _, err := LookupHanded(context.Background(), "tab-a"); err != nil {
				t.Fatalf("back within the grace, then past it: LookupHanded = %v, want still handed", err)
			}
			if err := remoteAct(context.Background(), "tab-a", AgentAction{Kind: ActionSend, Text: "ls"}); err != nil {
				t.Errorf("a send once back = %v, want nil", err)
			}
		})
	}
}

func TestOffClearsHandovers(t *testing.T) {
	handTestEnv(t, handTestClaude("tab-a"))
	handTestHand(t, "tab-a")
	if _, err := Off(); err != nil {
		t.Fatalf("Off: %v", err)
	}
	if got := Status().Handed; len(got) != 0 {
		t.Errorf("after Off, Handed = %v, want none", got)
	}
	if got := handTestGoneReason(t, "tab-a"); got != EndOff {
		t.Errorf("after Off the reason = %q, want %q", got, EndOff)
	}
}

func TestRestartKeepsHandovers(t *testing.T) {
	fakes, _ := handTestEnv(t, handTestClaude("tab-a"))
	handTestHand(t, "tab-a")
	if _, err := Setup(wshrpc.CommandRemoteSetupData{Port: remoteTestFreePort(t)}); err != nil {
		t.Fatalf("re-setup: %v", err)
	}
	if fakes.starts.Load() != 2 {
		t.Fatalf("the re-setup must restart remote mode: tunnel starts %d", fakes.starts.Load())
	}
	if got := Status().Handed; !slices.Equal(got, []string{"tab-a"}) {
		t.Errorf("after a restart, Handed = %v, want [tab-a]", got)
	}
}

func TestSinceTracksStateChanges(t *testing.T) {
	_, roster := handTestEnv(t, handTestClaude("tab-a"))
	const later = handTestTs + 60_000
	handNow = func() int64 { return later }
	handTestHand(t, "tab-a")
	_, since, err := LookupHanded(context.Background(), "tab-a")
	if err != nil || since != handTestTs {
		t.Fatalf("first look: since %d err %v, want Status.Ts %d", since, err, handTestTs)
	}
	roster.edit("tab-a", func(a *Agent) { a.Status.Ts = handTestTs + 5_000 })
	if _, since, _ = LookupHanded(context.Background(), "tab-a"); since != handTestTs {
		t.Errorf("same state: since %d, want it kept at %d", since, handTestTs)
	}
	roster.edit("tab-a", func(a *Agent) { a.Status.State = baseds.AgentState_Working })
	_, sinces, err := ListHanded(context.Background())
	if err != nil || len(sinces) != 1 || sinces[0] != later {
		t.Errorf("changed state: since %v err %v, want [%d]", sinces, err, later)
	}
}
