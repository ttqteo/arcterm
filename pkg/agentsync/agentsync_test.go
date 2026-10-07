// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testPaths builds a temp home with a canonical steering doc and the given harness config roots.
func testPaths(t *testing.T, canonical string, configRoots ...string) Paths {
	t.Helper()
	home := t.TempDir()
	vault := filepath.Join(home, "vault")
	steeringDoc := filepath.Join(vault, "steering", "AGENTS.md")
	if err := os.MkdirAll(filepath.Dir(steeringDoc), 0o755); err != nil {
		t.Fatal(err)
	}
	if canonical != "" {
		if err := os.WriteFile(steeringDoc, []byte(canonical), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, rel := range configRoots {
		if err := os.MkdirAll(filepath.Join(home, filepath.FromSlash(rel)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return Paths{Home: home, SteeringDoc: steeringDoc, SkillsRoot: filepath.Join(vault, "skills")}
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestProjectSteeringSkipsAbsentHarnesses(t *testing.T) {
	p := testPaths(t, "canonical rules\n", ".codex")
	actions, err := projectSteering(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].Runtime != "codex" {
		t.Fatalf("actions = %+v, want one codex write", actions)
	}
	if _, err := os.Stat(filepath.Join(p.Home, ".pi")); !os.IsNotExist(err) {
		t.Fatal("a harness config root that did not exist must never be created")
	}
}

func TestProjectSteeringReachesAgyOnlyWhenItsConfigRootExists(t *testing.T) {
	absent := testPaths(t, "canonical rules\n", ".codex")
	actions, err := projectSteering(absent, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range actions {
		if a.Runtime == "agy" {
			t.Fatalf("agy was written without ~/.gemini/config: %+v", a)
		}
	}
	if _, err := os.Stat(filepath.Join(absent.Home, ".gemini")); !os.IsNotExist(err) {
		t.Fatal("~/.gemini must never be created")
	}

	present := testPaths(t, "canonical rules\n", ".gemini/config")
	actions, err = projectSteering(present, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].Runtime != "agy" {
		t.Fatalf("actions = %+v, want one agy write", actions)
	}
	target := filepath.Join(present.Home, ".gemini", "config", "AGENTS.md")
	if got := readFile(t, target); !strings.Contains(got, "canonical rules") {
		t.Fatalf("agy AGENTS.md = %q", got)
	}
}

func TestProjectSteeringIsIdempotentAndDryRunWritesNothing(t *testing.T) {
	p := testPaths(t, "canonical rules\n", ".codex")
	if _, err := projectSteering(p, false); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(p.Home, ".codex", "AGENTS.md")
	first := readFile(t, target)
	actions, err := projectSteering(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 0 {
		t.Fatalf("second projection reported %+v, want no actions", actions)
	}
	if after := readFile(t, target); after != first {
		t.Fatal("an unchanged projection must not rewrite the file")
	}

	p2 := testPaths(t, "other rules\n", ".codex")
	dryActions, err := projectSteering(p2, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(dryActions) != 1 {
		t.Fatalf("dry run actions = %+v, want one", dryActions)
	}
	if _, err := os.Stat(filepath.Join(p2.Home, ".codex", "AGENTS.md")); !os.IsNotExist(err) {
		t.Fatal("dry run must not write")
	}
}
