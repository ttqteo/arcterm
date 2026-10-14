// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runqueue

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// useTempStore points the store at a fresh file and a fixed clock, and puts both back after the test.
func useTempStore(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "runqueue.json")
	oldPath, oldNow := storePath, now
	storePath = func() string { return path }
	now = func() time.Time { return time.UnixMilli(1_700_000_000_000) }
	t.Cleanup(func() { storePath, now = oldPath, oldNow })
	return path
}

func addPlan(t *testing.T, title, after string) wshrpc.RunQueueEntry {
	t.Helper()
	e, err := Add(wshrpc.RunQueueEntry{
		Title:       title,
		ProjectPath: "/proj",
		After:       after,
		Data:        wshrpc.CommandCreateRunData{PlanPath: title + ".md", OriginTabId: "tab-1"},
	})
	if err != nil {
		t.Fatalf("Add(%s): %v", title, err)
	}
	return e
}

func ids(t *testing.T) []string {
	t.Helper()
	list, err := List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	out := make([]string, 0, len(list))
	for _, e := range list {
		out = append(out, e.Id)
	}
	return out
}

func sameIds(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func TestMissingFileListsEmpty(t *testing.T) {
	useTempStore(t)
	list, err := List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if list == nil || len(list) != 0 {
		t.Errorf("List = %#v, want an empty, non-nil list", list)
	}
}

func TestAddListRoundTrip(t *testing.T) {
	path := useTempStore(t)
	a := addPlan(t, "alpha", "")
	b := addPlan(t, "beta", "run-1")
	c := addPlan(t, "gamma", a.Id)

	if !strings.HasPrefix(a.Id, "q-") || len(a.Id) != len("q-")+4 {
		t.Errorf("id = %q, want q- and 4 hex", a.Id)
	}
	if a.State != wshrpc.RunQueueState_Waiting {
		t.Errorf("state = %q, want waiting", a.State)
	}
	if a.QueuedTs != 1_700_000_000_000 {
		t.Errorf("queuedts = %d, want the clock's", a.QueuedTs)
	}
	if !sameIds(ids(t), a.Id, b.Id, c.Id) {
		t.Errorf("order = %v, want %v", ids(t), []string{a.Id, b.Id, c.Id})
	}

	list, _ := List()
	got := list[1]
	if got.Title != "beta" || got.After != "run-1" || got.ProjectPath != "/proj" ||
		got.Data.PlanPath != "beta.md" || got.Data.OriginTabId != "tab-1" {
		t.Errorf("entry did not round trip: %+v", got)
	}
	if list[2].After != a.Id {
		t.Errorf("after = %q, want the first entry's id %q", list[2].After, a.Id)
	}

	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("the temp file of the atomic write was left behind (stat err %v)", err)
	}
}

func TestAddOverridesCallerState(t *testing.T) {
	useTempStore(t)
	e, err := Add(wshrpc.RunQueueEntry{Id: "q-zzzz", State: wshrpc.RunQueueState_Blocked, Reason: "x", QueuedTs: 5, Title: "t"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if e.Id == "q-zzzz" || e.State != wshrpc.RunQueueState_Waiting || e.Reason != "" || e.QueuedTs != 1_700_000_000_000 {
		t.Errorf("Add kept the caller's id, state, reason or time: %+v", e)
	}
}

func TestAddIdsAreUnique(t *testing.T) {
	useTempStore(t)
	for i := range 40 {
		addPlan(t, fmt.Sprintf("p%d", i), "")
	}
	seen := map[string]bool{}
	for _, id := range ids(t) {
		if seen[id] {
			t.Fatalf("duplicate id %s", id)
		}
		seen[id] = true
	}
}

func TestAddRetriesAColliding(t *testing.T) {
	useTempStore(t)
	old := newId
	t.Cleanup(func() { newId = old })
	seq := []string{"q-aaaa", "q-aaaa", "q-aaaa", "q-bbbb"}
	newId = func() string {
		id := seq[0]
		seq = seq[1:]
		return id
	}
	a := addPlan(t, "one", "")
	b := addPlan(t, "two", "")
	if a.Id != "q-aaaa" || b.Id != "q-bbbb" {
		t.Errorf("ids = %s, %s, want q-aaaa then the retried q-bbbb", a.Id, b.Id)
	}
}

func TestAddGivesUpWhenEveryIdCollides(t *testing.T) {
	useTempStore(t)
	old := newId
	t.Cleanup(func() { newId = old })
	newId = func() string { return "q-aaaa" }
	addPlan(t, "one", "")
	if _, err := Add(wshrpc.RunQueueEntry{Title: "two"}); err == nil {
		t.Error("Add with only colliding ids succeeded, want an error")
	}
	if got := ids(t); !sameIds(got, "q-aaaa") {
		t.Errorf("a failed Add changed the queue: %v", got)
	}
}

func TestMoveFirst(t *testing.T) {
	useTempStore(t)
	a, b, c := addPlan(t, "a", ""), addPlan(t, "b", ""), addPlan(t, "c", "")

	if err := MoveFirst(c.Id); err != nil {
		t.Fatalf("MoveFirst: %v", err)
	}
	if got := ids(t); !sameIds(got, c.Id, a.Id, b.Id) {
		t.Errorf("order = %v, want %v", got, []string{c.Id, a.Id, b.Id})
	}
	if err := MoveFirst(c.Id); err != nil {
		t.Fatalf("MoveFirst on the head: %v", err)
	}
	if got := ids(t); !sameIds(got, c.Id, a.Id, b.Id) {
		t.Errorf("moving the head changed the order: %v", got)
	}
}

func TestRemove(t *testing.T) {
	useTempStore(t)
	a, b, c := addPlan(t, "a", ""), addPlan(t, "b", ""), addPlan(t, "c", "")
	if err := Remove(b.Id); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if got := ids(t); !sameIds(got, a.Id, c.Id) {
		t.Errorf("order = %v, want %v", got, []string{a.Id, c.Id})
	}
}

func TestSetBlockedThenWaiting(t *testing.T) {
	useTempStore(t)
	a := addPlan(t, "a", "")
	if err := SetBlocked(a.Id, "Learned additions was held"); err != nil {
		t.Fatalf("SetBlocked: %v", err)
	}
	list, _ := List()
	if list[0].State != wshrpc.RunQueueState_Blocked || list[0].Reason != "Learned additions was held" {
		t.Errorf("after SetBlocked: %+v", list[0])
	}
	if err := SetWaiting(a.Id); err != nil {
		t.Fatalf("SetWaiting: %v", err)
	}
	list, _ = List()
	if list[0].State != wshrpc.RunQueueState_Waiting || list[0].Reason != "" {
		t.Errorf("after SetWaiting: %+v", list[0])
	}
}

func TestUnknownIdErrors(t *testing.T) {
	useTempStore(t)
	addPlan(t, "a", "")
	ops := map[string]func(string) error{
		"Remove":     Remove,
		"MoveFirst":  MoveFirst,
		"SetBlocked": func(id string) error { return SetBlocked(id, "why") },
		"SetWaiting": SetWaiting,
	}
	for name, op := range ops {
		err := op("q-nope")
		if err == nil {
			t.Errorf("%s of an unknown id succeeded", name)
			continue
		}
		if !strings.Contains(err.Error(), "q-nope") {
			t.Errorf("%s error %q does not name the id", name, err)
		}
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s error %q is not ErrNotFound", name, err)
		}
	}
	if got := ids(t); len(got) != 1 {
		t.Errorf("a failed op changed the queue: %v", got)
	}
}

func TestResolve(t *testing.T) {
	useTempStore(t)
	old := newId
	t.Cleanup(func() { newId = old })
	seq := []string{"q-3f2a", "q-3f9c", "q-a001"}
	newId = func() string {
		id := seq[0]
		seq = seq[1:]
		return id
	}
	addPlan(t, "one", "")
	addPlan(t, "two", "")
	addPlan(t, "three", "")

	if e, err := Resolve("q-3f2a"); err != nil || e.Title != "one" {
		t.Errorf("exact: %+v, %v", e, err)
	}
	if e, err := Resolve("q-a"); err != nil || e.Title != "three" {
		t.Errorf("unique prefix: %+v, %v", e, err)
	}
	_, err := Resolve("q-3f")
	if err == nil {
		t.Fatal("an ambiguous prefix resolved")
	}
	if !strings.Contains(err.Error(), "q-3f2a") || !strings.Contains(err.Error(), "q-3f9c") {
		t.Errorf("ambiguity error %q does not name the matches", err)
	}
	if _, err := Resolve("q-zz"); err == nil || !strings.Contains(err.Error(), "q-zz") {
		t.Errorf("no match error = %v, want one naming q-zz", err)
	}
	if _, err := Resolve(""); err == nil {
		t.Error("an empty prefix resolved")
	}
}

func TestRetarget(t *testing.T) {
	useTempStore(t)
	a := addPlan(t, "a", "")
	b := addPlan(t, "b", a.Id)
	c := addPlan(t, "c", a.Id)
	d := addPlan(t, "d", "run-9")
	e := addPlan(t, "e", "")

	if err := Retarget(a.Id, "run-1"); err != nil {
		t.Fatalf("Retarget: %v", err)
	}
	list, _ := List()
	wantAfter := map[string]string{a.Id: "", b.Id: "run-1", c.Id: "run-1", d.Id: "run-9", e.Id: ""}
	for _, entry := range list {
		if entry.After != wantAfter[entry.Id] {
			t.Errorf("%s after = %q, want %q", entry.Title, entry.After, wantAfter[entry.Id])
		}
	}
	if !sameIds(ids(t), a.Id, b.Id, c.Id, d.Id, e.Id) {
		t.Errorf("Retarget changed the order: %v", ids(t))
	}
}

func TestRetargetWithNoMatchWritesNothing(t *testing.T) {
	path := useTempStore(t)
	addPlan(t, "a", "run-9")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, time.Unix(1, 0), time.Unix(1, 0)); err != nil {
		t.Fatal(err)
	}
	if err := Retarget("q-none", "run-1"); err != nil {
		t.Fatalf("Retarget with no match: %v", err)
	}
	after, _ := os.Stat(path)
	if !after.ModTime().Equal(time.Unix(1, 0)) || after.Size() != before.Size() {
		t.Error("a Retarget that matched nothing rewrote the file")
	}
}

func TestRetargetNeedsBothIds(t *testing.T) {
	useTempStore(t)
	addPlan(t, "a", "")
	if err := Retarget("", "run-1"); err == nil {
		t.Error("Retarget from an empty id would rewrite every entry with no After, and succeeded")
	}
	if err := Retarget("q-a", ""); err == nil {
		t.Error("Retarget to an empty id succeeded")
	}
	list, _ := List()
	if list[0].After != "" {
		t.Errorf("a refused Retarget changed an entry: %+v", list[0])
	}
}

func TestCorruptFileIsAnError(t *testing.T) {
	path := useTempStore(t)
	if err := os.WriteFile(path, []byte("{not json"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := List(); err == nil {
		t.Error("List of a corrupt file succeeded")
	}
	if _, err := Add(wshrpc.RunQueueEntry{Title: "x"}); err == nil {
		t.Error("Add over a corrupt file succeeded, which would overwrite it")
	}
}

func TestConcurrentAdds(t *testing.T) {
	useTempStore(t)
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := range 20 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := Add(wshrpc.RunQueueEntry{Title: fmt.Sprintf("p%d", i)})
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("Add: %v", err)
		}
	}
	got := ids(t)
	if len(got) != 20 {
		t.Fatalf("entries = %d, want 20", len(got))
	}
	seen := map[string]bool{}
	for _, id := range got {
		if seen[id] {
			t.Errorf("duplicate id %s", id)
		}
		seen[id] = true
	}
}
