// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func serveTags(t *testing.T, status int, body string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/@anthropic-ai%2Fclaude-code" {
			t.Errorf("path = %q", r.URL.EscapedPath())
		}
		if r.Header.Get("Accept") != abbreviatedDoc {
			t.Errorf("Accept = %q, want the abbreviated package document", r.Header.Get("Accept"))
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	orig := registryBase
	registryBase = srv.URL
	t.Cleanup(func() { registryBase = orig })
}

func TestLatestVersion_readsTheChannelTag(t *testing.T) {
	serveTags(t, 200, `{"name":"@anthropic-ai/claude-code","dist-tags":{"latest":"2.1.300","stable":"2.1.280","next":"2.2.0-beta.1"},"versions":{"2.1.300":{}}}`)
	for channel, want := range map[string]string{"latest": "2.1.300", "stable": "2.1.280"} {
		got, err := LatestVersion(context.Background(), "@anthropic-ai/claude-code", channel)
		if err != nil || got != want {
			t.Errorf("%s: got %q, %v; want %q", channel, got, err, want)
		}
	}
}

func TestLatestVersion_failsOnAMissingTagOrABadStatus(t *testing.T) {
	serveTags(t, 200, `{"dist-tags":{"latest":"2.1.300"}}`)
	if _, err := LatestVersion(context.Background(), "@anthropic-ai/claude-code", "stable"); err == nil {
		t.Error("a missing channel tag returned no error")
	}
	serveTags(t, 503, `oops`)
	if _, err := LatestVersion(context.Background(), "@anthropic-ai/claude-code", "latest"); err == nil {
		t.Error("a 503 returned no error")
	}
}

func TestClaudeChannel(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	orig := claudeSettingsPath
	claudeSettingsPath = func() string { return path }
	t.Cleanup(func() { claudeSettingsPath = orig })

	if got := ClaudeChannel(); got != "latest" {
		t.Errorf("no settings file: %q, want latest", got)
	}
	_ = os.WriteFile(path, []byte(`{"autoUpdatesChannel":"stable"}`), 0o644)
	if got := ClaudeChannel(); got != "stable" {
		t.Errorf("stable: %q", got)
	}
	_ = os.WriteFile(path, []byte(`{"autoUpdatesChannel":"weird"}`), 0o644)
	if got := ClaudeChannel(); got != "latest" {
		t.Errorf("an unknown channel: %q, want latest", got)
	}
}
