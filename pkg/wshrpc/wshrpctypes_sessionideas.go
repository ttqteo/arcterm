// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// Session ideas (pkg/sessionideas, docs/superpowers/specs/2026-11-26-session-ideas-design.md): what was floated in a
// session and never decided, kept in a store of its own before the transcript is deleted. The Jarvis Brief's From your
// sessions region, Sprout's popup and Settings → Storage read it; a scan fills it.

// The states of an idea: waiting for the person, kept on an initiative, or dropped (a scan does not propose it again).
const (
	SessionIdeaState_Review  = "review"
	SessionIdeaState_Kept    = "kept"
	SessionIdeaState_Dropped = "dropped"
)

// What a scanned session gave. skipped is a session read and passed over without a model call (a decide agent's, a digest
// with no user turn): it counts as scanned everywhere, so it is never forced, counted unscanned or offered again.
const (
	SessionIdeaOutcome_Ideas   = "ideas"
	SessionIdeaOutcome_Nothing = "nothing"
	SessionIdeaOutcome_Skipped = "skipped"
)

// What a row of the session list says. not-scanned is quiet (no write for 2 days) and unscanned, so the next scan the
// person starts reads it; waiting is unscanned and still being written. kept is a session all of whose ideas were kept.
const (
	SessionIdeasSession_Ideas      = "ideas"
	SessionIdeasSession_Kept       = "kept"
	SessionIdeasSession_Nothing    = "nothing"
	SessionIdeasSession_NotScanned = "not-scanned"
	SessionIdeasSession_Waiting    = "waiting"
)

// SessionIdeaQuote is one line the idea was floated in. Who is "you" or "agent"; the text is verbatim, in any language.
type SessionIdeaQuote struct {
	Who  string `json:"who"`
	Text string `json:"text"`
}

// SessionIdea is one idea a scan found. EffortOID empty means a new idea (no initiative matches it). KeptAs is
// "chunk:<effort oid>:<label>" or "effort:<oid>" once the state is kept.
type SessionIdea struct {
	ID             string             `json:"id"`
	Gist           string             `json:"gist"` // one line, English
	Project        string             `json:"project"`
	ProjectPath    string             `json:"projectpath"`
	EffortOID      string             `json:"effortoid"`
	EffortTitle    string             `json:"efforttitle"`
	Quotes         []SessionIdeaQuote `json:"quotes"`
	Why            string             `json:"why"` // why it stayed open
	SessionID      string             `json:"sessionid"`
	SessionTitle   string             `json:"sessiontitle"`
	TranscriptPath string             `json:"transcriptpath"`
	SaidTs         int64              `json:"saidts"`
	DeletesTs      int64              `json:"deletests"` // the day the transcript is deleted
	FoundTs        int64              `json:"foundts"`
	State          string             `json:"state"` // review | kept | dropped
	ResolvedTs     int64              `json:"resolvedts"`
	KeptAs         string             `json:"keptas"`
}

// SessionIdeaMark is a session a scan has read: its size and mtime then, so a session that grew is read again for the
// new turns only (after LastTurnTs).
type SessionIdeaMark struct {
	TranscriptPath string `json:"transcriptpath"`
	SessionID      string `json:"sessionid"`
	SessionTitle   string `json:"sessiontitle"`
	Project        string `json:"project"`
	Size           int64  `json:"size"`
	MtimeMs        int64  `json:"mtimems"`
	ScannedTs      int64  `json:"scannedts"`
	LastTurnTs     int64  `json:"lastturnts"`
	Ideas          int    `json:"ideas"`
	Outcome        string `json:"outcome"` // ideas | nothing | skipped
}

// SessionIdeasScan is the scan that runs or ran last. Error and StoppedAt are set when it stopped part way (the next
// scan goes on from there); Tokens is its model calls summed.
type SessionIdeasScan struct {
	Done      int    `json:"done"`
	Total     int    `json:"total"`
	StartedTs int64  `json:"startedts"`
	EndedTs   int64  `json:"endedts"`
	Forced    bool   `json:"forced"`
	Error     string `json:"error"`
	StoppedAt int    `json:"stoppedat"`
	NewIdeas  int    `json:"newideas"`
	Tokens    int64  `json:"tokens"`
}

// SessionIdeasSession is one row of the Sessions scanned fold. Sessions with a skipped mark, and archived ones, are
// left out of the list and the counts. The first-scan offer's "M sessions" is the number of not-scanned rows.
type SessionIdeasSession struct {
	SessionID      string `json:"sessionid"`
	Title          string `json:"title"`
	Project        string `json:"project"`
	TranscriptPath string `json:"transcriptpath"`
	Size           int64  `json:"size"`
	LastWriteTs    int64  `json:"lastwritets"`
	DeletesTs      int64  `json:"deletests"`
	Outcome        string `json:"outcome"` // ideas | kept | nothing | not-scanned | waiting
	Ideas          int    `json:"ideas"`
}

// SessionIdeasData is what the store keeps (Ideas, Marks, the times, Scan) and what Get adds (Sessions and the three
// counts, computed from the marks and the transcripts on disk, never stored).
type SessionIdeasData struct {
	Ideas         []SessionIdea         `json:"ideas"`
	Marks         []SessionIdeaMark     `json:"marks"`
	Sessions      []SessionIdeasSession `json:"sessions"`
	Scanned       int                   `json:"scanned"`
	NotYet        int                   `json:"notyet"`
	LeavingSoon   int                   `json:"leavingsoon"`
	LastScanTs    int64                 `json:"lastscants"`
	NextScanTs    int64                 `json:"nextscants"`
	SeenTs        int64                 `json:"seents"`
	SnoozedUntil  int64                 `json:"snoozeduntil"`
	FirstScanDone bool                  `json:"firstscandone"`
	Scan          *SessionIdeasScan     `json:"scan,omitempty"`
}

type CommandSessionIdeasResolveData struct {
	ID    string `json:"id"`
	Op    string `json:"op"` // keep | drop
	Label string `json:"label,omitempty"`
}

type CommandSessionIdeasMarkData struct {
	Op string `json:"op"` // seen | snooze
}

// CommandSessionIdeasScanData starts a scan, or stops the one that runs. Empty Paths is every quiet session not yet
// scanned (no mark, or a mark whose size or mtime changed).
type CommandSessionIdeasScanData struct {
	Stop  bool     `json:"stop,omitempty"`
	Paths []string `json:"paths,omitempty"`
}

// CommandSessionIdeasSeedData is the dev app's fixture door (refused outside dev mode; the CDP scenarios use it). Data
// is written to the store; Fixture turns fixture mode on, with Sessions as the scan's candidates and Reply as the canned
// model reply; Clear empties the store and turns fixture mode off.
type CommandSessionIdeasSeedData struct {
	Data     SessionIdeasData      `json:"data"`
	Fixture  bool                  `json:"fixture,omitempty"`
	Sessions []SessionIdeasSession `json:"sessions,omitempty"`
	Reply    string                `json:"reply,omitempty"`
	Clear    bool                  `json:"clear,omitempty"`
}

// SessionIdeasCommands is Session ideas: Get reads the store with the counts and the session list, Resolve keeps or
// drops an idea, Mark records that the person looked (seen) or put the nudges off (snooze), Scan starts or stops a scan.
type SessionIdeasCommands interface {
	SessionIdeasGetCommand(ctx context.Context) (*SessionIdeasData, error)
	SessionIdeasResolveCommand(ctx context.Context, data CommandSessionIdeasResolveData) error
	SessionIdeasMarkCommand(ctx context.Context, data CommandSessionIdeasMarkData) error
	SessionIdeasScanCommand(ctx context.Context, data CommandSessionIdeasScanData) error
	SessionIdeasSeedCommand(ctx context.Context, data CommandSessionIdeasSeedData) error
}
