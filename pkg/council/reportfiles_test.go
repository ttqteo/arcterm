// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "testing"

func TestSidePath(t *testing.T) {
	for in, want := range map[string]string{
		"x/2026-11-23-a.md":                   "x/2026-11-23-a.discussion.md",
		"a.md":                                "a.discussion.md",
		`D:\p\docs\council\2026-11-23-a-2.md`: `D:\p\docs\council\2026-11-23-a-2.discussion.md`,
		"docs/council/idle.sleep.md":          "docs/council/idle.sleep.discussion.md",
		"docs/council/notes.txt":              "docs/council/notes.txt.discussion.md",
		"docs/council/report":                 "docs/council/report.discussion.md",
		"":                                    ".discussion.md",
	} {
		if got := SidePath(in); got != want {
			t.Errorf("SidePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsSidePath(t *testing.T) {
	for in, want := range map[string]bool{
		"x/2026-11-23-a.discussion.md":      true,
		`D:\p\docs\council\a.discussion.md`: true,
		"x/2026-11-23-a.md":                 false,
		"x/discussion.md":                   false,
		"x/a.discussion.md.bak":             false,
		"x/a.discussion":                    false,
		"":                                  false,
	} {
		if got := IsSidePath(in); got != want {
			t.Errorf("IsSidePath(%q) = %v, want %v", in, got, want)
		}
	}
	// the side file of a main path is a side path, and the main path is not
	main := "docs/council/2026-11-23-a.md"
	if !IsSidePath(SidePath(main)) || IsSidePath(main) {
		t.Errorf("SidePath(%q) = %q: IsSidePath should tell it from its main file", main, SidePath(main))
	}
}
