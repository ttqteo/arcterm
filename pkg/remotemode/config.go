// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package remotemode is remote mode: while the owner turns it on, what waits on them reaches a phone
// web app through a Cloudflare named tunnel behind Access.
package remotemode

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
)

// SecretName is the one secretstore entry that holds the whole Config as a JSON value.
const SecretName = "arc_remote"

// DefaultPort is where the phone listener binds when setup names no port; the tunnel's public
// hostname in the Cloudflare dashboard points at http://localhost:47821.
const DefaultPort = 47821

// PushSubscription matches the browser's PushSubscription.toJSON().
type PushSubscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// Config is everything remote mode stores. VapidPrivate is the base64url (no padding) 32-byte P-256
// scalar and VapidPublic the base64url 65-byte uncompressed point.
type Config struct {
	TunnelToken   string             `json:"tunneltoken,omitempty"`
	Team          string             `json:"team,omitempty"`
	Aud           string             `json:"aud,omitempty"`
	Email         string             `json:"email,omitempty"`
	Hostname      string             `json:"hostname,omitempty"`
	Port          int                `json:"port,omitempty"`
	VapidPrivate  string             `json:"vapidprivate,omitempty"`
	VapidPublic   string             `json:"vapidpublic,omitempty"`
	Subscriptions []PushSubscription `json:"subscriptions,omitempty"`
	On            bool               `json:"on,omitempty"`
}

// LoadConfig returns the zero Config when nothing is stored yet.
func LoadConfig() (Config, error) {
	raw, ok, err := secretstore.GetSecret(SecretName)
	if err != nil {
		return Config{}, fmt.Errorf("remote mode: read stored config: %w", err)
	}
	var cfg Config
	if !ok || raw == "" {
		return cfg, nil
	}
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return Config{}, fmt.Errorf("remote mode: stored config is not valid json: %w", err)
	}
	return cfg, nil
}

func SaveConfig(cfg Config) error {
	raw, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("remote mode: encode config: %w", err)
	}
	if err := secretstore.SetSecret(SecretName, string(raw)); err != nil {
		return fmt.Errorf("remote mode: store config: %w", err)
	}
	return nil
}

// Missing names the setup fields not stored yet, in the order setup asks for them.
func (c Config) Missing() []string {
	var missing []string
	for _, f := range []struct{ name, val string }{
		{"tunneltoken", c.TunnelToken},
		{"team", c.Team},
		{"aud", c.Aud},
		{"email", c.Email},
		{"hostname", c.Hostname},
	} {
		if f.val == "" {
			missing = append(missing, f.name)
		}
	}
	return missing
}

// ListenPort is the port the phone listener binds: the stored one, or DefaultPort while none is stored.
func (c Config) ListenPort() int {
	if c.Port == 0 {
		return DefaultPort
	}
	return c.Port
}

// FindCloudflared looks on PATH first, then where winget installs it, since a fresh install is not on
// the PATH of an already running Arc.
func FindCloudflared() (string, error) {
	if p, err := exec.LookPath("cloudflared"); err == nil {
		return p, nil
	}
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles"} {
		dir := os.Getenv(env)
		if dir == "" {
			continue
		}
		p := filepath.Join(dir, "cloudflared", "cloudflared.exe")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("cloudflared not found: install it with `%s`", remoteWingetLine)
}
