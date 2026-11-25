// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestStoreSavesAndLoadsAPair(t *testing.T) {
	s := store{dir: filepath.Join(t.TempDir(), "pairs")} // the folder does not exist yet
	p := newPair("j1", "j2")
	worker(p, "Plan.\n"+pairBlock("O1 open"))
	judge(p, "j1", "Checked.")
	p.Pending = map[string][]string{"w": {"m2"}, "j2": {"m1", "m2"}}
	p.Seen = map[string]int64{"w": 1000, "j1": 2000}
	p.Held = []wshrpc.PairHeld{{Command: "npm run build", Ts: 5}}
	p.Passes = []string{"go test ./..."}
	p.WorkerBriefed = true
	if err := s.save(p); err != nil {
		t.Fatal(err)
	}
	got, err := s.loadActive()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !reflect.DeepEqual(got[0], p) {
		t.Fatalf("loaded %#v\nwant   %#v", got, p)
	}
}

func TestStoreOverwritesWithTheLatestState(t *testing.T) {
	s := store{dir: t.TempDir()}
	p := newPair("j1")
	for _, raw := range []string{"one", "two"} {
		worker(p, raw)
		if err := s.save(p); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.loadActive()
	if err != nil || len(got) != 1 || len(got[0].Messages) != 2 {
		t.Fatalf("loaded %#v, %v: want the one pair holding both messages", got, err)
	}
}

func TestStoreLoadsOnlyActivePairs(t *testing.T) {
	s := store{dir: t.TempDir()}
	relaying, stopped, ended := newPair("j1"), newPair("j1"), newPair("j1")
	relaying.Id, stopped.Id, ended.Id = "a", "b", "c"
	stopped.State, ended.State = StateStopped, StateEnded
	for _, p := range []*Pair{relaying, stopped, ended} {
		if err := s.save(p); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.loadActive()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, p := range got {
		ids[p.Id] = true
	}
	if len(got) != 2 || !ids["a"] || !ids["b"] {
		t.Fatalf("loaded %v: want the relaying and the stopped pair, not the ended one", ids)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "c.json")); err != nil {
		t.Fatalf("an ended pair keeps its file: %v", err)
	}
}

func TestStoreSkipsBrokenFilesAndOthers(t *testing.T) {
	s := store{dir: t.TempDir()}
	good := newPair("j1")
	if err := s.save(good); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"broken.json":   "{not json",
		"empty.json":    "{}",
		"p1.json.tmp":   `{"id":"x","state":"relaying"}`,
		"notes.txt":     "hello",
		"nested.d.json": "[]",
	} {
		if err := os.WriteFile(filepath.Join(s.dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(s.dir, "dir.json"), 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := s.loadActive()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Id != good.Id {
		t.Fatalf("loaded %#v: want only the good pair", got)
	}
}

func TestStoreMissingFolderIsEmpty(t *testing.T) {
	s := store{dir: filepath.Join(t.TempDir(), "never-made")}
	got, err := s.loadActive()
	if err != nil || len(got) != 0 {
		t.Fatalf("loaded %#v, %v: want nothing and no error", got, err)
	}
}

func TestStoreReadAllReadsEveryState(t *testing.T) {
	s := store{dir: t.TempDir()}
	relaying, stopped, ended := newPair("j1"), newPair("j1"), newPair("j1")
	relaying.Id, stopped.Id, ended.Id = "a", "b", "c"
	stopped.State, ended.State = StateStopped, StateEnded
	for _, p := range []*Pair{relaying, stopped, ended} {
		if err := s.save(p); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.readAll()
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]string{}
	for _, p := range got {
		states[p.Id] = p.State
	}
	want := map[string]string{"a": StateRelaying, "b": StateStopped, "c": StateEnded}
	if !reflect.DeepEqual(states, want) {
		t.Fatalf("read %v, want every pair file whatever its state: %v", states, want)
	}
}

// loadActive and readAll never disagree on what a file is: the active pairs are the not-ended ones of readAll
func TestStoreReadAllAndLoadActiveAgree(t *testing.T) {
	s := store{dir: t.TempDir()}
	live, done := newPair("j1"), newPair("j1")
	live.Id, done.Id, done.State = "live", "done", StateEnded
	for _, p := range []*Pair{live, done} {
		if err := s.save(p); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range map[string]string{"broken.json": "{not json", "empty.json": "{}"} {
		if err := os.WriteFile(filepath.Join(s.dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.readAll()
	if err != nil {
		t.Fatal(err)
	}
	active, err := s.loadActive()
	if err != nil {
		t.Fatal(err)
	}
	var notEnded []*Pair
	for _, p := range all {
		if p.State != StateEnded {
			notEnded = append(notEnded, p)
		}
	}
	if len(all) != 2 || !reflect.DeepEqual(active, notEnded) {
		t.Fatalf("readAll %d pairs, loadActive %#v, want the not-ended of readAll %#v", len(all), active, notEnded)
	}
}

func TestStoreReadAllSkipsBrokenFilesAndOthers(t *testing.T) {
	s := store{dir: t.TempDir()}
	ended := newPair("j1")
	ended.State = StateEnded
	if err := s.save(ended); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"broken.json": "{not json",
		"empty.json":  "{}",
		"p1.json.tmp": `{"id":"x","state":"relaying"}`,
		"notes.txt":   "hello",
	} {
		if err := os.WriteFile(filepath.Join(s.dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(s.dir, "dir.json"), 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := s.readAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Id != ended.Id {
		t.Fatalf("read %#v: want only the one good pair, ended as it is", got)
	}
}

func TestStoreReadAllMissingFolderIsEmpty(t *testing.T) {
	s := store{dir: filepath.Join(t.TempDir(), "never-made")}
	got, err := s.readAll()
	if err != nil || len(got) != 0 {
		t.Fatalf("read %#v, %v: want nothing and no error", got, err)
	}
}

func TestStoreReadsOnePairByItsId(t *testing.T) {
	s := store{dir: t.TempDir()}
	p := newPair("j1")
	p.Id, p.State = "p7", StateEnded
	p.Pending, p.Seen = map[string][]string{}, map[string]int64{} // a read pair always has its maps
	if err := s.save(p); err != nil {
		t.Fatal(err)
	}
	got, err := s.read("p7")
	if err != nil || !reflect.DeepEqual(got, p) {
		t.Fatalf("read %#v, %v, want %#v", got, err, p)
	}
	if _, err := s.read("p8"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a pair with no file read as %v, want a not-exist error", err)
	}
	// a file that does not name its own id is no pair under this one
	if err := os.WriteFile(filepath.Join(s.dir, "p9.json"), []byte(`{"id":"other","state":"ended"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.read("p9"); err == nil {
		t.Fatal("a file holding another pair's id was read as p9")
	}
}

// a pair file written with no queues loads with maps the manager can write to
func TestStoreLoadMakesTheMaps(t *testing.T) {
	s := store{dir: t.TempDir()}
	if err := os.WriteFile(filepath.Join(s.dir, "p1.json"), []byte(`{"id":"p1","state":"relaying","worker":{"tab":"w"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := s.loadActive()
	if err != nil || len(got) != 1 {
		t.Fatalf("loaded %#v, %v", got, err)
	}
	if got[0].Pending == nil || got[0].Seen == nil {
		t.Fatalf("Pending %v / Seen %v are nil: the manager would panic on its first write", got[0].Pending, got[0].Seen)
	}
}
