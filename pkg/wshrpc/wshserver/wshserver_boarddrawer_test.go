// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/boarddrawer"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// drawResult runs `wsh board draw` in a goroutine, as the command blocks until the turn is over.
type drawResult struct {
	rtn *wshrpc.BoardAgentDrawRtnData
	err error
}

func (w *boardWorld) draw(blockId, board, brief, ask string) <-chan drawResult {
	out := make(chan drawResult, 1)
	go func() {
		rtn, err := w.ws.BoardAgentDrawCommand(w.ctx, wshrpc.CommandBoardAgentDrawData{BlockId: blockId, Board: board, Context: brief, Ask: ask})
		out <- drawResult{rtn, err}
	}()
	return out
}

func (w *boardWorld) drawDone(ch <-chan drawResult) drawResult {
	w.t.Helper()
	select {
	case r := <-ch:
		return r
	case <-time.After(10 * time.Second):
		w.t.Fatal("wsh board draw did not return")
		return drawResult{}
	}
}

// boards is the project's board rows.
func (w *boardWorld) boards() []wshrpc.BoardInfo {
	w.t.Helper()
	list, err := w.ws.BoardListCommand(w.ctx, wshrpc.CommandBoardListData{Project: w.project})
	if err != nil {
		w.t.Fatal(err)
	}
	return list.Boards
}

// another live claude agent in the world's project, with its own tab and block.
func (w *boardWorld) addAgent(name string) (tab, block string) {
	tab, block = uuid.NewString(), uuid.NewString()
	tf := agentFacts(tab, name, block, "claude", baseds.AgentState_Idle)
	tf.ProjectPath, tf.Status.Cwd = w.path, w.path
	w.facts.Tabs = append(w.facts.Tabs, tf)
	return tab, block
}

func TestBoardAgentDrawCreatesAndTiesTheBoard(t *testing.T) {
	w := newBoardWorld(t)
	res := w.draw(w.block, "Auth flow", "how login works: browser, api, token store", "draw the login")
	w.land("")
	r := w.drawDone(res)
	if r.err != nil {
		t.Fatal(r.err)
	}
	got := r.rtn
	if got.State != "answered" || got.Added != 1 || got.Changed != 0 || got.Removed != 0 || !got.Created || got.BoardName != "Auth flow" || got.Project != w.project {
		t.Fatalf("result: %+v", got)
	}

	boards := w.boards()
	if len(boards) != 1 || boards[0].ID != got.BoardId || boards[0].AgentTabId != w.tab || boards[0].AgentTitle != "lead" || boards[0].Turns != 1 {
		t.Fatalf("boards: %+v", boards)
	}
	talk := w.talk(got.BoardId)
	if talk.Project != w.project || talk.Agent == nil || talk.Agent.TabId != w.tab || talk.Agent.SessionId != "sess-1" {
		t.Errorf("the talk's agent: %+v", talk.Agent)
	}
	turn := talk.Turns[0]
	if turn.Kind != boarddrawer.KindRequest || turn.Question != "draw the login" || turn.Context != "how login works: browser, api, token store" || turn.State != boarddrawer.StateAnswered {
		t.Errorf("the request turn: %+v", turn)
	}
	// the briefing reached the drawer's first prompt, and it ran in the project's folder
	if prompts := w.model.prompts(); len(prompts) != 1 || !strings.Contains(prompts[0], "browser, api, token store") {
		t.Errorf("the drawer's prompts: %q", prompts)
	}
	if w.model.cwds[0] != w.path {
		t.Errorf("the drawer ran in %q, want %q", w.model.cwds[0], w.path)
	}

	// a later request names the board in any case, needs no briefing and makes no second board
	res = w.draw(w.block, " auth FLOW ", "", "add the logout")
	w.land("")
	if r = w.drawDone(res); r.err != nil || r.rtn.Created || r.rtn.BoardId != got.BoardId {
		t.Fatalf("a later request: %+v %v", r.rtn, r.err)
	}
	if boards := w.boards(); len(boards) != 1 || boards[0].Turns != 2 {
		t.Errorf("boards after a second request: %+v", boards)
	}
}

func TestBoardAgentDrawNewBoardNeedsContext(t *testing.T) {
	w := newBoardWorld(t)
	_, err := w.ws.BoardAgentDrawCommand(w.ctx, wshrpc.CommandBoardAgentDrawData{BlockId: w.block, Board: "Auth flow", Ask: "draw the login"})
	if err == nil || !strings.Contains(err.Error(), "--context") {
		t.Fatalf("a request for a board that does not exist: %v, want an error naming --context", err)
	}
	if len(w.boards()) != 0 || len(w.model.prompts()) != 0 {
		t.Error("the refused request made a board or ran the drawer")
	}
	for _, data := range []wshrpc.CommandBoardAgentDrawData{
		{BlockId: w.block, Board: "Auth flow"},
		{BlockId: w.block, Ask: "x", Context: "y"},
		{Board: "Auth flow", Ask: "x"},
	} {
		if _, err := w.ws.BoardAgentDrawCommand(w.ctx, data); err == nil {
			t.Errorf("accepted %+v", data)
		}
	}
}

func TestBoardAgentDrawRefusesOtherAgents(t *testing.T) {
	w := newBoardWorld(t)
	piBlock, codexBlock, projectless, unregistered := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	pi := agentFacts(uuid.NewString(), "scout", piBlock, "pi", baseds.AgentState_Idle)
	pi.ProjectPath, pi.Status.Cwd = w.path, w.path
	codex := agentFacts(uuid.NewString(), "codexer", codexBlock, "codex", baseds.AgentState_Idle) // not in the roster at all
	codex.ProjectPath, codex.Status.Cwd = w.path, w.path
	loose := agentFacts(uuid.NewString(), "loose", projectless, "claude", baseds.AgentState_Idle)
	loose.ProjectPath, loose.Status.Cwd = "", ""
	// a real folder no registered project holds: the roster names its project after the folder, but there is nowhere to
	// list a board under that name
	stray := agentFacts(uuid.NewString(), "stray", unregistered, "claude", baseds.AgentState_Idle)
	stray.ProjectPath, stray.Status.Cwd = t.TempDir(), ""
	w.facts.Tabs = append(w.facts.Tabs, pi, codex, loose, stray)

	for name, tc := range map[string]struct{ block, want string }{
		"pi":              {piBlock, "boards are for Claude agents"},
		"codex":           {codexBlock, "boards are for Claude agents"},
		"no project":      {projectless, "loose is not in a registered project"},
		"unregistered":    {unregistered, "stray is not in a registered project"},
		"a block of none": {uuid.NewString(), "no tab"},
	} {
		_, err := w.ws.BoardAgentDrawCommand(w.ctx, wshrpc.CommandBoardAgentDrawData{BlockId: tc.block, Board: "Auth flow", Context: "x", Ask: "y"})
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want %q", name, err, tc.want)
		}
	}
	if len(w.boards()) != 0 || len(w.model.prompts()) != 0 {
		t.Error("a refused agent made a board or ran the drawer")
	}
}

// the board stays tied to the agent that made it: another agent's request is drawn and leaves the tie as it is
func TestBoardAgentDrawKeepsAnotherAgentsTie(t *testing.T) {
	w := newBoardWorld(t)
	res := w.draw(w.block, "Auth flow", "how login works", "draw the login")
	w.land("")
	first := w.drawDone(res).rtn

	otherTab, otherBlock := w.addAgent("reviewer")
	res = w.draw(otherBlock, "Auth flow", "", "mark the token store red")
	w.land("")
	r := w.drawDone(res)
	if r.err != nil || r.rtn.BoardId != first.BoardId || r.rtn.Created || r.rtn.State != "answered" {
		t.Fatalf("the other agent's request: %+v %v", r.rtn, r.err)
	}
	talk := w.talk(first.BoardId)
	if talk.Agent.TabId != w.tab || talk.Agent.TabId == otherTab || len(talk.Turns) != 2 {
		t.Errorf("the tie moved or the request was lost: agent %+v, %d turns", talk.Agent, len(talk.Turns))
	}
	if boards := w.boards(); len(boards) != 1 || boards[0].AgentTabId != w.tab {
		t.Errorf("boards: %+v", boards)
	}
}

// a board whose agent's tab is gone (ended, closed, deleted) goes to the next agent of its project that draws on it: its
// turns and drawer session stay, and the drawer reads the new agent's session from its start
func TestBoardAgentDrawTakesOverABoardWhoseAgentIsGone(t *testing.T) {
	w := newBoardWorld(t)
	res := w.draw(w.block, "Auth flow", "how login works", "draw the login")
	w.land("")
	first := w.drawDone(res).rtn
	drawerSession := w.talk(first.BoardId).SessionId

	otherTab, otherBlock := w.addAgent("reviewer")
	w.facts.Tabs = w.facts.Tabs[1:] // the lead's tab is gone
	res = w.draw(otherBlock, "auth flow", "", "mark the token store red")
	w.land("")
	r := w.drawDone(res)
	if r.err != nil || r.rtn.BoardId != first.BoardId || r.rtn.Created || r.rtn.State != "answered" {
		t.Fatalf("the request on the ended agent's board: %+v %v", r.rtn, r.err)
	}
	talk := w.talk(first.BoardId)
	if talk.Agent == nil || talk.Agent.TabId != otherTab || talk.Agent.Title != "reviewer" || len(talk.Turns) != 2 || talk.SessionId != drawerSession {
		t.Errorf("after the takeover: agent %+v, %d turns, drawer session %q (was %q)", talk.Agent, len(talk.Turns), talk.SessionId, drawerSession)
	}
	if boards := w.boards(); len(boards) != 1 || boards[0].AgentTabId != otherTab {
		t.Errorf("boards: %+v", boards)
	}
}

// Library's Open beside Chat and the board cell's Chat picker: a live Claude agent of the board's project takes the board
// over, whether its agent is gone or still live; an agent of another project or harness, and one not running are refused,
// the tie left as it was
func TestBoardTakeOver(t *testing.T) {
	w := newBoardWorld(t)
	res := w.draw(w.block, "Auth flow", "how login works", "draw the login")
	w.land("")
	b := w.drawDone(res).rtn
	take := func(tab string) (*wshrpc.BoardInfo, error) {
		return w.ws.BoardTakeOverCommand(w.ctx, wshrpc.CommandBoardTakeOverData{Project: w.project, BoardId: b.BoardId, TabId: tab})
	}

	otherTab, _ := w.addAgent("reviewer")
	if info, err := take(otherTab); err != nil || info.AgentTabId != otherTab {
		t.Errorf("moving a live agent's board to another live chat: %+v %v", info, err)
	}
	if talk := w.talk(b.BoardId); talk.Agent.TabId != otherTab || talk.Agent.ReadTs != 0 {
		t.Errorf("after the move the drawer reads the new chat from its start: %+v", talk.Agent)
	}
	if info, err := take(w.tab); err != nil || info.AgentTabId != w.tab {
		t.Errorf("moving it back: %+v %v", info, err)
	}
	if info, err := take(w.tab); err != nil || info.AgentTabId != w.tab {
		t.Errorf("the board's own agent: %+v %v", info, err)
	}

	stranger := agentFacts(uuid.NewString(), "elsewhere", uuid.NewString(), "claude", baseds.AgentState_Idle)
	stranger.ProjectPath, stranger.Status.Cwd = t.TempDir(), ""
	piTab := uuid.NewString()
	pi := agentFacts(piTab, "pi", uuid.NewString(), "pi", baseds.AgentState_Idle)
	pi.ProjectPath, pi.Status.Cwd = w.path, w.path
	w.facts.Tabs = append(w.facts.Tabs[1:], stranger, pi) // the lead's tab is gone
	for name, tab := range map[string]string{"another project": stranger.Tab.OID, "a pi agent": piTab, "not running": uuid.NewString()} {
		if _, err := take(tab); err == nil {
			t.Errorf("%s took the board", name)
		}
	}
	if talk := w.talk(b.BoardId); talk.Agent.TabId != w.tab {
		t.Fatalf("a refused takeover moved the tie: %+v", talk.Agent)
	}

	info, err := take(otherTab)
	if err != nil || info.AgentTabId != otherTab || info.AgentTitle != "reviewer" {
		t.Fatalf("the takeover: %+v %v", info, err)
	}
	if talk := w.talk(b.BoardId); talk.Agent.TabId != otherTab || len(talk.Turns) != 1 {
		t.Errorf("after the takeover: agent %+v, %d turns", talk.Agent, len(talk.Turns))
	}
	if boards := w.boards(); len(boards) != 1 || boards[0].AgentTabId != otherTab {
		t.Errorf("boards: %+v", boards)
	}
}

// the command returns what happened once the frontend acked, and "answering" when its wait ran out
func TestBoardAgentDrawReturnsCountsOnceAckedAndAnsweringPastTheWait(t *testing.T) {
	w := newBoardWorld(t)
	boardDrawWait = 150 * time.Millisecond
	res := w.draw(w.block, "Auth flow", "how login works", "draw the login")
	// nobody acks: the wait runs out while the drawing waits in the inbox
	r := w.drawDone(res)
	if r.err != nil || r.rtn.State != "answering" || !r.rtn.Created || r.rtn.BoardName != "Auth flow" {
		t.Fatalf("past the wait: %+v %v", r.rtn, r.err)
	}
	// the drawing lands later: the turn is answered, and the board takes the next request
	w.land("")
	turn := w.waitTurn(r.rtn.BoardId, w.lastTurn(r.rtn.BoardId).ID, boarddrawer.StateAnswered)
	if turn.Added != 1 {
		t.Errorf("the late landing: %+v", turn)
	}
	boardDrawWait = 10 * time.Second
	res = w.draw(w.block, "Auth flow", "", "more")
	w.land("")
	if r = w.drawDone(res); r.err != nil || r.rtn.State != "answered" || r.rtn.Added != 1 {
		t.Fatalf("a request after the late landing: %+v %v", r.rtn, r.err)
	}
}

func TestBoardAgentDrawFailures(t *testing.T) {
	cases := []struct {
		name  string
		reply func(boarddrawer.Call) (string, error)
		land  string // when set, the frontend acks with this error
		want  string
	}{
		{"the model fails", func(boarddrawer.Call) (string, error) { return "", errors.New("the drawer's session exited") }, "", "the drawer's session exited"},
		{"the drawer flags a request as a question", func(boarddrawer.Call) (string, error) { return boardQuestion, nil }, "", "agent's request"},
		{"the frontend cannot land it", nil, "Excalidraw would not load the shapes", "Excalidraw would not load the shapes"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := newBoardWorld(t)
			w.model.reply = tc.reply
			res := w.draw(w.block, "Auth flow", "how login works", "draw the login")
			if tc.land != "" {
				w.land(tc.land)
			}
			r := w.drawDone(res)
			if r.err != nil || r.rtn.State != "failed" || !strings.Contains(r.rtn.Reason, tc.want) || r.rtn.Added != 0 {
				t.Fatalf("result: %+v %v, want failed with %q", r.rtn, r.err, tc.want)
			}
			if turn := w.lastTurn(r.rtn.BoardId); turn.State != boarddrawer.StateFailed || turn.Kind != boarddrawer.KindRequest {
				t.Errorf("turn: %+v", turn)
			}
		})
	}
}

func TestBoardAgentDrawStoppedFromTheBoardIsFailed(t *testing.T) {
	w := newBoardWorld(t)
	started := make(chan struct{})
	boarddrawer.RunModel = func(ctx context.Context, cwd string, c boarddrawer.Call) (boarddrawer.Reply, error) {
		close(started)
		<-ctx.Done()
		return boarddrawer.Reply{}, ctx.Err()
	}
	res := w.draw(w.block, "Auth flow", "how login works", "draw the login")
	<-started
	boards := w.boards()
	if err := w.ws.BoardAskStopCommand(w.ctx, w.ref(boards[0].ID)); err != nil {
		t.Fatal(err)
	}
	r := w.drawDone(res)
	if r.err != nil || r.rtn.State != "failed" || r.rtn.Reason != boardStoppedReason {
		t.Fatalf("a stopped request: %+v %v", r.rtn, r.err)
	}
}

// two requests for one new board that arrive together make one board
func TestBoardAgentDrawSerializesFindOrCreate(t *testing.T) {
	w := newBoardWorld(t)
	boardDrawWait = 200 * time.Millisecond
	var wg sync.WaitGroup
	results := make([]drawResult, 6)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rtn, err := w.ws.BoardAgentDrawCommand(w.ctx, wshrpc.CommandBoardAgentDrawData{BlockId: w.block, Board: "Auth flow", Context: "how login works", Ask: "draw it"})
			results[i] = drawResult{rtn, err}
		}()
	}
	wg.Wait()
	created := 0
	for _, r := range results {
		if r.err != nil {
			t.Fatal(r.err)
		}
		if r.rtn.Created {
			created++
		}
	}
	if boards := w.boards(); len(boards) != 1 || created != 1 {
		t.Fatalf("%d boards made, %d results say created; want one of each", len(boards), created)
	}
}

func TestBoardAgentDrawRefusesABoardThatWontOpen(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	if err := os.WriteFile(info.Path, []byte(`{"arc":{"name":"Auth flow"},"elements":[`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := w.ws.BoardAgentDrawCommand(w.ctx, wshrpc.CommandBoardAgentDrawData{BlockId: w.block, Board: "Auth flow", Ask: "draw"})
	if err == nil || !strings.Contains(err.Error(), "won't open") {
		t.Fatalf("a damaged board: %v, want it named, not a twin made", err)
	}
	if len(w.boards()) != 1 {
		t.Error("a twin of the damaged board was made")
	}
}

// the drawer reads what the agent said since its last read, and the session id and cursor follow the agent
func TestBoardReadAgentReadsNewWordsAndFollowsTheSession(t *testing.T) {
	w := newBoardWorld(t)
	base := time.Now().Add(-time.Hour).UnixMilli()
	w.writeTranscript(
		claudeLine(t, "user", "how does login work?", base),
		claudeLine(t, "agent", "the browser posts to the api", base+1000),
		claudeLine(t, "agent", "which checks the token store", base+2000),
		claudeLine(t, "user", "draw it", base+3000),
	)
	agent := wshrpc.BoardAgent{TabId: w.tab}

	text, session, cursor, err := readBoardAgent(w.ctx, agent, 0)
	if err != nil || session != "sess-1" || cursor != base+3000 {
		t.Fatalf("first read: session %q cursor %d err %v", session, cursor, err)
	}
	// the agent's words only, its two replies as one turn
	if text != "the browser posts to the api\nwhich checks the token store" {
		t.Errorf("text: %q", text)
	}
	if text, _, again, _ := readBoardAgent(w.ctx, agent, cursor); text != "" || again != cursor {
		t.Errorf("a read at the cursor: %q, cursor %d (was %d), want nothing and the cursor kept", text, again, cursor)
	}

	// /clear: a new session in a new transcript, and the id follows
	next := w.transcript + ".2"
	w.agent().Status.TranscriptPath, w.agent().Status.SessionID = next, "sess-2"
	w.transcript = next
	w.writeTranscript(claudeLine(t, "agent", "a fresh start", base+9000))
	text, session, cursor, err = readBoardAgent(w.ctx, agent, base+3000)
	if err != nil || text != "a fresh start" || session != "sess-2" || cursor != base+9000 {
		t.Errorf("after /clear: %q %q %d %v", text, session, cursor, err)
	}

	// an agent whose tab is gone reads nothing, and is no error
	w.facts.Tabs = nil
	text, session, cursor, err = readBoardAgent(w.ctx, agent, base)
	if err != nil || text != "" || session != "" || cursor != base {
		t.Errorf("an ended agent: %q %q %d %v", text, session, cursor, err)
	}
}

func TestBoardReadAgentKeepsTheNewestWords(t *testing.T) {
	w := newBoardWorld(t)
	base := time.Now().Add(-time.Hour).UnixMilli()
	long := strings.Repeat("old ", boardAgentReadRunes) // a stretch much longer than a read
	w.writeTranscript(claudeLine(t, "agent", long, base), claudeLine(t, "user", "next", base+1000), claudeLine(t, "agent", "the newest words", base+2000))
	text, _, _, err := readBoardAgent(w.ctx, wshrpc.BoardAgent{TabId: w.tab}, 0)
	if err != nil || !strings.HasPrefix(text, boardAgentCutMark) || !strings.HasSuffix(text, "the newest words") || len([]rune(text)) > boardAgentReadRunes+len(boardAgentCutMark) {
		t.Fatalf("a long read: %d runes, starts %q, ends %q, %v", len([]rune(text)), text[:min(30, len(text))], text[max(0, len(text)-20):], err)
	}
}

// the wiring end to end: a turn's prompt holds what the agent said, and the talk keeps the cursor and session
func TestBoardTurnReadsTheAgentIntoItsPrompt(t *testing.T) {
	w := newBoardWorld(t)
	base := time.Now().Add(-time.Minute).UnixMilli()
	w.writeTranscript(claudeLine(t, "agent", "the cache has two tiers", base))
	info := w.makeBoard("Cache")
	if err := w.ask(info.ID, "draw what we just discussed"); err != nil {
		t.Fatal(err)
	}
	w.land("")
	if prompts := w.model.prompts(); len(prompts) != 1 || !strings.Contains(prompts[0], "the cache has two tiers") {
		t.Fatalf("the drawer's prompt did not hold the agent's words: %q", prompts)
	}
	waitFor(t, func() bool {
		a := w.talk(info.ID).Agent
		return a != nil && a.ReadTs == base && a.SessionId == "sess-1"
	}, "the agent's read cursor and session to be kept")
}

func TestBoardFolderFallsBackToTheRegisteredProject(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	w.facts.Tabs = nil // the agent ended
	// a retry still runs the drawer, in the folder of the project that has the board's project's name
	_, err := boardToRun(w.ctx, w.project, info.ID, false)
	if err != nil {
		t.Fatalf("an ended agent's board in a registered project: %v", err)
	}
	w.facts.Channels = []*waveobj.Channel{}
	if _, err := boardToRun(w.ctx, w.project, info.ID, false); err == nil || !strings.Contains(err.Error(), "not known") {
		t.Errorf("no folder to run in: %v", err)
	}
}
