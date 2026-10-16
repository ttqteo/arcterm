// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
)

func principles(items ...waveobj.Principle) waveobj.PrincipleList { return items }

func TestResolvePrinciples(t *testing.T) {
	global := principles(
		waveobj.Principle{ID: "simple", Text: "Prefer simple solutions."},
		waveobj.Principle{ID: "errors", Text: "Handle errors at boundaries."},
		waveobj.Principle{ID: "measure", Text: "Measure before optimizing."},
	)
	patch := &waveobj.PrinciplePatch{
		Additions:    []waveobj.Principle{{ID: "project-api", Text: "Keep the public API stable."}, {ID: "project-tests", Text: "Test behavior."}},
		Replacements: map[string]string{"errors": "Return contextual boundary errors.", "measure": "ignored replacement"},
		Disabled:     []string{"measure"},
	}
	want := principles(
		waveobj.Principle{ID: "simple", Text: "Prefer simple solutions."},
		waveobj.Principle{ID: "errors", Text: "Return contextual boundary errors."},
		waveobj.Principle{ID: "project-api", Text: "Keep the public API stable."},
		waveobj.Principle{ID: "project-tests", Text: "Test behavior."},
	)

	got, diagnostics := ResolvePrinciples(global, patch)
	if !reflect.DeepEqual(got, want) || len(diagnostics) != 0 {
		t.Fatalf("resolved principles mismatch: got %#v diagnostics %#v", got, diagnostics)
	}
	if global[1].Text != "Handle errors at boundaries." || patch.Replacements["errors"] != "Return contextual boundary errors." {
		t.Fatal("resolution mutated its inputs")
	}
}

func TestResolvePrinciplesReportsStaleReferences(t *testing.T) {
	global := principles(waveobj.Principle{ID: "simple", Text: "Simple."})
	patch := &waveobj.PrinciplePatch{
		Replacements: map[string]string{"removed-replacement": "stale"},
		Disabled:     []string{"removed-disabled"},
	}
	got, diagnostics := ResolvePrinciples(global, patch)
	wantDiagnostics := []waveobj.PrincipleDiagnostic{
		{Code: DiagnosticMissingReplacement, PrincipleID: "removed-replacement"},
		{Code: DiagnosticMissingDisabled, PrincipleID: "removed-disabled"},
	}
	if !reflect.DeepEqual(got, global) || !reflect.DeepEqual(diagnostics, wantDiagnostics) {
		t.Fatalf("stale references mismatch: got %#v diagnostics %#v", got, diagnostics)
	}
}

func TestValidatePrinciples(t *testing.T) {
	validGlobal := principles(waveobj.Principle{ID: "simple", Text: "Simple."})
	tests := []struct {
		name   string
		global waveobj.PrincipleList
		patch  *waveobj.PrinciplePatch
	}{
		{name: "blank global id", global: principles(waveobj.Principle{Text: "Simple."})},
		{name: "blank global text", global: principles(waveobj.Principle{ID: "simple"})},
		{name: "duplicate global id", global: principles(waveobj.Principle{ID: "simple", Text: "One."}, waveobj.Principle{ID: "simple", Text: "Two."})},
		{name: "blank addition id", global: validGlobal, patch: &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{Text: "Added."}}}},
		{name: "blank addition text", global: validGlobal, patch: &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{ID: "added"}}}},
		{name: "duplicate addition id", global: validGlobal, patch: &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{ID: "added", Text: "One."}, {ID: "added", Text: "Two."}}}},
		{name: "addition global collision", global: validGlobal, patch: &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{ID: "simple", Text: "Added."}}}},
		{name: "blank replacement text", global: validGlobal, patch: &waveobj.PrinciplePatch{Replacements: map[string]string{"simple": "  "}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.patch == nil {
				if err := ValidateGlobalPrinciples(tt.global); err == nil {
					t.Fatal("expected validation error")
				}
				return
			}
			if err := ValidatePrinciplePatch(tt.global, tt.patch); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
	if err := ValidatePrinciplePatch(validGlobal, &waveobj.PrinciplePatch{Disabled: []string{"stale"}}); err != nil {
		t.Fatalf("stale references are nonfatal: %v", err)
	}
}

func TestLegacyProjectReplacementAndNormalization(t *testing.T) {
	var patch waveobj.PrinciplePatch
	if err := json.Unmarshal([]byte(`"legacy project\ntext"`), &patch); err != nil {
		t.Fatal(err)
	}
	global := principles(
		waveobj.Principle{ID: "simple", Text: "Simple."},
		waveobj.Principle{ID: "errors", Text: "Errors."},
	)
	got, diagnostics := ResolvePrinciples(global, &patch)
	want := principles(waveobj.Principle{ID: waveobj.LegacyProjectPrincipleID, Text: "legacy project\ntext"})
	if !reflect.DeepEqual(got, want) || len(diagnostics) != 0 {
		t.Fatalf("legacy resolution mismatch: got %#v diagnostics %#v", got, diagnostics)
	}
	normalized := NormalizePrinciplePatch(global, &patch)
	if !reflect.DeepEqual(normalized.Disabled, []string{"simple", "errors"}) || !reflect.DeepEqual(normalized.Additions, []waveobj.Principle(want)) {
		t.Fatalf("legacy normalization mismatch: %#v", normalized)
	}
}

func TestRenderPrinciples(t *testing.T) {
	structured := principles(
		waveobj.Principle{ID: "simple", Text: "Prefer simple solutions."},
		waveobj.Principle{ID: "errors", Text: "Handle errors."},
	)
	if got := RenderPrinciples(structured); got != "- Prefer simple solutions.\n- Handle errors." {
		t.Fatalf("structured rendering mismatch: %q", got)
	}
	legacy := "preserve\nthis exact text"
	if got := RenderPrinciples(principles(waveobj.Principle{ID: waveobj.LegacyGlobalPrincipleID, Text: legacy})); got != legacy {
		t.Fatalf("legacy rendering changed text: %q", got)
	}
	if got := RenderPrinciples(nil); got != "" {
		t.Fatalf("empty rendering mismatch: %q", got)
	}
}

// a principle added twice (finding 1) reached every prompt twice; case, spacing and trailing punctuation
// are not a difference, and the earlier copy is the one kept
func TestRepeatedPrinciplesRenderOnceAndAreRefusedOnWrite(t *testing.T) {
	repeated := principles(
		waveobj.Principle{ID: "a", Text: "Use worktree"},
		waveobj.Principle{ID: "b", Text: "use  worktree."},
		waveobj.Principle{ID: "c", Text: "KISS"},
	)
	if got := RenderPrinciples(repeated); got != "- Use worktree\n- KISS" {
		t.Fatalf("repeated principle rendered twice: %q", got)
	}
	err := ValidateGlobalPrinciples(repeated)
	if err == nil || !strings.Contains(err.Error(), `"Use worktree"`) || !strings.Contains(err.Error(), `"a"`) {
		t.Fatalf("the write path must refuse the repeat and name the earlier principle: %v", err)
	}
	if err := ValidateGlobalPrinciples(principles(waveobj.Principle{ID: "a", Text: "Use worktree"}, waveobj.Principle{ID: "b", Text: "Use worktree instead of branch"})); err != nil {
		t.Fatalf("a near-duplicate is the human's to edit, not refused: %v", err)
	}
	patch := &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{ID: "p", Text: "KISS!"}}}
	if err := ValidatePrinciplePatch(principles(waveobj.Principle{ID: "c", Text: "KISS"}), patch); err == nil || !strings.Contains(err.Error(), `"c"`) {
		t.Fatalf("a project addition repeating a global principle must be refused on write: %v", err)
	}
	// a patch stored before the refusal still resolves; only the render drops the repeat
	got, _ := ResolvePrinciples(principles(waveobj.Principle{ID: "c", Text: "KISS"}), patch)
	if len(got) != 2 || RenderPrinciples(got) != "- KISS" {
		t.Fatalf("a stored repeat must still resolve and render once: %#v", got)
	}
}

func TestResolveProfile(t *testing.T) {
	global := waveobj.JarvisProfile{Principles: principles(waveobj.Principle{ID: "simple", Text: "Simple."})}
	patch := &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{ID: "project", Text: "Project."}}}
	got, diagnostics := ResolveProfileWithDiagnostics(global, &waveobj.ProfileOverride{Principles: patch})
	if len(diagnostics) != 0 || len(got.Principles) != 2 {
		t.Fatalf("resolved profile mismatch: %+v diagnostics %#v", got, diagnostics)
	}
	if plain := ResolveProfile(global, nil); !reflect.DeepEqual(plain.Principles, global.Principles) {
		t.Fatalf("nil override should inherit global: %+v", plain)
	}
}

func TestBuiltinProfile(t *testing.T) {
	builtin := BuiltinProfile()
	if !reflect.DeepEqual(builtin.Principles, DefaultPrinciples) {
		t.Fatalf("builtin profile mismatch: %+v", builtin)
	}
	if err := ValidateGlobalPrinciples(builtin.Principles); err != nil {
		t.Fatalf("builtin principles invalid: %v", err)
	}
}

func TestLoadGlobalProfile(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "malformed json", body: "{not json"},
		{name: "invalid principles", body: `{"principles":[{"id":"dup","text":"one"},{"id":"dup","text":"two"}]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			withConfigHome(t, dir)
			writeVaultProfile(t, dir, tt.body)
			if got := LoadGlobalProfile(); !reflect.DeepEqual(got, BuiltinProfile()) {
				t.Fatalf("invalid file should fall back: %+v", got)
			}
		})
	}

	dir := t.TempDir()
	withConfigHome(t, dir)
	body := `{"playbook":[{"kind":"execute","state":"pending"}],"principles":"custom\nlegacy"}`
	writeVaultProfile(t, dir, body)
	got := LoadGlobalProfile()
	if RenderPrinciples(got.Principles) != "custom\nlegacy" {
		t.Fatalf("valid legacy file should parse exactly: %+v", got)
	}
}

func TestOverrideFromMeta(t *testing.T) {
	if OverrideFromMeta(&waveobj.Channel{Meta: waveobj.MetaMapType{}}) != nil {
		t.Fatal("absent key should be nil")
	}
	ch := &waveobj.Channel{Meta: waveobj.MetaMapType{MetaKey_JarvisProfile: map[string]any{"principles": "project-only"}}}
	ov := OverrideFromMeta(ch)
	if ov == nil || ov.Principles == nil {
		t.Fatalf("present key should parse: %+v", ov)
	}
	if text, ok := ov.Principles.LegacyReplacement(); !ok || text != "project-only" {
		t.Fatalf("legacy marker mismatch: %q %v", text, ok)
	}
	bad := &waveobj.Channel{Meta: waveobj.MetaMapType{MetaKey_JarvisProfile: "not-an-object"}}
	if OverrideFromMeta(bad) != nil {
		t.Fatal("malformed override should degrade to nil")
	}
}

// withConfigHome pins the config dir and, through the home dir, the default vault (<dir>/.waveterm/vault),
// so a test never reads or writes the real vault.
func withConfigHome(t *testing.T, dir string) {
	t.Helper()
	old := wavebase.ConfigHome_VarCache
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = old })
	wavebase.ConfigHome_VarCache = dir
	t.Setenv("USERPROFILE", dir)
	t.Setenv("HOME", dir)
}

func TestProfileLivesInVault(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	profile := BuiltinProfile()
	profile.DefaultMode = "orchestrator"
	if err := SaveGlobalProfile(profile); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dir, ".waveterm", "vault", "config", globalProfileFileName)
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("profile not in the vault: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, globalProfileFileName)); !os.IsNotExist(err) {
		t.Fatalf("profile written to the config dir: %v", err)
	}
	if got := LoadGlobalProfile(); got.DefaultMode != "orchestrator" {
		t.Fatalf("round trip lost defaultmode: %+v", got)
	}
}

func TestSaveGlobalProfilePokesSync(t *testing.T) {
	withConfigHome(t, t.TempDir())
	wavevault.PokedForTest()
	if err := SaveGlobalProfile(BuiltinProfile()); err != nil {
		t.Fatal(err)
	}
	if !wavevault.PokedForTest() {
		t.Fatal("save did not poke the sync loop")
	}
}

func writeVaultProfile(t *testing.T, home, body string) {
	t.Helper()
	path := filepath.Join(home, ".waveterm", "vault", "config", globalProfileFileName)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeLocalProfile(t *testing.T, dir, body string) string {
	t.Helper()
	path := filepath.Join(dir, globalProfileFileName)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestMigrateGlobalProfileMovesLocal(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	local := writeLocalProfile(t, dir, `{"defaultmode":"orchestrator"}`)
	if err := MigrateGlobalProfile(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(local); !os.IsNotExist(err) {
		t.Fatalf("local profile not moved: %v", err)
	}
	if got := LoadGlobalProfile(); got.DefaultMode != "orchestrator" {
		t.Fatalf("vault profile lost the migrated content: %+v", got)
	}
}

func TestMigrateGlobalProfileKeepsBoth(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	profile := BuiltinProfile()
	profile.DefaultMode = "quick"
	if err := SaveGlobalProfile(profile); err != nil {
		t.Fatal(err)
	}
	local := writeLocalProfile(t, dir, `{"defaultmode":"orchestrator"}`)
	if err := MigrateGlobalProfile(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(local); err != nil {
		t.Fatalf("local profile deleted: %v", err)
	}
	if got := LoadGlobalProfile(); got.DefaultMode != "quick" {
		t.Fatalf("vault profile overwritten: %+v", got)
	}
}

func TestMigrateGlobalProfileNoop(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	if err := MigrateGlobalProfile(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".waveterm", "vault", "config", globalProfileFileName)); !os.IsNotExist(err) {
		t.Fatalf("migration invented a vault profile: %v", err)
	}
}

func TestDefaultPrincipleWordingIsBounded(t *testing.T) {
	for _, principle := range DefaultPrinciples {
		if strings.TrimSpace(principle.ID) == "" || strings.TrimSpace(principle.Text) == "" {
			t.Fatalf("blank builtin principle: %#v", principle)
		}
	}
}

func TestSaveGlobalProfileRoundTrip(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	profile := BuiltinProfile()
	profile.Principles = append(waveobj.PrincipleList(nil), profile.Principles...)
	profile.Principles[0].Text = "Custom global principle."
	profile.DefaultMode = "orchestrator"
	if err := SaveGlobalProfile(profile); err != nil {
		t.Fatalf("save: %v", err)
	}
	got := LoadGlobalProfile()
	if len(got.Principles) == 0 || got.Principles[0].Text != "Custom global principle." {
		t.Fatalf("principle not persisted: %+v", got.Principles)
	}
	if got.DefaultMode != "orchestrator" {
		t.Fatalf("defaultmode not persisted: %q", got.DefaultMode)
	}
}

func TestSaveGlobalProfileRejectsBlankPrinciple(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	profile := BuiltinProfile()
	profile.Principles = waveobj.PrincipleList{{ID: "p1", Text: "   "}}
	if err := SaveGlobalProfile(profile); err == nil {
		t.Fatal("expected validation error for blank text")
	}
	if _, err := os.Stat(globalProfilePath()); !os.IsNotExist(err) {
		t.Fatal("must not write the file on validation failure")
	}
}

func intPtr(n int) *int { return &n }

// Future-run engine defaults resolve section-by-section like every other profile section: an absent
// override field inherits the global value, a present one replaces it.
func TestResolveProfileAppliesEngineDefaults(t *testing.T) {
	globalRoute := &waveobj.RoutePin{Runtime: "pi"}
	global := waveobj.JarvisProfile{Parallelism: 2, WorkerRoute: globalRoute}
	overrideRoute := &waveobj.RoutePin{Runtime: "claude", Model: "opus"}
	got := ResolveProfile(global, &waveobj.ProfileOverride{
		Parallelism: intPtr(6),
		WorkerRoute: overrideRoute,
	})
	if got.Parallelism != 6 {
		t.Errorf("parallelism = %d, want the override's 6", got.Parallelism)
	}
	if got.WorkerRoute == nil || *got.WorkerRoute != *overrideRoute {
		t.Errorf("worker route = %+v, want the override's", got.WorkerRoute)
	}
}

func TestResolveProfileInheritsEngineDefaults(t *testing.T) {
	globalRoute := &waveobj.RoutePin{Runtime: "pi"}
	global := waveobj.JarvisProfile{Parallelism: 2, WorkerRoute: globalRoute}
	got := ResolveProfile(global, &waveobj.ProfileOverride{DefaultMode: strPtr(RunMode_Orchestrator)})
	if got.Parallelism != 2 {
		t.Errorf("engine defaults not inherited: %+v", got)
	}
	if got.WorkerRoute == nil || *got.WorkerRoute != *globalRoute {
		t.Errorf("worker route not inherited: %+v", got.WorkerRoute)
	}
}

// An override that carries only the new engine sections is not empty: it must store rather than be
// mistaken for a cleared profile.
func TestProfileOverrideIsEmptyUnderstandsEngineDefaults(t *testing.T) {
	cases := []struct {
		name     string
		override *waveobj.ProfileOverride
		want     bool
	}{
		{"nil", nil, true},
		{"bare", &waveobj.ProfileOverride{}, true},
		{"parallelism", &waveobj.ProfileOverride{Parallelism: intPtr(3)}, false},
		{"workerroute", &waveobj.ProfileOverride{WorkerRoute: &waveobj.RoutePin{Runtime: "pi"}}, false},
		{"empty patch is empty", &waveobj.ProfileOverride{Principles: &waveobj.PrinciplePatch{}}, true},
	}
	for _, tc := range cases {
		if got := ProfileOverrideIsEmpty(tc.override); got != tc.want {
			t.Errorf("%s: ProfileOverrideIsEmpty = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// Landing resolves like defaultmode: the global value stands until an override replaces it.
func TestResolveProfileLanding(t *testing.T) {
	global := waveobj.JarvisProfile{Landing: Landing_Branch}
	if got := ResolveProfile(global, nil); got.Landing != Landing_Branch {
		t.Errorf("landing = %q, want the global %q", got.Landing, Landing_Branch)
	}
	if got := ResolveProfile(global, &waveobj.ProfileOverride{Landing: strPtr(Landing_Checkout)}); got.Landing != Landing_Checkout {
		t.Errorf("landing = %q, want the override's %q", got.Landing, Landing_Checkout)
	}
	if ProfileOverrideIsEmpty(&waveobj.ProfileOverride{Landing: strPtr(Landing_Branch)}) {
		t.Error("an override carrying only landing is not empty")
	}
}

func TestValidateLanding(t *testing.T) {
	for _, ok := range []string{"", Landing_Checkout, Landing_Branch} {
		if err := ValidateLanding(ok); err != nil {
			t.Errorf("ValidateLanding(%q) = %v, want nil", ok, err)
		}
	}
	if err := ValidateLanding("worktree"); err == nil {
		t.Error("an unknown landing must be refused")
	}
}

// a run's own request wins over the profile, and a landing no one chose is a branch
func TestEffectiveLanding(t *testing.T) {
	cases := []struct{ requested, profile, want string }{
		{"", "", Landing_Branch},
		{"", Landing_Checkout, Landing_Checkout},
		{Landing_Checkout, Landing_Branch, Landing_Checkout},
		{Landing_Branch, Landing_Checkout, Landing_Branch},
	}
	for _, c := range cases {
		if got := EffectiveLanding(c.requested, c.profile); got != c.want {
			t.Errorf("EffectiveLanding(%q, %q) = %q, want %q", c.requested, c.profile, got, c.want)
		}
	}
}

func TestSaveGlobalProfileRejectsUnknownLanding(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	profile := BuiltinProfile()
	profile.Landing = "elsewhere"
	if err := SaveGlobalProfile(profile); err == nil {
		t.Fatal("expected an unknown landing to be refused")
	}
	profile.Landing = Landing_Branch
	if err := SaveGlobalProfile(profile); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got := LoadGlobalProfile(); got.Landing != Landing_Branch {
		t.Fatalf("landing not persisted: %q", got.Landing)
	}
}

// Autonomous resolves like landing: the global value stands until an override replaces it either way.
func TestResolveProfileAutonomous(t *testing.T) {
	cases := []struct {
		name     string
		global   bool
		override *waveobj.ProfileOverride
		want     bool
	}{
		{"override true over global false", false, &waveobj.ProfileOverride{Autonomous: boolPtr(true)}, true},
		{"override false over global true", true, &waveobj.ProfileOverride{Autonomous: boolPtr(false)}, false},
		{"nil override inherits global true", true, nil, true},
		{"an unrelated override inherits global true", true, &waveobj.ProfileOverride{Parallelism: intPtr(2)}, true},
		{"nil override inherits global false", false, nil, false},
	}
	for _, tc := range cases {
		if got := ResolveProfile(waveobj.JarvisProfile{Autonomous: tc.global}, tc.override); got.Autonomous != tc.want {
			t.Errorf("%s: autonomous = %v, want %v", tc.name, got.Autonomous, tc.want)
		}
	}
}

func TestProfileOverrideIsEmptyAutonomous(t *testing.T) {
	for _, v := range []bool{true, false} {
		if ProfileOverrideIsEmpty(&waveobj.ProfileOverride{Autonomous: boolPtr(v)}) {
			t.Errorf("an override carrying only autonomous=%v must not read as empty", v)
		}
	}
}
