// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// entryTestReview registers p with a.md and b.md, b.md untouched for 40 days, and runs a check, which
// proposes a Review of b.md.
func entryTestReview(t *testing.T) (env *checkTestEnv, folder string, review wshrpc.MemChange) {
	t.Helper()
	env = checkTestSetup(t)
	folder = checkTestSimple(t, env, "p")
	old := time.Now().Add(-40 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(folder, "b.md"), old, old); err != nil {
		t.Fatal(err)
	}
	checkTestRun(t, env, "p")
	review = checkTestFind(t, checkTestLoad(t, "p"), reviewKind)
	if review.Op.Memories[0] != "b.md" {
		t.Fatalf("want a review of b.md: %+v", review)
	}
	return env, folder, review
}

func entryTestByID(t *testing.T, changes []wshrpc.MemChange, id string) (wshrpc.MemChange, bool) {
	t.Helper()
	for _, c := range changes {
		if c.Id == id {
			return c, true
		}
	}
	return wshrpc.MemChange{}, false
}

func entryTestFromReview(t *testing.T, changes []wshrpc.MemChange, reviewID string) wshrpc.MemChange {
	t.Helper()
	for _, c := range changes {
		if c.FromReview == reviewID {
			return c
		}
	}
	t.Fatalf("no change from review %s in %+v", reviewID, changes)
	return wshrpc.MemChange{}
}

func entryTestRead(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestDecideDelete_appliesWithBackup(t *testing.T) {
	_, folder, review := entryTestReview(t)

	p := checkTestDecide(t, "p", review.Id, wshrpc.MemVerdict_Delete)

	if _, err := os.Stat(filepath.Join(folder, "b.md")); !os.IsNotExist(err) {
		t.Fatalf("delete left b.md: %v", err)
	}
	if got := entryTestRead(t, filepath.Join(folder, "MEMORY.md")); got != "- [A](a.md) — alpha\n" {
		t.Fatalf("delete left the index as %q", got)
	}
	del := entryTestFromReview(t, p.Changes, review.Id)
	if del.Kind != judgeKindDelete || del.Status != checkStatusApplied || del.ApplyId == "" || del.BackupUntil == 0 {
		t.Fatalf("delete change = kind %q status %q applyid %q backupuntil %d", del.Kind, del.Status, del.ApplyId, del.BackupUntil)
	}
	if del.DocLines == nil {
		t.Fatal("a delete change's doclines must be an empty slice, not null on the wire")
	}
	got, ok := entryTestByID(t, p.Changes, review.Id)
	if !ok || got.Status != wshrpc.MemStatus_Superseded || got.SupersededBy != del.Id {
		t.Fatalf("review after delete = %+v (found %v), want superseded by %s", got, ok, del.Id)
	}
	if Pending(got) {
		t.Fatal("a superseded review still reads as pending")
	}
	if p.Index.Lines != 1 {
		t.Fatalf("index not remeasured after delete: %+v", p.Index)
	}
}

func TestDecideDelete_undoReopensReview(t *testing.T) {
	_, folder, review := entryTestReview(t)
	memPath, indexPath := filepath.Join(folder, "b.md"), filepath.Join(folder, "MEMORY.md")
	memBefore, indexBefore := entryTestRead(t, memPath), entryTestRead(t, indexPath)
	p := checkTestDecide(t, "p", review.Id, wshrpc.MemVerdict_Delete)
	del := entryTestFromReview(t, p.Changes, review.Id)

	p = checkTestDecide(t, "p", del.Id, wshrpc.MemVerdict_Undo)

	if entryTestRead(t, memPath) != memBefore || entryTestRead(t, indexPath) != indexBefore {
		t.Fatal("undo didn't restore b.md and MEMORY.md byte for byte")
	}
	if _, ok := entryTestByID(t, p.Changes, del.Id); ok {
		t.Fatalf("undo kept the delete change: %+v", p.Changes)
	}
	got, ok := entryTestByID(t, p.Changes, review.Id)
	if !ok || got.Status != splitStatusOpen || got.SupersededBy != "" {
		t.Fatalf("review after undo = %+v (found %v), want open with no supersededby", got, ok)
	}
}

func TestDecideDelete_undoAfterReviewDropped(t *testing.T) {
	_, folder, review := entryTestReview(t)
	memPath := filepath.Join(folder, "b.md")
	memBefore := entryTestRead(t, memPath)
	p := checkTestDecide(t, "p", review.Id, wshrpc.MemVerdict_Delete)
	del := entryTestFromReview(t, p.Changes, review.Id)
	if _, err := Update("p", func(st *State) error {
		var kept []wshrpc.MemChange
		for _, c := range st.Changes {
			if c.Id != review.Id {
				kept = append(kept, c)
			}
		}
		st.Changes = kept
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	p = checkTestDecide(t, "p", del.Id, wshrpc.MemVerdict_Undo)

	if entryTestRead(t, memPath) != memBefore {
		t.Fatal("undo didn't restore b.md")
	}
	got, ok := entryTestByID(t, p.Changes, del.Id)
	if !ok || got.Status != splitStatusOpen || got.ApplyId != "" {
		t.Fatalf("with its review gone the undone delete should stay, open: %+v (found %v)", got, ok)
	}
}

func TestDecideDelete_conflict(t *testing.T) {
	_, folder, review := entryTestReview(t)
	memPath, indexPath := filepath.Join(folder, "b.md"), filepath.Join(folder, "MEMORY.md")
	writeFile(t, memPath, "edited by hand\n")
	indexBefore := entryTestRead(t, indexPath)

	p := checkTestDecide(t, "p", review.Id, wshrpc.MemVerdict_Delete)

	del := entryTestFromReview(t, p.Changes, review.Id)
	if del.Status != splitStatusConflict || del.ConflictFile != memPath || del.ApplyId != "" {
		t.Fatalf("delete change = status %q conflictfile %q applyid %q", del.Status, del.ConflictFile, del.ApplyId)
	}
	if entryTestRead(t, memPath) != "edited by hand\n" || entryTestRead(t, indexPath) != indexBefore {
		t.Fatal("a conflicted delete touched the files")
	}
	if got, _ := entryTestByID(t, p.Changes, review.Id); got.Status != wshrpc.MemStatus_Superseded || got.SupersededBy != del.Id {
		t.Fatalf("review behind a conflicted delete = %+v, want superseded by it", got)
	}
}

func TestDecideDelete_refusedOnNonReview(t *testing.T) {
	env := checkTestSetup(t)
	folder := checkTestSimple(t, env, "p")
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	checkTestRun(t, env, "p")
	c := checkTestFind(t, checkTestLoad(t, "p"), judgeKindDelete)

	if _, err := Decide("p", c.Id, wshrpc.MemVerdict_Delete); err == nil {
		t.Fatal("delete of a judge change (not a review) must be refused")
	}
	if _, err := os.Stat(filepath.Join(folder, "a.md")); err != nil {
		t.Fatalf("a refused delete touched a.md: %v", err)
	}
	if st := checkTestLoad(t, "p"); len(st.Changes) != 1 || st.Changes[0].Status != splitStatusOpen {
		t.Fatalf("a refused delete changed the state: %+v", st.Changes)
	}
}

func TestDecide_refusesSuperseded(t *testing.T) {
	_, folder, review := entryTestReview(t)
	writeFile(t, filepath.Join(folder, "b.md"), "edited by hand\n")
	checkTestDecide(t, "p", review.Id, wshrpc.MemVerdict_Delete)

	for _, verdict := range []string{wshrpc.MemVerdict_Apply, wshrpc.MemVerdict_Keep, wshrpc.MemVerdict_Delete} {
		if _, err := Decide("p", review.Id, verdict); err == nil {
			t.Fatalf("%s on a superseded review must be refused", verdict)
		}
	}
	if got, _ := entryTestByID(t, checkTestLoad(t, "p").Changes, review.Id); got.Status != wshrpc.MemStatus_Superseded {
		t.Fatalf("a refused verdict moved the superseded review to %q", got.Status)
	}
	if entryTestRead(t, filepath.Join(folder, "b.md")) != "edited by hand\n" {
		t.Fatal("a refused verdict touched b.md")
	}
}

func TestDecideKeepFromReview_restoresReview(t *testing.T) {
	_, folder, review := entryTestReview(t)
	proposal := wshrpc.MemChange{
		Id: "agent-proposal", Kind: judgeKindTrim, Title: "trim b", Source: "agent",
		Op:     wshrpc.MemOp{Folder: folder, Memories: []string{"b.md"}},
		Status: splitStatusOpen, DocLines: []wshrpc.MemDocLine{},
	}
	if _, err := Update("p", func(st *State) error {
		i := entryFind(st, review.Id)
		if i < 0 {
			t.Fatal("review missing")
		}
		st.Changes = append(st.Changes, proposal)
		entrySupersede(st, &st.Changes[i], &st.Changes[len(st.Changes)-1])
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	p := checkTestDecide(t, "p", proposal.Id, wshrpc.MemVerdict_Keep)

	if got, _ := entryTestByID(t, p.Changes, proposal.Id); got.Status != checkStatusKept {
		t.Fatalf("the agent proposal after Back to review is %q, want kept", got.Status)
	}
	got, ok := entryTestByID(t, p.Changes, review.Id)
	if !ok || got.Status != splitStatusOpen || got.SupersededBy != "" {
		t.Fatalf("review after Back to review = %+v (found %v), want open", got, ok)
	}
}
