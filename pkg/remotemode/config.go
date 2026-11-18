// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package remotemode is remote mode: while the owner turns it on, what waits on them reaches a phone
// web app through a Cloudflare named tunnel behind Access, or through tailscale serve inside the tailnet.
package remotemode

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
)

// SecretName is the one secretstore entry that holds the whole Config as a JSON value.
const SecretName = "arc_remote"

// DefaultPort is where the phone listener binds when setup names no port; the tunnel's public
// hostname in the Cloudflare dashboard points at http://localhost:47821.
const DefaultPort = 47821

const tailscaleStatusTimeout = 10 * time.Second

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
	// Provider is ProviderCloudflare (also when empty, as before there was a choice) or ProviderTailscale.
	Provider    string `json:"provider,omitempty"`
	TunnelToken string `json:"tunneltoken,omitempty"`
	Team        string `json:"team,omitempty"`
	Aud         string `json:"aud,omitempty"`
	Email       string `json:"email,omitempty"`
	Hostname    string `json:"hostname,omitempty"`
	Port        int    `json:"port,omitempty"`
	// TSHostname is this machine's tailnet name (pc.tailnet.ts.net) and TSLogin the one tailnet login let
	// in; kept apart from Hostname and Email so switching provider back and forth loses neither.
	TSHostname    string             `json:"tshostname,omitempty"`
	TSLogin       string             `json:"tslogin,omitempty"`
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

const (
	ProviderCloudflare = "cloudflare"
	ProviderTailscale  = "tailscale"
)

// ActiveProvider is the stored provider, ProviderCloudflare when none is stored.
func (c Config) ActiveProvider() string {
	if c.Provider == ProviderTailscale {
		return ProviderTailscale
	}
	return ProviderCloudflare
}

// Host and Owner are the active provider's address and the one identity let in.
func (c Config) Host() string {
	if c.ActiveProvider() == ProviderTailscale {
		return c.TSHostname
	}
	return c.Hostname
}

func (c Config) Owner() string {
	if c.ActiveProvider() == ProviderTailscale {
		return c.TSLogin
	}
	return c.Email
}

// Missing names the active provider's setup fields not stored yet, in the order setup asks for them; a
// tailscale field takes the name of its cloudflare twin (hostname, email), as Settings shows one field.
func (c Config) Missing() []string {
	fields := []struct{ name, val string }{
		{"tunneltoken", c.TunnelToken},
		{"team", c.Team},
		{"aud", c.Aud},
		{"email", c.Email},
		{"hostname", c.Hostname},
	}
	if c.ActiveProvider() == ProviderTailscale {
		fields = []struct{ name, val string }{
			{"email", c.TSLogin},
			{"hostname", c.TSHostname},
		}
	}
	var missing []string
	for _, f := range fields {
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

// FindTailscale looks on PATH, then where the Windows installer and the macOS app put the CLI.
func FindTailscale() (string, error) {
	if p, err := exec.LookPath("tailscale"); err == nil {
		return p, nil
	}
	var candidates []string
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
		if dir := os.Getenv(env); dir != "" {
			candidates = append(candidates, filepath.Join(dir, "Tailscale", "tailscale.exe"))
		}
	}
	candidates = append(candidates, "/Applications/Tailscale.app/Contents/MacOS/Tailscale")
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("tailscale not found: install it from https://tailscale.com/download and log in")
}

// TailscaleSelf is what `tailscale status --json` says about this machine: its tailnet DNS name and
// the login of the user it belongs to.
type TailscaleSelf struct {
	Hostname string
	Login    string
}

type tailscaleStatusJSON struct {
	BackendState string `json:"BackendState"`
	Self         *struct {
		DNSName string `json:"DNSName"`
		UserID  int64  `json:"UserID"`
	} `json:"Self"`
	User map[string]struct {
		LoginName string `json:"LoginName"`
	} `json:"User"`
}

// ReadTailscaleSelf runs `tailscale status --json` and refuses a tailscale that is not logged in and up.
func ReadTailscaleSelf(path string) (TailscaleSelf, error) {
	ctx, cancel := context.WithTimeout(context.Background(), tailscaleStatusTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "status", "--json").Output()
	if err != nil {
		return TailscaleSelf{}, fmt.Errorf("tailscale status: %w", err)
	}
	return parseTailscaleSelf(out)
}

func parseTailscaleSelf(raw []byte) (TailscaleSelf, error) {
	var st tailscaleStatusJSON
	if err := json.Unmarshal(raw, &st); err != nil {
		return TailscaleSelf{}, fmt.Errorf("tailscale status is not valid json: %w", err)
	}
	if st.BackendState != "Running" || st.Self == nil {
		return TailscaleSelf{}, fmt.Errorf("tailscale is %s, not running: log in and connect it first", strings.ToLower(st.BackendState))
	}
	self := TailscaleSelf{Hostname: strings.ToLower(strings.TrimSuffix(st.Self.DNSName, "."))}
	if u, ok := st.User[strconv.FormatInt(st.Self.UserID, 10)]; ok {
		self.Login = u.LoginName
	}
	if self.Hostname == "" {
		return TailscaleSelf{}, fmt.Errorf("tailscale reports no DNS name for this machine: turn MagicDNS on for the tailnet")
	}
	return self, nil
}
