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

// AgentSeatState is what the link knows of a seated agent's tab: its state, and its context size in tokens.
type AgentSeatState struct {
	State   string
	Context int64
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
}

// SeatSkipped is what AgentCaller.Call returns for a turn that did not happen: the agent stayed busy or gave no answer
// in time. The runner tells it from a failed call with errors.As, posts it as a skipped line and goes on without it.
type SeatSkipped struct {
	Reason string // "still working on its own task after 10 min"
}

func (e SeatSkipped) Error() string { return "skipped: " + e.Reason }
