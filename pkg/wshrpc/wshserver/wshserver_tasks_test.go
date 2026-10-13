// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestListTaskDossiersReturnsAllStatuses(t *testing.T) {
	ctx := context.Background()
	v, err := wavevault.OpenVaultAtForTest(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("open vault: %v", err)
	}
	_, _, _ = createStatused(t, v, "T-1", "alpha", "active")
	_, _, _ = createStatused(t, v, "T-2", "beta", "completed")
	_, _, _ = createStatused(t, v, "T-3", "gamma", "archived")

	rtn, err := listTaskDossiers(v)
	if err != nil {
		t.Fatalf("listTaskDossiers: %v", err)
	}
	if len(rtn.Dossiers) != 3 {
		t.Fatalf("want all 3 statuses returned, got %d: %+v", len(rtn.Dossiers), rtn.Dossiers)
	}
}

func TestGetDossierAssemblesDecisionsAndNotes(t *testing.T) {
	ctx := context.Background()
	v, err := wavevault.OpenVaultAtForTest(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("open vault: %v", err)
	}
	taskID, _, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Ticket: "T-9", Objective: "assemble me"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := jarvisdossier.AppendDecision(v, jarvisdossier.DecisionFacts{
		TaskID: taskID, Actor: "worker-1", Provenance: "worker-report",
		Rationale: "decision one", Summary: "one",
	}); err != nil {
		t.Fatal(err)
	}
	detail, err := getDossier(v, taskID)
	if err != nil {
		t.Fatalf("getDossier: %v", err)
	}
	if detail.Objective != "assemble me" || detail.Status != "active" {
		t.Fatalf("machine fields wrong: %+v", detail)
	}
	if len(detail.Decisions) != 1 || detail.Decisions[0].Rationale != "decision one" {
		t.Fatalf("decisions not assembled: %+v", detail.Decisions)
	}
}

func TestAppendDossierDecisionAndStatusRoundTrip(t *testing.T) {
	ctx := context.Background()
	v, err := wavevault.OpenVaultAtForTest(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("open vault: %v", err)
	}
	taskID, _, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Ticket: "T-30", Objective: "round trip"})
	if err != nil {
		t.Fatal(err)
	}
	decID, err := appendDossierDecision(ctx, v, wshrpc.CommandAppendDossierDecisionData{
		DossierId: taskID, Summary: "chose b", Rationale: "b needs no migration",
	})
	if err != nil {
		t.Fatalf("appendDossierDecision: %v", err)
	}
	detail, err := getDossier(v, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Decisions) != 1 || detail.Decisions[0].Id != decID {
		t.Fatalf("decision not appended/read back: %+v", detail.Decisions)
	}
	if detail.Decisions[0].Actor != "human" || detail.Decisions[0].Provenance != "human-submit" {
		t.Fatalf("human decision attribution wrong: %+v", detail.Decisions[0])
	}
	// status transition
	if err := setDossierStatus(ctx, v, taskID, "completed"); err != nil {
		t.Fatalf("setDossierStatus: %v", err)
	}
	detail2, err := getDossier(v, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if detail2.Status != "completed" {
		t.Fatalf("status = %q, want completed", detail2.Status)
	}
}

func TestSetDossierStatusRejectsInvalid(t *testing.T) {
	ctx := context.Background()
	v, err := wavevault.OpenVaultAtForTest(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("open vault: %v", err)
	}
	taskID, _, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Ticket: "T-31", Objective: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if err := setDossierStatus(ctx, v, taskID, "banana"); err == nil {
		t.Fatal("an invalid status must be rejected")
	}
}

// createStatused makes a dossier then forces its status, returning the id/hash for chaining.
func createStatused(t *testing.T, v *wavevault.Vault, ticket, objective, status string) (string, string, error) {
	t.Helper()
	id, hash, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Ticket: ticket, Objective: objective})
	if err != nil {
		t.Fatal(err)
	}
	if status != "active" {
		res, err := jarvisdossier.SetStatus(v, id, status, hash)
		if err != nil {
			t.Fatal(err)
		}
		hash = res.Hash
	}
	return id, hash, nil
}
