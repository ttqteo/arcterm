// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runroute

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ModelEntry is one selectable model for a runtime, sourced from the harness itself: enumerated
// (pi, opencode, agy), derived from the harness's own surface (claude --help aliases, codex config), or
// free-form (accepted everywhere, never listed here). Never a maintained static catalog.
type ModelEntry struct {
	Runtime     string
	Model       string // exact id handed to the harness; pi/opencode include the provider prefix
	Provider    string // pi: provider column; opencode: id prefix; else ""
	ContextHint string // pi: context column; else ""
	Default     bool   // the harness's own configured default (claude settings.json / codex config.toml)
}

// catalogCommand is the exec seam; tests replace it to feed fixtures and count calls.
var catalogCommand = func(ctx context.Context, bin string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, bin, args...).CombinedOutput()
}

const catalogProbeTimeout = 15 * time.Second

var (
	modelLineRe      = regexp.MustCompile(`^([a-zA-Z0-9_-]+)/(.+)$`)
	piContextRe      = regexp.MustCompile(`^[0-9][0-9.]*[KMB]?$`)
	claudeAliasOutRe = regexp.MustCompile(`'([a-zA-Z0-9]+)'`)
)

func enumerateCatalog(ctx context.Context, runtime string) ([]ModelEntry, error) {
	var entries []ModelEntry
	var err error
	switch runtime {
	case "pi":
		entries, err = enumeratePi(ctx)
	case "opencode":
		entries, err = enumerateOpenCode(ctx)
	case "agy":
		entries, err = enumerateAgy(ctx)
	case "claude":
		entries, err = enumerateClaude(ctx)
	case "codex":
		entries, err = enumerateCodex(ctx)
	default:
		return nil, fmt.Errorf("no catalog source for runtime %q", runtime)
	}
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("%s exposed no parseable models", runtime)
	}
	return entries, nil
}

// enumeratePi parses `pi --list-models`. Unparseable output yields zero entries with a nil error:
// garbage degrades to free-form-only rather than failing the whole catalog.
func enumeratePi(ctx context.Context) ([]ModelEntry, error) {
	out, err := catalogCommand(ctx, "pi", "--list-models")
	if err != nil {
		return nil, err
	}
	var entries []ModelEntry
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[0] == "provider" {
			continue // header, blank, or noise
		}
		if !piContextRe.MatchString(fields[2]) {
			continue // the context column anchors the table shape; anything else is not a row
		}
		entries = append(entries, ModelEntry{Runtime: "pi", Provider: fields[0], Model: fields[0] + "/" + fields[1], ContextHint: fields[2]})
	}
	return entries, nil
}

// enumerateAgy parses `agy models`: a `Fetching available models...` line, then `<slug>\t<label>` rows. Any
// line that is not a row is skipped, so garbage degrades to free-form-only like pi's.
func enumerateAgy(ctx context.Context) ([]ModelEntry, error) {
	out, err := catalogCommand(ctx, "agy", "models")
	if err != nil {
		return nil, err
	}
	var entries []ModelEntry
	for _, line := range strings.Split(string(out), "\n") {
		slug, label, ok := strings.Cut(strings.TrimRight(line, "\r"), "\t")
		if !ok || strings.TrimSpace(label) == "" || !agySlugRe.MatchString(slug) {
			continue
		}
		entries = append(entries, ModelEntry{Runtime: "agy", Model: slug})
	}
	return entries, nil
}

func enumerateOpenCode(ctx context.Context) ([]ModelEntry, error) {
	out, err := catalogCommand(ctx, "opencode", "models")
	if err != nil {
		return nil, err
	}
	var entries []ModelEntry
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		m := modelLineRe.FindStringSubmatch(line)
		if m == nil {
			continue // opencode prints provider/model ids; anything else is noise or a header
		}
		entries = append(entries, ModelEntry{Runtime: "opencode", Provider: m[1], Model: line})
	}
	return entries, nil
}

// enumerateClaude derives the alias set from `claude --help` — aliases are stable by design so this
// never rots, and full dated ids ride the free-form path instead of a shipped list.
func enumerateClaude(ctx context.Context) ([]ModelEntry, error) {
	out, err := catalogCommand(ctx, "claude", "--help")
	if err != nil {
		return nil, err
	}
	var entries []ModelEntry
	lines := strings.Split(string(out), "\n")
	for i, line := range lines {
		if !strings.Contains(line, "--model") {
			continue
		}
		joined := strings.Join(lines[i:min(i+3, len(lines))], " ")
		seen := map[string]bool{}
		for _, m := range claudeAliasOutRe.FindAllStringSubmatch(joined, -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				entries = append(entries, ModelEntry{Runtime: "claude", Model: m[1]})
			}
		}
		break
	}
	if defaultModel := claudeSettingsDefault(); defaultModel != "" {
		entries = append([]ModelEntry{{Runtime: "claude", Model: defaultModel, Default: true}}, entries...)
	}
	return entries, nil
}

// claudeSettingsDefault reads the operator's own model choice from ~/.claude/settings.json, the
// same file claude reads — that is the "CLI default" picker row.
func claudeSettingsDefault() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(home, ".claude", "settings.json"))
	if err != nil {
		return ""
	}
	var cfg struct {
		Model string `json:"model"`
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return ""
	}
	return strings.TrimSpace(cfg.Model)
}

func enumerateCodex(ctx context.Context) ([]ModelEntry, error) {
	dir := os.Getenv("CODEX_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		dir = home
	}
	raw, err := os.ReadFile(filepath.Join(dir, ".codex", "config.toml"))
	if err != nil {
		return nil, err
	}
	return parseCodexConfig(string(raw))
}

// parseCodexConfig line-scans the operator's config for `model = "…"` values — top-level is the
// active default, [profiles.*] entries are named alternates. A hand parser is enough; adding a TOML
// dependency for one key would be over-engineering.
func parseCodexConfig(raw string) ([]ModelEntry, error) {
	modelRe := regexp.MustCompile(`^\s*model\s*=\s*["']([^"']+)["']\s*$`)
	var entries []ModelEntry
	inSection := false
	topLevelSeen := false
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") {
			inSection = true
			continue
		}
		m := modelRe.FindStringSubmatch(trimmed)
		if m == nil {
			continue
		}
		def := !inSection && !topLevelSeen
		if !inSection {
			topLevelSeen = true
		}
		entries = append(entries, ModelEntry{Runtime: "codex", Model: m[1], Default: def})
	}
	return entries, nil
}

// In-process catalog cache: model lists rotate slowly, probe spawns are not free, and repeated
// ListHarnesses calls (every picker open / launch compose) must not re-run three CLIs per open.
// Manual refresh busts it; there is deliberately no on-disk persistence — re-deriving at boot is
// cheap and a file cache would only add staleness.

type catalogEntry struct {
	models  []ModelEntry
	fetched time.Time
}

var (
	catalogMu    sync.Mutex
	catalogCache = map[string]catalogEntry{}
	nowFn        = time.Now // clock seam for tests
)

const catalogTTL = 24 * time.Hour

func ModelsForRuntime(ctx context.Context, runtime string) []ModelEntry {
	catalogMu.Lock()
	defer catalogMu.Unlock()
	return modelsForRuntimeLocked(ctx, runtime)
}

func modelsForRuntimeLocked(ctx context.Context, runtime string) []ModelEntry {
	if entry, ok := catalogCache[runtime]; ok && nowFn().Sub(entry.fetched) < catalogTTL {
		return append([]ModelEntry(nil), entry.models...)
	}
	models, err := enumerateCatalog(ctx, runtime)
	if err != nil {
		if entry, ok := catalogCache[runtime]; ok {
			return append([]ModelEntry(nil), entry.models...) // stale over none
		}
		return nil // free-form-only
	}
	catalogCache[runtime] = catalogEntry{models: models, fetched: nowFn()}
	return append([]ModelEntry(nil), models...)
}

func RefreshRouteCatalog() {
	catalogMu.Lock()
	defer catalogMu.Unlock()
	catalogCache = map[string]catalogEntry{}
}

// SetCatalogCommandForTest replaces the exec seam so wshserver tests feed deterministic
// catalog fixtures without spawning real CLIs. Returns a restore func.
func SetCatalogCommandForTest(fn func(ctx context.Context, bin string, args ...string) ([]byte, error)) func() {
	orig := catalogCommand
	catalogCommand = fn
	return func() { catalogCommand = orig }
}
