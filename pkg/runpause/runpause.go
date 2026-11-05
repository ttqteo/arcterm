// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package runpause pauses and resumes a whole top-level run tree: the run, every child run under it, and each dag's
// agents and commands. A pause frees the RAM the tree holds and keeps every worktree, commit and session; a resume
// reopens each agent in its own session. wshserver (the Pause and Resume buttons and `wsh runs pause`), the RAM
// regulator and the boot resume all call this one package, and the regulator cannot import wshserver.
//
// The order of a pause is its invariant: it marks before it stops anything. The top-level run's Pause record, each
// known child run's PausedUnder and each dag's PausedTs are written first, so every exit, outcome or tab-close that
// a stop causes already reads as paused.
//
// The functions here are stubs with their final signatures until the task that builds them (spec
// 2026-11-05-run-pause-design, decision 8).
package runpause

import (
	"context"
	"fmt"
	"log"
)

// Who paused or resumed a run: Pause.By, and the "by" of the run-paused and run-resumed events.
const (
	By_Auto   = "auto"   // the RAM regulator
	By_Manual = "manual" // the person, from the UI or `wsh runs pause`
	By_Boot   = "boot"   // the resume at boot
)

// Pause pauses the top-level run runId and everything under it, by who (By_*). It refuses a run that is not
// top-level, or is done, cancelled or already paused, with a reason the CLI and the UI can show.
func Pause(ctx context.Context, channelId, runId, by string) error {
	return fmt.Errorf("pausing run %s: not built yet", runId)
}

// Resume reopens every session a pause suspended and carries the run on. It refuses a run that is not paused.
func Resume(ctx context.Context, channelId, runId, by string) error {
	return fmt.Errorf("resuming run %s: not built yet", runId)
}

// ResumeAtBoot runs once at startup: every paused top-level run resumes with By_Boot, unless memory is already
// tight, when each stays paused for the regulator. Errors are logged per run.
func ResumeAtBoot(ctx context.Context) {
	log.Printf("runpause: ResumeAtBoot is not built yet")
}

// HeldBytes is the RAM runId's tree holds now (every live agent's process tree and every running plan command's), for
// the regulator to rank its candidates.
func HeldBytes(ctx context.Context, channelId, runId string) (uint64, error) {
	return 0, fmt.Errorf("measuring run %s: not built yet", runId)
}

// ClearOnCancel is what a cancel of a paused run leaves to do: clear every PausedUnder mark under the run, and
// cancel each lead-spawned child run that is not done, since its agents are suspended and nothing would resume them.
func ClearOnCancel(ctx context.Context, channelId, runId string) error {
	return fmt.Errorf("clearing run %s after its cancel: not built yet", runId)
}
