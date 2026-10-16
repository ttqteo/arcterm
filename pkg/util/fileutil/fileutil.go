// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileutil

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

type ByteRangeType struct {
	All     bool
	Start   int64
	End     int64 // inclusive; only valid when OpenEnd is false
	OpenEnd bool  // true when range is "N-" (read from Start to EOF)
}

func ParseByteRange(rangeStr string) (ByteRangeType, error) {
	if rangeStr == "" {
		return ByteRangeType{All: true}, nil
	}
	// handle open-ended range "N-"
	if len(rangeStr) > 0 && rangeStr[len(rangeStr)-1] == '-' {
		var start int64
		_, err := fmt.Sscanf(rangeStr, "%d-", &start)
		if err != nil || start < 0 {
			return ByteRangeType{}, errors.New("invalid byte range")
		}
		return ByteRangeType{Start: start, OpenEnd: true}, nil
	}
	var start, end int64
	_, err := fmt.Sscanf(rangeStr, "%d-%d", &start, &end)
	if err != nil {
		return ByteRangeType{}, errors.New("invalid byte range")
	}
	if start < 0 || end < 0 || start > end {
		return ByteRangeType{}, errors.New("invalid byte range")
	}
	// End is inclusive (HTTP byte range semantics: bytes=0-999 means 1000 bytes)
	return ByteRangeType{Start: start, End: end}, nil
}

const (
	winFlagSoftlink = uint32(0x8000) // FILE_ATTRIBUTE_REPARSE_POINT
	winFlagJunction = uint32(0x80)   // FILE_ATTRIBUTE_JUNCTION
)

func WinSymlinkDir(path string, bits os.FileMode) bool {
	// Windows compatibility layer doesn't expose symlink target type through fileInfo
	// so we need to check file attributes and extension patterns
	isFileSymlink := func(filepath string) bool {
		if len(filepath) == 0 {
			return false
		}
		return strings.LastIndex(filepath, ".") > strings.LastIndex(filepath, "/")
	}

	flags := uint32(bits >> 12)

	if flags == winFlagSoftlink {
		return !isFileSymlink(path)
	} else if flags == winFlagJunction {
		return true
	} else {
		return false
	}
}

// on error just returns ""
// does not return "application/octet-stream" as this is considered a detection failure
// can pass an existing fileInfo to avoid re-statting the file
// falls back to text/plain for 0 byte files
func DetectMimeType(path string, fileInfo fs.FileInfo, extended bool) string {
	if fileInfo == nil {
		statRtn, err := os.Stat(path)
		if err != nil {
			return ""
		}
		fileInfo = statRtn
	}

	if fileInfo.IsDir() || WinSymlinkDir(path, fileInfo.Mode()) {
		return "directory"
	}
	if fileInfo.Mode()&os.ModeNamedPipe == os.ModeNamedPipe {
		return "pipe"
	}
	charDevice := os.ModeDevice | os.ModeCharDevice
	if fileInfo.Mode()&charDevice == charDevice {
		return "character-special"
	}
	if fileInfo.Mode()&os.ModeDevice == os.ModeDevice {
		return "block-special"
	}
	ext := strings.ToLower(filepath.Ext(path))
	if mimeType, ok := StaticMimeTypeMap[ext]; ok {
		return mimeType
	}
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return mimeType
	}
	if fileInfo.Size() == 0 {
		return "text/plain"
	}
	if !extended {
		return ""
	}
	fd, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer fd.Close()
	buf := make([]byte, 512)
	// ignore the error (EOF / UnexpectedEOF is fine, just process how much we got back)
	n, _ := io.ReadAtLeast(fd, buf, 512)
	if n == 0 {
		return ""
	}
	buf = buf[:n]
	rtn := http.DetectContentType(buf)
	if rtn == "application/octet-stream" {
		return ""
	}
	return rtn
}

func AtomicWriteFile(fileName string, data []byte, perm os.FileMode) error {
	tmpFileName := fileName + TempFileSuffix
	if err := os.WriteFile(tmpFileName, data, perm); err != nil {
		if removeErr := os.Remove(tmpFileName); removeErr != nil && !os.IsNotExist(removeErr) {
			return fmt.Errorf("failed to write temp file %q: %w (also failed to remove temp file: %v)", tmpFileName, err, removeErr)
		}
		return err
	}
	if err := renameReplacing(tmpFileName, fileName); err != nil {
		if removeErr := os.Remove(tmpFileName); removeErr != nil && !os.IsNotExist(removeErr) {
			return fmt.Errorf("failed to rename temp file %q to %q: %w (also failed to remove temp file: %v)", tmpFileName, fileName, err, removeErr)
		}
		return err
	}
	return nil
}

// windows refuses to rename over a file another handle holds open, which a reader such as wavesrv's config watcher
// does for a few milliseconds at a time, so the replace retries briefly before giving up
const (
	renameRetryFor      = time.Second
	renameRetryMaxDelay = 50 * time.Millisecond
)

func renameReplacing(from, to string) error {
	deadline := time.Now().Add(renameRetryFor)
	for delay := time.Millisecond; ; delay = min(delay*2, renameRetryMaxDelay) {
		err := os.Rename(from, to)
		if err == nil || runtime.GOOS != "windows" || !errors.Is(err, fs.ErrPermission) || time.Now().After(deadline) {
			return err
		}
		time.Sleep(delay)
	}
}

var (
	systemBinDirs = []string{
		"/bin/",
		"/usr/bin/",
		"/usr/local/bin/",
		"/opt/bin/",
		"/sbin/",
		"/usr/sbin/",
	}
	suspiciousPattern = regexp.MustCompile(`[:;#!&$\t%="|>{}]`)
	flagPattern       = regexp.MustCompile(` --?[a-zA-Z0-9]`)
)

// IsInitScriptPath tries to determine if the input string is a path to a script
// rather than an inline script content.
func IsInitScriptPath(input string) bool {
	if len(input) == 0 || strings.Contains(input, "\n") {
		return false
	}

	if suspiciousPattern.MatchString(input) {
		return false
	}

	if flagPattern.MatchString(input) {
		return false
	}

	// Check for home directory path
	if strings.HasPrefix(input, "~/") {
		return true
	}

	// Path must be absolute (if not home directory)
	if !filepath.IsAbs(input) {
		return false
	}

	// Check if path starts with system binary directories
	normalizedPath := filepath.ToSlash(input)
	for _, binDir := range systemBinDirs {
		if strings.HasPrefix(normalizedPath, binDir) {
			return false
		}
	}

	return true
}

const (
	TempFileSuffix  = ".tmp"
	MaxEditFileSize = 5 * 1024 * 1024 // 5MB
)
