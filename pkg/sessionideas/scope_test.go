// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"context"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// addIn puts a session on disk in the Claude Code folder of a project.
func (w *world) addIn(project, name string, age float64) agentsessions.DigestSession {
	c := w.add(name, age, 100, userTurn(name, 1))
	path := "/claude/" + project + "/" + name + ".jsonl"
	full := w.digests[c.Path]
	delete(w.digests, c.Path)
	c.Path, full.Path = path, path
	w.cands[len(w.cands)-1] = c
	w.digests[path] = full
	return c
}

func TestScanNowOfOneProjectReadsItAndScopesTheSchedule(t *testing.T) {
	s, _ := newTestStore(t)
	w := newWorld()
	thesis := w.addIn("thesis", "t1", 30)
	w.addIn("arc", "a1", 40)
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{Project: "/claude/thesis"}); err != nil {
		t.Fatal(err)
	}
	if want := []string{thesis.Path}; !reflect.DeepEqual(w.reads, want) {
		t.Fatalf("a project scan reads that project only: got %v, want %v", w.reads, want)
	}
	d := loadStore(t, s)
	if d.FirstScanDone || !reflect.DeepEqual(d.ScanProjects, []string{"/claude/thesis"}) {
		t.Fatalf("a project scan scopes the schedule to it and does not turn it on for all: %+v", d)
	}

	// the same project again is not listed twice; a plain scan (Scan now, Retry) stays in the scope
	w.reads = nil
	w.addIn("thesis", "t2", 20)
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{Project: "/claude/thesis/"}); err != nil {
		t.Fatal(err)
	}
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	if want := []string{"/claude/thesis/t2.jsonl"}; !reflect.DeepEqual(w.reads, want) {
		t.Fatalf("a plain scan in a scoped store reads the scope only: got %v, want %v", w.reads, want)
	}
	d = loadStore(t, s)
	if d.FirstScanDone || len(d.ScanProjects) != 1 {
		t.Fatalf("a plain scan in a scoped store leaves the scope as it is: %+v", d)
	}

	// All reads every project and turns the schedule on for all of them
	w.reads = nil
	if err := ScanNow(context.Background(), s, w.deps(), ScanOpts{All: true}); err != nil {
		t.Fatal(err)
	}
	if want := []string{"/claude/arc/a1.jsonl"}; !reflect.DeepEqual(w.reads, want) {
		t.Fatalf("All reads what no scan has: got %v, want %v", w.reads, want)
	}
	if d := loadStore(t, s); !d.FirstScanDone || d.ScanProjects != nil {
		t.Fatalf("All turns the schedule on for every project: %+v", d)
	}
}

func TestAfterScan(t *testing.T) {
	cases := []struct {
		name      string
		before    wshrpc.SessionIdeasData
		opts      ScanOpts
		firstDone bool
		projects  []string
	}{
		{"a plain first scan reads every project", wshrpc.SessionIdeasData{}, ScanOpts{}, true, nil},
		{"All", wshrpc.SessionIdeasData{ScanProjects: []string{"/p"}}, ScanOpts{All: true}, true, nil},
		{"a project", wshrpc.SessionIdeasData{}, ScanOpts{Project: "/p"}, false, []string{"/p"}},
		{"a project once all are on", wshrpc.SessionIdeasData{FirstScanDone: true}, ScanOpts{Project: "/p"}, true, nil},
		{"a plain scan in a scope", wshrpc.SessionIdeasData{ScanProjects: []string{"/p"}}, ScanOpts{}, false, []string{"/p"}},
		{"named paths (Storage's Scan them first)", wshrpc.SessionIdeasData{}, ScanOpts{Paths: []string{"/p/a.jsonl"}}, false, nil},
		{"the schedule's", wshrpc.SessionIdeasData{ScanProjects: []string{"/p"}}, ScanOpts{Forced: true}, false, []string{"/p"}},
	}
	for _, c := range cases {
		d := c.before
		afterScan(&d, c.opts)
		if d.FirstScanDone != c.firstDone || !reflect.DeepEqual(d.ScanProjects, c.projects) {
			t.Errorf("%s: FirstScanDone %v, ScanProjects %v; want %v, %v", c.name, d.FirstScanDone, d.ScanProjects, c.firstDone, c.projects)
		}
	}
}

func TestInScope(t *testing.T) {
	a := agentsessions.DigestSession{Path: "/claude/a/1.jsonl"}
	b := agentsessions.DigestSession{Path: "/claude/b/1.jsonl"}
	all := []agentsessions.DigestSession{a, b}
	if got := InScope(wshrpc.SessionIdeasData{}, all); len(got) != 2 {
		t.Errorf("no scope: every candidate, got %v", got)
	}
	if got := InScope(wshrpc.SessionIdeasData{ScanProjects: []string{"/claude/b"}}, all); len(got) != 1 || got[0].Path != b.Path {
		t.Errorf("a scope keeps its projects' candidates, got %v", got)
	}
	if got := InScope(wshrpc.SessionIdeasData{FirstScanDone: true, ScanProjects: []string{"/claude/b"}}, all); len(got) != 2 {
		t.Errorf("once every project is on, the scope no longer limits, got %v", got)
	}
}
