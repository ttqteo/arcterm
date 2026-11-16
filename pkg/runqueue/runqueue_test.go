// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runqueue

import (
	"encoding/json"
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

// addPlan queues a plan after the ids given; an empty id is no After.
func addPlan(t *testing.T, title string, after ...string) wshrpc.RunQueueEntry {
	t.Helper()
	var afterIds []string
	for _, a := range after {
		if a != "" {
			afterIds = append(afterIds, a)
		}
	}
	e, err := Add(wshrpc.RunQueueEntry{
		Title:       title,
		ProjectPath: "/proj",
		After:       afterIds,
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
	if got.Title != "beta" || !sameIds(got.After, "run-1") || got.ProjectPath != "/proj" ||
		got.Data.PlanPath != "beta.md" || got.Data.OriginTabId != "tab-1" {
		t.Errorf("entry did not round trip: %+v", got)
	}
	if !sameIds(list[2].After, a.Id) {
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
	if err := SetBlocked(a.Id, "Learned additions was held", "run-1"); err != nil {
		t.Fatalf("SetBlocked: %v", err)
	}
	list, _ := List()
	if list[0].State != wshrpc.RunQueueState_Blocked || list[0].Reason != "Learned additions was held" || list[0].BlockedOn != "run-1" {
		t.Errorf("after SetBlocked: %+v", list[0])
	}
	if err := SetWaiting(a.Id); err != nil {
		t.Fatalf("SetWaiting: %v", err)
	}
	list, _ = List()
	if list[0].State != wshrpc.RunQueueState_Waiting || list[0].Reason != "" || list[0].BlockedOn != "" {
		t.Errorf("after SetWaiting: %+v", list[0])
	}
}

func TestSetBlockedWithoutARunLeavesBlockedOnEmpty(t *testing.T) {
	useTempStore(t)
	a := addPlan(t, "a", "")
	if err := SetBlocked(a.Id, "route unavailable", "run-1"); err != nil {
		t.Fatal(err)
	}
	// a later block for another cause replaces the run the first one named
	if err := SetBlocked(a.Id, "its create failed", ""); err != nil {
		t.Fatal(err)
	}
	list, _ := List()
	if list[0].Reason != "its create failed" || list[0].BlockedOn != "" {
		t.Errorf("a block that is not about a run kept BlockedOn: %+v", list[0])
	}
}

func TestUnknownIdErrors(t *testing.T) {
	useTempStore(t)
	addPlan(t, "a", "")
	ops := map[string]func(string) error{
		"Remove":     Remove,
		"MoveFirst":  MoveFirst,
		"SetBlocked": func(id string) error { return SetBlocked(id, "why", "") },
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
	// waits on the entry and on a run: Retarget swaps the one id and leaves the other
	f := addPlan(t, "f", "run-2", a.Id)
	// already waits on the run the entry became: it keeps it once
	g := addPlan(t, "g", a.Id, "run-1")

	if err := Retarget(a.Id, "run-1"); err != nil {
		t.Fatalf("Retarget: %v", err)
	}
	list, _ := List()
	wantAfter := map[string][]string{
		a.Id: nil, b.Id: {"run-1"}, c.Id: {"run-1"}, d.Id: {"run-9"}, e.Id: nil,
		f.Id: {"run-2", "run-1"}, g.Id: {"run-1"},
	}
	for _, entry := range list {
		if !sameIds(entry.After, wantAfter[entry.Id]...) {
			t.Errorf("%s after = %q, want %q", entry.Title, entry.After, wantAfter[entry.Id])
		}
	}
	if !sameIds(ids(t), a.Id, b.Id, c.Id, d.Id, e.Id, f.Id, g.Id) {
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
	if len(list[0].After) != 0 {
		t.Errorf("a refused Retarget changed an entry: %+v", list[0])
	}
}

// writeQueueFile puts raw JSON where the store reads it, the way an older wavesrv left it.
func writeQueueFile(t *testing.T, path, raw string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestLoadReadsASingleAfterIdAsAList(t *testing.T) {
	path := useTempStore(t)
	writeQueueFile(t, path, `{"entries": [
		{"id": "q-0001", "data": {"planpath": "a.md"}, "title": "one", "projectpath": "/proj", "after": "r1", "queuedts": 1, "state": "waiting"},
		{"id": "q-0002", "data": {"planpath": "b.md"}, "title": "two", "projectpath": "/proj", "after": "", "queuedts": 2, "state": "waiting"},
		{"id": "q-0003", "data": {"planpath": "c.md"}, "title": "three", "projectpath": "/proj", "queuedts": 3, "state": "blocked", "reason": "kept", "blockedon": "r1"},
		{"id": "q-0004", "data": {"planpath": "d.md"}, "title": "four", "projectpath": "/proj", "after": ["r1", "r2"], "queuedts": 4, "state": "waiting"},
		{"id": "q-0005", "data": {"planpath": "e.md"}, "title": "five", "projectpath": "/proj", "after": null, "queuedts": 5, "state": "waiting"},
		{"id": "q-0006", "data": {"planpath": "f.md"}, "title": "six", "projectpath": "/proj", "after": [], "queuedts": 6, "state": "waiting"}
	]}`)
	list, err := List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	want := map[string][]string{"q-0001": {"r1"}, "q-0002": nil, "q-0003": nil, "q-0004": {"r1", "r2"}, "q-0005": nil, "q-0006": nil}
	if len(list) != len(want) {
		t.Fatalf("List returned %d entries, want %d", len(list), len(want))
	}
	for _, e := range list {
		if !sameIds(e.After, want[e.Id]...) {
			t.Errorf("%s after = %q, want %q", e.Id, e.After, want[e.Id])
		}
		if e.After != nil && len(e.After) == 0 {
			t.Errorf("%s after is an empty non-nil list, want none", e.Id)
		}
	}
	// the other fields come through the shadowed read untouched
	if list[0].Title != "one" || list[0].Data.PlanPath != "a.md" || list[0].ProjectPath != "/proj" || list[0].QueuedTs != 1 {
		t.Errorf("entry fields were lost reading an old file: %+v", list[0])
	}
	if list[2].State != wshrpc.RunQueueState_Blocked || list[2].Reason != "kept" || list[2].BlockedOn != "r1" {
		t.Errorf("a blocked entry lost its block reading an old file: %+v", list[2])
	}
}

func TestLoadThenSaveWritesAList(t *testing.T) {
	path := useTempStore(t)
	writeQueueFile(t, path, `{"entries": [
		{"id": "q-0001", "data": {"planpath": "a.md"}, "title": "one", "projectpath": "/proj", "after": "r1", "queuedts": 1, "state": "waiting"}
	]}`)
	if err := MoveFirst("q-0001"); err != nil { // any write converts the file
		t.Fatalf("MoveFirst: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Entries []struct {
			After json.RawMessage `json:"after"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("the saved file is not JSON: %v", err)
	}
	if len(f.Entries) != 1 {
		t.Fatalf("saved %d entries, want 1", len(f.Entries))
	}
	var got []string
	if err := json.Unmarshal(f.Entries[0].After, &got); err != nil || !sameIds(got, "r1") {
		t.Errorf("saved after = %s (%v), want [\"r1\"]", f.Entries[0].After, err)
	}
	list, _ := List()
	if len(list) != 1 || !sameIds(list[0].After, "r1") {
		t.Errorf("the converted file reads back as %+v, want after [r1]", list)
	}
}

func TestLoadRejectsAnAfterThatIsNeitherAStringNorAList(t *testing.T) {
	path := useTempStore(t)
	writeQueueFile(t, path, `{"entries": [{"id": "q-0001", "after": 7}]}`)
	if _, err := List(); err == nil {
		t.Error("List of an entry whose after is a number succeeded")
	}
	if _, err := Add(wshrpc.RunQueueEntry{Title: "x"}); err == nil {
		t.Error("Add over an unreadable entry succeeded, which would overwrite the file")
	}
}

func TestAddKeepsAListOfAfterIds(t *testing.T) {
	useTempStore(t)
	e := addPlan(t, "two runs", "r1", "r2")
	list, _ := List()
	if len(list) != 1 || !sameIds(list[0].After, "r1", "r2") || !sameIds(e.After, "r1", "r2") {
		t.Errorf("an entry after two runs came back as %+v / %+v", e.After, list)
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
