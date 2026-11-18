// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/remotemode"
)

// RemoteTranscript is remotemode.TranscriptHook: it feeds watchTranscript's batches to send as chunks, the first one
// the backlog (Backlog true), and returns the first error from send or the stream, nil once ctx is done.
//
// A from below 0 makes the backlog the last defaultTranscriptTailLines complete lines. Otherwise, as long as from is a
// line boundary the file still has, the backlog is every line from byte offset from on, so a phone that reconnects
// with the End of the last chunk it got continues with no gap and no duplicate; any other from is a stale offset and
// the backlog is the tail again. Each chunk's Cursor is the offset its first line starts at (that of an empty
// backlog, where it began reading), and End the offset past its last line.
func RemoteTranscript(ctx context.Context, path string, from int64, send func(remotemode.TranscriptChunk) error) error {
	return watchTranscript(ctx, path, defaultTranscriptTailLines, from, func(b transcriptBatch) error {
		return send(remotemode.TranscriptChunk{Lines: b.lines, Cursor: b.cursor, End: b.end, Backlog: b.backlog})
	})
}

// RemoteTranscriptPage is remotemode.TranscriptPageHook: up to maxLines complete non-empty lines of the transcript at
// path that end at byte offset before (clamped to the file's size), and Cursor, the offset the first of them starts at,
// which the phone asks for the page before. Only whole newline-terminated lines count, so a last line still being
// written, or one a before inside a line cuts, is left out. A page with no line has Cursor 0: the session's start.
// It reads only the tail of the range (readTail), never the whole file.
func RemoteTranscriptPage(path string, before int64, maxLines int) (remotemode.TranscriptChunk, error) {
	if maxLines <= 0 {
		maxLines = defaultTranscriptTailLines
	}
	f, size, err := openTranscript(path)
	if err != nil {
		return remotemode.TranscriptChunk{}, err
	}
	defer f.Close()
	if before < 0 || before > size {
		before = size
	}
	// One extra line: readTail counts an unterminated last line, which is dropped below.
	off, data, err := readTail(f, before, maxLines+1)
	if err != nil {
		return remotemode.TranscriptChunk{}, err
	}
	lines, rest := splitTranscriptLines(data, off)
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	page := remotemode.TranscriptChunk{Lines: transcriptLineTexts(lines), End: off + int64(len(data)-len(rest))}
	if len(lines) > 0 {
		page.Cursor = lines[0].start
	}
	return page, nil
}
