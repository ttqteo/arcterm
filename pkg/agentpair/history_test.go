// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// historyDirs is an own folder and a synced one, both made.
func historyDirs(t *testing.T) (own, synced string) {
	t.Helper()
	root := t.TempDir()
	return filepath.Join(root, DirName), filepath.Join(root, SyncedDirName)
}

// savePair writes a pair into dir as the manager (or the sync) would.
func savePair(t *testing.T, dir string, p *Pair) {
	t.Helper()
	if err := (store{dir: dir}).save(p); err != nil {
		t.Fatal(err)
	}
}

// aPair is a pair with an id, a project, a state and an updated time.
func aPair(id, project, state string, updated int64) *Pair {
	p := newPair("j1")
	p.Id, p.Project, p.State, p.UpdatedTs = id, project, state, updated
	return p
}

func historyIds(t *testing.T, own, synced, project string) []string {
	t.Helper()
	infos, err := History(own, synced, project)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, in := range infos {
		ids = append(ids, in.Id)
	}
	return ids
}

func TestHistoryListsEveryStateOfBothFolders(t *testing.T) {
	own, synced := historyDirs(t)
	relaying := aPair("live", "proj", StateRelaying, 3000)
	ended := aPair("done", "proj", StateEnded, 2000)
	ended.StopReason = StopSettled
	far := aPair("far", "proj", StateEnded, 1000)
	far.Worker.Session = "sess-far"
	savePair(t, own, relaying)
	savePair(t, own, ended)
	savePair(t, synced, far)

	infos, err := History(own, synced, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 3 {
		t.Fatalf("listed %d pairs, want 3: %+v", len(infos), infos)
	}
	byId := map[string]int{}
	for i, in := range infos {
		byId[in.Id] = i
	}
	live, done, remote := infos[byId["live"]], infos[byId["done"]], infos[byId["far"]]
	if live.State != StateRelaying || live.Synced {
		t.Errorf("the relaying pair = %+v, want relaying and not synced", live)
	}
	if done.State != StateEnded || done.StopReason != StopSettled || done.Synced {
		t.Errorf("the ended pair = %+v, want ended, settled, not synced", done)
	}
	if remote.State != StateEnded || !remote.Synced || remote.Worker.Session != "sess-far" {
		t.Errorf("the synced pair = %+v, want ended, synced, with its worker's session", remote)
	}
	// Info is what it lists: the same shape the live list gives
	if want := Info(relaying); !reflect.DeepEqual(live, want) {
		t.Errorf("the relaying pair is %+v, want Info's %+v", live, want)
	}
}

func TestHistoryFiltersByProject(t *testing.T) {
	own, synced := historyDirs(t)
	savePair(t, own, aPair("a1", "/work/thesis", StateEnded, 4000))
	savePair(t, own, aPair("b1", "/work/other", StateEnded, 3000))
	savePair(t, synced, aPair("a2", "/work/thesis", StateEnded, 2000))
	savePair(t, synced, aPair("b2", "/work/other", StateEnded, 1000))

	if got, want := historyIds(t, own, synced, ""), []string{"a1", "b1", "a2", "b2"}; !reflect.DeepEqual(got, want) {
		t.Errorf(`project "" listed %v, want every project: %v`, got, want)
	}
	if got, want := historyIds(t, own, synced, "/work/thesis"), []string{"a1", "a2"}; !reflect.DeepEqual(got, want) {
		t.Errorf("the thesis project listed %v, want %v", got, want)
	}
	// a path is cleaned before it is compared (and, on Windows, compared without case)
	if got, want := historyIds(t, own, synced, "/work/thesis/"), []string{"a1", "a2"}; !reflect.DeepEqual(got, want) {
		t.Errorf("the thesis project with a trailing slash listed %v, want %v", got, want)
	}
	if got := historyIds(t, own, synced, "/work/none"); len(got) != 0 {
		t.Errorf("a project with no pairs listed %v", got)
	}
}

func TestHistoryNewestFirstThenById(t *testing.T) {
	own, synced := historyDirs(t)
	savePair(t, own, aPair("c", "proj", StateEnded, 1000))
	savePair(t, own, aPair("b", "proj", StateRelaying, 5000))
	savePair(t, synced, aPair("a", "proj", StateEnded, 5000))
	savePair(t, synced, aPair("d", "proj", StateEnded, 9000))
	// a file saved before the updated time existed sorts by its last message's time
	old := newPair("j1")
	old.Id, old.State = "old", StateEnded
	worker(old, "a reply") // at 1000 ms
	worker(old, "another") // at 2000 ms
	savePair(t, own, old)
	if data, err := os.ReadFile(filepath.Join(own, "old.json")); err != nil || !strings.Contains(string(data), `"updated":0`) {
		t.Fatalf("the old file should carry no updated time: %s, %v", data, err)
	}

	want := []string{"d", "a", "b", "old", "c"}
	if got := historyIds(t, own, synced, ""); !reflect.DeepEqual(got, want) {
		t.Fatalf("order %v, want newest first by updated, ties by id, an unstamped file by its last message: %v", got, want)
	}
}

func TestHistoryPrefersTheOwnCopyOfADoubledId(t *testing.T) {
	own, synced := historyDirs(t)
	savePair(t, own, aPair("p1", "/work/mine", StateEnded, 1000))
	savePair(t, synced, aPair("p1", "/work/theirs", StateRelaying, 9000))

	infos, err := History(own, synced, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 1 || infos[0].Synced || infos[0].Project != "/work/mine" || infos[0].State != StateEnded {
		t.Fatalf("listed %+v, want the own folder's copy alone", infos)
	}
	// the own copy decides the project too: the synced one does not come back under its own project
	if got := historyIds(t, own, synced, "/work/theirs"); len(got) != 0 {
		t.Errorf("the synced copy of a doubled id listed under its project: %v", got)
	}
}

func TestHistoryOfNoFoldersIsAnEmptyList(t *testing.T) {
	own, synced := historyDirs(t) // neither folder is made
	infos, err := History(own, synced, "")
	if err != nil || infos == nil || len(infos) != 0 {
		t.Fatalf("History = %#v, %v, want a non-nil empty list (it reaches the frontend as an array)", infos, err)
	}
}

func TestHistorySkipsABrokenFile(t *testing.T) {
	own, synced := historyDirs(t)
	savePair(t, own, aPair("ok", "proj", StateEnded, 1000))
	if err := os.MkdirAll(synced, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(synced, "broken.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := historyIds(t, own, synced, ""); !reflect.DeepEqual(got, []string{"ok"}) {
		t.Fatalf("listed %v, want the good pair though a synced file does not parse", got)
	}
}

func TestReadFindsAnEndedPairInTheOwnFolder(t *testing.T) {
	own, synced := historyDirs(t)
	p := aPair("done", "proj", StateEnded, 2000)
	p.StopReason = StopSettled
	worker(p, "Plan.\n"+pairBlock("D1 lock the threshold"))
	judge(p, "j1", "Checked.")
	savePair(t, own, p)

	view, err := Read(own, synced, "done")
	if err != nil {
		t.Fatal(err)
	}
	want := View(p)
	if view.Synced || !reflect.DeepEqual(view, want) {
		t.Fatalf("Read = %+v, want View's %+v, not synced", view, want)
	}
	if view.State != StateEnded || len(view.Messages) != 2 || len(view.Decided.Agreed) != 1 {
		t.Fatalf("Read = %+v, want the ended pair's thread and its Decided list", view)
	}
}

func TestReadFindsASyncedPair(t *testing.T) {
	own, synced := historyDirs(t)
	p := aPair("far", "proj", StateRelaying, 2000)
	worker(p, "Plan.\n"+pairBlock("O1 open"))
	savePair(t, synced, p)

	view, err := Read(own, synced, "far")
	if err != nil {
		t.Fatal(err)
	}
	if !view.Synced || view.Id != "far" || len(view.Messages) != 1 {
		t.Fatalf("Read = %+v, want the synced pair, marked synced, with its message", view)
	}
	// what the sync left is read as it was: a relaying pair stays relaying
	if view.State != StateRelaying {
		t.Errorf("state %q, want the file's own", view.State)
	}
}

func TestReadPrefersTheOwnCopyOfADoubledId(t *testing.T) {
	own, synced := historyDirs(t)
	savePair(t, own, aPair("p1", "/work/mine", StateEnded, 1000))
	savePair(t, synced, aPair("p1", "/work/theirs", StateEnded, 9000))
	view, err := Read(own, synced, "p1")
	if err != nil || view.Synced || view.Project != "/work/mine" {
		t.Fatalf("Read = %+v, %v, want the own folder's copy", view, err)
	}
}

func TestReadRefusesAnIdThatCouldNameAnotherFile(t *testing.T) {
	root := t.TempDir()
	own, synced := filepath.Join(root, DirName), filepath.Join(root, SyncedDirName)
	// a pair file one folder up, which "../x" would reach
	savePair(t, root, aPair("x", "proj", StateEnded, 1000))
	savePair(t, own, aPair("ok", "proj", StateEnded, 1000))

	for _, id := range []string{"../x", `..\x`, "a/b", "", "a.b", " ok", "ok ", "ok\n", strings.Repeat("a", 65)} {
		view, err := Read(own, synced, id)
		if err == nil || view != nil {
			t.Errorf("Read(%q) = %+v, %v, want the id refused", id, view, err)
			continue
		}
		if errors.Is(err, ErrNoPair) {
			t.Errorf("Read(%q) = %v: a refused id is not an unknown pair", id, err)
		}
	}
	if _, err := Read(own, synced, "ok"); err != nil {
		t.Errorf("Read(ok): %v", err)
	}
	// well-formed ids, up to 64 characters, name a file: with none, they are an unknown pair
	for _, id := range []string{"A_b-9", strings.Repeat("a", 64)} {
		if _, err := Read(own, synced, id); !errors.Is(err, ErrNoPair) {
			t.Errorf("Read(%q) = %v, want ErrNoPair", id, err)
		}
	}
}

func TestReadAnUnknownIdIsErrNoPair(t *testing.T) {
	own, synced := historyDirs(t)
	savePair(t, own, aPair("p1", "proj", StateEnded, 1000))
	view, err := Read(own, synced, "p2")
	if view != nil || !errors.Is(err, ErrNoPair) || err.Error() != `no pair "p2"` {
		t.Fatalf("Read = %+v, %v, want ErrNoPair with the message the manager gives", view, err)
	}
}

// a file that exists but does not read is not an unknown pair: it is said as it is
func TestReadABrokenFileIsNotErrNoPair(t *testing.T) {
	own, synced := historyDirs(t)
	if err := os.MkdirAll(own, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(own, "bad.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	view, err := Read(own, synced, "bad")
	if view != nil || err == nil || errors.Is(err, ErrNoPair) {
		t.Fatalf("Read = %+v, %v, want an error that says the file did not read", view, err)
	}
}
