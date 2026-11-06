// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisdossier

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavevault"
)

// fixedNow pins nowFn for deterministic timestamps/filenames within a test.
func fixedNow(t *testing.T, ms int64) {
	t.Helper()
	prev := nowFn
	nowFn = func() int64 { return ms }
	t.Cleanup(func() { nowFn = prev })
}

func newVault(t *testing.T) *wavevault.Vault {
	t.Helper()
	v, err := wavevault.OpenVaultAtForTest(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestCreateAndLoadDossierRoundTrips(t *testing.T) {
	fixedNow(t, 1753324800000)
	v := newVault(t)
	id, hash, err := CreateDossier(v, DossierFacts{
		Ticket:     "PROJ-142",
		Objective:  "add OAuth: PKCE flow", // contains a colon — must be YAML-safe
		Acceptance: []string{"tokens rotate", "no long-lived refresh"},
	})
	if err != nil {
		t.Fatalf("CreateDossier: %v", err)
	}
	if id == "" || hash == "" {
		t.Fatal("CreateDossier must return an id and hash")
	}
	d, err := LoadDossier(v.Retriever(wavevault.AllScope()), id)
	if err != nil {
		t.Fatalf("LoadDossier: %v", err)
	}
	if d.Status != "active" || d.Ticket != "PROJ-142" || d.Objective != "add OAuth: PKCE flow" {
		t.Fatalf("scalar round-trip failed: %+v", d)
	}
	if len(d.Acceptance) != 2 || d.Acceptance[0] != "tokens rotate" {
		t.Fatalf("acceptance flow-list round-trip failed: %+v", d.Acceptance)
	}
	if d.Confidence != "med" {
		t.Fatalf("confidence default = %q, want med", d.Confidence)
	}
	if d.Created != 1753324800000 || d.Updated != 1753324800000 {
		t.Fatalf("timestamps = %d/%d", d.Created, d.Updated)
	}
}

func TestLoadDossierTolerantOfMissingKeys(t *testing.T) {
	v := newVault(t)
	// a minimal, hand-written dossier missing acceptance/confidence/timestamps
	if _, err := v.Create("tasks/active", "bare.md",
		"---\nstatus: active\n---\n<!-- jarvis:begin state -->\n<!-- jarvis:end state -->\n"); err != nil {
		t.Fatal(err)
	}
	d, err := LoadDossier(v.Retriever(wavevault.AllScope()), "bare")
	if err != nil {
		t.Fatalf("tolerant load must not error: %v", err)
	}
	if d.Status != "active" || d.Confidence != "" || len(d.Acceptance) != 0 {
		t.Fatalf("tolerant load projection wrong: %+v", d)
	}
}

func TestSettersUpdateMachineRegionsAndBumpUpdated(t *testing.T) {
	fixedNow(t, 1753324800000)
	v := newVault(t)
	id, hash, err := CreateDossier(v, DossierFacts{Ticket: "PROJ-1", Objective: "do a thing"})
	if err != nil {
		t.Fatal(err)
	}

	fixedNow(t, 1753324899999) // time advances before the update
	res, err := SetStatus(v, id, "paused", hash)
	if err != nil {
		t.Fatalf("SetStatus: %v", err)
	}
	if res.Conflict {
		t.Fatal("no concurrent edit — Conflict must be false")
	}

	d, err := LoadDossier(v.Retriever(wavevault.AllScope()), id)
	if err != nil {
		t.Fatal(err)
	}
	if d.Status != "paused" {
		t.Fatalf("status = %q, want paused", d.Status)
	}
	if d.Updated != 1753324899999 {
		t.Fatalf("updated not bumped: %d", d.Updated)
	}
	if d.Created != 1753324800000 {
		t.Fatalf("created must not change: %d", d.Created)
	}
	if d.Objective != "do a thing" {
		t.Fatalf("other machine fields must survive: %+v", d)
	}
}

func TestSetStateBlockersRefsPreserveHumanProse(t *testing.T) {
	v := newVault(t)
	id, hash, err := CreateDossier(v, DossierFacts{Ticket: "PROJ-2", Objective: "x"})
	if err != nil {
		t.Fatal(err)
	}
	r1, err := SetState(v, id, "worker paused mid-migration, 3 of 8 files done", hash)
	if err != nil {
		t.Fatalf("SetState: %v", err)
	}
	r2, err := SetBlockers(v, id, []string{"waiting on infra key rotation"}, r1.Hash)
	if err != nil {
		t.Fatalf("SetBlockers: %v", err)
	}
	if _, err := SetRefs(v, id, []string{"run-abc"}, r2.Hash); err != nil {
		t.Fatalf("SetRefs: %v", err)
	}
	d, err := LoadDossier(v.Retriever(wavevault.AllScope()), id)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d.State, "3 of 8") {
		t.Fatalf("state = %q", d.State)
	}
	if len(d.Blockers) != 1 || d.Blockers[0] != "waiting on infra key rotation" {
		t.Fatalf("blockers = %+v", d.Blockers)
	}
	if len(d.Refs) != 1 || d.Refs[0] != "run-abc" {
		t.Fatalf("refs = %+v", d.Refs)
	}
}

func TestLoadDossierProjectsHumanNotes(t *testing.T) {
	v := newVault(t)
	// a dossier whose human ## Notes prose sits after the machine blocks
	content := "---\nstatus: active\nobjective: x\n---\n" +
		"<!-- jarvis:begin state -->\nrunning\n<!-- jarvis:end state -->\n" +
		"<!-- jarvis:begin refs -->\n<!-- jarvis:end refs -->\n" +
		"<!-- jarvis:begin blockers -->\n<!-- jarvis:end blockers -->\n\n" +
		"## Notes\n\nremember to rotate the infra key first\n"
	if _, err := v.Create("tasks/active", "noted.md", content); err != nil {
		t.Fatal(err)
	}
	d, err := LoadDossier(v.Retriever(wavevault.AllScope()), "noted")
	if err != nil {
		t.Fatalf("LoadDossier: %v", err)
	}
	if !strings.Contains(d.Notes, "rotate the infra key") {
		t.Fatalf("Notes did not capture the human prose: %q", d.Notes)
	}
	// the machine block content must NOT leak into Notes
	if strings.Contains(d.Notes, "running") || strings.Contains(d.Notes, "jarvis:begin") {
		t.Fatalf("Notes leaked machine-block content: %q", d.Notes)
	}
}

func TestLoadDossierCRLF(t *testing.T) {
	v := newVault(t)
	raw := "---\r\nid: crlf-1\r\nstatus: completed\r\nobjective: ship it\r\nupdated: 1753324800000\r\n---\r\n\r\n" +
		"<!-- jarvis:begin state -->\r\nall good\r\n<!-- jarvis:end state -->\r\n"
	if _, err := v.Create("tasks/active", "crlf-1.md", raw); err != nil {
		t.Fatal(err)
	}
	d, err := LoadDossier(v.Retriever(wavevault.AllScope()), "crlf-1")
	if err != nil {
		t.Fatal(err)
	}
	if d.Objective != "ship it" || d.Status != "completed" || d.Updated != 1753324800000 || d.State != "all good" {
		t.Fatalf("dossier = %+v", d)
	}
}
