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
	// the package document lists every published version: Claude Code's runs to megabytes even abbreviated
	maxDocBytes = 32 << 20
	// npm's abbreviated package document: dist-tags and versions, without the readmes
	abbreviatedDoc = "application/vnd.npm.install-v1+json"
)

// registryBase is a seam for tests.
var registryBase = "https://registry.npmjs.org"

var httpClient = &http.Client{Timeout: fetchTimeout}

// LatestVersion is the version the package's dist-tag for channel points at, read from the package document
// (`https://registry.npmjs.org/<package>`).
func LatestVersion(ctx context.Context, pkg, channel string) (string, error) {
	u := registryBase + "/" + url.PathEscape(pkg)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", abbreviatedDoc)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("registry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry: %s for %s", resp.Status, pkg)
	}
	var doc struct {
		DistTags map[string]string `json:"dist-tags"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxDocBytes)).Decode(&doc); err != nil {
		return "", fmt.Errorf("registry: %w", err)
	}
	v := doc.DistTags[channel]
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
