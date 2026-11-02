// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestSetProjectConfigValue(t *testing.T) {
	wavebase.ConfigHome_VarCache = t.TempDir() // point config home at a temp dir

	if err := SetProjectConfigValue("payments-api", waveobj.MetaMapType{"path": "/home/u/code/payments-api"}); err != nil {
		t.Fatalf("write: %v", err)
	}

	m, cerrs := ReadWaveHomeConfigFile(ProjectsFile)
	if len(cerrs) > 0 {
		t.Fatalf("read errors: %v", cerrs)
	}
	proj := m.GetMap("payments-api")
	if proj == nil {
		t.Fatal("project entry not written")
	}
	if got := proj.GetString("path", ""); got != "/home/u/code/payments-api" {
		t.Fatalf("path = %q, want /home/u/code/payments-api", got)
	}
}

func TestDeleteProjectConfigValue(t *testing.T) {
	wavebase.ConfigHome_VarCache = t.TempDir()

	if err := SetProjectConfigValue("keep", waveobj.MetaMapType{"path": "/a"}); err != nil {
		t.Fatalf("write keep: %v", err)
	}
	if err := SetProjectConfigValue("drop", waveobj.MetaMapType{"path": "/b"}); err != nil {
		t.Fatalf("write drop: %v", err)
	}

	if err := DeleteProjectConfigValue("drop"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	m, cerrs := ReadWaveHomeConfigFile(ProjectsFile)
	if len(cerrs) > 0 {
		t.Fatalf("read errors: %v", cerrs)
	}
	if m.GetMap("drop") != nil {
		t.Fatal("deleted project still present")
	}
	if m.GetMap("keep") == nil {
		t.Fatal("surviving project was removed")
	}
}

// Two projects registered at the same path make the resolver pick an arbitrary winner: a channel created
// under one name files under the other's group header, silently and with no stable ordering. The fix is at
// the boundary — the resolver must not learn a tie-break rule for data that should never exist.
func TestProjectNameAtPath(t *testing.T) {
	wavebase.ConfigHome_VarCache = t.TempDir()
	if err := SetProjectConfigValue("waveterm", waveobj.MetaMapType{"path": "C:/Users/k/code/waveterm"}); err != nil {
		t.Fatalf("write: %v", err)
	}

	t.Run("finds the project already at that path", func(t *testing.T) {
		name, ok := ProjectNameAtPath("C:/Users/k/code/waveterm")
		if !ok || name != "waveterm" {
			t.Fatalf("ProjectNameAtPath = (%q, %v), want (waveterm, true)", name, ok)
		}
	})

	// a project registers its path verbatim and callers pass whatever the user typed, so the same
	// directory arrives with either slash direction and with or without a trailing one.
	t.Run("compares separator- and trailing-slash-insensitively", func(t *testing.T) {
		for _, p := range []string{`C:\Users\k\code\waveterm`, "C:/Users/k/code/waveterm/", `C:\Users\k\code\waveterm\`} {
			if name, ok := ProjectNameAtPath(p); !ok || name != "waveterm" {
				t.Fatalf("ProjectNameAtPath(%q) = (%q, %v), want (waveterm, true)", p, name, ok)
			}
		}
	})

	t.Run("reports nothing for an unregistered path", func(t *testing.T) {
		if name, ok := ProjectNameAtPath("C:/Users/k/code/other"); ok {
			t.Fatalf("ProjectNameAtPath = (%q, true), want not found", name)
		}
	})

	t.Run("reports nothing for an empty path", func(t *testing.T) {
		if _, ok := ProjectNameAtPath(""); ok {
			t.Fatal("an empty path must never match a registration")
		}
	})
}

func TestDeleteProjectConfigValueMissingIsNoop(t *testing.T) {
	wavebase.ConfigHome_VarCache = t.TempDir()
	if err := DeleteProjectConfigValue("never-registered"); err != nil {
		t.Fatalf("deleting a missing project should succeed, got %v", err)
	}
}

func TestSetProjectConfigValueNilRemovesKey(t *testing.T) {
	wavebase.ConfigHome_VarCache = t.TempDir()

	if err := SetProjectConfigValue("p", waveobj.MetaMapType{"path": "/a", "claudeaccount": "a1"}); err != nil {
		t.Fatal(err)
	}
	if err := SetProjectConfigValue("p", waveobj.MetaMapType{"claudeaccount": nil}); err != nil {
		t.Fatal(err)
	}
	m, _ := ReadWaveHomeConfigFile(ProjectsFile)
	proj := m.GetMap("p")
	if _, ok := proj["claudeaccount"]; ok {
		t.Fatalf("claudeaccount still set: %v", proj)
	}
	if proj.GetString("path", "") != "/a" {
		t.Fatalf("path lost: %v", proj)
	}
}

func TestProjectForDir(t *testing.T) {
	projects := map[string]ProjectKeywords{
		"mono":  {Path: "/code/mono"},
		"inner": {Path: "/code/mono/apps/web"},
		"home":  {Path: "~/notes"},
	}
	cases := map[string]string{
		"/code/mono":              "mono",
		"/code/mono/pkg":          "mono",
		"/code/mono/apps/web/src": "inner", // the longest path holding it
		"/home/u/notes/today":     "home",  // ~ is home
		"/code/monorepo":          "",      // shares a prefix only
		"":                        "",
	}
	for dir, want := range cases {
		got, _, ok := ProjectForDir(dir, projects, "/home/u")
		if got != want || ok != (want != "") {
			t.Errorf("ProjectForDir(%q) = %q, %v; want %q", dir, got, ok, want)
		}
	}
}
