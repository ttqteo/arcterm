// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/boarddrawer"
	"github.com/wavetermdev/waveterm/pkg/boardstore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// a drawing the drawer accepts: one text shape
	boardDrawing  = `{"title":"Auth flow","add":[{"type":"text","id":"s1","x":0,"y":0,"text":"login"}]}`
	boardQuestion = `{"question":true}`
)

// boardModel is the drawer's model, stubbed: it answers each run with reply and records what it was asked in.
type boardModel struct {
	mu    sync.Mutex
	calls []boarddrawer.Call
	cwds  []string
	reply func(c boarddrawer.Call) (string, error)
}

func (m *boardModel) run(ctx context.Context, cwd string, c boarddrawer.Call) (boarddrawer.Reply, error) {
	m.mu.Lock()
	m.calls = append(m.calls, c)
	m.cwds = append(m.cwds, cwd)
	reply := m.reply
	m.mu.Unlock()
	if reply == nil {
		return boarddrawer.Reply{Text: boardDrawing}, nil
	}
	text, err := reply(c)
	return boarddrawer.Reply{Text: text}, err
}

func (m *boardModel) prompts() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for _, c := range m.calls {
		out = append(out, c.Prompt)
	}
	return out
}

// boardWorld is a project with one live claude agent in it, a drawer whose model is stubbed, and what was typed into
// agents. Its project and ids are its own, so what other tests leave in the shared data dir never reaches it.
type boardWorld struct {
	t          *testing.T
	ctx        context.Context
	ws         *WshServer
	project    string
	path       string
	tab, block string
	transcript string
	facts      *agentRosterFacts
	typed      *[]agentsDelivery
	model      *boardModel
}

func newBoardWorld(t *testing.T) *boardWorld {
	t.Helper()
	w := &boardWorld{
		t: t, ctx: context.Background(), ws: &WshServer{},
		project: "board-" + uuid.NewString()[:8], path: t.TempDir(),
		tab: uuid.NewString(), block: uuid.NewString(), model: &boardModel{},
	}
	w.transcript = filepath.Join(t.TempDir(), "session.jsonl")
	tf := agentFacts(w.tab, "lead", w.block, "claude", baseds.AgentState_Idle)
	tf.ProjectPath, tf.Status.Cwd, tf.Status.TranscriptPath, tf.Status.SessionID = w.path, w.path, w.transcript, "sess-1"
	w.facts = &agentRosterFacts{
		Tabs:     []agentTabFacts{tf},
		Channels: []*waveobj.Channel{{OID: uuid.NewString(), Name: w.project, ProjectPath: w.path}},
	}
	w.typed = scriptAgents(t, w.facts)

	oldDrawer, oldForwards, oldRun, oldWait := boardDrawer, boardForwards, boarddrawer.RunModel, boardDrawWait
	boardDrawer, boardForwards, boarddrawer.RunModel, boardDrawWait = newBoardDrawer(), &boardForwarder{}, w.model.run, 10*time.Second
	t.Cleanup(func() {
		boardForwards.work.Wait()
		boardDrawer, boardForwards, boarddrawer.RunModel, boardDrawWait = oldDrawer, oldForwards, oldRun, oldWait
	})
	return w
}

// agent is the tied agent's facts, which a test edits to change what the roster says of it.
func (w *boardWorld) agent() *agentTabFacts { return &w.facts.Tabs[0] }

func (w *boardWorld) dir() string { return boardstore.ProjectDir(w.project) }

// makeBoard writes a board tied to the world's agent, as `wsh board draw --context` would.
func (w *boardWorld) makeBoard(name string) wshrpc.BoardInfo {
	w.t.Helper()
	info, err := boardstore.Create(w.dir(), w.project, name, wshrpc.BoardAgent{TabId: w.tab, Title: "lead"}, time.Now().UnixMilli())
	if err != nil {
		w.t.Fatal(err)
	}
	return info
}

func (w *boardWorld) ref(boardId string) wshrpc.CommandBoardRefData {
	return wshrpc.CommandBoardRefData{Project: w.project, BoardId: boardId}
}

func (w *boardWorld) turnRef(boardId, turnId string) wshrpc.CommandBoardTurnData {
	return wshrpc.CommandBoardTurnData{Project: w.project, BoardId: boardId, TurnId: turnId}
}

func (w *boardWorld) ask(boardId, question string) error {
	return w.ws.BoardAskCommand(w.ctx, wshrpc.CommandBoardAskData{Project: w.project, BoardId: boardId, Question: question})
}

func (w *boardWorld) talk(boardId string) wshrpc.BoardTalk {
	w.t.Helper()
	talk, err := boardstore.ReadTalk(w.dir(), boardId)
	if err != nil {
		w.t.Fatal(err)
	}
	return talk
}

func (w *boardWorld) lastTurn(boardId string) wshrpc.BoardTurn {
	w.t.Helper()
	talk := w.talk(boardId)
	if len(talk.Turns) == 0 {
		w.t.Fatal("the board has no turns")
	}
	return talk.Turns[len(talk.Turns)-1]
}

// waitTurn waits for a turn to reach a state, the forwarder's and the drawer's work being goroutines.
func (w *boardWorld) waitTurn(boardId, turnId, state string) wshrpc.BoardTurn {
	w.t.Helper()
	var t wshrpc.BoardTurn
	waitFor(w.t, func() bool {
		for _, turn := range w.talk(boardId).Turns {
			if turn.ID == turnId {
				t = turn
			}
		}
		return t.State == state
	}, "turn "+turnId+" to be "+state)
	return t
}

func waitFor(t *testing.T, ok func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// land plays the frontend's applier: it takes the next answer waiting in the inbox of the project's boards and acks it,
// with an error when errText is set. It returns the answer it took.
func (w *boardWorld) land(errText string) wshrpc.BoardAnswer {
	w.t.Helper()
	taken := w.waitAnswer()
	w.ack(taken, errText)
	return taken
}

func (w *boardWorld) ack(taken wshrpc.BoardAnswer, errText string) {
	w.t.Helper()
	err := w.ws.BoardAnswerAckCommand(w.ctx, wshrpc.CommandBoardAnswerAckData{
		Project: w.project, BoardId: taken.BoardId, AnswerId: taken.ID, TurnId: taken.TurnId, ShapeIds: []string{"s1"}, Error: errText,
	})
	if err != nil {
		w.t.Fatalf("ack: %v", err)
	}
}

// waitAnswer is the next answer waiting in the inbox of the project's boards, not acked.
func (w *boardWorld) waitAnswer() wshrpc.BoardAnswer {
	w.t.Helper()
	var taken wshrpc.BoardAnswer
	waitFor(w.t, func() bool {
		list, err := w.ws.BoardListCommand(w.ctx, wshrpc.CommandBoardListData{Project: w.project})
		if err != nil {
			w.t.Fatal(err)
		}
		for _, b := range list.Boards {
			answers, err := w.ws.BoardAnswerInboxCommand(w.ctx, w.ref(b.ID))
			if err != nil {
				w.t.Fatal(err)
			}
			if len(answers) > 0 {
				taken = answers[0]
				return true
			}
		}
		return false
	}, "an answer in the inbox")
	return taken
}

// claudeLine is one record of a claude transcript: the person's typed prompt or the agent's reply, at ts.
func claudeLine(t *testing.T, speaker, text string, ts int64) string {
	t.Helper()
	when := time.UnixMilli(ts).UTC().Format("2006-01-02T15:04:05.000Z")
	body, err := json.Marshal(text)
	if err != nil {
		t.Fatal(err)
	}
	if speaker == "user" {
		return `{"type":"user","timestamp":"` + when + `","origin":{"kind":"human"},"message":{"role":"user","content":` + string(body) + `}}`
	}
	return `{"type":"assistant","timestamp":"` + when + `","message":{"content":[{"type":"text","text":` + string(body) + `}]}}`
}

func (w *boardWorld) writeTranscript(lines ...string) {
	w.t.Helper()
	if err := os.WriteFile(w.transcript, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		w.t.Fatal(err)
	}
}

func TestBoardListReadSaveAcrossProjects(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")

	list, err := w.ws.BoardListCommand(w.ctx, wshrpc.CommandBoardListData{Project: w.project})
	if err != nil || len(list.Boards) != 1 || list.Boards[0].ID != info.ID || list.Boards[0].Project != w.project {
		t.Fatalf("list: %+v %v", list, err)
	}
	if b := list.Boards[0]; b.AgentTabId != w.tab || b.AgentTitle != "lead" || b.State != "" {
		t.Errorf("row: %+v", b)
	}

	// an empty project lists every project's boards, newest first, each naming its project
	other := newBoardWorld(t)
	newer, err := boardstore.Create(other.dir(), other.project, "Newer", wshrpc.BoardAgent{TabId: other.tab, Title: "lead"}, time.Now().Add(time.Hour).UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	all, err := w.ws.BoardListCommand(w.ctx, wshrpc.CommandBoardListData{})
	if err != nil {
		t.Fatal(err)
	}
	var seen []string
	for _, b := range all.Boards {
		switch b.ID {
		case info.ID:
			seen = append(seen, "older")
			if b.Project != w.project {
				t.Errorf("a row of the all-projects list names project %q, want %q", b.Project, w.project)
			}
		case newer.ID:
			seen = append(seen, "newer")
			if b.Project != other.project {
				t.Errorf("a row of the all-projects list names project %q, want %q", b.Project, other.project)
			}
		}
	}
	if strings.Join(seen, ",") != "newer,older" {
		t.Errorf("the all-projects list holds %v, want newer then older", seen)
	}

	read, err := w.ws.BoardReadCommand(w.ctx, w.ref(info.ID))
	if err != nil || read.Rev == "" || !strings.Contains(read.Data, `"elements":[]`) {
		t.Fatalf("read: %+v %v", read, err)
	}
	next := strings.Replace(read.Data, `"elements":[]`, `"elements":[{"id":"a","type":"rectangle"}]`, 1)
	saved, err := w.ws.BoardSaveCommand(w.ctx, wshrpc.CommandBoardSaveData{Project: w.project, BoardId: info.ID, Data: next, BaseRev: read.Rev})
	if err != nil || saved.Conflict || saved.Rev == "" {
		t.Fatalf("save: %+v %v", saved, err)
	}
	// the base rev again is stale now: nothing is written
	stale, err := w.ws.BoardSaveCommand(w.ctx, wshrpc.CommandBoardSaveData{Project: w.project, BoardId: info.ID, Data: read.Data, BaseRev: read.Rev})
	if err != nil || !stale.Conflict {
		t.Fatalf("stale save: %+v %v", stale, err)
	}
	if again, err := w.ws.BoardReadCommand(w.ctx, w.ref(info.ID)); err != nil || again.Rev != saved.Rev {
		t.Fatalf("a conflict wrote the file: %+v %v", again, err)
	}
}

func TestBoardCommandsRefuseBadIdsAndNoProject(t *testing.T) {
	w := newBoardWorld(t)
	for _, bad := range []string{"", "..", "../x", "ABCDEF12", "abc", `..\..\x`} {
		if _, err := w.ws.BoardReadCommand(w.ctx, w.ref(bad)); err == nil {
			t.Errorf("read accepted board id %q", bad)
		}
		if _, err := w.ws.BoardSaveCommand(w.ctx, wshrpc.CommandBoardSaveData{Project: w.project, BoardId: bad, Data: "{}"}); err == nil {
			t.Errorf("save accepted board id %q", bad)
		}
		if _, err := w.ws.BoardAnswerInboxCommand(w.ctx, w.ref(bad)); err == nil {
			t.Errorf("inbox accepted board id %q", bad)
		}
		if err := w.ws.BoardAnswerAckCommand(w.ctx, wshrpc.CommandBoardAnswerAckData{Project: w.project, BoardId: bad, TurnId: "t", AnswerId: uuid.NewString()}); err == nil {
			t.Errorf("ack accepted board id %q", bad)
		}
		if err := w.ask(bad, "q"); err == nil {
			t.Errorf("ask accepted board id %q", bad)
		}
	}
	info := w.makeBoard("Auth flow")
	if _, err := w.ws.BoardReadCommand(w.ctx, wshrpc.CommandBoardRefData{BoardId: info.ID}); err == nil {
		t.Error("read accepted no project")
	}
	if _, err := w.ws.BoardTalkCommand(w.ctx, wshrpc.CommandBoardRefData{Project: "  ", BoardId: info.ID}); err == nil {
		t.Error("talk accepted a blank project")
	}
	if err := w.ask(info.ID, "  "); err == nil {
		t.Error("ask accepted a blank question")
	}
}

// the person's ask runs in the project's folder, lists the board as answering while it runs, is refused while it does,
// and ends answered once the frontend lands the drawing
func TestBoardAskDrawsAndListsAnswering(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	release := make(chan struct{})
	w.model.reply = func(boarddrawer.Call) (string, error) {
		<-release
		return boardDrawing, nil
	}

	if err := w.ask(info.ID, "draw the login"); err != nil {
		t.Fatal(err)
	}
	list, err := w.ws.BoardListCommand(w.ctx, wshrpc.CommandBoardListData{Project: w.project})
	if err != nil || list.Boards[0].State != "answering" {
		t.Fatalf("a board the drawer is busy on lists %+v %v, want answering", list.Boards, err)
	}
	// the all-projects list reads it the same
	all, err := w.ws.BoardListCommand(w.ctx, wshrpc.CommandBoardListData{})
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range all.Boards {
		if b.ID == info.ID && b.State != "answering" {
			t.Errorf("the all-projects list reads the busy board as %q", b.State)
		}
	}
	if err := w.ask(info.ID, "and the logout"); err == nil || !strings.Contains(err.Error(), boarddrawer.BusyReason) {
		t.Errorf("a second ask while the drawer answers: %v, want the busy refusal", err)
	}
	close(release)

	w.land("")
	turn := w.waitTurn(info.ID, w.lastTurn(info.ID).ID, boarddrawer.StateAnswered)
	if turn.Kind != boarddrawer.KindAsk || turn.Added != 1 || len(turn.ShapeIds) != 1 {
		t.Errorf("turn: %+v", turn)
	}
	if got := w.model.cwds; len(got) != 1 || got[0] != w.path {
		t.Errorf("the drawer ran in %v, want the project folder %q", got, w.path)
	}
	waitFor(t, func() bool { return !boardDrawer.Busy(boarddrawer.Board{Project: w.project, BoardId: info.ID}) }, "the board to be free")
	if list, _ = w.ws.BoardListCommand(w.ctx, wshrpc.CommandBoardListData{Project: w.project}); list.Boards[0].State != "" || list.Boards[0].DrawnTs == 0 {
		t.Errorf("a drawn board lists %+v", list.Boards[0])
	}
}

const (
	// a board with one drawing: the frame f1, "Login", around the rectangle s0
	loginDrawingElements = `[{"id":"s0","type":"rectangle","x":0,"y":0,"width":10,"height":10,"frameId":"f1"},` +
		`{"id":"f1","type":"frame","x":-10,"y":-10,"width":30,"height":30,"name":"Login"}]`
	// an edit of that drawing
	boardEdit = `{"title":"Login, simpler","edit":true,"update":[{"id":"s0","label":"login"}]}`
	// the line the turn prompt names the drawing in view with
	loginInView = `The drawing in view: "Login" (id f1)`
)

// putLoginDrawing saves a board file holding the Login drawing, as the canvas would have saved it.
func (w *boardWorld) putLoginDrawing(info wshrpc.BoardInfo) {
	w.t.Helper()
	read, err := w.ws.BoardReadCommand(w.ctx, w.ref(info.ID))
	if err != nil {
		w.t.Fatal(err)
	}
	data := strings.Replace(read.Data, `"elements":[]`, `"elements":`+loginDrawingElements, 1)
	if saved, err := w.ws.BoardSaveCommand(w.ctx, wshrpc.CommandBoardSaveData{Project: w.project, BoardId: info.ID, Data: data, BaseRev: read.Rev}); err != nil || saved.Conflict {
		w.t.Fatalf("save: %+v %v", saved, err)
	}
}

// the drawing in view comes with the ask: the turn keeps it, the drawer's prompt names it, and an edit lands with it
func TestBoardAskKeepsTheDrawingInView(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	w.putLoginDrawing(info)
	w.model.reply = func(boarddrawer.Call) (string, error) { return boardEdit, nil }

	err := w.ws.BoardAskCommand(w.ctx, wshrpc.CommandBoardAskData{Project: w.project, BoardId: info.ID, Question: "simpler", DrawingId: "f1"})
	if err != nil {
		t.Fatal(err)
	}
	if turn := w.lastTurn(info.ID); turn.DrawingId != "f1" {
		t.Errorf("the turn lost the drawing in view: %+v", turn)
	}
	answer := w.land("")
	if answer.DrawingId != "f1" || answer.Title != "Login, simpler" || answer.Update == "" {
		t.Errorf("the edit is delivered with its frame and title: %+v", answer)
	}
	w.waitTurn(info.ID, answer.TurnId, boarddrawer.StateAnswered)
	if prompts := w.model.prompts(); len(prompts) != 1 || !strings.Contains(prompts[0], loginInView) {
		t.Errorf("the drawer's prompt must name the drawing in view: %q", prompts)
	}
	waitFor(t, func() bool { return !boardDrawer.Busy(boarddrawer.Board{Project: w.project, BoardId: info.ID}) }, "the board to be free")

	// a new drawing, with the same one in view, is delivered with its title and no frame to join
	w.model.reply = nil
	if err := w.ws.BoardAskCommand(w.ctx, wshrpc.CommandBoardAskData{Project: w.project, BoardId: info.ID, Question: "and logout", DrawingId: "f1"}); err != nil {
		t.Fatal(err)
	}
	if fresh := w.land(""); fresh.DrawingId != "" || fresh.Title != "Auth flow" {
		t.Errorf("a new drawing is delivered with its title and no frame: %+v", fresh)
	}
}

func TestBoardAskRefusedOnAnEndedAgent(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	w.facts.Tabs = nil // the agent's tab is gone from the roster

	err := w.ask(info.ID, "draw the login")
	if err == nil || err.Error() != "the agent ended, so you can't ask here" {
		t.Fatalf("ask on an ended agent: %v", err)
	}
	if turns := w.talk(info.ID).Turns; len(turns) != 0 || len(w.model.prompts()) != 0 {
		t.Errorf("a refused ask left turns %+v and %d model runs", turns, len(w.model.prompts()))
	}
}

// the ack of a drawing the frontend could not land fails the turn and frees the board: it is the only thing that ends
// a drawing's turn, so a board whose file is gone must fail it as well
func TestBoardAckWithErrorFailsTheTurn(t *testing.T) {
	for _, tc := range []struct {
		name    string
		prepare func(t *testing.T, info wshrpc.BoardInfo)
	}{
		{"the board is there", func(*testing.T, wshrpc.BoardInfo) {}},
		{"the board's file is gone", func(t *testing.T, info wshrpc.BoardInfo) {
			if err := os.Remove(info.Path); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := newBoardWorld(t)
			info := w.makeBoard("Auth flow")
			if err := w.ask(info.ID, "draw the login"); err != nil {
				t.Fatal(err)
			}
			answer := w.waitAnswer()
			tc.prepare(t, info)
			w.ack(answer, "Excalidraw would not load the shapes")

			turn := w.waitTurn(info.ID, answer.TurnId, boarddrawer.StateFailed)
			if !strings.Contains(turn.Reason, "Excalidraw would not load the shapes") || turn.Added != 0 || len(turn.ShapeIds) != 0 {
				t.Errorf("a landing that failed leaves %+v, want it failed with the error and no drawing", turn)
			}
			waitFor(t, func() bool { return !boardDrawer.Busy(boarddrawer.Board{Project: w.project, BoardId: info.ID}) }, "the board to be free")
			if answers, err := w.ws.BoardAnswerInboxCommand(w.ctx, w.ref(info.ID)); err != nil || len(answers) != 0 {
				t.Errorf("the failed answer stays in the inbox: %+v %v", answers, err)
			}
			// the ack twice changes nothing
			w.ack(answer, "Excalidraw would not load the shapes")
		})
	}
}

// a turn left answering when wavesrv restarted fails when its talk is read, and its drawing, still in the inbox, lands
// anyway when the frontend applies it after a reload
func TestBoardTalkFailsTurnsARestartLeft(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	if err := w.ask(info.ID, "draw the login"); err != nil {
		t.Fatal(err)
	}
	answer := w.waitAnswer()

	// a restart: the drawer's memory is gone, the files stay
	boardDrawer = newBoardDrawer()
	talk, err := w.ws.BoardTalkCommand(w.ctx, w.ref(info.ID))
	if err != nil || len(talk.Turns) != 1 || talk.Turns[0].State != boarddrawer.StateFailed || talk.Turns[0].Reason != boarddrawer.RestartedReason {
		t.Fatalf("talk after a restart: %+v %v", talk, err)
	}
	w.ack(answer, "")
	if turn := w.lastTurn(info.ID); turn.State != boarddrawer.StateAnswered {
		t.Errorf("the drawing landed after the restart, so the turn is %q, want answered", turn.State)
	}
}

func TestBoardStopAndRetry(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	started := make(chan struct{})
	// a run that ends only when the drawer's Stop cancels it
	boarddrawer.RunModel = func(ctx context.Context, cwd string, c boarddrawer.Call) (boarddrawer.Reply, error) {
		close(started)
		<-ctx.Done()
		return boarddrawer.Reply{}, ctx.Err()
	}
	if err := w.ask(info.ID, "draw the login"); err != nil {
		t.Fatal(err)
	}
	<-started
	turnId := w.lastTurn(info.ID).ID
	if err := w.ws.BoardAskStopCommand(w.ctx, w.ref(info.ID)); err != nil {
		t.Fatal(err)
	}
	w.waitTurn(info.ID, turnId, boarddrawer.StateStopped)
	waitFor(t, func() bool { return !boardDrawer.Busy(boarddrawer.Board{Project: w.project, BoardId: info.ID}) }, "the board to be free")

	// retried, it runs again, in the project's folder
	boarddrawer.RunModel = w.model.run
	if err := w.ws.BoardAskRetryCommand(w.ctx, w.turnRef(info.ID, turnId)); err != nil {
		t.Fatal(err)
	}
	w.land("")
	if turn := w.waitTurn(info.ID, turnId, boarddrawer.StateAnswered); turn.Added != 1 {
		t.Errorf("retried turn: %+v", turn)
	}
	if got := w.model.cwds; len(got) != 1 || got[0] != w.path {
		t.Errorf("the retry ran in %v, want %q", got, w.path)
	}
}

// send the other way: a drawn turn goes to the agent as a new turn naming it, a forwarded one is drawn as a new turn
// the drawer may not flag back, and the original turn stays as it was
func TestBoardRerouteBothWays(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")

	// a drawn ask goes to the agent
	if err := w.ask(info.ID, "why two stores?"); err != nil {
		t.Fatal(err)
	}
	w.land("")
	drawn := w.waitTurn(info.ID, w.lastTurn(info.ID).ID, boarddrawer.StateAnswered)
	waitFor(t, func() bool { return !boardDrawer.Busy(boarddrawer.Board{Project: w.project, BoardId: info.ID}) }, "the board to be free")
	if err := w.ws.BoardRerouteCommand(w.ctx, w.turnRef(info.ID, drawn.ID)); err != nil {
		t.Fatal(err)
	}
	boardForwards.work.Wait()
	sent := w.lastTurn(info.ID)
	if sent.ID == drawn.ID || sent.From != drawn.ID || sent.Kind != boarddrawer.KindAsk || sent.State != boarddrawer.StateForwarded ||
		sent.Question != "why two stores?" || sent.Forward == nil || sent.Forward.State != boarddrawer.ForwardSent {
		t.Fatalf("the turn sent to the agent: %+v", sent)
	}
	if len(*w.typed) != 1 || (*w.typed)[0].blockId != w.block || !strings.HasPrefix((*w.typed)[0].text, `[From board "Auth flow"`) {
		t.Errorf("typed into the agent: %+v", *w.typed)
	}
	if again := w.talk(info.ID).Turns[0]; again.State != boarddrawer.StateAnswered || again.Forward != nil || again.Added != 1 {
		t.Errorf("the original drawn turn changed: %+v", again)
	}
	if len(w.model.prompts()) != 1 {
		t.Errorf("sending a drawn turn to the agent ran the drawer: %d runs", len(w.model.prompts()))
	}

	// a forwarded ask is drawn instead
	w.model.reply = func(boarddrawer.Call) (string, error) { return boardQuestion, nil }
	if err := w.ask(info.ID, "why two stores?"); err != nil {
		t.Fatal(err)
	}
	forwarded := w.waitTurn(info.ID, w.lastTurn(info.ID).ID, boarddrawer.StateForwarded)
	boardForwards.work.Wait()
	waitFor(t, func() bool { return !boardDrawer.Busy(boarddrawer.Board{Project: w.project, BoardId: info.ID}) }, "the board to be free")
	w.model.reply = nil
	if err := w.ws.BoardRerouteCommand(w.ctx, w.turnRef(info.ID, forwarded.ID)); err != nil {
		t.Fatal(err)
	}
	w.land("")
	redone := w.lastTurn(info.ID)
	if redone.ID == forwarded.ID || redone.From != forwarded.ID || redone.Kind != boarddrawer.KindAsk {
		t.Fatalf("the turn drawn instead: %+v", redone)
	}
	if turn := w.waitTurn(info.ID, redone.ID, boarddrawer.StateAnswered); turn.Added != 1 {
		t.Errorf("drawn instead: %+v", turn)
	}
	// the drawer was told it may not flag this line back
	if last := w.model.prompts(); !strings.Contains(last[len(last)-1], "Never flag it") {
		t.Errorf("the line sent to be drawn reached the drawer as a line it may flag: %q", last[len(last)-1])
	}
	for _, turn := range w.talk(info.ID).Turns {
		if turn.ID == forwarded.ID && (turn.State != boarddrawer.StateForwarded || turn.Forward == nil) {
			t.Errorf("the original forwarded turn changed: %+v", turn)
		}
	}
}

// both ways of sending a line the other way keep the drawing it was asked in
func TestBoardRerouteKeepsTheDrawingInView(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	w.putLoginDrawing(info)
	seed := func(turn wshrpc.BoardTurn) {
		t.Helper()
		_, err := boardstore.UpdateTalk(w.dir(), info.ID, func(talk *wshrpc.BoardTalk) error {
			talk.Turns = append(talk.Turns, turn)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	// a drawn turn goes to the agent: the turn sent keeps the drawing
	seed(wshrpc.BoardTurn{ID: "drawn", Kind: boarddrawer.KindAsk, Question: "why two stores?", DrawingId: "f1", State: boarddrawer.StateAnswered, Added: 1})
	if err := w.ws.BoardRerouteCommand(w.ctx, w.turnRef(info.ID, "drawn")); err != nil {
		t.Fatal(err)
	}
	boardForwards.work.Wait()
	if sent := w.lastTurn(info.ID); sent.From != "drawn" || sent.State != boarddrawer.StateForwarded || sent.DrawingId != "f1" {
		t.Errorf("the turn sent to the agent: %+v", sent)
	}

	// a forwarded turn is drawn instead: the new turn is asked in the drawing, and the drawer is told so
	seed(wshrpc.BoardTurn{ID: "fwd", Kind: boarddrawer.KindAsk, Question: "show the cache", DrawingId: "f1", State: boarddrawer.StateForwarded,
		Forward: &wshrpc.BoardForward{State: boarddrawer.ForwardSent}})
	if err := w.ws.BoardRerouteCommand(w.ctx, w.turnRef(info.ID, "fwd")); err != nil {
		t.Fatal(err)
	}
	redone := w.lastTurn(info.ID)
	if redone.From != "fwd" || redone.DrawingId != "f1" {
		t.Errorf("the turn drawn instead: %+v", redone)
	}
	w.land("")
	w.waitTurn(info.ID, redone.ID, boarddrawer.StateAnswered)
	if prompts := w.model.prompts(); len(prompts) != 1 || !strings.Contains(prompts[0], loginInView) {
		t.Errorf("the drawer must be told the drawing in view: %q", prompts)
	}
}

func TestBoardRerouteRefusals(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	seed := func(turn wshrpc.BoardTurn) {
		t.Helper()
		_, err := boardstore.UpdateTalk(w.dir(), info.ID, func(talk *wshrpc.BoardTalk) error {
			talk.Turns = append(talk.Turns, turn)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	seed(wshrpc.BoardTurn{ID: "req", Kind: boarddrawer.KindRequest, Question: "draw", State: boarddrawer.StateAnswered})
	seed(wshrpc.BoardTurn{ID: "bad", Kind: boarddrawer.KindAsk, Question: "q", State: boarddrawer.StateFailed})
	for id, want := range map[string]string{"req": "an agent's own request", "bad": "failed", "nope": "no such turn"} {
		if err := w.ws.BoardRerouteCommand(w.ctx, w.turnRef(info.ID, id)); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("reroute of %s: %v, want it to say %q", id, err, want)
		}
	}
	if len(*w.typed) != 0 || len(w.model.prompts()) != 0 {
		t.Error("a refused reroute reached the agent or the drawer")
	}
}
