// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bugreport

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"
)

// logLayout is how the host stamps every line of waveapp.log (src-tauri/src/applog.rs), in local time.
const logLayout = "2006-01-02 15:04:05.000"

const (
	logFileName    = "waveapp.log"
	rolledFileName = "waveapp.1.log"
)

// parseStamp reads the timestamp a log line starts with. A line with none (a panic's stack frames, a wrapped message)
// reports false and belongs to the line before it.
func parseStamp(line []byte) (time.Time, bool) {
	n := len(logLayout)
	if len(line) < n || line[4] != '-' || line[7] != '-' || line[10] != ' ' || line[13] != ':' || line[16] != ':' || line[19] != '.' {
		return time.Time{}, false
	}
	// a fourth fractional digit (or any other character) would make this a different format, not a stamp
	if len(line) > n && line[n] != ' ' && line[n] != '\n' && line[n] != '\r' {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(logLayout, string(line[:n]), time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// nextLine splits off the first line of data, newline included.
func nextLine(data []byte) (line, rest []byte) {
	if i := bytes.IndexByte(data, '\n'); i >= 0 {
		return data[:i+1], data[i+1:]
	}
	return data, nil
}

// needsOlder says whether the window can reach back past the start of the current log file: it can unless that file
// already holds a line stamped at or before the window's start. A file with no stamped line says nothing (it has just
// rolled), so the older one is read.
func needsOlder(current []byte, since time.Time) bool {
	for rest := current; len(rest) > 0; {
		var line []byte
		line, rest = nextLine(rest)
		if ts, ok := parseStamp(line); ok {
			return ts.After(since)
		}
	}
	return true
}

// CutWindow is the lines of the log stamped from since to until, both included. older is the file the log rolled to and
// current the live one; older is read only when current's first stamped line is after since, so the window may reach
// into it. A line with no stamp follows the line before it, in the window or out of it. The result keeps the newest
// lines that fit maxBytes, cut on a line boundary (maxBytes <= 0 is no limit); a single line longer than the limit
// keeps its end.
func CutWindow(older, current []byte, since, until time.Time, maxBytes int) []byte {
	var out []byte
	keep := false
	cut := func(data []byte) {
		for len(data) > 0 {
			var line []byte
			line, data = nextLine(data)
			if ts, ok := parseStamp(line); ok {
				keep = !ts.Before(since) && !ts.After(until)
			}
			if keep {
				out = append(out, line...)
			}
		}
	}
	if len(older) > 0 && needsOlder(current, since) {
		cut(older)
		// a file that ends mid-line must not run into the next one
		if keep && len(out) > 0 && out[len(out)-1] != '\n' {
			out = append(out, '\n')
		}
	}
	cut(current)
	if maxBytes > 0 && len(out) > maxBytes {
		out = capTail(out, maxBytes)
	}
	return out
}

// capTail keeps the end of out within max bytes, starting at a line.
func capTail(out []byte, max int) []byte {
	start := len(out) - max
	if out[start-1] == '\n' {
		return out[start:]
	}
	if i := bytes.IndexByte(out[start:], '\n'); i >= 0 && start+i+1 < len(out) {
		return out[start+i+1:]
	}
	// the newest line alone is longer than the limit: keep its end, from a whole character
	for start < len(out) && !utf8.RuneStart(out[start]) {
		start++
	}
	return out[start:]
}

// windowLog is the text of log.txt: the log lines from since to until read from the data dir's waveapp.log (and
// waveapp.1.log when the file rolled inside the window), or one line saying why there are none.
func windowLog(logDir string, since, until time.Time) []byte {
	if logDir == "" {
		return []byte("(no log directory: this build writes no waveapp.log)\n")
	}
	current, currentErr := os.ReadFile(filepath.Join(logDir, logFileName))
	var older []byte
	olderErr := error(fs.ErrNotExist) // not read unless the window can reach into it
	if needsOlder(current, since) {
		older, olderErr = os.ReadFile(filepath.Join(logDir, rolledFileName))
	}
	if currentErr != nil && olderErr != nil {
		return []byte("(no log file: " + logFileName + " is not in the data directory)\n")
	}
	if cut := CutWindow(older, current, since, until, maxLogBytes); len(cut) > 0 {
		return cut
	}
	return []byte("(no log lines in the last " + logWindow.String() + " before the report)\n")
}
