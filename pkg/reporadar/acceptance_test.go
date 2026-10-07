// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"context"
	"testing"
)

// TestAcceptanceScanIsReadOnly runs a whole scan over a repo with uncommitted work and checks the scan
// left HEAD and the working tree as it found them.
func TestAcceptanceScanIsReadOnly(t *testing.T) {
	ctx := context.Background()
	dir := newRepo(t)
	commitFix(t, dir, "src/a.go")
	writeFile(t, dir, "src/wip.go", "package src\n") // uncommitted, so the dirty mark is not empty
	fakeSessions(t, func(context.Context, string) (auditSessionResult, error) { return hitReply(siblingFile, 3), nil })
	headBefore, err := gitHead(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	dirtyBefore := gitDirtyFingerprint(ctx, dir)

	got := scan(t, dir)
	if got.Status != StatusCompleted || len(got.Findings) != 1 {
		t.Fatalf("status %q findings %d (%s)", got.Status, len(got.Findings), got.FatalError)
	}
	headAfter, err := gitHead(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if headAfter != headBefore || gitDirtyFingerprint(ctx, dir) != dirtyBefore {
		t.Fatal("a scan must not move HEAD or change the working tree")
	}
	if got.StartHead != headBefore || got.EndHead != headBefore {
		t.Errorf("head boundary = %q..%q, want %q", got.StartHead, got.EndHead, headBefore)
	}
	if dirtyBefore == "" || got.StartDirty != dirtyBefore || got.EndDirty != dirtyBefore {
		t.Errorf("dirty mark = %q..%q, want %q", got.StartDirty, got.EndDirty, dirtyBefore)
	}
	if got.WindowStartTs == 0 || got.WindowEndTs < got.WindowStartTs {
		t.Errorf("window = %d..%d", got.WindowStartTs, got.WindowEndTs)
	}
}
