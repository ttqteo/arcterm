// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// failingRealDeps makes every real dep fail the test: what fixture mode must never reach. It restores the seam after.
func failingRealDeps(t *testing.T) *int {
	t.Helper()
	touched := 0
	prev := realSessionIdeasDeps
	realSessionIdeasDeps = func() sessionideas.Deps {
		touched++
		t.Error("fixture mode reached the real scan deps")
		return sessionideas.Deps{}
	}
	t.Cleanup(func() { realSessionIdeasDeps = prev })
	return &touched
}

func fixtureSessions(now time.Time) []wshrpc.SessionIdeasSession {
	return []wshrpc.SessionIdeasSession{
		{SessionID: "f-old", Title: "Older fixture", Project: "arc", TranscriptPath: "/fixture/f-old.jsonl", Size: 900, LastWriteTs: now.Add(-60 * 24 * time.Hour).UnixMilli()},
		{SessionID: "f-new", Title: "Newer fixture", Project: "arc", TranscriptPath: "/fixture/f-new.jsonl", Size: 400, LastWriteTs: now.Add(-9 * 24 * time.Hour).UnixMilli()},
		{SessionID: "f-live", Title: "Still being written", Project: "arc", TranscriptPath: "/fixture/f-live.jsonl", Size: 100, LastWriteTs: now.Add(-time.Hour).UnixMilli()},
	}
}

func TestSessionIdeasFixtureDepsNeverCallTheRealOnes(t *testing.T) {
	touched := failingRealDeps(t)
	emptySessionIdeas(t)
	now := time.Now()
	sessions := fixtureSessions(now)
	setSessionIdeasFixture(&wshrpc.CommandSessionIdeasSeedData{Fixture: true, Sessions: sessions})

	deps := sessionIdeasScanDeps()
	if got := deps.Candidates(); len(got) != 3 || got[0].Path != "/fixture/f-old.jsonl" || got[0].Stem != "f-old" || got[0].Size != 900 ||
		!got[0].Mtime.Equal(time.UnixMilli(sessions[0].LastWriteTs)) || got[0].Archived || got[0].Session != nil || len(got[0].Turns) != 0 {
		t.Fatalf("candidates are the seeded sessions, stat fields only: %+v", got)
	}
	d, err := deps.Read("/fixture/f-new.jsonl")
	if err != nil || d.Session == nil || d.Session.ID != "f-new" || d.Session.Task != "Newer fixture" || d.Session.ProjectName != "arc" ||
		len(d.Turns) != 1 || d.Turns[0].Speaker != "user" || d.Turns[0].Text == "" {
		t.Fatalf("a read is one canned user turn on the seeded session: %+v, %v", d, err)
	}
	if skip, why := sessionideas.SkipContent(d); skip {
		t.Fatalf("a canned digest must reach the model call, skipped for %q", why)
	}
	if other, err := deps.Read("/anywhere/else.jsonl"); err != nil || len(other.Turns) != 1 {
		t.Fatalf("a read of any path answers one canned turn: %+v, %v", other, err)
	}
	reply, tokens, err := deps.Run(context.Background(), "prompt")
	if err != nil || reply != "[]" || tokens != 1000 {
		t.Fatalf("the default reply is an empty list for 1000 tokens, got %q %d %v", reply, tokens, err)
	}
	if pc, err := deps.ProjectContext(context.Background(), "/anywhere"); err != nil || !reflect.DeepEqual(pc, sessionideas.ProjectContext{}) {
		t.Fatalf("the project holds nothing: %+v, %v", pc, err)
	}
	if *touched != 0 {
		t.Fatalf("the real deps were built %d times", *touched)
	}
}

func TestSessionIdeasFixtureDepsScanEndToEndOnTheSeededReply(t *testing.T) {
	touched := failingRealDeps(t)
	store := emptySessionIdeas(t)
	now := time.Now()
	setSessionIdeasFixture(&wshrpc.CommandSessionIdeasSeedData{
		Fixture:  true,
		Sessions: fixtureSessions(now),
		Reply:    `[{"gist":"Add a seeded idea","quotes":[{"who":"you","text":"seeded"}],"why":"fixture"}]`,
	})
	if err := sessionideas.ScanNow(context.Background(), store, sessionIdeasScanDeps(), sessionideas.ScanOpts{}); err != nil {
		t.Fatalf("scan: %v", err)
	}
	d, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if d.Scan == nil || d.Scan.Total != 2 || d.Scan.Done != 2 || d.Scan.Tokens != 2000 {
		t.Fatalf("the two quiet seeded sessions are scanned for 1000 tokens each, the one still written is left: %+v", d.Scan)
	}
	if len(d.Marks) != 2 || d.Marks[0].SessionID != "f-old" || d.Marks[1].SessionID != "f-new" {
		t.Fatalf("marks, nearest deletion first: %+v", d.Marks)
	}
	// the second session floats the same idea in the same project: it is one idea, not two
	if len(d.Ideas) != 1 || d.Ideas[0].Gist != "Add a seeded idea" || d.Ideas[0].SessionID != "f-old" || d.Ideas[0].Project != "arc" {
		t.Fatalf("the seeded reply becomes an idea of the first session: %+v", d.Ideas)
	}
	if *touched != 0 {
		t.Fatalf("the real deps were built %d times", *touched)
	}

	// Clear turns fixture mode off: the real deps are what a scan builds again
	setSessionIdeasFixture(nil)
	prev := realSessionIdeasDeps
	realSessionIdeasDeps = func() sessionideas.Deps { *touched = -1; return sessionideas.Deps{} }
	t.Cleanup(func() { realSessionIdeasDeps = prev })
	sessionIdeasScanDeps()
	if *touched != -1 {
		t.Fatal("with fixture mode off the scan's deps are the real ones")
	}
}

func TestReadProjectDocs(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, text string) {
		t.Helper()
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("docs/superpowers/specs/2026-11-01-a-design.md", "x")
	write("docs/superpowers/specs/2026-11-02-b-design.md", "x")
	write("docs/superpowers/specs/sub/ignored.md", "x")
	write("docs/superpowers/plans/2026-11-03-c.md", "x")
	write("docs/deferred.md", "## One\n### Two\n")

	docs, err := readProjectDocs(context.Background(), dir)
	if err != nil {
		t.Fatalf("a folder with docs and no .git is no error: %v", err)
	}
	if want := []string{"2026-11-01-a-design.md", "2026-11-02-b-design.md"}; !reflect.DeepEqual(docs.specs, want) {
		t.Errorf("specs: got %v, want %v (a folder inside is no spec)", docs.specs, want)
	}
	if want := []string{"2026-11-03-c.md"}; !reflect.DeepEqual(docs.plans, want) {
		t.Errorf("plans: got %v, want %v", docs.plans, want)
	}
	if docs.deferred != "## One\n### Two\n" || docs.gitLog != "" {
		t.Errorf("deferred and git log: %+v", docs)
	}

	// nothing there at all: still no error
	empty, err := readProjectDocs(context.Background(), t.TempDir())
	if err != nil || len(empty.specs)+len(empty.plans) != 0 || empty.deferred != "" || empty.gitLog != "" {
		t.Fatalf("a project with no docs reads as empty: %+v, %v", empty, err)
	}

	// a long specs folder keeps the newest names
	for i := range maxDocNames + 20 {
		write(fmt.Sprintf("docs/superpowers/plans/2026-12-%03d-p.md", i), "x")
	}
	docs, err = readProjectDocs(context.Background(), dir)
	if err != nil || len(docs.plans) != maxDocNames || docs.plans[len(docs.plans)-1] != fmt.Sprintf("2026-12-%03d-p.md", maxDocNames+19) {
		t.Fatalf("at most %d plan names, the newest: %d %v", maxDocNames, len(docs.plans), err)
	}
}

func TestSessionIdeasProjectContextOfNoFolderIsEmpty(t *testing.T) {
	pc, err := sessionIdeasProjectContext(context.Background(), "  ")
	if err != nil || !reflect.DeepEqual(pc, sessionideas.ProjectContext{}) {
		t.Fatalf("a session with no folder has no project: %+v, %v", pc, err)
	}
}
