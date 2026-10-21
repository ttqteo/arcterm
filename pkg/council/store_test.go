// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func useTempRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Cleanup(UseRootForTest(root))
	return root
}

// tickClock makes every Save see a later time than the last, so the order List returns does not depend on the
// machine's clock resolution.
func tickClock(t *testing.T) {
	t.Helper()
	prev := now
	base := time.UnixMilli(1_700_000_000_000)
	var n int
	now = func() time.Time {
		n++
		return base.Add(time.Duration(n) * time.Second)
	}
	t.Cleanup(func() { now = prev })
}

func sampleCouncil(id, project string) *Council {
	return &Council{
		Id:       id,
		Project:  project,
		Feature:  "Idle sleep for services",
		Question: "Which direction?",
		Files:    []string{"pkg/services/idle.go"},
		Experts: []CouncilExpert{
			{Id: "ux", Name: "UX", Brief: "Judge the flow", Model: "sonnet"},
			{Id: "lead", Name: "Lead", Brief: "Rank them", Model: "opus", Coordinator: true},
		},
		State: StateRunning,
		Round: 1,
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Title: "Sleep after a minute", Argument: "Saves RAM", Ts: 5,
				Evidence: []CouncilEvidence{{Ref: "pkg/services/idle.go:12"}, {Ref: "screenshot:a.png#top", Weak: true, Note: "no measurement"}}},
		},
		Replies: []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: YouId, Text: "why?", To: []string{"ux"}, Round: 2, Ts: 6},
		},
		Summary: &CouncilSummary{
			Text: "one direction",
			Directions: []CouncilDirection{
				{Rank: 1, Title: "Sleep", From: []string{"P1"}, Stances: map[string]CouncilStance{"lead": StanceAccept}, Agreed: true},
			},
			Outcomes: map[string]string{"P1": "Direction 1"},
			At:       9,
		},
		Activity: map[string]CouncilActivity{"ux": {Text: "Replying to UX on P1", ProposalId: "P1"}},
		Failed:   map[string]CouncilFailure{"lead": {Round: 1, Error: "timeout"}},
		Stats:    map[string]CouncilExpertStat{"ux": {Ms: 1200, Tokens: 300, Calls: 2}},
		Tokens:   300,
		Calls:    2,
		Started:  3,
		Created:  2,
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	useTempRoot(t)
	c := sampleCouncil("c1", `D:\p`)
	if err := Save(c); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if c.Updated == 0 {
		t.Fatal("Save left Updated at 0")
	}
	got, err := Load("c1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(got, c) {
		t.Fatalf("round trip differs\n got: %+v\nwant: %+v", got, c)
	}
}

func TestSaveWritesUnderCouncilsDir(t *testing.T) {
	root := useTempRoot(t)
	if got, want := Dir(), filepath.Join(root, "councils"); got != want {
		t.Fatalf("Dir() = %q, want %q", got, want)
	}
	if err := Save(sampleCouncil("c1", `D:\p`)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "councils", "c1.json")); err != nil {
		t.Fatalf("council file missing: %v", err)
	}
}

func TestLoadMissingIsNotExist(t *testing.T) {
	useTempRoot(t)
	_, err := Load("nope")
	if err == nil {
		t.Fatal("Load of a missing id returned no error")
	}
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("Load error %v is not fs.ErrNotExist", err)
	}
}

func TestIdsOutsideTheStoreAreRefused(t *testing.T) {
	useTempRoot(t)
	for _, id := range []string{"", "../x", `a\b`, "a/b", "a.b", strings.Repeat("x", 200)} {
		if _, err := Load(id); err == nil || errors.Is(err, fs.ErrNotExist) {
			t.Errorf("Load(%q) = %v, want an invalid-id error", id, err)
		}
		if err := Save(&Council{Id: id}); err == nil {
			t.Errorf("Save(%q) succeeded", id)
		}
	}
}

func TestListFiltersByProjectNewestFirst(t *testing.T) {
	useTempRoot(t)
	tickClock(t)
	for _, c := range []*Council{
		sampleCouncil("old", `D:\p`),
		sampleCouncil("other", `D:\q`),
		sampleCouncil("new", `D:\p`),
	} {
		if err := Save(c); err != nil {
			t.Fatal(err)
		}
	}
	got, err := List(`D:\p`)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, c := range got {
		ids = append(ids, c.Id)
	}
	if want := []string{"new", "old"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("List ids = %v, want %v", ids, want)
	}

	// re-saving the older one makes it the newest
	old, err := Load("old")
	if err != nil {
		t.Fatal(err)
	}
	if err := Save(old); err != nil {
		t.Fatal(err)
	}
	got, _ = List(`D:\p`)
	if len(got) != 2 || got[0].Id != "old" {
		t.Fatalf("after re-saving old, List first = %v", got)
	}
}

func TestListComparesProjectsAsThePathsAre(t *testing.T) {
	useTempRoot(t)
	if err := Save(sampleCouncil("c1", `D:\p\`)); err != nil {
		t.Fatal(err)
	}
	got, err := List(`D:\p\.`)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("List with an unclean path found %d councils, want 1", len(got))
	}
	// Windows paths ignore case; elsewhere the case counts
	got, _ = List(`d:\P`)
	wantFound := 0
	if isWindows {
		wantFound = 1
	}
	if len(got) != wantFound {
		t.Fatalf("List with a differently-cased path found %d, want %d", len(got), wantFound)
	}
}

func TestListEmptyWhenNoStore(t *testing.T) {
	useTempRoot(t)
	got, err := List(`D:\p`)
	if err != nil {
		t.Fatalf("List with no councils dir: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("List = %v, want none", got)
	}
}

func TestListSeesAFixtureWrittenToDisk(t *testing.T) {
	root := useTempRoot(t)
	if err := os.MkdirAll(filepath.Join(root, "councils"), 0o755); err != nil {
		t.Fatal(err)
	}
	fixture := `{"id":"fx","project":"D:\\p","feature":"f","experts":[],"state":"done","round":3,"tokens":0,"calls":0,"created":1,"updated":2}`
	if err := os.WriteFile(filepath.Join(root, "councils", "fx.json"), []byte(fixture), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := List(`D:\p`)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Id != "fx" || got[0].State != StateDone {
		t.Fatalf("List = %+v, want the fixture", got)
	}
}

func TestListSkipsStrayFiles(t *testing.T) {
	root := useTempRoot(t)
	if err := Save(sampleCouncil("c1", `D:\p`)); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "councils")
	for name, body := range map[string]string{"c1.json.tmp": "{", "notes.txt": "x", "broken.json": "{"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Id != "c1" {
		t.Fatalf("List = %+v, want only c1", got)
	}
}

func TestNewIdUniqueAndFileNameSafe(t *testing.T) {
	safe := regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	seen := map[string]bool{}
	for range 1000 {
		id := NewId()
		if !safe.MatchString(id) {
			t.Fatalf("NewId() = %q is not file-name safe", id)
		}
		if seen[id] {
			t.Fatalf("NewId() repeated %q", id)
		}
		seen[id] = true
	}
}

func TestSaveLeavesNoTempFileAndIsAtomic(t *testing.T) {
	root := useTempRoot(t)
	big := sampleCouncil("c1", `D:\p`)
	for range 400 {
		big.Replies = append(big.Replies, CouncilReply{Id: "r", ProposalId: "P1", Author: "ux", Text: strings.Repeat("x", 200), Round: 2})
	}
	if err := Save(big); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	stop := make(chan struct{})
	errs := make(chan error, 8)
	wg.Go(func() {
		for i := range 60 {
			c := *big
			c.Calls = i
			if err := Save(&c); err != nil {
				errs <- err
				break
			}
		}
		close(stop)
	})
	for range 3 {
		wg.Go(func() {
			for {
				select {
				case <-stop:
					return
				default:
				}
				got, err := Load("c1")
				if err != nil {
					errs <- err
					return
				}
				if len(got.Replies) != len(big.Replies) {
					errs <- errors.New("a reader saw a half-written council")
					return
				}
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}

	entries, err := os.ReadDir(filepath.Join(root, "councils"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "c1.json" {
			t.Errorf("stray file %q left in the councils dir", e.Name())
		}
	}
}

func TestUpdateAppliesUnderTheIdsLock(t *testing.T) {
	useTempRoot(t)
	if err := Save(sampleCouncil("c1", `D:\p`)); err != nil {
		t.Fatal(err)
	}
	const n = 25
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for range n {
		wg.Go(func() {
			_, err := Update("c1", func(c *Council) error {
				calls := c.Calls
				time.Sleep(time.Millisecond) // widen the read-modify-write window a lock must cover
				c.Calls = calls + 1
				return nil
			})
			if err != nil {
				errs <- err
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	got, err := Load("c1")
	if err != nil {
		t.Fatal(err)
	}
	if want := 2 + n; got.Calls != want {
		t.Fatalf("Calls = %d after %d concurrent Updates, want %d (an update was lost)", got.Calls, n, want)
	}
}

func TestUpdateReturnsTheSavedCouncilAndKeepsItOnError(t *testing.T) {
	useTempRoot(t)
	if err := Save(sampleCouncil("c1", `D:\p`)); err != nil {
		t.Fatal(err)
	}
	got, err := Update("c1", func(c *Council) error {
		c.State = StateDone
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StateDone {
		t.Fatalf("Update returned state %q, want done", got.State)
	}
	loaded, _ := Load("c1")
	if loaded.State != StateDone {
		t.Fatalf("saved state %q, want done", loaded.State)
	}

	boom := errors.New("boom")
	if _, err := Update("c1", func(c *Council) error {
		c.State = StateFailed
		return boom
	}); !errors.Is(err, boom) {
		t.Fatalf("Update error = %v, want boom", err)
	}
	loaded, _ = Load("c1")
	if loaded.State != StateDone {
		t.Fatalf("a failed Update saved state %q, want it left at done", loaded.State)
	}
}

func TestUpdateMissingIsNotExist(t *testing.T) {
	useTempRoot(t)
	_, err := Update("nope", func(c *Council) error { return nil })
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("Update of a missing id = %v, want fs.ErrNotExist", err)
	}
}
