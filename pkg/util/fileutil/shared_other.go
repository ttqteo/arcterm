// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package fileutil

import "os"

// OpenShared opens path for reading. Unix never holds a rename back for an open reader, so it is os.Open.
func OpenShared(path string) (*os.File, error) {
	return os.Open(path)
}

func renameOnce(from, to string) error {
	return os.Rename(from, to)
}
