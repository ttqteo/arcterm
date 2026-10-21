// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package devservers

import "testing"

func TestLsofRegularFile(t *testing.T) {
	cases := []struct{ name, out, want string }{
		{"stdout to a file", "p50\nf1\ntREG\nn/tmp/dev.log\nf2\ntREG\nn/tmp/err.log\n", "/tmp/dev.log"},
		{"stdout to a tty, stderr to a file", "p50\nf1\ntCHR\nn/dev/ttys003\nf2\ntREG\nn/tmp/err.log\n", "/tmp/err.log"},
		{"both to a pipe", "p50\nf1\ntPIPE\nn->0x1\nf2\ntPIPE\nn->0x1\n", ""},
		{"no output", "", ""},
	}
	for _, c := range cases {
		if got := lsofRegularFile(c.out); got != c.want {
			t.Errorf("%s: got %q; want %q", c.name, got, c.want)
		}
	}
}
