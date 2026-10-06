// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"gopkg.in/yaml.v3"
)

const (
	skillFile = "SKILL.md"
	// deltaDirName holds one canonical skill's per-harness overrides. Never copied to a harness.
	deltaDirName = ".arc"
	// managedMarkName is written into every skill directory arcterm renders. Ownership is declared, not
	// inferred: a directory without it is the user's and is never written or removed.
	managedMarkName = ".arc-managed"
)

// ObservedEntry is one entry in a harness's skills directory as it exists on disk.
type ObservedEntry struct {
	Name    string
	Managed bool
}

// ---- frontmatter ----

// fmEntry is one top-level frontmatter key with its full source text, including any indented
// continuation lines. Keeping the source text rather than a parsed value is what lets a multi-line
// `description: |` block survive a merge verbatim — re-marshalling it would reflow it.
type fmEntry struct {
	key  string
	text string
}

// splitFrontmatter separates a leading YAML frontmatter block (without its fences) from the rest of
// the document. ok is false when the file does not open with a fence, so it has none to merge into.
func splitFrontmatter(data string) (block, rest string, ok bool) {
	if !strings.HasPrefix(data, "---\n") {
		return "", data, false
	}
	end := strings.Index(data[4:], "\n---")
	if end < 0 {
		return "", data, false
	}
	return data[4 : 4+end+1], strings.TrimPrefix(data[4+end+len("\n---"):], "\n"), true
}

// linesWithEnds splits into lines that keep their trailing newline, so reassembly is byte-exact.
func linesWithEnds(s string) []string {
	var out []string
	for len(s) > 0 {
		i := strings.IndexByte(s, '\n')
		if i < 0 {
			out = append(out, s)
			break
		}
		out = append(out, s[:i+1])
		s = s[i+1:]
	}
	return out
}

// parseFrontmatterEntries splits a frontmatter block into top-level keys. A line at column zero
// holding a colon opens an entry; anything indented, blank, or a list item belongs to the entry above.
func parseFrontmatterEntries(block string) []fmEntry {
	var out []fmEntry
	for _, line := range linesWithEnds(block) {
		trimmed := strings.TrimRight(line, "\r\n")
		key, _, hasColon := strings.Cut(trimmed, ":")
		topLevel := trimmed != "" && !strings.HasPrefix(trimmed, " ") && !strings.HasPrefix(trimmed, "\t") &&
			!strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(trimmed, "-")
		if topLevel && hasColon && key != "" {
			out = append(out, fmEntry{key: key, text: ensureNewline(line)})
			continue
		}
		if len(out) > 0 {
			out[len(out)-1].text += ensureNewline(line)
		}
	}
	return out
}

func ensureNewline(s string) string {
	if strings.HasSuffix(s, "\n") {
		return s
	}
	return s + "\n"
}

func entryText(entries []fmEntry) string {
	var b strings.Builder
	for _, e := range entries {
		b.WriteString(e.text)
	}
	return b.String()
}

// mergeFrontmatter replaces each shared key an override names, in place so key order is preserved,
// and appends any override key the shared block does not have.
func mergeFrontmatter(block string, overrides []fmEntry) string {
	byKey := make(map[string]fmEntry, len(overrides))
	for _, o := range overrides {
		byKey[o.key] = o
	}
	used := make(map[string]bool, len(overrides))
	var b strings.Builder
	for _, e := range parseFrontmatterEntries(block) {
		if o, ok := byKey[e.key]; ok {
			used[e.key] = true
			b.WriteString(o.text)
			continue
		}
		b.WriteString(e.text)
	}
	for _, o := range overrides {
		if !used[o.key] {
			b.WriteString(o.text)
		}
	}
	return b.String()
}

// applyOverrides merges a runtime's frontmatter overrides into a SKILL.md. A file with no
// frontmatter gains one rather than dropping the override silently.
func applyOverrides(doc string, overrides []fmEntry) string {
	if len(overrides) == 0 {
		return doc
	}
	block, rest, ok := splitFrontmatter(doc)
	if !ok {
		return "---\n" + entryText(overrides) + "---\n" + doc
	}
	return "---\n" + mergeFrontmatter(block, overrides) + "---\n" + rest
}

// deltaOverrides reads <skill>/.arc/<runtime>.yaml — a frontmatter fragment, parsed as frontmatter
// rather than as YAML so its lines splice in unchanged.
func deltaOverrides(skillDir, runtime string) ([]fmEntry, error) {
	data, err := os.ReadFile(filepath.Join(skillDir, deltaDirName, runtime+".yaml"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading the %s delta for %s: %w", runtime, filepath.Base(skillDir), err)
	}
	return parseFrontmatterEntries(string(data)), nil
}

// ---- rendering ----

// collectTree reads dir into relative-path -> bytes, skipping any path skip reports. A missing
// directory is an empty tree, not an error: most skills have no delta directory.
func collectTree(dir string, skip func(rel string) bool) (map[string][]byte, error) {
	out := map[string][]byte{}
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, relErr := filepath.Rel(dir, path)
		if relErr != nil {
			return relErr
		}
		if rel == "." {
			return nil
		}
		if skip != nil && skip(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		out[rel] = data
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("reading %s: %w", dir, err)
	}
	return out, nil
}

// renderSkill builds exactly the file set one harness should hold for a canonical skill: the shared
// tree without .arc/, that runtime's frontmatter overrides merged into SKILL.md, and that runtime's
// sidecar files overlaid. A skill with no delta renders identically for every harness.
func renderSkill(skillsRoot, name, runtime string) (map[string][]byte, error) {
	skillDir := filepath.Join(skillsRoot, name)
	files, err := collectTree(skillDir, isDeltaPath)
	if err != nil {
		return nil, err
	}
	overrides, err := deltaOverrides(skillDir, runtime)
	if err != nil {
		return nil, err
	}
	if md, ok := files[skillFile]; ok {
		files[skillFile] = []byte(applyOverrides(string(md), overrides))
	}
	sidecars, err := collectTree(filepath.Join(skillDir, deltaDirName, runtime), nil)
	if err != nil {
		return nil, err
	}
	for rel, data := range sidecars {
		files[rel] = data
	}
	return files, nil
}

// treeMatches reports whether dir already holds exactly want. The ownership mark is expected on disk
// and never part of the render, so it is excluded from the comparison.
func treeMatches(dir string, want map[string][]byte) bool {
	have, err := collectTree(dir, func(rel string) bool { return rel == managedMarkName })
	if err != nil || len(have) != len(want) {
		return false
	}
	for rel, data := range want {
		if !bytes.Equal(have[rel], data) {
			return false
		}
	}
	return true
}

// isDeltaPath reports whether rel is a skill's .arc per-harness delta directory or lies inside it.
func isDeltaPath(rel string) bool {
	return rel == deltaDirName || strings.HasPrefix(rel, deltaDirName+string(filepath.Separator))
}

// writeTree makes dir hold exactly want plus the ownership mark, removing files the render dropped.
func writeTree(dir, source string, want map[string][]byte) error {
	if err := mirrorTree(dir, want, func(rel string) bool { return rel == managedMarkName }); err != nil {
		return err
	}
	mark := []byte("canonical: " + source + "\n")
	return os.WriteFile(filepath.Join(dir, managedMarkName), mark, 0o644)
}

// mirrorTree makes dir hold exactly want, leaving any path skip reports alone. Only files whose
// bytes differ are written, so an identical tree is left untouched.
func mirrorTree(dir string, want map[string][]byte, skip func(rel string) bool) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	have, err := collectTree(dir, skip)
	if err != nil {
		return err
	}
	for rel := range have {
		if _, keep := want[rel]; !keep {
			if err := os.Remove(filepath.Join(dir, rel)); err != nil {
				return fmt.Errorf("removing %s: %w", filepath.Join(dir, rel), err)
			}
		}
	}
	for rel, data := range want {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
		}
		if bytes.Equal(have[rel], data) {
			continue
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", path, err)
		}
	}
	return nil
}

// ---- shipped skills ----

// shippedTree reads one shipped skill into relative-path -> bytes, keyed like collectTree.
func shippedTree(shipped fs.FS, name string) (map[string][]byte, error) {
	out := map[string][]byte{}
	err := fs.WalkDir(shipped, name, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, readErr := fs.ReadFile(shipped, path)
		if readErr != nil {
			return readErr
		}
		out[filepath.FromSlash(strings.TrimPrefix(path, name+"/"))] = data
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("reading shipped skill %s: %w", name, err)
	}
	return out, nil
}

// seedShippedSkills makes each shipped skill in the vault match what arcterm ships, so the reconcile
// that follows projects the shipped copy. The .arc delta directory is the user's and survives.
func seedShippedSkills(skillsRoot string, shipped fs.FS) error {
	if shipped == nil {
		return nil
	}
	entries, err := fs.ReadDir(shipped, ".")
	if err != nil {
		return fmt.Errorf("listing shipped skills: %w", err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		want, err := shippedTree(shipped, e.Name())
		if err != nil {
			return err
		}
		if err := mirrorTree(filepath.Join(skillsRoot, e.Name()), want, isDeltaPath); err != nil {
			return fmt.Errorf("seeding shipped skill %s: %w", e.Name(), err)
		}
	}
	return nil
}

// ---- reconcile ----

// observeSkills reads a harness's skills directory one level deep, reporting which entries arcterm owns.
func observeSkills(dir string) ([]ObservedEntry, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading %s: %w", dir, err)
	}
	out := make([]ObservedEntry, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		_, statErr := os.Stat(filepath.Join(dir, e.Name(), managedMarkName))
		out = append(out, ObservedEntry{Name: e.Name(), Managed: statErr == nil})
	}
	return out, nil
}

// canonicalSkills lists the vault's skill directories, sorted for a deterministic plan.
func canonicalSkills(skillsRoot string) ([]string, error) {
	entries, err := os.ReadDir(skillsRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading canonical skills: %w", err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// skillState is what one harness holds for one canonical skill.
const (
	stateSynced    = "synced"
	stateDiffers   = "differs"
	stateUnmanaged = "unmanaged"
	stateAbsent    = "absent"
)

// skillStateFor compares the rendered tree against what is on disk. An unmanaged directory is
// reported and never opened — the user's copy is not arcterm's to read a verdict from.
func skillStateFor(dir string, observed map[string]ObservedEntry, name string, want map[string][]byte) string {
	e, present := observed[name]
	switch {
	case !present:
		return stateDiffers // nothing there yet; a sync would write it
	case !e.Managed:
		return stateUnmanaged
	case treeMatches(filepath.Join(dir, name), want):
		return stateSynced
	}
	return stateDiffers
}

// reconcileSkills renders every canonical skill into each present harness that scans a fixed skills
// directory. The skills directory itself is created when missing: that is arcterm's own target, unlike
// the harness config root, which arcterm never creates.
func reconcileSkills(p Paths, dryRun bool) ([]Action, error) {
	canonical, err := canonicalSkills(p.SkillsRoot)
	if err != nil {
		return nil, err
	}
	var actions []Action
	for _, spec := range harness.List() {
		dir := spec.SkillsPath(p.Home)
		if dir == "" || !configRootExists(spec, p.Home) {
			continue
		}
		observed, err := observeSkills(dir)
		if err != nil {
			return actions, err
		}
		byName := make(map[string]ObservedEntry, len(observed))
		for _, e := range observed {
			byName[e.Name] = e
		}
		wanted := make(map[string]bool, len(canonical))
		for _, name := range canonical {
			wanted[name] = true
			want, err := renderSkill(p.SkillsRoot, name, spec.Runtime)
			if err != nil {
				return actions, err
			}
			target := filepath.Join(dir, name)
			switch skillStateFor(dir, byName, name, want) {
			case stateUnmanaged:
				actions = append(actions, Action{Kind: ActionSkillUnmanaged, Runtime: spec.Runtime, Path: target,
					Detail: "the user's own directory; adopt it to bring it into the vault"})
			case stateSynced:
			default:
				actions = append(actions, Action{Kind: ActionSkillWrite, Runtime: spec.Runtime, Path: target})
				if dryRun {
					continue
				}
				if err := writeTree(target, filepath.Join(p.SkillsRoot, name), want); err != nil {
					return actions, err
				}
			}
		}
		// a directory arcterm wrote for a skill the vault no longer has. Plain files, so an ordinary
		// recursive delete — the junction-era reparse-point hazard is gone with the junctions.
		for _, e := range observed {
			if wanted[e.Name] || !e.Managed {
				continue
			}
			actions = append(actions, Action{Kind: ActionSkillRemove, Runtime: spec.Runtime, Path: filepath.Join(dir, e.Name)})
			if dryRun {
				continue
			}
			if err := os.RemoveAll(filepath.Join(dir, e.Name)); err != nil {
				return actions, fmt.Errorf("removing %s: %w", filepath.Join(dir, e.Name), err)
			}
		}
	}
	return actions, nil
}

// Apply runs both projections. Steering first: a harness that starts mid-sync should see the rules
// before it sees new skills. The shipped skills are seeded into the vault just before the skills
// projection, so it renders them; a dry run leaves the vault alone.
func Apply(p Paths, dryRun bool) ([]Action, error) {
	actions, err := projectSteering(p, dryRun)
	if err != nil {
		return actions, err
	}
	if !dryRun {
		if err := seedShippedSkills(p.SkillsRoot, p.Shipped); err != nil {
			return actions, err
		}
	}
	skillActions, err := reconcileSkills(p, dryRun)
	return append(actions, skillActions...), err
}

// ---- the skills matrix ----

// SkillRow is one canonical skill and how each harness currently holds it.
type SkillRow struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// States maps runtime -> synced | differs | unmanaged | absent. A harness with no fixed skills
	// directory (pi) never appears: it reads an explicit list of paths from its own settings.
	States map[string]string `json:"states"`
	// Deltas maps runtime -> what that harness overrides: frontmatter keys and sidecar paths.
	Deltas map[string][]string `json:"deltas,omitempty"`
}

// skillFrontmatter is the SKILL.md header. Only the description is read; name comes from the
// directory, which is what every harness actually keys on.
type skillFrontmatter struct {
	Description string `yaml:"description"`
}

// skillDescription reads a skill's one-line description. A skill directory without a readable
// SKILL.md is still a skill — the row renders with an empty description rather than failing the read.
func skillDescription(skillsRoot, name string) string {
	data, err := os.ReadFile(filepath.Join(skillsRoot, name, skillFile))
	if err != nil {
		return ""
	}
	block, _, ok := splitFrontmatter(string(data))
	if !ok {
		return ""
	}
	var fm skillFrontmatter
	if yaml.Unmarshal([]byte(block), &fm) != nil {
		return ""
	}
	return strings.TrimSpace(fm.Description)
}

// skillDeltas describes what a skill's .arc directory overrides per runtime, for the rail.
func skillDeltas(skillsRoot, name string) map[string][]string {
	out := map[string][]string{}
	deltaDir := filepath.Join(skillsRoot, name, deltaDirName)
	entries, err := os.ReadDir(deltaDir)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".yaml") {
			runtime := strings.TrimSuffix(e.Name(), ".yaml")
			overrides, err := deltaOverrides(filepath.Join(skillsRoot, name), runtime)
			if err != nil {
				continue
			}
			for _, o := range overrides {
				out[runtime] = append(out[runtime], o.key)
			}
			continue
		}
		if e.IsDir() {
			files, err := collectTree(filepath.Join(deltaDir, e.Name()), nil)
			if err != nil {
				continue
			}
			for rel := range files {
				out[e.Name()] = append(out[e.Name()], filepath.ToSlash(rel))
			}
		}
	}
	for rt := range out {
		sort.Strings(out[rt])
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// SkillColumn is one harness that scans a fixed skills directory — a column of the skills matrix.
type SkillColumn struct {
	Runtime string `json:"runtime"`
	Label   string `json:"label"`
	Present bool   `json:"present"`
}

// SkillColumns lists the harnesses the skills matrix has a column for.
func SkillColumns(p Paths) []SkillColumn {
	var out []SkillColumn
	for _, spec := range harness.List() {
		if spec.SkillsPath(p.Home) == "" {
			continue
		}
		out = append(out, SkillColumn{Runtime: spec.Runtime, Label: spec.Label, Present: configRootExists(spec, p.Home)})
	}
	return out
}

// SkillRows reports every canonical skill against every harness that scans a fixed skills directory,
// reusing the same render the reconcile runs so the matrix cannot drift from what a sync would do.
func SkillRows(p Paths) ([]SkillRow, error) {
	canonical, err := canonicalSkills(p.SkillsRoot)
	if err != nil {
		return nil, err
	}
	rows := make([]SkillRow, 0, len(canonical))
	for _, name := range canonical {
		rows = append(rows, SkillRow{
			Name:        name,
			Description: skillDescription(p.SkillsRoot, name),
			States:      map[string]string{},
			Deltas:      skillDeltas(p.SkillsRoot, name),
		})
	}
	for _, spec := range harness.List() {
		dir := spec.SkillsPath(p.Home)
		if dir == "" {
			continue
		}
		if !configRootExists(spec, p.Home) {
			for i := range rows {
				rows[i].States[spec.Runtime] = stateAbsent
			}
			continue
		}
		observed, err := observeSkills(dir)
		if err != nil {
			return nil, err
		}
		byName := make(map[string]ObservedEntry, len(observed))
		for _, e := range observed {
			byName[e.Name] = e
		}
		for i := range rows {
			want, err := renderSkill(p.SkillsRoot, rows[i].Name, spec.Runtime)
			if err != nil {
				return nil, err
			}
			rows[i].States[spec.Runtime] = skillStateFor(dir, byName, rows[i].Name, want)
		}
	}
	return rows, nil
}
