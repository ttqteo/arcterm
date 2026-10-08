// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"runtime"
	"testing"
)

// skipUnlessWindows skips a test whose fixtures are Windows paths: a drive letter, backslash separators,
// `;`-separated lists. filepath splits those only on Windows, so elsewhere the test checks nothing real.
func skipUnlessWindows(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("fixtures are Windows paths")
	}
}
