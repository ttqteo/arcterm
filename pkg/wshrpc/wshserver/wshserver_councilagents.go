// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
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
	if err := seatable(row); err != nil {
		return nil, nil, err
	}
	return rows, row, nil
}

// seatable is nil when the agent's harness can sit in a council.
func seatable(row *agentRow) error {
	if !seatHarnesses[row.Harness] {
		return fmt.Errorf("agent %q (tab %s) runs %s, and only claude and pi sessions can sit in a council", row.Name, row.TabId, row.Harness)
	}
	return nil
}

// The widths wsh agents list gives a tab id and a title, which the list in a refused seat's error follows.
const (
	seatShortIdLen = 8
	seatTitleMax   = 60
)

// councilAgentSeats turns the tabs a council names (ids or unique prefixes) into its agent seats, in the order given,
// from one read of the roster: the seat Setup builds for a picked agent, with the tab's name, harness and the context it
// holds now. A tab named twice (by id, by prefix, or both) sits once; a tab from another project is welcome. A name that
// is no live tab, several, or a harness a council cannot seat fails the whole call, with the live claude and pi tabs
// listed so the caller can ask the person which they meant. No tabs, no roster read.
func councilAgentSeats(ctx context.Context, tabs []string) ([]council.CouncilExpert, error) {
	if len(tabs) == 0 {
		return nil, nil
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	rows := buildAgentRoster(facts)
	var seats []council.CouncilExpert
	for _, tab := range tabs {
		row, err := resolveAgentTab(rows, tab)
		if err == nil {
			err = seatable(row)
		}
		if err != nil {
			return nil, fmt.Errorf("%w\nlive claude and pi tabs:\n%s", err, seatableTabs(rows))
		}
		if slices.ContainsFunc(seats, func(s council.CouncilExpert) bool { return s.Agent == row.TabId }) {
			continue
		}
		seats = append(seats, council.CouncilExpert{
			Id: "agent-" + row.TabId, Name: row.Name, Agent: row.TabId, Harness: row.Harness, Context: seatContext(ctx, row),
		})
	}
	return seats, nil
}

// seatableTabs is the live claude and pi tabs, a line each: short id, project and title, as wsh agents list --all prints
// them.
func seatableTabs(rows []agentRow) string {
	var buf strings.Builder
	w := tabwriter.NewWriter(&buf, 0, 4, 2, ' ', 0)
	for _, r := range rows {
		if !seatHarnesses[r.Harness] {
			continue
		}
		title := []rune(strings.Join(strings.Fields(r.Title), " "))
		if len(title) > seatTitleMax {
			title = append(title[:seatTitleMax-1], '…')
		}
		fmt.Fprintf(w, "  %s\t%s\t%s\n", r.TabId[:min(seatShortIdLen, len(r.TabId))], r.Project, string(title))
	}
	w.Flush()
	if buf.Len() == 0 {
		return "  none"
	}
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " ")
	}
	return strings.Join(lines, "\n")
}

// seatActivityMax bounds the tool line a seat reports, in characters: the one line a seat card and a timeline row show.
const seatActivityMax = orchestrate.MaxLatestToolLen

// Seat is the agent's state, folded into the council's five, its working directory (the session's own, a worktree's when
// it works in one; empty while no report named one) and, for a seat at rest, its context in tokens, or, for one that is
// on a tool, the tool line. A tab that is not a live agent any more is a gone seat, not a failure of the read.
func (l liveAgentLink) Seat(ctx context.Context, tabId string) (council.AgentSeatState, error) {
	_, row, err := l.find(ctx, tabId)
	if errors.Is(err, errNoSeat) {
		return council.AgentSeatState{State: council.SeatGone}, nil
	}
	if err != nil {
		return council.AgentSeatState{}, err
	}
	st := council.AgentSeatState{State: seatState(row.State), Cwd: row.Cwd, Activity: seatActivity(row)}
	// the caller reads the context at rest only (before a turn and after it), and reading it costs a read of the
	// transcript's end, so a seat that is working is not read
	if st.State == council.SeatIdle || st.State == council.SeatSleeping {
		st.Context = seatContext(ctx, row)
	}
	return st, nil
}

// seatActivity is the tool line an agent is on: the detail its PreToolUse (claude) or status extension (pi) report carried,
// which the roster row's status holds until the next report replaces it. The detail of an agent that is not working is the
// last tool's, a stale one, so only a working agent has an activity (PostToolUse reports working with no detail: between
// two tools there is none). The line is cut to one row, as the orchestrator cuts the tool line it shows.
func seatActivity(row *agentRow) string {
	if row.State != wshrpc.AgentsState_Working || row.status.State != baseds.AgentState_Working {
		return ""
	}
	line := []rune(strings.ToValidUTF8(strings.Join(strings.Fields(row.status.Detail), " "), ""))
	if len(line) > seatActivityMax {
		line = append(line[:seatActivityMax-1], '…')
	}
	return string(line)
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
