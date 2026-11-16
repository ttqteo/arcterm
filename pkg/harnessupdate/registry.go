// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const (
	fetchTimeout = 10 * time.Second
	// a package's dist-tags are a few dozen bytes; a package that keeps a tag per snapshot build (opencode-ai) still
	// runs to a few KB
	maxDocBytes = 1 << 20
)

// registryBase is a seam for tests.
var registryBase = "https://registry.npmjs.org"

var httpClient = &http.Client{Timeout: fetchTimeout}

// LatestVersion is the version the package's dist-tag for channel points at, read from its dist-tags
// (`https://registry.npmjs.org/-/package/<package>/dist-tags`, {"latest":"2.1.325",…}): the tags alone, where the
// package document, even abbreviated, lists every published version (Claude Code's ran to 536 KB in 2026-11).
func LatestVersion(ctx context.Context, pkg, channel string) (string, error) {
	u := registryBase + "/-/package/" + url.PathEscape(pkg) + "/dist-tags"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("registry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry: %s for %s", resp.Status, pkg)
	}
	var tags map[string]string
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxDocBytes)).Decode(&tags); err != nil {
		return "", fmt.Errorf("registry: %w", err)
	}
	v := tags[channel]
	if v == "" {
		return "", fmt.Errorf("registry: no %q tag for %s", channel, pkg)
	}
	return v, nil
}

// claudeSettingsPath is a seam for tests.
var claudeSettingsPath = func() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "settings.json")
}

// ClaudeChannel is the release channel Claude Code updates from: autoUpdatesChannel in ~/.claude/settings.json when it
// is "stable", else "latest" (Claude Code's own default).
func ClaudeChannel() string {
	b, err := os.ReadFile(claudeSettingsPath())
	if err != nil {
		return "latest"
	}
	var s struct {
		AutoUpdatesChannel string `json:"autoUpdatesChannel"`
	}
	if json.Unmarshal(b, &s) == nil && s.AutoUpdatesChannel == "stable" {
		return "stable"
	}
	return "latest"
}
