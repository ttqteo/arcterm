// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type SessionCommands interface {
	// DeleteAgentSessionCommand moves an ended Claude session's transcript (and its sibling directory) into
	// ~/.arc/trash, where wavesrv purges it after 7 days. It refuses a path outside the Claude projects dir
	// and a session an open tab or a recent write shows is still running; the error says which.
	DeleteAgentSessionCommand(ctx context.Context, data CommandDeleteAgentSessionData) error
}

type CommandDeleteAgentSessionData struct {
	TranscriptPath string `json:"transcriptpath"`
}
