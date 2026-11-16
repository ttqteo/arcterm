// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func assign(tab, text string) (*wshrpc.CommandAgentsSendRtnData, error) {
	return (&WshServer{}).AgentsAssignCommand(context.Background(), wshrpc.CommandAgentsAssignData{Tab: tab, Text: text})
}

// no block was told another agent messaged it: the sender of a job is the person, so the send-back lock stays clear
func assertNoSendBackLock(t *testing.T) {
	t.Helper()
	blocks := []string{agentsBlockA, agentsBlockB, agentsBlockC}
	for _, from := range blocks {
		for _, to := range blocks {
			if agentmsg.SendBackLocked(from, to) {
				t.Errorf("a job from the person locked %s from answering %s by message", from, to)
			}
		}
	}
}

// the job reaches an idle agent as the person typed it: trimmed, with none of the header an agent's message carries
func TestAgentsAssignIdleNoEnvelope(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	rtn, err := assign(agentsTabB, "  fix the flaky checkout test\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 {
		t.Fatalf("deliveries = %+v, want the job once", *sent)
	}
	got := (*sent)[0]
	if got.blockId != agentsBlockB || got.text != "fix the flaky checkout test" {
		t.Errorf("delivered %+v, want exactly the typed job to the idle agent's block", got)
	}
	if agentmsg.IsAgentMessage(got.text) || strings.Contains(got.text, "wsh agents") {
		t.Errorf("delivered %q, want no agent-message envelope", got.text)
	}
	if rtn.TabId != agentsTabB || rtn.MidTurn || rtn.SentTs == 0 {
		t.Errorf("result = %+v, want the idle agent's tab, not mid-turn, with a send time", rtn)
	}
	assertNoSendBackLock(t)
}

// a working agent takes the job too: it is queued behind the turn, which the result says
func TestAgentsAssignWorkingAgentIsMidTurn(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	rtn, err := assign(agentsTabA, "also update the changelog")
	if err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].blockId != agentsBlockA || (*sent)[0].text != "also update the changelog" {
		t.Errorf("deliveries = %+v, want the job to the working agent's block", *sent)
	}
	if !rtn.MidTurn {
		t.Errorf("result = %+v, want a job for a working agent to be mid-turn", rtn)
	}
}

// a sleeping agent is woken with the job as its first turn, through the same wake path a send takes
func TestAgentsAssignWakesSleeper(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now())}})
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }

	rtn, err := assign(agentsTabA, "  rebase onto main  ")
	if err != nil {
		t.Fatal(err)
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want the job to wake the agent", w.resyncs)
	}
	got := w.deliveries()
	if len(got) != 1 || got[0].blockId != agentsBlockA || got[0].text != "rebase onto main" {
		t.Fatalf("delivered %+v, want the bare job to the woken agent once", got)
	}
	if rtn.TabId != agentsTabA || rtn.MidTurn {
		t.Errorf("result = %+v, want the woken agent's tab, not mid-turn", rtn)
	}
	assertNoSendBackLock(t)
}

// an engine session belongs to its run: a job from the person's Ask never lands in one
func TestAgentsAssignRefusesRunAgent(t *testing.T) {
	facts := threeAgents()
	facts.Runs = []*waveobj.Run{{OID: "run-77", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + agentsTabB}}}}}
	sent := scriptAgents(t, facts)
	_, err := assign(agentsTabB, "rewrite the parser")
	if err == nil || !strings.Contains(err.Error(), "run-77") || !strings.Contains(err.Error(), "engine session") {
		t.Fatalf("err = %v, want a refusal naming the run and the engine session", err)
	}
	if len(*sent) != 0 {
		t.Errorf("a refused job delivered %+v", *sent)
	}
}

// an agent with a question open would take the job as the answer, with or without a control stream to carry it
func TestAgentsAssignRefusesAsking(t *testing.T) {
	for _, stream := range []bool{false, true} {
		name := "typed into the terminal"
		if stream {
			name = "with a control stream"
		}
		t.Run(name, func(t *testing.T) {
			facts := threeAgents()
			facts.Tabs[1].Status.State = baseds.AgentState_Asking
			facts.Tabs[1].OpenAsk = true
			facts.Tabs[1].HasStream = stream
			sent := scriptAgents(t, facts)
			_, err := assign(agentsTabB, "rewrite the parser")
			if err == nil || !strings.Contains(err.Error(), "question") {
				t.Fatalf("err = %v, want a refusal naming the open question", err)
			}
			if len(*sent) != 0 {
				t.Errorf("a refused job delivered %+v", *sent)
			}
		})
	}
}

func TestAgentsAssignRefusesAnEmptyJobAndAnUnknownTab(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	if _, err := assign(agentsTabB, " \n\t "); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Errorf("empty job: err = %v, want the empty-job refusal", err)
	}
	if _, err := assign("zzzz", "do it"); err == nil || !strings.Contains(err.Error(), "not a live agent session") {
		t.Errorf("unknown tab: err = %v, want the not-a-live-agent refusal", err)
	}
	if len(*sent) != 0 {
		t.Errorf("a refused job delivered %+v", *sent)
	}
}

// the No folder's channel is made with the folder and found again by its path: two calls give one channel
func TestEnsureNoFolderChannel(t *testing.T) {
	dir := t.TempDir()
	// the folder and Claude Code's trust file for it both resolve under the home dir
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	ctx := context.Background()
	want := filepath.Join(dir, ".arc", "no-folder")

	first, err := (&WshServer{}).EnsureNoFolderCommand(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first.Path != want {
		t.Errorf("path = %q, want %q", first.Path, want)
	}
	if first.ChannelId == "" {
		t.Fatal("no channel id came back")
	}
	second, err := (&WshServer{}).EnsureNoFolderCommand(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if second.ChannelId != first.ChannelId || second.Path != first.Path {
		t.Errorf("second call = %+v, want the first's %+v", second, first)
	}
	ch, err := wstore.DBGet[*waveobj.Channel](ctx, first.ChannelId)
	if err != nil {
		t.Fatal(err)
	}
	if ch == nil || ch.ProjectPath != want || ch.Name != noFolderChannelName {
		t.Errorf("channel = %+v, want %q at %q", ch, noFolderChannelName, want)
	}
}
