// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memgate

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

var typecheck = Job{Name: "task check:ts", Bytes: 3 * gib}

func TestQuestionSaysWhatItNeedsAndWhatIsFree(t *testing.T) {
	q := Question(typecheck, 1843*mib, 8*gib)
	for _, want := range []string{"`task check:ts`", "3 GB", "1.8 GB", "8 GB"} {
		if !strings.Contains(q.Question, want) {
			t.Fatalf("question %q does not say %q", q.Question, want)
		}
	}
	if q.MultiSelect || len(q.Options) != 3 {
		t.Fatalf("want one pick of three options, got %+v", q)
	}
	labels := []string{q.Options[OptionRun].Label, q.Options[OptionWait].Label, q.Options[OptionSkip].Label}
	if labels[0] != "Run now" || labels[1] != "Wait for RAM" || labels[2] != "Don't run" {
		t.Fatalf("options out of order: %v", labels)
	}
}

func TestChoice(t *testing.T) {
	pick := func(i int) []baseds.AgentAnswerItem { return []baseds.AgentAnswerItem{{SelectedIndexes: []int{i}}} }
	cases := []struct {
		name      string
		answers   []baseds.AgentAnswerItem
		cancelled bool
		want      int
	}{
		{"run", pick(OptionRun), false, OptionRun},
		{"wait", pick(OptionWait), false, OptionWait},
		{"skip", pick(OptionSkip), false, OptionSkip},
		{"dismissed", nil, true, OptionSkip},
		{"no answer", nil, false, OptionSkip},
		{"typed text instead of a pick", []baseds.AgentAnswerItem{{Text: "later"}}, false, OptionSkip},
		{"an index past the options", pick(7), false, OptionSkip},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Choice(tc.answers, tc.cancelled); got != tc.want {
				t.Fatalf("Choice = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestSkippedAndTimedOutTellTheAgentNotToRetry(t *testing.T) {
	for _, v := range []Verdict{Skipped(typecheck, 1843*mib), TimedOut(typecheck, 30*time.Minute)} {
		if v.Run || !strings.Contains(v.Reason, "`task check:ts`") || !strings.Contains(v.Reason, "Do not retry") {
			t.Fatalf("verdict %+v must refuse, name the command and say not to retry", v)
		}
	}
}

func TestHoldLinesNameTheCommandAndTheRAM(t *testing.T) {
	for _, h := range []Hold{Asking(typecheck, 1843*mib), Waiting(typecheck)} {
		if !strings.Contains(h.Hold, "`task check:ts`") || !strings.Contains(h.Hold, "3 GB") {
			t.Fatalf("hold line %q must name the command and what it needs", h.Hold)
		}
	}
}

func TestWaitRunsOnceTheRoomIsFree(t *testing.T) {
	readings := []uint64{1 * gib, 2 * gib, 4 * gib}
	calls := 0
	read := func(context.Context) (uint64, error) {
		r := readings[min(calls, len(readings)-1)]
		calls++
		return r, nil
	}
	if !Wait(context.Background(), typecheck, read, time.Millisecond, time.Second) {
		t.Fatal("Wait gave up although 4 GB came free")
	}
	if calls != 3 {
		t.Fatalf("read %d times, want 3 (it stops at the first reading that fits)", calls)
	}
}

func TestWaitGivesUpAtTheLimit(t *testing.T) {
	read := func(context.Context) (uint64, error) { return 1 * gib, nil }
	start := time.Now()
	if Wait(context.Background(), typecheck, read, time.Millisecond, 20*time.Millisecond) {
		t.Fatal("Wait ran although the room never came free")
	}
	if time.Since(start) > time.Second {
		t.Fatal("Wait ran far past its limit")
	}
}

func TestWaitKeepsGoingThroughAFailedReading(t *testing.T) {
	calls := 0
	read := func(context.Context) (uint64, error) {
		calls++
		if calls == 1 {
			return 0, errors.New("rpc down")
		}
		return 4 * gib, nil
	}
	if !Wait(context.Background(), typecheck, read, time.Millisecond, time.Second) {
		t.Fatal("one failed reading ended the wait")
	}
}

func TestWaitStopsWhenTheCallerGoes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	read := func(context.Context) (uint64, error) { return 1 * gib, nil }
	if Wait(ctx, typecheck, read, time.Millisecond, time.Minute) {
		t.Fatal("Wait ran after its caller went away")
	}
}
