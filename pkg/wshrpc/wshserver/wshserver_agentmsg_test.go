// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	agentsBlockA = "a0000000-0000-4000-8000-000000000001"
	agentsBlockB = "b0000000-0000-4000-8000-000000000002"
	agentsBlockC = "c0000000-0000-4000-8000-000000000003"
	agentsTabA   = "aaaa1111-tab"
	agentsTabB   = "bbbb2222-tab"
	agentsTabC   = "bbbb3333-tab"
)

type agentsDelivery struct{ blockId, text string }

// agentFacts is a live agent tab as the loader would report it.
func agentFacts(tabId, name, blockId, harness, state string) agentTabFacts {
	return agentTabFacts{
		Tab:          &waveobj.Tab{OID: tabId, Name: name, BlockIds: []string{blockId}},
		BlockId:      blockId,
		ShellRunning: true,
		ProjectPath:  "/work/" + name,
		Status:       baseds.AgentStatusData{Agent: harness, State: state, Cwd: "/work/" + name},
	}
}

// scriptAgents scripts the roster and returns what the delivery seam was handed.
func scriptAgents(t *testing.T, facts *agentRosterFacts) *[]agentsDelivery {
	t.Helper()
	oldLoad, oldDeliver, oldMeta, oldTabBlock := loadAgentRosterFacts, deliverAgentMessage, blockTranscriptMeta, tabAgentBlock
	sent := &[]agentsDelivery{}
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) { return facts, nil }
	deliverAgentMessage = func(blockId, text string) { *sent = append(*sent, agentsDelivery{blockId, text}) }
	blockTranscriptMeta = func(context.Context, string) (string, error) { return "", nil }
	tabAgentBlock = func(_ context.Context, tabId string) string {
		for _, tf := range facts.Tabs {
			if tf.Tab.OID == tabId {
				return tf.BlockId
			}
		}
		return ""
	}
	t.Cleanup(func() {
		loadAgentRosterFacts, deliverAgentMessage, blockTranscriptMeta, tabAgentBlock = oldLoad, oldDeliver, oldMeta, oldTabBlock
		for _, b := range []string{agentsBlockA, agentsBlockB, agentsBlockC} {
			agentmsg.TurnEnded(b)
		}
	})
	return sent
}

func threeAgents() *agentRosterFacts {
	return &agentRosterFacts{Tabs: []agentTabFacts{
		agentFacts(agentsTabA, "review lead", agentsBlockA, "claude", baseds.AgentState_Working),
		agentFacts(agentsTabB, "design", agentsBlockB, "claude", baseds.AgentState_Idle),
		agentFacts(agentsTabC, "scout", agentsBlockC, "pi", baseds.AgentState_Idle),
	}}
}

func blockORef(blockId string) string {
	return waveobj.MakeORef(waveobj.OType_Block, blockId).String()
}

func TestAgentsRosterRows(t *testing.T) {
	owned := agentFacts(agentsTabA, "worker", agentsBlockA, "claude", baseds.AgentState_Working)
	owned.ProjectPath = `C:\elsewhere\t-1`
	loose := agentFacts(agentsTabB, "scout", agentsBlockB, "pi", baseds.AgentState_Idle)
	loose.ProjectPath = `C:\src\widgets\`
	codex := agentFacts("cccc-tab", "codex", agentsBlockC, "codex", baseds.AgentState_Idle)
	exited := agentFacts("dddd-tab", "exited", "d0000000-0000-4000-8000-000000000004", "claude", baseds.AgentState_Idle)
	exited.ShellRunning = false
	scriptAgents(t, &agentRosterFacts{
		Tabs: []agentTabFacts{loose, codex, exited, owned},
		Runs: []*waveobj.Run{
			{OID: "run-other", ProjectPath: `C:\elsewhere`, Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:someone-else"}}}},
			{OID: "run-1", ProjectPath: `C:\proj\arc`, Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + agentsTabA}}}},
		},
		Channels: []*waveobj.Channel{{OID: "ch-1", Name: "Arc", ProjectPath: "C:/proj/arc"}},
	})
	rtn, err := (&WshServer{}).AgentsListCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []wshrpc.AgentInfo{
		{TabId: agentsTabA, Name: "worker", ProjectPath: `C:\proj\arc`, Project: "Arc", RunId: "run-1", Harness: "claude", State: wshrpc.AgentsState_Working},
		{TabId: agentsTabB, Name: "scout", ProjectPath: `C:\src\widgets\`, Project: "widgets", Harness: "pi", State: wshrpc.AgentsState_Idle},
	}
	if len(rtn.Agents) != len(want) {
		t.Fatalf("rows = %+v, want %+v", rtn.Agents, want)
	}
	for i := range want {
		if rtn.Agents[i] != want[i] {
			t.Errorf("row %d = %+v, want %+v", i, rtn.Agents[i], want[i])
		}
	}
}

func TestAgentsRosterStates(t *testing.T) {
	cases := []struct {
		status  string
		openAsk bool
		want    string
	}{
		{baseds.AgentState_Idle, false, wshrpc.AgentsState_Idle},
		{baseds.AgentState_Waiting, false, wshrpc.AgentsState_Idle},
		{baseds.AgentState_Working, false, wshrpc.AgentsState_Working},
		{baseds.AgentState_Asking, false, wshrpc.AgentsState_Asking},
		// a Notification mid-question reports waiting, so the open ask alone has to say asking
		{baseds.AgentState_Waiting, true, wshrpc.AgentsState_Asking},
		{baseds.AgentState_Working, true, wshrpc.AgentsState_Asking},
	}
	for _, c := range cases {
		tf := agentFacts(agentsTabA, "a", agentsBlockA, "claude", c.status)
		tf.OpenAsk = c.openAsk
		rows := buildAgentRoster(&agentRosterFacts{Tabs: []agentTabFacts{tf}})
		if len(rows) != 1 || rows[0].State != c.want {
			t.Errorf("status %q, open ask %v: rows = %+v, want state %q", c.status, c.openAsk, rows, c.want)
		}
	}
}

func TestAgentsResolve(t *testing.T) {
	facts := threeAgents()
	// an id that is also the prefix of another's: the exact one wins
	facts.Tabs = append(facts.Tabs, agentFacts(agentsTabA+"-2", "longer", "e0000000-0000-4000-8000-000000000005", "claude", baseds.AgentState_Idle))
	rows := buildAgentRoster(facts)

	for tab, want := range map[string]string{agentsTabA: agentsTabA, "bbbb2": agentsTabB, " bbbb3 ": agentsTabC} {
		row, err := resolveAgentTab(rows, tab)
		if err != nil || row.TabId != want {
			t.Errorf("resolve %q = %+v, %v; want %s", tab, row, err, want)
		}
	}

	_, err := resolveAgentTab(rows, "zzzz")
	if err == nil || !strings.Contains(err.Error(), "not a live agent session") || !strings.Contains(err.Error(), "wsh agents list") {
		t.Errorf("unknown tab: err = %v", err)
	}

	_, err = resolveAgentTab(rows, "bbbb")
	if err == nil {
		t.Fatal("ambiguous prefix resolved")
	}
	for _, part := range []string{agentsTabB, "design", agentsTabC, "scout"} {
		if !strings.Contains(err.Error(), part) {
			t.Errorf("ambiguous prefix: err %q does not name %q", err, part)
		}
	}
	if strings.Contains(err.Error(), agentsTabA) {
		t.Errorf("ambiguous prefix: err %q names a tab that does not match", err)
	}
}

func TestAgentsSendRefusals(t *testing.T) {
	asking := threeAgents()
	asking.Tabs[1].OpenAsk = true
	cases := []struct {
		name    string
		facts   *agentRosterFacts
		data    wshrpc.CommandAgentsSendData
		arrange func()
		want    string
	}{
		{name: "unknown target", data: wshrpc.CommandAgentsSendData{Tab: "zzzz", Text: "hi", FromORef: blockORef(agentsBlockA)}, want: "not a live agent session"},
		{name: "ambiguous target", data: wshrpc.CommandAgentsSendData{Tab: "bbbb", Text: "hi", FromORef: blockORef(agentsBlockA)}, want: "matches several"},
		{name: "sender is not a block", data: wshrpc.CommandAgentsSendData{Tab: agentsTabB, Text: "hi", FromORef: "tab:" + agentsBlockA}, want: "is not a block"},
		{name: "sender block in no tab", data: wshrpc.CommandAgentsSendData{Tab: agentsTabB, Text: "hi", FromORef: blockORef("f0000000-0000-4000-8000-00000000000f")}, want: "is in no tab"},
		{name: "own tab", data: wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "hi", FromORef: blockORef(agentsBlockA)}, want: "your own session"},
		{name: "send back in the same turn", data: wshrpc.CommandAgentsSendData{Tab: agentsTabB, Text: "hi", FromORef: blockORef(agentsBlockA)},
			arrange: func() { agentmsg.NoteSent(agentsBlockB, agentsBlockA) }, want: "wsh agents read"},
		{name: "empty text", data: wshrpc.CommandAgentsSendData{Tab: agentsTabB, Text: " \n\t", FromORef: blockORef(agentsBlockA)}, want: "message is empty"},
		{name: "asking with no stream", facts: asking, data: wshrpc.CommandAgentsSendData{Tab: agentsTabB, Text: "hi", FromORef: blockORef(agentsBlockA)}, want: "question open"},
	}
	seen := map[string]string{}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			facts := c.facts
			if facts == nil {
				facts = threeAgents()
			}
			sent := scriptAgents(t, facts)
			if c.arrange != nil {
				c.arrange()
			}
			_, err := (&WshServer{}).AgentsSendCommand(context.Background(), c.data)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want one containing %q", err, c.want)
			}
			if len(*sent) != 0 {
				t.Errorf("a refused send delivered %+v", *sent)
			}
			if other, dup := seen[err.Error()]; dup {
				t.Errorf("same error as %q: %v", other, err)
			}
			seen[err.Error()] = c.name
		})
	}
}

func TestAgentsSendDeliversAndLocksSendBack(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	ws := &WshServer{}
	ctx := context.Background()
	before := time.Now().UnixMilli()

	rtn, err := ws.AgentsSendCommand(ctx, wshrpc.CommandAgentsSendData{Tab: "bbbb2", Text: "  /clear the stale cache  ", FromORef: blockORef(agentsBlockA)})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.TabId != agentsTabB || rtn.SentTs < before {
		t.Errorf("reply = %+v", rtn)
	}
	if len(*sent) != 1 || (*sent)[0].blockId != agentsBlockB {
		t.Fatalf("deliveries = %+v, want one to block %s", *sent, agentsBlockB)
	}
	text := (*sent)[0].text
	if !agentmsg.IsAgentMessage(text) || strings.HasPrefix(text, "/") {
		t.Errorf("delivered text is not an enveloped agent message: %q", text)
	}
	for _, part := range []string{"review lead", agentsTabA, "/clear the stale cache"} {
		if !strings.Contains(text, part) {
			t.Errorf("delivered text %q lacks %q", text, part)
		}
	}

	back := wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "thanks", FromORef: blockORef(agentsBlockB)}
	if _, err := ws.AgentsSendCommand(ctx, back); err == nil || !strings.Contains(err.Error(), "wsh agents read") {
		t.Fatalf("send back in the same turn: err = %v", err)
	}
	// a third agent is not locked out of either
	if _, err := ws.AgentsSendCommand(ctx, wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "fyi", FromORef: blockORef(agentsBlockC)}); err != nil {
		t.Errorf("send from an uninvolved agent: %v", err)
	}
	if len(*sent) != 2 {
		t.Fatalf("deliveries = %d, want 2", len(*sent))
	}

	// a working report does not end the turn; the idle one does
	for _, state := range []string{baseds.AgentState_Working, baseds.AgentState_Idle} {
		oref := blockORef(agentsBlockB)
		publishEvent(ctx, wps.WaveEvent{
			Event:  wps.Event_AgentStatus,
			Scopes: []string{oref},
			Data:   baseds.AgentStatusData{ORef: oref, State: state, Agent: "claude", Ts: time.Now().UnixMilli()},
		})
		_, err := ws.AgentsSendCommand(ctx, back)
		if state == baseds.AgentState_Working && err == nil {
			t.Fatal("send back accepted while the turn is still running")
		}
		if state == baseds.AgentState_Idle && err != nil {
			t.Fatalf("send back after the turn ended: %v", err)
		}
	}
	if len(*sent) != 3 || (*sent)[2].blockId != agentsBlockA {
		t.Errorf("deliveries = %+v, want a third to block %s", *sent, agentsBlockA)
	}
}

func TestAgentsSendMidTurn(t *testing.T) {
	cases := []struct {
		name    string
		state   string
		openAsk bool
		midTurn bool
	}{
		{"idle", baseds.AgentState_Idle, false, false},
		{"working", baseds.AgentState_Working, false, true},
		// over the stream the message joins the turn and leaves the question's dialog alone
		{"asking with a stream", baseds.AgentState_Asking, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			facts := threeAgents()
			facts.Tabs[1].Status.State = c.state
			facts.Tabs[1].OpenAsk = c.openAsk
			facts.Tabs[1].HasStream = true
			sent := scriptAgents(t, facts)
			rtn, err := (&WshServer{}).AgentsSendCommand(context.Background(), wshrpc.CommandAgentsSendData{Tab: agentsTabB, Text: "hi", FromORef: blockORef(agentsBlockA)})
			if err != nil {
				t.Fatal(err)
			}
			if rtn.MidTurn != c.midTurn || len(*sent) != 1 {
				t.Errorf("midturn = %v, deliveries = %d; want %v and 1", rtn.MidTurn, len(*sent), c.midTurn)
			}
		})
	}
}

func TestAgentsRead(t *testing.T) {
	tpath := filepath.Join(t.TempDir(), "session.jsonl")
	lines := []string{
		`{"type":"user","timestamp":"2026-10-06T09:59:00.000Z","message":{"content":"do it"}}`,
		`{"type":"assistant","timestamp":"2026-10-06T10:00:00.000Z","message":{"content":[{"type":"text","text":"first"}]}}`,
		`{"type":"assistant","timestamp":"2026-10-06T10:05:00.000Z","message":{"content":[{"type":"text","text":"all done"}]}}`,
	}
	if err := os.WriteFile(tpath, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	facts := threeAgents()
	facts.Tabs[0].Status.TranscriptPath = tpath
	// no status path and no session id: nothing says where this one's transcript is
	facts.Tabs[1].Status.State = baseds.AgentState_Working
	scriptAgents(t, facts)
	ws := &WshServer{}

	rtn, err := ws.AgentsReadCommand(context.Background(), wshrpc.CommandAgentsReadData{Tab: "aaaa"})
	if err != nil {
		t.Fatal(err)
	}
	wantTs := time.Date(2026, 10, 6, 10, 5, 0, 0, time.UTC).UnixMilli()
	if rtn.TabId != agentsTabA || rtn.State != wshrpc.AgentsState_Working || rtn.Answer != "all done" || rtn.AnswerTs != wantTs {
		t.Errorf("read = %+v, want the last answer at %d", rtn, wantTs)
	}

	rtn, err = ws.AgentsReadCommand(context.Background(), wshrpc.CommandAgentsReadData{Tab: agentsTabB})
	if err != nil {
		t.Fatalf("read with no transcript path: %v", err)
	}
	if rtn.TabId != agentsTabB || rtn.State != wshrpc.AgentsState_Working || rtn.Answer != "" || rtn.AnswerTs != 0 {
		t.Errorf("read with no transcript path = %+v, want an empty answer with the state", rtn)
	}

	// the block's recorded path is used when the status carries none
	blockTranscriptMeta = func(_ context.Context, blockId string) (string, error) {
		if blockId != agentsBlockB {
			t.Errorf("transcript meta read for block %s", blockId)
		}
		return tpath, nil
	}
	if rtn, err = ws.AgentsReadCommand(context.Background(), wshrpc.CommandAgentsReadData{Tab: agentsTabB}); err != nil || rtn.Answer != "all done" {
		t.Errorf("read through the block's meta = %+v, %v", rtn, err)
	}

	if _, err = ws.AgentsReadCommand(context.Background(), wshrpc.CommandAgentsReadData{Tab: "bbbb"}); err == nil || !strings.Contains(err.Error(), "matches several") {
		t.Errorf("ambiguous read: err = %v", err)
	}
}

// an agent's side pane is the same agent: wsh run there is locked as the tab's agent block is
func TestAgentsSendBackLockCoversEveryBlockOfTheTab(t *testing.T) {
	const sideBlock = "a0000000-0000-4000-8000-0000000000aa"
	facts := threeAgents()
	facts.Tabs[0].Tab.BlockIds = append(facts.Tabs[0].Tab.BlockIds, sideBlock)
	sent := scriptAgents(t, facts)
	ws := &WshServer{}
	ctx := context.Background()

	if _, err := ws.AgentsSendCommand(ctx, wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "hi", FromORef: blockORef(agentsBlockB)}); err != nil {
		t.Fatal(err)
	}
	back := wshrpc.CommandAgentsSendData{Tab: agentsTabB, Text: "thanks", FromORef: blockORef(sideBlock)}
	if _, err := ws.AgentsSendCommand(ctx, back); err == nil || !strings.Contains(err.Error(), "wsh agents read") {
		t.Fatalf("send back from the tab's second block: err = %v", err)
	}
	// and a send from the side pane locks its target against the agent block
	agentmsg.TurnEnded(agentsBlockA)
	if _, err := ws.AgentsSendCommand(ctx, wshrpc.CommandAgentsSendData{Tab: agentsTabC, Text: "hi", FromORef: blockORef(sideBlock)}); err != nil {
		t.Fatal(err)
	}
	if !agentmsg.SendBackLocked(agentsBlockC, agentsBlockA) {
		t.Error("a send from the second block did not lock its target against the tab's agent block")
	}
	if len(*sent) != 2 {
		t.Errorf("deliveries = %d, want 2", len(*sent))
	}
}

// a reporter that scopes its status to the tab ends the turn as a block-scoped one does
func TestAgentsTabScopedStatusOpensSendBack(t *testing.T) {
	// an oref only parses with a uuid in it
	const piTab = "c0000000-0000-4000-8000-0000000000cc"
	facts := threeAgents()
	facts.Tabs[2].Tab.OID = piTab
	scriptAgents(t, facts)
	ws := &WshServer{}
	ctx := context.Background()
	if _, err := ws.AgentsSendCommand(ctx, wshrpc.CommandAgentsSendData{Tab: piTab, Text: "hi", FromORef: blockORef(agentsBlockA)}); err != nil {
		t.Fatal(err)
	}
	back := wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "thanks", FromORef: blockORef(agentsBlockC)}
	if _, err := ws.AgentsSendCommand(ctx, back); err == nil {
		t.Fatal("send back accepted while the turn is still running")
	}
	oref := waveobj.MakeORef(waveobj.OType_Tab, piTab).String()
	publishEvent(ctx, wps.WaveEvent{
		Event:  wps.Event_AgentStatus,
		Scopes: []string{oref},
		Data:   baseds.AgentStatusData{ORef: oref, State: baseds.AgentState_Idle, Agent: "pi", Ts: time.Now().UnixMilli()},
	})
	if _, err := ws.AgentsSendCommand(ctx, back); err != nil {
		t.Fatalf("send back after a tab-scoped idle: %v", err)
	}
}

func TestPublishEventDropsAnOvertakenStatus(t *testing.T) {
	ctx := context.Background()
	oref := blockORef("b0000000-0000-4000-8000-00000000057a")
	publish := func(state string, ts int64) string {
		publishEvent(ctx, wps.WaveEvent{
			Event:   wps.Event_AgentStatus,
			Scopes:  []string{oref},
			Persist: 1,
			Data:    baseds.AgentStatusData{ORef: oref, State: state, Agent: "claude", Ts: ts},
		})
		var last baseds.AgentStatusData
		for _, ev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, oref, 1) {
			if err := utilfn.ReUnmarshal(&last, ev.Data); err != nil {
				t.Fatal(err)
			}
		}
		return last.State
	}
	now := time.Now().UnixMilli()
	if got := publish(baseds.AgentState_Idle, now); got != baseds.AgentState_Idle {
		t.Fatalf("retained = %q, want idle", got)
	}
	// a background hook that started before the turn ended and got through after it
	if got := publish(baseds.AgentState_Working, now-500); got != baseds.AgentState_Idle {
		t.Fatalf("a late working replaced the idle after it: retained = %q", got)
	}
	// the same instant is not older: two reports in one millisecond both land
	if got := publish(baseds.AgentState_Waiting, now); got != baseds.AgentState_Waiting {
		t.Fatalf("retained = %q, want waiting", got)
	}
	// far older than any hook can lag is a clock that stepped back, and status must not freeze on it
	if got := publish(baseds.AgentState_Working, now-staleStatusWindowMs-1); got != baseds.AgentState_Working {
		t.Fatalf("a report after a clock step was dropped: retained = %q", got)
	}
}
