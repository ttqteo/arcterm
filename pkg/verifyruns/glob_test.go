// pkg/verifyruns/glob_test.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMatch(t *testing.T) {
	tests := []struct {
		pattern, rel string
		want         bool
	}{
		{"frontend/**/*.tsx", "frontend/a.tsx", true},
		{"frontend/**/*.tsx", "frontend/x/y/b.tsx", true},
		{"frontend/**/*.tsx", "frontend/a.ts", false},
		{"frontend/**/*.tsx", "scripts/a.tsx", false},
		{"frontend/**/*.tsx", "xfrontend/a.tsx", false},
		{"frontend/**/*.css", "frontend/app/view/x.css", true},
		{"frontend/*.tsx", "frontend/a.tsx", true},
		{"frontend/*.tsx", "frontend/x/a.tsx", false},
		{"frontend/**", "frontend/x/y/z.go", true},
		{"**/*.tsx", "a.tsx", true},
		{"**/*.tsx", "a/b/c.tsx", true},
		{"**", "anything/at/all", true},
		{"a/**/b/**/c.txt", "a/b/c.txt", true},
		{"a/**/b/**/c.txt", "a/x/b/y/z/c.txt", true},
		{"a/**/b/**/c.txt", "a/x/c.txt", false},
		{"src/app.tsx", "src/app.tsx", true},
		{"src/app.tsx", "src/app.tsx.bak", false},
		{"", "a.tsx", false},
		{"frontend/**/*.tsx", "", false},
	}
	for _, tc := range tests {
		if got := Match(tc.pattern, tc.rel); got != tc.want {
			t.Errorf("Match(%q, %q) = %v, want %v", tc.pattern, tc.rel, got, tc.want)
		}
	}
}

func TestLoadConfigAbsentIsNil(t *testing.T) {
	cfg, err := LoadConfig(t.TempDir())
	if err != nil || cfg != nil {
		t.Fatalf("LoadConfig on a repo with no .arc/verify.json = (%v, %v), want (nil, nil)", cfg, err)
	}
}

func TestLoadConfigReadsWatchAndRerun(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".arc"), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{ "watch": ["frontend/**/*.tsx", "frontend/**/*.css"], "rerun": "task verify:ui -- <name>" }`
	if err := os.WriteFile(filepath.Join(root, ".arc", "verify.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(root)
	if err != nil || cfg == nil {
		t.Fatalf("LoadConfig = (%v, %v)", cfg, err)
	}
	if len(cfg.Watch) != 2 || cfg.Watch[0] != "frontend/**/*.tsx" || cfg.Rerun != "task verify:ui -- <name>" {
		t.Errorf("cfg = %+v", cfg)
	}
	if !cfg.Watches("frontend/a/b.css") || cfg.Watches("docs/a.md") {
		t.Errorf("Watches: css under frontend should match, docs should not")
	}
}

func TestLoadConfigMalformedIsAnError(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".arc"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".arc", "verify.json"), []byte(`{ "watch": `), 0o644); err != nil {
		t.Fatal(err)
	}
	if cfg, err := LoadConfig(root); err == nil {
		t.Fatalf("LoadConfig on malformed JSON = (%v, nil), want an error", cfg)
	}
}
