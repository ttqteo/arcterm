// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// how many "name (n)" a Unique write tries before it gives up
const maxDropNameTries = 1000

// FileDropWriteCommand writes one piece of a copy of a file or folder dropped from the OS into a folder of the app
// (the Agent panel's Files tree): see wshrpc.CommandFileDropWriteData. It never replaces what is there.
func (ws *WshServer) FileDropWriteCommand(ctx context.Context, data wshrpc.CommandFileDropWriteData) (string, error) {
	return fileDropWrite(data)
}

func fileDropWrite(data wshrpc.CommandFileDropWriteData) (string, error) {
	if data.Path == "" || !filepath.IsAbs(data.Path) {
		return "", fmt.Errorf("drop write: path %q is not absolute", data.Path)
	}
	path := filepath.Clean(data.Path)
	if data.Offset < 0 || (data.Offset > 0 && (data.Dir || data.Unique)) {
		return "", fmt.Errorf("drop write: offset %d with a folder or a unique name", data.Offset)
	}
	bytes, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return "", fmt.Errorf("drop write: cannot decode the data: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return "", fmt.Errorf("drop write: %w", err)
	}
	if data.Dir {
		return dropMkdir(path, data.Unique)
	}
	if data.Offset > 0 {
		return path, dropAppend(path, data.Offset, bytes)
	}
	return dropCreate(path, data.Unique, bytes)
}

// A folder inside a dropped folder may meet one that is there already (a second drop of the same folder lands under a
// fresh top name, so only a Unique top folder could collide): without Unique, a folder that is there is taken as is.
func dropMkdir(path string, unique bool) (string, error) {
	if !unique {
		if err := os.MkdirAll(path, 0755); err != nil {
			return "", fmt.Errorf("drop write: %w", err)
		}
		return path, nil
	}
	for n := 0; n < maxDropNameTries; n++ {
		p := dropNameAt(path, n)
		err := os.Mkdir(p, 0755)
		if err == nil {
			return p, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", fmt.Errorf("drop write: %w", err)
		}
	}
	return "", fmt.Errorf("drop write: no free name for %q", filepath.Base(path))
}

func dropCreate(path string, unique bool, bytes []byte) (string, error) {
	tries := 1
	if unique {
		tries = maxDropNameTries
	}
	for n := 0; n < tries; n++ {
		p := dropNameAt(path, n)
		f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", fmt.Errorf("drop write: %w", err)
		}
		_, werr := f.Write(bytes)
		cerr := f.Close()
		if werr != nil {
			return "", fmt.Errorf("drop write: %w", werr)
		}
		if cerr != nil {
			return "", fmt.Errorf("drop write: %w", cerr)
		}
		return p, nil
	}
	if !unique {
		return "", fmt.Errorf("drop write: %q is there already", filepath.Base(path))
	}
	return "", fmt.Errorf("drop write: no free name for %q", filepath.Base(path))
}

// a later chunk goes at the end of what came before it: an offset that is not the file's size means a chunk was lost
// or came twice
func dropAppend(path string, offset int64, bytes []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("drop write: %w", err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return fmt.Errorf("drop write: %w", err)
	}
	if info.Size() != offset {
		return fmt.Errorf("drop write: %q has %d bytes, not %d", filepath.Base(path), info.Size(), offset)
	}
	if _, err := f.WriteAt(bytes, offset); err != nil {
		return fmt.Errorf("drop write: %w", err)
	}
	return f.Close()
}

// tar's double extensions stay whole, so "a.tar.gz" becomes "a (1).tar.gz", not "a.tar (1).gz"
var dropDoubleExts = []string{".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"}

// dropNameAt is the path's name with " (n)" before its extension, the path itself for n 0: "a.txt" → "a (1).txt",
// "src" → "src (1)", ".env" → ".env (1)".
func dropNameAt(path string, n int) string {
	if n == 0 {
		return path
	}
	dir, name := filepath.Split(path)
	ext := ""
	lower := strings.ToLower(name)
	for _, d := range dropDoubleExts {
		if strings.HasSuffix(lower, d) && len(name) > len(d) {
			ext = name[len(name)-len(d):]
			break
		}
	}
	if ext == "" {
		// a leading dot names a dotfile, not an extension
		if i := strings.LastIndex(name, "."); i > 0 {
			ext = name[i:]
		}
	}
	return dir + fmt.Sprintf("%s (%d)%s", name[:len(name)-len(ext)], n, ext)
}
