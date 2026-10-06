// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

// Adoption brings a harness's hand-maintained skill directories into the vault.

// SkillMove is one harness-local skill tree folded into the vault.
type SkillMove struct {
	Runtime string `json:"runtime"`
	Name    string `json:"name"`
	From    string `json:"from"`
	// Seed marks the copy that becomes the shared tree. Every later copy of the same name becomes a
	// delta against it rather than a refusal.
	Seed bool `json:"seed"`
	// Keys and Files are what this copy overrides: frontmatter keys and sidecar file paths.
	Keys  []string `json:"keys,omitempty"`
	Files []string `json:"files,omitempty"`
	// BodyDiff marks the one case adoption will not decide: two copies whose markdown bodies differ.
	// The copy is left exactly where it is and the name is reported unresolved.
	BodyDiff bool `json:"bodydiff"`
}

// replacedDirName sits beside the vault's skills root and holds the copies a keep choice discarded.
const replacedDirName = "skills-replaced"

type AdoptPlan struct {
	Moves []SkillMove `json:"moves,omitempty"`
	// Unresolved names skills whose copies differ in body text, left in place for a human.
	Unresolved []string `json:"unresolved,omitempty"`
}

// skillTextParts splits a SKILL.md into its frontmatter entries and its body.
func skillTextParts(dir string) (map[string]fmEntry, string, error) {
	data, err := os.ReadFile(filepath.Join(dir, skillFile))
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]fmEntry{}, "", nil
		}
		return nil, "", fmt.Errorf("reading %s: %w", filepath.Join(dir, skillFile), err)
	}
	block, body, _ := splitFrontmatter(string(data))
	entries := map[string]fmEntry{}
	for _, e := range parseFrontmatterEntries(block) {
		entries[e.key] = e
	}
	return entries, body, nil
}

// deltaAgainst compares one harness's copy of a skill against the tree that will be shared. Keys are
// the frontmatter entries whose text differs; files are the sidecars the copy has that the shared
// tree does not match. A differing body is not a delta — the format has nowhere to put one.
func deltaAgainst(sharedDir, copyDir string) (keys []string, files []string, bodyDiff bool, err error) {
	sharedFM, sharedBody, err := skillTextParts(sharedDir)
	if err != nil {
		return nil, nil, false, err
	}
	copyFM, copyBody, err := skillTextParts(copyDir)
	if err != nil {
		return nil, nil, false, err
	}
	for key, e := range copyFM {
		if s, ok := sharedFM[key]; !ok || s.text != e.text {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	bodyDiff = strings.TrimSpace(sharedBody) != strings.TrimSpace(copyBody)

	sharedFiles, err := collectTree(sharedDir, skipDelta)
	if err != nil {
		return nil, nil, false, err
	}
	copyFiles, err := collectTree(copyDir, skipDelta)
	if err != nil {
		return nil, nil, false, err
	}
	for rel, data := range copyFiles {
		if rel == skillFile || rel == managedMarkName {
			continue
		}
		if !bytes.Equal(sharedFiles[rel], data) {
			files = append(files, rel)
		}
	}
	sort.Strings(files)
	return keys, files, bodyDiff, nil
}

func skipDelta(rel string) bool {
	return rel == deltaDirName || strings.HasPrefix(rel, deltaDirName+string(filepath.Separator))
}

// skillCopy is one unmanaged harness-local skill directory.
type skillCopy struct {
	runtime, name, from string
}

// isSkillDir reports whether an entry arcterm does not own is a skill. A harness keeps more than skills in
// its skills directory (Codex's bundled .system set, another tool's store with no SKILL.md), and adopt
// must neither list nor move those. Reconcile still sees every entry, so it never writes over one.
func isSkillDir(dir, name string) bool {
	if strings.HasPrefix(name, ".") {
		return false
	}
	_, err := os.Stat(filepath.Join(dir, name, skillFile))
	return err == nil
}

// unmanagedCopies lists every harness-local skill arcterm does not own: harnesses in catalog order,
// skills sorted within each.
func unmanagedCopies(p Paths) ([]skillCopy, error) {
	var out []skillCopy
	for _, spec := range harness.List() {
		dir := spec.SkillsPath(p.Home)
		if dir == "" || !configRootExists(spec, p.Home) {
			continue
		}
		observed, err := observeSkills(dir)
		if err != nil {
			return nil, err
		}
		sort.Slice(observed, func(i, j int) bool { return observed[i].Name < observed[j].Name })
		for _, e := range observed {
			if !e.Managed && isSkillDir(dir, e.Name) {
				out = append(out, skillCopy{runtime: spec.Runtime, name: e.Name, from: filepath.Join(dir, e.Name)})
			}
		}
	}
	return out, nil
}

// PlanAdopt reports which harness-local skill directories would move into the vault and what each
// contributes. Deterministic: harnesses in catalog order, skills sorted, so the first copy of a name
// seeds the shared tree and later ones become deltas against it. keep maps a skill name to the
// runtime whose copy seeds it instead; that name is never unresolved, since the choice settles it.
func PlanAdopt(p Paths, keep map[string]string) (AdoptPlan, error) {
	plan := AdoptPlan{}
	canonical, err := canonicalSkills(p.SkillsRoot)
	if err != nil {
		return plan, err
	}
	// where the shared tree for a name lives, or will live once this plan is applied
	sharedDir := map[string]string{}
	for _, name := range canonical {
		sharedDir[name] = filepath.Join(p.SkillsRoot, name)
	}
	copies, err := unmanagedCopies(p)
	if err != nil {
		return plan, err
	}
	if err := claimKept(keep, copies, sharedDir); err != nil {
		return plan, err
	}
	unresolved := map[string]bool{}
	for _, c := range copies {
		move := SkillMove{Runtime: c.runtime, Name: c.name, From: c.from}
		kept, isKept := keep[c.name]
		_, claimed := sharedDir[c.name]
		if (isKept && kept == c.runtime) || (!isKept && !claimed) {
			move.Seed = true
			sharedDir[c.name] = c.from
			plan.Moves = append(plan.Moves, move)
			continue
		}
		move.Keys, move.Files, move.BodyDiff, err = deltaAgainst(sharedDir[c.name], c.from)
		if err != nil {
			return plan, err
		}
		if move.BodyDiff && !isKept {
			unresolved[c.name] = true
		}
		plan.Moves = append(plan.Moves, move)
	}
	for name := range unresolved {
		plan.Unresolved = append(plan.Unresolved, name)
	}
	sort.Strings(plan.Unresolved)
	return plan, nil
}

// claimKept points each kept name's shared tree at the kept copy, so every other copy is compared
// against it. A keep that names no copy, or a skill the vault already owns, is refused outright.
func claimKept(keep map[string]string, copies []skillCopy, sharedDir map[string]string) error {
	for name, runtime := range keep {
		if _, canonical := sharedDir[name]; canonical {
			return fmt.Errorf("cannot keep %s's copy of %q: the skill is already managed by arcterm", runtime, name)
		}
		found := false
		for _, c := range copies {
			if c.name == name && c.runtime == runtime {
				sharedDir[name] = c.from
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("cannot keep %s's copy of %q: %s holds no unmanaged copy of it", runtime, name, runtime)
		}
	}
	return nil
}

// Adopt applies the plan: each seed tree is moved into the vault, each later copy is reduced to a
// delta beside it and removed, and the reconcile then renders every harness from the vault. A skill
// whose copies differ in body text is skipped entirely — nothing is moved and nothing is deleted —
// unless keep picks a copy for it; then every other copy is set aside under skills-replaced, whole,
// so what the choice discarded can still be recovered by hand.
func Adopt(p Paths, apply bool, keep map[string]string) (AdoptPlan, error) {
	plan, err := PlanAdopt(p, keep)
	if err != nil || !apply {
		return plan, err
	}
	blocked := map[string]bool{}
	for _, n := range plan.Unresolved {
		blocked[n] = true
	}
	if err := os.MkdirAll(p.SkillsRoot, 0o755); err != nil {
		return plan, err
	}
	// seeds first: a delta cannot be written beside a shared tree that is not there yet
	for _, m := range plan.Moves {
		if !m.Seed || blocked[m.Name] {
			continue
		}
		dest := filepath.Join(p.SkillsRoot, m.Name)
		if _, err := os.Stat(dest); err == nil {
			continue // already canonical
		}
		if err := os.Rename(m.From, dest); err != nil {
			return plan, fmt.Errorf("moving %s into the vault: %w", m.From, err)
		}
		// the ownership mark belongs to a rendered copy, never to the canonical tree
		_ = os.Remove(filepath.Join(dest, managedMarkName))
	}
	for _, m := range plan.Moves {
		if m.Seed || blocked[m.Name] {
			continue
		}
		if _, kept := keep[m.Name]; kept {
			if err := setAside(p, m); err != nil {
				return plan, err
			}
			continue
		}
		if err := writeDelta(p, m); err != nil {
			return plan, err
		}
		if err := os.RemoveAll(m.From); err != nil {
			return plan, fmt.Errorf("removing the adopted copy %s: %w", m.From, err)
		}
	}
	if _, err := Apply(p, false); err != nil {
		return plan, err
	}
	return plan, nil
}

// setAside moves a copy that lost a keep choice to skills-replaced/<runtime>/<name>, numbering the
// directory when an earlier replacement already holds that name.
func setAside(p Paths, m SkillMove) error {
	base := filepath.Join(filepath.Dir(p.SkillsRoot), replacedDirName, m.Runtime, m.Name)
	dest := base
	for n := 2; ; n++ {
		if _, err := os.Lstat(dest); os.IsNotExist(err) {
			break
		} else if err != nil {
			return err
		}
		dest = fmt.Sprintf("%s-%d", base, n)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	if err := os.Rename(m.From, dest); err != nil {
		return fmt.Errorf("setting aside the replaced copy %s: %w", m.From, err)
	}
	return nil
}

// writeDelta records one harness's overrides beside the shared skill: differing frontmatter keys as
// a fragment, differing files as a sidecar tree.
func writeDelta(p Paths, m SkillMove) error {
	deltaRoot := filepath.Join(p.SkillsRoot, m.Name, deltaDirName)
	if len(m.Keys) > 0 {
		entries, _, err := skillTextParts(m.From)
		if err != nil {
			return err
		}
		var b strings.Builder
		for _, key := range m.Keys {
			b.WriteString(entries[key].text)
		}
		if err := os.MkdirAll(deltaRoot, 0o755); err != nil {
			return err
		}
		path := filepath.Join(deltaRoot, m.Runtime+".yaml")
		if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", path, err)
		}
	}
	for _, rel := range m.Files {
		data, err := os.ReadFile(filepath.Join(m.From, rel))
		if err != nil {
			return err
		}
		dest := filepath.Join(deltaRoot, m.Runtime, rel)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", dest, err)
		}
	}
	return nil
}
