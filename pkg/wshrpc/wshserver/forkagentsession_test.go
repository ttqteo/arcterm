// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// A non-.jsonl path is refused before any read: the file exists, so only the check can fail it.
func TestForkAgentSessionRefusesNonJsonlPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(path, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := (&WshServer{}).ForkAgentSessionCommand(context.Background(), wshrpc.CommandForkAgentSessionData{TranscriptPath: path})
	if err == nil {
		t.Fatal("expected an error for a non-.jsonl path")
	}
	if !strings.Contains(err.Error(), ".jsonl") {
		t.Fatalf("error does not name the .jsonl rule: %v", err)
	}
}
