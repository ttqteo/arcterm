// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestGetSessionPeekRefusesEmptyPath(t *testing.T) {
	_, err := (&WshServer{}).GetSessionPeekCommand(context.Background(), wshrpc.CommandGetSessionPeekData{Count: 5})
	if err == nil {
		t.Fatal("expected an error for an empty path")
	}
	if strings.HasPrefix(err.Error(), "reading session peek") {
		t.Fatalf("empty path reached the reader: %v", err)
	}
}

// A non-.jsonl path is refused before any read: the file exists, so a read would not fail on its own.
func TestGetSessionPeekRefusesNonJsonlPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(path, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := (&WshServer{}).GetSessionPeekCommand(context.Background(), wshrpc.CommandGetSessionPeekData{TranscriptPath: path, Count: 5})
	if err == nil {
		t.Fatal("expected an error for a non-.jsonl path")
	}
	if strings.HasPrefix(err.Error(), "reading session peek") {
		t.Fatalf("non-.jsonl path reached the reader: %v", err)
	}
	if !strings.Contains(err.Error(), ".jsonl") {
		t.Fatalf("error does not name the .jsonl rule: %v", err)
	}
}

func TestGetSessionPeekMissingFileIsWrapped(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gone.jsonl")
	_, err := (&WshServer{}).GetSessionPeekCommand(context.Background(), wshrpc.CommandGetSessionPeekData{TranscriptPath: path, Count: 5})
	if err == nil {
		t.Fatal("expected an error for a missing file")
	}
	if !strings.HasPrefix(err.Error(), "reading session peek: ") {
		t.Fatalf("error not wrapped as 'reading session peek: ...': %v", err)
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("error does not carry the missing file: %v", err)
	}
}
