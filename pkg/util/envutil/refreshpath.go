// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package envutil

import (
	"os"
	"strings"
)

// RefreshPath rebuilds this process's PATH from the one the OS holds now, so a shell started after a tool's
// installer changed PATH finds the tool without restarting arcterm. wavesrv's PATH is a copy taken at launch, and
// every terminal, agent and PATH check inherits it: a terminal closed and reopened still missed mole, whose installer
// had added its folder to the user's PATH after arcterm started. Windows only (Windows Terminal does the same for each
// new tab); elsewhere it does nothing, and on a Mac the host probes the login shell's PATH once at launch.
func RefreshPath() {
	fresh, ok := osPath()
	if !ok {
		return
	}
	cur := os.Getenv("PATH")
	if merged := mergePathLists(fresh, cur); merged != cur {
		os.Setenv("PATH", merged)
	}
}

// mergePathLists puts the OS's entries first, in its order, then keeps every current entry it lacks (one the host or
// a dev shell added, or one since removed from the OS PATH), so a refresh never drops a folder a running shell could
// already reach. Entries match case-insensitively and with or without a trailing separator, as Windows treats them.
func mergePathLists(fresh, cur string) string {
	sep := string(os.PathListSeparator)
	seen := make(map[string]bool)
	var out []string
	for _, p := range append(strings.Split(fresh, sep), strings.Split(cur, sep)...) {
		key := strings.ToLower(strings.TrimRight(strings.TrimSpace(p), `\/`))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	return strings.Join(out, sep)
}
