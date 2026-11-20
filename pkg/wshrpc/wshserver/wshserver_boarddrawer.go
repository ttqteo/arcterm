// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/boarddrawer"
	"github.com/wavetermdev/waveterm/pkg/boardstore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	errClaudeOnly = "boards are for Claude agents"
	errNeedsText  = "pass --ask, or --context to brief a new board"

	// boardAgentReadRunes caps what one drawer turn reads of its agent: the newest words, since what a line asks about
	// is the latest. A long stretch between two reads, or the first read of a long session, would otherwise put the
	// whole talk in the drawer's prompt.
	boardAgentReadRunes = 30000
	boardAgentCutMark   = "[earlier part cut]\n"

	boardStoppedReason   = "the drawer was stopped before it finished"
	boardForwardedReason = "the drawer flagged the request as a question instead of drawing it"
)

// boardDrawWait is how long `wsh board draw` waits for its turn. Claude's Bash tool caps a call at 10 minutes; past
// this the command returns "still drawing" and the board's card in Chat shows the drawing when it lands. A var so tests
// shorten it.
var boardDrawWait = 9 * time.Minute

// boardCreate serializes find-or-create: Create does not look for a board of that name, so two requests for one new
// name that arrive together would each make one.
var boardCreate sync.Mutex

// BoardAgentDrawCommand is `wsh board draw`: an agent's request to the drawer of a board named in its project, which
// its briefing makes when the project has none of that name. It returns once the turn is over: drawn (the frontend
// landed the drawing and acked it) or failed, or "answering" when the wait ran out.
func (ws *WshServer) BoardAgentDrawCommand(ctx context.Context, data wshrpc.CommandBoardAgentDrawData) (*wshrpc.BoardAgentDrawRtnData, error) {
	name := strings.TrimSpace(data.Board)
	if data.BlockId == "" || name == "" {
		return nil, errors.New("a block id and a board name are required")
	}
	brief, ask := strings.TrimSpace(data.Context), strings.TrimSpace(data.Ask)
	if brief == "" && ask == "" {
		return nil, errors.New(errNeedsText)
	}
	facts, rows, err := boardRoster(ctx)
	if err != nil {
		return nil, err
	}
	row, err := boardCaller(facts, rows, data.BlockId)
	if err != nil {
		return nil, err
	}
	info, created, took, err := findOrCreateBoard(row, rows, name, brief)
	if err != nil {
		return nil, err
	}
	if info.LoadError != "" {
		return nil, fmt.Errorf("board %q won't open: %s", info.Name, info.LoadError)
	}
	if created || took {
		// a new board, or one taken over: the list shows it beside this agent's Chat
		publishBoardList(row.Project, info.ID)
	}
	b := boarddrawer.Board{Project: row.Project, BoardId: info.ID, Name: info.Name, ProjectPath: row.ProjectPath}
	turn, err := boardDrawer.Ask(b, wshrpc.BoardTurn{Kind: boarddrawer.KindRequest, Question: ask, Context: brief})
	if err != nil {
		return nil, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, boardDrawWait)
	defer cancel()
	end, err := boardDrawer.Wait(waitCtx, b, turn.ID)
	if err != nil {
		return nil, err
	}
	return boardDrawResult(b, created, end), nil
}

// boardDrawResult is what became of a request, in BoardAgentDrawRtnData's states: a turn the wait left unfinished is
// still answering.
func boardDrawResult(b boarddrawer.Board, created bool, end wshrpc.BoardTurn) *wshrpc.BoardAgentDrawRtnData {
	rtn := &wshrpc.BoardAgentDrawRtnData{BoardId: b.BoardId, BoardName: b.Name, Project: b.Project, Created: created}
	switch end.State {
	case boarddrawer.StateAnswered:
		rtn.State, rtn.Added, rtn.Changed, rtn.Removed = boarddrawer.StateAnswered, end.Added, end.Changed, end.Removed
	case boarddrawer.StateFailed:
		rtn.State, rtn.Reason = boarddrawer.StateFailed, end.Reason
	case boarddrawer.StateStopped:
		rtn.State, rtn.Reason = boarddrawer.StateFailed, boardStoppedReason
	case boarddrawer.StateForwarded: // a request is never flagged back; the drawer fails it first
		rtn.State, rtn.Reason = boarddrawer.StateFailed, boardForwardedReason
	default:
		rtn.State = boarddrawer.StateAnswering
	}
	return rtn
}

// boardCaller is the roster row of the agent that ran `wsh board draw` in blockId. A harness other than claude, and a
// folder no registered project holds, are refused: a board needs a claude transcript to read and a registered project
// to be listed under.
func boardCaller(facts *agentRosterFacts, rows []agentRow, blockId string) (*agentRow, error) {
	i := slices.IndexFunc(facts.Tabs, func(tf agentTabFacts) bool { return slices.Contains(tf.Tab.BlockIds, blockId) })
	if i < 0 {
		return nil, fmt.Errorf("block %s is in no tab, so it is not an agent's terminal", blockId)
	}
	tf := facts.Tabs[i]
	row := agentRowByTab(rows, tf.Tab.OID)
	switch {
	case row == nil && tf.Status.Agent != "" && tf.Status.Agent != "claude":
		return nil, errors.New(errClaudeOnly) // a harness the roster leaves out, a codex agent
	case row == nil:
		return nil, fmt.Errorf("block %s is not a live agent session", blockId)
	case row.Harness != "claude":
		return nil, errors.New(errClaudeOnly)
	case wstore.MatchChannelAtPath(facts.Channels, row.ProjectPath) == nil:
		// row.Project alone is not enough: the roster falls back to the folder's basename for an unregistered folder,
		// and a board keyed by that name could not be listed or retried once its agent ended.
		return nil, fmt.Errorf("%s is not in a registered project", row.Name)
	}
	return row, nil
}

// boardAgentTitle names an agent as its tab does, else by its harness and project.
func boardAgentTitle(row *agentRow) string {
	if name := strings.TrimSpace(row.Name); name != "" {
		return name
	}
	return row.Harness + " · " + row.Project
}

// findOrCreateBoard is the board named name in the agent's project, and whether this call made it: a new board needs
// the briefing, and is tied to this agent. A board that exists keeps its tie while its agent's tab is in the roster,
// whoever asks; once that tab is gone (the agent ended, its tab closed or deleted) the asking agent takes the board
// over (took), so a board outlives the agent that drew it. Its first read of the agent starts at the beginning of the session
// (the read is capped), so "draw what we just discussed" has the discussion.
func findOrCreateBoard(row *agentRow, rows []agentRow, name, brief string) (info wshrpc.BoardInfo, created, took bool, err error) {
	boardCreate.Lock()
	defer boardCreate.Unlock()
	dir := boardstore.ProjectDir(row.Project)
	info, found, err := boardstore.FindByName(dir, row.Project, name)
	if err != nil {
		return info, false, false, err
	}
	if found {
		if info.LoadError != "" || info.AgentTabId == row.TabId || agentRowByTab(rows, info.AgentTabId) != nil {
			return info, false, false, nil
		}
		info, err = takeOverBoard(dir, info, row)
		return info, false, err == nil, err
	}
	agent := boardAgentOf(row)
	if brief == "" {
		return wshrpc.BoardInfo{}, false, false, fmt.Errorf("there is no board %q in %s: pass the briefing with --context to make it", name, row.Project)
	}
	info, err = boardstore.Create(dir, row.Project, name, agent, time.Now().UnixMilli())
	return info, err == nil, false, err
}

// boardAgentOf is the tie a board keeps to row's agent: its first read starts at the beginning of the session.
func boardAgentOf(row *agentRow) wshrpc.BoardAgent {
	return wshrpc.BoardAgent{TabId: row.TabId, Title: boardAgentTitle(row), SessionId: row.status.SessionID}
}

// takeOverBoard ties info's board to row's agent, keeping its drawing, turns and drawer session. The caller holds
// boardCreate and has checked that the board's own agent is gone.
func takeOverBoard(dir string, info wshrpc.BoardInfo, row *agentRow) (wshrpc.BoardInfo, error) {
	agent := boardAgentOf(row)
	if _, err := boardstore.UpdateTalk(dir, info.ID, func(talk *wshrpc.BoardTalk) error {
		talk.Agent = &agent
		return nil
	}); err != nil {
		return info, fmt.Errorf("taking over board %q: %w", info.Name, err)
	}
	info.AgentTabId, info.AgentTitle = agent.TabId, agent.Title
	return info, nil
}

// BoardTakeOverCommand is Library's Open beside Chat on an ended agent's board: the chosen agent, a live Claude agent of
// the board's project, takes it over, and the board's list moves it beside that agent's Chat. A board whose agent is
// still live is refused; one already tied to the chosen agent is left as it is.
func (ws *WshServer) BoardTakeOverCommand(ctx context.Context, data wshrpc.CommandBoardTakeOverData) (*wshrpc.BoardInfo, error) {
	_, rows, err := boardRoster(ctx)
	if err != nil {
		return nil, err
	}
	row := agentRowByTab(rows, data.TabId)
	switch {
	case row == nil:
		return nil, errors.New("that agent is not running")
	case row.Harness != "claude":
		return nil, errors.New(errClaudeOnly)
	case row.Project != data.Project:
		return nil, fmt.Errorf("%s works in %s, not in %s", boardAgentTitle(row), row.Project, data.Project)
	}
	boardCreate.Lock()
	defer boardCreate.Unlock()
	_, info, err := boardOf(data.Project, data.BoardId)
	if err != nil {
		return nil, err
	}
	if info.LoadError != "" {
		return nil, fmt.Errorf("board %q won't open: %s", info.Name, info.LoadError)
	}
	dir := boardstore.ProjectDir(data.Project)
	talk, err := boardstore.ReadTalk(dir, info.ID) // Read's row carries no talk facts: the tie is the talk's
	if err != nil {
		return nil, err
	}
	if talk.Agent != nil {
		info.AgentTabId, info.AgentTitle = talk.Agent.TabId, talk.Agent.Title
	}
	if info.AgentTabId == row.TabId {
		return &info, nil
	}
	if live := agentRowByTab(rows, info.AgentTabId); live != nil {
		return nil, fmt.Errorf("board %q belongs to %s, which is still running", info.Name, boardAgentTitle(live))
	}
	info, err = takeOverBoard(dir, info, row)
	if err != nil {
		return nil, err
	}
	publishBoardList(data.Project, info.ID)
	return &info, nil
}

// readBoardAgent is the drawer's ReadAgent: what the board's agent said since sinceTs, read from the claude transcript
// of the agent's current session (so it follows /clear and compaction), with that session's id and the time of the last
// turn read, which the drawer keeps as the next cursor. An agent whose tab is gone reads nothing.
func readBoardAgent(ctx context.Context, agent wshrpc.BoardAgent, sinceTs int64) (text, sessionId string, cursorTs int64, err error) {
	_, rows, err := boardRoster(ctx)
	if err != nil {
		return "", "", sinceTs, err
	}
	row := agentRowByTab(rows, agent.TabId)
	if row == nil {
		return "", "", sinceTs, nil
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil {
		return "", "", sinceTs, err
	}
	if tpath == "" {
		return "", row.status.SessionID, sinceTs, nil
	}
	turns := agentsessions.TurnsSince(tpath, row.Harness, sinceTs)
	if len(turns) == 0 {
		return "", row.status.SessionID, sinceTs, nil
	}
	var words []string
	for _, t := range turns {
		if t.Speaker == "agent" {
			words = append(words, t.Text)
		}
	}
	return capNewest(strings.Join(words, "\n\n"), boardAgentReadRunes), row.status.SessionID, turns[len(turns)-1].Ts, nil
}

// capNewest keeps the last limit characters of text, cut on a character boundary, behind a mark.
func capNewest(text string, limit int) string {
	r := []rune(text)
	if len(r) <= limit {
		return text
	}
	return boardAgentCutMark + string(r[len(r)-limit:])
}
