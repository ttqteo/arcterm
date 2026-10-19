// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// seedSkill creates a canonical skill tree in the vault.
func seedSkill(t *testing.T, p Paths, name string) {
	t.Helper()
	writeFile(t, filepath.Join(p.SkillsRoot, name, skillFile), "---\nname: "+name+"\n---\nbody\n")
}

func TestSplitFrontmatterRoundTrips(t *testing.T) {
	doc := "---\nname: x\ndescription: |\n  line one\n  line two\ntool: codex\n---\n# Body\n\ntext\n"
	block, rest, ok := splitFrontmatter(doc)
	if !ok {
		t.Fatal("a fenced document must report frontmatter")
	}
	if got := "---\n" + block + "---\n" + rest; got != doc {
		t.Fatalf("round trip lost bytes:\n got %q\nwant %q", got, doc)
	}
	if _, _, ok := splitFrontmatter("# No fence\n"); ok {
		t.Error("a document without a fence has no frontmatter")
	}
	if _, _, ok := splitFrontmatter("---\nunterminated: yes\n"); ok {
		t.Error("an unterminated fence is not frontmatter")
	}
}

func TestParseFrontmatterEntriesKeepsMultilineValues(t *testing.T) {
	block := "name: x\ndescription: |\n  line one\n  line two\ntool: codex\n"
	got := parseFrontmatterEntries(block)
	if len(got) != 3 {
		t.Fatalf("entries = %#v, want three top-level keys", got)
	}
	if got[1].key != "description" || got[1].text != "description: |\n  line one\n  line two\n" {
		t.Fatalf("multi-line value not held verbatim: %q", got[1].text)
	}
	if entryText(got) != block {
		t.Fatalf("entries do not reassemble to the block: %q", entryText(got))
	}
}

// an indented line holding a colon is part of the value above, and a line before the first key has no entry to join
func TestParseFrontmatterEntriesIndentedColonsAndLeadingLines(t *testing.T) {
	block := "# leading note\nname: x\ndescription: |\n  sub: y\n\tdeep: z\ntool: codex\n"
	got := parseFrontmatterEntries(block)
	want := []fmEntry{
		{key: "name", text: "name: x\n"},
		{key: "description", text: "description: |\n  sub: y\n\tdeep: z\n"},
		{key: "tool", text: "tool: codex\n"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("entries = %#v, want %#v", got, want)
	}
}

func TestMergeFrontmatterReplacesInPlaceAndAppends(t *testing.T) {
	block := "name: x\ndescription: |\n  keep me\ntool: codex\n"
	got := mergeFrontmatter(block, parseFrontmatterEntries("tool: opencode\ncategory: orchestration\n"))
	want := "name: x\ndescription: |\n  keep me\ntool: opencode\ncategory: orchestration\n"
	if got != want {
		t.Fatalf("merge =\n%q\nwant\n%q", got, want)
	}
}

func TestApplyOverridesSynthesizesFrontmatterWhenAbsent(t *testing.T) {
	got := applyOverrides("# Just a body\n", parseFrontmatterEntries("tool: codex\n"))
	if got != "---\ntool: codex\n---\n# Just a body\n" {
		t.Fatalf("overrides dropped on an unfenced doc: %q", got)
	}
}

func TestRenderSkillAppliesDeltaAndNeverCopiesIt(t *testing.T) {
	p := testPaths(t, "canonical\n", ".codex")
	dir := filepath.Join(p.SkillsRoot, "orchestrator")
	writeFile(t, filepath.Join(dir, skillFile), "---\nname: orchestrator\ntool: codex\n---\nshared body\n")
	writeFile(t, filepath.Join(dir, deltaDirName, "opencode.yaml"), "tool: opencode\n")
	writeFile(t, filepath.Join(dir, deltaDirName, "codex", "agents", "openai.yaml"), "display_name: Orchestrator\n")

	codex, err := renderSkill(p.SkillsRoot, "orchestrator", "codex")
	if err != nil {
		t.Fatal(err)
	}
	if string(codex[skillFile]) != "---\nname: orchestrator\ntool: codex\n---\nshared body\n" {
		t.Fatalf("codex SKILL.md = %q, want the shared text", codex[skillFile])
	}
	if string(codex[filepath.Join("agents", "openai.yaml")]) != "display_name: Orchestrator\n" {
		t.Fatalf("codex sidecar missing: %#v", keysOf(codex))
	}

	opencode, err := renderSkill(p.SkillsRoot, "orchestrator", "opencode")
	if err != nil {
		t.Fatal(err)
	}
	if string(opencode[skillFile]) != "---\nname: orchestrator\ntool: opencode\n---\nshared body\n" {
		t.Fatalf("opencode SKILL.md = %q, want the overridden tool key", opencode[skillFile])
	}
	if _, ok := opencode[filepath.Join("agents", "openai.yaml")]; ok {
		t.Error("codex's sidecar must not reach opencode")
	}
	for _, files := range []map[string][]byte{codex, opencode} {
		for rel := range files {
			if rel == deltaDirName || filepath.HasPrefix(rel, deltaDirName+string(filepath.Separator)) {
				t.Errorf("the delta directory was copied to a harness: %q", rel)
			}
		}
	}
}

func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestReconcileSkillsWritesRealFilesAndIsIdempotent(t *testing.T) {
	p := testPaths(t, "canonical\n", ".codex", ".claude")
	seedSkill(t, p, "graphify")
	actions, err := reconcileSkills(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 2 {
		t.Fatalf("actions = %+v, want one write per present harness", actions)
	}
	for _, rel := range []string{filepath.Join(".codex", "skills", "graphify"), filepath.Join(".claude", "skills", "graphify")} {
		if got := readFile(t, filepath.Join(p.Home, rel, skillFile)); got != "---\nname: graphify\n---\nbody\n" {
			t.Errorf("%s SKILL.md = %q", rel, got)
		}
		if _, err := os.Stat(filepath.Join(p.Home, rel, managedMarkName)); err != nil {
			t.Errorf("%s carries no ownership mark: %v", rel, err)
		}
	}
	again, err := reconcileSkills(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("second reconcile = %+v, want no actions", again)
	}
	// pi has no fixed skills dir, so nothing is created for it even when its config root exists
	if _, err := os.Stat(filepath.Join(p.Home, ".pi", "agent", "skills")); !os.IsNotExist(err) {
		t.Error("pi must not get a skills directory")
	}
}

func TestReconcileSkillsReachesAgyOnlyWhenItsConfigRootExists(t *testing.T) {
	absent := testPaths(t, "canonical\n", ".codex")
	seedSkill(t, absent, "graphify")
	if _, err := reconcileSkills(absent, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(absent.Home, ".gemini")); !os.IsNotExist(err) {
		t.Fatal("~/.gemini must never be created")
	}

	present := testPaths(t, "canonical\n", ".gemini/config")
	seedSkill(t, present, "graphify")
	actions, err := reconcileSkills(present, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].Runtime != "agy" {
		t.Fatalf("actions = %+v, want one agy write", actions)
	}
	dir := filepath.Join(present.Home, ".gemini", "config", "skills", "graphify")
	if got := readFile(t, filepath.Join(dir, skillFile)); got != "---\nname: graphify\n---\nbody\n" {
		t.Errorf("agy SKILL.md = %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, managedMarkName)); err != nil {
		t.Errorf("agy skill carries no ownership mark: %v", err)
	}
}

func TestReconcileSkillsNeverTouchesAnUnmanagedDirectory(t *testing.T) {
	p := testPaths(t, "canonical\n", ".codex")
	seedSkill(t, p, "graphify")
	occupied := filepath.Join(p.Home, ".codex", "skills", "graphify")
	writeFile(t, filepath.Join(occupied, skillFile), "mine\n")

	acts, err := reconcileSkills(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(acts) != 1 || acts[0].Kind != ActionSkillUnmanaged {
		t.Fatalf("actions = %+v, want a single unmanaged report", acts)
	}
	if got := readFile(t, filepath.Join(occupied, skillFile)); got != "mine\n" {
		t.Fatalf("the user's directory was modified: %q", got)
	}
}

func TestReconcileSkillsRemovesOnlyWhatItWrote(t *testing.T) {
	p := testPaths(t, "canonical\n", ".codex")
	seedSkill(t, p, "graphify")
	if _, err := reconcileSkills(p, false); err != nil {
		t.Fatal(err)
	}
	// the user's own directory beside a managed one; dropping the canonical skill must not take it
	mine := filepath.Join(p.Home, ".codex", "skills", "hand-written")
	writeFile(t, filepath.Join(mine, skillFile), "mine\n")
	if err := os.RemoveAll(filepath.Join(p.SkillsRoot, "graphify")); err != nil {
		t.Fatal(err)
	}
	acts, err := reconcileSkills(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(acts) != 1 || acts[0].Kind != ActionSkillRemove {
		t.Fatalf("actions = %+v, want a single removal", acts)
	}
	if _, err := os.Stat(filepath.Join(p.Home, ".codex", "skills", "graphify")); !os.IsNotExist(err) {
		t.Error("the managed copy was not removed")
	}
	if got := readFile(t, filepath.Join(mine, skillFile)); got != "mine\n" {
		t.Fatalf("an unmanaged directory was removed with it: %q", got)
	}
}

func TestReconcileSkillsRewritesAnEditedCopy(t *testing.T) {
	p := testPaths(t, "canonical\n", ".codex")
	seedSkill(t, p, "graphify")
	if _, err := reconcileSkills(p, false); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(p.Home, ".codex", "skills", "graphify")
	writeFile(t, filepath.Join(target, skillFile), "edited away from canonical\n")
	writeFile(t, filepath.Join(target, "stray.txt"), "not in the render\n")
	acts, err := reconcileSkills(p, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(acts) != 1 || acts[0].Kind != ActionSkillWrite {
		t.Fatalf("actions = %+v, want a single rewrite", acts)
	}
	if got := readFile(t, filepath.Join(target, skillFile)); got != "---\nname: graphify\n---\nbody\n" {
		t.Fatalf("SKILL.md = %q, want the canonical text restored", got)
	}
	if _, err := os.Stat(filepath.Join(target, "stray.txt")); !os.IsNotExist(err) {
		t.Error("a file the render does not contain must be removed from a managed copy")
	}
}

func TestSkillRowsReportsPerHarnessState(t *testing.T) {
	p := testPaths(t, "canonical\n", ".codex", ".claude")
	seedSkill(t, p, "graphify")
	seedSkill(t, p, "effort-tracking")
	occupied := filepath.Join(p.Home, ".codex", "skills", "graphify")
	writeFile(t, filepath.Join(occupied, skillFile), "mine\n")
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]SkillRow{}
	for _, r := range rows {
		byName[r.Name] = r
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %+v, want one per canonical skill", rows)
	}
	if got := byName["graphify"].States["codex"]; got != stateUnmanaged {
		t.Errorf("graphify codex = %q, want unmanaged", got)
	}
	if got := byName["graphify"].States["claude"]; got != stateSynced {
		t.Errorf("graphify claude = %q, want synced", got)
	}
	if got := byName["effort-tracking"].States["codex"]; got != stateSynced {
		t.Errorf("effort-tracking codex = %q, want synced", got)
	}
	// opencode has no config root here, so it is not synced at all
	if got := byName["graphify"].States["opencode"]; got != stateAbsent {
		t.Errorf("graphify opencode = %q, want absent", got)
	}
}

func TestSkillRowsDiffersBeforeTheFirstApply(t *testing.T) {
	p := testPaths(t, "canonical\n", ".claude")
	seedSkill(t, p, "graphify")
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].States["claude"] != stateDiffers {
		t.Fatalf("rows = %+v, want claude differing before the first Apply", rows)
	}
}

func TestSkillRowsReportsDeltas(t *testing.T) {
	p := testPaths(t, "canonical\n", ".claude")
	dir := filepath.Join(p.SkillsRoot, "orchestrator")
	writeFile(t, filepath.Join(dir, skillFile), "---\nname: orchestrator\n---\nbody\n")
	writeFile(t, filepath.Join(dir, deltaDirName, "opencode.yaml"), "tool: opencode\n")
	writeFile(t, filepath.Join(dir, deltaDirName, "codex", "agents", "openai.yaml"), "display_name: x\n")
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	if got := rows[0].Deltas["opencode"]; !reflect.DeepEqual(got, []string{"tool"}) {
		t.Errorf("opencode delta = %#v, want the overridden key", got)
	}
	if got := rows[0].Deltas["codex"]; !reflect.DeepEqual(got, []string{"agents/openai.yaml"}) {
		t.Errorf("codex delta = %#v, want the sidecar path", got)
	}
}

func TestSkillRowsReadsDescriptionFromFrontmatter(t *testing.T) {
	p := testPaths(t, "canonical\n", ".claude")
	writeFile(t, filepath.Join(p.SkillsRoot, "graphify", skillFile),
		"---\nname: graphify\ndescription: turn any input into a knowledge graph\n---\n# Graphify\n")
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Description != "turn any input into a knowledge graph" {
		t.Fatalf("rows = %+v, want the frontmatter description", rows)
	}
}

func TestSkillRowsSurvivesAMissingSkillDoc(t *testing.T) {
	p := testPaths(t, "canonical\n", ".claude")
	if err := os.MkdirAll(filepath.Join(p.SkillsRoot, "bare"), 0o755); err != nil {
		t.Fatal(err)
	}
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatalf("a skill directory without SKILL.md must not fail the read: %v", err)
	}
	if len(rows) != 1 || rows[0].Description != "" {
		t.Fatalf("rows = %+v, want one row with an empty description", rows)
	}
}

// ---- shipped skills ----

func shippedFS() fstest.MapFS {
	return fstest.MapFS{
		"cockpit-runs/SKILL.md":            {Data: []byte("---\nname: cockpit-runs\n---\nshipped\n")},
		"design-local/SKILL.md":            {Data: []byte("---\nname: design-local\n---\nshipped\n")},
		"design-local/reference/format.md": {Data: []byte("format\n")},
	}
}

func TestSeedShippedSkillsFillsAnEmptyRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "skills")
	if err := seedShippedSkills(root, shippedFS()); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(root, "design-local", "reference", "format.md")); got != "format\n" {
		t.Errorf("format.md = %q", got)
	}
	if got := readFile(t, filepath.Join(root, "cockpit-runs", skillFile)); got != "---\nname: cockpit-runs\n---\nshipped\n" {
		t.Errorf("cockpit-runs SKILL.md = %q", got)
	}
	// the ownership mark belongs to harness dirs, never the vault
	if _, err := os.Stat(filepath.Join(root, "cockpit-runs", managedMarkName)); !os.IsNotExist(err) {
		t.Error("seeding must not write the ownership mark into the vault")
	}
}

func TestSeedShippedSkillsOverwritesAStaleCopyAndDropsExtraFiles(t *testing.T) {
	root := filepath.Join(t.TempDir(), "skills")
	writeFile(t, filepath.Join(root, "design-local", skillFile), "old\n")
	writeFile(t, filepath.Join(root, "design-local", "retired.md"), "gone\n")
	if err := seedShippedSkills(root, shippedFS()); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(root, "design-local", skillFile)); got != "---\nname: design-local\n---\nshipped\n" {
		t.Errorf("SKILL.md = %q, want the shipped copy", got)
	}
	if _, err := os.Stat(filepath.Join(root, "design-local", "retired.md")); !os.IsNotExist(err) {
		t.Error("a file the shipped tree does not have must be removed")
	}
}

func TestSeedShippedSkillsKeepsTheDeltaDir(t *testing.T) {
	root := filepath.Join(t.TempDir(), "skills")
	delta := filepath.Join(root, "cockpit-runs", deltaDirName, "codex.yaml")
	writeFile(t, delta, "description: codex wording\n")
	if err := seedShippedSkills(root, shippedFS()); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, delta); got != "description: codex wording\n" {
		t.Errorf("delta = %q, want it preserved", got)
	}
}

func TestSeedShippedSkillsWritesNothingWhenIdentical(t *testing.T) {
	root := filepath.Join(t.TempDir(), "skills")
	if err := seedShippedSkills(root, shippedFS()); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "cockpit-runs", skillFile)
	past := time.Now().Add(-time.Hour).Truncate(time.Second)
	if err := os.Chtimes(path, past, past); err != nil {
		t.Fatal(err)
	}
	if err := seedShippedSkills(root, shippedFS()); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !st.ModTime().Equal(past) {
		t.Errorf("mtime = %v, want %v: an identical skill must not be rewritten", st.ModTime(), past)
	}
}

func TestApplySeedsShippedSkillsOnlyWhenNotDryRun(t *testing.T) {
	p := testPaths(t, "canonical\n", ".claude")
	p.Shipped = shippedFS()
	if _, err := Apply(p, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "cockpit-runs")); !os.IsNotExist(err) {
		t.Fatal("a dry run must not seed the vault")
	}
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	// seeded before the reconcile, so the same Apply projects it into the harness
	if got := readFile(t, filepath.Join(p.Home, ".claude", "skills", "cockpit-runs", skillFile)); got != "---\nname: cockpit-runs\n---\nshipped\n" {
		t.Errorf("claude cockpit-runs SKILL.md = %q", got)
	}
}

// the final stage's dev app keeps a vault of its own, which lacks the user's skills: projecting it would remove them
// from the user's ~/.claude, so it seeds its vault and only reports what it would do to the harnesses
func TestApplyWithKeepHarnessesSeedsTheVaultAndWritesNoHarness(t *testing.T) {
	p := testPaths(t, "canonical\n", ".claude")
	p.Shipped = shippedFS()
	seedSkill(t, p, "mine")
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	claude := filepath.Join(p.Home, ".claude")
	steering := readFile(t, filepath.Join(claude, "CLAUDE.md"))
	for _, name := range []string{"mine", "cockpit-runs"} {
		if err := os.RemoveAll(filepath.Join(p.SkillsRoot, name)); err != nil {
			t.Fatal(err)
		}
	}
	writeFile(t, p.SteeringDoc, "the dev app's rules\n")

	p.KeepHarnesses = true
	acts, err := Apply(p, false)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]bool{}
	for _, a := range acts {
		kinds[a.Kind] = true
	}
	if !kinds[ActionSteeringWrite] || !kinds[ActionSkillRemove] {
		t.Errorf("actions = %+v, want the steering write and the removal it would make", acts)
	}
	if got := readFile(t, filepath.Join(claude, "CLAUDE.md")); got != steering {
		t.Errorf("CLAUDE.md = %q, want it untouched", got)
	}
	if _, err := os.Stat(filepath.Join(claude, "skills", "mine", skillFile)); err != nil {
		t.Errorf("the user's skill was removed from the harness: %v", err)
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "cockpit-runs", skillFile)); err != nil {
		t.Errorf("the shipped skills were not seeded into its own vault: %v", err)
	}
}

// with the arc mod installed, claude gets the shipped skills in the mod (listed as arc:<skill>), additions included,
// and the copies arcterm wrote in ~/.claude/skills go; a skill of the user's still lands there
func TestApplyPutsClaudesShippedSkillsInTheArcMod(t *testing.T) {
	p := testPaths(t, "canonical\n", ".claude")
	p.Shipped = shippedFS()
	seedSkill(t, p, "mine")
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	claudeSkills := filepath.Join(p.Home, ".claude", "skills")
	if _, err := os.Stat(filepath.Join(claudeSkills, "cockpit-runs", skillFile)); err != nil {
		t.Fatalf("without the mod the shipped skill goes to ~/.claude/skills: %v", err)
	}

	mod := filepath.Join(p.Home, ".arc", "claude-mod")
	writeFile(t, filepath.Join(mod, ".claude-plugin", "plugin.json"), `{"name":"arc"}`)
	if err := UpsertAddition(p.SkillsRoot, "cockpit-runs", Addition{Key: "k", Text: "always queue", Learned: "2026-10-19", Count: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, filepath.Join(mod, "skills", "cockpit-runs", skillFile))
	if !strings.Contains(got, "always queue") {
		t.Errorf("the mod's copy lost the addition: %q", got)
	}
	if _, err := os.Stat(filepath.Join(claudeSkills, "cockpit-runs")); !os.IsNotExist(err) {
		t.Errorf("the ~/.claude/skills copy is still there, so claude would list the skill twice: %v", err)
	}
	if _, err := os.Stat(filepath.Join(claudeSkills, "mine", skillFile)); err != nil {
		t.Errorf("the user's own skill left ~/.claude/skills: %v", err)
	}
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.States["claude"] != stateSynced {
			t.Errorf("%s claude = %q, want synced", r.Name, r.States["claude"])
		}
	}
}

// a shipped skill renamed keeps the user's .arc delta under its new name; the old vault copy goes
func TestSeedRetiresARenamedSkillKeepingItsDelta(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "effort-tracking", skillFile), "---\nname: effort-tracking\n---\nold\n")
	writeFile(t, filepath.Join(root, "effort-tracking", deltaDirName, additionsFile), "learned\n")
	shipped := fstest.MapFS{"initiatives/SKILL.md": {Data: []byte("---\nname: initiatives\n---\nnew\n")}}
	if err := seedShippedSkills(root, shipped); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "effort-tracking")); !os.IsNotExist(err) {
		t.Errorf("the old name is still in the vault: %v", err)
	}
	if got := readFile(t, filepath.Join(root, "initiatives", deltaDirName, additionsFile)); got != "learned\n" {
		t.Errorf("the delta did not move to the new name: %q", got)
	}
	if got := readFile(t, filepath.Join(root, "initiatives", skillFile)); got != "---\nname: initiatives\n---\nnew\n" {
		t.Errorf("initiatives SKILL.md = %q", got)
	}
}
