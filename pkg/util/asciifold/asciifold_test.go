// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package asciifold

import "testing"

func TestLower(t *testing.T) {
	for in, want := range map[string]string{
		"Council: ý cải tiến (từ council 04/11)": "council: y cai tien (tu council 04/11)",
		"ĐƯỜNG ĐI Ở Mức Âm":                      "duong di o muc am",
		"Straße naïve":                           "strasse naive",
		"café":                                  "cafe", // a decomposed é
		"日本 roadmap":                             "日本 roadmap",
		"plain-ascii_1":                          "plain-ascii_1",
	} {
		if got := Lower(in); got != want {
			t.Errorf("Lower(%q) = %q, want %q", in, got, want)
		}
	}
}
