// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const runsTestSpec = "docs/superpowers/specs/2026-11-26-coupons-design.md"

// runsTestBrainstorm writes a brainstorm.json under a fresh project's .superpowers and returns the project and the file.
func runsTestBrainstorm(t *testing.T, body string) (string, string) {
	t.Helper()
	project := t.TempDir()
	dir := filepath.Join(project, ".superpowers", "brainstorm", "coupons")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "brainstorm.json")
	if err := os.WriteFile(file, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return project, file
}

// useTabBrainstorm makes the tab's session:brainstorm meta file (or the read fail with err).
func useTabBrainstorm(t *testing.T, file string, err error) {
	t.Helper()
	old := runsTabBrainstorm
	runsTabBrainstorm = func(string) (string, error) { return file, err }
	t.Cleanup(func() { runsTabBrainstorm = old })
}

const runsTestDoc = `{"title": "Coupons", "spec": "` + runsTestSpec + `", "run": null}`

func TestRunsBrainstormFlagLinksAQueuedStart(t *testing.T) {
	_, file := runsTestBrainstorm(t, runsTestDoc)
	useTabBrainstorm(t, "", errors.New("the flag must not read the tab"))
	data := wshrpc.CommandCreateRunData{Goal: "anything at all", OriginTabId: "tab-1"}

	title, err := runsLinkBrainstorm(&data, file)
	if err != nil {
		t.Fatal(err)
	}
	add := runsQueueAddData(data, []string{"r-1"})

	if title != "Coupons" {
		t.Errorf("title = %q, want the brainstorm's", title)
	}
	if add.Brainstorm == nil || add.Brainstorm.Tab != "tab-1" || add.Brainstorm.Path != file {
		t.Fatalf("queue add brainstorm = %+v, want {tab-1 %s}", add.Brainstorm, file)
	}
	if add.Data.Brainstorm != nil {
		t.Errorf("the start data still names the brainstorm: the entry tells it, and only once")
	}
	if len(add.After) != 1 || add.After[0] != "r-1" {
		t.Errorf("after = %v", add.After)
	}
}

func TestRunsBrainstormFlagMakesTheRelativePathAbsolute(t *testing.T) {
	_, file := runsTestBrainstorm(t, runsTestDoc)
	t.Chdir(filepath.Dir(file))
	data := wshrpc.CommandCreateRunData{Goal: "g", OriginTabId: "tab-1"}

	if _, err := runsLinkBrainstorm(&data, "brainstorm.json"); err != nil {
		t.Fatal(err)
	}
	if data.Brainstorm == nil || !filepath.IsAbs(data.Brainstorm.Path) {
		t.Fatalf("brainstorm = %+v, want an absolute path", data.Brainstorm)
	}
}

func TestRunsBrainstormFlagRefusesAFileThatIsNoBrainstorm(t *testing.T) {
	file := filepath.Join(t.TempDir(), "brainstorm.json")
	if err := os.WriteFile(file, []byte(runsTestDoc), 0o644); err != nil {
		t.Fatal(err)
	}
	data := wshrpc.CommandCreateRunData{Goal: "g", OriginTabId: "tab-1"}

	if _, err := runsLinkBrainstorm(&data, file); err == nil || data.Brainstorm != nil {
		t.Fatalf("err = %v, brainstorm = %+v, want a refusal for a file outside .superpowers", err, data.Brainstorm)
	}
}

func TestRunsBrainstormDefaultLinksWhenTheGoalNamesTheSpec(t *testing.T) {
	project, file := runsTestBrainstorm(t, runsTestDoc)
	useTabBrainstorm(t, file, nil)
	// the incident's goal: the spec's absolute path, backslashed on Windows
	goal := "Build Coupons as specified in " + filepath.Join(project, filepath.FromSlash(runsTestSpec)) + " and land it"
	data := wshrpc.CommandCreateRunData{Goal: goal, OriginTabId: "tab-1"}

	title, err := runsLinkBrainstorm(&data, "")
	if err != nil {
		t.Fatal(err)
	}
	add := runsQueueAddData(data, []string{"r-1"})
	if title != "Coupons" || add.Brainstorm == nil || add.Brainstorm.Tab != "tab-1" || add.Brainstorm.Path != file {
		t.Fatalf("title %q, queue add brainstorm = %+v, want the tab's brainstorm", title, add.Brainstorm)
	}
}

func TestRunsBrainstormDefaultLinksWhenThePlanNamesTheSpec(t *testing.T) {
	project, file := runsTestBrainstorm(t, runsTestDoc)
	useTabBrainstorm(t, file, nil)
	plan := filepath.Join(project, "docs", "plan.md")
	if err := os.MkdirAll(filepath.Dir(plan), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(plan, []byte("# Coupons\n\n**Spec:** "+runsTestSpec+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	data := wshrpc.CommandCreateRunData{PlanPath: plan, OriginTabId: "tab-1"}

	if _, err := runsLinkBrainstorm(&data, ""); err != nil {
		t.Fatal(err)
	}
	if data.Brainstorm == nil || data.Brainstorm.Path != file {
		t.Fatalf("brainstorm = %+v, want the tab's brainstorm, named in the plan's text", data.Brainstorm)
	}
}

func TestRunsBrainstormDefaultLinksNothingWhenTheSpecIsNotNamed(t *testing.T) {
	_, file := runsTestBrainstorm(t, runsTestDoc)
	useTabBrainstorm(t, file, nil)
	data := wshrpc.CommandCreateRunData{Goal: "Fix the flaky login test", OriginTabId: "tab-1"}

	title, err := runsLinkBrainstorm(&data, "")
	if err != nil {
		t.Fatal(err)
	}
	if add := runsQueueAddData(data, nil); title != "" || add.Brainstorm != nil || data.Brainstorm != nil {
		t.Fatalf("title %q, brainstorm %+v, want no link for a start that does not name the spec", title, add.Brainstorm)
	}
}

func TestRunsBrainstormDefaultLinksNothingOnceARunIsRecorded(t *testing.T) {
	_, file := runsTestBrainstorm(t, `{"title": "Coupons", "spec": "`+runsTestSpec+`", "run": "r-9"}`)
	useTabBrainstorm(t, file, nil)
	data := wshrpc.CommandCreateRunData{Goal: "again: " + runsTestSpec, OriginTabId: "tab-1"}

	if _, err := runsLinkBrainstorm(&data, ""); err != nil {
		t.Fatal(err)
	}
	if data.Brainstorm != nil {
		t.Fatalf("brainstorm = %+v, want no second link to a brainstorm that records its run", data.Brainstorm)
	}
}

func TestRunsBrainstormDefaultLinksNothingWhenTheTabCannotBeRead(t *testing.T) {
	useTabBrainstorm(t, "", errors.New("no wavesrv"))
	data := wshrpc.CommandCreateRunData{Goal: "g " + runsTestSpec, OriginTabId: "tab-1"}

	if _, err := runsLinkBrainstorm(&data, ""); err != nil || data.Brainstorm != nil {
		t.Fatalf("err = %v, brainstorm = %+v, want the start to go on unlinked", err, data.Brainstorm)
	}
}

func TestRunsSpecNamed(t *testing.T) {
	project := t.TempDir()
	abs := filepath.Join(project, filepath.FromSlash(runsTestSpec))
	cases := []struct {
		name                         string
		spec, goal, planPath, planTx string
		fold, want                   bool
	}{
		{name: "relative spec, absolute in goal", spec: runsTestSpec, goal: "as specified in " + abs, want: true},
		{name: "relative spec, relative in goal", spec: runsTestSpec, goal: "build " + runsTestSpec, want: true},
		{name: "relative spec, other slash", spec: runsTestSpec, goal: "build " + strings.ReplaceAll(runsTestSpec, "/", `\`), want: true},
		{name: "absolute spec, relative in goal", spec: abs, goal: "build " + runsTestSpec, want: true},
		{name: "the plan file is the spec", spec: runsTestSpec, planPath: abs, want: true},
		{name: "named in the plan's text", spec: runsTestSpec, planTx: "Spec: " + abs, want: true},
		{name: "case differs, paths fold", spec: runsTestSpec, goal: strings.ToUpper(runsTestSpec), fold: true, want: true},
		{name: "case differs, paths do not fold", spec: runsTestSpec, goal: strings.ToUpper(runsTestSpec), fold: false, want: false},
		{name: "another spec", spec: runsTestSpec, goal: "build docs/superpowers/specs/2026-11-26-other-design.md"},
		{name: "no spec", spec: "", goal: "build " + runsTestSpec},
	}
	old := runsFoldPaths
	t.Cleanup(func() { runsFoldPaths = old })
	for _, c := range cases {
		runsFoldPaths = c.fold
		if got := runsSpecNamed(c.spec, project, c.goal, c.planPath, c.planTx); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
