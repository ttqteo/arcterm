// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCleanupPeriodDays(t *testing.T) {
	dir := t.TempDir()
	write := func(name, text string) string {
		t.Helper()
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	for _, c := range []struct {
		name    string
		path    string
		want    int
		logging string // what the log must say; "" means the read is silent
	}{
		{"the person's value", write("a.json", `{"theme":"dark","cleanupPeriodDays":14}`), 14, ""},
		{"arcterm's own 90", write("b.json", `{"cleanupPeriodDays":90}`), 90, ""},
		{"absent key is Claude Code's default", write("c.json", `{"theme":"dark"}`), 30, ""},
		{"absent file is Claude Code's default", filepath.Join(dir, "missing.json"), 30, ""},
		{"a parse error logs and gives the default", write("d.json", `{"cleanupPeriodDays": 9`), 30, "d.json"},
		{"a string is not a number: logs and gives the default", write("e.json", `{"cleanupPeriodDays":"90"}`), 30, "e.json"},
		{"zero is not a period: logs and gives the default", write("f.json", `{"cleanupPeriodDays":0}`), 30, "f.json"},
		{"a negative is not a period: logs and gives the default", write("g.json", `{"cleanupPeriodDays":-5}`), 30, "g.json"},
		{"a file that cannot be read logs and gives the default", dir, 30, dir},
	} {
		t.Run(c.name, func(t *testing.T) {
			buf := captureLog(t)
			if got := CleanupPeriodDays(c.path); got != c.want {
				t.Fatalf("got %d, want %d", got, c.want)
			}
			switch {
			case c.logging == "" && buf.Len() != 0:
				t.Fatalf("a quiet read logged %q", buf.String())
			case c.logging != "" && !strings.Contains(buf.String(), c.logging):
				t.Fatalf("a failed read must log what it lost, naming %q, got %q", c.logging, buf.String())
			}
		})
	}
}
