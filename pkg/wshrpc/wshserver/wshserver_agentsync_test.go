// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsync"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// useAgentSyncHome points the agentsync RPCs at a temp home and vault, with no shipped skills to seed,
// and runs outside a snapshot unless the test sets one.
func useAgentSyncHome(t *testing.T) agentsync.Paths {
	t.Helper()
	home := t.TempDir()
	vault := filepath.Join(home, "vault")
	p := agentsync.Paths{Home: home, SteeringDoc: filepath.Join(vault, "steering", "AGENTS.md"), SkillsRoot: filepath.Join(vault, "skills")}
	old := defaultPaths
	defaultPaths = func() agentsync.Paths { return p }
	oldSnapshot := wavebase.Snapshot_VarCache
	wavebase.Snapshot_VarCache = false
	t.Cleanup(func() {
		defaultPaths = old
		wavebase.Snapshot_VarCache = oldSnapshot
	})
	return p
}

func writeAgentSyncFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// harnessSkill writes an unmanaged claude skill and returns its SKILL.md path.
func harnessSkill(t *testing.T, p agentsync.Paths, name string) string {
	t.Helper()
	path := filepath.Join(p.Home, ".claude", "skills", name, "SKILL.md")
	writeAgentSyncFile(t, path, "---\nname: "+name+"\n---\nbody\n")
	return path
}

func TestAgentSyncAdoptPassesSkip(t *testing.T) {
	p := useAgentSyncHome(t)
	skipped := harnessSkill(t, p, "graphify")
	harnessSkill(t, p, "notes")

	rtn, err := (&WshServer{}).AgentSyncAdoptCommand(context.Background(), wshrpc.CommandAgentSyncAdoptData{Apply: true, Skip: []string{"graphify"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(rtn.Moves) != 1 || rtn.Moves[0].Name != "notes" {
		t.Fatalf("moves = %+v, want only the skill not skipped", rtn.Moves)
	}
	if rtn.DryRun {
		t.Error("an apply outside a snapshot is not a dry run")
	}
	if _, err := os.Stat(skipped); err != nil {
		t.Fatalf("the skipped skill left the harness folder: %v", err)
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "graphify")); !os.IsNotExist(err) {
		t.Error("the skipped skill reached the vault")
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "notes", "SKILL.md")); err != nil {
		t.Errorf("the other skill was not adopted: %v", err)
	}
}

func TestAgentSyncAdoptDryRunUnderSnapshot(t *testing.T) {
	p := useAgentSyncHome(t)
	src := harnessSkill(t, p, "graphify")
	wavebase.Snapshot_VarCache = true

	rtn, err := (&WshServer{}).AgentSyncAdoptCommand(context.Background(), wshrpc.CommandAgentSyncAdoptData{Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	if !rtn.DryRun {
		t.Fatalf("reply = %+v, want DryRun under a snapshot", rtn)
	}
	if len(rtn.Moves) != 1 {
		t.Fatalf("moves = %+v, want what an apply would move", rtn.Moves)
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("a snapshot moved the skill: %v", err)
	}
	if _, err := os.Stat(p.SkillsRoot); !os.IsNotExist(err) {
		t.Error("a snapshot created the vault skills root")
	}
}

// Linked is omitempty on the wire (a reader treats a missing list as none), but the reply never carries a
// nil slice: it is absent or [], never null.
func TestAgentSyncSkillsLinkedNeverNull(t *testing.T) {
	p := useAgentSyncHome(t)
	harnessSkill(t, p, "graphify")

	rtn, err := (&WshServer{}).AgentSyncSkillsCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Linked == nil || len(rtn.Linked) != 0 {
		t.Fatalf("linked = %#v, want an empty slice", rtn.Linked)
	}
	data, err := json.Marshal(rtn)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `"linked":null`) {
		t.Fatalf("reply = %s, want linked absent or [], never null", data)
	}
}

func TestAgentSyncStatusMapsNoteTone(t *testing.T) {
	p := useAgentSyncHome(t)
	settings, err := json.Marshal(map[string]any{"skills": []string{p.SkillsRoot}})
	if err != nil {
		t.Fatal(err)
	}
	writeAgentSyncFile(t, filepath.Join(p.Home, ".pi", "agent", "settings.json"), string(settings))

	rtn, err := (&WshServer{}).AgentSyncStatusCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range rtn.Harnesses {
		if h.Runtime == "pi" {
			if h.NoteTone != "ok" || h.Note == "" {
				t.Fatalf("pi = %+v, want its note in the ok tone", h)
			}
			return
		}
	}
	t.Fatalf("harnesses = %+v, want a pi row", rtn.Harnesses)
}

func TestKeepVaultMatchesWire(t *testing.T) {
	if agentsync.KeepVault != wshrpc.AgentSyncKeepVault {
		t.Fatalf("agentsync.KeepVault = %q, wshrpc.AgentSyncKeepVault = %q: the frontend sends the wire value", agentsync.KeepVault, wshrpc.AgentSyncKeepVault)
	}
}
