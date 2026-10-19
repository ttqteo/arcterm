// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package machinestats

import (
	"fmt"
	"os"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// CTL_CODE(IOCTL_VOLUME_BASE, 0, METHOD_BUFFERED, FILE_ANY_ACCESS)
const ioctlVolumeGetVolumeDiskExtents = 0x00560000

func systemRoot() string {
	d := os.Getenv("SystemDrive")
	if d == "" {
		d = "C:"
	}
	return d + `\`
}

// listDisks is each lettered volume on a disk partition, the system drive first. A virtual drive (Google Drive's,
// a WinFsp or Dokan mount) reports DRIVE_FIXED like a real one; Google Drive's even answers the disk-extents ioctl,
// with one extent of no length.
func listDisks() []Disk {
	sys := systemRoot()
	disks := []Disk{{Name: volumeLabel(sys), Root: sys}}
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return disks
	}
	for i := range 26 {
		if mask&(1<<i) == 0 {
			continue
		}
		root := string(rune('A'+i)) + `:\`
		if strings.EqualFold(root, sys) || !onPartition(root) {
			continue
		}
		disks = append(disks, Disk{Name: volumeLabel(root), Root: root})
	}
	return disks
}

func onPartition(root string) bool {
	p, err := windows.UTF16PtrFromString(root)
	if err != nil || windows.GetDriveType(p) != windows.DRIVE_FIXED {
		return false
	}
	dev, err := windows.UTF16PtrFromString(`\\.\` + strings.TrimSuffix(root, `\`))
	if err != nil {
		return false
	}
	// no access asked: the ioctl is FILE_ANY_ACCESS, and a read handle on a volume needs admin
	h, err := windows.CreateFile(dev, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	// VOLUME_DISK_EXTENTS with one extent; a volume spanning several disks answers ERROR_MORE_DATA
	var ext struct {
		Count  uint32
		_      uint32
		Disk   uint32
		_      uint32
		Offset int64
		Length int64
	}
	var n uint32
	err = windows.DeviceIoControl(h, ioctlVolumeGetVolumeDiskExtents, nil, 0, (*byte)(unsafe.Pointer(&ext)), uint32(unsafe.Sizeof(ext)), &n, nil)
	return err == windows.ERROR_MORE_DATA || (err == nil && ext.Count > 0 && ext.Length > 0)
}

func volumeLabel(root string) string {
	drive := strings.TrimSuffix(root, `\`)
	label := make([]uint16, windows.MAX_PATH+1)
	p, err := windows.UTF16PtrFromString(root)
	if err == nil && windows.GetVolumeInformation(p, &label[0], uint32(len(label)), nil, nil, nil, nil, 0) == nil {
		if s := windows.UTF16ToString(label); s != "" {
			return fmt.Sprintf("%s (%s)", s, drive)
		}
	}
	return fmt.Sprintf("Local Disk (%s)", drive)
}
