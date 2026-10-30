// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// seatHarnesses are the harnesses whose sessions can sit in a council: the agents wsh agents reaches, less agy, whose
// answer a council has not been tried against.
var seatHarnesses = map[string]bool{"claude": true, "pi": true}

// councilSender is how a seat's turn names who sent it. A council has no tab, so the envelope's tab is its name too.
const councilSender = "council"

// errNoSeat is a tab that is not a live agent session (any more): its seat is gone.
var errNoSeat = errors.New("not a live agent session")

// liveAgentLink is the council's AgentLink over the live agents: the roster for a seat's state, the path wsh agents send
// takes for its turn, and the transcript for its answer.
type liveAgentLink struct{}

var _ council.AgentLink = liveAgentLink{}

// find is the live agent in tab tabId, and the roster it came from. A tab that is no longer a live agent is errNoSeat; one
// whose harness a council cannot seat is refused.
func (liveAgentLink) find(ctx context.Context, tabId string) ([]agentRow, *agentRow, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, nil, err
	}
	rows := buildAgentRoster(facts)
	row, err := resolveAgentTab(rows, tabId)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", errNoSeat, err)
	}
	if !seatHarnesses[row.Harness] {
		return nil, nil, fmt.Errorf("agent %q runs %s, and only claude and pi sessions can sit in a council", row.Name, row.Harness)
	}
	return rows, row, nil
}

// Seat is the agent's state, folded into the council's five, and, for a seat at rest, its context in tokens. A tab that
// is not a live agent any more is a gone seat, not a failure of the read.
func (l liveAgentLink) Seat(ctx context.Context, tabId string) (council.AgentSeatState, error) {
	_, row, err := l.find(ctx, tabId)
	if errors.Is(err, errNoSeat) {
		return council.AgentSeatState{State: council.SeatGone}, nil
	}
	if err != nil {
		return council.AgentSeatState{}, err
	}
	st := council.AgentSeatState{State: seatState(row.State)}
	// the caller reads the context at rest only (before a turn and after it), and reading it costs a read of the
	// transcript's end, so a seat that is working is not read
	if st.State == council.SeatIdle || st.State == council.SeatSleeping {
		st.Context = seatContext(ctx, row)
	}
	return st, nil
}

// seatState is a roster row's state as a seat's. A state it does not know reads as working, so the seat is waited on and
// never sent into.
func seatState(state string) string {
	switch state {
	case wshrpc.AgentsState_Idle:
		return council.SeatIdle
	case wshrpc.AgentsState_Asking:
		return council.SeatAsking
	case wshrpc.AgentsState_Sleeping:
		return council.SeatSleeping
	}
	return council.SeatWorking
}

// seatContext is the context a claude seat carries, in tokens: what its last request read, from the end of its transcript
// as the sleep loop reads it. 0 means unknown (another harness, no transcript yet, a compaction since the last request),
// and the caller prices such a turn from what the council knew when it seated the agent.
func seatContext(ctx context.Context, row *agentRow) int64 {
	if row.Harness != "claude" {
		return 0
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil || tpath == "" {
		return 0
	}
	lines, err := readTranscriptEnd(tpath, cacheTailBytes)
	if err != nil {
		return 0
	}
	return int64(agentsleep.ReadCacheState(lines).Tokens)
}

// Send puts text into the agent's session as its next turn, through the wake-or-deliver path wsh agents send takes: a
// sleeping agent is woken first. Nobody is the sender, so the envelope names the council and the send-back lock, which
// guards one agent from answering another by message, is not touched.
func (l liveAgentLink) Send(ctx context.Context, tabId, text string) error {
	rows, row, err := l.find(ctx, tabId)
	if err != nil {
		return err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return fmt.Errorf("the message is empty")
	}
	return deliverToAgent(ctx, rows, row, agentmsg.Envelope(councilSender, councilSender, text), nil)
}

// LastAnswer is the agent's last answer and its time, as wsh agents read gives them; "", 0 while it has none.
func (l liveAgentLink) LastAnswer(ctx context.Context, tabId string) (string, int64, error) {
	_, row, err := l.find(ctx, tabId)
	if err != nil {
		return "", 0, err
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil || tpath == "" {
		return "", 0, err
	}
	text, ts := agentsessions.LastAnswer(tpath, row.Harness)
	return text, ts, nil
}
