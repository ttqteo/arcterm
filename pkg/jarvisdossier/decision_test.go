// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisdossier

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavevault"
)

func TestAppendDecisionLinksAndIsTraversable(t *testing.T) {
	fixedNow(t, 1753324800000)
	v := newVault(t)
	taskID, _, err := CreateDossier(v, DossierFacts{Ticket: "PROJ-9", Objective: "auth cleanup"})
	if err != nil {
		t.Fatal(err)
	}
	decID, err := AppendDecision(v, DecisionFacts{
		TaskID:     taskID,
		Actor:      "worker-3",
		Provenance: "worker-report",
		Links:      []string{"run-abc"},
		Rationale:  "dropped refresh tokens; mobile re-auths silently",
		Summary:    "drop refresh tokens",
	})
	if err != nil {
		t.Fatalf("AppendDecision: %v", err)
	}

	// the dossier's refs now link the decision
	d, err := LoadDossier(v.Retriever(wavevault.AllScope()), taskID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, ref := range d.Refs {
		if ref == decID {
			found = true
		}
	}
	if !found {
		t.Fatalf("dossier refs %+v must contain decision id %q", d.Refs, decID)
	}

	// and the link is a REAL edge: the graph holds task -> decision
	sg, err := v.Retriever(wavevault.AllScope()).Graph()
	if err != nil {
		t.Fatal(err)
	}
	reached := false
	for _, e := range sg.Edges {
		if e.From == taskID && e.To == decID {
			reached = true
		}
	}
	if !reached {
		t.Fatalf("no graph edge from %q to decision %q — refs block is not a real edge", taskID, decID)
	}
}

func TestAppendDecisionCommitsAsJarvis(t *testing.T) {
	fixedNow(t, 1753324800000)
	v := newVault(t)
	taskID, _, err := CreateDossier(v, DossierFacts{Ticket: "PROJ-10", Objective: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AppendDecision(v, DecisionFacts{TaskID: taskID, Actor: "human", Provenance: "human-submit", Summary: "s"}); err != nil {
		t.Fatal(err)
	}
	if err := v.Commit(context.Background(), "decision"); err != nil {
		t.Fatal(err)
	}
	out, err := wavevault.HeadAuthorForTest(context.Background(), v.Root)
	if err != nil {
		t.Fatal(err)
	}
	if out != "Jarvis" {
		t.Fatalf("decision commit author = %q, want Jarvis", out)
	}
}

func TestSupersedeDecisionPreservesRationale(t *testing.T) {
	fixedNow(t, 1753324800000)
	v := newVault(t)
	taskID, _, err := CreateDossier(v, DossierFacts{Ticket: "PROJ-11", Objective: "y"})
	if err != nil {
		t.Fatal(err)
	}
	decID, err := AppendDecision(v, DecisionFacts{
		TaskID: taskID, Actor: "worker-1", Provenance: "worker-report",
		Rationale: "chose approach A because it needs no migration", Summary: "approach a",
	})
	if err != nil {
		t.Fatal(err)
	}
	r := v.Retriever(wavevault.AllScope())
	before, err := LoadDecision(r, decID)
	if err != nil {
		t.Fatalf("LoadDecision: %v", err)
	}
	if before.Status != "active" {
		t.Fatalf("initial status = %q", before.Status)
	}
	res, err := SupersedeDecision(v, decID, "superseded", before.Hash)
	if err != nil {
		t.Fatalf("SupersedeDecision: %v", err)
	}
	if res.Conflict {
		t.Fatal("no concurrent edit — Conflict must be false")
	}
	after, err := LoadDecision(v.Retriever(wavevault.AllScope()), decID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "superseded" {
		t.Fatalf("status = %q, want superseded", after.Status)
	}
	if after.Rationale != before.Rationale {
		t.Fatalf("rationale changed across a status mutation: %q -> %q", before.Rationale, after.Rationale)
	}
}

// A decision's subject must live in frontmatter, not only in the filename. Readers see frontmatter +
// body, never the node id — so a subject that exists only in the filename is lost, and the decision
// cannot be found by what it is about (J9b). The
// rationale body says *why* and routinely never restates the topic, so it is not a fallback.
func TestAppendDecisionStampsSubjectIntoFrontmatter(t *testing.T) {
	fixedNow(t, 1753324800000)
	v := newVault(t)
	taskID, _, err := CreateDossier(v, DossierFacts{Ticket: "PROJ-12", Objective: "z"})
	if err != nil {
		t.Fatal(err)
	}
	const subject = "the input validation security boundary was modified"
	decID, err := AppendDecision(v, DecisionFacts{
		TaskID: taskID, Actor: "radar", Provenance: "radar-investigation",
		Rationale: "committed on the release branch after review", Summary: subject,
	})
	if err != nil {
		t.Fatal(err)
	}
	nb, err := v.Retriever(wavevault.AllScope()).Read(decID)
	if err != nil {
		t.Fatal(err)
	}
	if got := fmString(nb.Node.Frontmatter, "summary"); got != subject {
		t.Fatalf("frontmatter summary = %q, want %q — the embedded text will not mention the subject", got, subject)
	}
	if strings.Contains(nb.Body, subject) {
		t.Fatal("test is vacuous: the body happens to contain the subject, so frontmatter is not the only carrier")
	}

	// the new machine key must survive a status rewrite rather than be stripped as human-owned
	d, err := LoadDecision(v.Retriever(wavevault.AllScope()), decID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Summary != subject {
		t.Fatalf("projected Summary = %q, want %q", d.Summary, subject)
	}
	if _, err := SupersedeDecision(v, decID, "superseded", d.Hash); err != nil {
		t.Fatalf("SupersedeDecision: %v", err)
	}
	after, err := LoadDecision(v.Retriever(wavevault.AllScope()), decID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Summary != subject {
		t.Fatalf("summary lost across a status mutation: %q", after.Summary)
	}
}

func TestLoadDecisionTolerantOfMissingProvenance(t *testing.T) {
	v := newVault(t)
	// an "old" decision missing provenance and the links block
	if _, err := v.Create("decisions", "old.md",
		"---\nid: dec-old\ncreated: 1753000000000\nactor: human\nstatus: active\n---\n\nlegacy rationale\n"); err != nil {
		t.Fatal(err)
	}
	d, err := LoadDecision(v.Retriever(wavevault.AllScope()), "dec-old")
	if err != nil {
		t.Fatalf("tolerant load must not error: %v", err)
	}
	if d.Provenance != "" || len(d.Links) != 0 {
		t.Fatalf("tolerant projection wrong: %+v", d)
	}
	if d.Rationale != "legacy rationale" {
		t.Fatalf("rationale = %q", d.Rationale)
	}
}

func TestAppendHumanDecisionAttributesToUser(t *testing.T) {
	fixedNow(t, 1753324800000)
	v := newVault(t)
	taskID, _, err := CreateDossier(v, DossierFacts{Ticket: "PROJ-20", Objective: "human owns this"})
	if err != nil {
		t.Fatal(err)
	}
	decID, err := AppendHumanDecision(v, DecisionFacts{
		TaskID: taskID, Rationale: "we chose X for durability", Summary: "chose x",
	})
	if err != nil {
		t.Fatalf("AppendHumanDecision: %v", err)
	}
	r := v.Retriever(wavevault.AllScope())
	dec, err := LoadDecision(r, decID)
	if err != nil {
		t.Fatal(err)
	}
	// frontmatter records human authorship regardless of what the caller passed
	if dec.Actor != "human" || dec.Provenance != "human-submit" {
		t.Fatalf("actor/provenance = %q/%q, want human/human-submit", dec.Actor, dec.Provenance)
	}
	if dec.Rationale != "we chose X for durability" {
		t.Fatalf("rationale = %q", dec.Rationale)
	}
	// the decision is linked into the dossier refs (index maintained)
	d, err := LoadDossier(r, taskID)
	if err != nil {
		t.Fatal(err)
	}
	linked := false
	for _, ref := range d.Refs {
		if ref == decID {
			linked = true
		}
	}
	if !linked {
		t.Fatalf("dossier refs %+v must link decision %q", d.Refs, decID)
	}
	// committed: the decision FILE is user-authored (HEAD is the user add -A commit)
	if err := v.Commit(context.Background(), "human decision"); err != nil {
		t.Fatal(err)
	}
	head, err := wavevault.HeadAuthorForTest(context.Background(), v.Root)
	if err != nil {
		t.Fatal(err)
	}
	if head != "Wave User" {
		t.Fatalf("decision-file commit author (HEAD) = %q, want Wave User", head)
	}
}
