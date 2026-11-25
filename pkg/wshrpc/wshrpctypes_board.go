// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// BoardCommands is the boards: named Excalidraw files per project, each a talk with a read-only drawer. wavesrv
// owns the talk and the drawer; the frontend owns the scene and saves with the rev it read. A board belongs to a
// project by name (the registered project's name, the key the app bar's project picker uses).
type BoardCommands interface {
	BoardListCommand(ctx context.Context, data CommandBoardListData) (*BoardListRtnData, error)
	BoardReadCommand(ctx context.Context, data CommandBoardRefData) (*BoardReadRtnData, error)
	BoardSaveCommand(ctx context.Context, data CommandBoardSaveData) (*BoardSaveRtnData, error)
	BoardTalkCommand(ctx context.Context, data CommandBoardRefData) (*BoardTalk, error)
	BoardAskCommand(ctx context.Context, data CommandBoardAskData) error
	BoardAskStopCommand(ctx context.Context, data CommandBoardRefData) error
	BoardAskRetryCommand(ctx context.Context, data CommandBoardTurnData) error
	BoardRerouteCommand(ctx context.Context, data CommandBoardTurnData) error
	BoardAnswerInboxCommand(ctx context.Context, data CommandBoardRefData) ([]BoardAnswer, error)
	BoardAnswerAckCommand(ctx context.Context, data CommandBoardAnswerAckData) error
	BoardAgentDrawCommand(ctx context.Context, data CommandBoardAgentDrawData) (*BoardAgentDrawRtnData, error)
	BoardTakeOverCommand(ctx context.Context, data CommandBoardTakeOverData) (*BoardInfo, error)
	BoardDeleteCommand(ctx context.Context, data CommandBoardRefData) error
}

type CommandBoardListData struct {
	Project string `json:"project,omitempty"` // empty: every project
}

type BoardListRtnData struct {
	Boards []BoardInfo `json:"boards"` // most recently active first
}

type BoardInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Project    string `json:"project"`
	Path       string `json:"path"` // the .excalidraw file, absolute
	CreatedTs  int64  `json:"createdts"`
	ActiveTs   int64  `json:"activets"`          // last turn or answer, else created
	DrawnTs    int64  `json:"drawnts,omitempty"` // when the last drawing turn was applied
	State      string `json:"state,omitempty"`   // "answering" while a turn runs, "failed" when the last turn failed
	LoadError  string `json:"loaderror,omitempty"`
	Turns      int    `json:"turns,omitempty"`
	Shapes     int    `json:"shapes,omitempty"`     // live elements, bound text not counted
	AgentTabId string `json:"agenttabid,omitempty"` // the agent the board is tied to
	AgentTitle string `json:"agenttitle,omitempty"` // as the roster titled it: "claude · waveterm"
}

type CommandBoardRefData struct {
	Project string `json:"project"`
	BoardId string `json:"boardid"`
}

type CommandBoardTurnData struct {
	Project string `json:"project"`
	BoardId string `json:"boardid"`
	TurnId  string `json:"turnid"`
}

type BoardReadRtnData struct {
	Info BoardInfo `json:"info"`
	Data string    `json:"data"` // the file's JSON text
	Rev  string    `json:"rev"`
}

type CommandBoardSaveData struct {
	Project string `json:"project"`
	BoardId string `json:"boardid"`
	Data    string `json:"data"`
	BaseRev string `json:"baserev"`
}

type BoardSaveRtnData struct {
	Rev      string `json:"rev,omitempty"`
	Conflict bool   `json:"conflict,omitempty"` // the file changed since BaseRev; nothing was written
}

type CommandBoardAskData struct {
	Project     string   `json:"project"`
	BoardId     string   `json:"boardid"`
	Question    string   `json:"question"`
	On          string   `json:"on,omitempty"` // the selected shapes' labels
	SelectedIds []string `json:"selectedids,omitempty"`
	DrawingId   string   `json:"drawingid,omitempty"` // the drawing in view when the line was asked
}

type CommandBoardAnswerAckData struct {
	Project  string   `json:"project"`
	BoardId  string   `json:"boardid"`
	AnswerId string   `json:"answerid"`
	TurnId   string   `json:"turnid"`
	ShapeIds []string `json:"shapeids,omitempty"`
	Error    string   `json:"error,omitempty"` // the landing failed: the turn fails and nothing changed
}

// CommandBoardTakeOverData ties a board to a chat: TabId, a live Claude agent of the board's project, takes the board
// over, whether its chat ended (Library's Open beside Chat) or is still running (the board cell's Chat picker).
type CommandBoardTakeOverData struct {
	Project string `json:"project"`
	BoardId string `json:"boardid"`
	TabId   string `json:"tabid"`
}

// CommandBoardAgentDrawData is `wsh board draw`: the agent's block, the board's name, its one-line request and, when the
// board is new, the briefing that tells the drawer what it is about.
type CommandBoardAgentDrawData struct {
	BlockId string `json:"blockid"`
	Board   string `json:"board"`
	Ask     string `json:"ask,omitempty"`
	Context string `json:"context,omitempty"`
}

// BoardAgentDrawRtnData is what happened to the agent's request. State is the turn's end state: answered | failed |
// answering (the wait ran out while the drawer was still drawing).
type BoardAgentDrawRtnData struct {
	BoardId   string `json:"boardid"`
	BoardName string `json:"boardname"`
	Project   string `json:"project"`
	Created   bool   `json:"created,omitempty"`
	State     string `json:"state"`
	Added     int    `json:"added,omitempty"`
	Changed   int    `json:"changed,omitempty"`
	Removed   int    `json:"removed,omitempty"`
	Reason    string `json:"reason,omitempty"` // failed: why
}

// BoardArcRecord is the board file's "arc" key (its first key). Go reads it; the frontend writes it.
type BoardArcRecord struct {
	Name      string `json:"name"`
	CreatedTs int64  `json:"createdts"`
}

// BoardUpdateData is board:update's payload. What: list | talk | answer.
type BoardUpdateData struct {
	Project string `json:"project"`
	BoardId string `json:"boardid,omitempty"`
	What    string `json:"what"`
	TurnId  string `json:"turnid,omitempty"`
	State   string `json:"state,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// BoardAgent is the agent a board is tied to: the cockpit agent id (its tab), which survives sleep and an app restart.
type BoardAgent struct {
	TabId     string `json:"tabid"`
	Title     string `json:"title"`               // "claude · waveterm", as the roster titled it
	SessionId string `json:"sessionid,omitempty"` // the agent's latest claude session, refreshed at every drawer read
	ReadTs    int64  `json:"readts,omitempty"`    // the drawer has read the agent's turns up to here
}

// BoardForward is a turn sent to the board's agent instead of drawn. State: waiting | sent | replied | agentgone.
type BoardForward struct {
	State   string `json:"state"`
	Reason  string `json:"reason,omitempty"` // agentgone: the agent's tab is closed
	SentTs  int64  `json:"sentts,omitempty"`
	Reply   string `json:"reply,omitempty"` // the agent's reply, copied from the transcript
	ReplyTs int64  `json:"replyts,omitempty"`
}

// BoardTalk is a board's conversation with its drawer, kept in the <id>.talk.json sidecar that only wavesrv writes.
type BoardTalk struct {
	Project   string `json:"project"`
	BoardId   string `json:"boardid"`
	SessionId string `json:"sessionid,omitempty"` // the drawer's claude session
	// ContextTokens is SessionId's context after its last turn, kept so a summary handoff can be added when a long board
	// shows the need.
	ContextTokens int         `json:"contexttokens,omitempty"`
	Agent         *BoardAgent `json:"agent,omitempty"`
	Turns         []BoardTurn `json:"turns"`
}

// BoardTurn is one line and what became of it. Kind: ask (yours: drawn or forwarded) | request (the agent's
// wsh board draw: drawn or failed). State: waiting | answering | answered | forwarded | failed | stopped.
type BoardTurn struct {
	ID          string        `json:"id"`
	Ts          int64         `json:"ts"`
	Kind        string        `json:"kind"`
	Question    string        `json:"question,omitempty"`
	On          string        `json:"on,omitempty"`
	SelectedIds []string      `json:"selectedids,omitempty"`
	DrawingId   string        `json:"drawingid,omitempty"` // kept for Retry, Draw instead and Send to agent
	Context     string        `json:"context,omitempty"`   // a request's briefing
	State       string        `json:"state"`
	Title       string        `json:"title,omitempty"`
	Added       int           `json:"added,omitempty"`
	Changed     int           `json:"changed,omitempty"`
	Removed     int           `json:"removed,omitempty"`
	ShapeIds    []string      `json:"shapeids,omitempty"`
	StartedTs   int64         `json:"startedts,omitempty"` // when it began answering: the UI's seconds and slow come from it
	AnsweredTs  int64         `json:"answeredts,omitempty"`
	Reason      string        `json:"reason,omitempty"`
	From        string        `json:"from,omitempty"` // the turn a send-the-other-way redoes
	Forward     *BoardForward `json:"forward,omitempty"`
}

// BoardAnswer is one drawer answer waiting in a board's answers inbox until the frontend applies it.
type BoardAnswer struct {
	ID      string   `json:"id"`
	Project string   `json:"project"`
	BoardId string   `json:"boardid"`
	TurnId  string   `json:"turnid"`
	Add     string   `json:"add,omitempty"`    // JSON array text of Excalidraw element skeletons
	Update  string   `json:"update,omitempty"` // JSON array text of element patches
	Remove  []string `json:"remove,omitempty"`
	// Title is a new drawing's frame name; DrawingId is the frame an edit changes, empty for a new drawing.
	Title     string `json:"title,omitempty"`
	DrawingId string `json:"drawingid,omitempty"`
	Ts        int64  `json:"ts"`
}
