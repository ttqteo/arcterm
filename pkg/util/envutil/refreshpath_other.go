// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package envutil

func osPath() (string, bool) {
	return "", false
}
