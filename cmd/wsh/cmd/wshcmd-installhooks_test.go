// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testWsh = `C:\a\bin\wsh-0.14.5-windows.x64.exe`

// count managed command entries across all events in a merged config
func countManaged(t *testing.T, cfg map[string]any) int {
	t.Helper()
	n := 0
	hooks, _ := cfg["hooks"].(map[string]any)
	for _, groups := range hooks {
		gs, _ := groups.([]any)
		for _, g := range gs {
			gm, _ := g.(map[string]any)
			hs, _ := gm["hooks"].([]any)
			for _, h := range hs {
				hm, _ := h.(map[string]any)
				if c, _ := hm["command"].(string); isManagedCommand(c) {
					n++
				}
			}
		}
	}
	return n
}

func TestIsManagedCommand(t *testing.T) {
	cases := map[string]bool{
		`"C:\a\bin\wsh-0.14.5-windows.x64.exe" agent-hook`: true,
		`"C:\a\bin\wsh.exe" ask`:                           true,
		`"/usr/local/bin/wsh" ask --clear`:                 true,
		`wsh agent-hook`:                                   true,
		`"C:\a\bin\wsh.exe" agent-memory-hook`:             true,
		`"C:\a\bin\wsh.exe" ask --other`:                   false,
		`node /x/ask-hook.js`:                              false,
		`mytool agent-hook`:                                false,
		``:                                                 false,
	}
	for cmd, want := range cases {
		if got := isManagedCommand(cmd); got != want {
			t.Fatalf("isManagedCommand(%q) = %v, want %v", cmd, got, want)
		}
	}
}

func TestMergeAgentHooksEmpty(t *testing.T) {
	got := mergeAgentHooks(map[string]any{}, testWsh)
	if n := countManaged(t, got); n != len(managedHooks) {
		t.Fatalf("managed entries = %d, want %d", n, len(managedHooks))
	}
}

func TestMergeAgentHooksIdempotent(t *testing.T) {
	once := mergeAgentHooks(map[string]any{}, testWsh)
	twice := mergeAgentHooks(once, testWsh)
	if n := countManaged(t, twice); n != len(managedHooks) {
		t.Fatalf("managed entries after 2x = %d, want %d", n, len(managedHooks))
	}
}

func TestMergeAgentHooksPreservesUnrelated(t *testing.T) {
	existing := map[string]any{
		"theme": "dark",
		"env":   map[string]any{"FOO": "1"},
		"hooks": map[string]any{
			"PreToolUse": []any{
				map[string]any{
					"matcher": "Bash",
					"hooks":   []any{map[string]any{"type": "command", "command": "node /my/own/hook.js"}},
				},
			},
		},
	}
	got := mergeAgentHooks(existing, testWsh)
	if got["theme"] != "dark" {
		t.Fatal("theme not preserved")
	}
	if _, ok := got["env"].(map[string]any); !ok {
		t.Fatal("env not preserved")
	}
	// user's Bash hook must survive
	hooks := got["hooks"].(map[string]any)
	pre := hooks["PreToolUse"].([]any)
	foundUser := false
	for _, g := range pre {
		gm := g.(map[string]any)
		hs := gm["hooks"].([]any)
		for _, h := range hs {
			if h.(map[string]any)["command"] == "node /my/own/hook.js" {
				foundUser = true
			}
		}
	}
	if !foundUser {
		t.Fatal("user hook was clobbered")
	}
	if n := countManaged(t, got); n != len(managedHooks) {
		t.Fatalf("managed entries = %d, want %d", n, len(managedHooks))
	}
}

func TestMergeAgentHooksRefreshesStalePath(t *testing.T) {
	old := mergeAgentHooks(map[string]any{}, `C:\old\bin\wsh-0.14.4-windows.x64.exe`)
	refreshed := mergeAgentHooks(old, testWsh)
	if n := countManaged(t, refreshed); n != len(managedHooks) {
		t.Fatalf("managed entries = %d, want %d (stale not replaced)", n, len(managedHooks))
	}
	// no command should still reference the old path
	hooks := refreshed["hooks"].(map[string]any)
	for _, groups := range hooks {
		for _, g := range groups.([]any) {
			for _, h := range g.(map[string]any)["hooks"].([]any) {
				c := h.(map[string]any)["command"].(string)
				if strings_Contains(c, "0.14.4") {
					t.Fatalf("stale path still present: %q", c)
				}
			}
		}
	}
}

// tiny local helper so the test file needs no extra import
func strings_Contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

func TestIsManagedStatusLine(t *testing.T) {
	cases := map[string]bool{
		`"C:\a\bin\wsh-0.14.5-windows.x64.exe" statusline --inner=YmFzaCB4`: true,
		`"/usr/local/bin/wsh" statusline --inner=`:                         true,
		`wsh statusline`:                                                   true,
		`bash /c/Users/x/statusline-command.sh`:                           false,
		`"C:\a\bin\wsh.exe" agent-hook`:                                    false,
		``:                                                                 false,
	}
	for cmd, want := range cases {
		if got := isManagedStatusLine(cmd); got != want {
			t.Fatalf("isManagedStatusLine(%q) = %v, want %v", cmd, got, want)
		}
	}
}

func TestMergeStatusLineWrapsUnmanaged(t *testing.T) {
	existing := map[string]any{
		"statusLine": map[string]any{"type": "command", "command": `bash /c/Users/x/sl.sh`},
	}
	got := mergeStatusLine(existing, testWsh)
	sl := got["statusLine"].(map[string]any)
	cmd := sl["command"].(string)
	if !isManagedStatusLine(cmd) {
		t.Fatalf("command not managed after wrap: %q", cmd)
	}
	if inner := recoverInner(cmd); inner != `bash /c/Users/x/sl.sh` {
		t.Fatalf("inner not preserved: %q", inner)
	}
	if sl["type"] != "command" {
		t.Fatal("type not set to command")
	}
}

func TestMergeStatusLineEmpty(t *testing.T) {
	got := mergeStatusLine(map[string]any{}, testWsh)
	sl := got["statusLine"].(map[string]any)
	cmd := sl["command"].(string)
	if !isManagedStatusLine(cmd) {
		t.Fatalf("command not managed: %q", cmd)
	}
	if inner := recoverInner(cmd); inner != "" {
		t.Fatalf("expected empty inner, got %q", inner)
	}
}

func TestMergeStatusLineIdempotentNoNest(t *testing.T) {
	existing := map[string]any{
		"statusLine": map[string]any{"type": "command", "command": `bash /c/Users/x/sl.sh`},
	}
	once := mergeStatusLine(existing, testWsh)
	twice := mergeStatusLine(once, testWsh)
	inner := recoverInner(twice["statusLine"].(map[string]any)["command"].(string))
	if inner != `bash /c/Users/x/sl.sh` {
		t.Fatalf("re-wrap nested or lost inner: %q", inner)
	}
}

func TestMergeStatusLineRefreshesPath(t *testing.T) {
	existing := map[string]any{
		"statusLine": map[string]any{"type": "command", "command": `bash /x/sl.sh`},
	}
	old := mergeStatusLine(existing, `C:\old\bin\wsh-0.14.4-windows.x64.exe`)
	refreshed := mergeStatusLine(old, testWsh)
	cmd := refreshed["statusLine"].(map[string]any)["command"].(string)
	if strings_Contains(cmd, "0.14.4") {
		t.Fatalf("stale path still present: %q", cmd)
	}
	if inner := recoverInner(cmd); inner != `bash /x/sl.sh` {
		t.Fatalf("inner lost on refresh: %q", inner)
	}
}

func TestMergeStatusLinePreservesOtherKeys(t *testing.T) {
	existing := map[string]any{"theme": "dark", "statusLine": map[string]any{"command": `bash /x.sh`}}
	got := mergeStatusLine(existing, testWsh)
	if got["theme"] != "dark" {
		t.Fatal("theme not preserved")
	}
}

func TestConfigIsHealthy(t *testing.T) {
	full := mergeClaudePluginDirs(mergeStatusLine(mergeAgentHooks(map[string]any{}, testWsh), testWsh), testModDir)

	stable := `C:\Users\u\.arc\bin\wsh.exe`

	// all managed present, all naming the path this install writes -> healthy
	if !configIsHealthy(full, testWsh, []string{testModDir}, false) {
		t.Fatal("full config naming the wanted wsh should be healthy")
	}
	// naming any other binary -> not healthy, so a versioned build path migrates to the stable copy
	if configIsHealthy(full, stable, []string{testModDir}, false) {
		t.Fatal("full config naming a different wsh should NOT be healthy")
	}
	// empty config -> not healthy
	if configIsHealthy(map[string]any{}, testWsh, []string{testModDir}, false) {
		t.Fatal("empty config should NOT be healthy")
	}
	// hooks present but statusLine absent -> not healthy
	hooksOnly := mergeAgentHooks(map[string]any{}, testWsh)
	if configIsHealthy(hooksOnly, testWsh, []string{testModDir}, false) {
		t.Fatal("config missing managed statusLine should NOT be healthy")
	}
	// hooks repointed but statusLine still naming the old build -> not healthy
	staleStatusLine := mergeClaudePluginDirs(mergeStatusLine(mergeAgentHooks(map[string]any{}, stable), testWsh), testModDir)
	if configIsHealthy(staleStatusLine, stable, []string{testModDir}, false) {
		t.Fatal("config whose statusLine names a different wsh should NOT be healthy")
	}
}

func TestJsonStringEscapesBackslashes(t *testing.T) {
	got := jsonString(`C:\Users\u\bin\wsh.exe`)
	if !strings.Contains(got, `\\`) {
		t.Fatalf("expected escaped backslashes in %q", got)
	}
}

func TestInstallOpencodePlugin_writesSubstitutedPlugin(t *testing.T) {
	origLookPath := opencodeLookPath
	opencodeLookPath = func(string) (string, error) { return "opencode", nil }
	defer func() { opencodeLookPath = origLookPath }()

	home := t.TempDir()
	if err := installOpencodePlugin(home, testWsh); err != nil {
		t.Fatalf("installOpencodePlugin error: %v", err)
	}
	path := filepath.Join(home, ".config", "opencode", "plugins", "waveterm-status.js")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading installed plugin: %v", err)
	}
	if strings.Contains(string(b), "__WSH_PATH__") {
		t.Fatalf("placeholder not substituted:\n%s", string(b))
	}
	if !strings.Contains(string(b), `"agent-hook"`) {
		t.Fatalf("installed plugin missing the agent-hook invocation:\n%s", string(b))
	}
	wantDeclaration := "const WSH = " + jsonString(testWsh) + ";"
	if !strings.Contains(string(b), wantDeclaration) {
		t.Fatalf("installed plugin has invalid WSH declaration, want %q:\n%s", wantDeclaration, string(b))
	}
}

func TestInstallOpencodePlugin_skipsWhenOpencodeMissing(t *testing.T) {
	origLookPath := opencodeLookPath
	opencodeLookPath = func(string) (string, error) { return "", os.ErrNotExist }
	defer func() { opencodeLookPath = origLookPath }()

	home := t.TempDir()
	if err := installOpencodePlugin(home, testWsh); err != nil {
		t.Fatalf("missing opencode must not error, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, ".config", "opencode", "plugins", "waveterm-status.js")); !os.IsNotExist(err) {
		t.Fatalf("plugin should not be written when opencode is absent")
	}
}

// fakeWshPath is the wsh executable path the pi extension tests hand the installer to embed.
func fakeWshPath(t *testing.T) string {
	t.Helper()
	return testWsh
}

func piExtensionPath(home string) string {
	return filepath.Join(home, ".pi", "agent", "extensions", "waveterm-status.ts")
}

func stubPiLookPath(t *testing.T) {
	t.Helper()
	orig := piLookPath
	piLookPath = func(string) (string, error) { return "pi", nil }
	t.Cleanup(func() { piLookPath = orig })
}

func TestInstallPiStatusExtension_writesSubstitutedExtension(t *testing.T) {
	stubPiLookPath(t)

	home := t.TempDir()
	if err := installPiStatusExtension(home, fakeWshPath(t)); err != nil {
		t.Fatalf("installPiStatusExtension error: %v", err)
	}
	path := piExtensionPath(home)
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading installed extension: %v", err)
	}
	if strings.Contains(string(body), `registerWavetermStatus(pi, "__WSH_PATH__")`) {
		t.Fatalf("placeholder not substituted in emitted call:\n%s", string(body))
	}
	if !strings.Contains(string(body), jsonString(fakeWshPath(t))) {
		t.Fatalf("installed extension missing the wsh path %s:\n%s", jsonString(fakeWshPath(t)), string(body))
	}
	if !strings.Contains(string(body), "registerWavetermStatus(pi, "+jsonString(fakeWshPath(t))+")") {
		t.Fatalf("installed extension has malformed registerWavetermStatus call:\n%s", string(body))
	}
}

func TestInstallPiStatusExtension_skipsWhenPiMissing(t *testing.T) {
	orig := piLookPath
	piLookPath = func(string) (string, error) { return "", os.ErrNotExist }
	defer func() { piLookPath = orig }()

	home := t.TempDir()
	if err := installPiStatusExtension(home, fakeWshPath(t)); err != nil {
		t.Fatalf("missing pi must not error, got %v", err)
	}
	if _, err := os.Stat(piExtensionPath(home)); !os.IsNotExist(err) {
		t.Fatalf("extension should not be written when pi is absent")
	}
}

func TestInstallPiStatusExtension_equalBytesPreserveMtime(t *testing.T) {
	stubPiLookPath(t)

	home := t.TempDir()
	if err := installPiStatusExtension(home, fakeWshPath(t)); err != nil {
		t.Fatalf("installPiStatusExtension error: %v", err)
	}
	path := piExtensionPath(home)
	info1, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat after first install: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if err := installPiStatusExtension(home, fakeWshPath(t)); err != nil {
		t.Fatalf("installPiStatusExtension error: %v", err)
	}
	info2, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat after second install: %v", err)
	}
	if !info2.ModTime().Equal(info1.ModTime()) {
		t.Fatalf("mtime changed on no-op reinstall: %v -> %v", info1.ModTime(), info2.ModTime())
	}
}

func TestInstallPiStatusExtension_rewritesChangedPath(t *testing.T) {
	stubPiLookPath(t)

	home := t.TempDir()
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("creating extension dir: %v", err)
	}
	path := filepath.Join(dir, "waveterm-status.ts")
	stale := strings.ReplaceAll(piStatusExtensionTemplate, `"__WSH_PATH__"`, jsonString(`C:\old\bin\wsh-0.14.4-windows.x64.exe`))
	if err := os.WriteFile(path, []byte(stale), 0o644); err != nil {
		t.Fatalf("seeding stale extension: %v", err)
	}

	if err := installPiStatusExtension(home, fakeWshPath(t)); err != nil {
		t.Fatalf("installPiStatusExtension error: %v", err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading rewritten extension: %v", err)
	}
	if strings.Contains(string(body), "0.14.4") {
		t.Fatalf("stale wsh path still present after reinstall:\n%s", string(body))
	}
	if !strings.Contains(string(body), jsonString(fakeWshPath(t))) {
		t.Fatalf("new wsh path not written:\n%s", string(body))
	}
}

func piMemoryExtensionPath(home string) string {
	return filepath.Join(home, ".pi", "agent", "extensions", "waveterm-memory.ts")
}

// pi auto-loads every file in its extensions dir, so an extension left behind from an older arcterm keeps
// registering tools that shell out to `wsh memory`, a subcommand that no longer exists. The install
// has to remove it, the same way a stale hook is pruned from settings.json.
func TestRemoveStalePiMemoryExtension_deletesIt(t *testing.T) {
	stubPiLookPath(t)

	home := t.TempDir()
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("creating extension dir: %v", err)
	}
	if err := os.WriteFile(piMemoryExtensionPath(home), []byte("export default () => {}"), 0o644); err != nil {
		t.Fatalf("seeding stale extension: %v", err)
	}
	if err := removeStalePiMemoryExtension(home); err != nil {
		t.Fatalf("removeStalePiMemoryExtension error: %v", err)
	}
	if _, err := os.Stat(piMemoryExtensionPath(home)); !os.IsNotExist(err) {
		t.Fatal("stale pi memory extension survived the install")
	}
}

func TestRemoveStalePiMemoryExtension_absentIsNotAnError(t *testing.T) {
	stubPiLookPath(t)
	if err := removeStalePiMemoryExtension(t.TempDir()); err != nil {
		t.Fatalf("a missing extension must not error, got %v", err)
	}
}

func TestInstallPiSimplifyGateExtension_writesBothFiles(t *testing.T) {
	stubPiLookPath(t)

	home := t.TempDir()
	if err := installPiSimplifyGateExtension(home); err != nil {
		t.Fatalf("installPiSimplifyGateExtension error: %v", err)
	}
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	for name, want := range map[string]string{
		"waveterm-simplify-gate.ts":      piSimplifyGateExtensionTemplate,
		"waveterm-simplify-gate-core.ts": piSimplifyGateCoreExtensionTemplate,
	} {
		path := filepath.Join(dir, name)
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("reading installed %s: %v", name, err)
		}
		if string(body) != want {
			t.Fatalf("%s content differs from the authored template", name)
		}
	}
}

// pi auto-loads every file in ~/.pi/agent/extensions/ and requires each to export a factory
// function. A dependency module (a *-core.ts) that omits the no-op default export loads fine as
// TS but crashes the whole extensions dir at pi boot. Guard every template that lands there.
func TestPiExtensionTemplatesExportAFactory(t *testing.T) {
	templates := map[string]string{
		"waveterm-status.ts":              piStatusExtensionTemplate,
		"waveterm-tools.ts":               piToolsExtensionTemplate,
		"waveterm-tools-core.ts":          piToolsCoreExtensionTemplate,
		"waveterm-ask.ts":                 piAskExtensionTemplate,
		"waveterm-ask-core.ts":            piAskCoreExtensionTemplate,
		"waveterm-prose-core.ts":          piProseCoreExtensionTemplate,
		"waveterm-simplify-gate.ts":       piSimplifyGateExtensionTemplate,
		"waveterm-simplify-gate-core.ts":  piSimplifyGateCoreExtensionTemplate,
	}
	for name, src := range templates {
		if !strings.Contains(src, "export default") {
			t.Errorf("%s: pi extensions must export a default factory function (add a no-op for -core dependency modules)", name)
		}
	}
}

func TestInstallPiSimplifyGateExtension_skipsWhenPiMissing(t *testing.T) {
	orig := piLookPath
	piLookPath = func(string) (string, error) { return "", os.ErrNotExist }
	defer func() { piLookPath = orig }()

	home := t.TempDir()
	if err := installPiSimplifyGateExtension(home); err != nil {
		t.Fatalf("missing pi must not error, got %v", err)
	}
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	if _, err := os.Stat(filepath.Join(dir, "waveterm-simplify-gate.ts")); !os.IsNotExist(err) {
		t.Fatalf("extension should not be written when pi is absent")
	}
}

func TestInstallPiSimplifyGateExtension_equalBytesPreserveMtime(t *testing.T) {
	stubPiLookPath(t)

	home := t.TempDir()
	if err := installPiSimplifyGateExtension(home); err != nil {
		t.Fatalf("installPiSimplifyGateExtension error: %v", err)
	}
	path := filepath.Join(home, ".pi", "agent", "extensions", "waveterm-simplify-gate.ts")
	info1, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat after first install: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if err := installPiSimplifyGateExtension(home); err != nil {
		t.Fatalf("installPiSimplifyGateExtension error: %v", err)
	}
	info2, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat after second install: %v", err)
	}
	if !info2.ModTime().Equal(info1.ModTime()) {
		t.Fatalf("mtime changed on no-op reinstall: %v -> %v", info1.ModTime(), info2.ModTime())
	}
}

func TestInstallPiTheme(t *testing.T) {
	stubPiLookPath(t)

	home := t.TempDir()
	if err := installPiTheme(home); err != nil {
		t.Fatalf("install: %v", err)
	}
	path := filepath.Join(home, ".pi", "agent", "themes", "arc.json")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("theme not written: %v", err)
	}
	var theme map[string]any
	if err := json.Unmarshal(b, &theme); err != nil {
		t.Fatalf("theme not valid json: %v", err)
	}
	if theme["name"] != "arc" {
		t.Fatalf("theme name = %v, want arc", theme["name"])
	}
	// idempotent: second run rewrites nothing and reports no error
	if err := installPiTheme(home); err != nil {
		t.Fatalf("reinstall: %v", err)
	}
}

func TestMergePiSettingsDefaults(t *testing.T) {
	home := t.TempDir()
	settingsPath := filepath.Join(home, ".pi", "agent", "settings.json")
	os.MkdirAll(filepath.Dir(settingsPath), 0o755)
	// pre-existing user config: theme already set, packages carry a user entry but not arc's,
	// defaultProvider preserved.
	os.WriteFile(settingsPath, []byte(`{"theme": "cc-dark", "packages": ["npm:pi-tasks"], "defaultProvider": "opencode-go"}`), 0o644)

	installed, skipped, err := mergePiSettingsDefaults(home)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if len(skipped) != 1 || skipped[0] != "theme" {
		t.Fatalf("skipped = %v, want [theme] (packages gets the arc entry appended)", skipped)
	}
	if len(installed) != 1 || installed[0] != "packages" {
		t.Fatalf("installed = %v, want [packages]", installed)
	}
	got, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	var s struct {
		Theme           string   `json:"theme"`
		DefaultProvider string   `json:"defaultProvider"`
		Packages        []string `json:"packages"`
	}
	if err := json.Unmarshal(got, &s); err != nil {
		t.Fatalf("parse settings: %v", err)
	}
	if s.Theme != "cc-dark" {
		t.Fatalf("theme clobbered: %v", s.Theme)
	}
	if s.DefaultProvider != "opencode-go" {
		t.Fatalf("defaultProvider clobbered: %v", s.DefaultProvider)
	}
	// user entry preserved; arc entry appended once
	if len(s.Packages) != 2 || s.Packages[0] != "npm:pi-tasks" || s.Packages[1] != arcPackageEntry {
		t.Fatalf("packages = %v, want [npm:pi-tasks %s]", s.Packages, arcPackageEntry)
	}

	// second run is a full no-op: theme and packages are now both present
	installed2, skipped2, err := mergePiSettingsDefaults(home)
	if err != nil {
		t.Fatalf("re-merge: %v", err)
	}
	if len(installed2) != 0 {
		t.Fatalf("second run installed %v, want nothing", installed2)
	}
	if len(skipped2) != 2 {
		t.Fatalf("second run skipped = %v, want [theme packages]", skipped2)
	}
}

func TestInstallPiKeybindingsOnlyWhenAbsent(t *testing.T) {
	home := t.TempDir()
	installed, err := installPiKeybindings(home)
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !installed {
		t.Fatal("expected keybindings installed on empty home")
	}
	path := filepath.Join(home, ".pi", "agent", "keybindings.json")
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("keybindings not written: %v", err)
	}
	if !strings.Contains(string(got), "tui.altScreen.top") {
		t.Fatalf("keybindings missing alt-screen entry: %s", got)
	}
	// existing user file is never overwritten
	userFile := `{"tui.editor.historyPrevious": "ctrl+up"}`
	os.WriteFile(path, []byte(userFile), 0o644)
	installed, err = installPiKeybindings(home)
	if err != nil {
		t.Fatalf("second install: %v", err)
	}
	if installed {
		t.Fatal("keybindings rewritten over existing user file")
	}
	got, _ = os.ReadFile(path)
	if string(got) != userFile {
		t.Fatalf("user keybindings clobbered: %s", got)
	}
}

// The memory subcommands are gone, but a settings.json written by an older arcterm still names them. Each
// removed form has to stay recognized as arcterm's, or the hook it wrote is never identified and so never
// pruned — it would keep firing a subcommand wsh no longer has.
func TestRemovedMemoryHooksAreStillRecognized(t *testing.T) {
	for _, mh := range managedHooks {
		if strings.HasPrefix(mh.Args, "agent-memory-") {
			t.Fatalf("memory hook still registered: %+v", mh)
		}
	}
	for _, c := range []string{
		`"C:\bin\wsh-0.14.5-windows.x64.exe" agent-memory-hook`,
		`"C:\bin\wsh-0.14.5-windows.x64.exe" agent-memory-project`,
		`"C:\bin\wsh-0.14.5-windows.x64.exe" agent-memory-project --inject`,
	} {
		if !isManagedCommand(c) {
			t.Fatalf("%q not recognized as arcterm-managed; the stale hook would survive every reinstall", c)
		}
	}
}

// SessionEnd left managedHooks entirely when agent-memory-hook was removed, so a merge that only
// walked the events arcterm manages now would never revisit the stale group sitting under it.
func TestMergePrunesHooksUnderNoLongerManagedEvents(t *testing.T) {
	existing := map[string]any{
		"hooks": map[string]any{
			"SessionEnd": []any{
				map[string]any{
					"hooks": []any{
						map[string]any{"type": "command", "command": `"C:\old\wsh.exe" agent-memory-hook`},
					},
				},
			},
		},
	}
	if configIsHealthy(existing, testWsh, []string{testModDir}, false) {
		t.Fatal("a config carrying a stale managed hook must not be reported healthy, or it is never rewritten")
	}
	merged := mergeAgentHooks(existing, testWsh)
	hooks, _ := merged["hooks"].(map[string]any)
	if _, present := hooks["SessionEnd"]; present {
		t.Fatalf("stale SessionEnd group survived the merge: %v", hooks["SessionEnd"])
	}
	if n := countManaged(t, merged); n != len(managedHooks) {
		t.Fatalf("managed entries = %d, want %d", n, len(managedHooks))
	}
}

// An unrelated hook under an event arcterm does not manage must survive the wider scan untouched.
func TestMergeKeepsForeignHooksUnderUnmanagedEvents(t *testing.T) {
	foreign := map[string]any{
		"hooks": []any{map[string]any{"type": "command", "command": "node /x/notify.js"}},
	}
	existing := map[string]any{"hooks": map[string]any{"SessionEnd": []any{foreign}}}
	merged := mergeAgentHooks(existing, testWsh)
	hooks, _ := merged["hooks"].(map[string]any)
	groups, _ := hooks["SessionEnd"].([]any)
	if len(groups) != 1 {
		t.Fatalf("SessionEnd groups = %d, want the one foreign hook kept", len(groups))
	}
}

func TestCompactionHooksAreManaged(t *testing.T) {
	for _, want := range []managedHook{
		{Event: "PreCompact", Args: "agent-hook", Timeout: 10},
		{Event: "SessionStart", Matcher: "compact", Args: "agent-hook", Timeout: 10},
		{Event: "SessionStart", Matcher: "compact", Args: "jarvis dag rules --inject", Timeout: 15},
		{Event: "SessionStart", Matcher: "clear", Args: "agent-hook", Timeout: 10},
		{Event: "SessionStart", Matcher: "resume", Args: "agent-hook", Timeout: 10},
	} {
		found := false
		for _, mh := range managedHooks {
			if mh == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("managed hooks missing %+v", want)
		}
	}
	// a command wsh does not recognize is never replaced, so every re-run would add another copy
	if !isManagedCommand(`"C:\bin\wsh-0.14.10-windows.x64.exe" jarvis dag rules --inject`) {
		t.Fatal("the rules hook command is not recognized as arcterm-managed")
	}
	merged := mergeAgentHooks(mergeAgentHooks(map[string]any{}, testWsh), testWsh)
	groups, _ := merged["hooks"].(map[string]any)["SessionStart"].([]any)
	if len(groups) != 4 {
		t.Fatalf("SessionStart groups after two merges = %d, want the compact idle, rules, clear and resume hooks", len(groups))
	}
}

func writeTestFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("creating %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
}

func TestSyncStableWsh_copiesThenLeavesAnIdenticalCopyAlone(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "wsh-0.14.11-windows.x64.exe")
	writeTestFile(t, src, "build 11")
	dst := stableWshPath(filepath.Join(dir, "home"))

	if err := syncStableWsh(src, dst); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 11" {
		t.Fatalf("stable copy = %q (err %v), want the source bytes", got, err)
	}
	info1, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat after first sync: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if err := syncStableWsh(src, dst); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	info2, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat after second sync: %v", err)
	}
	if !info2.ModTime().Equal(info1.ModTime()) {
		t.Fatalf("identical copy was rewritten: mtime %v -> %v", info1.ModTime(), info2.ModTime())
	}
}

// the failure this exists for: a rebuild deletes the versioned binary the hooks named
func TestSyncStableWsh_survivesARebuildDeletingTheOldBinary(t *testing.T) {
	dir := t.TempDir()
	dst := stableWshPath(filepath.Join(dir, "home"))
	oldBuild := filepath.Join(dir, "wsh-0.14.10-windows.x64.exe")
	newBuild := filepath.Join(dir, "wsh-0.14.11-windows.x64.exe")
	writeTestFile(t, oldBuild, "build 10")

	if err := syncStableWsh(oldBuild, dst); err != nil {
		t.Fatalf("sync from old build: %v", err)
	}
	if err := os.Remove(oldBuild); err != nil {
		t.Fatalf("simulating the rebuild: %v", err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 10" {
		t.Fatalf("stable copy gone after the old build was deleted: %q (err %v)", got, err)
	}

	writeTestFile(t, newBuild, "build 11")
	if err := syncStableWsh(newBuild, dst); err != nil {
		t.Fatalf("sync from new build: %v", err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 11" {
		t.Fatalf("stable copy = %q (err %v), want the new build", got, err)
	}
	for _, leftover := range []string{dst + ".tmp", dst + ".old"} {
		if _, err := os.Stat(leftover); !os.IsNotExist(err) {
			t.Fatalf("swap left %s behind", leftover)
		}
	}
}

func TestResolveHookWsh_namesTheStableCopy(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	exe := filepath.Join(dir, "wsh-0.14.11-windows.x64.exe")
	writeTestFile(t, exe, "build 11")

	if got := resolveHookWsh(exe, home); got != stableWshPath(home) {
		t.Fatalf("resolveHookWsh = %q, want the stable copy %q", got, stableWshPath(home))
	}
}

func TestResolveHookWsh_fallsBackWhenTheCopyCannotBeRefreshed(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	unreadable := filepath.Join(dir, "gone.exe")

	// no copy yet: the running binary is the only thing left to name
	if got := resolveHookWsh(unreadable, home); got != unreadable {
		t.Fatalf("with no stable copy, resolveHookWsh = %q, want the running binary %q", got, unreadable)
	}
	// an existing copy beats a failed refresh: stale but runnable
	writeTestFile(t, stableWshPath(home), "build 10")
	if got := resolveHookWsh(unreadable, home); got != stableWshPath(home) {
		t.Fatalf("with a stable copy, resolveHookWsh = %q, want %q", got, stableWshPath(home))
	}
}

const testModDir = `C:\Users\u\.arc\claude-mod`

func pluginDirsOf(t *testing.T, cfg map[string]any) []string {
	t.Helper()
	env, _ := cfg["env"].(map[string]any)
	cur, _ := env[claudePluginDirsVar].(string)
	return filepath.SplitList(cur)
}

func TestMergeClaudePluginDirs_empty(t *testing.T) {
	got := pluginDirsOf(t, mergeClaudePluginDirs(map[string]any{}, testModDir))
	if len(got) != 1 || got[0] != testModDir {
		t.Fatalf("plugin dirs = %v, want [%s]", got, testModDir)
	}
}

func TestMergeClaudePluginDirs_keepsUserEntriesAndOtherEnv(t *testing.T) {
	user := `C:\mods\a` + string(os.PathListSeparator) + `C:\mods\b`
	existing := map[string]any{"env": map[string]any{claudePluginDirsVar: user, "FOO": "bar"}}
	merged := mergeClaudePluginDirs(existing, testModDir)
	got := pluginDirsOf(t, merged)
	want := []string{`C:\mods\a`, `C:\mods\b`, testModDir}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("plugin dirs = %v, want %v", got, want)
	}
	if merged["env"].(map[string]any)["FOO"] != "bar" {
		t.Fatal("unrelated env var not preserved")
	}
	if existing["env"].(map[string]any)[claudePluginDirsVar] != user {
		t.Fatal("caller's map was mutated")
	}
}

func TestMergeClaudePluginDirs_idempotentAndNeverDuplicated(t *testing.T) {
	sep := string(os.PathListSeparator)
	existing := map[string]any{"env": map[string]any{claudePluginDirsVar: testModDir + sep + `C:\mods\a`}}
	once := mergeClaudePluginDirs(existing, testModDir)
	twice := mergeClaudePluginDirs(once, testModDir)
	got := pluginDirsOf(t, twice)
	want := []string{`C:\mods\a`, testModDir}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("plugin dirs = %v, want %v", got, want)
	}
}

func TestConfigIsHealthy_requiresThePluginDirsEntry(t *testing.T) {
	withoutDirs := mergeStatusLine(mergeAgentHooks(map[string]any{}, testWsh), testWsh)
	if configIsHealthy(withoutDirs, testWsh, []string{testModDir}, false) {
		t.Fatal("a config without the mod's plugin dir must not be healthy, or an upgrade never writes it")
	}
	if !configIsHealthy(mergeClaudePluginDirs(withoutDirs, testModDir), testWsh, []string{testModDir}, false) {
		t.Fatal("a config with hooks, statusLine and plugin dir should be healthy")
	}
}

func TestInstallClaudeMod_writesTheModWithTheWshPath(t *testing.T) {
	home := t.TempDir()
	if err := installClaudeMod(home, fakeWshPath(t)); err != nil {
		t.Fatalf("installClaudeMod: %v", err)
	}
	dir := claudeModDirs(home)[0]
	for _, rel := range []string{".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/register.ts", "hooks/usage-core.ts"} {
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(rel))); err != nil {
			t.Fatalf("%s not installed: %v", rel, err)
		}
	}
	body, err := os.ReadFile(filepath.Join(dir, "hooks", "register.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "__WSH_PATH__") {
		t.Fatalf("placeholder not substituted:\n%s", body)
	}
	if !strings.Contains(string(body), "const WSH = "+jsonString(fakeWshPath(t))+";") {
		t.Fatalf("register.ts does not name the wsh path %s:\n%s", jsonString(fakeWshPath(t)), body)
	}
	viewDir := claudeModDirs(home)[1]
	for _, rel := range []string{".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/register.ts", "hooks/wake-core.ts", "hooks/wake-row.tsx"} {
		if _, err := os.Stat(filepath.Join(viewDir, filepath.FromSlash(rel))); err != nil {
			t.Fatalf("view mod's %s not installed: %v", rel, err)
		}
	}
	for _, d := range []string{dir, viewDir} {
		_ = filepath.WalkDir(d, func(p string, d os.DirEntry, err error) error {
			if err == nil && strings.HasSuffix(p, ".test.ts") {
				t.Fatalf("a test file was installed: %s", p)
			}
			return nil
		})
	}
}

func TestConfigIsHealthy_requiresEveryModsPluginDir(t *testing.T) {
	viewDir := `C:\Users\u\.arc\claude-view-mod`
	base := mergeStatusLine(mergeAgentHooks(map[string]any{}, testWsh), testWsh)
	both := []string{testModDir, viewDir}
	if configIsHealthy(mergeClaudePluginDirs(base, testModDir), testWsh, both, false) {
		t.Fatal("a config listing one of two mods must not be healthy, or an upgrade never adds the second")
	}
	merged := mergeClaudePluginDirs(mergeClaudePluginDirs(base, testModDir), both...)
	if !configIsHealthy(merged, testWsh, both, false) {
		t.Fatal("a config listing both mods should be healthy")
	}
	if got := pluginDirsOf(t, merged); strings.Join(got, "|") != strings.Join(both, "|") {
		t.Fatalf("plugin dirs = %v, want %v", got, both)
	}
}

func TestInstallClaudeMod_equalBytesPreserveMtime(t *testing.T) {
	home := t.TempDir()
	if err := installClaudeMod(home, fakeWshPath(t)); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(claudeModDirs(home)[0], "hooks", "register.ts")
	info1, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	if err := installClaudeMod(home, fakeWshPath(t)); err != nil {
		t.Fatal(err)
	}
	info2, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !info2.ModTime().Equal(info1.ModTime()) {
		t.Fatalf("an unchanged mod was rewritten (reloads every running claude session): %v -> %v", info1.ModTime(), info2.ModTime())
	}
}

func stubClaudeVersion(t *testing.T, out string, err error) {
	t.Helper()
	orig := claudeVersionOutput
	claudeVersionOutput = func() (string, error) { return out, err }
	t.Cleanup(func() { claudeVersionOutput = orig })
}

func TestParseClaudeVersion(t *testing.T) {
	if v, ok := parseClaudeVersion("2.1.287 (Claude Code)\n"); !ok || v != [3]int{2, 1, 287} {
		t.Fatalf("got %v %v", v, ok)
	}
	if _, ok := parseClaudeVersion("command not found"); ok {
		t.Fatal("garbage parsed as a version")
	}
}

func TestClaudeSupportsMods(t *testing.T) {
	cases := []struct {
		out  string
		err  error
		want bool
	}{
		{"2.1.287 (Claude Code)", nil, true},
		{"2.1.286 (Claude Code)", nil, false},
		{"2.2.0 (Claude Code)", nil, true},
		{"10.0.0 (Claude Code)", nil, true},
		{"", os.ErrNotExist, false},
		{"weird", nil, false},
	}
	for _, c := range cases {
		stubClaudeVersion(t, c.out, c.err)
		if got := claudeSupportsMods(); got != c.want {
			t.Errorf("claudeSupportsMods(%q, %v) = %v, want %v", c.out, c.err, got, c.want)
		}
	}
}

func TestUnwrapStatusLine(t *testing.T) {
	wrapped := mergeStatusLine(map[string]any{"statusLine": map[string]any{"type": "command", "command": `bash /x/sl.sh`, "padding": 1.0}}, testWsh)
	sl := unwrapStatusLine(wrapped)["statusLine"].(map[string]any)
	if sl["command"] != `bash /x/sl.sh` || sl["padding"] != 1.0 || sl["type"] != "command" {
		t.Fatalf("original statusLine not restored: %v", sl)
	}

	arcOnly := mergeStatusLine(map[string]any{}, testWsh)
	if _, present := unwrapStatusLine(arcOnly)["statusLine"]; present {
		t.Fatal("a statusLine arcterm added with no original command should be removed")
	}

	user := map[string]any{"statusLine": map[string]any{"type": "command", "command": `bash /mine.sh`}}
	if unwrapStatusLine(user)["statusLine"].(map[string]any)["command"] != `bash /mine.sh` {
		t.Fatal("a statusLine arcterm does not manage must be left alone")
	}
	if _, present := unwrapStatusLine(map[string]any{})["statusLine"]; present {
		t.Fatal("unwrap invented a statusLine")
	}
}

func TestConfigIsHealthy_modsSupportedWantsNoWrapper(t *testing.T) {
	hooks := mergeClaudePluginDirs(mergeAgentHooks(map[string]any{}, testWsh), testModDir)
	wrapped := mergeStatusLine(hooks, testWsh)
	if configIsHealthy(wrapped, testWsh, []string{testModDir}, true) {
		t.Fatal("a wrapped statusLine must not be healthy once mods are supported, or it is never unwrapped")
	}
	if !configIsHealthy(unwrapStatusLine(wrapped), testWsh, []string{testModDir}, true) {
		t.Fatal("an unwrapped config should be healthy when mods are supported")
	}
	if configIsHealthy(unwrapStatusLine(wrapped), testWsh, []string{testModDir}, false) {
		t.Fatal("without mod support the wrapper is required")
	}
}

// managedHookEntries returns the hook maps arcterm wrote under one event, keyed by "<matcher>|<args>".
func managedHookEntries(t *testing.T, cfg map[string]any, event string) map[string]map[string]any {
	t.Helper()
	out := map[string]map[string]any{}
	groups, _ := cfg["hooks"].(map[string]any)[event].([]any)
	for _, g := range groups {
		gm, _ := g.(map[string]any)
		matcher, _ := gm["matcher"].(string)
		hs, _ := gm["hooks"].([]any)
		for _, h := range hs {
			hm, _ := h.(map[string]any)
			c, _ := hm["command"].(string)
			if !isManagedCommand(c) {
				continue
			}
			_, args := splitFirstToken(c)
			out[matcher+"|"+args] = hm
		}
	}
	return out
}

func TestPerToolReportsRunInTheBackground(t *testing.T) {
	cfg := mergeAgentHooks(map[string]any{}, testWsh)
	for _, tc := range []struct {
		event, key string
		async      bool
	}{
		{"PreToolUse", "|agent-hook", true},
		{"PostToolUse", "|agent-hook", true},
		// the ask hooks answer claude, and a headless claude kills a background Stop at teardown
		{"PreToolUse", "AskUserQuestion|ask", false},
		{"PostToolUse", "AskUserQuestion|ask --clear", false},
		{"Stop", "|agent-hook", false},
		{"UserPromptSubmit", "|agent-hook", false},
	} {
		hm, ok := managedHookEntries(t, cfg, tc.event)[tc.key]
		if !ok {
			t.Fatalf("%s %q is not installed", tc.event, tc.key)
		}
		if async, _ := hm["async"].(bool); async != tc.async {
			t.Errorf("%s %q async = %v, want %v", tc.event, tc.key, async, tc.async)
		}
	}
}

func TestConfigIsHealthy_rewritesAHookWrittenBeforeItRanInTheBackground(t *testing.T) {
	full := mergeClaudePluginDirs(mergeStatusLine(mergeAgentHooks(map[string]any{}, testWsh), testWsh), testModDir)
	delete(managedHookEntries(t, full, "PostToolUse")["|agent-hook"], "async")
	if configIsHealthy(full, testWsh, []string{testModDir}, false) {
		t.Fatal("a blocking per-tool hook from an older install should NOT be healthy")
	}
	if !configIsHealthy(mergeAgentHooks(full, testWsh), testWsh, []string{testModDir}, false) {
		t.Fatal("a reinstall should leave the config healthy")
	}
}
