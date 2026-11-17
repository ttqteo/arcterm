// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const configTestToken = "tunnel-token-secret-value"

// configUseTempDir points the secret store at a temp config dir and clears the remote entry, since the
// store's in-memory state outlives a test.
func configUseTempDir(t *testing.T) {
	t.Helper()
	// not restored: the store's debounced write lands up to a second later, and the restored empty
	// dir would make it write secrets.enc into the working directory
	wavebase.ConfigHome_VarCache = t.TempDir()
	if err := secretstore.DeleteSecret(SecretName); err != nil {
		t.Fatalf("clear remote entry: %v", err)
	}
	prevFind := remoteFindCloudflared
	remoteFindCloudflared = func() (string, error) { return "cloudflared.exe", nil }
	t.Cleanup(func() { remoteFindCloudflared = prevFind })
}

func configValidSetup() wshrpc.CommandRemoteSetupData {
	return wshrpc.CommandRemoteSetupData{
		TunnelToken: configTestToken,
		Team:        "acme",
		Aud:         "aud-tag",
		Email:       "me@example.com",
		Hostname:    "arc.example.com",
	}
}

func configSub(endpoint string) PushSubscription {
	s := PushSubscription{Endpoint: endpoint}
	s.Keys.P256dh = "p"
	s.Keys.Auth = "a"
	return s
}

func TestConfigRoundTrip(t *testing.T) {
	configUseTempDir(t)
	want := Config{
		TunnelToken: configTestToken, Team: "acme", Aud: "aud", Email: "me@example.com",
		Hostname: "arc.example.com", Port: 4000, VapidPrivate: "priv", VapidPublic: "pub",
		Subscriptions: []PushSubscription{configSub("https://push.example/1")}, On: true,
	}
	if err := SaveConfig(want); err != nil {
		t.Fatal(err)
	}
	got, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("loaded %+v, want %+v", got, want)
	}
}

func TestConfigSubscriptionJSONMatchesBrowser(t *testing.T) {
	var sub PushSubscription
	body := `{"endpoint":"https://push.example/x","keys":{"p256dh":"PK","auth":"AU"}}`
	if err := json.Unmarshal([]byte(body), &sub); err != nil {
		t.Fatal(err)
	}
	if sub.Endpoint != "https://push.example/x" || sub.Keys.P256dh != "PK" || sub.Keys.Auth != "AU" {
		t.Fatalf("decoded %+v", sub)
	}
	out, _ := json.Marshal(sub)
	if string(out) != body {
		t.Fatalf("encoded %s, want %s", out, body)
	}
}

func TestConfigMissing(t *testing.T) {
	if got := (Config{}).Missing(); !reflect.DeepEqual(got, []string{"tunneltoken", "team", "aud", "email", "hostname"}) {
		t.Fatalf("empty config missing %v", got)
	}
	cfg := Config{TunnelToken: "t", Aud: "a", Hostname: "h"}
	if got := cfg.Missing(); !reflect.DeepEqual(got, []string{"team", "email"}) {
		t.Fatalf("partial config missing %v", got)
	}
	cfg = Config{TunnelToken: "t", Team: "x", Aud: "a", Email: "e@x", Hostname: "h"}
	if got := cfg.Missing(); len(got) != 0 {
		t.Fatalf("full config missing %v", got)
	}
}

func TestSetupValidates(t *testing.T) {
	configUseTempDir(t)
	cases := map[string]func(*wshrpc.CommandRemoteSetupData){
		"scheme in hostname": func(d *wshrpc.CommandRemoteSetupData) { d.Hostname = "https://x" },
		"path in hostname":   func(d *wshrpc.CommandRemoteSetupData) { d.Hostname = "x/y" },
		"email without @":    func(d *wshrpc.CommandRemoteSetupData) { d.Email = "me.example.com" },
		"port 80":            func(d *wshrpc.CommandRemoteSetupData) { d.Port = 80 },
		"port too high":      func(d *wshrpc.CommandRemoteSetupData) { d.Port = 70000 },
		"team with a dot":    func(d *wshrpc.CommandRemoteSetupData) { d.Team = "acme.cloudflareaccess.com" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			data := configValidSetup()
			mutate(&data)
			if _, err := Setup(data); err == nil {
				t.Fatal("expected a refusal")
			}
			cfg, _ := LoadConfig()
			if cfg.Hostname != "" || cfg.TunnelToken != "" {
				t.Fatalf("a refused setup stored %+v", cfg)
			}
		})
	}
	st, err := Setup(configValidSetup())
	if err != nil {
		t.Fatalf("valid setup refused: %v", err)
	}
	if st.Port != DefaultPort || len(st.Missing) != 0 || st.Hostname != "arc.example.com" {
		t.Fatalf("status after setup: %+v", st)
	}
}

func TestSetupKeepsVapidAndSubscriptions(t *testing.T) {
	configUseTempDir(t)
	if _, err := Setup(configValidSetup()); err != nil {
		t.Fatal(err)
	}
	first, _ := LoadConfig()
	pub, err := base64.RawURLEncoding.DecodeString(first.VapidPublic)
	if err != nil || len(pub) != 65 || pub[0] != 4 {
		t.Fatalf("vapid public is not a 65-byte uncompressed point: len %d err %v", len(pub), err)
	}
	priv, err := base64.RawURLEncoding.DecodeString(first.VapidPrivate)
	if err != nil || len(priv) != 32 {
		t.Fatalf("vapid private is not a 32-byte scalar: len %d err %v", len(priv), err)
	}
	first.Subscriptions = []PushSubscription{configSub("https://push.example/1")}
	if err := SaveConfig(first); err != nil {
		t.Fatal(err)
	}
	again := configValidSetup()
	again.Email = "other@example.com"
	again.Port = 5000
	if _, err := Setup(again); err != nil {
		t.Fatal(err)
	}
	second, _ := LoadConfig()
	if second.VapidPrivate != first.VapidPrivate || second.VapidPublic != first.VapidPublic {
		t.Fatal("a second setup replaced the vapid pair")
	}
	if !reflect.DeepEqual(second.Subscriptions, first.Subscriptions) {
		t.Fatalf("a second setup dropped subscriptions: %+v", second.Subscriptions)
	}
	if second.Email != "other@example.com" || second.Port != 5000 {
		t.Fatalf("second setup did not apply: %+v", second)
	}
}

func TestSetupEmptyFieldKeepsStoredValue(t *testing.T) {
	configUseTempDir(t)
	if _, err := Setup(configValidSetup()); err != nil {
		t.Fatal(err)
	}
	if _, err := Setup(wshrpc.CommandRemoteSetupData{Port: 5000}); err != nil {
		t.Fatal(err)
	}
	cfg, _ := LoadConfig()
	if cfg.TunnelToken != configTestToken || cfg.Team != "acme" || cfg.Port != 5000 {
		t.Fatalf("a port-only setup changed other fields: %+v", cfg)
	}
}

func TestStatusOmitsToken(t *testing.T) {
	configUseTempDir(t)
	st, err := Setup(configValidSetup())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []*wshrpc.RemoteStatusData{st, Status()} {
		raw, _ := json.Marshal(s)
		if strings.Contains(string(raw), configTestToken) {
			t.Fatalf("status leaks the tunnel token: %s", raw)
		}
	}
}

// Settings > Remote pre-fills its setup fields from the status
func TestStatusReportsSetupFields(t *testing.T) {
	configUseTempDir(t)
	if got := Status().Port; got != DefaultPort {
		t.Fatalf("port before setup %d, want the default %d it would listen on", got, DefaultPort)
	}
	if _, err := Setup(configValidSetup()); err != nil {
		t.Fatal(err)
	}
	st := Status()
	if st.Team != "acme" || st.Aud != "aud-tag" || st.Email != "me@example.com" || st.Hostname != "arc.example.com" || st.Port != DefaultPort {
		t.Fatalf("status %+v", st)
	}
}

func TestStatusReportsCloudflaredAndSubscriptions(t *testing.T) {
	configUseTempDir(t)
	remoteFindCloudflared = func() (string, error) { return "", errors.New("not found") }
	cfg := Config{Subscriptions: []PushSubscription{configSub("https://a"), configSub("https://b")}}
	if err := SaveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	st := Status()
	if !st.CloudflaredMissing || st.Subscriptions != 2 {
		t.Fatalf("status %+v", st)
	}
	if st.Tunnel != "off" {
		t.Fatalf("tunnel %q, want off", st.Tunnel)
	}
	remoteFindCloudflared = func() (string, error) { return "c.exe", nil }
	if Status().CloudflaredMissing {
		t.Fatal("cloudflared reported missing though found")
	}
}
