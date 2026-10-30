// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"cmp"
	"context"
	"fmt"
	"time"
)

// the caps and the pace AgentCaller uses when its own are zero
const (
	defaultBusyCap   = 10 * time.Minute
	defaultTurnCap   = 20 * time.Minute
	defaultAgentPoll = 2 * time.Second
)

// AgentCaller is the Caller for a seat held by a live agent: it takes the seat's turn in the agent's own session, through
// the AgentLink, instead of starting a process. It never sends into a running turn: a seat that is working or asking is
// waited on up to BusyCap, and one that was sent its turn gets TurnCap to answer. Either cap runs out as a SeatSkipped.
type AgentCaller struct {
	Link    AgentLink
	BusyCap time.Duration // 0: 10 min
	TurnCap time.Duration // 0: 20 min
	Poll    time.Duration // 0: 2 s
}

var _ Caller = AgentCaller{}

// Call sends req.Prompt as the seat's next turn and returns the answer the agent gave to it. The agent has its own tools
// and its own working directory, so req.Tools and req.Cwd do not apply.
func (a AgentCaller) Call(ctx context.Context, req CallReq) (CallRes, error) {
	tab, name := req.Expert.Agent, cmp.Or(req.Expert.Name, req.Expert.Agent)
	if a.Link == nil || tab == "" {
		return CallRes{}, fmt.Errorf("%s has no live agent to take its turn", name)
	}
	start, err := a.waitRest(ctx, req, name)
	if err != nil {
		return CallRes{}, err
	}
	// an answer from before this turn is not its answer
	_, noted, err := a.Link.LastAnswer(ctx, tab)
	if err != nil {
		return CallRes{}, fmt.Errorf("reading %s's last answer: %w", name, err)
	}
	if err := a.Link.Send(ctx, tab, req.Prompt); err != nil {
		return CallRes{}, fmt.Errorf("sending the turn to %s: %w", name, err)
	}
	text, end, err := a.waitAnswer(ctx, tab, name, noted)
	if err != nil {
		return CallRes{}, err
	}
	var grown int64
	if start.Context > 0 {
		grown = max(end.Context-start.Context, 0)
	}
	// the context grown over the turn when the seat reports it, else a tenth of the context it began with (the one the
	// council saw at Setup when the seat reports none)
	tokens := cmp.Or(grown, cmp.Or(start.Context, req.Expert.Context)/10)
	return CallRes{Text: text, Tokens: tokens}, nil
}

func (a AgentCaller) caps() (busy, turn, poll time.Duration) {
	return cmp.Or(a.BusyCap, defaultBusyCap), cmp.Or(a.TurnCap, defaultTurnCap), cmp.Or(a.Poll, defaultAgentPoll)
}

// waitRest polls until the seat is idle or sleeping, which is when a turn may be sent (a send wakes a sleeping one). A
// seat that stays busy past BusyCap is skipped, and the activity says which agent is being waited for meanwhile.
func (a AgentCaller) waitRest(ctx context.Context, req CallReq, name string) (AgentSeatState, error) {
	busyCap, _, poll := a.caps()
	deadline := time.Now().Add(busyCap)
	announced := false
	for {
		st, err := a.Link.Seat(ctx, req.Expert.Agent)
		if err != nil {
			return st, fmt.Errorf("reading %s's state: %w", name, err)
		}
		switch st.State {
		case SeatIdle, SeatSleeping:
			return st, nil
		case SeatGone:
			return st, goneErr(name)
		}
		if !time.Now().Before(deadline) {
			if st.State == SeatAsking {
				return st, SeatSkipped{Reason: "a question waits for you in its terminal"}
			}
			return st, SeatSkipped{Reason: "still working on its own task after " + capText(busyCap)}
		}
		if !announced && req.OnTool != nil {
			req.OnTool("Waiting for " + name + " to finish its task")
			announced = true
		}
		if err := pause(ctx, poll); err != nil {
			return st, err
		}
	}
}

// waitAnswer polls until the seat is back at rest with an answer newer than noted, and returns that answer and the seat's
// state then. The turn is over only with both: a seat reads idle for a moment after the send, before it starts working,
// and an idle one whose last answer is the old one has not answered. TurnCap is for the whole wait.
func (a AgentCaller) waitAnswer(ctx context.Context, tab, name string, noted int64) (string, AgentSeatState, error) {
	_, turnCap, poll := a.caps()
	deadline := time.Now().Add(turnCap)
	for {
		st, err := a.Link.Seat(ctx, tab)
		if err != nil {
			return "", st, fmt.Errorf("reading %s's state: %w", name, err)
		}
		if st.State == SeatGone {
			return "", st, goneErr(name)
		}
		if st.State == SeatIdle || st.State == SeatSleeping {
			text, ts, err := a.Link.LastAnswer(ctx, tab)
			if err != nil {
				return "", st, fmt.Errorf("reading %s's answer: %w", name, err)
			}
			if ts > noted && text != "" {
				return text, st, nil
			}
		}
		if !time.Now().Before(deadline) {
			return "", st, SeatSkipped{Reason: "gave no answer within " + capText(turnCap)}
		}
		if err := pause(ctx, poll); err != nil {
			return "", st, err
		}
	}
}

func goneErr(name string) error {
	return fmt.Errorf("%s is gone: its tab closed or its session ended", name)
}

// capText is a cap as the skipped line words it: "10 min", or the plain duration for one that is not whole minutes.
func capText(d time.Duration) string {
	if d >= time.Minute && d%time.Minute == 0 {
		return fmt.Sprintf("%d min", d/time.Minute)
	}
	return d.String()
}

// pause waits d, or returns ctx's error when it is cut off first.
func pause(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
