// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"context"
	"errors"
)

// Resume puts a stopped pair back to relaying and delivers what is still queued, with no message from the person. It is
// declared here so the wire and the frontend can build on it; the body comes in the task that builds it.
func (m *Manager) Resume(ctx context.Context, pairId string) error {
	return errors.New("resume is not built yet")
}

// canResume reports whether Resume would deliver something: the pair is stopped (not by judges-gone) and the working
// agent's queue or a live judge's still calls for an answer. Placeholder: false until the task that builds Resume.
func canResume(p *Pair) bool { return false }
