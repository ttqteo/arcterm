// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import "testing"

func TestNormalizeSubject(t *testing.T) {
	cases := map[string]string{
		"[SIEM-1713][MPWeb][SIEM-1713] fix(auth): x": "fix(auth): x",
		"  [a] [b]  feat: y":                         "feat: y",
		"fix: no tags":                               "fix: no tags",
		"fix: keeps [inner] tag":                     "fix: keeps [inner] tag",
	}
	for in, want := range cases {
		if got := normalizeSubject(in); got != want {
			t.Errorf("normalizeSubject(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAuditTargetKey(t *testing.T) {
	sib := auditTarget{Kind: KindSibling, Commit: "abc", Files: []string{"a.go"}}
	empty := auditTarget{Commit: "abc", Files: []string{"b.go"}}
	if sib.Key() != empty.Key() {
		t.Errorf("sibling %q and empty kind %q should share a key", sib.Key(), empty.Key())
	}
	intro := auditTarget{Kind: KindIntroduced, Commit: "abc", Files: []string{"a.go"}}
	if intro.Key() == sib.Key() {
		t.Errorf("introduced and sibling share key %q for the same commit", intro.Key())
	}
	hot := auditTarget{Kind: KindHotspot, Commit: "rev1", Files: []string{"a.go"}}
	if hot.Key() != "hotspot\x00rev1\x00a.go" {
		t.Errorf("hotspot key = %q, want kind, revision and file", hot.Key())
	}
	if other := (auditTarget{Kind: KindHotspot, Commit: "rev1", Files: []string{"b.go"}}); other.Key() == hot.Key() {
		t.Errorf("hotspot key ignores the file: %q", hot.Key())
	}
	if newer := (auditTarget{Kind: KindHotspot, Commit: "rev2", Files: []string{"a.go"}}); newer.Key() == hot.Key() {
		t.Errorf("hotspot key ignores the revision: %q", hot.Key())
	}
}

func TestExtractJSONObject(t *testing.T) {
	ok := []struct{ name, in, want string }{
		{"bare", `{"a":1}`, `{"a":1}`},
		{"fenced json", "```json\n{\"a\":1}\n```", `{"a":1}`},
		{"fenced plain", "```\n{\"a\":1}\n```", `{"a":1}`},
		{"prose around", "Here it is: {\"a\":1} hope that helps", `{"a":1}`},
		{"prose around fence", "Result:\n```json\n{\"a\":1}\n```\nDone {not this}", `{"a":1}`},
		{"nested", `{"a":{"b":[{"c":2}]}}`, `{"a":{"b":[{"c":2}]}}`},
	}
	for _, c := range ok {
		got, err := extractJSONObject(c.in)
		if err != nil || got != c.want {
			t.Errorf("%s: got %q, %v; want %q", c.name, got, err, c.want)
		}
	}
	for _, in := range []string{"no object here", "null", "```json\nnull\n```", "} backwards {"} {
		if got, err := extractJSONObject(in); err == nil {
			t.Errorf("extractJSONObject(%q) = %q, want error", in, got)
		}
	}
}
