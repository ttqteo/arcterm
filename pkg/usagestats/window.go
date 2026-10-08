// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"bytes"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// WindowReader keeps, per transcript, how far it has read and the usage records still inside the window, so a
// poll every few seconds parses only what was appended: Claude transcripts, their subagents' and opencode's shadow
// transcripts are append-only JSONL. A file that shrank was replaced and is read again from the start. A pi
// session, and each of its child sessions, is re-read whole when its size changes. The files and records are
// TranscriptUsage's, so a window counts what the rail counts.
type WindowReader struct {
	mu    sync.Mutex
	files map[string]*windowFile
}

type windowFile struct {
	offset  int64 // Claude and opencode: bytes consumed, up to the last complete line
	size    int64 // pi: the size last parsed
	records []Record
	asked   time.Time
}

func NewWindowReader() *WindowReader {
	return &WindowReader{files: map[string]*windowFile{}}
}

// Window is the usage of path (a Claude, pi or opencode shadow transcript), and of the subagent transcripts it
// spawned, timestamped after now-window, bucketed as TranscriptUsage buckets it. ok is false when path itself
// cannot be read.
func (w *WindowReader) Window(path string, now time.Time, window time.Duration) ([]Bucket, bool) {
	if _, err := os.Stat(path); err != nil {
		return nil, false
	}
	cutoff := now.Add(-window)
	w.mu.Lock()
	defer w.mu.Unlock()
	var recs []Record
	for _, p := range windowPaths(path) {
		recs = append(recs, w.read(p, now, cutoff)...)
	}
	return bucket(dedupe(recs)), true
}

// Forget drops what the reader holds for every file no Window call asked about since before.
func (w *WindowReader) Forget(before time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for p, f := range w.files {
		if f.asked.Before(before) {
			delete(w.files, p)
		}
	}
}

// windowPaths is path and the subagent transcripts TranscriptUsage folds into it: a Claude parent's under its
// subagents dir (subagentRecords), a pi parent's child sessions under its own file stem (piSubagentRecords). A
// parent that spawned none has no such dir and yields only itself.
func windowPaths(path string) []string {
	out := []string{path}
	root := subagentsDir(path)
	if isPiTranscriptPath(path) {
		root = strings.TrimSuffix(path, ".jsonl")
	}
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".jsonl") {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func (w *WindowReader) read(path string, now, cutoff time.Time) []Record {
	f := w.files[path]
	if f == nil {
		f = &windowFile{}
		w.files[path] = f
	}
	f.asked = now
	info, err := os.Stat(path)
	if err == nil {
		switch {
		case isPiTranscriptPath(path):
			if info.Size() != f.size {
				f.records = nil
				if file, perr := pisession.Read(path); perr == nil {
					f.records = extractPi(file, cutoff)
				}
				f.size = info.Size()
			}
		case info.Size() < f.offset:
			// replaced: start over
			lines, consumed := readAppended(path, 0)
			f.offset, f.records = consumed, parseAppended(path, lines)
		case info.Size() > f.offset:
			lines, consumed := readAppended(path, f.offset)
			f.offset += consumed
			f.records = append(f.records, parseAppended(path, lines)...)
		}
	}
	f.records = keepAfter(f.records, cutoff)
	return f.records
}

// parseAppended turns the lines appended to an append-only transcript into records: an opencode shadow's lines are
// usage records already (transcriptRecords routes them to extractOpencodeShadow, and dedupe collapses the plugin's
// per-step re-emits by messageID), a Claude transcript's are filtered down to the ones that carry usage.
func parseAppended(path string, lines []string) []Record {
	if isOpencodeShadowPath(path) {
		return extractOpencodeShadow(lines)
	}
	return extractClaude(filterUsageLines(lines))
}

// readAppended reads path from offset up to its last newline: the complete lines appended since, and how many
// bytes they took. A line still being written stays for the next read.
func readAppended(path string, offset int64) ([]string, int64) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0
	}
	defer file.Close()
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, 0
	}
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, 0
	}
	end := bytes.LastIndexByte(data, '\n')
	if end < 0 {
		return nil, 0
	}
	var lines []string
	for _, ln := range bytes.Split(data[:end], []byte{'\n'}) {
		if len(bytes.TrimSpace(ln)) > 0 {
			lines = append(lines, string(ln))
		}
	}
	return lines, int64(end + 1)
}

func keepAfter(recs []Record, cutoff time.Time) []Record {
	out := recs[:0]
	for _, r := range recs {
		if r.TS.After(cutoff) {
			out = append(out, r)
		}
	}
	return out
}
