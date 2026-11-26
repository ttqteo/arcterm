// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import "github.com/wavetermdev/waveterm/pkg/wshrpc"

// A pair's State.
const (
	StateRelaying = "relaying"
	StateStopped  = "stopped"
	StateEnded    = "ended"
)

// A stopped pair's StopReason; "" while it relays. They are the strings of wshrpc.PairInfo.
const (
	StopNoNewPoints = "no-new-points"
	StopSettled     = "settled"
	StopTokenCap    = "token-cap"
	StopJudgesGone  = "judges-gone"
)

// Message.From.
const (
	FromWorker = "worker"
	FromJudge  = "judge"
	FromPerson = "person"
	FromSystem = "system"
)

// A person's message goes To: both (the default), the working agent, the judge(s), or one judge's tab.
const (
	ToBoth   = "both"
	ToWorker = "worker"
	ToJudge  = "judge"
)

// The kinds of a Decided item, as wshrpc.PairItem.Kind says them.
const (
	KindAgreed = "agreed"
	KindOpen   = "open"
	KindAsks   = "asks"
)

// DefaultTokenCap is the token cap of a pair whose start named none.
const DefaultTokenCap = 3_000_000

// The folders of pair files under the data dir. The Manager reads and writes DirName only; SyncedDirName holds pairs
// that came from another machine and is read by the history read alone, so a synced pair never enters the index.
const (
	DirName       = "pairs"
	SyncedDirName = "pairs-synced"
)

// Side is one agent of a pair, by its tab (the cockpit agent id, which survives sleep and an app restart).
type Side struct {
	Tab     string `json:"tab"`
	Name    string `json:"name"` // as the roster named it when it joined
	Harness string `json:"harness"`
	// Session is the agent's session id (its transcript file's name without the extension), kept so a pair can be
	// found again by the session it happened in: a tab id means nothing on another machine. The first one a side gets
	// is kept for good.
	Session string `json:"session,omitempty"`
	Gone    bool   `json:"gone,omitempty"`
	Briefed bool   `json:"briefed,omitempty"` // a judge launched with the brief as its task, or sent the brief as its first prompt
	// Launched marks a judge arcterm launched for the job (a "Judge: <worker>" tab started by ⚖ under a reply, or a resting
	// one woken by it), as against an agent the person picked from the live list. Only a launched judge sleeps when the round
	// ends and rests until the next one.
	Launched bool `json:"launched,omitempty"`
	// Tokens is this session's spend since the pair's CapFromTs, as last counted. A gone judge's stays: its session
	// is no longer read, but what it spent still counts toward the cap. The working agent's is read and shown, and
	// does not count toward it.
	Tokens int64 `json:"tokens,omitempty"`
}

// Message is one message of the conversation. Raw is what the agent wrote, fences and quote line included: the view
// parses it each time, so the file never holds a second copy of what a block says.
type Message struct {
	Id      string            `json:"id"`
	From    string            `json:"from"`
	Tab     string            `json:"tab,omitempty"` // the agent's tab; "" for the person and the system
	Ts      int64             `json:"ts"`
	Raw     string            `json:"raw"`
	To      string            `json:"to,omitempty"`      // a person's message: where it goes (the To constants or a judge's tab)
	ReplyTo string            `json:"replyto,omitempty"` // the id of the message it answers
	Item    int               `json:"item,omitempty"`    // a person's message: the A item it answers
	Held    []wshrpc.PairHeld `json:"held,omitempty"`    // a worker's message: the heavy commands refused since its last one
	// Pause is set on the system message that says the pair paused (its Raw keeps the "Paused: …" line): why, the judge's
	// summary and the Decided lists at that moment. A message saved before it existed has none and is drawn as a line.
	Pause *wshrpc.PairPause `json:"pause,omitempty"`
	// Withheld marks a judge's reply that a no-new-points or settled stop took out of the working agent's queue before it
	// was sent: the working agent never read it, so a turn of its own is no answer to it.
	Withheld bool `json:"withheld,omitempty"`
}

// Pair is the stored record of one pair, a JSON file of its own.
type Pair struct {
	Id         string `json:"id"`
	Project    string `json:"project"`
	Worker     Side   `json:"worker"`
	Judges     []Side `json:"judges"`
	HoldHeavy  bool   `json:"holdheavy"`
	TokenCap   int64  `json:"tokencap"`
	Note       string `json:"note,omitempty"`
	CreatedTs  int64  `json:"createdts"`
	UpdatedTs  int64  `json:"updated"` // the last save, ms; a file saved before it existed has none and reads as its last message's time (Info)
	State      string `json:"state"`
	StopReason string `json:"stopreason,omitempty"`
	CapFromTs  int64  `json:"capfromts"` // tokens count from here: pairing, or the person's message that resumed a token-cap stop
	Tokens     int64  `json:"tokens"`    // spent since CapFromTs, as of the last turn end: every judge's Tokens, gone judges included
	// JudgeTokens says Tokens counts the judges only. A pair saved before it existed counted the working agent too, and
	// keeps that count until the first recount of an active pair moves it onto the judges' (a stored ended pair is never
	// recounted), so only a pair with the flag says "judge tokens".
	JudgeTokens bool `json:"judgetokens,omitempty"`

	Messages []Message `json:"messages"`
	// Pending is, per tab, the ids of the messages waiting for that agent, delivered as one prompt.
	Pending map[string][]string `json:"pending,omitempty"`
	// Seen is, per tab, the Ts of the last answer the pair took from that agent.
	Seen map[string]int64 `json:"seen,omitempty"`
	// Held is what the hold refused the working agent since its last message; the next worker message takes them.
	Held []wshrpc.PairHeld `json:"held,omitempty"`
	// Passes are the commands Run now let through; the next JobSlotCommand for one consumes it.
	Passes        []string `json:"passes,omitempty"`
	WorkerBriefed bool     `json:"workerbriefed,omitempty"` // the working agent has had the worker brief
	// Later says the pair started from a reply the working agent had gone on from: its first message is that reply, and
	// the working agent's first relayed prompt says so (OlderReplyNote). It is kept because that prompt is built when the
	// judge first answers, by when Seen[worker] has moved on and the fact can no longer be read from the pair.
	Later bool `json:"later,omitempty"`
}
