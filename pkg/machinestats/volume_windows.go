// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package machinestats

import (
	"fmt"
	"os"
	"strings"
	"sync"

	"golang.org/x/sys/windows"
)

func systemRoot() string {
	d := os.Getenv("SystemDrive")
	if d == "" {
		d = "C:"
	}
	return d + `\`
}

var volumeOnce = sync.OnceValue(func() string {
	root := systemRoot()
	drive := strings.TrimSuffix(root, `\`)
	label := make([]uint16, windows.MAX_PATH+1)
	p, err := windows.UTF16PtrFromString(root)
	if err == nil && windows.GetVolumeInformation(p, &label[0], uint32(len(label)), nil, nil, nil, nil, 0) == nil {
		if s := windows.UTF16ToString(label); s != "" {
			return fmt.Sprintf("%s (%s)", s, drive)
		}
	}
	return fmt.Sprintf("Local Disk (%s)", drive)
})

func volumeName() string { return volumeOnce() }
