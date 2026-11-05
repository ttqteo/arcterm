// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package effortstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func useTempRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Cleanup(UseRootForTest(root))
	return root
}

func effortFile(root, oid string) string {
	return filepath.Join(root, wavevault.EffortsDir, oid+".json")
}

func mustCreate(t *testing.T, e *waveobj.Effort) *waveobj.Effort {
	t.Helper()
	if err := Create(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	return e
}

func TestCreateGetRoundTrip(t *testing.T) {
	root := useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "Scenario gate clearance", Ticket: "SIEM-1662",
		Chunks: []waveobj.EffortChunk{{Label: "Phase 1", Status: "pending"}, {Label: "Phase 2", Status: "done"}},
		Meta:   waveobj.MetaMapType{"k": "v"}})
	if _, err := os.Stat(effortFile(root, e.OID)); err != nil {
		t.Fatalf("effort file not written: %v", err)
	}
	got, err := Get(context.Background(), e.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Scenario gate clearance" || got.Ticket != "SIEM-1662" || len(got.Chunks) != 2 || got.Meta["k"] != "v" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
	b, err := os.ReadFile(effortFile(root, e.OID))
	if err != nil {
		t.Fatal(err)
	}
	want, _ := wavevault.MarshalEffort(got)
	if !bytes.Equal(b, want) {
		t.Fatalf("file is not MarshalEffort output:\n%s", b)
	}
}

func TestCreateDefaults(t *testing.T) {
	useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "t", Version: 7})
	if e.OID == "" || e.Status != "active" || e.Version != 1 || e.CreatedTs == 0 || e.UpdatedTs != e.CreatedTs {
		t.Fatalf("defaults not set: %+v", e)
	}
	kept := mustCreate(t, &waveobj.Effort{OID: "fixed-oid", Title: "t", Status: "paused"})
	if kept.OID != "fixed-oid" || kept.Status != "paused" {
		t.Fatalf("given oid/status overwritten: %+v", kept)
	}
	if err := Create(context.Background(), &waveobj.Effort{OID: "fixed-oid", Title: "dup"}); err == nil {
		t.Fatal("creating an existing oid succeeded")
	}
}

func TestUpdateBumpsVersionAndTs(t *testing.T) {
	useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "before"})
	time.Sleep(2 * time.Millisecond)
	if err := Update(context.Background(), e.OID, func(x *waveobj.Effort) error {
		x.Title = "after"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got, err := Get(context.Background(), e.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "after" || got.Version != 2 || got.UpdatedTs <= e.UpdatedTs || got.CreatedTs != e.CreatedTs {
		t.Fatalf("update not applied: %+v (created %+v)", got, e)
	}
}

// a pin is a view preference: it is written (Version moves, so sync carries it) but is not work on the
// effort, so UpdatedTs stays where the last real change left it
func TestUpdateKeepTsBumpsVersionKeepsUpdatedTs(t *testing.T) {
	useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "pin me"})
	time.Sleep(2 * time.Millisecond)
	if err := UpdateKeepTs(context.Background(), e.OID, func(x *waveobj.Effort) error {
		x.PinnedTs = 1234
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got, err := Get(context.Background(), e.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got.PinnedTs != 1234 || got.Version != 2 || got.UpdatedTs != e.UpdatedTs {
		t.Fatalf("keep-ts update: got %+v, want PinnedTs 1234, Version 2, UpdatedTs %d", got, e.UpdatedTs)
	}
}

func TestUpdateFnErrorLeavesFileUntouched(t *testing.T) {
	root := useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "keep"})
	before, err := os.ReadFile(effortFile(root, e.OID))
	if err != nil {
		t.Fatal(err)
	}
	boom := errors.New("boom")
	err = Update(context.Background(), e.OID, func(x *waveobj.Effort) error {
		x.Title = "changed"
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("want fn error, got %v", err)
	}
	after, err := os.ReadFile(effortFile(root, e.OID))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatalf("file changed after fn error:\n%s", after)
	}
	got, _ := Get(context.Background(), e.OID)
	if got.Title != "keep" {
		t.Fatalf("cache changed after fn error: %+v", got)
	}
}

func TestUpdateMissingIsNotFound(t *testing.T) {
	useTempRoot(t)
	err := Update(context.Background(), "nope", func(*waveobj.Effort) error { return nil })
	if !errors.Is(err, wstore.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if _, err := Get(context.Background(), "nope"); !errors.Is(err, wstore.ErrNotFound) || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("want not-found error, got %v", err)
	}
}

func TestGetAllSortedByUpdatedDesc(t *testing.T) {
	useTempRoot(t)
	old := mustCreate(t, &waveobj.Effort{Title: "older"})
	time.Sleep(2 * time.Millisecond)
	mid := mustCreate(t, &waveobj.Effort{Title: "mid"})
	time.Sleep(2 * time.Millisecond)
	if err := Update(context.Background(), old.OID, func(*waveobj.Effort) error { return nil }); err != nil {
		t.Fatal(err)
	}
	all, err := GetAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 || all[0].OID != old.OID || all[1].OID != mid.OID {
		t.Fatalf("want newest-updated first, got %+v", all)
	}
}

func TestGetAllEmptyVault(t *testing.T) {
	useTempRoot(t)
	all, err := GetAll(context.Background())
	if err != nil || len(all) != 0 {
		t.Fatalf("want empty list, got %v %v", all, err)
	}
}

func TestGetAllRereadsChangedFile(t *testing.T) {
	root := useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "first"})
	if _, err := GetAll(context.Background()); err != nil { // warm the cache
		t.Fatal(err)
	}
	e.Title = "edited by hand"
	b, _ := wavevault.MarshalEffort(e)
	path := effortFile(root, e.OID)
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
	all, err := GetAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Title != "edited by hand" {
		t.Fatalf("changed file not re-read: %+v", all)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if all, _ := GetAll(context.Background()); len(all) != 0 {
		t.Fatalf("removed file still listed: %+v", all)
	}
}

func TestGetAllSkipsMalformed(t *testing.T) {
	root := useTempRoot(t)
	good := mustCreate(t, &waveobj.Effort{Title: "good"})
	bad := effortFile(root, "broken")
	if err := os.WriteFile(bad, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	all, err := GetAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].OID != good.OID {
		t.Fatalf("want only the good effort, got %+v", all)
	}
	_, err = Get(context.Background(), "broken")
	if err == nil || !strings.Contains(err.Error(), "broken.json") {
		t.Fatalf("want an error naming the file, got %v", err)
	}
}

func TestGetReturnsIndependentCopy(t *testing.T) {
	useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "orig",
		Chunks: []waveobj.EffortChunk{{Label: "a", Notes: []waveobj.EffortNote{{Ts: 1, Text: "n"}},
			WorkRefs: []waveobj.ChunkWorkRef{{Kind: "run", ORef: "run:x"}}}},
		Notes:  []waveobj.EffortNote{{Ts: 1, Text: "n"}},
		Events: []waveobj.EffortEvent{{Ts: 1, Kind: "effort-created"}},
		Meta:   waveobj.MetaMapType{"nested": map[string]any{"k": "v"}, "list": []any{"x"}}})
	mutate := func(x *waveobj.Effort) {
		x.Title = "mutated"
		x.Chunks[0].Label = "mutated"
		x.Chunks[0].Notes[0].Text = "mutated"
		x.Chunks[0].WorkRefs[0].ORef = "mutated"
		x.Notes[0].Text = "mutated"
		x.Events[0].Kind = "mutated"
		x.Meta["nested"].(map[string]any)["k"] = "mutated"
		x.Meta["list"].([]any)[0] = "mutated"
		x.Meta["added"] = true
	}
	got, err := Get(context.Background(), e.OID)
	if err != nil {
		t.Fatal(err)
	}
	mutate(got)
	all, err := GetAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	mutate(all[0])
	for _, read := range []func() (*waveobj.Effort, error){
		func() (*waveobj.Effort, error) { return Get(context.Background(), e.OID) },
		func() (*waveobj.Effort, error) {
			all, err := GetAll(context.Background())
			if err != nil {
				return nil, err
			}
			return all[0], nil
		},
	} {
		x, err := read()
		if err != nil {
			t.Fatal(err)
		}
		if x.Title != "orig" || x.Chunks[0].Label != "a" || x.Chunks[0].Notes[0].Text != "n" ||
			x.Chunks[0].WorkRefs[0].ORef != "run:x" || x.Notes[0].Text != "n" || x.Events[0].Kind != "effort-created" ||
			x.Meta["nested"].(map[string]any)["k"] != "v" || x.Meta["list"].([]any)[0] != "x" || x.Meta.HasKey("added") {
			t.Fatalf("cache corrupted by a caller's mutation: %+v", x)
		}
	}
}

// `wsh effort list` prints each effort as an oref, and agents paste it straight into show/update/delete
func TestGetUpdateDeleteAcceptTheORef(t *testing.T) {
	root := useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "by oref"})
	oref := waveobj.OType_Effort + ":" + e.OID
	if got, err := Get(context.Background(), oref); err != nil || got.OID != e.OID {
		t.Fatalf("Get(%q) = %+v, %v", oref, got, err)
	}
	if err := Update(context.Background(), oref, func(x *waveobj.Effort) error { x.Title = "renamed"; return nil }); err != nil {
		t.Fatalf("Update(%q): %v", oref, err)
	}
	if got, _ := Get(context.Background(), e.OID); got == nil || got.Title != "renamed" {
		t.Fatalf("update by oref did not land: %+v", got)
	}
	if err := Delete(context.Background(), oref); err != nil {
		t.Fatalf("Delete(%q): %v", oref, err)
	}
	if _, err := os.Stat(effortFile(root, e.OID)); !os.IsNotExist(err) {
		t.Fatalf("file still present after delete by oref: %v", err)
	}
}

func TestDeleteRemovesFile(t *testing.T) {
	root := useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "gone"})
	if err := Delete(context.Background(), e.OID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(effortFile(root, e.OID)); !os.IsNotExist(err) {
		t.Fatalf("file still present: %v", err)
	}
	if _, err := Get(context.Background(), e.OID); !errors.Is(err, wstore.ErrNotFound) {
		t.Fatalf("want not found after delete, got %v", err)
	}
	if all, _ := GetAll(context.Background()); len(all) != 0 {
		t.Fatalf("deleted effort still listed: %+v", all)
	}
}

func TestConcurrentUpdatesSameOID(t *testing.T) {
	useTempRoot(t)
	e := mustCreate(t, &waveobj.Effort{Title: "busy"})
	const n = 20
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- Update(context.Background(), e.OID, func(x *waveobj.Effort) error {
				x.Notes = append(x.Notes, waveobj.EffortNote{Ts: int64(i), Text: fmt.Sprintf("note %d", i)})
				return nil
			})
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	got, err := Get(context.Background(), e.OID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Notes) != n || got.Version != n+1 {
		t.Fatalf("want %d notes and version %d, got %d notes, version %d", n, n+1, len(got.Notes), got.Version)
	}
}

func TestWritesPokeSync(t *testing.T) {
	useTempRoot(t)
	wavevault.PokedForTest()
	e := mustCreate(t, &waveobj.Effort{Title: "poke"})
	if !wavevault.PokedForTest() {
		t.Fatal("Create did not poke sync")
	}
	if err := Update(context.Background(), e.OID, func(*waveobj.Effort) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if !wavevault.PokedForTest() {
		t.Fatal("Update did not poke sync")
	}
	if err := Delete(context.Background(), e.OID); err != nil {
		t.Fatal(err)
	}
	if !wavevault.PokedForTest() {
		t.Fatal("Delete did not poke sync")
	}
}
