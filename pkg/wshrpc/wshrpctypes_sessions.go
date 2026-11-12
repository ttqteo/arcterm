// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type SessionCommands interface {
	// DeleteAgentSessionCommand moves an ended Claude session's transcript (and its sibling directory) into
	// ~/.arc/trash, where wavesrv purges it after 7 days. It refuses a path outside the Claude projects dir
	// and a session an open tab or a recent write shows is still running; the error says which.
	DeleteAgentSessionCommand(ctx context.Context, data CommandDeleteAgentSessionData) error
	// ForkAgentSessionCommand returns the command line that forks a Claude session and the folder to run it in: the
	// whole conversation when UUID is empty, else the part before (Keep "before") or through (Keep "through") the record
	// with that uuid, cut into a copy under ~/.arc/forks. The transcript itself is never written.
	ForkAgentSessionCommand(ctx context.Context, data CommandForkAgentSessionData) (*CommandForkAgentSessionRtnData, error)
}

type CommandDeleteAgentSessionData struct {
	TranscriptPath string `json:"transcriptpath"`
}

type CommandForkAgentSessionData struct {
	TranscriptPath string `json:"transcriptpath"`
	UUID           string `json:"uuid,omitempty"`
	Keep           string `json:"keep,omitempty"`
}

type CommandForkAgentSessionRtnData struct {
	Command     string `json:"command"`
	ProjectPath string `json:"projectpath"`
}
