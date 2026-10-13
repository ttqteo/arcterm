// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisdossier

import (
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavevault"
)

// Dossier is the typed projection of a task dossier file. Machine-owned fields are set by B/E/F;
// Hash is the content hash callers pass back as baseHash on a subsequent machine write.
type Dossier struct {
	ID         string
	Status     string
	Ticket     string
	Objective  string
	Acceptance []string
	Confidence string
	Created    int64
	Updated    int64
	State      string
	Refs       []string
	Blockers   []string
	Notes      string // the human ## Notes prose (machine blocks stripped); read-only, U2 display
	Hash       string
}

// DossierFacts are the deterministic inputs code captures at task dispatch — never model output.
type DossierFacts struct {
	Ticket     string
	Objective  string
	Acceptance []string
	Confidence string // defaults to "med"
}

// DossierSpec is the region-ownership contract A enforces for a dossier: the machine frontmatter keys
// and the machine body blocks. Everything else (## Notes prose, non-reserved keys) is human-owned.
func DossierSpec() wavevault.RegionSpec {
	return wavevault.RegionSpec{
		MachineKeys: []string{"status", "ticket", "objective", "acceptance", "confidence", "created", "updated"},
		Blocks:      []string{"state", "refs", "blockers"},
	}
}

// DossierID returns the node id (filename stem) CreateDossier derives for these facts, without
// writing anything. Exported so bulk importers can detect id collisions before they hit the vault:
// the slug is length-bounded, so two distinct objectives sharing a long prefix collapse onto the
// same file and the second loses to a create-collision.
func DossierID(f DossierFacts) string {
	return boundedSlug(f.Ticket+" "+f.Objective, "task")
}

// DecisionSlug returns the slug portion of the filename AppendDecision derives from a summary. Same
// collision caveat, and same reason for exporting it.
func DecisionSlug(summary string) string {
	return boundedSlug(summary, "decision")
}

// CreateDossier scaffolds a new dossier in tasks/active (frontmatter + empty state/refs/blockers
// blocks + a human ## Notes placeholder) and returns the node id (the filename stem) and content
// hash. The file is machine-authored (via A's Create) so it commits as Jarvis.
func CreateDossier(v *wavevault.Vault, f DossierFacts) (string, string, error) {
	conf := f.Confidence
	if conf == "" {
		conf = "med"
	}
	id := boundedSlug(f.Ticket+" "+f.Objective, "task")
	res, err := v.Create("tasks/active", id+".md", renderDossier(f, conf))
	if err != nil {
		return "", "", err
	}
	return id, res.Hash, nil
}

func renderDossier(f DossierFacts, conf string) string {
	ts := strconv.FormatInt(nowFn(), 10)
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("status: active\n")
	b.WriteString("ticket: " + yamlScalar(f.Ticket) + "\n")
	b.WriteString("objective: " + yamlScalar(f.Objective) + "\n")
	b.WriteString("acceptance: " + flowList(f.Acceptance) + "\n")
	b.WriteString("confidence: " + conf + "\n")
	b.WriteString("created: " + ts + "\n")
	b.WriteString("updated: " + ts + "\n")
	b.WriteString("---\n")
	b.WriteString(emptyBlock("state"))
	b.WriteString(emptyBlock("refs"))
	b.WriteString(emptyBlock("blockers"))
	b.WriteString("\n## Notes\n\n")
	return b.String()
}

// LoadDossier reads a dossier by id through a scoped retriever and projects it into the typed model.
// Tolerant: missing keys default, unknown keys are ignored, no error.
func LoadDossier(r *wavevault.Retriever, id string) (*Dossier, error) {
	nb, err := r.Read(id)
	if err != nil {
		return nil, err
	}
	fm := nb.Node.Frontmatter
	return &Dossier{
		ID:         nb.Node.ID,
		Status:     fmString(fm, "status"),
		Ticket:     fmString(fm, "ticket"),
		Objective:  fmString(fm, "objective"),
		Acceptance: fmStrings(fm, "acceptance"),
		Confidence: fmString(fm, "confidence"),
		Created:    fmInt(fm, "created"),
		Updated:    fmInt(fm, "updated"),
		State:      extractBlock(nb.Body, "state"),
		Refs:       parseLinks(extractBlock(nb.Body, "refs")),
		Blockers:   splitLines(extractBlock(nb.Body, "blockers")),
		Notes:      strings.TrimSpace(stripBlocks(nb.Body, "state", "refs", "blockers")),
		Hash:       nb.Node.ContentHash,
	}, nil
}

// updatedEdit is the timestamp bump every machine setter includes so freshness never lags a write.
func updatedEdit() wavevault.RegionEdit {
	return wavevault.RegionEdit{Kind: wavevault.FrontmatterKey, Name: "updated", Value: strconv.FormatInt(nowFn(), 10)}
}

// SetState writes the narrative state-summary block (content supplied by E/F).
func SetState(v *wavevault.Vault, id, summary, baseHash string) (*wavevault.WriteResult, error) {
	return v.Write(id, DossierSpec(), []wavevault.RegionEdit{
		{Kind: wavevault.Block, Name: "state", Value: summary},
		updatedEdit(),
	}, baseHash)
}

// SetStatus sets the dossier status (active | paused | completed | archived).
func SetStatus(v *wavevault.Vault, id, status, baseHash string) (*wavevault.WriteResult, error) {
	return v.Write(id, DossierSpec(), []wavevault.RegionEdit{
		{Kind: wavevault.FrontmatterKey, Name: "status", Value: status},
		updatedEdit(),
	}, baseHash)
}

// SetBlockers replaces the machine-owned blockers block with one "- item" line per blocker.
func SetBlockers(v *wavevault.Vault, id string, blockers []string, baseHash string) (*wavevault.WriteResult, error) {
	lines := make([]string, len(blockers))
	for i, b := range blockers {
		lines[i] = "- " + b
	}
	return v.Write(id, DossierSpec(), []wavevault.RegionEdit{
		{Kind: wavevault.Block, Name: "blockers", Value: strings.Join(lines, "\n")},
		updatedEdit(),
	}, baseHash)
}

// SetRefs replaces the refs block with the full [[target]] set (the traversable-edge carrier). refs
// lists node ids of linked decisions/runs; callers pass the complete desired set.
func SetRefs(v *wavevault.Vault, id string, refs []string, baseHash string) (*wavevault.WriteResult, error) {
	return v.Write(id, DossierSpec(), []wavevault.RegionEdit{
		{Kind: wavevault.Block, Name: "refs", Value: renderRefs(refs)},
		updatedEdit(),
	}, baseHash)
}

func renderRefs(targets []string) string {
	parts := make([]string, len(targets))
	for i, t := range targets {
		parts[i] = "[[" + t + "]]"
	}
	return strings.Join(parts, " ")
}
