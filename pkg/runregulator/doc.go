// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package runregulator regulates the machine's RAM by pausing runs: a rule loop in wavesrv that reads memory
// pressure every few seconds and pauses the run holding the most to give up (the one with the fewest tasks done), then
// resumes it when memory is free again. It uses no agent and spends no tokens. A pure Decide picks at most one action
// from the pressure, the free RAM and the candidate runs; the loop applies it through pkg/runpause. It idles where
// memory pressure cannot be read, and while the person has switched Arc's memory waiting off (jobs:mode off or
// jobs:pauseuntil). See docs/superpowers/specs/2026-11-05-run-pause-design.md, decision 12.
package runregulator
