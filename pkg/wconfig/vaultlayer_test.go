// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// setupLayers points the config home at a temp dir whose settings.json names a temp vault, plus the given
// extra local keys. The vault dir is not created: the first vault-layer write must create it.
func setupLayers(t *testing.T, local map[string]any) (configDir string, vaultDir string) {
	t.Helper()
	configDir = t.TempDir()
	vaultDir = filepath.Join(t.TempDir(), "vault")
	m := map[string]any{ConfigKey_MemoryVaultPath: vaultDir}
	for k, v := range local {
		m[k] = v
	}
	writeJSONFile(t, filepath.Join(configDir, SettingsFile), m)
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = configDir
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })
	return configDir, vaultDir
}

func writeJSONFile(t *testing.T, path string, m map[string]any) {
	t.Helper()
	barr, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal %s: %v", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, barr, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// readJSONFile returns nil when the file does not exist.
func readJSONFile(t *testing.T, path string) map[string]any {
	t.Helper()
	barr, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var m map[string]any
	if err := json.Unmarshal(barr, &m); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return m
}

func vaultSettingsIn(vaultDir string) string {
	return filepath.Join(vaultDir, VaultConfigDir, SettingsFile)
}

// countVaultWrites installs an OnVaultLayerWrite hook for the test and returns its call counter.
func countVaultWrites(t *testing.T) *int {
	t.Helper()
	calls := 0
	prev := OnVaultLayerWrite
	OnVaultLayerWrite = func() { calls++ }
	t.Cleanup(func() { OnVaultLayerWrite = prev })
	return &calls
}

func TestSettingsLayerOrder(t *testing.T) {
	_, vaultDir := setupLayers(t, map[string]any{ConfigKey_TermFontSize: 15})
	writeJSONFile(t, vaultSettingsIn(vaultDir), map[string]any{
		ConfigKey_TermFontSize:   14,
		ConfigKey_EditorFontSize: 13,
	})

	full := ReadFullConfig()
	if full.Settings.TermFontSize != 15 {
		t.Errorf("term:fontsize = %v, want the local 15 over the vault's 14", full.Settings.TermFontSize)
	}
	if full.Settings.EditorFontSize != 13 {
		t.Errorf("editor:fontsize = %v, want the vault's 13 over the default", full.Settings.EditorFontSize)
	}
	if full.Settings.TermFontFamily != `"JetBrains Mono", monospace` {
		t.Errorf("term:fontfamily = %q, want the shipped default", full.Settings.TermFontFamily)
	}
	if full.DefaultSettings.TermFontSize != 14 {
		t.Errorf("DefaultSettings.TermFontSize = %v, want the shipped 14", full.DefaultSettings.TermFontSize)
	}
}

func TestVaultLayerIgnoresMachineLocalKeys(t *testing.T) {
	for _, key := range []string{
		ConfigKey_MemoryVaultPath, ConfigKey_JarvisVaultPath, ConfigKey_TermGitBashPath,
		ConfigKey_TermLocalShellPath, ConfigKey_TermLocalShellOpts, ConfigKey_ClaudeActiveAccount,
	} {
		if !IsMachineLocalKey(key) {
			t.Errorf("IsMachineLocalKey(%q) = false, want true", key)
		}
	}
	if IsMachineLocalKey(ConfigKey_TermFontSize) {
		t.Errorf("IsMachineLocalKey(%q) = true, want false", ConfigKey_TermFontSize)
	}

	_, vaultDir := setupLayers(t, nil)
	writeJSONFile(t, vaultSettingsIn(vaultDir), map[string]any{
		ConfigKey_TermGitBashPath:    `D:\other-machine\bash.exe`,
		ConfigKey_TermLocalShellPath: "/other/shell",
		ConfigKey_TermLocalShellOpts: []any{"-l"},
	})
	s := ReadFullConfig().Settings
	if s.TermGitBashPath != "" || s.TermLocalShellPath != "" || len(s.TermLocalShellOpts) != 0 {
		t.Fatalf("machine-local keys leaked from the vault layer: gitbash=%q shell=%q opts=%v",
			s.TermGitBashPath, s.TermLocalShellPath, s.TermLocalShellOpts)
	}
}

func TestSetBaseConfigValueRoutesMachineLocalToLocal(t *testing.T) {
	configDir, vaultDir := setupLayers(t, nil)
	calls := countVaultWrites(t)

	if err := SetBaseConfigValue(waveobj.MetaMapType{ConfigKey_TermGitBashPath: `C:\git\bin\bash.exe`}); err != nil {
		t.Fatalf("set: %v", err)
	}
	local := readJSONFile(t, filepath.Join(configDir, SettingsFile))
	if local[ConfigKey_TermGitBashPath] != `C:\git\bin\bash.exe` {
		t.Errorf("local file = %v, want the machine-local key", local)
	}
	if vault := readJSONFile(t, vaultSettingsIn(vaultDir)); vault != nil {
		t.Errorf("vault layer written for a machine-local key: %v", vault)
	}
	if *calls != 0 {
		t.Errorf("OnVaultLayerWrite called %d times, want 0", *calls)
	}
}

func TestSetBaseConfigValueRoutesLocallyDefinedKeyToLocal(t *testing.T) {
	configDir, vaultDir := setupLayers(t, map[string]any{ConfigKey_TermFontSize: 15})

	if err := SetBaseConfigValue(waveobj.MetaMapType{ConfigKey_TermFontSize: float64(17)}); err != nil {
		t.Fatalf("set: %v", err)
	}
	local := readJSONFile(t, filepath.Join(configDir, SettingsFile))
	if local[ConfigKey_TermFontSize] != float64(17) {
		t.Errorf("local term:fontsize = %v, want 17", local[ConfigKey_TermFontSize])
	}
	if vault := readJSONFile(t, vaultSettingsIn(vaultDir)); vault != nil {
		t.Errorf("vault layer written for a locally defined key: %v", vault)
	}
}

func TestSetBaseConfigValueRoutesOtherKeysToVault(t *testing.T) {
	configDir, vaultDir := setupLayers(t, nil)
	calls := countVaultWrites(t)

	if err := SetBaseConfigValue(waveobj.MetaMapType{
		ConfigKey_EditorFontSize:  float64(13),
		ConfigKey_TermCursorBlink: false,
	}); err != nil {
		t.Fatalf("set: %v", err)
	}
	vault := readJSONFile(t, vaultSettingsIn(vaultDir))
	if vault[ConfigKey_EditorFontSize] != float64(13) || vault[ConfigKey_TermCursorBlink] != false {
		t.Errorf("vault layer = %v, want both portable keys", vault)
	}
	local := readJSONFile(t, filepath.Join(configDir, SettingsFile))
	if _, ok := local[ConfigKey_EditorFontSize]; ok {
		t.Errorf("portable key also written to the local file: %v", local)
	}
	if *calls != 1 {
		t.Errorf("OnVaultLayerWrite called %d times, want 1", *calls)
	}
	if got := ReadFullConfig().Settings.EditorFontSize; got != 13 {
		t.Errorf("read back editor:fontsize = %v, want 13", got)
	}
}

func TestSetBaseConfigValueDeleteFromEitherFile(t *testing.T) {
	configDir, vaultDir := setupLayers(t, map[string]any{ConfigKey_TermFontSize: 15})
	writeJSONFile(t, vaultSettingsIn(vaultDir), map[string]any{
		ConfigKey_EditorFontSize: 13,
		ConfigKey_EditorWordWrap: true,
	})
	calls := countVaultWrites(t)

	if err := SetBaseConfigValue(waveobj.MetaMapType{
		ConfigKey_TermFontSize:   nil,
		ConfigKey_EditorFontSize: nil,
	}); err != nil {
		t.Fatalf("set: %v", err)
	}
	local := readJSONFile(t, filepath.Join(configDir, SettingsFile))
	if _, ok := local[ConfigKey_TermFontSize]; ok {
		t.Errorf("local key not deleted: %v", local)
	}
	vault := readJSONFile(t, vaultSettingsIn(vaultDir))
	if _, ok := vault[ConfigKey_EditorFontSize]; ok {
		t.Errorf("vault key not deleted: %v", vault)
	}
	if vault[ConfigKey_EditorWordWrap] != true {
		t.Errorf("unrelated vault key lost: %v", vault)
	}
	if *calls != 1 {
		t.Errorf("OnVaultLayerWrite called %d times, want 1", *calls)
	}
}

func TestMigrateSettingsToVault(t *testing.T) {
	configDir, vaultDir := setupLayers(t, map[string]any{
		ConfigKey_TermGitBashPath: `C:\git\bin\bash.exe`,
		ConfigKey_TermFontSize:    15,
		ConfigKey_EditorFontSize:  11,
	})
	writeJSONFile(t, vaultSettingsIn(vaultDir), map[string]any{ConfigKey_EditorFontSize: 13})
	calls := countVaultWrites(t)

	if err := MigrateSettingsToVault(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	localPath := filepath.Join(configDir, SettingsFile)
	local := readJSONFile(t, localPath)
	want := map[string]any{ConfigKey_MemoryVaultPath: vaultDir, ConfigKey_TermGitBashPath: `C:\git\bin\bash.exe`}
	if len(local) != len(want) || local[ConfigKey_MemoryVaultPath] != want[ConfigKey_MemoryVaultPath] ||
		local[ConfigKey_TermGitBashPath] != want[ConfigKey_TermGitBashPath] {
		t.Errorf("local after migration = %v, want only the machine-local keys %v", local, want)
	}
	vault := readJSONFile(t, vaultSettingsIn(vaultDir))
	if vault[ConfigKey_TermFontSize] != float64(15) {
		t.Errorf("vault term:fontsize = %v, want the moved 15", vault[ConfigKey_TermFontSize])
	}
	if vault[ConfigKey_EditorFontSize] != float64(13) {
		t.Errorf("vault editor:fontsize = %v, want the vault's own 13 to win the clash", vault[ConfigKey_EditorFontSize])
	}
	if _, ok := vault[ConfigKey_TermGitBashPath]; ok {
		t.Errorf("machine-local key moved into the vault: %v", vault)
	}
	if *calls != 1 {
		t.Errorf("OnVaultLayerWrite called %d times, want 1", *calls)
	}

	// once: a portable key hand-added to the local file afterwards is a deliberate local override
	writeJSONFile(t, localPath, map[string]any{
		ConfigKey_MemoryVaultPath: vaultDir,
		ConfigKey_TermFontSize:    20,
	})
	vaultBefore, _ := os.ReadFile(vaultSettingsIn(vaultDir))
	if err := MigrateSettingsToVault(); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	vaultAfter, _ := os.ReadFile(vaultSettingsIn(vaultDir))
	if string(vaultBefore) != string(vaultAfter) {
		t.Errorf("second run rewrote the vault layer:\n%s\n->\n%s", vaultBefore, vaultAfter)
	}
	if got := readJSONFile(t, localPath)[ConfigKey_TermFontSize]; got != float64(20) {
		t.Errorf("second run moved the local override: term:fontsize = %v, want 20", got)
	}
	if *calls != 1 {
		t.Errorf("second run called OnVaultLayerWrite (total %d), want no-op", *calls)
	}
}

func TestVaultRootIgnoresVaultLayer(t *testing.T) {
	_, vaultDir := setupLayers(t, nil)
	writeJSONFile(t, vaultSettingsIn(vaultDir), map[string]any{
		ConfigKey_MemoryVaultPath: filepath.Join(t.TempDir(), "elsewhere"),
	})
	if got := VaultRoot(); got != filepath.Clean(vaultDir) {
		t.Errorf("VaultRoot() = %q, want the local %q", got, vaultDir)
	}
	if got := VaultSettingsPath(); got != vaultSettingsIn(filepath.Clean(vaultDir)) {
		t.Errorf("VaultSettingsPath() = %q", got)
	}
	if got := ReadFullConfig().Settings.MemoryVaultPath; got != vaultDir {
		t.Errorf("Settings.MemoryVaultPath = %q, want the local %q", got, vaultDir)
	}
}

func TestVaultRootFallbacks(t *testing.T) {
	configDir := t.TempDir()
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = configDir
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })
	home := wavebase.GetHomeDir()

	if got, want := VaultRoot(), filepath.Join(home, ".waveterm", "vault"); got != want {
		t.Errorf("no setting: VaultRoot() = %q, want %q", got, want)
	}
	writeJSONFile(t, filepath.Join(configDir, SettingsFile), map[string]any{ConfigKey_JarvisVaultPath: "~/jv"})
	if got, want := VaultRoot(), filepath.Join(home, "jv"); got != want {
		t.Errorf("jarvis fallback: VaultRoot() = %q, want %q", got, want)
	}
	writeJSONFile(t, filepath.Join(configDir, SettingsFile), map[string]any{
		ConfigKey_JarvisVaultPath: "~/jv",
		ConfigKey_MemoryVaultPath: "~/mv",
	})
	if got, want := VaultRoot(), filepath.Join(home, "mv"); got != want {
		t.Errorf("memory wins: VaultRoot() = %q, want %q", got, want)
	}
}

func TestWatcherRetargetsOnVaultPathChange(t *testing.T) {
	configDir, vaultA := setupLayers(t, nil)
	w, err := newWatcher(fsnotify.NewWatcher)
	if err != nil {
		t.Fatalf("newWatcher: %v", err)
	}
	t.Cleanup(w.Close)
	dirA := filepath.Join(vaultA, VaultConfigDir)
	if !slices.Contains(w.watcher.WatchList(), dirA) {
		t.Fatalf("watch list %v lacks the vault config dir %q", w.watcher.WatchList(), dirA)
	}

	vaultB := filepath.Join(t.TempDir(), "vault-b")
	writeJSONFile(t, filepath.Join(configDir, SettingsFile), map[string]any{ConfigKey_MemoryVaultPath: vaultB})
	w.handleSettingsFileEvent(fsnotify.Event{}, "")

	dirB := filepath.Join(vaultB, VaultConfigDir)
	list := w.watcher.WatchList()
	if !slices.Contains(list, dirB) {
		t.Errorf("watch list %v lacks the new vault config dir %q", list, dirB)
	}
	if slices.Contains(list, dirA) {
		t.Errorf("watch list %v still holds the old vault config dir %q", list, dirA)
	}
	if !slices.Contains(list, configDir) {
		t.Errorf("watch list %v lost the config dir %q", list, configDir)
	}
}
