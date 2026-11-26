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
	got, err := s.readAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !reflect.DeepEqual(got[0], p) {
		t.Fatalf("loaded %#v\nwant   %#v", got, p)
	}
}

// a judge's launched flag, a message's withheld mark and the pair's judge-tokens flag survive a save and a read
func TestStoreKeepsTheRoundFlags(t *testing.T) {
	s := store{dir: t.TempDir()}
	p := newPair("j1")
	p.Judges[0].Launched, p.JudgeTokens = true, true
	worker(p, "Plan.")
	judge(p, "j1", "Nothing to add.")
	p.Messages[1].Withheld = true
	if err := s.save(p); err != nil {
		t.Fatal(err)
	}
	got, err := s.read(p.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Judges[0].Launched || !got.JudgeTokens || !got.Messages[1].Withheld || got.Messages[0].Withheld {
		t.Fatalf("read launched %v, judgetokens %v, withheld %v / %v: want them as saved", got.Judges[0].Launched, got.JudgeTokens, got.Messages[0].Withheld, got.Messages[1].Withheld)
	}
	// a pair saved without them reads them as false
	plain := newPair("j1")
	plain.Id = "plain"
	if err := s.save(plain); err != nil {
		t.Fatal(err)
	}
	if got, err := s.read("plain"); err != nil || got.Judges[0].Launched || got.JudgeTokens {
		t.Fatalf("a pair with neither flag read as %+v, %v", got, err)
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
	got, err := s.readAll()
	if err != nil || len(got) != 1 || len(got[0].Messages) != 2 {
		t.Fatalf("loaded %#v, %v: want the one pair holding both messages", got, err)
	}
}

// the index splits what readAll read into the pairs it keeps and the ended ones it only learns each tab's newest from
func TestStoreSplitsActiveFromEnded(t *testing.T) {
	s := store{dir: t.TempDir()}
	relaying, stopped, ended := newPair("j1"), newPair("j1"), newPair("j1")
	relaying.Id, stopped.Id, ended.Id = "a", "b", "c"
	stopped.State, ended.State = StateStopped, StateEnded
	for _, p := range []*Pair{relaying, stopped, ended} {
		if err := s.save(p); err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.readAll()
	if err != nil {
		t.Fatal(err)
	}
	active, done := split(all)
	ids := func(pairs []*Pair) map[string]bool {
		m := map[string]bool{}
		for _, p := range pairs {
			m[p.Id] = true
		}
		return m
	}
	if got := ids(active); len(active) != 2 || !got["a"] || !got["b"] {
		t.Fatalf("active %v: want the relaying and the stopped pair, not the ended one", got)
	}
	if got := ids(done); len(done) != 1 || !got["c"] {
		t.Fatalf("ended %v: want the ended pair alone", got)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "c.json")); err != nil {
		t.Fatalf("an ended pair keeps its file: %v", err)
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
		// a JSON file that is no pair (an array): it does not parse as one, and is skipped
		"nested.d.json": "[]",
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
	got, err := s.readAll()
	if err != nil || len(got) != 1 {
		t.Fatalf("loaded %#v, %v", got, err)
	}
	if got[0].Pending == nil || got[0].Seen == nil {
		t.Fatalf("Pending %v / Seen %v are nil: the manager would panic on its first write", got[0].Pending, got[0].Seen)
	}
}
