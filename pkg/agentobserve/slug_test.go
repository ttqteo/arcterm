// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import "testing"

func TestSlugifyCwd(t *testing.T) {
	cases := []struct {
		name string
		cwd  string
		want string
	}{
		{"windows repo path", `C:\Users\cktra\Projects\waveterm`, "C--Users-cktra-Projects-waveterm"},
		{"worktree with dot dir", `C:\Users\cktra\Projects\opal\.claude-worktrees\design-system-impl`, "C--Users-cktra-Projects-opal--claude-worktrees-design-system-impl"},
		{"posix path", "/Users/cktra/Projects/waveterm", "-Users-cktra-Projects-waveterm"},
		{"hyphens preserved", "a-b-c", "a-b-c"},
		{"already alnum", "abc123", "abc123"},
		{"range bounds kept", "azAZ09", "azAZ09"},
		{"empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := SlugifyCwd(c.cwd); got != c.want {
				t.Fatalf("SlugifyCwd(%q) = %q, want %q", c.cwd, got, c.want)
			}
		})
	}
}
