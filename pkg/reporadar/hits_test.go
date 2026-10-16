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

func TestSiblingTargetSignal(t *testing.T) {
	c := auditTarget{Kind: KindSibling, Commit: "deadbeefcafe", Subject: "fix x", Ts: 1234, Files: []string{"b.go", "a.go"}}
	s := targetSignal(c)
	if s.Collector != CollectorGit || s.SourceRef != "commit:deadbeefcafe" || s.ObservedTs != 1234 || len(s.Paths) != 2 {
		t.Fatalf("signal: %+v", s)
	}
	if targetSignal(c).ID != s.ID {
		t.Error("id not stable")
	}
}

func TestSiblingTargetFindings(t *testing.T) {
	p := hitsProject(t)
	c := auditTarget{Kind: KindSibling, Commit: "deadbeefcafe", Subject: "fix x", Files: []string{"a.go"}}
	hit := func(file string, line int) auditHit {
		return auditHit{File: file, Line: line, Title: "t", Trigger: "when x", Actual: "act", Expected: "exp", WhyNotCovered: "why", Severity: "low"}
	}
	got := func(hits ...auditHit) ([]waveobj.RadarFinding, int) {
		return targetFindings(p, c, &auditReply{RootCause: "rc", Hits: hits})
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
	if f, k := targetFindings(p, c, nil); len(f) != 0 || k != 0 {
		t.Error("nil reply")
	}
	hi := hit("a.go", 3)
	hi.Severity = "high"
	f, _ = got(hit("a.go", 1), hi)
	if f[0].Severity != "high" || f[0].Group != GroupNew || f[0].RiskKind != RiskSiblingBug || f[0].SourceCommit != c.Commit {
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

func TestTargetFingerprint(t *testing.T) {
	sib := auditTarget{Kind: KindSibling, Commit: "abc", Files: []string{"a/b.go"}}
	base := targetFingerprint("/p", sib, "a/b.go")
	// pinned from siblingFingerprint before the kinds landed: existing findings keep their identity
	if base != "RAD-7061b549" || base != siblingFingerprint("/p", "abc", "a/b.go") {
		t.Errorf("sibling fingerprint = %s, want RAD-7061b549", base)
	}
	if got := targetFingerprint("/p", auditTarget{Commit: "abc"}, "a/b.go"); got != base {
		t.Errorf("an empty kind fingerprints as sibling: %s", got)
	}
	intro := targetFingerprint("/p", auditTarget{Kind: KindIntroduced, Commit: "abc"}, "a/b.go")
	hot := targetFingerprint("/p", auditTarget{Kind: KindHotspot, Commit: "abc", Files: []string{"a/b.go"}}, "a/b.go")
	if intro == base || hot == base || intro == hot {
		t.Errorf("kinds must not share a fingerprint: sibling %s introduced %s hotspot %s", base, intro, hot)
	}
	for _, fp := range []string{intro, hot} {
		if !strings.HasPrefix(fp, "RAD-") || len(fp) != len("RAD-")+8 {
			t.Errorf("fingerprint shape: %s", fp)
		}
	}
	if got := targetFingerprint("/p", auditTarget{Kind: KindHotspot, Commit: "abd", Files: []string{"a/b.go"}}, "a/b.go"); got == hot {
		t.Error("a hotspot fingerprint must change with the revision")
	}
	if got := targetFingerprint("/p", auditTarget{Kind: KindIntroduced, Commit: "abc"}, `a\b.go`); got != intro {
		t.Error("backslash path differs")
	}
}

func TestTargetFindingsPerKind(t *testing.T) {
	p := hitsProject(t)
	hit := func(line int) auditHit {
		return auditHit{File: "a.go", Line: line, Title: "t", Trigger: "when x", Actual: "act", Expected: "exp", WhyNotCovered: "why", Severity: "low"}
	}
	reply := &auditReply{RootCause: "rc.", Hits: []auditHit{hit(1), hit(2)}}
	sib := auditTarget{Kind: KindSibling, Commit: "deadbeefcafe", Subject: "fix x", Files: []string{"a.go"}}
	intro := auditTarget{Kind: KindIntroduced, Commit: "feedface0000", Subject: "feat: y", Files: []string{"a.go"}}
	hot := auditTarget{Kind: KindHotspot, Commit: "abcabc123456", Subject: "chore: z", Files: []string{"a.go"}, FixSubjects: []string{"fix: a", "fix: b"}}
	hot2 := hot
	hot2.Files = []string{"b.go"}

	cases := []struct {
		target   auditTarget
		risk     string
		missions []string
	}{
		{sib, RiskSiblingBug, []string{"Fix commit deadbee (fix x) fixed a bug; root cause: rc.", "The same bug may remain at:"}},
		{intro, RiskIntroducedBug, []string{"Commit feedfac (feat: y) changed behavior: rc.", "It introduced a defect still present at:"}},
		{hot, RiskHotspotBug, []string{"a.go took 2 fix commits in the last 30 days (fix: a; fix: b). Fragility: rc.", "A latent bug remains at:"}},
	}
	for _, c := range cases {
		f, kept := targetFindings(p, c.target, reply)
		if len(f) != 1 || kept != 2 || len(f[0].Sites) != 2 {
			t.Fatalf("%s: two hits in one file: %d findings, kept %d", c.target.Kind, len(f), kept)
		}
		got := f[0]
		if got.RiskKind != c.risk || got.SourceCommit != c.target.Commit || got.SourceSubject != c.target.Subject || got.Group != GroupNew {
			t.Errorf("%s fields: %+v", c.target.Kind, got)
		}
		if got.Fingerprint != targetFingerprint(p, c.target, "a.go") || len(got.SignalIDs) != 1 || got.SignalIDs[0] != targetSignal(c.target).ID {
			t.Errorf("%s identity: %s %v", c.target.Kind, got.Fingerprint, got.SignalIDs)
		}
		for _, want := range append(c.missions, "- a.go:1 trigger: when x; actual: act; expected: exp", "- a.go:2 trigger") {
			if !strings.Contains(got.Mission, want) {
				t.Errorf("%s mission lacks %q:\n%s", c.target.Kind, want, got.Mission)
			}
		}
		if wantSubjects := c.target.FixSubjects; strings.Join(got.FixSubjects, "|") != strings.Join(wantSubjects, "|") {
			t.Errorf("%s fix subjects = %q, want %q", c.target.Kind, got.FixSubjects, wantSubjects)
		}
	}
	if f, _ := targetFindings(p, sib, reply); f[0].FixSubjects != nil {
		t.Error("commit kinds carry no fix subjects")
	}
	if f, k := targetFindings(p, hot, nil); f != nil || k != 0 {
		t.Error("nil reply")
	}

	if targetSignal(sib).ID != shortHash(CollectorGit+"\x00commit:"+sib.Commit) {
		t.Error("sibling signal ids must stay as before")
	}
	ids := map[string]string{}
	for _, tg := range []auditTarget{sib, intro, {Kind: KindIntroduced, Commit: sib.Commit}, hot, hot2} {
		id := targetSignal(tg).ID
		if prev, dup := ids[id]; dup {
			t.Errorf("%s and %s share signal id %s", prev, tg.Kind+" "+tg.Commit+" "+targetFile(tg), id)
		}
		ids[id] = tg.Kind + " " + tg.Commit + " " + targetFile(tg)
	}
	if s := targetSignal(hot); !strings.HasPrefix(s.Summary, "revision of a.go abcabc1: chore: z") {
		t.Errorf("hotspot signal summary = %q", s.Summary)
	}
	if s := targetSignal(intro); !strings.HasPrefix(s.Summary, "commit feedfac: ") {
		t.Errorf("introduced signal summary = %q", s.Summary)
	}
}
