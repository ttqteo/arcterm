// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	RestartedReason   = "Arc restarted before the drawer answered"
	BusyReason        = "the drawer is answering; ask once this answer lands"
	StopTooLateReason = "the answer is already on its way to the board"

	// BoardTurn.Kind
	KindAsk     = "ask"     // the person's line: drawn, or flagged as a question for the agent
	KindRequest = "request" // the agent's own request (wsh board draw): drawn, or failed

	// BoardTurn.State
	StateWaiting   = "waiting"   // queued behind the turn that is running
	StateAnswering = "answering" // the drawer is on it, or its drawing is delivered and not yet landed on the board
	StateAnswered  = "answered"  // the drawing landed on the board
	StateForwarded = "forwarded" // flagged as a question and sent to the agent
	StateFailed    = "failed"
	StateStopped   = "stopped"

	// BoardForward.State
	ForwardWaiting   = "waiting"   // not sent yet: the agent has a question or permission prompt open
	ForwardSent      = "sent"      // typed into the agent
	ForwardReplied   = "replied"   // the agent's reply was copied onto the turn
	ForwardAgentGone = "agentgone" // the agent's tab is closed

	// BoardUpdateData.What
	UpdateList   = "list"   // a board came or went, or its facts changed (published by the handlers, not the drawer)
	UpdateTalk   = "talk"   // a turn changed state
	UpdateAnswer = "answer" // a drawing waits in the board's inbox

	wontOpenHead = "the board's file won't open: "
	noLandReason = "the drawing could not be applied to the board"

	// claude's error for a --resume of a session it no longer has (its transcript was cleaned up or deleted)
	lostSessionText = "No conversation found with session ID"
)

var errNoTurn = errors.New("this board has no such turn")

// Board names one board and where its drawer runs. A board belongs to a project by name.
type Board struct{ Project, BoardId, Name, ProjectPath string }

// Deps is everything the drawer touches outside this package.
type Deps struct {
	LoadTalk func(b Board) (wshrpc.BoardTalk, error)
	// fn calls no other Dep: the store may hold its lock while fn runs
	UpdateTalk func(b Board, fn func(*wshrpc.BoardTalk) error) (wshrpc.BoardTalk, error)
	ReadBoard  func(b Board) ([]byte, error) // the board file
	// ReadAgent is what the board's agent said since sinceTs (the drawer's last read), with the agent's current claude
	// session and the cursor to read from next time. An agent that cannot be read costs the turn nothing.
	ReadAgent func(ctx context.Context, agent wshrpc.BoardAgent, sinceTs int64) (text, sessionId string, cursorTs int64, err error)
	Deliver   func(a wshrpc.BoardAnswer) error
	Publish   func(u wshrpc.BoardUpdateData)
	// Forward is called, outside any talk update, once a turn is saved as forwarded
	Forward func(b Board, turnId string)
	Run     func(ctx context.Context, cwd string, c Call) (Reply, error) // nil: RunModel
	Now     func() int64
	NewId   func() string // nil: uuid.NewString
}

type boardKey struct{ project, boardId string }

// boardRun is a board the drawer is busy on: the turn it runs and the requests waiting behind it. The board stays busy
// until the running turn is over, which for a drawing is until it has landed on the board.
type boardRun struct {
	turnId    string
	ctx       context.Context
	cancel    context.CancelFunc
	queue     []string      // waiting turn ids, oldest first
	delivered bool          // the turn's answer is in the inbox: a Stop is too late to keep it off the board
	landed    chan struct{} // closed once the turn's drawing is acked or fails to land
}

// begin makes turnId the running turn, with the context Stop cancels. Called under d.mu as the turn is made current,
// not from the goroutine that runs it, so a Stop right after the ask finds something to cancel.
func (r *boardRun) begin(turnId string) {
	r.turnId = turnId
	r.ctx, r.cancel = context.WithCancel(context.Background())
	r.delivered = false
	r.landed = make(chan struct{})
}

func newRun(turnId string) *boardRun {
	r := &boardRun{}
	r.begin(turnId)
	return r
}

// Drawer runs boards' turns, one at a time per board. What it runs lives in memory only: after a restart, Talk
// fails the turns nothing runs any more.
type Drawer struct {
	d       Deps
	mu      sync.Mutex
	boards  map[boardKey]*boardRun
	changed map[boardKey]chan struct{} // closed, and dropped, when a board's turn changes: what Wait wakes on
}

func New(d Deps) *Drawer {
	if d.Run == nil {
		d.Run = RunModel
	}
	if d.Now == nil {
		d.Now = func() int64 { return time.Now().UnixMilli() }
	}
	if d.NewId == nil {
		d.NewId = uuid.NewString
	}
	return &Drawer{d: d, boards: map[boardKey]*boardRun{}, changed: map[boardKey]chan struct{}{}}
}

func keyOf(b Board) boardKey { return boardKey{b.Project, b.BoardId} }

func (d *Drawer) Busy(b Board) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.boards[keyOf(b)] != nil
}

// Ask adds in to the board's talk and runs it. in names its Kind (ask or request) and carries what the caller means to
// say: Question, On, SelectedIds, DrawingId (the drawing in view when the line was asked), Context (a request's
// briefing) and From (the turn a send-the-other-way redoes). Every other field is the drawer's to set. While a turn runs, an ask is refused with BusyReason, and a request waits behind
// it instead. An ask with From set is the person's line sent to be drawn: it may not be flagged as a question.
func (d *Drawer) Ask(b Board, in wshrpc.BoardTurn) (wshrpc.BoardTurn, error) {
	if in.Kind != KindAsk && in.Kind != KindRequest {
		return wshrpc.BoardTurn{}, fmt.Errorf("a turn is an %s or a %s, not %q", KindAsk, KindRequest, in.Kind)
	}
	t := wshrpc.BoardTurn{
		ID: d.d.NewId(), Ts: d.d.Now(), Kind: in.Kind, Question: in.Question, On: in.On,
		SelectedIds: slices.Clone(in.SelectedIds), DrawingId: in.DrawingId, Context: in.Context, From: in.From, State: StateAnswering,
	}
	t.StartedTs = t.Ts
	d.mu.Lock()
	run := d.boards[keyOf(b)]
	if run != nil && t.Kind == KindAsk {
		d.mu.Unlock()
		return wshrpc.BoardTurn{}, errors.New(BusyReason)
	}
	if run != nil {
		t.State, t.StartedTs = StateWaiting, 0
	}
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		talk.Turns = append(talk.Turns, t)
		return nil
	})
	if err != nil {
		d.mu.Unlock()
		return wshrpc.BoardTurn{}, err
	}
	if run != nil {
		run.queue = append(run.queue, t.ID)
	} else {
		d.boards[keyOf(b)] = newRun(t.ID)
	}
	d.mu.Unlock()
	d.publishTurn(b, t)
	if run == nil {
		go d.loop(b, t.ID)
	}
	return t, nil
}

// Stop cancels the running turn only: it ends stopped, with nothing delivered; waiting requests still run. Once the
// turn's drawing is in the inbox it is too late: the drawing will land.
func (d *Drawer) Stop(b Board) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	run := d.boards[keyOf(b)]
	if run == nil {
		return errors.New("the drawer is not answering on this board")
	}
	if run.delivered {
		return errors.New(StopTooLateReason)
	}
	run.cancel()
	return nil
}

// Retry asks a failed or stopped turn again, as the same kind of turn it was.
func (d *Drawer) Retry(b Board, turnId string) error {
	now := d.d.Now()
	return d.startOwn(b, func(talk *wshrpc.BoardTalk) (*wshrpc.BoardTurn, error) {
		t := findTurn(talk, turnId)
		if t == nil {
			return nil, errNoTurn
		}
		if t.State != StateFailed && t.State != StateStopped {
			return nil, fmt.Errorf("only a failed or stopped turn can be retried, and this one is %s", t.State)
		}
		t.State, t.Reason, t.Ts, t.StartedTs, t.AnsweredTs, t.Forward = StateAnswering, "", now, now, 0, nil
		clearDrawing(t)
		return t, nil
	})
}

// startOwn runs the turn fn readies in the talk, refusing while the board is busy: Retry is the person's ask.
func (d *Drawer) startOwn(b Board, fn func(*wshrpc.BoardTalk) (*wshrpc.BoardTurn, error)) error {
	d.mu.Lock()
	if d.boards[keyOf(b)] != nil {
		d.mu.Unlock()
		return errors.New(BusyReason)
	}
	var turn wshrpc.BoardTurn
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		t, err := fn(talk)
		if err == nil {
			turn = *t
		}
		return err
	})
	if err != nil {
		d.mu.Unlock()
		return err
	}
	d.boards[keyOf(b)] = newRun(turn.ID)
	d.mu.Unlock()
	d.publishTurn(b, turn)
	go d.loop(b, turn.ID)
	return nil
}

// Answered is the ack: the frontend applied the turn's drawing to the board and names the shapes it added or changed.
// The turn is answered, and the board takes its next turn. An ack that comes twice changes nothing. A turn failed by a
// restart takes it too: the drawing landed anyway.
func (d *Drawer) Answered(b Board, turnId string, shapeIds []string) error {
	var turn wshrpc.BoardTurn
	changed := false
	now := d.d.Now()
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		changed = false
		t := findTurn(talk, turnId)
		switch {
		case t == nil:
			return errNoTurn
		case t.State == StateAnswered:
			return nil
		case t.State != StateAnswering && !(t.State == StateFailed && t.Reason == RestartedReason):
			return fmt.Errorf("this turn is %s, not waiting for its drawing to land", t.State)
		}
		t.State, t.Reason, t.ShapeIds, t.AnsweredTs = StateAnswered, "", slices.Clone(shapeIds), now
		turn, changed = *t, true
		return nil
	})
	if err != nil || !changed {
		return err
	}
	d.landed(b, turnId)
	d.publishTurn(b, turn)
	return nil
}

// LandFailed is the ack of a drawing the frontend could not apply: nothing changed on the board, and the turn fails
// with reason.
func (d *Drawer) LandFailed(b Board, turnId, reason string) error {
	if strings.TrimSpace(reason) == "" {
		reason = noLandReason
	}
	var turn wshrpc.BoardTurn
	changed := false
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		changed = false
		t := findTurn(talk, turnId)
		switch {
		case t == nil:
			return errNoTurn
		case t.State == StateFailed:
			return nil
		case t.State != StateAnswering:
			return fmt.Errorf("this turn is %s, not waiting for its drawing to land", t.State)
		}
		failTurn(t, reason)
		turn, changed = *t, true
		return nil
	})
	if err != nil || !changed {
		return err
	}
	d.landed(b, turnId)
	d.publishTurn(b, turn)
	return nil
}

// Wait returns the turn once it is answered, failed, stopped or forwarded, or as it is when ctx ends (still waiting or
// answering): a caller that gives up on the wait finds out from the state, not an error.
func (d *Drawer) Wait(ctx context.Context, b Board, turnId string) (wshrpc.BoardTurn, error) {
	for {
		// taken before the talk is read, so a change in between wakes the wait instead of passing it by
		changed := d.watch(b)
		talk, err := d.d.LoadTalk(b)
		if err != nil {
			return wshrpc.BoardTurn{}, err
		}
		t := findTurn(&talk, turnId)
		if t == nil {
			return wshrpc.BoardTurn{}, errNoTurn
		}
		if ended(t.State) {
			return *t, nil
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return *t, nil
		}
	}
}

func ended(state string) bool {
	return state == StateAnswered || state == StateFailed || state == StateStopped || state == StateForwarded
}

// Talk reads the board's talk. A turn left answering or waiting that nothing runs (wavesrv restarted) is failed
// with RestartedReason, and that is saved and published.
func (d *Drawer) Talk(b Board) (wshrpc.BoardTalk, error) {
	talk, failed, err := d.failStale(b)
	for _, t := range failed {
		d.publishTurn(b, t)
	}
	return talk, err
}

func (d *Drawer) failStale(b Board) (wshrpc.BoardTalk, []wshrpc.BoardTurn, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	var live []string
	if run := d.boards[keyOf(b)]; run != nil {
		live = append([]string{run.turnId}, run.queue...)
	}
	stale := func(t wshrpc.BoardTurn) bool {
		return (t.State == StateAnswering || t.State == StateWaiting) && !slices.Contains(live, t.ID)
	}
	talk, err := d.d.LoadTalk(b)
	if err != nil || !slices.ContainsFunc(talk.Turns, stale) {
		return talk, nil, err
	}
	var failed []wshrpc.BoardTurn
	talk, err = d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		failed = nil
		for i := range talk.Turns {
			if stale(talk.Turns[i]) {
				talk.Turns[i].State, talk.Turns[i].Reason = StateFailed, RestartedReason
				failed = append(failed, talk.Turns[i])
			}
		}
		return nil
	})
	if err != nil {
		return talk, nil, err
	}
	return talk, failed, nil
}

// loop runs turnId, then each request that queued behind it.
func (d *Drawer) loop(b Board, turnId string) {
	k := keyOf(b)
	for {
		d.runTurn(b, turnId)
		d.mu.Lock()
		run := d.boards[k]
		if len(run.queue) == 0 {
			delete(d.boards, k)
			d.mu.Unlock()
			return
		}
		turnId, run.queue = run.queue[0], run.queue[1:]
		run.begin(turnId)
		d.mu.Unlock()
	}
}

// runTurn runs one turn to its end: stopped, failed, forwarded, or drawn and landed on the board.
func (d *Drawer) runTurn(b Board, turnId string) {
	d.mu.Lock()
	run := d.boards[keyOf(b)]
	ctx, cancel, landed := run.ctx, run.cancel, run.landed
	d.mu.Unlock()
	defer cancel()

	waited := false
	now := d.d.Now()
	talk, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		t := findTurn(talk, turnId)
		if t == nil {
			return errors.New("the turn is gone from the board's talk")
		}
		if waited = t.State == StateWaiting; waited {
			t.StartedTs = now
		}
		t.State = StateAnswering
		return nil
	})
	if err != nil {
		d.finish(b, turnId, func(t *wshrpc.BoardTurn) { failTurn(t, err.Error()) })
		return
	}
	turn := *findTurn(&talk, turnId)
	if waited {
		d.publishTurn(b, turn)
	}

	answer, err := d.answer(ctx, b, talk, turn)
	if err == nil && answer.HasDrawing() {
		err = d.deliver(ctx, b, turn, answer)
	}
	switch {
	case err != nil && ctx.Err() != nil:
		d.finish(b, turnId, func(t *wshrpc.BoardTurn) { t.State = StateStopped })
	case err != nil:
		d.finish(b, turnId, func(t *wshrpc.BoardTurn) { failTurn(t, err.Error()) })
	case answer.Question:
		answeredTs := d.d.Now()
		saved := d.finish(b, turnId, func(t *wshrpc.BoardTurn) {
			t.State, t.AnsweredTs, t.Forward = StateForwarded, answeredTs, &wshrpc.BoardForward{State: ForwardWaiting}
		})
		if saved && d.d.Forward != nil {
			d.d.Forward(b, turnId)
		}
	default:
		// the drawing is in the inbox and the turn stays answering until the frontend acks it (Answered, LandFailed):
		// the board is the drawer's until then, since the next turn needs the scene as it is once this one has landed
		d.publish(wshrpc.BoardUpdateData{Project: b.Project, BoardId: b.BoardId, What: UpdateAnswer, TurnId: turnId})
		<-landed
	}
}

// mustDraw is what a turn that may only be drawn is called in the failure that says it was not, or "" for the person's
// own ask, which the drawer may flag as a question.
func mustDraw(t wshrpc.BoardTurn) string {
	switch {
	case t.Kind == KindRequest:
		return "the agent's request"
	case t.From != "":
		return "the line you sent to be drawn"
	}
	return ""
}

// agentRead is what a turn read of the board's agent: handed to the drawer, and saved as the cursor once it ran.
type agentRead struct {
	tabId, title, text, sessionId string
	cursorTs                      int64
}

// readAgent reads what the board's agent said since the drawer last read it. An agent that can't be read (its tab
// is gone) costs the turn nothing: it is drawn without it, and the cursor stays.
func (d *Drawer) readAgent(ctx context.Context, b Board, agent *wshrpc.BoardAgent) agentRead {
	if agent == nil || d.d.ReadAgent == nil {
		return agentRead{}
	}
	read := agentRead{tabId: agent.TabId, title: agent.Title}
	text, sessionId, cursorTs, err := d.d.ReadAgent(ctx, *agent, agent.ReadTs)
	if err != nil {
		log.Printf("boarddrawer: reading agent %s for board %s: %v", agent.TabId, b.BoardId, err)
		return read
	}
	read.text, read.sessionId, read.cursorTs = text, sessionId, cursorTs
	return read
}

// answer runs one turn's session up to a checked answer: the drawing to deliver, or the question to forward.
func (d *Drawer) answer(ctx context.Context, b Board, talk wshrpc.BoardTalk, turn wshrpc.BoardTurn) (Answer, error) {
	file, err := d.d.ReadBoard(b)
	if err != nil {
		return Answer{}, errors.New(wontOpenHead + err.Error())
	}
	scene, err := SceneSummary(file, turn.SelectedIds)
	if err != nil {
		return Answer{}, errors.New(wontOpenHead + err.Error())
	}
	agent := d.readAgent(ctx, b, talk.Agent)
	ti := turnInput{
		Scene: scene, SelectedIds: turn.SelectedIds, DrawingId: turn.DrawingId, On: turn.On, Question: turn.Question,
		Request: turn.Kind == KindRequest, Context: turn.Context, Draw: turn.Kind == KindAsk && turn.From != "",
		AgentTitle: agent.title, AgentTurns: agent.text,
	}
	call := Call{SessionId: talk.SessionId, Resume: talk.SessionId != "", Prompt: turnPrompt(ti)}
	first := !call.Resume
	if first {
		call.Prompt = firstPrompt(firstInput{BoardName: b.Name, Briefing: boardBriefing(talk)}, ti)
		// saved only once the prompt is ready, so a turn that fails before the run leaves no session to resume, and
		// saved before the run, so a turn cut off by a restart still resumes
		call.SessionId = d.d.NewId()
		_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
			talk.SessionId, talk.ContextTokens = call.SessionId, 0
			return nil
		})
		if err != nil {
			return Answer{}, err
		}
	}
	out, err := d.d.Run(ctx, b.ProjectPath, call)
	if err == nil {
		d.recordRun(b, call.SessionId, out.ContextTokens, agent)
	}
	if err != nil && !first && strings.Contains(err.Error(), lostSessionText) {
		// nothing can ever resume it, so keeping it would fail every later turn: this one starts a new session
		d.dropSession(b, call.SessionId)
		talk.SessionId = ""
		return d.answer(ctx, b, talk, turn)
	}
	if err != nil {
		if first {
			// the session may never have started: the next turn starts it again rather than resume nothing
			d.dropSession(b, call.SessionId)
		}
		return Answer{}, err
	}
	if ctx.Err() != nil {
		return Answer{}, ctx.Err()
	}
	answer, err := checkAnswer(out.Text, scene, turn)
	if err == nil {
		return answer, nil
	}
	// One more go in the same session: the drawer reads why Arc refused its answer (13 words in a label, a reply that
	// is not one JSON object) and answers the same turn again. A second refusal fails the turn with its own reason; a
	// second run that fails leaves the first refusal as the reason.
	fix := Call{SessionId: call.SessionId, Resume: true, Prompt: fixPrompt(err.Error())}
	again, runErr := d.d.Run(ctx, b.ProjectPath, fix)
	if ctx.Err() != nil {
		return Answer{}, ctx.Err()
	}
	if runErr != nil {
		log.Printf("boarddrawer: board %s: the second go after a refused answer failed: %v", b.BoardId, runErr)
		return Answer{}, err
	}
	d.recordRun(b, call.SessionId, again.ContextTokens, agent)
	return checkAnswer(again.Text, scene, turn)
}

// checkAnswer is a reply read as the turn's answer: parsed against the scene, and routed (a turn that must be drawn
// may not come back as a question). Every error it returns is the reply's fault, so the drawer may be asked again.
func checkAnswer(reply string, scene Scene, turn wshrpc.BoardTurn) (Answer, error) {
	answer, err := ParseAnswer(reply, scene, turn.DrawingId, turn.Kind == KindRequest)
	if err != nil {
		return Answer{}, err
	}
	return routeAnswer(answer, mustDraw(turn))
}

// boardBriefing is what the board's first request told the drawer it is about, "" when the agent gave no context.
func boardBriefing(talk wshrpc.BoardTalk) string {
	for _, t := range talk.Turns {
		if strings.TrimSpace(t.Context) != "" {
			return t.Context
		}
	}
	return ""
}

// deliver puts a turn's drawing in the board's inbox. Its counts are saved on the turn first, so whoever sees the turn
// land finds them. Once the drawing is delivered a Stop is too late; a Stop that came before ends the turn instead.
func (d *Drawer) deliver(ctx context.Context, b Board, turn wshrpc.BoardTurn, a Answer) error {
	d.mu.Lock()
	if ctx.Err() != nil {
		d.mu.Unlock()
		return ctx.Err()
	}
	d.boards[keyOf(b)].delivered = true
	d.mu.Unlock()
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		t := findTurn(talk, turn.ID)
		if t == nil {
			return errors.New("the turn is gone from the board's talk")
		}
		t.Title, t.Added, t.Changed, t.Removed = a.Title, a.Added, a.Changed, a.Removed
		return nil
	})
	if err != nil {
		return err
	}
	delivered := wshrpc.BoardAnswer{
		ID: d.d.NewId(), Project: b.Project, BoardId: b.BoardId, TurnId: turn.ID,
		Add: a.Add, Update: a.Update, Remove: a.Remove, Title: a.Title, Ts: d.d.Now(),
	}
	// only an edit joins the frame it names (the one in view, or the one the agent's request picked): a new drawing
	// gets a frame of its own
	delivered.DrawingId = a.DrawingId
	if err = d.d.Deliver(delivered); err != nil {
		return fmt.Errorf("the drawer's answer could not be delivered: %w", err)
	}
	return nil
}

// recordRun keeps what a session that ran has seen: its context size, unless the talk moved to another session
// meanwhile, and the agent's cursor and current session, unless the board's agent changed.
func (d *Drawer) recordRun(b Board, sessionId string, tokens int, agent agentRead) {
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		if talk.SessionId == sessionId {
			talk.ContextTokens = tokens
		}
		if a := talk.Agent; a != nil && a.TabId == agent.tabId {
			a.ReadTs = max(a.ReadTs, agent.cursorTs)
			if agent.sessionId != "" {
				a.SessionId = agent.sessionId
			}
		}
		return nil
	})
	if err != nil {
		log.Printf("boarddrawer: recording the context of board %s: %v", b.BoardId, err)
	}
}

func (d *Drawer) dropSession(b Board, sessionId string) {
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		if talk.SessionId == sessionId {
			talk.SessionId, talk.ContextTokens = "", 0
		}
		return nil
	})
	if err != nil {
		log.Printf("boarddrawer: dropping session %s of board %s: %v", sessionId, b.BoardId, err)
	}
}

// finish saves a turn's end state and publishes it; false when it could not be saved.
func (d *Drawer) finish(b Board, turnId string, fn func(*wshrpc.BoardTurn)) bool {
	var turn wshrpc.BoardTurn
	_, err := d.d.UpdateTalk(b, func(talk *wshrpc.BoardTalk) error {
		t := findTurn(talk, turnId)
		if t == nil {
			return errors.New("the turn is gone from the board's talk")
		}
		fn(t)
		turn = *t
		return nil
	})
	if err != nil {
		log.Printf("boarddrawer: saving turn %s of board %s: %v", turnId, b.BoardId, err)
		return false
	}
	d.publishTurn(b, turn)
	return true
}

// failTurn ends a turn failed: nothing it drew is on the board.
func failTurn(t *wshrpc.BoardTurn, reason string) {
	t.State, t.Reason = StateFailed, reason
	clearDrawing(t)
}

// clearDrawing forgets what a turn's drawing was.
func clearDrawing(t *wshrpc.BoardTurn) {
	t.Title, t.Added, t.Changed, t.Removed, t.ShapeIds = "", 0, 0, 0, nil
}

// landed releases the board's running turn from waiting for its drawing, once turnId is the turn it runs.
func (d *Drawer) landed(b Board, turnId string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	run := d.boards[keyOf(b)]
	if run == nil || run.turnId != turnId {
		return
	}
	select {
	case <-run.landed:
	default:
		close(run.landed)
	}
}

// watch is the channel the next change to one of the board's turns closes.
func (d *Drawer) watch(b Board) <-chan struct{} {
	d.mu.Lock()
	defer d.mu.Unlock()
	ch, ok := d.changed[keyOf(b)]
	if !ok {
		ch = make(chan struct{})
		d.changed[keyOf(b)] = ch
	}
	return ch
}

func (d *Drawer) notify(b Board) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if ch, ok := d.changed[keyOf(b)]; ok {
		close(ch)
		delete(d.changed, keyOf(b))
	}
}

// publishTurn tells the frontend a turn changed and wakes whoever waits on it. Called once the change is saved.
func (d *Drawer) publishTurn(b Board, t wshrpc.BoardTurn) {
	d.publish(wshrpc.BoardUpdateData{Project: b.Project, BoardId: b.BoardId, What: UpdateTalk, TurnId: t.ID, State: t.State, Reason: t.Reason})
	d.notify(b)
}

func (d *Drawer) publish(u wshrpc.BoardUpdateData) {
	if d.d.Publish != nil {
		d.d.Publish(u)
	}
}

func findTurn(talk *wshrpc.BoardTalk, turnId string) *wshrpc.BoardTurn {
	for i := range talk.Turns {
		if talk.Turns[i].ID == turnId {
			return &talk.Turns[i]
		}
	}
	return nil
}
