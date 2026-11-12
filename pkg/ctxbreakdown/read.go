// Package ctxbreakdown reads what Claude Code's /context reports for a folder: run headless, it measures a fresh
// session there, which is what loads every turn (tools, memory files, skills, agents, MCP, the system prompt).
package ctxbreakdown

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Read returns the breakdown for cwd. Task 2 of the rail-context-breakdown plan replaces this body.
func Read(ctx context.Context, cwd string, refresh bool) (*wshrpc.ContextBreakdown, error) {
	return nil, errors.New("reading /context is not built yet")
}
