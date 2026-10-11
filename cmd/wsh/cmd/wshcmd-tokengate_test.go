// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"errors"
	"reflect"
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
	_, err := tokengateDecide(ctx, tokengate.Spawn{Tool: "Agent", Agents: 2}, "", func(any) { t.Fatal("held a spawn on a done context") })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("took %s", time.Since(start))
	}
}

func TestTokengateAnsweredMapsTheCardsOutcome(t *testing.T) {
	s := tokengate.Spawn{Tool: "Agent", Agents: 3}
	if v, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{}, context.DeadlineExceeded); err != nil || v.Run || v.Reason == "" {
		t.Fatalf("no answer before the deadline = %+v, %v; want the deny verdict", v, err)
	}
	if v, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{Cancelled: true}, nil); err != nil || v.Run {
		t.Fatalf("a dismissed card = %+v, %v; want a deny", v, err)
	}
	pick := []baseds.AgentAnswerItem{{SelectedIndexes: []int{tokengate.OptionAllowTurn}}}
	if v, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{Answers: pick}, nil); err != nil || !v.Run || v.Scope != tokengate.ScopeTurn {
		t.Fatalf("Allow this turn = %+v, %v", v, err)
	}
	broken := errors.New("no route to the cockpit")
	if _, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{}, broken); !errors.Is(err, broken) {
		t.Fatalf("a broken card's error = %v, want it passed on", err)
	}
}

func TestSplitTypes(t *testing.T) {
	if got := splitTypes(""); got != nil {
		t.Fatalf("no flag = %v", got)
	}
	if got := splitTypes("general-purpose,,Explore"); !reflect.DeepEqual(got, []string{"general-purpose", "", "Explore"}) {
		t.Fatalf("types = %v", got)
	}
}

func TestTokengateFlagsAndReview(t *testing.T) {
	for _, name := range []string{"transcript", "types"} {
		if f := tokengateCmd.Flags().Lookup(name); f == nil || f.DefValue != "" {
			t.Errorf("--%s flag = %+v", name, f)
		}
	}
	if f := tokengateReviewCmd.Flags().Lookup("days"); f == nil || f.DefValue != "7" {
		t.Errorf("review --days flag = %+v", f)
	}
	if tokengateReviewCmd.Parent() != tokengateCmd {
		t.Errorf("review is not under tokengate")
	}
}

func TestTokengateReviewText(t *testing.T) {
	got := tokengateReviewText(&wshrpc.CommandReviewTokenEstimatesRtnData{
		Days: 7, Logged: 4, Run: 3, Matched: 2, MedianRatio: 1.5, WithRange: 1, InRange: 0,
		ByType: []wshrpc.TokenEstimateTypeReview{{Type: "Explore", Matched: 1, MedianRatio: 1}, {Type: "general-purpose", Matched: 1, MedianRatio: 2}},
		Costs: []wshrpc.SubagentCostData{
			{Type: "general-purpose", Samples: 14, Mean: 2_800_000, P25: 300_000, P90: 6_100_000},
			{Type: "all", Samples: 31, Mean: 4_800_000, P25: 130_000, P90: 11_700_000},
		},
	})
	want := "Token burn estimates, last 7 days: 4 logged, 3 ran, 2 matched to the subagents that ran.\n" +
		"Actual ÷ estimate: median 1.50×.\n" +
		"Inside the card's range: 0 of 1 (0%).\n" +
		"  Explore: 1 matched, median 1.00×\n" +
		"  general-purpose: 1 matched, median 2.00×\n" +
		"Subagent costs now (finished, last 30 days):\n" +
		"  general-purpose: 14 samples, avg 2.8M, range 300k–6.1M\n" +
		"  all: 31 samples, avg 4.8M, range 130k–11.7M\n"
	if got != want {
		t.Fatalf("review\n%s\nwant\n%s", got, want)
	}
	empty := tokengateReviewText(&wshrpc.CommandReviewTokenEstimatesRtnData{Days: 7})
	if empty != "Token burn estimates, last 7 days: 0 logged, 0 ran, 0 matched to the subagents that ran.\nSubagent costs now (finished, last 30 days):\n  none yet\n" {
		t.Fatalf("empty review %q", empty)
	}
}
