// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ideastore

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const sid = "6c1f0a52-9b3e-4d7a-8f10-2a5e7c9d4b31"

// useTempRoot points the store at a temp dir and a clock that moves one second per call, so ideas added in
// order have increasing timestamps.
func useTempRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Cleanup(UseRootForTest(root))
	prev := now
	var tick int64
	now = func() time.Time {
		tick++
		return time.UnixMilli(1792000000000 + tick*1000)
	}
	t.Cleanup(func() { now = prev })
	mu.Lock()
	pending = map[string]int{}
	mu.Unlock()
	return root
}

func mustAdd(t *testing.T, text, kind, by string) Idea {
	t.Helper()
	idea, err := Add(sid, text, kind, by)
	if err != nil {
		t.Fatalf("Add(%q): %v", text, err)
	}
	return idea
}

func mustList(t *testing.T) SessionIdeas {
	t.Helper()
	got, err := List(sid)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func findIdea(t *testing.T, s SessionIdeas, id string) Idea {
	t.Helper()
	for _, idea := range s.Ideas {
		if idea.ID == id {
			return idea
		}
	}
	t.Fatalf("idea %s not in %+v", id, s.Ideas)
	return Idea{}
}

func TestAddListRoundTripWritesOneFilePerSession(t *testing.T) {
	root := useTempRoot(t)
	idea := mustAdd(t, "  rail count, not a tab  ", KindIdea, ByAgent)
	if idea.ID != "i1" || idea.Text != "rail count, not a tab" || idea.Kind != KindIdea || idea.By != ByAgent {
		t.Fatalf("idea = %+v", idea)
	}
	if idea.Ts == 0 || idea.Turn != 0 || idea.Dropped {
		t.Fatalf("idea = %+v", idea)
	}
	got := mustList(t)
	if got.SessionId != sid || len(got.Ideas) != 1 || got.Ideas[0] != idea {
		t.Fatalf("list = %+v", got)
	}
	if _, err := os.Stat(filepath.Join(root, "ideas", sid+".json")); err != nil {
		t.Fatalf("session file: %v", err)
	}
}

func TestListOfASessionWithNoFileIsEmptyAndWritesNothing(t *testing.T) {
	root := useTempRoot(t)
	got := mustList(t)
	if got.SessionId != sid || got.Ideas == nil || len(got.Ideas) != 0 || got.SeenAt != 0 {
		t.Fatalf("list = %+v", got)
	}
	if _, err := os.Stat(filepath.Join(root, "ideas")); !os.IsNotExist(err) {
		t.Fatalf("a read made the ideas dir: %v", err)
	}
}

func TestIdsIncreaseAndAreNotReused(t *testing.T) {
	useTempRoot(t)
	a := mustAdd(t, "one", KindIdea, ByAgent)
	b := mustAdd(t, "two", KindDecision, ByYou)
	if a.ID != "i1" || b.ID != "i2" {
		t.Fatalf("ids = %s, %s", a.ID, b.ID)
	}
	if err := Update(sid, Op{Kind: OpDrop, Ids: []string{"i2"}}); err != nil {
		t.Fatal(err)
	}
	if c := mustAdd(t, "three", KindQuestion, ByAgent); c.ID != "i3" {
		t.Fatalf("id after a drop = %s", c.ID)
	}
}

func TestAddRejectsBadInput(t *testing.T) {
	root := useTempRoot(t)
	cases := []struct {
		name, session, text, kind, by string
	}{
		{"empty text", sid, "", KindIdea, ByAgent},
		{"blank text", sid, " \n\t", KindIdea, ByAgent},
		{"bad kind", sid, "x", "thought", ByAgent},
		{"empty kind", sid, "x", "", ByAgent},
		{"bad by", sid, "x", KindIdea, "robot"},
		{"empty session", "", "x", KindIdea, ByAgent},
		{"path session", "../evil", "x", KindIdea, ByAgent},
		{"slash session", "a/b", "x", KindIdea, ByAgent},
		{"dotted session", "a.json", "x", KindIdea, ByAgent},
		{"long session", strings.Repeat("a", 129), "x", KindIdea, ByAgent},
	}
	for _, tc := range cases {
		if _, err := Add(tc.session, tc.text, tc.kind, tc.by); err == nil {
			t.Errorf("%s: Add succeeded", tc.name)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "ideas")); !os.IsNotExist(err) {
		t.Fatalf("a rejected add left the ideas dir: %v", err)
	}
	if _, err := List("../evil"); err == nil {
		t.Error("List accepted a bad session id")
	}
	if err := Update("../evil", Op{Kind: OpSeen}); err == nil {
		t.Error("Update accepted a bad session id")
	}
	if _, err := Tick("../evil"); err == nil {
		t.Error("Tick accepted a bad session id")
	}
}

func TestEditKindDropRestore(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "first", KindIdea, ByAgent)
	mustAdd(t, "second", KindIdea, ByAgent)

	if err := Update(sid, Op{Kind: OpEdit, Ids: []string{"i1"}, Text: "  first, reworded "}); err != nil {
		t.Fatal(err)
	}
	if got := findIdea(t, mustList(t), "i1"); got.Text != "first, reworded" {
		t.Fatalf("edit: %+v", got)
	}

	if err := Update(sid, Op{Kind: OpKind, Ids: []string{"i1", "i2"}, NewKind: KindDecision}); err != nil {
		t.Fatal(err)
	}
	s := mustList(t)
	if findIdea(t, s, "i1").Kind != KindDecision || findIdea(t, s, "i2").Kind != KindDecision {
		t.Fatalf("kind: %+v", s.Ideas)
	}

	if err := Update(sid, Op{Kind: OpDrop, Ids: []string{"i2"}}); err != nil {
		t.Fatal(err)
	}
	s = mustList(t)
	if !findIdea(t, s, "i2").Dropped || findIdea(t, s, "i1").Dropped {
		t.Fatalf("drop: %+v", s.Ideas)
	}
	if err := Update(sid, Op{Kind: OpRestore, Ids: []string{"i2"}}); err != nil {
		t.Fatal(err)
	}
	if findIdea(t, mustList(t), "i2").Dropped {
		t.Fatal("restore left the idea dropped")
	}
}

func TestUpdateRejectsBadOps(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "first", KindIdea, ByAgent)
	mustAdd(t, "second", KindIdea, ByAgent)
	bad := []Op{
		{Kind: "rename", Ids: []string{"i1"}},
		{Kind: OpEdit, Ids: []string{"i1"}, Text: "  "},
		{Kind: OpEdit, Ids: []string{"i1", "i2"}, Text: "x"},
		{Kind: OpEdit, Text: "x"},
		{Kind: OpKind, Ids: []string{"i1"}, NewKind: "thought"},
		{Kind: OpKind, NewKind: KindIdea},
		{Kind: OpDrop},
		{Kind: OpRestore},
		{Kind: OpMerge, Ids: []string{"i1"}},
		{Kind: OpMerge, Ids: []string{"i1", "i1"}},
	}
	for _, op := range bad {
		if err := Update(sid, op); err == nil {
			t.Errorf("Update(%+v) succeeded", op)
		}
	}
	// nothing above may have changed the list
	s := mustList(t)
	if len(s.Ideas) != 2 || s.Ideas[0].Text != "first" || s.Ideas[1].Text != "second" || s.Ideas[0].Dropped {
		t.Fatalf("list after rejected ops = %+v", s.Ideas)
	}
}

func TestMergeKeepsTheOldestAndJoinsTextsOldestFirst(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "alpha", KindQuestion, ByAgent)
	mustAdd(t, "beta", KindDecision, ByYou)
	mustAdd(t, "gamma", KindIdea, ByAgent)
	// ids out of order: the oldest is still alpha
	if err := Update(sid, Op{Kind: OpMerge, Ids: []string{"i3", "i1", "i2"}}); err != nil {
		t.Fatal(err)
	}
	s := mustList(t)
	keep := findIdea(t, s, "i1")
	if keep.Text != "alpha; beta; gamma" || keep.Kind != KindQuestion || keep.Dropped {
		t.Fatalf("kept = %+v", keep)
	}
	if !findIdea(t, s, "i2").Dropped || !findIdea(t, s, "i3").Dropped {
		t.Fatalf("merged ideas not dropped: %+v", s.Ideas)
	}
}

func TestMergeOrdersByTimestampThenNumericId(t *testing.T) {
	root := useTempRoot(t)
	// ten ideas at one timestamp: i10 must sort after i2, not before it
	var sb strings.Builder
	sb.WriteString(`{"sessionid":"` + sid + `","nextid":10,"ideas":[`)
	for n := 1; n <= 10; n++ {
		if n > 1 {
			sb.WriteString(",")
		}
		sb.WriteString(`{"id":"i` + strconv.Itoa(n) + `","text":"t` + strconv.Itoa(n) + `","kind":"idea","by":"agent","ts":5000}`)
	}
	sb.WriteString(`]}`)
	if err := os.MkdirAll(filepath.Join(root, "ideas"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ideas", sid+".json"), []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Update(sid, Op{Kind: OpMerge, Ids: []string{"i10", "i2"}}); err != nil {
		t.Fatal(err)
	}
	s := mustList(t)
	if got := findIdea(t, s, "i2").Text; got != "t2; t10" {
		t.Fatalf("merged text = %q", got)
	}
	if !findIdea(t, s, "i10").Dropped {
		t.Fatal("i10 was not dropped")
	}
}

func TestUnknownIdIsAnErrorNamingIt(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "first", KindIdea, ByAgent)
	for _, op := range []Op{
		{Kind: OpEdit, Ids: []string{"i9"}, Text: "x"},
		{Kind: OpKind, Ids: []string{"i1", "i9"}, NewKind: KindDecision},
		{Kind: OpDrop, Ids: []string{"i9"}},
		{Kind: OpRestore, Ids: []string{"i9"}},
		{Kind: OpMerge, Ids: []string{"i1", "i9"}},
	} {
		err := Update(sid, op)
		if err == nil || !strings.Contains(err.Error(), "i9") {
			t.Errorf("Update(%+v) err = %v, want one naming i9", op, err)
		}
	}
	// the known id in the failed kind op must not have changed
	if got := findIdea(t, mustList(t), "i1"); got.Kind != KindIdea || got.Dropped {
		t.Fatalf("a failed op changed i1: %+v", got)
	}
}

func TestSeenSetsSeenAt(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "first", KindIdea, ByAgent)
	if got := mustList(t); got.SeenAt != 0 {
		t.Fatalf("SeenAt before seen = %d", got.SeenAt)
	}
	if err := Update(sid, Op{Kind: OpSeen}); err != nil {
		t.Fatal(err)
	}
	s := mustList(t)
	if s.SeenAt == 0 || s.SeenAt <= s.Ideas[0].Ts {
		t.Fatalf("SeenAt = %d, idea ts = %d", s.SeenAt, s.Ideas[0].Ts)
	}
}

func TestSeenOnASessionWithNoIdeasLeavesNoFile(t *testing.T) {
	root := useTempRoot(t)
	if err := Update(sid, Op{Kind: OpSeen}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "ideas")); !os.IsNotExist(err) {
		t.Fatalf("seen on an empty session made the ideas dir: %v", err)
	}
}

func tickN(t *testing.T, n int) []string {
	t.Helper()
	var out []string
	for range n {
		nudge, err := Tick(sid)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, nudge)
	}
	return out
}

func TestTickNudgesEveryThreeTurnsOnceASessionHasAnIdea(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "first", KindIdea, ByAgent)
	got := tickN(t, 7)
	want := []string{
		"", "",
		"3 turns since the last idea was recorded; record new ideas, decisions or open questions with wsh idea add.",
		"", "",
		"6 turns since the last idea was recorded; record new ideas, decisions or open questions with wsh idea add.",
		"",
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("tick %d = %q, want %q", i+1, got[i], want[i])
		}
	}
	if s := mustList(t); s.Prompts != 7 || s.NudgedAt != 6 {
		t.Fatalf("prompts = %d, nudgedat = %d", s.Prompts, s.NudgedAt)
	}
}

func TestAddResetsTheGap(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "first", KindIdea, ByAgent)
	tickN(t, 2)
	idea := mustAdd(t, "second", KindIdea, ByAgent)
	if idea.Turn != 2 {
		t.Fatalf("turn = %d, want 2", idea.Turn)
	}
	// the gap counts from the second idea: no nudge at prompt 3, one at prompt 5
	got := tickN(t, 3)
	if got[0] != "" || got[1] != "" || !strings.HasPrefix(got[2], "3 turns since") {
		t.Fatalf("ticks after the add = %q", got)
	}
}

func TestTickLeavesNoFileForASessionWithNoIdeas(t *testing.T) {
	root := useTempRoot(t)
	for i, nudge := range tickN(t, 6) {
		if nudge != "" {
			t.Errorf("tick %d nudged a session with no ideas: %q", i+1, nudge)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "ideas")); !os.IsNotExist(err) {
		t.Fatalf("ticks made the ideas dir: %v", err)
	}
}

func TestFirstIdeaCarriesTheTurnCountedBeforeItAndNudgesFromThere(t *testing.T) {
	useTempRoot(t)
	tickN(t, 4)
	idea := mustAdd(t, "first", KindIdea, ByAgent)
	if idea.Turn != 4 {
		t.Fatalf("turn = %d, want 4", idea.Turn)
	}
	s := mustList(t)
	if s.Prompts != 4 || s.LastIdeaPrompt != 4 {
		t.Fatalf("prompts = %d, lastideaprompt = %d", s.Prompts, s.LastIdeaPrompt)
	}
	got := tickN(t, 3)
	if got[0] != "" || got[1] != "" || !strings.HasPrefix(got[2], "3 turns since") {
		t.Fatalf("ticks after the first idea = %q", got)
	}
}

func TestNoNudgeWhileEveryIdeaIsDropped(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "first", KindIdea, ByAgent)
	if err := Update(sid, Op{Kind: OpDrop, Ids: []string{"i1"}}); err != nil {
		t.Fatal(err)
	}
	for i, nudge := range tickN(t, 4) {
		if nudge != "" {
			t.Errorf("tick %d nudged with every idea dropped: %q", i+1, nudge)
		}
	}
	if s := mustList(t); s.Prompts != 4 {
		t.Fatalf("prompts = %d, want 4 (ticks still count)", s.Prompts)
	}
	if err := Update(sid, Op{Kind: OpRestore, Ids: []string{"i1"}}); err != nil {
		t.Fatal(err)
	}
	if nudge := tickN(t, 1)[0]; !strings.HasPrefix(nudge, "5 turns since") {
		t.Fatalf("tick after the restore = %q", nudge)
	}
}

func TestSessionsAreIndependent(t *testing.T) {
	useTempRoot(t)
	mustAdd(t, "mine", KindIdea, ByAgent)
	other := "other-session_1"
	if _, err := Add(other, "theirs", KindDecision, ByYou); err != nil {
		t.Fatal(err)
	}
	got, err := List(other)
	if err != nil || len(got.Ideas) != 1 || got.Ideas[0].Text != "theirs" || got.Ideas[0].ID != "i1" {
		t.Fatalf("other session = %+v, %v", got, err)
	}
	if s := mustList(t); len(s.Ideas) != 1 || s.Ideas[0].Text != "mine" {
		t.Fatalf("this session = %+v", s.Ideas)
	}
}

func TestConcurrentAddsKeepEveryIdea(t *testing.T) {
	useTempRoot(t)
	const n = 20
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for range n {
		wg.Go(func() {
			if _, err := Add(sid, "idea", KindIdea, ByAgent); err != nil {
				errs <- err
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	s := mustList(t)
	if len(s.Ideas) != n {
		t.Fatalf("ideas = %d, want %d", len(s.Ideas), n)
	}
	seen := map[string]bool{}
	for _, idea := range s.Ideas {
		if seen[idea.ID] {
			t.Fatalf("duplicate id %s", idea.ID)
		}
		seen[idea.ID] = true
	}
}
