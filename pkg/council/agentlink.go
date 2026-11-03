// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "context"

// The states of a seated agent's tab, as the AgentLink reports them. A seat takes its turn only while it is idle or
// sleeping: a working or asking one is waited on, never sent into.
const (
	SeatIdle     = "idle"
	SeatWorking  = "working"
	SeatAsking   = "asking" // a question waits for the person in its terminal
	SeatSleeping = "sleeping"
	SeatGone     = "gone" // the tab closed or its session ended
)

// AgentSeatState is what the link knows of a seated agent's tab: its state, its context size in tokens, its working
// directory and the tool line it is on now.
type AgentSeatState struct {
	State   string
	Context int64
	// Cwd is the agent's working directory, empty when unknown: the citation check reads the seat's cites against it.
	Cwd string
	// Activity is the agent's current tool line from the roster ("Read pkg/x/y.go"), empty when it has none: while a turn
	// waits, each new one is a step of the seat's timeline.
	Activity string
}

// AgentLink is the council's view of the live agents, so pkg/council imports nothing from wshserver: wshserver
// implements it over the agent roster, the message path `wsh agents send` uses and the transcript reader, and a test
// hands the AgentCaller a fake.
type AgentLink interface {
	// Seat is the state of the agent in tab tabId.
	Seat(ctx context.Context, tabId string) (AgentSeatState, error)
	// Send puts text into the agent's session as its next turn, waking a sleeping agent first.
	Send(ctx context.Context, tabId, text string) error
	// LastAnswer is the agent's last answer and when it was given, in ms.
	LastAnswer(ctx context.Context, tabId string) (text string, ts int64, err error)
	// Transcript is the path of the session's transcript the agent in tab tabId runs, "" when it is gone or unknown.
	Transcript(ctx context.Context, tabId string) (string, error)
	// Holder is the tab of the live agent whose session's transcript is transcript, "" when no tab holds it.
	Holder(ctx context.Context, transcript string) (string, error)
}

// SeatRebinder is a Caller of live agents that finds a seat's session again: Rebind is e with its Transcript filled in
// while its tab is live, and with its Agent moved to the tab that holds its session now when its own closed (the
// session opened again by Resume or Open asleep). e unchanged when there is nothing to do.
type SeatRebinder interface {
	Rebind(ctx context.Context, e CouncilExpert) (CouncilExpert, error)
}

// SeatSkipped is what AgentCaller.Call returns for a turn that did not happen: the agent stayed busy or gave no answer
// in time. The runner tells it from a failed call with errors.As, posts it as a skipped line and goes on without it.
type SeatSkipped struct {
	Reason string // "still working on its own task after 10 min"
}

func (e SeatSkipped) Error() string { return "skipped: " + e.Reason }
