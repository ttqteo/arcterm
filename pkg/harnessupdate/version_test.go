// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import "testing"

func TestParseVersion(t *testing.T) {
	cases := map[string][3]int{
		"2.1.292 (Claude Code)": {2, 1, 292},
		"v0.3.10":               {0, 3, 10},
		"  1.0.0\n":             {1, 0, 0},
	}
	for in, want := range cases {
		got, ok := ParseVersion(in)
		if !ok || got != want {
			t.Errorf("ParseVersion(%q) = %v, %v; want %v", in, got, ok, want)
		}
	}
	if _, ok := ParseVersion("claude: command not found"); ok {
		t.Error("a string with no x.y.z parsed")
	}
}

func TestNewer(t *testing.T) {
	if !Newer("2.1.300", "2.1.292 (Claude Code)") {
		t.Error("2.1.300 is newer than 2.1.292")
	}
	if !Newer("2.10.0", "2.9.9") {
		t.Error("compared as strings: 2.10.0 is newer than 2.9.9")
	}
	if Newer("2.1.292", "2.1.292 (Claude Code)") || Newer("2.1.291", "2.1.292") {
		t.Error("an equal or older version is not newer")
	}
	if Newer("", "2.1.292") || Newer("2.1.300", "") {
		t.Error("an unparsed side is never newer")
	}
}
