// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"gopkg.in/yaml.v3"
)

// Editing and creating the vault's own skills, for the Setup surface. Only SKILL.md is read or written
// here: a skill's other files and its .arc deltas stay where the user put them.

// maxSkillName is the longest name a harness accepts for a skill directory.
const maxSkillName = 64

// skillNamePattern is lowercase words joined by single hyphens, the name every harness keys a skill on.
var skillNamePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// SkillDoc is one vault skill's SKILL.md as read: its path, its text, and its mtime for the save guard.
type SkillDoc struct {
	Path    string
	Content string
	Mtime   int64
}

// isShipped reports whether arcterm ships a skill of this name. Its vault copy is reseeded on every
// sync, so an edit there would not last.
func isShipped(p Paths, name string) bool {
	if p.Shipped == nil {
		return false
	}
	st, err := fs.Stat(p.Shipped, name)
	return err == nil && st.IsDir()
}

// vaultSkillDir resolves a name the caller sent to an existing canonical skill directory. The name must
// match the pattern, so it can never climb out of the skills root.
func vaultSkillDir(p Paths, name string) (string, error) {
	if !skillNamePattern.MatchString(name) {
		return "", fmt.Errorf("%q is not a skill name", name)
	}
	dir := filepath.Join(p.SkillsRoot, name)
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("no skill named %q in the vault", name)
	}
	return dir, nil
}

func readSkillDoc(path string) (SkillDoc, error) {
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return SkillDoc{}, fmt.Errorf("reading %s: %w", path, err)
	}
	var mtime int64
	if st, statErr := os.Stat(path); statErr == nil {
		mtime = st.ModTime().UnixMilli()
	}
	return SkillDoc{Path: path, Content: string(data), Mtime: mtime}, nil
}

// ReadSkill returns a vault skill's SKILL.md. A skill directory without one reads as empty, so saving
// from the editor creates it.
func ReadSkill(p Paths, name string) (SkillDoc, error) {
	dir, err := vaultSkillDir(p, name)
	if err != nil {
		return SkillDoc{}, err
	}
	return readSkillDoc(filepath.Join(dir, skillFile))
}

// WriteSkill replaces a vault skill's SKILL.md, refusing when it changed since baseMtime (0 skips the
// check, as for the steering doc). A shipped skill is refused: the next sync would put it back.
func WriteSkill(p Paths, name, content string, baseMtime int64) (WriteResult, error) {
	dir, err := vaultSkillDir(p, name)
	if err != nil {
		return WriteResult{}, err
	}
	if isShipped(p, name) {
		return WriteResult{}, fmt.Errorf("%q ships with arcterm; an edit in the vault is replaced on the next sync", name)
	}
	path := filepath.Join(dir, skillFile)
	if st, err := os.Stat(path); err == nil && baseMtime != 0 && st.ModTime().UnixMilli() != baseMtime {
		return WriteResult{Mtime: st.ModTime().UnixMilli(), Conflict: true}, nil
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return WriteResult{}, fmt.Errorf("writing %s: %w", path, err)
	}
	st, err := os.Stat(path)
	if err != nil {
		return WriteResult{}, err
	}
	return WriteResult{Mtime: st.ModTime().UnixMilli()}, nil
}

// ErrSkillExists is returned by CreateSkill for a name already taken in the vault or a harness folder.
var ErrSkillExists = errors.New("skill already exists")

// newSkillDoc is the SKILL.md a new skill starts from. The frontmatter is marshalled so a description
// holding a colon or a quote stays valid YAML.
func newSkillDoc(name, description string) (string, error) {
	fm, err := yaml.Marshal(struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
	}{name, description})
	if err != nil {
		return "", err
	}
	return "---\n" + string(fm) + "---\n\n# " + name + "\n\n", nil
}

// CreateSkill makes a new vault skill holding only a SKILL.md. The name must be free everywhere: a
// harness folder that already has one is the user's copy, which Manage brings in instead.
func CreateSkill(p Paths, name, description string) (SkillDoc, error) {
	if len(name) > maxSkillName || !skillNamePattern.MatchString(name) {
		return SkillDoc{}, fmt.Errorf("%q is not a skill name: use lowercase letters, digits and single hyphens, at most %d characters", name, maxSkillName)
	}
	if description == "" {
		return SkillDoc{}, errors.New("a skill needs a description: it is how an agent knows when to use it")
	}
	if isShipped(p, name) {
		return SkillDoc{}, fmt.Errorf("%q ships with arcterm: %w", name, ErrSkillExists)
	}
	dir := filepath.Join(p.SkillsRoot, name)
	if _, err := os.Stat(dir); err == nil {
		return SkillDoc{}, fmt.Errorf("%q is already in the vault: %w", name, ErrSkillExists)
	}
	for _, spec := range harness.List() {
		if skillsDir := spec.SkillsPath(p.Home); skillsDir != "" {
			if _, err := os.Stat(filepath.Join(skillsDir, name)); err == nil {
				return SkillDoc{}, fmt.Errorf("%q is already in %s's skills folder: %w", name, spec.Label, ErrSkillExists)
			}
		}
	}
	doc, err := newSkillDoc(name, description)
	if err != nil {
		return SkillDoc{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return SkillDoc{}, fmt.Errorf("creating %s: %w", dir, err)
	}
	path := filepath.Join(dir, skillFile)
	if err := os.WriteFile(path, []byte(doc), 0o644); err != nil {
		return SkillDoc{}, fmt.Errorf("writing %s: %w", path, err)
	}
	return readSkillDoc(path)
}
