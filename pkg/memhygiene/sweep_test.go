// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"context"
	"errors"
	"testing"
	"time"
)

func sweepTestSetCheckedAt(t *testing.T, project string, at time.Time) {
	t.Helper()
	if _, err := Update(project, func(st *State) error {
		st.CheckedAt = at.UnixMilli()
		st.NextCheckAt = at.Add(checkInterval).UnixMilli()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// sweepTestWait waits for a check StartCheck began to finish.
func sweepTestWait(t *testing.T, project string, after int64) *State {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		st := checkTestLoad(t, project)
		if !st.Checking && (st.CheckedAt > after || st.LastError != "") {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("the check of %s didn't finish", project)
	return nil
}

func TestSweepPicksStaleProjectsOnly(t *testing.T) {
	env := checkTestSetup(t)
	now := time.Now()
	checkTestSimple(t, env, "stale")
	checkTestSimple(t, env, "fresh")
	checkTestSimple(t, env, "never")
	sweepTestSetCheckedAt(t, "stale", now.Add(-8*24*time.Hour))
	fresh := now.Add(-24 * time.Hour)
	sweepTestSetCheckedAt(t, "fresh", fresh)

	sweepOnce(context.Background(), now)

	for _, name := range []string{"stale", "never"} {
		if st := checkTestLoad(t, name); st.CheckedAt < now.UnixMilli() || st.Checking {
			t.Errorf("%s was due but not checked: checkedat %d, checking %v", name, st.CheckedAt, st.Checking)
		}
	}
	if st := checkTestLoad(t, "fresh"); st.CheckedAt != fresh.UnixMilli() {
		t.Errorf("fresh was checked a day after its last check")
	}
	if n := len(env.judgePrompts()); n != 2 {
		t.Errorf("want one judge call for each due project, got %d", n)
	}
}

func TestSweepWaitsAWeekAfterAFailedCheck(t *testing.T) {
	env := checkTestSetup(t)
	checkTestSimple(t, env, "p")
	now := time.Now()
	old := now.Add(-8 * 24 * time.Hour)
	sweepTestSetCheckedAt(t, "p", old)
	env.setReply(func(string) (string, error) { return "", errors.New("model down") })

	sweepOnce(context.Background(), now)
	st := checkTestLoad(t, "p")
	if st.LastError == "" || st.CheckedAt != old.UnixMilli() {
		t.Fatalf("the sweep's check didn't fail: lasterror %q, checkedat %d", st.LastError, st.CheckedAt)
	}
	if n := len(env.judgePrompts()); n != 1 {
		t.Fatalf("want one judge call from the failed check, got %d", n)
	}

	sweepOnce(context.Background(), now.Add(sweepInterval))
	if n := len(env.judgePrompts()); n != 1 {
		t.Fatalf("the next hourly sweep retried the failed check: %d judge calls", n)
	}

	sweepOnce(context.Background(), now.Add(checkInterval+time.Minute))
	if n := len(env.judgePrompts()); n != 2 {
		t.Fatalf("the weekly sweep after the failure didn't retry it: %d judge calls", n)
	}

	env.setReply(func(string) (string, error) { return checkTestNoChanges, nil })
	if err := StartCheck("p"); err != nil {
		t.Fatalf("Check now refused a project whose sweep isn't due: %v", err)
	}
	if st := sweepTestWait(t, "p", old.UnixMilli()); st.CheckedAt == old.UnixMilli() {
		t.Fatalf("Check now didn't check after a failure: %q", st.LastError)
	}
}

func TestSweepSkipsKeptSharing(t *testing.T) {
	env := checkTestSetup(t)
	checkTestSharing(t, env)
	checkTestRun(t, env, "ca")
	settings := checkTestFind(t, checkTestLoad(t, "ca"), "settings")
	checkTestDecide(t, "ca", settings.Id, "keep")
	now := time.Now()
	old := now.Add(-8 * 24 * time.Hour)
	sweepTestSetCheckedAt(t, "ca", old)
	sweepTestSetCheckedAt(t, "det", now)

	sweepOnce(context.Background(), now)
	if st := checkTestLoad(t, "ca"); st.CheckedAt != old.UnixMilli() {
		t.Fatal("the sweep checked a project kept sharing")
	}

	if err := StartCheck("ca"); err != nil {
		t.Fatal(err)
	}
	st := sweepTestWait(t, "ca", old.UnixMilli())
	if st.LastError != "" || st.CheckedAt == old.UnixMilli() {
		t.Fatalf("Check now didn't check a project kept sharing: %q", st.LastError)
	}
	if checkTestFind(t, st, "settings").Status != "kept" {
		t.Fatal("the re-check dropped the kept settings verdict")
	}

	checkTestDecide(t, "ca", settings.Id, "reopen")
	sweepTestSetCheckedAt(t, "ca", old)
	sweepOnce(context.Background(), time.Now())
	if st := checkTestLoad(t, "ca"); st.CheckedAt == old.UnixMilli() {
		t.Fatal("after Review again the sweep still skipped it")
	}
}

func TestSweepClearsStaleChecking(t *testing.T) {
	env := checkTestSetup(t)
	env.project(t, "p", initRepo(t))
	if err := entryBegin("p"); err != nil {
		t.Fatal(err)
	}
	if err := StartCheck("p"); err == nil {
		t.Fatal("StartCheck began a second check of a project already checking")
	}

	sweepClearStale()

	st := checkTestLoad(t, "p")
	if st.Checking || st.LastError != sweepInterrupted {
		t.Fatalf("checking/lasterror = %v/%q", st.Checking, st.LastError)
	}
}
