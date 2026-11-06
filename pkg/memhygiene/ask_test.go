// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const askTestRuntime = "claude"

// askTestSetup registers p with a.md and b.md, both untouched for 40 days, runs a check (which
// proposes a Review of each), and pins the ask's runtime so no test reads the real config.
func askTestSetup(t *testing.T) (env *checkTestEnv, folder string, reviewA, reviewB wshrpc.MemChange) {
	t.Helper()
	env = checkTestSetup(t)
	oldRuntime := askRuntimeFn
	askRuntimeFn = func() string { return askTestRuntime }
	t.Cleanup(func() { askRuntimeFn = oldRuntime })
	folder = checkTestSimple(t, env, "p")
	old := time.Now().Add(-40 * 24 * time.Hour)
	for _, name := range []string{"a.md", "b.md"} {
		if err := os.Chtimes(filepath.Join(folder, name), old, old); err != nil {
			t.Fatal(err)
		}
	}
	checkTestRun(t, env, "p")
	st := checkTestLoad(t, "p")
	for _, c := range st.Changes {
		if c.Kind != reviewKind {
			continue
		}
		switch c.Op.Memories[0] {
		case "a.md":
			reviewA = c
		case "b.md":
			reviewB = c
		}
	}
	if reviewA.Id == "" || reviewB.Id == "" {
		t.Fatalf("want a review of a.md and of b.md: %+v", st.Changes)
	}
	return env, folder, reviewA, reviewB
}

// askTestWait waits until the project's ask worker has stopped and no ask is marked.
func askTestWait(t *testing.T, project string) *State {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		st := checkTestLoad(t, project)
		if st.Asking == nil && !askRunning(project) {
			return st
		}
		if time.Now().After(deadline) {
			t.Fatalf("the ask in %s never finished: asking %+v, waiting %v", project, st.Asking, st.AskWaiting)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func askTestByID(t *testing.T, st *State, id string) wshrpc.MemChange {
	t.Helper()
	c, ok := entryTestByID(t, st.Changes, id)
	if !ok {
		t.Fatalf("no change %s in %+v", id, st.Changes)
	}
	return c
}

func TestAsk_proposalReplacesReview(t *testing.T) {
	env, _, _, review := askTestSetup(t)
	seenBefore := checkTestLoad(t, "p").Seen
	env.setReply(func(p string) (string, error) {
		if !strings.Contains(p, `"fine"`) || !strings.Contains(p, "### b.md") || strings.Contains(p, "### a.md") {
			t.Errorf("the ask's prompt is not the explain prompt over b.md alone:\n%s", p)
		}
		return `{"changes": [{"kind": "delete", "title": "A one-off note from July.", "files": ["b.md"]}]}`, nil
	})
	before := time.Now().UnixMilli()

	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	st := askTestWait(t, "p")

	got := askTestByID(t, st, review.Id)
	if got.Status != wshrpc.MemStatus_Superseded || got.SupersededBy == "" {
		t.Fatalf("review after the ask = %+v, want superseded", got)
	}
	p := askTestByID(t, st, got.SupersededBy)
	if p.Source != "agent" || p.FromReview != review.Id || p.Kind != judgeKindDelete || p.Status != splitStatusOpen {
		t.Fatalf("proposal = source %q fromreview %q kind %q status %q", p.Source, p.FromReview, p.Kind, p.Status)
	}
	if p.ProposedAt < before || p.Title != "A one-off note from July." || strings.TrimSpace(p.Body) != "beta rule" {
		t.Fatalf("proposal proposedat/title/body = %d/%q/%q", p.ProposedAt, p.Title, p.Body)
	}
	if p.Verdict == "" || p.DocLines == nil {
		t.Fatalf("proposal's reason section = %q / %v, want a verdict and a non-null doclines", p.Verdict, p.DocLines)
	}
	if len(st.Seen) != len(seenBefore) || st.Seen["b.md"] != seenBefore["b.md"] {
		t.Fatalf("a proposal moved the hash gate: %v, was %v", st.Seen, seenBefore)
	}
	if st.AskWaiting == nil || len(st.AskWaiting) != 0 {
		t.Fatalf("askwaiting = %#v, want an empty slice", st.AskWaiting)
	}
}

func TestAsk_nothingProposedWritesSeenAndReason(t *testing.T) {
	env, _, _, review := askTestSetup(t)
	env.setReply(func(string) (string, error) {
		return `{"changes": [], "fine": [{"memory": "b.md", "reason": "Still needed; nothing in AGENTS.md covers it."}]}`, nil
	})
	// the hash gate forgets b.md, as if the check had not judged this version
	if _, err := Update("p", func(st *State) error {
		delete(st.Seen, "b.md")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := time.Now().UnixMilli()

	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	st := askTestWait(t, "p")

	got := askTestByID(t, st, review.Id)
	if got.Status != splitStatusOpen || got.SupersededBy != "" {
		t.Fatalf("review after a fine answer = %+v, want open", got)
	}
	if got.AskReason != "Still needed; nothing in AGENTS.md covers it." || got.AskedAt < before || got.AskedBy != askTestRuntime {
		t.Fatalf("askreason/askedat/askedby = %q/%d/%q", got.AskReason, got.AskedAt, got.AskedBy)
	}
	if st.Seen["b.md"] == "" {
		t.Fatalf("a fine answer wrote no fingerprint for b.md: %v", st.Seen)
	}

	// with no fine entry for the memory, the reason says so plainly
	env.setReply(func(string) (string, error) { return checkTestNoChanges, nil })
	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	if got := askTestByID(t, askTestWait(t, "p"), review.Id); got.AskReason != "nothing to change" {
		t.Fatalf("askreason with no fine entry = %q", got.AskReason)
	}
}

func TestAsk_errorStoredOnReview(t *testing.T) {
	env, _, _, review := askTestSetup(t)
	env.setReply(func(string) (string, error) { return "", errors.New("model down") })

	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	st := askTestWait(t, "p")

	got := askTestByID(t, st, review.Id)
	if got.Status != splitStatusOpen || !strings.Contains(got.AskError, "model down") || got.AskReason != "" {
		t.Fatalf("review after a failed ask = status %q askerror %q askreason %q", got.Status, got.AskError, got.AskReason)
	}

	// asking again clears the error while it runs
	release := make(chan struct{})
	env.setReply(func(string) (string, error) {
		<-release
		return checkTestNoChanges, nil
	})
	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	if got := askTestByID(t, checkTestLoad(t, "p"), review.Id); got.AskError != "" {
		t.Fatalf("a new ask left the old error: %q", got.AskError)
	}
	close(release)
	askTestWait(t, "p")
}

func TestAsk_queuesSecond(t *testing.T) {
	env, _, reviewA, reviewB := askTestSetup(t)
	release := make(chan struct{})
	var order []string
	env.setReply(func(p string) (string, error) {
		if strings.Contains(p, "### a.md") {
			order = append(order, "a.md")
			<-release
		} else {
			order = append(order, "b.md")
		}
		return checkTestNoChanges, nil
	})

	if err := StartAsk("p", reviewA.Id); err != nil {
		t.Fatal(err)
	}
	if err := StartAsk("p", reviewB.Id); err != nil {
		t.Fatal(err)
	}
	st := checkTestLoad(t, "p")
	if st.Asking == nil || st.Asking.ChangeId != reviewA.Id || st.Asking.Runtime != askTestRuntime || st.Asking.StartedAt == 0 {
		t.Fatalf("asking = %+v, want a.md's review on %s", st.Asking, askTestRuntime)
	}
	if len(st.AskWaiting) != 1 || st.AskWaiting[0] != reviewB.Id {
		t.Fatalf("askwaiting = %v, want b.md's review", st.AskWaiting)
	}
	for _, id := range []string{reviewA.Id, reviewB.Id} {
		if err := StartAsk("p", id); err == nil {
			t.Fatalf("a second ask of %s while it is asking or waiting must be refused", id)
		}
	}

	close(release)
	st = askTestWait(t, "p")
	if strings.Join(order, ",") != "a.md,b.md" {
		t.Fatalf("asks ran in order %v, want a.md then b.md", order)
	}
	for _, id := range []string{reviewA.Id, reviewB.Id} {
		if got := askTestByID(t, st, id); got.AskReason != "nothing to change" {
			t.Fatalf("review %s was not answered: %+v", id, got)
		}
	}
}

// a second project runs its own ask beside the first
func TestAsk_otherProjectRunsBeside(t *testing.T) {
	env, _, reviewA, _ := askTestSetup(t)
	folderQ := checkTestSimple(t, env, "q")
	old := time.Now().Add(-40 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(folderQ, "a.md"), old, old); err != nil {
		t.Fatal(err)
	}
	checkTestRun(t, env, "q")
	reviewQ := checkTestFind(t, checkTestLoad(t, "q"), reviewKind)

	release := make(chan struct{})
	started := make(chan string, 2)
	env.setReply(func(p string) (string, error) {
		started <- p
		<-release
		return checkTestNoChanges, nil
	})
	if err := StartAsk("p", reviewA.Id); err != nil {
		t.Fatal(err)
	}
	if err := StartAsk("q", reviewQ.Id); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(10 * time.Second):
			close(release)
			t.Fatal("the two projects' asks did not run at the same time")
		}
	}
	close(release)
	askTestWait(t, "p")
	askTestWait(t, "q")
}

func TestAsk_refusedWhileChecking(t *testing.T) {
	_, _, _, review := askTestSetup(t)
	if _, err := Update("p", func(st *State) error {
		st.Checking = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := StartAsk("p", review.Id); err == nil {
		t.Fatal("an ask while the project is being checked must be refused")
	}
	if st := checkTestLoad(t, "p"); st.Asking != nil || askRunning("p") {
		t.Fatalf("a refused ask marked the project: %+v", st.Asking)
	}
}

func TestAsk_refusedOnNonReview(t *testing.T) {
	env, _, _, review := askTestSetup(t)
	checkTestDecide(t, "p", review.Id, wshrpc.MemVerdict_Keep)
	if err := StartAsk("p", review.Id); err == nil {
		t.Fatal("an ask on a kept review must be refused")
	}
	if err := StartAsk("p", "nope"); err == nil {
		t.Fatal("an ask on an unknown change must be refused")
	}
	env.setReply(func(string) (string, error) { return checkTestDelete("a.md"), nil })
	// a fresh check where the judge proposes a delete of a.md: that change is not a review
	if err := entryBegin("p"); err != nil {
		t.Fatal(err)
	}
	checkTestRun(t, env, "p")
	del := checkTestFind(t, checkTestLoad(t, "p"), judgeKindDelete)
	if err := StartAsk("p", del.Id); err == nil {
		t.Fatal("an ask on a judge change must be refused")
	}
}

func TestEntryBegin_refusedWhileAsking(t *testing.T) {
	_, _, reviewA, reviewB := askTestSetup(t)
	now := time.Now().UnixMilli()
	for name, set := range map[string]func(st *State){
		"running": func(st *State) {
			st.Asking = &wshrpc.MemAsk{ChangeId: reviewA.Id, StartedAt: now, Runtime: askTestRuntime}
		},
		"waiting": func(st *State) {
			st.Asking = &wshrpc.MemAsk{ChangeId: reviewA.Id, StartedAt: now, Runtime: askTestRuntime}
			st.AskWaiting = []string{reviewB.Id}
		},
	} {
		if _, err := Update("p", func(st *State) error {
			set(st)
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		err := entryBegin("p")
		if err == nil || !strings.Contains(err.Error(), "p is asking an agent") {
			t.Fatalf("%s: check while asking = %v, want refused", name, err)
		}
		if checkTestLoad(t, "p").Checking {
			t.Fatalf("%s: a refused check marked the project as checking", name)
		}
	}

	// a marker older than the check timeout reads as failed
	if _, err := Update("p", func(st *State) error {
		st.Asking.StartedAt = time.Now().Add(-checkTimeout - time.Minute).UnixMilli()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := entryBegin("p"); err != nil {
		t.Fatalf("a stale ask marker blocked the check: %v", err)
	}
}

func TestAsk_staleMarkerIgnored(t *testing.T) {
	_, _, reviewA, reviewB := askTestSetup(t)
	if _, err := Update("p", func(st *State) error {
		st.Asking = &wshrpc.MemAsk{ChangeId: reviewA.Id, StartedAt: time.Now().Add(-checkTimeout - time.Minute).UnixMilli(), Runtime: "openrouter"}
		st.AskWaiting = []string{reviewB.Id}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	// the stale marker and the id behind it read as failed, so a.md can be asked again at once
	if err := StartAsk("p", reviewA.Id); err != nil {
		t.Fatalf("a stale marker refused the ask: %v", err)
	}
	st := askTestWait(t, "p")
	if len(st.AskWaiting) != 0 {
		t.Fatalf("the stale waiting id stayed: %v", st.AskWaiting)
	}
	if got := askTestByID(t, st, reviewA.Id); got.AskReason != "nothing to change" || got.AskedBy != askTestRuntime {
		t.Fatalf("a.md's review was not answered on a fresh ask: %+v", got)
	}
	if got := askTestByID(t, st, reviewB.Id); got.AskedAt != 0 {
		t.Fatalf("the stale waiting id was asked: %+v", got)
	}
}

func TestCheckMerge_agentProposalSurvivesUnchangedHashes(t *testing.T) {
	env, _, _, review := askTestSetup(t)
	env.setReply(func(string) (string, error) {
		return `{"changes": [{"kind": "delete", "title": "A one-off note.", "files": ["b.md"]}]}`, nil
	})
	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	proposal := askTestByID(t, askTestWait(t, "p"), askTestByID(t, checkTestLoad(t, "p"), review.Id).SupersededBy)

	// the weekly check judges b.md again (its change is in play) and proposes a different trim
	env.setReply(func(p string) (string, error) {
		if strings.Contains(p, "### b.md") {
			return `{"changes": [{"kind": "trim", "title": "shorter", "files": ["b.md"], "old": "beta rule", "new": "beta"}]}`, nil
		}
		return checkTestNoChanges, nil
	})
	if err := entryBegin("p"); err != nil {
		t.Fatal(err)
	}
	checkTestRun(t, env, "p")

	st := checkTestLoad(t, "p")
	got := askTestByID(t, st, proposal.Id)
	if got.Source != "agent" || got.Status != splitStatusOpen || got.FromReview != review.Id {
		t.Fatalf("the agent proposal after a check = %+v", got)
	}
	if r := askTestByID(t, st, review.Id); r.Status != wshrpc.MemStatus_Superseded || r.SupersededBy != proposal.Id {
		t.Fatalf("the superseded review after a check = %+v, want still superseded", r)
	}
	for _, c := range st.Changes {
		if c.Id == proposal.Id || c.Id == review.Id {
			continue
		}
		for _, name := range c.Op.Memories {
			if name == "b.md" {
				t.Fatalf("a fresh change on b.md sits beside the agent proposal: %+v", c)
			}
		}
	}
}

func TestCheckMerge_agentProposalDropsOnChangedHash(t *testing.T) {
	env, folder, _, review := askTestSetup(t)
	env.setReply(func(string) (string, error) {
		return `{"changes": [{"kind": "delete", "title": "A one-off note.", "files": ["b.md"]}]}`, nil
	})
	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	st := askTestWait(t, "p")
	proposalID := askTestByID(t, st, review.Id).SupersededBy

	writeFile(t, filepath.Join(folder, "b.md"), "beta rule, edited by hand\n")
	env.setReply(func(string) (string, error) { return checkTestNoChanges, nil })
	if err := entryBegin("p"); err != nil {
		t.Fatal(err)
	}
	checkTestRun(t, env, "p")

	st = checkTestLoad(t, "p")
	for _, c := range st.Changes {
		if c.Id == proposalID {
			t.Fatalf("an agent proposal whose file changed survived the check: %+v", c)
		}
		if c.Id == review.Id {
			t.Fatalf("the superseded review outlived its proposal: %+v", c)
		}
	}
}
