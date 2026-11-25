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

// Side is one agent of a pair, by its tab (the cockpit agent id, which survives sleep and an app restart).
type Side struct {
	Tab     string `json:"tab"`
	Name    string `json:"name"` // as the roster named it when it joined
	Harness string `json:"harness"`
	Gone    bool   `json:"gone,omitempty"`
	Briefed bool   `json:"briefed,omitempty"` // a judge launched with the brief as its task, or sent the brief as its first prompt
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
	State      string `json:"state"`
	StopReason string `json:"stopreason,omitempty"`
	CapFromTs  int64  `json:"capfromts"` // tokens count from here: pairing, or the person's message that resumed a token-cap stop
	Tokens     int64  `json:"tokens"`    // spent since CapFromTs, as of the last turn end

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
}
