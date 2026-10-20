// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The terminal output is kept across runs: the port fallback must read only what the latest start printed, or an old
// run's "Local: http://localhost:5173/" sends a new run to a port something else holds now.
func TestReadLogStartsAtTheMark(t *testing.T) {
	ctx := context.Background()
	const blockId = "logmark-block"
	err := filestore.WFS.MakeFile(ctx, blockId, wavebase.BlockFile_Term, nil, wshrpc.FileOpts{MaxSize: 256 * 1024, Circular: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = filestore.WFS.DeleteZone(ctx, blockId) })

	if got := readLog("logmark-no-file"); got != "" {
		t.Errorf("readLog of a block with no output = %q", got)
	}

	append := func(s string) {
		t.Helper()
		if err := filestore.WFS.AppendData(ctx, blockId, wavebase.BlockFile_Term, []byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	append("  Local: http://localhost:5173/\r\n")
	if p, ok := ScanLocalURL(readLog(blockId)); !ok || p != 5173 {
		t.Fatalf("before any mark the first run's port should show: %d %v", p, ok)
	}

	markLog(blockId)
	if got := readLog(blockId); got != "" {
		t.Errorf("right after the mark readLog = %q, want nothing", got)
	}
	if _, ok := ScanLocalURL(readLog(blockId)); ok {
		t.Error("a URL written before the mark was read")
	}

	append("  Local: http://localhost:5174/\r\n")
	got := readLog(blockId)
	if strings.Contains(got, "5173") {
		t.Errorf("readLog still holds the earlier run's output: %q", got)
	}
	if p, ok := ScanLocalURL(got); !ok || p != 5174 {
		t.Errorf("the URL written after the mark: %d %v", p, ok)
	}

	// the output cleared (the block's own reset) is all newer than the mark
	if err := filestore.WFS.WriteFile(ctx, blockId, wavebase.BlockFile_Term, nil); err != nil {
		t.Fatal(err)
	}
	append("  Local: http://localhost:5175/\r\n")
	if p, ok := ScanLocalURL(readLog(blockId)); !ok || p != 5175 {
		t.Errorf("after the output was cleared: %d %v", p, ok)
	}
}
