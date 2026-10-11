// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestTokengateDecideReturnsPromptlyOnADoneContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, err := tokengateDecide(ctx, tokengate.Spawn{Tool: "Agent", Agents: 2}, func(any) { t.Fatal("held a spawn on a done context") })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("took %s", time.Since(start))
	}
}

func TestTokengateAnsweredMapsTheCardsOutcome(t *testing.T) {
	s := tokengate.Spawn{Tool: "Agent", Agents: 3}
	if v, err := tokengateAnswered(s, wshrpc.AskRtnData{}, context.DeadlineExceeded); err != nil || v.Run || v.Reason == "" {
		t.Fatalf("no answer before the deadline = %+v, %v; want the deny verdict", v, err)
	}
	if v, err := tokengateAnswered(s, wshrpc.AskRtnData{Cancelled: true}, nil); err != nil || v.Run {
		t.Fatalf("a dismissed card = %+v, %v; want a deny", v, err)
	}
	pick := []baseds.AgentAnswerItem{{SelectedIndexes: []int{tokengate.OptionAllowTurn}}}
	if v, err := tokengateAnswered(s, wshrpc.AskRtnData{Answers: pick}, nil); err != nil || !v.Run || v.Scope != tokengate.ScopeTurn {
		t.Fatalf("Allow this turn = %+v, %v", v, err)
	}
	broken := errors.New("no route to the cockpit")
	if _, err := tokengateAnswered(s, wshrpc.AskRtnData{}, broken); !errors.Is(err, broken) {
		t.Fatalf("a broken card's error = %v, want it passed on", err)
	}
}
