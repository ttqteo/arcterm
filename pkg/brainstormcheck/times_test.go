// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package brainstormcheck

import "testing"

func TestTimes(t *testing.T) {
	for _, tc := range []struct {
		name           string
		in             []int64
		usual, longest int64
	}{
		{"none", nil, 0, 0},
		{"one", []int64{5000}, 5000, 5000},
		{"odd count: the middle one, in any order", []int64{508_000, 119_000, 218_000, 122_000, 129_000}, 129_000, 508_000},
		{"even count: halfway between the two middle ones", []int64{4000, 1000, 2000, 3000}, 2500, 4000},
	} {
		usual, longest := Times(tc.in)
		if usual != tc.usual || longest != tc.longest {
			t.Errorf("%s: got usual %d longest %d, want %d %d", tc.name, usual, longest, tc.usual, tc.longest)
		}
	}
}
