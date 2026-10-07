// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memgate

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// the card's options, by index
const (
	OptionRun = iota
	OptionWait
	OptionSkip
)

// WaitEvery and WaitLimit pace "Wait for RAM": a reading every 5 s, for at most 30 min.
const (
	WaitEvery = 5 * time.Second
	WaitLimit = 30 * time.Minute
)

// Verdict is `wsh memgate`'s one line of output: whether the hook lets the command run, and when it does
// not, the reason the agent reads in place of the command's output.
type Verdict struct {
	Run    bool   `json:"run"`
	Reason string `json:"reason,omitempty"`
}

// Hold is a line `wsh memgate` prints before it holds the command, for the hook to show the person; the
// Verdict line comes last.
type Hold struct {
	Hold string `json:"hold"`
}

// Asking is the hold line while the card waits for the person.
func Asking(job Job, available uint64) Hold {
	return Hold{fmt.Sprintf("Low RAM: `%s` needs about %s and %s is free. Waiting for your answer on arcterm's card.",
		job.Name, FormatGB(job.Bytes), FormatGB(available))}
}

// Waiting is the hold line while "Wait for RAM" reads the free RAM.
func Waiting(job Job) Hold {
	return Hold{fmt.Sprintf("Waiting for about %s of RAM to come free before running `%s` (up to %d min).",
		FormatGB(job.Bytes), job.Name, int(WaitLimit.Minutes()))}
}

// Question is the card that asks the person, saying what the job needs and what is free now.
func Question(job Job, available, total uint64) baseds.AgentAskQuestion {
	need := FormatGB(job.Bytes)
	return baseds.AgentAskQuestion{
		Header: "Low RAM",
		Question: fmt.Sprintf("An agent wants to run `%s`, which needs about %s of RAM. %s of %s is free now.",
			job.Name, need, FormatGB(available), FormatGB(total)),
		Options: []baseds.AgentAskOption{
			OptionRun:  {Label: "Run now", Description: "Start it on the RAM free now. The machine may swap and slow down."},
			OptionWait: {Label: "Wait for RAM", Description: fmt.Sprintf("Start it on its own once about %s is free. Close apps to make room; it gives up after %d min.", need, int(WaitLimit.Minutes()))},
			OptionSkip: {Label: "Don't run", Description: "The agent skips it and carries on without it."},
		},
	}
}

// Choice is the option the person picked; a dismissed card, a typed answer or no answer is a skip.
func Choice(answers []baseds.AgentAnswerItem, cancelled bool) int {
	if cancelled || len(answers) == 0 || len(answers[0].SelectedIndexes) != 1 {
		return OptionSkip
	}
	switch i := answers[0].SelectedIndexes[0]; i {
	case OptionRun, OptionWait:
		return i
	}
	return OptionSkip
}

// Skipped is the verdict when the person chose not to run the job.
func Skipped(job Job, available uint64) Verdict {
	return Verdict{Reason: fmt.Sprintf(
		"Not run: the person chose not to run `%s` now. It needs about %s of RAM and only %s is free. "+
			"Do not retry it; carry on without it and say in your report that it was skipped.",
		job.Name, FormatGB(job.Bytes), FormatGB(available))}
}

// TimedOut is the verdict when "Wait for RAM" never saw the room come free.
func TimedOut(job Job, waited time.Duration) Verdict {
	return Verdict{Reason: fmt.Sprintf(
		"Not run: waited %d min for about %s of free RAM for `%s` and it never came free. "+
			"Do not retry it; carry on without it and say in your report that it was skipped.",
		int(waited.Minutes()), FormatGB(job.Bytes), job.Name)}
}

// Wait reads the free RAM every `every` until the job fits, and false once `limit` passes or ctx ends.
// A failed reading is skipped: the next one may succeed.
func Wait(ctx context.Context, job Job, read func(context.Context) (uint64, error), every, limit time.Duration) bool {
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-tick.C:
			if available, err := read(ctx); err == nil && Fits(job, available) {
				return true
			}
		}
	}
}
