// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig/defaultconfig"
)

// VaultConfigDir is the vault directory holding the synced config files (the settings layer, the Jarvis
// profile). It is not a scanned collection.
const VaultConfigDir = "config"

const settingsPart = "settings"

// defaultVaultSubpath is the vault root under the home dir when no setting names one.
const defaultVaultSubpath = ".waveterm/vault"

// settingsMigratedMarker records in the config dir that MigrateSettingsToVault ran. Without it, a portable
// key later hand-added to the local file (a deliberate per-machine override) would be swept into the vault
// on the next start.
const settingsMigratedMarker = ".settings-vault-migrated"

// machineLocalKeys only make sense on the machine that set them (paths into its own filesystem), so they
// are never written to the vault layer and are ignored if found there.
var machineLocalKeys = map[string]bool{
	ConfigKey_MemoryVaultPath:    true,
	ConfigKey_JarvisVaultPath:    true,
	ConfigKey_TermGitBashPath:    true,
	ConfigKey_TermLocalShellPath: true,
	ConfigKey_TermLocalShellOpts: true,
	// the token it names lives only in this machine's secretstore
	ConfigKey_ClaudeActiveAccount: true,
}

func IsMachineLocalKey(key string) bool {
	return machineLocalKeys[key]
}

// OnVaultLayerWrite runs after every successful vault-layer write so the vault sync loop can push it.
// wconfig cannot import wavevault, so the server sets this at startup.
var OnVaultLayerWrite func()

func notifyVaultLayerWrite() {
	if OnVaultLayerWrite != nil {
		OnVaultLayerWrite()
	}
}

// VaultRoot resolves the Wave Vault root. memory:vaultpath is the setting Settings > Memory edits;
// jarvis:vaultpath remains as a legacy fallback; otherwise ~/.waveterm/vault. Read from disk on each call
// so it holds before the config watcher starts.
func VaultRoot() string {
	defaults, local, _ := readSettingsBase()
	return resolveVaultRoot(defaults, local)
}

func VaultSettingsPath() string {
	return vaultSettingsPathIn(VaultRoot())
}

func vaultSettingsPathIn(vaultRoot string) string {
	return filepath.Join(vaultRoot, VaultConfigDir, SettingsFile)
}

func readSettingsBase() (defaults waveobj.MetaMapType, local waveobj.MetaMapType, cerrs []ConfigError) {
	defaults, cerrs = readConfigPartForFS(defaultconfig.ConfigFS, "defaults:", settingsPart, false)
	local, localErrs := readConfigPartForFS(os.DirFS(wavebase.GetWaveConfigDir()), "", settingsPart, false)
	return defaults, local, append(cerrs, localErrs...)
}

// resolveVaultRoot never consults the vault layer, which the vault path itself locates. That is exact, not
// an approximation: both vault-path keys are machine-local, so the vault layer can never set them.
func resolveVaultRoot(defaults, local waveobj.MetaMapType) string {
	merged := waveobj.MergeMeta(defaults, local, true)
	if p := merged.GetString(ConfigKey_MemoryVaultPath, ""); p != "" {
		return wavebase.ExpandHomeDirSafe(p)
	}
	if p := merged.GetString(ConfigKey_JarvisVaultPath, ""); p != "" {
		return wavebase.ExpandHomeDirSafe(p)
	}
	return filepath.Join(wavebase.GetHomeDir(), defaultVaultSubpath)
}

// readSettingsPart merges defaults -> vault layer -> local settings, local winning.
func readSettingsPart() (waveobj.MetaMapType, []ConfigError) {
	defaults, local, cerrs := readSettingsBase()
	vaultPath := vaultSettingsPathIn(resolveVaultRoot(defaults, local))
	barr, readErr := os.ReadFile(vaultPath)
	vault, vaultErrs := readConfigHelper(vaultPath, barr, readErr)
	for key := range machineLocalKeys {
		delete(vault, key)
	}
	merged := waveobj.MergeMeta(waveobj.MergeMeta(defaults, vault, true), local, true)
	return merged, append(cerrs, vaultErrs...)
}

// readSettingsFileRaw reads a settings file for a read-modify-write. $ENV: references stay unresolved: a
// resolved value written back would bake the variable's value into the file, and into the git remote for
// the vault layer.
func readSettingsFileRaw(path string) (waveobj.MetaMapType, error) {
	barr, readErr := os.ReadFile(path)
	m, cerrs := parseConfigHelper(path, barr, readErr)
	if len(cerrs) > 0 {
		return nil, fmt.Errorf("error reading config file: %v", cerrs[0])
	}
	if m == nil {
		m = make(waveobj.MetaMapType)
	}
	return m, nil
}

func localSettingsPath() string {
	return filepath.Join(wavebase.GetWaveConfigDir(), SettingsFile)
}

// writeVaultLayerLocked assumes configWriteLock is held.
func writeVaultLayerLocked(path string, m waveobj.MetaMapType) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating vault config dir: %w", err)
	}
	barr, err := jsonMarshalConfigInOrder(m)
	if err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(path, barr, 0644)
}

// MigrateSettingsToVault moves the local settings that are not machine-local into the vault layer, once per
// config dir. A key both files define keeps the vault-layer value.
func MigrateSettingsToVault() error {
	moved, err := migrateSettingsToVaultLocked()
	if moved {
		notifyVaultLayerWrite()
	}
	return err
}

func migrateSettingsToVaultLocked() (bool, error) {
	configWriteLock.Lock()
	defer configWriteLock.Unlock()
	marker := filepath.Join(wavebase.GetWaveConfigDir(), settingsMigratedMarker)
	if _, err := os.Stat(marker); err == nil {
		return false, nil
	}
	local, err := readSettingsFileRaw(localSettingsPath())
	if err != nil {
		return false, err
	}
	vaultPath := VaultSettingsPath()
	vault, err := readSettingsFileRaw(vaultPath)
	if err != nil {
		return false, err
	}
	moved := 0
	for key, val := range local {
		if IsMachineLocalKey(key) {
			continue
		}
		if _, clash := vault[key]; !clash {
			vault[key] = val
		}
		delete(local, key)
		moved++
	}
	if moved > 0 {
		// vault first: a failure between the two writes leaves a key in both files, never in neither
		if err := writeVaultLayerLocked(vaultPath, vault); err != nil {
			return false, err
		}
		if err := writeWaveHomeConfigFileLocked(SettingsFile, local); err != nil {
			return true, err
		}
		log.Printf("wconfig: moved %d portable setting(s) into the vault layer %s", moved, vaultPath)
	}
	if err := os.WriteFile(marker, nil, 0644); err != nil {
		return moved > 0, fmt.Errorf("recording settings migration: %w", err)
	}
	return moved > 0, nil
}
