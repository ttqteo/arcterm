// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "testing"

func TestModeOf(t *testing.T) {
	for _, tc := range []struct {
		name string
		c    *Council
		want string
	}{
		{"a council saved before modes", &Council{}, ModeReview},
		{"review", &Council{Mode: ModeReview}, ModeReview},
		{"brainstorm", &Council{Mode: ModeBrainstorm}, ModeBrainstorm},
		{"nil", nil, ModeReview},
	} {
		if got := ModeOf(tc.c); got != tc.want {
			t.Errorf("ModeOf(%s) = %q, want %q", tc.name, got, tc.want)
		}
	}
}
