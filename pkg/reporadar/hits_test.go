// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func hitsProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	proj := filepath.Join(root, "proj")
	if err := os.MkdirAll(filepath.Join(proj, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"a.go", "b.go"} {
		if err := os.WriteFile(filepath.Join(proj, f), []byte("one\ntwo\nthree\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "outside.go"), []byte("x\ny\nz\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return proj
}

func TestValidSite(t *testing.T) {
	p := hitsProject(t)
	abs, _ := filepath.Abs(filepath.Join(p, "..", "outside.go"))
	cases := []struct {
		name, file string
		line       int
		trigger    string
		want       bool
	}{
		{"first line", "a.go", 1, "t", true},
		{"last line", "a.go", 3, "t", true},
		{"line zero", "a.go", 0, "t", false},
		{"past end", "a.go", 4, "t", false},
		{"missing", "nope.go", 1, "t", false},
		{"blank trigger", "a.go", 1, "", false},
		{"space trigger", "a.go", 1, "  \t", false},
		{"absolute", abs, 1, "t", false},
		{"dotdot", "../outside.go", 1, "t", false},
		{"backslash escape", `..\outside.go`, 1, "t", false},
		{"directory", "dir", 1, "t", false},
	}
	for _, c := range cases {
		if got := validSite(p, c.file, c.line, c.trigger); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestSiblingFingerprint(t *testing.T) {
	base := siblingFingerprint("/p", "abc", "a/b.go")
	if !strings.HasPrefix(base, "RAD-") {
		t.Fatalf("prefix: %s", base)
	}
	if siblingFingerprint("/p", "abc", "a/b.go") != base {
		t.Error("not stable")
	}
	if siblingFingerprint("/p", "abc", `a\b.go`) != base {
		t.Error("backslash differs")
	}
	for _, other := range []string{siblingFingerprint("/q", "abc", "a/b.go"), siblingFingerprint("/p", "abd", "a/b.go"), siblingFingerprint("/p", "abc", "a/c.go")} {
		if other == base {
			t.Error("collision across differing input")
		}
	}
}

func TestCommitSignal(t *testing.T) {
	c := fixCommit{Hash: "deadbeefcafe", Subject: "fix x", Ts: 1234, Files: []string{"b.go", "a.go"}}
	s := commitSignal(c)
	if s.Collector != CollectorGit || s.SourceRef != "commit:deadbeefcafe" || s.ObservedTs != 1234 || len(s.Paths) != 2 {
		t.Fatalf("signal: %+v", s)
	}
	if commitSignal(c).ID != s.ID {
		t.Error("id not stable")
	}
}

func TestFindingsFromAudit(t *testing.T) {
	p := hitsProject(t)
	c := fixCommit{Hash: "deadbeefcafe", Subject: "fix x", Files: []string{"a.go"}}
	hit := func(file string, line int) auditHit {
		return auditHit{File: file, Line: line, Title: "t", Trigger: "when x", Actual: "act", Expected: "exp", WhyNotCovered: "why", Severity: "low"}
	}
	got := func(hits ...auditHit) ([]waveobj.RadarFinding, int) {
		return findingsFromAudit(p, c, &auditReply{RootCause: "rc", Hits: hits})
	}
	if f, k := got(hit("a.go", 1), hit("b.go", 2)); len(f) != 2 || k != 2 {
		t.Errorf("two files: %d findings kept %d", len(f), k)
	}
	f, k := got(hit("a.go", 1), hit("a.go", 2))
	if len(f) != 1 || k != 2 || len(f[0].Sites) != 2 {
		t.Fatalf("one file: %+v kept %d", f, k)
	}
	if f, k := got(hit("a.go", 1), hit("a.go", 99)); len(f) != 1 || k != 1 {
		t.Errorf("one invalid: %d kept %d", len(f), k)
	}
	if f, k := got(); len(f) != 0 || k != 0 {
		t.Error("zero hits")
	}
	if f, k := findingsFromAudit(p, c, nil); len(f) != 0 || k != 0 {
		t.Error("nil reply")
	}
	hi := hit("a.go", 3)
	hi.Severity = "high"
	f, _ = got(hit("a.go", 1), hi)
	if f[0].Severity != "high" || f[0].Group != GroupNew || f[0].RiskKind != RiskSiblingBug || f[0].SourceCommit != c.Hash {
		t.Errorf("fields: %+v", f[0])
	}
	for _, want := range []string{"deadbee", "a.go:1", "when x"} {
		if !strings.Contains(f[0].Mission, want) {
			t.Errorf("mission lacks %q: %s", want, f[0].Mission)
		}
	}
	secret := hit("a.go", 1)
	secret.Trigger = "password = hunter2hunter2XYZ"
	f, _ = got(secret)
	if strings.Contains(f[0].Sites[0].Trigger, "hunter2hunter2XYZ") || strings.Contains(f[0].Mission, "hunter2hunter2XYZ") {
		t.Errorf("secret not redacted: %+v", f[0].Sites[0])
	}
}

func TestStillDetected(t *testing.T) {
	p := hitsProject(t)
	f := waveobj.RadarFinding{Files: []string{"a.go"}, Sites: []waveobj.RadarSite{{Line: 3, Trigger: "t"}}}
	if !stillDetected(p, f) {
		t.Fatal("expected detected")
	}
	if stillDetected(p, waveobj.RadarFinding{Files: []string{"a.go"}}) {
		t.Error("no sites should be false")
	}
	if err := os.WriteFile(filepath.Join(p, "a.go"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if stillDetected(p, f) {
		t.Error("shortened file should be false")
	}
	if err := os.Remove(filepath.Join(p, "a.go")); err != nil {
		t.Fatal(err)
	}
	if stillDetected(p, f) {
		t.Error("deleted file should be false")
	}
}
