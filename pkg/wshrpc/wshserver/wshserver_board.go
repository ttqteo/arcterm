// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/boarddrawer"
	"github.com/wavetermdev/waveterm/pkg/boardstore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// nothing but this line checks that the wshserver implements every board command
var _ wshrpc.BoardCommands = (*WshServer)(nil)

const (
	errAgentEnded       = "the agent ended, so you can't ask here"
	boardAnsweringState = "answering" // BoardInfo.State while the drawer runs a turn on the board
)

// boardDrawer runs every board's turns. A var so tests swap in one with its own state.
var boardDrawer = newBoardDrawer()

// newBoardDrawer wires the drawer to the store, the roster and the board:update event. The model run is looked up at
// each call, so a test replaces boarddrawer.RunModel without making a drawer of its own.
func newBoardDrawer() *boarddrawer.Drawer {
	dirOf := func(b boarddrawer.Board) string { return boardstore.ProjectDir(b.Project) }
	// a board made before its talk was written has no talk file, and ReadTalk fills only its id
	withProject := func(b boarddrawer.Board, talk *wshrpc.BoardTalk) {
		if talk.Project == "" {
			talk.Project = b.Project
		}
	}
	return boarddrawer.New(boarddrawer.Deps{
		LoadTalk: func(b boarddrawer.Board) (wshrpc.BoardTalk, error) {
			talk, err := boardstore.ReadTalk(dirOf(b), b.BoardId)
			withProject(b, &talk)
			return talk, err
		},
		UpdateTalk: func(b boarddrawer.Board, fn func(*wshrpc.BoardTalk) error) (wshrpc.BoardTalk, error) {
			return boardstore.UpdateTalk(dirOf(b), b.BoardId, func(talk *wshrpc.BoardTalk) error {
				withProject(b, talk)
				return fn(talk)
			})
		},
		ReadBoard: func(b boarddrawer.Board) ([]byte, error) {
			rtn, err := boardstore.Read(dirOf(b), b.Project, b.BoardId)
			if err != nil {
				return nil, err
			}
			return []byte(rtn.Data), nil
		},
		ReadAgent: readBoardAgent,
		Deliver:   func(a wshrpc.BoardAnswer) error { return boardstore.PutAnswer(boardstore.ProjectDir(a.Project), a) },
		Publish:   publishBoardUpdate,
		Forward:   func(b boarddrawer.Board, turnId string) { forwardBoardTurn(b, turnId) },
		Run: func(ctx context.Context, cwd string, c boarddrawer.Call) (boarddrawer.Reply, error) {
			return boarddrawer.RunModel(ctx, cwd, c)
		},
	})
}

func publishBoardUpdate(u wshrpc.BoardUpdateData) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_BoardUpdate, Data: u})
}

// publishBoardList tells the frontend a board came, or its file changed. The drawer publishes the talk's changes.
func publishBoardList(project, boardId string) {
	publishBoardUpdate(wshrpc.BoardUpdateData{Project: project, BoardId: boardId, What: boarddrawer.UpdateList})
}

func publishBoardTurn(b boarddrawer.Board, t wshrpc.BoardTurn) {
	publishBoardUpdate(wshrpc.BoardUpdateData{Project: b.Project, BoardId: b.BoardId, What: boarddrawer.UpdateTalk, TurnId: t.ID, State: t.State, Reason: t.Reason})
}

// boardDir is a project's board folder.
func boardDir(project string) (string, error) {
	if strings.TrimSpace(project) == "" {
		return "", errors.New("project is required")
	}
	return boardstore.ProjectDir(project), nil
}

// boardOf resolves a board for the drawer, without the folder its drawer runs in. A board whose file will not parse
// still resolves, with its LoadError, so its talk shows; a missing one does not.
func boardOf(project, boardId string) (boarddrawer.Board, wshrpc.BoardInfo, error) {
	if !boardstore.ValidID(boardId) {
		return boarddrawer.Board{}, wshrpc.BoardInfo{}, fmt.Errorf("invalid board id %q", boardId)
	}
	dir, err := boardDir(project)
	if err != nil {
		return boarddrawer.Board{}, wshrpc.BoardInfo{}, err
	}
	rtn, err := boardstore.Read(dir, project, boardId)
	if rtn.Info.ID == "" {
		return boarddrawer.Board{}, wshrpc.BoardInfo{}, err
	}
	return boarddrawer.Board{Project: project, BoardId: boardId, Name: rtn.Info.Name}, rtn.Info, nil
}

// boardRoster is the live agents and what the roster read about them.
func boardRoster(ctx context.Context) (*agentRosterFacts, []agentRow, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, nil, err
	}
	return facts, buildAgentRoster(facts), nil
}

func agentRowByTab(rows []agentRow, tabId string) *agentRow {
	for i := range rows {
		if rows[i].TabId == tabId {
			return &rows[i]
		}
	}
	return nil
}

// boardAgentRow is the roster row of the agent a board is tied to, nil when it has none or its tab is gone.
func boardAgentRow(rows []agentRow, agent *wshrpc.BoardAgent) *agentRow {
	if agent == nil {
		return nil
	}
	return agentRowByTab(rows, agent.TabId)
}

// boardFolder is where a board's drawer runs: the project folder its live agent works in, else the folder of the
// registered project of that name, which is what an ended agent's board has left.
func boardFolder(facts *agentRosterFacts, rows []agentRow, project string, agent *wshrpc.BoardAgent) (string, error) {
	if row := boardAgentRow(rows, agent); row != nil && row.ProjectPath != "" {
		return row.ProjectPath, nil
	}
	for _, ch := range facts.Channels {
		if strings.EqualFold(ch.Name, project) && ch.ProjectPath != "" {
			return ch.ProjectPath, nil
		}
	}
	return "", fmt.Errorf("the folder of project %q is not known: its agent ended and no registered project has that name", project)
}

// boardToRun is a board ready for a command that starts a drawer turn: its file opens, and it carries the folder its
// drawer runs in. With needLiveAgent, a board whose agent's tab is gone is refused before anything else.
func boardToRun(ctx context.Context, project, boardId string, needLiveAgent bool) (boarddrawer.Board, error) {
	b, info, err := boardOf(project, boardId)
	if err != nil {
		return b, err
	}
	if info.LoadError != "" {
		return b, fmt.Errorf("the board's file won't open: %s", info.LoadError)
	}
	talk, err := boardstore.ReadTalk(boardstore.ProjectDir(project), boardId)
	if err != nil {
		return b, err
	}
	facts, rows, err := boardRoster(ctx)
	if err != nil {
		return b, err
	}
	if needLiveAgent && boardAgentRow(rows, talk.Agent) == nil {
		return b, errors.New(errAgentEnded)
	}
	b.ProjectPath, err = boardFolder(facts, rows, project, talk.Agent)
	return b, err
}

func (ws *WshServer) BoardListCommand(ctx context.Context, data wshrpc.CommandBoardListData) (*wshrpc.BoardListRtnData, error) {
	var boards []wshrpc.BoardInfo
	if project := strings.TrimSpace(data.Project); project != "" {
		var err error
		if boards, err = boardstore.List(boardstore.ProjectDir(project), project, nil); err != nil {
			return nil, err
		}
	} else {
		dirs, err := boardstore.ProjectDirs()
		if err != nil {
			return nil, err
		}
		boards = []wshrpc.BoardInfo{}
		for _, dir := range dirs {
			more, err := boardstore.List(dir, "", nil)
			if err != nil {
				return nil, err
			}
			boards = append(boards, more...)
		}
		sort.SliceStable(boards, func(i, j int) bool {
			if boards[i].ActiveTs != boards[j].ActiveTs {
				return boards[i].ActiveTs > boards[j].ActiveTs
			}
			return boards[i].ID < boards[j].ID
		})
	}
	// the store knows only the talk: a board the drawer is busy on lists answering, not failed (which is what a turn
	// left answering reads as when nothing runs it). The row's project is known here however the list was asked for,
	// which the store's per-board callback does not get.
	for i := range boards {
		if boardDrawer.Busy(boarddrawer.Board{Project: boards[i].Project, BoardId: boards[i].ID}) {
			boards[i].State = boardAnsweringState
		}
	}
	return &wshrpc.BoardListRtnData{Boards: boards}, nil
}

func (ws *WshServer) BoardReadCommand(ctx context.Context, data wshrpc.CommandBoardRefData) (*wshrpc.BoardReadRtnData, error) {
	if !boardstore.ValidID(data.BoardId) {
		return nil, fmt.Errorf("invalid board id %q", data.BoardId)
	}
	dir, err := boardDir(data.Project)
	if err != nil {
		return nil, err
	}
	rtn, err := boardstore.Read(dir, data.Project, data.BoardId)
	if err != nil {
		return nil, err
	}
	return &rtn, nil
}

func (ws *WshServer) BoardSaveCommand(ctx context.Context, data wshrpc.CommandBoardSaveData) (*wshrpc.BoardSaveRtnData, error) {
	if !boardstore.ValidID(data.BoardId) {
		return nil, fmt.Errorf("invalid board id %q", data.BoardId)
	}
	dir, err := boardDir(data.Project)
	if err != nil {
		return nil, err
	}
	rtn, err := boardstore.Save(dir, data.BoardId, data.Data, data.BaseRev)
	if err != nil {
		return nil, err
	}
	if !rtn.Conflict {
		publishBoardList(data.Project, data.BoardId)
	}
	return &rtn, nil
}

func (ws *WshServer) BoardTalkCommand(ctx context.Context, data wshrpc.CommandBoardRefData) (*wshrpc.BoardTalk, error) {
	b, _, err := boardOf(data.Project, data.BoardId)
	if err != nil {
		return nil, err
	}
	talk, err := boardDrawer.Talk(b)
	if err != nil {
		return nil, err
	}
	return &talk, nil
}

// BoardAskCommand is the person's line on the board: drawn, or flagged and forwarded to the board's agent. It is
// refused once that agent's tab is gone.
func (ws *WshServer) BoardAskCommand(ctx context.Context, data wshrpc.CommandBoardAskData) error {
	question := strings.TrimSpace(data.Question)
	if question == "" {
		return errors.New("type a question first")
	}
	b, err := boardToRun(ctx, data.Project, data.BoardId, true)
	if err != nil {
		return err
	}
	_, err = boardDrawer.Ask(b, wshrpc.BoardTurn{Kind: boarddrawer.KindAsk, Question: question, On: data.On, SelectedIds: data.SelectedIds})
	return err
}

func (ws *WshServer) BoardAskStopCommand(ctx context.Context, data wshrpc.CommandBoardRefData) error {
	b, _, err := boardOf(data.Project, data.BoardId)
	if err != nil {
		return err
	}
	return boardDrawer.Stop(b)
}

func (ws *WshServer) BoardAskRetryCommand(ctx context.Context, data wshrpc.CommandBoardTurnData) error {
	b, err := boardToRun(ctx, data.Project, data.BoardId, false)
	if err != nil {
		return err
	}
	return boardDrawer.Retry(b, data.TurnId)
}

// BoardRerouteCommand sends a turn the other way as a new turn naming it, leaving it as it was: a drawn turn of yours
// goes to the agent at once, a forwarded one goes to the drawer to be drawn.
func (ws *WshServer) BoardRerouteCommand(ctx context.Context, data wshrpc.CommandBoardTurnData) error {
	b, _, err := boardOf(data.Project, data.BoardId)
	if err != nil {
		return err
	}
	_, t, ok := readBoardTalkTurn(b, data.TurnId)
	switch {
	case !ok:
		return errNoSuchTurn
	case t.Kind == boarddrawer.KindRequest:
		return errors.New("an agent's own request is not sent the other way")
	case t.State == boarddrawer.StateForwarded:
		// drawn instead, as a line the drawer may not flag back; the forward stays as it was, and an ended agent
		// does not stop it
		if b, err = boardToRun(ctx, data.Project, data.BoardId, false); err != nil {
			return err
		}
		_, err = boardDrawer.Ask(b, wshrpc.BoardTurn{Kind: boarddrawer.KindAsk, Question: t.Question, On: t.On, SelectedIds: t.SelectedIds, From: t.ID})
		return err
	case t.State == boarddrawer.StateAnswered:
		return rerouteToAgent(b, t)
	}
	return fmt.Errorf("only a drawn or forwarded turn can be sent the other way, and this one is %s", t.State)
}

// rerouteToAgent sends a drawn line to the agent instead: a new forwarded turn, which no drawer run is part of.
func rerouteToAgent(b boarddrawer.Board, t wshrpc.BoardTurn) error {
	now := time.Now().UnixMilli()
	sent := wshrpc.BoardTurn{
		ID: uuid.NewString(), Ts: now, Kind: boarddrawer.KindAsk, Question: t.Question, On: t.On, SelectedIds: t.SelectedIds,
		State: boarddrawer.StateForwarded, AnsweredTs: now, From: t.ID, Forward: &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting},
	}
	_, err := boardstore.UpdateTalk(boardstore.ProjectDir(b.Project), b.BoardId, func(talk *wshrpc.BoardTalk) error {
		talk.Turns = append(talk.Turns, sent)
		return nil
	})
	if err != nil {
		return err
	}
	publishBoardTurn(b, sent)
	forwardBoardTurn(b, sent.ID)
	return nil
}

func (ws *WshServer) BoardAnswerInboxCommand(ctx context.Context, data wshrpc.CommandBoardRefData) ([]wshrpc.BoardAnswer, error) {
	if !boardstore.ValidID(data.BoardId) {
		return nil, fmt.Errorf("invalid board id %q", data.BoardId)
	}
	dir, err := boardDir(data.Project)
	if err != nil {
		return nil, err
	}
	return boardstore.Answers(dir, data.BoardId)
}

// BoardAnswerAckCommand is the frontend's word that a drawing landed on the board, or could not: the answer leaves the
// inbox either way, and the turn ends answered, or failed with the error. The board stays busy until this arrives, so
// it asks nothing of the board's file: an answer for a board whose file is gone fails its turn all the same.
func (ws *WshServer) BoardAnswerAckCommand(ctx context.Context, data wshrpc.CommandBoardAnswerAckData) error {
	if !boardstore.ValidID(data.BoardId) {
		return fmt.Errorf("invalid board id %q", data.BoardId)
	}
	if data.TurnId == "" {
		return errors.New("turnid is required")
	}
	dir, err := boardDir(data.Project)
	if err != nil {
		return err
	}
	if err := boardstore.AckAnswer(dir, data.BoardId, data.AnswerId); err != nil {
		return err
	}
	b := boarddrawer.Board{Project: data.Project, BoardId: data.BoardId}
	if data.Error != "" {
		return boardDrawer.LandFailed(b, data.TurnId, data.Error)
	}
	return boardDrawer.Answered(b, data.TurnId, data.ShapeIds)
}
