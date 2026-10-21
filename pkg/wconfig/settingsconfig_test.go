// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func useTempConfigHome(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = dir
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })
	return dir
}

func TestReadCouncilRolesMissingFileIsEmpty(t *testing.T) {
	useTempConfigHome(t)
	cfg, err := ReadCouncilRoles()
	if err != nil {
		t.Fatalf("ReadCouncilRoles: %v", err)
	}
	if len(cfg.Roles) != 0 || len(cfg.Groups) != 0 {
		t.Fatalf("a missing file must read as empty, got %+v", cfg)
	}
}

func TestReadCouncilRolesParsesRolesAndGroups(t *testing.T) {
	dir := useTempConfigHome(t)
	body := `{"roles":[{"id":"ux","model":"haiku"},{"id":"a11y","name":"Accessibility","brief":"Keyboard only?","model":"sonnet"}],
"groups":[{"id":"mine","name":"Mine","roles":["ux","skeptic"],"coordinator":"coordinator"}]}`
	if err := os.WriteFile(filepath.Join(dir, CouncilRolesFile), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := ReadCouncilRoles()
	if err != nil {
		t.Fatalf("ReadCouncilRoles: %v", err)
	}
	wantRoles := []CouncilRoleConfig{
		{Id: "ux", Model: "haiku"},
		{Id: "a11y", Name: "Accessibility", Brief: "Keyboard only?", Model: "sonnet"},
	}
	if !reflect.DeepEqual(cfg.Roles, wantRoles) {
		t.Errorf("roles = %+v, want %+v", cfg.Roles, wantRoles)
	}
	wantGroups := []CouncilGroupConfig{{Id: "mine", Name: "Mine", Roles: []string{"ux", "skeptic"}, Coordinator: "coordinator"}}
	if !reflect.DeepEqual(cfg.Groups, wantGroups) {
		t.Errorf("groups = %+v, want %+v", cfg.Groups, wantGroups)
	}
}

func TestReadCouncilRolesBrokenFileIsAnError(t *testing.T) {
	dir := useTempConfigHome(t)
	if err := os.WriteFile(filepath.Join(dir, CouncilRolesFile), []byte(`{"roles": [`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadCouncilRoles(); err == nil {
		t.Fatal("a file that does not parse must be an error, not an empty config")
	}
}

func TestSetUserCouncilGroupWritesTheFile(t *testing.T) {
	dir := useTempConfigHome(t)
	g := CouncilGroupConfig{Id: "mine", Name: "Mine", Roles: []string{"ux", "ram"}, Coordinator: "coordinator"}
	if err := SetUserCouncilGroup(g); err != nil {
		t.Fatalf("SetUserCouncilGroup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, CouncilRolesFile)); err != nil {
		t.Fatalf("councilroles.json not written: %v", err)
	}
	cfg, err := ReadCouncilRoles()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg.Groups, []CouncilGroupConfig{g}) {
		t.Fatalf("groups = %+v, want [%+v]", cfg.Groups, g)
	}
}

func TestSetUserCouncilGroupReplacesTheSameIdAndKeepsTheRoles(t *testing.T) {
	dir := useTempConfigHome(t)
	body := `{"roles":[{"id":"ux","model":"haiku"}],
"groups":[{"id":"one","name":"One","roles":["ux"],"coordinator":"coordinator"},
{"id":"two","name":"Two","roles":["ram"],"coordinator":"coordinator"}]}`
	if err := os.WriteFile(filepath.Join(dir, CouncilRolesFile), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	replacement := CouncilGroupConfig{Id: "one", Name: "One, renamed", Roles: []string{"skeptic"}, Coordinator: "coordinator"}
	if err := SetUserCouncilGroup(replacement); err != nil {
		t.Fatalf("SetUserCouncilGroup: %v", err)
	}
	cfg, err := ReadCouncilRoles()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg.Roles, []CouncilRoleConfig{{Id: "ux", Model: "haiku"}}) {
		t.Errorf("the file's roles were not kept: %+v", cfg.Roles)
	}
	wantGroups := []CouncilGroupConfig{
		replacement,
		{Id: "two", Name: "Two", Roles: []string{"ram"}, Coordinator: "coordinator"},
	}
	if !reflect.DeepEqual(cfg.Groups, wantGroups) {
		t.Errorf("groups = %+v, want %+v", cfg.Groups, wantGroups)
	}
}

func TestSetUserCouncilGroupRefusesABrokenFile(t *testing.T) {
	dir := useTempConfigHome(t)
	broken := []byte(`{"roles": [`)
	path := filepath.Join(dir, CouncilRolesFile)
	if err := os.WriteFile(path, broken, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SetUserCouncilGroup(CouncilGroupConfig{Id: "g", Name: "G", Roles: []string{"ux"}, Coordinator: "coordinator"}); err == nil {
		t.Fatal("writing over a file that does not parse would lose the person's roles; it must be an error")
	}
	if got, _ := os.ReadFile(path); string(got) != string(broken) {
		t.Errorf("the broken file was changed: %q", got)
	}
}
