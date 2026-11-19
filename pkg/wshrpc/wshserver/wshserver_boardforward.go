// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/boarddrawer"
	"github.com/wavetermdev/waveterm/pkg/boardforward"
	"github.com/wavetermdev/waveterm/pkg/boardstore"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const reasonAgentGone = "%s is no longer a live agent"

var errNoSuchTurn = errors.New("this board has no such turn")

// errNotPending ends a talk update that finds the forward already moved on: nothing is written.
var errNotPending = errors.New("the forward is no longer in the state this step expected")

// forwardBoardTurn is what the drawer calls once a turn is saved as forwarded, and what a reroute calls for the turn it
// makes. It returns at once: delivery wakes a sleeping agent and waits for it to report in, and the board stays busy
// for as long as the drawer's goroutine is in here. A var so a test can swap it.
var forwardBoardTurn = func(b boarddrawer.Board, turnId string) {
	boardForwards.async(func() { boardForwards.forward(context.Background(), b, turnId) })
}

// pendingForward is a forward still on its way: held for its agent to be free, or sent and waiting for its reply.
type pendingForward struct{ project, boardId, turnId string }

// boardForwarder moves forwards along as their agents report. It indexes the pending ones by the agent tab they wait
// on, in memory, rebuilt from the talk files on first use, so a wavesrv restart loses none. A board's agent never
// changes, so a forward's tab is its talk's agent.
type boardForwarder struct {
	mu      sync.Mutex
	loaded  bool
	pending map[pendingForward]string // forward -> the agent tab it waits on
	sending map[pendingForward]bool   // being delivered now: one delivery per forward
	work    sync.WaitGroup            // goroutines in flight, which a test waits on
}

// boardForwards is the one forwarder. A var so a test can drop its index, as a restart does.
var boardForwards = &boardForwarder{}

// async runs fn off the caller's goroutine: the caller is the drawer's turn, or the status event being published.
func (f *boardForwarder) async(fn func()) {
	f.work.Go(fn)
}

func forwardPending(fw *wshrpc.BoardForward) bool {
	return fw != nil && (fw.State == boarddrawer.ForwardWaiting || fw.State == boarddrawer.ForwardSent)
}

// ensureLoaded rebuilds the index from every project's talks, once.
func (f *boardForwarder) ensureLoaded() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.loaded {
		return
	}
	if f.pending == nil {
		f.pending = map[pendingForward]string{}
	}
	dirs, err := boardstore.ProjectDirs()
	if err != nil {
		log.Printf("board forwards: listing the project folders: %v\n", err)
		return
	}
	for _, dir := range dirs {
		boards, err := boardstore.List(dir, "", nil)
		if err != nil {
			log.Printf("board forwards: listing %s: %v\n", dir, err)
			return // not loaded: the next call tries again
		}
		for _, info := range boards {
			if info.Turns == 0 {
				continue
			}
			talk, err := boardstore.ReadTalk(dir, info.ID)
			if err != nil || talk.Agent == nil || talk.Project == "" {
				continue
			}
			for _, t := range talk.Turns {
				if forwardPending(t.Forward) {
					f.pending[pendingForward{talk.Project, info.ID, t.ID}] = talk.Agent.TabId
				}
			}
		}
	}
	f.loaded = true
}

func (f *boardForwarder) track(p pendingForward, tabId string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.pending == nil {
		f.pending = map[pendingForward]string{}
	}
	f.pending[p] = tabId
}

func (f *boardForwarder) untrack(p pendingForward) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.pending, p)
}

// pendingOn is the forwards waiting on tabId.
func (f *boardForwarder) pendingOn(tabId string) []pendingForward {
	f.mu.Lock()
	defer f.mu.Unlock()
	var ps []pendingForward
	for p, tab := range f.pending {
		if tab == tabId {
			ps = append(ps, p)
		}
	}
	return ps
}

// mayHavePending is false only once the index is loaded and empty: the status event that finds it so does nothing.
func (f *boardForwarder) mayHavePending() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return !f.loaded || len(f.pending) > 0
}

// claim takes the right to deliver p, false when another goroutine has it.
func (f *boardForwarder) claim(p pendingForward) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.sending[p] {
		return false
	}
	if f.sending == nil {
		f.sending = map[pendingForward]bool{}
	}
	f.sending[p] = true
	return true
}

func (f *boardForwarder) release(p pendingForward) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.sending, p)
}

// forward sends a turn the drawer flagged, or a reroute made, to the board's agent: typed in when the agent is free
// (a sleeping one is woken, one mid-turn takes it after that turn), held while the agent has a question or permission
// prompt open, and agentgone when its tab is closed. A turn already on its way is left alone.
func (f *boardForwarder) forward(ctx context.Context, b boarddrawer.Board, turnId string) {
	f.ensureLoaded()
	talk, t, ok := readBoardTalkTurn(b, turnId)
	if !ok || t.State != boarddrawer.StateForwarded || t.Forward == nil || t.Forward.State != boarddrawer.ForwardWaiting {
		return
	}
	if talk.Agent == nil {
		f.gone(b, turnId, "this board has no agent")
		return
	}
	_, rows, err := boardRoster(ctx)
	if err != nil {
		log.Printf("board %s: forwarding turn %s: %v\n", b.BoardId, turnId, err)
		return
	}
	row := agentRowByTab(rows, talk.Agent.TabId)
	if row == nil {
		f.gone(b, turnId, fmt.Sprintf(reasonAgentGone, talk.Agent.Title))
		return
	}
	f.track(pendingForward{b.Project, b.BoardId, turnId}, row.TabId)
	if row.State == wshrpc.AgentsState_Asking {
		return // typed text would answer its open prompt: agentStatus sends it once the prompt is answered
	}
	f.send(ctx, b, rows, row, turnId)
}

// send types a waiting forward into its agent's session and marks it sent. A delivery that fails (the agent was killed,
// a sleeper would not wake) ends it agentgone with the error as the reason: the question stays on the turn, and
// sending it the other way still draws it.
func (f *boardForwarder) send(ctx context.Context, b boarddrawer.Board, rows []agentRow, row *agentRow, turnId string) {
	p := pendingForward{b.Project, b.BoardId, turnId}
	if !f.claim(p) {
		return
	}
	defer f.release(p)
	// read again under the claim: a delivery that finished while this one waited has marked it sent
	_, t, ok := readBoardTalkTurn(b, turnId)
	if !ok || t.Forward == nil || t.Forward.State != boarddrawer.ForwardWaiting {
		return
	}
	if err := deliverToAgent(ctx, rows, row, boardforward.Marker(b.Name, t.On, t.ID, t.Question), nil); err != nil {
		f.gone(b, turnId, err.Error())
		return
	}
	f.update(b, turnId, boarddrawer.ForwardWaiting, func(fw *wshrpc.BoardForward) {
		fw.State, fw.SentTs, fw.Reason = boarddrawer.ForwardSent, time.Now().UnixMilli(), ""
	})
}

// gone ends a waiting forward agentgone.
func (f *boardForwarder) gone(b boarddrawer.Board, turnId, reason string) {
	f.untrack(pendingForward{b.Project, b.BoardId, turnId})
	f.update(b, turnId, boarddrawer.ForwardWaiting, func(fw *wshrpc.BoardForward) {
		fw.State, fw.Reason = boarddrawer.ForwardAgentGone, reason
	})
}

// update changes a forward that is still in state from, under the store's lock, and publishes the turn. A forward that
// moved on meanwhile is left as it is.
func (f *boardForwarder) update(b boarddrawer.Board, turnId, from string, fn func(*wshrpc.BoardForward)) bool {
	turn, err := updateBoardTurn(b, turnId, func(t *wshrpc.BoardTurn) error {
		if t.Forward == nil || t.Forward.State != from {
			return errNotPending
		}
		fn(t.Forward)
		return nil
	})
	if err != nil {
		if !errors.Is(err, errNotPending) {
			log.Printf("board %s: moving the forward of turn %s: %v\n", b.BoardId, turnId, err)
		}
		return false
	}
	publishBoardTurn(b, turn)
	return true
}

// agentStatus moves the forwards waiting on the agent behind oref: a held one goes once the agent is not asking, and
// at its turn end a sent one takes the reply its transcript holds.
func (f *boardForwarder) agentStatus(ctx context.Context, oref waveobj.ORef) {
	f.ensureLoaded()
	if !f.mayHavePending() {
		return
	}
	_, rows, err := boardRoster(ctx)
	if err != nil {
		log.Printf("board forwards: reading the agents: %v\n", err)
		return
	}
	row := findBoardStatusRow(rows, oref)
	if row == nil || row.State == wshrpc.AgentsState_Asking {
		return
	}
	for _, p := range f.pendingOn(row.TabId) {
		f.advance(ctx, rows, row, p)
	}
}

// findBoardStatusRow is the roster row an agent:status report is about.
func findBoardStatusRow(rows []agentRow, oref waveobj.ORef) *agentRow {
	i := slices.IndexFunc(rows, func(r agentRow) bool {
		return (oref.OType == waveobj.OType_Block && r.blockId == oref.OID) || (oref.OType == waveobj.OType_Tab && r.TabId == oref.OID)
	})
	if i < 0 {
		return nil
	}
	return &rows[i]
}

func (f *boardForwarder) advance(ctx context.Context, rows []agentRow, row *agentRow, p pendingForward) {
	b, _, err := boardOf(p.project, p.boardId)
	if err != nil {
		log.Printf("board %s: its forward of turn %s waits on a board that won't load: %v\n", p.boardId, p.turnId, err)
		f.untrack(p)
		return
	}
	talk, t, ok := readBoardTalkTurn(b, p.turnId)
	if !ok || !forwardPending(t.Forward) || talk.Agent == nil || talk.Agent.TabId != row.TabId {
		f.untrack(p)
		return
	}
	if t.Forward.State == boarddrawer.ForwardWaiting {
		f.send(ctx, b, rows, row, p.turnId)
		return
	}
	// sent: the reply is read at the turn's end, a sleeping agent's turn is over too
	if row.State != wshrpc.AgentsState_Idle && row.State != wshrpc.AgentsState_Sleeping {
		return
	}
	reply, replyTs, ok := agentReply(ctx, row, t)
	if !ok {
		return
	}
	if f.update(b, p.turnId, boarddrawer.ForwardSent, func(fw *wshrpc.BoardForward) {
		fw.State, fw.Reply, fw.ReplyTs = boarddrawer.ForwardReplied, reply, replyTs
	}) {
		f.untrack(p)
	}
}

// agentReply is the agent's reply to t's forward, read from its transcript. Reading it is no model call.
func agentReply(ctx context.Context, row *agentRow, t wshrpc.BoardTurn) (string, int64, bool) {
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil {
		log.Printf("board forwards: finding %s's transcript: %v\n", row.TabId, err)
	}
	if tpath == "" {
		return "", 0, false
	}
	// the forward is typed after its turn was made, so nothing before the turn can hold its reply
	return boardforward.ReplyAfter(agentsessions.TurnsSince(tpath, row.Harness, t.Ts), t.ID)
}

// noteBoardForwardStatus hands every agent status event to the forwarder, off the publishing goroutine: delivering a
// forward may wake an agent, and the wake waits on the very events being published. A usage-only report carries no
// state.
func noteBoardForwardStatus(ev *wps.WaveEvent) {
	// events arrive over the RPC wire with Data as a raw JSON map, so decode rather than assert.
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil || data.State == "" || !boardForwards.mayHavePending() {
		return
	}
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil {
		return
	}
	boardForwards.async(func() { boardForwards.agentStatus(context.Background(), oref) })
}

// updateBoardTurn changes one turn of a board's talk under the store's lock and returns it as saved.
func updateBoardTurn(b boarddrawer.Board, turnId string, fn func(*wshrpc.BoardTurn) error) (wshrpc.BoardTurn, error) {
	var saved wshrpc.BoardTurn
	_, err := boardstore.UpdateTalk(boardstore.ProjectDir(b.Project), b.BoardId, func(talk *wshrpc.BoardTalk) error {
		i := slices.IndexFunc(talk.Turns, func(t wshrpc.BoardTurn) bool { return t.ID == turnId })
		if i < 0 {
			return errNoSuchTurn
		}
		if err := fn(&talk.Turns[i]); err != nil {
			return err
		}
		saved = talk.Turns[i]
		return nil
	})
	return saved, err
}

// readBoardTalkTurn is a board's talk and one of its turns; false when either cannot be read.
func readBoardTalkTurn(b boarddrawer.Board, turnId string) (wshrpc.BoardTalk, wshrpc.BoardTurn, bool) {
	talk, err := boardstore.ReadTalk(boardstore.ProjectDir(b.Project), b.BoardId)
	if err != nil {
		log.Printf("board %s: reading its talk for turn %s: %v\n", b.BoardId, turnId, err)
		return wshrpc.BoardTalk{}, wshrpc.BoardTurn{}, false
	}
	i := slices.IndexFunc(talk.Turns, func(t wshrpc.BoardTurn) bool { return t.ID == turnId })
	if i < 0 {
		return wshrpc.BoardTalk{}, wshrpc.BoardTurn{}, false
	}
	return talk, talk.Turns[i], true
}
