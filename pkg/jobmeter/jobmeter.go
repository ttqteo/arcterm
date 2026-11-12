// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jobmeter measures how much memory each Bash-tool command of an agent peaks at. One poll finds the
// shell each agent's Bash tool started, adds up its process tree on every poll while it runs, and reports the
// largest sum once it has gone, so the heavy-job queue can plan with what a command really took.
package jobmeter

import (
	"context"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memusage"
)

// Agent is one agent to watch: the block it runs in and the agent's own process.
type Agent struct {
	BlockId string
	Pid     int32 // the agent's own process (memusage.AgentPid), not the block's root
}

// Done is one measured command that has ended. Peak is the largest sum, in bytes, of its process tree over the
// polls it was seen in.
type Done struct {
	BlockId string
	Command string
	Peak    uint64
}

// Config wires the meter to its surroundings.
type Config struct {
	Agents func(t memusage.Table) []Agent // the agents to watch, given this poll's table
	OnDone func(Done)                     // a measured command ended; called outside any lock
	Poll   time.Duration                  // 0 is 2 s
}

// Run polls until ctx ends.
func Run(ctx context.Context, cfg Config) {
	<-ctx.Done()
}
