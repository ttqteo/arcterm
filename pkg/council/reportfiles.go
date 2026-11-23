// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "strings"

// DiscussionSuffix ends the name of a report's side file: the discussion and everything about how the council worked,
// kept beside the short main report (`2026-11-23-a.md` and `2026-11-23-a.discussion.md`).
const DiscussionSuffix = ".discussion.md"

// SidePath is the side file of a report: the main path with its `.md` replaced by DiscussionSuffix, or DiscussionSuffix
// appended to a path that does not end in `.md`. It is the one place that names a side file.
func SidePath(mainPath string) string {
	return strings.TrimSuffix(mainPath, ".md") + DiscussionSuffix
}

// IsSidePath says path names a report's side file, so a listing of reports can leave it out.
func IsSidePath(path string) bool {
	return strings.HasSuffix(path, DiscussionSuffix)
}
