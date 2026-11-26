// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"context"
	"errors"
)

// Deps is what a scan reaches outside the package for: the model, the project's initiatives, the sessions on disk and
// the clock. The wshserver builds it, because what it reads needs pkg/jarvis and pkg/effortstore.
type Deps struct{}

// ProjectContext is what a session's project already holds, so the model leaves out an idea that is decided: its
// initiatives and their chunks, its ideas, its specs and plans, its deferred headings, its commits and the ideas the
// store already knows.
type ProjectContext struct{}

// ScanOpts says what a scan reads. Paths is the transcripts to read; empty is every quiet session not yet scanned (no
// mark, or a mark whose size or mtime changed). Forced says the schedule started it, not the person.
type ScanOpts struct {
	Forced bool
	Paths  []string
}

// ScanNow reads the sessions opts names and stores the ideas it finds.
func ScanNow(ctx context.Context, s *Store, deps Deps, opts ScanOpts) error {
	return errors.New("scan not built yet")
}
