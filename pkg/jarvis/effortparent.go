// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

// LinkMakesCycle reports whether putting child under parent would make child its own ancestor: it walks parentOf up
// from parent and fails on reaching child. The walk stops at a depth no real tree reaches, so a cycle already stored
// cannot hang it.
func LinkMakesCycle(child, parent string, parentOf func(oid string) (string, error)) (bool, error) {
	for cur, depth := parent, 0; cur != "" && depth < 64; depth++ {
		if cur == child {
			return true, nil
		}
		next, err := parentOf(cur)
		if err != nil {
			return false, err
		}
		cur = next
	}
	return false, nil
}
