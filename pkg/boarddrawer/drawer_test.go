// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	drawAnswer  = `{"title":"wavesrv, opened up","add":[{"type":"rectangle","id":"a","x":0,"y":300,"width":10,"height":10},{"type":"text","id":"b","x":0,"y":340,"text":"x"}]}`
	wordsAnswer = `{"reply":"Nothing to draw."}`
	emptyBoard  = `{"type":"excalidraw","elements":[]}`
)

var board = Board{Project: "waveterm", BoardId: "b1", Name: "Board talk", ProjectPath: "/repo"}

// fake is the store, the board files, the agent's transcript and the model behind a Drawer under test.
type fake struct {
	mu         sync.Mutex
	talks      map[string]wshrpc.BoardTalk
	files      map[string]string
	delivered  []wshrpc.BoardAnswer
	pubs       []wshrpc.BoardUpdateData
	calls      []Call
	reads      []int64 // the since of each agent read
	readAgents []wshrpc.BoardAgent
	// agent is what ReadAgent reads; nil: the agent's turn text, with no cursor and no session
	agent          func(a wshrpc.BoardAgent, sinceTs int64) (text, sessionId string, cursorTs int64, err error)
	forwarded      []string
	forwardedState []string // each forwarded turn's saved state when Forward was called
	active         int
	maxActive      int
	ids            int
	ctxTokens      int // the context size every run reports
	ack            func(a wshrpc.BoardAnswer)
	run            func(ctx context.Context, c Call) (string, error)
}

func newFake(run func(ctx context.Context, c Call) (string, error)) *fake {
	return &fake{
		talks: map[string]wshrpc.BoardTalk{},
		files: map[string]string{"b1": sceneFile, "b0": emptyBoard},
		run:   run,
	}
}

func cloneTalk(t wshrpc.BoardTalk) wshrpc.BoardTalk {
	t.Turns = slices.Clone(t.Turns)
	if t.Agent != nil {
		a := *t.Agent
		t.Agent = &a
	}
	return t
}

func (f *fake) deps() Deps {
	return Deps{
		LoadTalk: func(b Board) (wshrpc.BoardTalk, error) {
			f.mu.Lock()
			defer f.mu.Unlock()
			return cloneTalk(f.talks[b.BoardId]), nil
		},
		UpdateTalk: func(b Board, fn func(*wshrpc.BoardTalk) error) (wshrpc.BoardTalk, error) {
			f.mu.Lock()
			defer f.mu.Unlock()
			talk := cloneTalk(f.talks[b.BoardId])
			if err := fn(&talk); err != nil {
				return wshrpc.BoardTalk{}, err
			}
			f.talks[b.BoardId] = talk
			return cloneTalk(talk), nil
		},
		ReadBoard: func(b Board) ([]byte, error) {
			f.mu.Lock()
			defer f.mu.Unlock()
			file, ok := f.files[b.BoardId]
			if !ok {
				return nil, errors.New("no such file")
			}
			return []byte(file), nil
		},
		ReadAgent: func(ctx context.Context, a wshrpc.BoardAgent, sinceTs int64) (string, string, int64, error) {
			f.mu.Lock()
			f.reads = append(f.reads, sinceTs)
			f.readAgents = append(f.readAgents, a)
			read := f.agent
			f.mu.Unlock()
			if read == nil {
				return "the agent's turn text", "", 0, nil
			}
			return read(a, sinceTs)
		},
		Deliver: func(a wshrpc.BoardAnswer) error {
			f.mu.Lock()
			f.delivered = append(f.delivered, a)
			ack := f.ack
			f.mu.Unlock()
			if ack != nil {
				go ack(a)
			}
			return nil
		},
		Publish: func(u wshrpc.BoardUpdateData) {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.pubs = append(f.pubs, u)
		},
		Run: func(ctx context.Context, cwd string, c Call) (Reply, error) {
			f.mu.Lock()
			f.calls = append(f.calls, c)
			f.active++
			f.maxActive = max(f.maxActive, f.active)
			f.mu.Unlock()
			defer func() {
				f.mu.Lock()
				f.active--
				f.mu.Unlock()
			}()
			if cwd != board.ProjectPath {
				return Reply{}, fmt.Errorf("cwd %q", cwd)
			}
			text, err := f.run(ctx, c)
			f.mu.Lock()
			defer f.mu.Unlock()
			return Reply{Text: text, ContextTokens: f.ctxTokens}, err
		},
		Forward: func(b Board, turnId string) {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.forwarded = append(f.forwarded, turnId)
			talk := f.talks[b.BoardId]
			if t := findTurn(&talk, turnId); t != nil {
				f.forwardedState = append(f.forwardedState, t.State)
			}
		},
		Now: func() int64 { return 1000 },
		NewId: func() string {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.ids++
			return fmt.Sprintf("id-%d", f.ids)
		},
	}
}

// landsAnswers makes the fake frontend: every delivered answer is applied at once and acked with two shape ids.
func (f *fake) landsAnswers(d *Drawer, b Board) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ack = func(a wshrpc.BoardAnswer) { _ = d.Answered(b, a.TurnId, []string{"n1", "n2"}) }
}

func (f *fake) talk(boardId string) wshrpc.BoardTalk {
	f.mu.Lock()
	defer f.mu.Unlock()
	return cloneTalk(f.talks[boardId])
}

func (f *fake) callList() []Call {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.calls)
}

func (f *fake) forwardedList() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.forwarded)
}

func (f *fake) deliveredCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.delivered)
}

func (f *fake) published() []wshrpc.BoardUpdateData {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.pubs)
}

func (f *fake) hasPublished(what, turnId string) bool {
	return slices.ContainsFunc(f.published(), func(u wshrpc.BoardUpdateData) bool { return u.What == what && u.TurnId == turnId })
}

func reply(s string) func(context.Context, Call) (string, error) {
	return func(context.Context, Call) (string, error) { return s, nil }
}

// gated blocks every run until release is closed, or its ctx ends.
func gated(release <-chan struct{}, s string) func(context.Context, Call) (string, error) {
	return func(ctx context.Context, c Call) (string, error) {
		select {
		case <-release:
			return s, nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// settled waits until the drawer is idle on board and returns the talk.
func settled(t *testing.T, f *fake, d *Drawer) wshrpc.BoardTalk {
	t.Helper()
	waitFor(t, "the drawer to finish", func() bool { return !d.Busy(board) })
	return f.talk(board.BoardId)
}

// land is the frontend's side of a drawing turn: once the answer is published, it applies it and acks it.
func land(t *testing.T, f *fake, d *Drawer, b Board, turnId string, shapeIds ...string) {
	t.Helper()
	waitFor(t, "the answer of "+turnId+" to be published", func() bool { return f.hasPublished(UpdateAnswer, turnId) })
	if err := d.Answered(b, turnId, shapeIds); err != nil {
		t.Fatal(err)
	}
}

func asks(q string) wshrpc.BoardTurn { return wshrpc.BoardTurn{Kind: KindAsk, Question: q} }

func requests(q, briefing string) wshrpc.BoardTurn {
	return wshrpc.BoardTurn{Kind: KindRequest, Question: q, Context: briefing}
}

func TestAskFirstTurnThenResume(t *testing.T) {
	f := newFake(reply(drawAnswer))
	d := New(f.deps())
	const briefing = "The store keeps talks in sidecars."
	turn, err := d.Ask(board, requests("Draw the store.", briefing))
	if err != nil || turn.ID == "" || turn.Ts != 1000 || turn.StartedTs != 1000 || turn.State != StateAnswering || turn.Kind != KindRequest {
		t.Fatalf("ask: %+v %v", turn, err)
	}
	land(t, f, d, board, turn.ID, "n1", "n2")
	talk := settled(t, f, d)
	got := talk.Turns[0]
	if got.State != StateAnswered || got.Title != "wavesrv, opened up" || got.Added != 2 || got.Changed != 0 || got.Removed != 0 ||
		got.AnsweredTs != 1000 || got.Forward != nil || !slices.Equal(got.ShapeIds, []string{"n1", "n2"}) {
		t.Errorf("first turn: %+v", got)
	}
	calls := f.callList()
	if len(calls) != 1 || calls[0].Resume || calls[0].SessionId == "" || calls[0].SessionId != talk.SessionId {
		t.Fatalf("first call: %+v, session %q", calls, talk.SessionId)
	}
	for _, want := range []string{"## Your reply", "Draw the store.", "The board now"} {
		if !strings.Contains(calls[0].Prompt, want) {
			t.Errorf("first prompt lacks %q", want)
		}
	}
	if strings.Count(calls[0].Prompt, briefing) != 1 {
		t.Errorf("the briefing must be in the first prompt once:\n%s", calls[0].Prompt)
	}
	if len(f.reads) != 0 {
		t.Errorf("a board with no agent reads no transcript: %v", f.reads)
	}
	if len(f.delivered) != 1 || f.delivered[0].TurnId != turn.ID || f.delivered[0].Project != "waveterm" || f.delivered[0].BoardId != "b1" ||
		f.delivered[0].Add == "" || f.delivered[0].Title != "wavesrv, opened up" || f.delivered[0].DrawingId != "" || f.delivered[0].Ts != 1000 {
		t.Errorf("delivered: %+v", f.delivered)
	}

	second, err := d.Ask(board, wshrpc.BoardTurn{Kind: KindAsk, Question: "And the store?", On: "wavesrv", SelectedIds: []string{"box"}})
	if err != nil {
		t.Fatal(err)
	}
	land(t, f, d, board, second.ID)
	talk = settled(t, f, d)
	calls = f.callList()
	if len(calls) != 2 || !calls[1].Resume || calls[1].SessionId != calls[0].SessionId {
		t.Fatalf("follow-up call: %+v", calls)
	}
	if strings.Contains(calls[1].Prompt, "## Your reply") || strings.Contains(calls[1].Prompt, briefing) ||
		!strings.Contains(calls[1].Prompt, "And the store?") || !strings.Contains(calls[1].Prompt, `"selected":true`) {
		t.Errorf("follow-up prompt must be the turn alone, with the selection:\n%s", calls[1].Prompt)
	}
	if talk.Turns[1].State != StateAnswered || talk.SessionId != calls[0].SessionId {
		t.Errorf("second turn: %+v", talk)
	}
	var whats []string
	for _, u := range f.published() {
		whats = append(whats, u.What+":"+u.State)
	}
	want := []string{"talk:answering", "answer:", "talk:answered", "talk:answering", "answer:", "talk:answered"}
	if !slices.Equal(whats, want) {
		t.Errorf("published %v, want %v", whats, want)
	}
	for _, u := range f.published() {
		if u.Project != "waveterm" || u.BoardId != "b1" {
			t.Errorf("update %+v must name the board", u)
		}
	}
	if got := f.forwardedList(); len(got) != 0 {
		t.Errorf("a drawn turn reaches no agent, forwarded %v", got)
	}
}

func TestAskRejectsUnknownKind(t *testing.T) {
	f := newFake(reply(drawAnswer))
	d := New(f.deps())
	for _, kind := range []string{"", "words", "choice"} {
		if _, err := d.Ask(board, wshrpc.BoardTurn{Kind: kind, Question: "q"}); err == nil {
			t.Errorf("kind %q must be refused", kind)
		}
	}
	if n := len(f.talk("b1").Turns); n != 0 || len(f.callList()) != 0 {
		t.Errorf("a refused ask must add no turn and run nothing, got %d turns", n)
	}
}

// the drawer, not the caller, says how a turn begins
func TestAskStartsTheTurnFresh(t *testing.T) {
	f := newFake(reply(drawAnswer))
	d := New(f.deps())
	turn, err := d.Ask(board, wshrpc.BoardTurn{
		Kind: KindAsk, Question: "q", ID: "mine", Ts: 5, State: StateFailed, Reason: "old", Title: "old", Added: 9,
		ShapeIds: []string{"x"}, Forward: &wshrpc.BoardForward{State: ForwardSent}, AnsweredTs: 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	if turn.ID == "mine" || turn.Ts != 1000 || turn.State != StateAnswering || turn.Reason != "" || turn.Title != "" || turn.Added != 0 ||
		turn.ShapeIds != nil || turn.Forward != nil || turn.AnsweredTs != 0 {
		t.Errorf("turn: %+v", turn)
	}
	land(t, f, d, board, turn.ID)
	settled(t, f, d)
}

func TestAskUnusableAnswerFails(t *testing.T) {
	f := newFake(reply(`{"title":"t","update":[{"id":"nope","x":1}]}`))
	d := New(f.deps())
	if _, err := d.Ask(board, asks("q")); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateFailed || !strings.HasPrefix(talk.Turns[0].Reason, unusableHead) {
		t.Errorf("turn: %+v", talk.Turns[0])
	}
	if f.deliveredCount() != 0 {
		t.Errorf("an unusable answer delivers nothing")
	}
	f.mu.Lock()
	f.files["b1"] = `{"elements":[`
	f.run = reply(drawAnswer)
	f.mu.Unlock()
	if err := d.Retry(board, talk.Turns[0].ID); err != nil {
		t.Fatal(err)
	}
	talk = settled(t, f, d)
	if !strings.HasPrefix(talk.Turns[0].Reason, wontOpenHead) {
		t.Errorf("a board file that won't open fails the turn: %+v", talk.Turns[0])
	}
}

func TestAskBrokenFileFirstTurnKeepsNoSession(t *testing.T) {
	f := newFake(reply(drawAnswer))
	f.files["b1"] = `{"elements":[`
	d := New(f.deps())
	if _, err := d.Ask(board, asks("q")); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateFailed || !strings.HasPrefix(talk.Turns[0].Reason, wontOpenHead) {
		t.Errorf("turn: %+v", talk.Turns[0])
	}
	if talk.SessionId != "" {
		t.Errorf("a first turn that never ran must leave no session, got %q", talk.SessionId)
	}
	f.mu.Lock()
	f.files["b1"] = sceneFile
	f.mu.Unlock()
	f.landsAnswers(d, board)
	if err := d.Retry(board, talk.Turns[0].ID); err != nil {
		t.Fatal(err)
	}
	settled(t, f, d)
	calls := f.callList()
	if len(calls) != 1 || calls[0].Resume || !strings.Contains(calls[0].Prompt, "## Your reply") {
		t.Errorf("once the file opens, Retry starts the session with the first prompt: %+v", calls)
	}
}

func TestAskResumeFailureFailsTurn(t *testing.T) {
	f := newFake(nil)
	f.run = func(ctx context.Context, c Call) (string, error) {
		if c.Resume {
			return "", errors.New("the drawer's session exited before it replied (API Error: 529 overloaded)")
		}
		return drawAnswer, nil
	}
	d := New(f.deps())
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, asks("first")); err != nil {
		t.Fatal(err)
	}
	session := settled(t, f, d).SessionId
	if _, err := d.Ask(board, asks("second")); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[1].State != StateFailed || !strings.Contains(talk.Turns[1].Reason, "529 overloaded") {
		t.Errorf("turn: %+v", talk.Turns[1])
	}
	if n := len(f.callList()); n != 2 {
		t.Errorf("a failed resume is never retried silently, %d calls", n)
	}
	if talk.SessionId != session {
		t.Errorf("a failed resume must keep the session, got %q want %q", talk.SessionId, session)
	}
}

// claude cleans up old session transcripts, and a session it no longer has can never be resumed
func TestAskLostSessionStartsNew(t *testing.T) {
	f := newFake(nil)
	lost := ""
	f.run = func(ctx context.Context, c Call) (string, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if c.Resume && c.SessionId == lost {
			return "", errors.New("the drawer's session exited before it replied (No conversation found with session ID: " + lost + ")")
		}
		return drawAnswer, nil
	}
	d := New(f.deps())
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, requests("Draw the store.", "facts")); err != nil {
		t.Fatal(err)
	}
	// the drawer is idle once settled, so the next run reads lost after this write
	first := settled(t, f, d).SessionId
	f.mu.Lock()
	lost = first
	f.mu.Unlock()
	if _, err := d.Ask(board, asks("second")); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[1].State != StateAnswered || talk.Turns[1].Title != "wavesrv, opened up" {
		t.Errorf("the turn must be answered by a new session: %+v", talk.Turns[1])
	}
	calls := f.callList()
	if len(calls) != 3 || !calls[1].Resume || calls[2].Resume || calls[2].SessionId == lost || calls[2].SessionId == "" {
		t.Fatalf("want a first call, the failed resume, then a new session: %+v", calls)
	}
	if talk.SessionId != calls[2].SessionId {
		t.Errorf("the talk must keep the new session, got %q want %q", talk.SessionId, calls[2].SessionId)
	}
	// the new session starts from the first prompt, with the board's briefing from its first request
	for _, want := range []string{"## Your reply", "facts", "second"} {
		if !strings.Contains(calls[2].Prompt, want) {
			t.Errorf("the new session's prompt lacks %q:\n%s", want, calls[2].Prompt)
		}
	}
	if f.deliveredCount() != 2 {
		t.Errorf("delivered %d answers, want 2", f.deliveredCount())
	}
}

func TestAskRecordsContextTokens(t *testing.T) {
	f := newFake(reply(wordsAnswer))
	f.ctxTokens = 12_345
	d := New(f.deps())
	if _, err := d.Ask(board, asks("first")); err != nil {
		t.Fatal(err)
	}
	if talk := settled(t, f, d); talk.ContextTokens != 12_345 {
		t.Errorf("context tokens %d, want 12345", talk.ContextTokens)
	}
}

// a person's line sent to be drawn (a forwarded question drawn instead) is drawn or fails, never flagged
func TestAskSentToBeDrawnNeverForwards(t *testing.T) {
	for name, answer := range map[string]string{"a question flag": `{"question":true}`, "words alone": wordsAnswer} {
		t.Run(name, func(t *testing.T) {
			f := newFake(reply(answer))
			d := New(f.deps())
			turn, err := d.Ask(board, wshrpc.BoardTurn{Kind: KindAsk, Question: "Why twice?", From: "t0"})
			if err != nil {
				t.Fatal(err)
			}
			got := settled(t, f, d).Turns[0]
			if got.State != StateFailed || !strings.Contains(got.Reason, "could not draw the line you sent to be drawn") {
				t.Errorf("turn: %+v", got)
			}
			if f.deliveredCount() != 0 || len(f.forwardedList()) != 0 {
				t.Errorf("a failed turn delivers and forwards nothing: delivered %d, forwarded %v", f.deliveredCount(), f.forwardedList())
			}
			if p := f.callList()[0].Prompt; !strings.Contains(p, "The person sent this line to be drawn") {
				t.Errorf("the prompt must say the line is to be drawn:\n%s", p)
			}
			f.mu.Lock()
			f.run = reply(drawAnswer)
			f.mu.Unlock()
			f.landsAnswers(d, board)
			if err := d.Retry(board, turn.ID); err != nil {
				t.Fatal(err)
			}
			if got := settled(t, f, d).Turns[0]; got.State != StateAnswered || got.Kind != KindAsk || got.From != "t0" || got.Reason != "" {
				t.Errorf("retried with a drawing: %+v", got)
			}
		})
	}
}

func TestBusyRefusesAsk(t *testing.T) {
	release := make(chan struct{})
	f := newFake(gated(release, drawAnswer))
	d := New(f.deps())
	if d.Busy(board) {
		t.Fatalf("an idle board is not busy")
	}
	first, err := d.Ask(board, asks("first"))
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the first run", func() bool { return len(f.callList()) == 1 })
	if !d.Busy(board) {
		t.Errorf("a board with a turn running is busy")
	}
	if _, err := d.Ask(board, asks("second")); err == nil || err.Error() != BusyReason {
		t.Fatalf("want %q, got %v", BusyReason, err)
	}
	if n := len(f.talk("b1").Turns); n != 1 {
		t.Errorf("a refused ask must add no turn, got %d turns", n)
	}
	other := Board{Project: "waveterm", BoardId: "b0", Name: "Other", ProjectPath: "/repo"}
	f.landsAnswers(d, other) // b0's only turn lands at once; b1's waits
	if _, err := d.Ask(other, asks("elsewhere")); err != nil {
		t.Errorf("another board must not be busy: %v", err)
	}
	// the same board name in another project is another board
	elsewhere := Board{Project: "other-project", BoardId: "b1", Name: "Board talk", ProjectPath: "/repo"}
	if d.Busy(elsewhere) {
		t.Errorf("a board of another project must not be busy")
	}

	// the drawing is delivered, and the board stays busy until it lands: the next turn needs the scene as it is then
	close(release)
	waitFor(t, "the answer", func() bool { return f.hasPublished(UpdateAnswer, first.ID) })
	if !d.Busy(board) {
		t.Errorf("a board whose answer has not landed is still busy")
	}
	if _, err := d.Ask(board, asks("third")); err == nil || err.Error() != BusyReason {
		t.Errorf("ask while the answer is landing: want %q, got %v", BusyReason, err)
	}
	if err := d.Answered(board, first.ID, []string{"n1"}); err != nil {
		t.Fatal(err)
	}
	settled(t, f, d)
	waitFor(t, "the other board", func() bool { return !d.Busy(other) })
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, asks("fourth")); err != nil {
		t.Errorf("a board whose answer landed takes the next ask: %v", err)
	}
	settled(t, f, d)
}

func TestRequestQueuesBehindTurn(t *testing.T) {
	release := make(chan struct{})
	f := newFake(gated(release, drawAnswer))
	d := New(f.deps())
	first, err := d.Ask(board, asks("first"))
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the first run", func() bool { return len(f.callList()) == 1 })
	queued, err := d.Ask(board, requests("Draw the store.", "facts"))
	if err != nil || queued.State != StateWaiting || queued.StartedTs != 0 {
		t.Fatalf("a request must queue, got %+v %v", queued, err)
	}
	if got := f.talk("b1").Turns[1]; got.State != StateWaiting || got.Kind != KindRequest {
		t.Errorf("queued turn saved as %+v", got)
	}
	close(release)
	// the first drawing is delivered but has not landed: the request waits for it, so it draws on the board as it is then
	waitFor(t, "the first answer", func() bool { return f.hasPublished(UpdateAnswer, first.ID) })
	time.Sleep(50 * time.Millisecond)
	if n := len(f.callList()); n != 1 {
		t.Errorf("the request must not start while the first answer is landing, %d calls", n)
	}
	if got := f.talk("b1").Turns[1].State; got != StateWaiting {
		t.Errorf("the request stays waiting while the first answer is landing, got %q", got)
	}
	if err := d.Answered(board, first.ID, []string{"n1"}); err != nil {
		t.Fatal(err)
	}
	land(t, f, d, board, queued.ID, "n2")
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateAnswered || talk.Turns[1].State != StateAnswered {
		t.Errorf("turns: %+v", talk.Turns)
	}
	if f.maxActive != 1 {
		t.Errorf("never two sessions on one board at once, saw %d", f.maxActive)
	}
	calls := f.callList()
	if len(calls) != 2 || !calls[1].Resume || !strings.Contains(calls[1].Prompt, "Draw the store.") ||
		!strings.Contains(calls[1].Prompt, "facts") || !strings.Contains(calls[1].Prompt, "This is the agent's own request") {
		t.Errorf("the request runs next, resumed, as a request: %+v", calls)
	}
	var states []string
	for _, u := range f.published() {
		if u.TurnId == queued.ID && u.What == UpdateTalk {
			states = append(states, u.State)
		}
	}
	if !slices.Equal(states, []string{StateWaiting, StateAnswering, StateAnswered}) {
		t.Errorf("request states published: %v", states)
	}
	if got := talk.Turns[1].StartedTs; got != 1000 {
		t.Errorf("a queued turn is started when it begins answering, got %d", got)
	}
}

// the agent's request must draw: a flag or nothing fails the turn, which stays retryable and never reaches the agent
func TestRequestNeverForwards(t *testing.T) {
	turns := map[string]wshrpc.BoardTurn{
		"a briefing":         requests("Draw the store.", "facts"),
		"a one-line request": requests("Draw the retry loop.", ""),
	}
	answers := map[string]string{"a question flag": `{"question":true}`, "words alone": wordsAnswer}
	for tname, in := range turns {
		for aname, answer := range answers {
			t.Run(tname+" answered with "+aname, func(t *testing.T) {
				f := newFake(reply(answer))
				d := New(f.deps())
				turn, err := d.Ask(board, in)
				if err != nil {
					t.Fatal(err)
				}
				got := settled(t, f, d).Turns[0]
				if got.State != StateFailed || !strings.Contains(got.Reason, "could not draw the agent's request") {
					t.Errorf("turn: %+v", got)
				}
				if f.deliveredCount() != 0 || len(f.forwardedList()) != 0 || got.Forward != nil {
					t.Errorf("a failed request delivers and forwards nothing: delivered %d, forwarded %v, forward %+v",
						f.deliveredCount(), f.forwardedList(), got.Forward)
				}
				f.mu.Lock()
				f.run = reply(drawAnswer)
				f.mu.Unlock()
				f.landsAnswers(d, board)
				if err := d.Retry(board, turn.ID); err != nil {
					t.Fatal(err)
				}
				if got := settled(t, f, d).Turns[0]; got.State != StateAnswered || got.Kind != KindRequest || got.Reason != "" || got.Context != in.Context {
					t.Errorf("retried with a drawing: %+v", got)
				}
			})
		}
	}
}

const editAnswer = `{"title":"Cache, simpler","edit":true,"add":[{"type":"text","id":"n","x":0,"y":60,"text":"hot"}],"update":[{"id":"cache","label":"c"}]}`

// an ask names the drawing in view: the turn keeps it, the prompt names it, and an edit answer is delivered with it
func TestAskEditsTheDrawingInView(t *testing.T) {
	f := newFake(reply(editAnswer))
	f.files["b1"] = framedSceneFile
	d := New(f.deps())
	f.landsAnswers(d, board)
	turn, err := d.Ask(board, wshrpc.BoardTurn{Kind: KindAsk, Question: "Simpler.", DrawingId: "f1"})
	if err != nil || turn.DrawingId != "f1" {
		t.Fatalf("ask: %+v %v", turn, err)
	}
	got := settled(t, f, d).Turns[0]
	if got.State != StateAnswered || got.DrawingId != "f1" || got.Title != "Cache, simpler" || got.Added != 1 || got.Changed != 1 {
		t.Errorf("turn: %+v", got)
	}
	if calls := f.callList(); len(calls) != 1 || !strings.Contains(calls[0].Prompt, drawingInViewHead+`"Cache path" (id f1)`) {
		t.Errorf("the prompt must name the drawing in view: %+v", calls)
	}
	if len(f.delivered) != 1 || f.delivered[0].TurnId != turn.ID || f.delivered[0].DrawingId != "f1" || f.delivered[0].Title != "Cache, simpler" ||
		f.delivered[0].Update == "" {
		t.Errorf("delivered: %+v", f.delivered)
	}
}

// with a drawing in view, an answer that is not an edit is a new drawing: delivered with its title and no drawing id
func TestAskNewDrawingWithAnotherInView(t *testing.T) {
	f := newFake(reply(drawAnswer))
	f.files["b1"] = framedSceneFile
	d := New(f.deps())
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, wshrpc.BoardTurn{Kind: KindAsk, Question: "And the store?", DrawingId: "f1"}); err != nil {
		t.Fatal(err)
	}
	got := settled(t, f, d).Turns[0]
	if got.State != StateAnswered || got.DrawingId != "f1" {
		t.Errorf("the turn keeps the drawing in view it was asked in: %+v", got)
	}
	if len(f.delivered) != 1 || f.delivered[0].DrawingId != "" || f.delivered[0].Title != "wavesrv, opened up" {
		t.Errorf("a new drawing is delivered with its title and no drawing id: %+v", f.delivered)
	}
}

// a drawing that is gone from the board is no drawing in view: an edit of it fails the turn
func TestAskEditOfAGoneDrawingFails(t *testing.T) {
	f := newFake(reply(editAnswer))
	f.files["b1"] = framedSceneFile
	d := New(f.deps())
	if _, err := d.Ask(board, wshrpc.BoardTurn{Kind: KindAsk, Question: "Simpler.", DrawingId: "gonef"}); err != nil {
		t.Fatal(err)
	}
	got := settled(t, f, d).Turns[0]
	if got.State != StateFailed || !strings.Contains(got.Reason, "no drawing is in view") || f.deliveredCount() != 0 {
		t.Errorf("an edit with no drawing in view must fail the turn: %+v, delivered %d", got, f.deliveredCount())
	}
	if p := f.callList()[0].Prompt; strings.Contains(p, drawingInViewHead) || !strings.Contains(p, noDrawingLine) {
		t.Errorf("the prompt must say no drawing is in view:\n%s", p)
	}
}

// Retry asks the turn again in the drawing it was first asked in
func TestRetryKeepsTheDrawingInView(t *testing.T) {
	fail := true
	f := newFake(nil)
	f.files["b1"] = framedSceneFile
	f.run = func(ctx context.Context, c Call) (string, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if fail {
			return "", errors.New("the drawer's session exited before it replied (exit status 1)")
		}
		return editAnswer, nil
	}
	d := New(f.deps())
	f.landsAnswers(d, board)
	turn, err := d.Ask(board, wshrpc.BoardTurn{Kind: KindAsk, Question: "Simpler.", DrawingId: "f1"})
	if err != nil {
		t.Fatal(err)
	}
	if got := settled(t, f, d).Turns[0]; got.State != StateFailed || got.DrawingId != "f1" {
		t.Fatalf("a failed turn keeps its drawing: %+v", got)
	}
	f.mu.Lock()
	fail = false
	f.mu.Unlock()
	if err := d.Retry(board, turn.ID); err != nil {
		t.Fatal(err)
	}
	if got := settled(t, f, d).Turns[0]; got.State != StateAnswered || got.DrawingId != "f1" {
		t.Errorf("retried turn: %+v", got)
	}
	calls := f.callList()
	if len(calls) != 2 || !strings.Contains(calls[1].Prompt, drawingInViewHead+`"Cache path" (id f1)`) {
		t.Errorf("the retry must name the drawing the turn was asked in: %+v", calls)
	}
	if len(f.delivered) != 1 || f.delivered[0].DrawingId != "f1" {
		t.Errorf("delivered: %+v", f.delivered)
	}
}

// an agent's request has no drawing in view: it is a new drawing, or an edit of the drawing its answer names, any
// drawing on the board. An edit that names none fails the turn.
func TestRequestDrawsNewOrEditsTheDrawingItNames(t *testing.T) {
	turns := map[string]wshrpc.BoardTurn{
		"a briefing":         requests("Draw the store.", "facts"),
		"a one-line request": requests("Drop the API box's label.", ""),
	}
	answers := map[string]struct {
		answer, drawingId, failure string
	}{
		"a new drawing":                 {answer: drawAnswer},
		"an edit of f2":                 {answer: `{"title":"API, plainer","edit":true,"drawing":"f2","update":[{"id":"api","x":520}]}`, drawingId: "f2"},
		"a delete of f1":                {answer: `{"title":"Cache path, gone","edit":true,"drawing":"f1","remove":["f1"]}`, drawingId: "f1"},
		"an edit that names no drawing": {answer: editAnswer, failure: "names none"},
	}
	for name, in := range turns {
		for aname, c := range answers {
			t.Run(name+", "+aname, func(t *testing.T) {
				f := newFake(reply(c.answer))
				f.files["b1"] = framedSceneFile
				d := New(f.deps())
				f.landsAnswers(d, board)
				if _, err := d.Ask(board, in); err != nil {
					t.Fatal(err)
				}
				got := settled(t, f, d).Turns[0]
				if p := f.callList()[0].Prompt; strings.Contains(p, drawingInViewHead) || !strings.Contains(p, requestDrawingLine) {
					t.Errorf("a request has no drawing in view and may edit one it names:\n%s", p)
				}
				if c.failure != "" {
					if got.State != StateFailed || !strings.Contains(got.Reason, c.failure) || f.deliveredCount() != 0 {
						t.Errorf("want a failed turn: %+v, delivered %d", got, f.deliveredCount())
					}
					return
				}
				if got.State != StateAnswered || len(f.delivered) != 1 || f.delivered[0].DrawingId != c.drawingId {
					t.Errorf("want drawing %q: %+v, delivered %+v", c.drawingId, got, f.delivered)
				}
			})
		}
	}
	// deleting a drawing removes its shapes and its frame
	f := newFake(reply(answers["a delete of f1"].answer))
	f.files["b1"] = framedSceneFile
	d := New(f.deps())
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, requests("Delete the cache drawing.", "")); err != nil {
		t.Fatal(err)
	}
	if got := settled(t, f, d).Turns[0]; got.Removed != 1 || len(f.delivered) != 1 || strings.Join(f.delivered[0].Remove, ",") != "cache,f1" {
		t.Errorf("a delete removes the drawing whole: %+v, delivered %+v", got, f.delivered)
	}
}

// a line the drawer flags, or one it answers with nothing at all, goes to the agent: a question is never dropped
func TestForwardQuestionOnAsk(t *testing.T) {
	for name, answer := range map[string]string{
		"a question flag":  `{"question":true}`,
		"words alone":      wordsAnswer,
		"an empty drawing": `{"title":"nothing","add":[],"update":[],"remove":[]}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := newFake(reply(answer))
			d := New(f.deps())
			turn, err := d.Ask(board, asks("Why does the store retry twice?"))
			if err != nil {
				t.Fatal(err)
			}
			got := settled(t, f, d).Turns[0]
			if got.State != StateForwarded || got.Title != "" || got.Reason != "" || got.AnsweredTs != 1000 ||
				got.Forward == nil || got.Forward.State != ForwardWaiting {
				t.Errorf("turn: %+v", got)
			}
			if f.deliveredCount() != 0 {
				t.Errorf("a forwarded turn delivers nothing")
			}
			if fw := f.forwardedList(); !slices.Equal(fw, []string{turn.ID}) {
				t.Errorf("forwarded %v, want once with %s", fw, turn.ID)
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if !slices.Equal(f.forwardedState, []string{StateForwarded}) {
				t.Errorf("Forward must be called once the turn is saved forwarded, saw %v", f.forwardedState)
			}
			if slices.ContainsFunc(f.pubs, func(u wshrpc.BoardUpdateData) bool { return u.What == UpdateAnswer }) {
				t.Errorf("a forwarded turn publishes no answer: %+v", f.pubs)
			}
		})
	}
}

func TestForwardFreesTheBoard(t *testing.T) {
	f := newFake(reply(`{"question":true}`))
	d := New(f.deps())
	if _, err := d.Ask(board, asks("Why?")); err != nil {
		t.Fatal(err)
	}
	settled(t, f, d)
	// a forwarded turn is over for the drawer: nothing waits to land, so the next ask runs at once
	f.mu.Lock()
	f.run = reply(drawAnswer)
	f.mu.Unlock()
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, asks("Draw it then.")); err != nil {
		t.Fatalf("a board with only a forwarded turn takes the next ask: %v", err)
	}
	settled(t, f, d)
}

func TestStopLeavesBoardUnchanged(t *testing.T) {
	f := newFake(gated(make(chan struct{}), drawAnswer))
	d := New(f.deps())
	if err := d.Stop(board); err == nil {
		t.Errorf("stop on an idle board must say so")
	}
	if _, err := d.Ask(board, asks("q")); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the run", func() bool { return len(f.callList()) == 1 })
	if err := d.Stop(board); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateStopped || talk.Turns[0].Reason != "" {
		t.Errorf("turn: %+v", talk.Turns[0])
	}
	if f.deliveredCount() != 0 {
		t.Errorf("a stopped turn delivers nothing")
	}
	if talk.SessionId != "" {
		t.Errorf("a stopped first turn must leave no session to resume, got %q", talk.SessionId)
	}
}

func TestStopRightAfterAsk(t *testing.T) {
	f := newFake(gated(make(chan struct{}), drawAnswer))
	deps := f.deps()
	var d *Drawer
	var stopErr error
	stopped := false
	publish := deps.Publish
	deps.Publish = func(u wshrpc.BoardUpdateData) {
		// Ask publishes the new turn before it starts the turn's run: the earliest a Stop can land
		if !stopped {
			stopped = true
			stopErr = d.Stop(board)
		}
		publish(u)
	}
	d = New(deps)
	if _, err := d.Ask(board, asks("q")); err != nil {
		t.Fatal(err)
	}
	if stopErr != nil {
		t.Fatalf("stop right after the ask: %v", stopErr)
	}
	if got := settled(t, f, d).Turns[0]; got.State != StateStopped {
		t.Errorf("turn: %+v", got)
	}
}

// a Stop that lands once the answer is in the inbox is too late to keep it off the board: it is refused, and the
// turn lands as it would have
func TestStopAfterDeliverIsRefused(t *testing.T) {
	f := newFake(reply(drawAnswer))
	deps := f.deps()
	var d *Drawer
	var stopErr error
	deliver := deps.Deliver
	deps.Deliver = func(a wshrpc.BoardAnswer) error {
		if err := deliver(a); err != nil {
			return err
		}
		stopErr = d.Stop(board)
		return nil
	}
	d = New(deps)
	turn, err := d.Ask(board, asks("q"))
	if err != nil {
		t.Fatal(err)
	}
	land(t, f, d, board, turn.ID, "n1")
	talk := settled(t, f, d)
	if stopErr == nil || stopErr.Error() != StopTooLateReason {
		t.Errorf("stop after delivery: want %q, got %v", StopTooLateReason, stopErr)
	}
	if talk.Turns[0].State != StateAnswered || f.deliveredCount() != 1 {
		t.Fatalf("a delivered answer must end answered: %+v, delivered %d", talk.Turns[0], f.deliveredCount())
	}
}

// Stop ends the running turn only: a request waiting behind it still runs
func TestStopKeepsTheQueue(t *testing.T) {
	release := make(chan struct{})
	f := newFake(nil)
	f.run = func(ctx context.Context, c Call) (string, error) {
		if strings.Contains(c.Prompt, "The question: first") {
			<-ctx.Done()
			return "", ctx.Err()
		}
		<-release
		return drawAnswer, nil
	}
	d := New(f.deps())
	if _, err := d.Ask(board, asks("first")); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the first run", func() bool { return len(f.callList()) == 1 })
	queued, err := d.Ask(board, requests("Draw the store.", ""))
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Stop(board); err != nil {
		t.Fatal(err)
	}
	close(release)
	land(t, f, d, board, queued.ID, "n1")
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateStopped || talk.Turns[1].State != StateAnswered {
		t.Errorf("the stopped turn is stopped and the request after it still drew: %+v", talk.Turns)
	}
}

func TestRetryReasks(t *testing.T) {
	fail := true
	f := newFake(nil)
	f.run = func(ctx context.Context, c Call) (string, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if fail {
			return "", errors.New("the drawer's session exited before it replied (exit status 1)")
		}
		return drawAnswer, nil
	}
	d := New(f.deps())
	f.landsAnswers(d, board)
	turn, err := d.Ask(board, wshrpc.BoardTurn{Kind: KindAsk, Question: "Why two?", On: "box", SelectedIds: []string{"box"}})
	if err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateFailed || !strings.Contains(talk.Turns[0].Reason, "exited before it replied") {
		t.Fatalf("turn: %+v", talk.Turns[0])
	}
	if err := d.Retry(board, "nope"); err == nil {
		t.Errorf("retry of an unknown turn must fail")
	}
	f.mu.Lock()
	fail = false
	f.mu.Unlock()
	if err := d.Retry(board, turn.ID); err != nil {
		t.Fatal(err)
	}
	talk = settled(t, f, d)
	got := talk.Turns[0]
	if len(talk.Turns) != 1 || got.State != StateAnswered || got.Reason != "" || got.StartedTs != 1000 || got.Question != "Why two?" || got.On != "box" {
		t.Errorf("retried turn: %+v", talk.Turns)
	}
	calls := f.callList()
	if len(calls) != 2 || calls[1].Resume || !strings.Contains(calls[1].Prompt, "Why two?") || !strings.Contains(calls[1].Prompt, "## Your reply") ||
		!strings.Contains(calls[1].Prompt, `"selected":true`) {
		t.Errorf("a first turn that never answered starts its session again on retry, with its selection: %+v", calls)
	}
	if err := d.Retry(board, turn.ID); err == nil {
		t.Errorf("an answered turn cannot be retried")
	}
}

func TestRetryStoppedTurnAndBusyBoard(t *testing.T) {
	release := make(chan struct{})
	f := newFake(gated(release, drawAnswer))
	d := New(f.deps())
	turn, err := d.Ask(board, asks("q"))
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the run", func() bool { return len(f.callList()) == 1 })
	if err := d.Stop(board); err != nil {
		t.Fatal(err)
	}
	settled(t, f, d)
	// a stopped turn is asked again; while it runs, the board is busy and takes no other retry
	if err := d.Retry(board, turn.ID); err != nil {
		t.Fatal(err)
	}
	if err := d.Retry(board, turn.ID); err == nil || err.Error() != BusyReason {
		t.Errorf("retry on a busy board: want %q, got %v", BusyReason, err)
	}
	close(release)
	f.landsAnswers(d, board)
	if got := settled(t, f, d).Turns[0]; got.State != StateAnswered {
		t.Errorf("retried stopped turn: %+v", got)
	}
}

// Retry makes the turn new again: nothing of its failed run is left on it
func TestRetryClearsWhatTheFailedRunLeft(t *testing.T) {
	release := make(chan struct{})
	f := newFake(gated(release, drawAnswer))
	f.talks["b1"] = wshrpc.BoardTalk{Project: "waveterm", BoardId: "b1", SessionId: "s", Turns: []wshrpc.BoardTurn{{
		ID: "t0", Ts: 1, Kind: KindAsk, Question: "q", State: StateFailed, Reason: "the board would not take it", Title: "old",
		Added: 3, Changed: 1, Removed: 2, ShapeIds: []string{"x"}, StartedTs: 2, AnsweredTs: 3,
	}}}
	d := New(f.deps())
	if err := d.Retry(board, "t0"); err != nil {
		t.Fatal(err)
	}
	// the run is held, so this is the turn as Retry left it
	got := f.talk("b1").Turns[0]
	if got.State != StateAnswering || got.Reason != "" || got.Title != "" || got.Added != 0 || got.Changed != 0 || got.Removed != 0 ||
		got.ShapeIds != nil || got.AnsweredTs != 0 || got.Ts != 1000 || got.StartedTs != 1000 {
		t.Errorf("retried turn: %+v", got)
	}
	close(release)
	land(t, f, d, board, "t0", "n1")
	settled(t, f, d)
}

func TestAnsweredLandsTheTurn(t *testing.T) {
	f := newFake(reply(drawAnswer))
	d := New(f.deps())
	turn, err := d.Ask(board, asks("q"))
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the answer", func() bool { return f.hasPublished(UpdateAnswer, turn.ID) })
	if got := f.talk("b1").Turns[0]; got.State != StateAnswering || got.Title != "wavesrv, opened up" || got.Added != 2 || got.Changed != 0 {
		t.Errorf("a delivered turn stays answering, with its counts, until it lands: %+v", got)
	}
	if err := d.Answered(board, turn.ID, []string{"n1", "n2", "box"}); err != nil {
		t.Fatal(err)
	}
	got := f.talk("b1").Turns[0]
	if got.State != StateAnswered || got.AnsweredTs != 1000 || got.Reason != "" || !slices.Equal(got.ShapeIds, []string{"n1", "n2", "box"}) {
		t.Errorf("answered turn: %+v", got)
	}
	settled(t, f, d)
	if !slices.ContainsFunc(f.published(), func(u wshrpc.BoardUpdateData) bool {
		return u.What == UpdateTalk && u.TurnId == turn.ID && u.State == StateAnswered
	}) {
		t.Errorf("the landed turn must be published: %+v", f.published())
	}
	// an ack that arrives twice changes nothing
	if err := d.Answered(board, turn.ID, []string{"other"}); err != nil {
		t.Errorf("a repeated ack is harmless: %v", err)
	}
	if got := f.talk("b1").Turns[0]; !slices.Equal(got.ShapeIds, []string{"n1", "n2", "box"}) {
		t.Errorf("a repeated ack must not rewrite the shapes: %v", got.ShapeIds)
	}
	if err := d.Answered(board, "nope", nil); err == nil {
		t.Errorf("an ack for an unknown turn must fail")
	}
}

func TestAnsweredRefusesATurnNotLanding(t *testing.T) {
	f := newFake(reply(`{"question":true}`))
	d := New(f.deps())
	turn, err := d.Ask(board, asks("Why?"))
	if err != nil {
		t.Fatal(err)
	}
	settled(t, f, d)
	if err := d.Answered(board, turn.ID, []string{"n1"}); err == nil {
		t.Errorf("a forwarded turn has no drawing to ack")
	}
	if got := f.talk("b1").Turns[0]; got.State != StateForwarded || got.ShapeIds != nil {
		t.Errorf("the refused ack must change nothing: %+v", got)
	}
}

func TestLandFailedFailsTurn(t *testing.T) {
	f := newFake(reply(drawAnswer))
	d := New(f.deps())
	turn, err := d.Ask(board, asks("q"))
	if err != nil {
		t.Fatal(err)
	}
	queued, err := d.Ask(board, requests("Draw the store.", ""))
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the answer", func() bool { return f.hasPublished(UpdateAnswer, turn.ID) })
	if err := d.LandFailed(board, turn.ID, "the board would not take it"); err != nil {
		t.Fatal(err)
	}
	got := f.talk("b1").Turns[0]
	if got.State != StateFailed || got.Reason != "the board would not take it" || got.Title != "" || got.Added != 0 || got.Changed != 0 ||
		got.Removed != 0 || got.ShapeIds != nil {
		t.Errorf("a drawing that did not land changed nothing: %+v", got)
	}
	if !slices.ContainsFunc(f.published(), func(u wshrpc.BoardUpdateData) bool {
		return u.What == UpdateTalk && u.TurnId == turn.ID && u.State == StateFailed && u.Reason == "the board would not take it"
	}) {
		t.Errorf("the failed landing must be published: %+v", f.published())
	}
	// the board is free again: the request that queued behind runs
	land(t, f, d, board, queued.ID, "n1")
	talk := settled(t, f, d)
	if talk.Turns[1].State != StateAnswered {
		t.Errorf("the queued request runs after a failed landing: %+v", talk.Turns[1])
	}
	if err := d.LandFailed(board, "nope", "x"); err == nil {
		t.Errorf("a landing failure for an unknown turn must fail")
	}
	if err := d.LandFailed(board, queued.ID, "x"); err == nil {
		t.Errorf("an answered turn did not fail to land")
	}
	f.landsAnswers(d, board)
	if err := d.Retry(board, turn.ID); err != nil {
		t.Fatal(err)
	}
	if got := settled(t, f, d).Turns[0]; got.State != StateAnswered {
		t.Errorf("a turn that failed to land can be retried: %+v", got)
	}
}

func TestRestartFailsStaleTurns(t *testing.T) {
	f := newFake(reply(drawAnswer))
	f.talks["b1"] = wshrpc.BoardTalk{Project: "waveterm", BoardId: "b1", SessionId: "s1", Turns: []wshrpc.BoardTurn{
		{ID: "t0", Kind: KindAsk, Question: "a", State: StateAnswered},
		{ID: "t1", Kind: KindAsk, Question: "b", State: StateAnswering},
		{ID: "t2", Kind: KindRequest, Question: "c", Context: "y", State: StateWaiting},
		{ID: "t3", Kind: KindAsk, Question: "d", State: StateForwarded, Forward: &wshrpc.BoardForward{State: ForwardSent}},
	}}
	d := New(f.deps())
	talk, err := d.Talk(board)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range []int{1, 2} {
		if talk.Turns[i].State != StateFailed || talk.Turns[i].Reason != RestartedReason {
			t.Errorf("turn %d: %+v", i, talk.Turns[i])
		}
	}
	if talk.Turns[0].State != StateAnswered || talk.Turns[3].State != StateForwarded || talk.Turns[3].Forward.State != ForwardSent {
		t.Errorf("an answered and a forwarded turn stay as they were: %+v", talk.Turns)
	}
	if saved := f.talk("b1"); saved.Turns[1].State != StateFailed || saved.Turns[2].Reason != RestartedReason {
		t.Errorf("stale turns must be saved failed: %+v", saved.Turns)
	}
	pubs := f.published()
	if len(pubs) != 2 || pubs[0].TurnId != "t1" || pubs[1].TurnId != "t2" || pubs[1].State != StateFailed || pubs[1].Reason != RestartedReason ||
		pubs[0].What != UpdateTalk {
		t.Errorf("stale turns must be published failed: %+v", pubs)
	}
	f.landsAnswers(d, board)
	if err := d.Retry(board, "t1"); err != nil {
		t.Fatal(err)
	}
	if got := settled(t, f, d).Turns[1]; got.State != StateAnswered {
		t.Errorf("retried: %+v", got)
	}

	// a turn the drawer is running is not stale
	release := make(chan struct{})
	f.mu.Lock()
	f.ack = nil
	f.run = gated(release, wordsAnswer)
	f.mu.Unlock()
	turn, err := d.Ask(board, asks("live"))
	if err != nil {
		t.Fatal(err)
	}
	talk, err = d.Talk(board)
	if err != nil || findTurn(&talk, turn.ID).State != StateAnswering {
		t.Errorf("a running turn must stay answering: %+v %v", talk.Turns, err)
	}
	close(release)
	settled(t, f, d)
}

// the app restarted after the drawing was delivered but before it was acked: the drawing landed anyway, so the late
// ack makes the turn answered
func TestRestartLateAckAnswers(t *testing.T) {
	f := newFake(reply(drawAnswer))
	f.talks["b1"] = wshrpc.BoardTalk{Project: "waveterm", BoardId: "b1", SessionId: "s1", Turns: []wshrpc.BoardTurn{
		{ID: "t0", Kind: KindAsk, Question: "a", State: StateAnswering, Title: "wavesrv, opened up", Added: 2},
		{ID: "t1", Kind: KindAsk, Question: "b", State: StateFailed, Reason: "the drawer's answer is not usable: x"},
	}}
	d := New(f.deps())
	if talk, err := d.Talk(board); err != nil || talk.Turns[0].State != StateFailed || talk.Turns[0].Reason != RestartedReason {
		t.Fatalf("the stale turn is failed first: %+v %v", talk.Turns, err)
	}
	if err := d.Answered(board, "t0", []string{"n1"}); err != nil {
		t.Fatal(err)
	}
	got := f.talk("b1").Turns[0]
	if got.State != StateAnswered || got.Reason != "" || got.Title != "wavesrv, opened up" || !slices.Equal(got.ShapeIds, []string{"n1"}) {
		t.Errorf("a late ack of a landed drawing answers the turn: %+v", got)
	}
	if err := d.Answered(board, "t1", []string{"n1"}); err == nil {
		t.Errorf("a turn that failed for another reason did not land a drawing")
	}
}

func TestWaitReturnsAtEndStates(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	t.Run("answered", func(t *testing.T) {
		f := newFake(reply(drawAnswer))
		d := New(f.deps())
		turn, err := d.Ask(board, requests("Draw the store.", "facts"))
		if err != nil {
			t.Fatal(err)
		}
		done := make(chan wshrpc.BoardTurn, 1)
		go func() {
			got, err := d.Wait(ctx, board, turn.ID)
			if err != nil {
				t.Errorf("wait: %v", err)
			}
			done <- got
		}()
		waitFor(t, "the answer", func() bool { return f.hasPublished(UpdateAnswer, turn.ID) })
		select {
		case got := <-done:
			t.Fatalf("wait returned before the drawing landed: %+v", got)
		case <-time.After(30 * time.Millisecond):
		}
		if err := d.Answered(board, turn.ID, []string{"n1"}); err != nil {
			t.Fatal(err)
		}
		got := <-done
		if got.State != StateAnswered || got.Added != 2 || got.Changed != 0 || got.Title != "wavesrv, opened up" {
			t.Errorf("wait: %+v", got)
		}
	})
	t.Run("failed", func(t *testing.T) {
		f := newFake(reply(`{"question":true}`))
		d := New(f.deps())
		turn, err := d.Ask(board, requests("Draw the store.", ""))
		if err != nil {
			t.Fatal(err)
		}
		got, err := d.Wait(ctx, board, turn.ID)
		if err != nil || got.State != StateFailed || got.Reason == "" {
			t.Errorf("wait: %+v %v", got, err)
		}
	})
	t.Run("forwarded", func(t *testing.T) {
		f := newFake(reply(`{"question":true}`))
		d := New(f.deps())
		turn, err := d.Ask(board, asks("Why?"))
		if err != nil {
			t.Fatal(err)
		}
		got, err := d.Wait(ctx, board, turn.ID)
		if err != nil || got.State != StateForwarded {
			t.Errorf("wait: %+v %v", got, err)
		}
	})
	t.Run("stopped", func(t *testing.T) {
		f := newFake(gated(make(chan struct{}), drawAnswer))
		d := New(f.deps())
		turn, err := d.Ask(board, asks("q"))
		if err != nil {
			t.Fatal(err)
		}
		waitFor(t, "the run", func() bool { return len(f.callList()) == 1 })
		go func() { _ = d.Stop(board) }()
		got, err := d.Wait(ctx, board, turn.ID)
		if err != nil || got.State != StateStopped {
			t.Errorf("wait: %+v %v", got, err)
		}
	})
	t.Run("already over", func(t *testing.T) {
		f := newFake(reply(`{"question":true}`))
		d := New(f.deps())
		turn, err := d.Ask(board, asks("Why?"))
		if err != nil {
			t.Fatal(err)
		}
		settled(t, f, d)
		got, err := d.Wait(ctx, board, turn.ID)
		if err != nil || got.State != StateForwarded {
			t.Errorf("wait on a finished turn: %+v %v", got, err)
		}
	})
}

// a wait that runs out hands back the turn as it is, still answering, so the caller can say it is still drawing
func TestWaitEndsWithContext(t *testing.T) {
	f := newFake(gated(make(chan struct{}), drawAnswer))
	d := New(f.deps())
	turn, err := d.Ask(board, asks("q"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	got, err := d.Wait(ctx, board, turn.ID)
	if err != nil || got.ID != turn.ID || got.State != StateAnswering {
		t.Errorf("wait past its context: %+v %v", got, err)
	}
	if _, err := d.Wait(context.Background(), board, "nope"); err == nil {
		t.Errorf("a wait on an unknown turn must fail")
	}
	if err := d.Stop(board); err != nil {
		t.Fatal(err)
	}
	settled(t, f, d)
}

func TestReadAgentCursorMovesAndFollowsTheSession(t *testing.T) {
	f := newFake(reply(drawAnswer))
	agent := &wshrpc.BoardAgent{TabId: "tab9", Title: agentName, SessionId: "sess-1", ReadTs: 500}
	f.talks["b1"] = wshrpc.BoardTalk{Project: "waveterm", BoardId: "b1", Agent: agent}
	cursor := int64(700)
	f.agent = func(a wshrpc.BoardAgent, since int64) (string, string, int64, error) {
		if since >= cursor {
			return "", "sess-2", since, nil
		}
		return "Agent: the retry loop backs off twice.", "sess-2", cursor, nil
	}
	d := New(f.deps())
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, asks("Draw what we just discussed.")); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Agent == nil || talk.Agent.ReadTs != 700 || talk.Agent.TabId != "tab9" || talk.Agent.SessionId != "sess-2" || talk.Agent.Title != agentName {
		t.Errorf("the cursor moves to what the read returned and the session follows the agent: %+v", talk.Agent)
	}
	f.mu.Lock()
	agents, reads := slices.Clone(f.readAgents), slices.Clone(f.reads)
	f.mu.Unlock()
	if len(agents) != 1 || agents[0].TabId != "tab9" || reads[0] != 500 {
		t.Fatalf("want one read of the agent since 500: %+v %v", agents, reads)
	}
	calls := f.callList()
	if !strings.Contains(calls[0].Prompt, "Agent: the retry loop backs off twice.") || !strings.Contains(calls[0].Prompt, "Draw what we just discussed.") ||
		!strings.Contains(calls[0].Prompt, agentName) {
		t.Errorf("the prompt lacks the agent's turns:\n%s", calls[0].Prompt)
	}

	// the next turn reads from the saved cursor, and nothing new hands over nothing
	if _, err := d.Ask(board, asks("And the store?")); err != nil {
		t.Fatal(err)
	}
	talk = settled(t, f, d)
	f.mu.Lock()
	reads = slices.Clone(f.reads)
	f.mu.Unlock()
	calls = f.callList()
	if len(reads) != 2 || reads[1] != 700 || talk.Agent.ReadTs != 700 {
		t.Errorf("the second read starts at the cursor: reads %v, agent %+v", reads, talk.Agent)
	}
	if strings.Contains(calls[1].Prompt, "retry loop") {
		t.Errorf("nothing new from the agent must hand over nothing:\n%s", calls[1].Prompt)
	}
}

// an agent that cannot be read costs the turn nothing, and its cursor stays where it was
func TestReadAgentCursorStaysWhenUnreadable(t *testing.T) {
	f := newFake(reply(drawAnswer))
	f.talks["b1"] = wshrpc.BoardTalk{Project: "waveterm", BoardId: "b1", Agent: &wshrpc.BoardAgent{TabId: "gone", Title: agentName, SessionId: "sess-1", ReadTs: 500}}
	f.agent = func(wshrpc.BoardAgent, int64) (string, string, int64, error) {
		return "", "", 0, errors.New("no agent tab gone")
	}
	d := New(f.deps())
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, asks("q")); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateAnswered || talk.Agent.ReadTs != 500 || talk.Agent.SessionId != "sess-1" {
		t.Errorf("an unreadable agent costs the turn nothing and keeps the cursor: %+v %+v", talk.Turns[0], talk.Agent)
	}
}

// the cursor moves only once the turn ran: a turn that failed before the drawer saw what the agent said reads it again
func TestReadAgentCursorStaysWhenTheTurnFails(t *testing.T) {
	f := newFake(func(context.Context, Call) (string, error) {
		return "", errors.New("the drawer's session exited before it replied (exit status 1)")
	})
	f.talks["b1"] = wshrpc.BoardTalk{Project: "waveterm", BoardId: "b1", Agent: &wshrpc.BoardAgent{TabId: "tab9", Title: agentName, ReadTs: 500}}
	f.agent = func(wshrpc.BoardAgent, int64) (string, string, int64, error) {
		return "Agent: said it.", "sess-2", 700, nil
	}
	d := New(f.deps())
	if _, err := d.Ask(board, asks("q")); err != nil {
		t.Fatal(err)
	}
	talk := settled(t, f, d)
	if talk.Turns[0].State != StateFailed || talk.Agent.ReadTs != 500 || talk.Agent.SessionId != "" {
		t.Errorf("a failed turn leaves the agent's cursor: %+v %+v", talk.Turns[0], talk.Agent)
	}
}

func TestReadAgentCursorNoAgentReadsNothing(t *testing.T) {
	f := newFake(reply(drawAnswer))
	d := New(f.deps())
	f.landsAnswers(d, board)
	if _, err := d.Ask(board, asks("q")); err != nil {
		t.Fatal(err)
	}
	if talk := settled(t, f, d); talk.Agent != nil || talk.Turns[0].State != StateAnswered {
		t.Errorf("talk: %+v", talk)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.reads) != 0 {
		t.Errorf("a board with no agent reads no transcript: %v", f.readAgents)
	}
}
