// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package brainstormcheck

import "slices"

// Times reads how long past builder checks took (ms) as the pane's clock does: usual is the median, longest the
// longest; both are 0 with no past check.
func Times(durations []int64) (usual, longest int64) {
	if len(durations) == 0 {
		return 0, 0
	}
	d := slices.Clone(durations)
	slices.Sort(d)
	mid := len(d) / 2
	usual = d[mid]
	if len(d)%2 == 0 {
		usual = (d[mid-1] + d[mid]) / 2
	}
	return usual, d[len(d)-1]
}
