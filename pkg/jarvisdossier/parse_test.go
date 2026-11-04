// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisdossier

import "testing"

// a Vietnamese summary keeps its words in the file name: the diacritics go, not the letters
func TestBoundedSlugFoldsDiacritics(t *testing.T) {
	for in, want := range map[string]string{
		"Cải tiến council":   "cai-tien-council",
		"PROJ-9 Đường đi":    "proj-9-duong-di",
		"auth cleanup":       "auth-cleanup",
		"日本":                 "decision",
		"  --Dark / Light--": "dark-light",
	} {
		if got := DecisionSlug(in); got != want {
			t.Errorf("DecisionSlug(%q) = %q, want %q", in, got, want)
		}
	}
}
