// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileutil

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	// FILE_INFO_BY_HANDLE_CLASS FileRenameInfoEx and its flags (Windows 10 1809+, NTFS)
	fileRenameInfoEx      = 22
	renameReplaceIfExists = 0x1
	renamePosixSemantics  = 0x2

	shareAll = syscall.FILE_SHARE_READ | syscall.FILE_SHARE_WRITE | syscall.FILE_SHARE_DELETE
)

// OpenShared opens path for reading with delete sharing, which os.Open leaves out: a RenameReplacing of the file then
// lands while it is open, and the reader goes on reading the file it opened.
func OpenShared(path string) (*os.File, error) {
	p, err := syscall.UTF16PtrFromString(longPath(path))
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, shareAll, nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	return os.NewFile(uintptr(h), path), nil
}

// longPath is path with the \\?\ prefix CreateFile needs past MAX_PATH, as os does for its own calls.
func longPath(path string) string {
	if len(path) < 248 || !filepath.IsAbs(path) || strings.HasPrefix(path, `\\`) {
		return path
	}
	return `\\?\` + filepath.Clean(path)
}

// renameOnce replaces to with from with POSIX semantics: unlike MoveFileEx, behind os.Rename, it is not refused while
// a reader that shares delete (OpenShared) holds to. Where that is not on offer (an older Windows, FAT, a share), or a
// reader that does not share delete holds the file, it is os.Rename, whose refusal RenameReplacing retries.
func renameOnce(from, to string) error {
	if posixRename(from, to) == nil {
		return nil
	}
	return os.Rename(from, to)
}

func posixRename(from, to string) error {
	abs, err := filepath.Abs(to)
	if err != nil {
		return err
	}
	name, err := windows.UTF16FromString(longPath(abs))
	if err != nil {
		return err
	}
	src, err := windows.UTF16PtrFromString(longPath(from))
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(src, windows.DELETE|windows.SYNCHRONIZE, shareAll, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	// FILE_RENAME_INFO: the flags, the root directory handle (none: the name is absolute), the name's length in bytes
	// without its NUL, then the name
	type renameInfo struct {
		Flags          uint32
		RootDirectory  windows.Handle
		FileNameLength uint32
		FileName       [1]uint16
	}
	size := unsafe.Offsetof(renameInfo{}.FileName) + uintptr(len(name))*2
	buf := make([]uint64, (size+7)/8) // 8-byte aligned, as the handle field needs
	info := (*renameInfo)(unsafe.Pointer(&buf[0]))
	info.Flags = renameReplaceIfExists | renamePosixSemantics
	info.FileNameLength = uint32((len(name) - 1) * 2)
	copy(unsafe.Slice(&info.FileName[0], len(name)), name)
	return windows.SetFileInformationByHandle(h, fileRenameInfoEx, (*byte)(unsafe.Pointer(&buf[0])), uint32(size))
}
