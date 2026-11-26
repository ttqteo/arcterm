// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// PairCommands is the pairs: a working agent and the judge(s) that read its replies, one conversation arcterm relays
// between them (pkg/agentpair; spec docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md). wavesrv owns the
// pair file, the relay and the hold on heavy commands; the frontend draws the PairView it reads after each pair:update.
type PairCommands interface {
	PairListCommand(ctx context.Context) (*CommandPairListRtnData, error)                                 // the active pairs, and the judges that rest between rounds
	PairHistoryCommand(ctx context.Context, data CommandPairHistoryData) (*CommandPairListRtnData, error) // a project's pairs in every state, synced ones too
	PairGetCommand(ctx context.Context, data CommandPairGetData) (*PairView, error)                       // one pair in full
	PairBriefCommand(ctx context.Context, data CommandPairBriefData) (*CommandPairBriefRtnData, error)    // a new judge's launch task
	PairStartCommand(ctx context.Context, data CommandPairStartData) (*PairView, error)                   // pair, or add a judge
	PairSayCommand(ctx context.Context, data CommandPairSayData) error                                    // the person's message or answer chip
	PairRunNowCommand(ctx context.Context, data CommandPairRunNowData) error                              // let a held command through
	PairUnpairCommand(ctx context.Context, data CommandPairGetData) error
	PairResumeCommand(ctx context.Context, data CommandPairGetData) error // put a stopped pair back to relaying and deliver what is queued
}

// PairSide is one agent of a pair, by its tab (the cockpit agent id, which survives sleep and an app restart).
type PairSide struct {
	Tab     string `json:"tab"`
	Name    string `json:"name"`              // as the roster names it
	Harness string `json:"harness"`           // claude | pi
	Session string `json:"session,omitempty"` // the agent's session id (its transcript's file name); "" until the pair has taken one
	Gone    bool   `json:"gone,omitempty"`
}

// PairInfo is a pair as the list shows it. State: relaying | stopped | ended. StopReason, while stopped: no-new-points |
// settled | token-cap | judges-gone, else "".
type PairInfo struct {
	Id           string     `json:"id"`
	Project      string     `json:"project"`
	Worker       PairSide   `json:"worker"`
	Judges       []PairSide `json:"judges"`
	State        string     `json:"state"`
	StopReason   string     `json:"stopreason"`
	Owed         bool       `json:"owed"` // a live judge owes an answer to the working agent's newest message
	MessageCount int        `json:"messagecount"`
	LastTs       int64      `json:"lastts"`
	UpdatedTs    int64      `json:"updatedts"`        // the last save (ms); a pair saved before it existed reads its LastTs
	Synced       bool       `json:"synced,omitempty"` // the pair came from the synced folder: it reads as of the last sync
}

// PairResting is a judge arcterm launched for a job whose newest pair has ended: it rests (asleep, or about to be) and
// is hidden under its worker's row while that worker is on the roster, until ⚖ under a reply wakes it for a new round.
type PairResting struct {
	Tab       string `json:"tab"`       // the judge's tab
	Name      string `json:"name"`      // as the roster names it ("Judge: <worker>")
	WorkerTab string `json:"workertab"` // the working agent of the pair it last judged
	PairId    string `json:"pairid"`    // that pair
}

type CommandPairListRtnData struct {
	Pairs   []PairInfo    `json:"pairs"`
	Resting []PairResting `json:"resting,omitempty"` // PairListCommand only; PairHistoryCommand leaves it out
}

// CommandPairHistoryData names the project whose pairs are read; "" is every project.
type CommandPairHistoryData struct {
	Project string `json:"project"`
}

type CommandPairGetData struct {
	PairId string `json:"pairid"`
}

// PairHeld is a heavy command the hold refused to the working agent. RunTs is when Run now let it through.
type PairHeld struct {
	Command string `json:"command"`
	Ts      int64  `json:"ts"`
	RunTs   int64  `json:"runts,omitempty"`
}

// PairPause is what a pause message keeps of the moment the pair stopped, so the conversation and the Library page draw
// the same card from the file: Reason is the StopReason (no-new-points | settled | token-cap | judges-gone), Summary the
// newest judge message's `summary:` line after the working agent's newest message ("" when none), Decided the lists at
// that moment.
type PairPause struct {
	Reason  string      `json:"reason"`
	Summary string      `json:"summary"`
	Decided PairDecided `json:"decided"`
}

// PairMessage is one message of the conversation. From: worker | judge | person | system. Text is the shown body: the
// arc-pair / arc-judge fence and the leading quote line are taken out (the file keeps the raw text). Pause is set on the
// system message that says the pair paused; a pause message from before it existed has none and reads as a line.
type PairMessage struct {
	Id      string     `json:"id"`
	From    string     `json:"from"`
	Tab     string     `json:"tab"` // the agent's tab; "" for person and system
	Ts      int64      `json:"ts"`
	Text    string     `json:"text"`
	Quote   string     `json:"quote"`   // the line it answers
	ReplyTo string     `json:"replyto"` // the id of the message it answers
	To      string     `json:"to"`      // a person's message: both | worker | judge | a judge's tab
	Held    []PairHeld `json:"held"`
	Pause   *PairPause `json:"pause,omitempty"`
}

// PairItem is one line of the Decided view. Kind: agreed | open | asks. Num is 0 for a judge's new point.
type PairItem struct {
	Num        int      `json:"num"`
	Kind       string   `json:"kind"`
	Text       string   `json:"text"`
	Note       string   `json:"note"`
	Chips      []string `json:"chips"`
	MsgId      string   `json:"msgid"`      // agreed: the message where it was settled; else the message of the block (or of the judge's new point)
	ReopenedBy string   `json:"reopenedby"` // open: the judge tab whose reopen mark put it here
	NewBy      string   `json:"newby"`      // open: the judge tab whose `new:` point this is
	Answer     string   `json:"answer"`     // asks: the person's answer, until the next block
}

type PairDecided struct {
	Asks   []PairItem `json:"asks"`
	Agreed []PairItem `json:"agreed"`
	Open   []PairItem `json:"open"`
}

// PairView is one pair in full: its info, the hold's settings, the conversation and the Decided lists. CanResume says
// that PairResume would deliver something: the pair is stopped (not by judges-gone) and some member's queue still calls
// for an answer; a pair read from a file, a synced one included, never says it.
type PairView struct {
	PairInfo
	HoldHeavy bool          `json:"holdheavy"`
	TokenCap  int64         `json:"tokencap"`
	Tokens    int64         `json:"tokens"` // spent since the cap's start
	Note      string        `json:"note"`
	CreatedTs int64         `json:"createdts"`
	Messages  []PairMessage `json:"messages"`
	Decided   PairDecided   `json:"decided"`
	CanResume bool          `json:"canresume,omitempty"`
	// JudgeTokens says Tokens counts the judges only (every pair made or recounted since the cap stopped counting the
	// working agent); a pair saved before that counted both sides, and its words say "tokens".
	JudgeTokens bool `json:"judgetokens,omitempty"`
}

type CommandPairBriefData struct {
	WorkerTab string `json:"workertab"`
	// From is the transcript record uuid of the reply the pair starts from; "" is the agent's latest reply.
	From string `json:"from,omitempty"`
}

type CommandPairBriefRtnData struct {
	Text string `json:"text"`
}

type CommandPairStartData struct {
	WorkerTab string `json:"workertab"`
	JudgeTab  string `json:"judgetab"`
	HoldHeavy bool   `json:"holdheavy"`
	TokenCap  int64  `json:"tokencap"` // 0: 3,000,000
	Note      string `json:"note"`
	Briefed   bool   `json:"briefed"`            // the judge was launched with PairBrief's text as its task
	Launched  bool   `json:"launched,omitempty"` // the judge is a tab arcterm launched for the job: a new "Judge: <worker>" tab, or a resting judge woken
	// From is the transcript record uuid of the reply the pair starts from; "" is the agent's latest reply.
	From string `json:"from,omitempty"`
}

// CommandPairSayData is the person's message. To: both | worker | judge | a judge's tab ("" is both). ReplyTo names the
// message a hover Reply answers; Item is the A item an answer chip answers.
type CommandPairSayData struct {
	PairId  string `json:"pairid"`
	Text    string `json:"text"`
	To      string `json:"to"`
	ReplyTo string `json:"replyto"`
	Item    int    `json:"item,omitempty"`
}

type CommandPairRunNowData struct {
	PairId  string `json:"pairid"`
	MsgId   string `json:"msgid"`
	Command string `json:"command"`
}

// PairUpdateData is pair:update's payload: the pair that changed and its working agent's tab. The frontend re-reads it.
type PairUpdateData struct {
	PairId    string `json:"pairid"`
	WorkerTab string `json:"workertab"`
}
