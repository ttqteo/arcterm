// pkg/agentedits/doc.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentedits rebuilds the files one Claude Code agent changed itself. It replays the Edit, Write and
// MultiEdit calls of the agent's transcript over Claude Code's file-history backups and writes two synthetic
// commits, B (the files as the agent first found them) and H (as it left them), so the Diff surface can read
// the agent's own edits as an ordinary B..H range through GitAgentEditsCommand.
package agentedits
