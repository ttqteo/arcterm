// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package machinestats

import (
	"os"
	"path/filepath"
	"sync"
)

var volumeOnce = sync.OnceValue(func() string {
	// /Volumes holds a link to "/" named after the boot volume (Macintosh HD unless renamed)
	entries, err := os.ReadDir("/Volumes")
	if err == nil {
		for _, e := range entries {
			if target, err := os.Readlink(filepath.Join("/Volumes", e.Name())); err == nil && target == "/" {
				return e.Name()
			}
		}
	}
	return "System disk"
})

// listDisks is the boot volume alone: other volumes are not counted yet.
func listDisks() []Disk { return []Disk{{Name: volumeOnce(), Root: "/"}} }
