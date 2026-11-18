// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	tailnetTestHost  = "pc.tail123.ts.net"
	tailnetTestLogin = "me@example.com"
	tailnetTestJSON  = `{"BackendState":"Running","Self":{"DNSName":"PC.tail123.ts.net.","UserID":42},
		"User":{"42":{"LoginName":"me@example.com"},"7":{"LoginName":"other@example.com"}}}`
)

func TestTailnetVerify(t *testing.T) {
	verify := tailnetVerify(tailnetTestLogin)
	for _, tc := range []struct {
		name, login string
		ok          bool
	}{
		{"owner", tailnetTestLogin, true},
		{"owner in another case", "Me@Example.com", true},
		{"no header", "", false},
		{"another login", "other@example.com", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, _ := http.NewRequest("GET", "/", nil)
			if tc.login != "" {
				r.Header.Set(tailnetLoginHeader, tc.login)
			}
			if err := verify(r); (err == nil) != tc.ok {
				t.Errorf("verify(%q) = %v, want ok=%v", tc.login, err, tc.ok)
			}
		})
	}
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set(tailnetLoginHeader, "anyone@example.com")
	if tailnetVerify("")(r) == nil {
		t.Error("an empty owner let a login in")
	}
}

func TestParseTailscaleSelf(t *testing.T) {
	self, err := parseTailscaleSelf([]byte(tailnetTestJSON))
	if err != nil {
		t.Fatal(err)
	}
	if self.Hostname != tailnetTestHost || self.Login != tailnetTestLogin {
		t.Errorf("self = %+v", self)
	}
	if _, err := parseTailscaleSelf([]byte(`{"BackendState":"NeedsLogin"}`)); err == nil || !strings.Contains(err.Error(), "needslogin") {
		t.Errorf("a logged-out tailscale: %v", err)
	}
	if _, err := parseTailscaleSelf([]byte(`{"BackendState":"Running","Self":{"DNSName":""}}`)); err == nil {
		t.Error("no DNS name was accepted")
	}
}

func TestServeKindLines(t *testing.T) {
	kind := serveKind(47821)
	if got := strings.Join(kind.args, " "); got != "serve --https=443 http://127.0.0.1:47821" {
		t.Errorf("args %q", got)
	}
	if !kind.isUp("Available within your tailnet:") || !kind.isUp("Press Ctrl+C to exit.") || kind.isUp("Serve is not enabled on your tailnet.") {
		t.Error("isUp misreads a line")
	}
	msg := kind.notice("         https://login.tailscale.com/f/serve?node=abc")
	if msg != "Serve is not enabled on your tailnet: enable it at https://login.tailscale.com/f/serve?node=abc" {
		t.Errorf("notice %q", msg)
	}
	if kind.notice("Serve is not enabled on your tailnet.") != "" {
		t.Error("a line without the link gave a notice")
	}
}

func TestConfigMissingTailscale(t *testing.T) {
	cfg := Config{Provider: ProviderTailscale, Email: "cf@example.com", Hostname: "arc.example.com"}
	if got := strings.Join(cfg.Missing(), ","); got != "email,hostname" {
		t.Errorf("missing %q", got)
	}
	cfg.TSLogin, cfg.TSHostname = tailnetTestLogin, tailnetTestHost
	if len(cfg.Missing()) != 0 || cfg.Host() != tailnetTestHost || cfg.Owner() != tailnetTestLogin {
		t.Errorf("complete tailscale config: missing %v host %q owner %q", cfg.Missing(), cfg.Host(), cfg.Owner())
	}
}

// tailnetTestEnv fakes the tailscale CLI: found, its status, and serve starting and coming up.
func tailnetTestEnv(t *testing.T, statusErr error) *atomic.Int32 {
	t.Helper()
	serves := &atomic.Int32{}
	prevFind, prevRead, prevServe := remoteFindTailscale, remoteReadTailscale, remoteStartServe
	remoteFindTailscale = func() (string, error) { return "tailscale.exe", nil }
	remoteReadTailscale = func(string) (TailscaleSelf, error) {
		if statusErr != nil {
			return TailscaleSelf{}, statusErr
		}
		return parseTailscaleSelf([]byte(tailnetTestJSON))
	}
	t.Cleanup(func() { remoteFindTailscale, remoteReadTailscale, remoteStartServe = prevFind, prevRead, prevServe })
	return serves
}

func TestSetupTailscaleReadsSelfAndKeepsCloudflare(t *testing.T) {
	configUseTempDir(t)
	tailnetTestEnv(t, nil)
	if _, err := Setup(configValidSetup()); err != nil {
		t.Fatal(err)
	}
	st, err := Setup(wshrpc.CommandRemoteSetupData{Provider: ProviderTailscale})
	if err != nil {
		t.Fatal(err)
	}
	if st.Provider != ProviderTailscale || st.Hostname != tailnetTestHost || st.Email != tailnetTestLogin || len(st.Missing) != 0 {
		t.Errorf("tailscale status %+v", st)
	}
	// a hand-set login survives the next setup, which reads tailscale again
	if _, err := Setup(wshrpc.CommandRemoteSetupData{Email: "phone@example.com"}); err != nil {
		t.Fatal(err)
	}
	if st, _ = Setup(wshrpc.CommandRemoteSetupData{Port: 5000}); st.Email != "phone@example.com" {
		t.Errorf("hand-set login became %q", st.Email)
	}
	st, err = Setup(wshrpc.CommandRemoteSetupData{Provider: ProviderCloudflare})
	if err != nil {
		t.Fatal(err)
	}
	if st.Provider != ProviderCloudflare || st.Hostname != "arc.example.com" || st.Email != "me@example.com" || len(st.Missing) != 0 {
		t.Errorf("back to cloudflare: %+v", st)
	}
}

func TestSetupTailscaleNotRunning(t *testing.T) {
	configUseTempDir(t)
	tailnetTestEnv(t, errors.New("tailscale is stopped"))
	if _, err := Setup(wshrpc.CommandRemoteSetupData{Provider: ProviderTailscale}); err == nil || !strings.Contains(err.Error(), "stopped") {
		t.Errorf("setup with tailscale down: %v", err)
	}
	if _, err := Setup(wshrpc.CommandRemoteSetupData{Provider: "ngrok"}); err == nil {
		t.Error("an unknown provider was accepted")
	}
}

func TestOnTailscaleServesAndChecksLogin(t *testing.T) {
	fakes, port := remoteTestEnv(t, configValidSetup())
	serves := tailnetTestEnv(t, nil)
	var servedPort atomic.Int32
	remoteStartServe = func(path string, p int, onState func(state, lastErr string)) (remoteTunnel, error) {
		serves.Add(1)
		servedPort.Store(int32(p))
		onState(TunnelUp, "")
		return &remoteTestTunnel{fakes: fakes, onState: onState}, nil
	}
	if _, err := Setup(wshrpc.CommandRemoteSetupData{Provider: ProviderTailscale, Port: port}); err != nil {
		t.Fatal(err)
	}
	st, err := On()
	if err != nil {
		t.Fatal(err)
	}
	if serves.Load() != 1 || fakes.starts.Load() != 0 || int(servedPort.Load()) != port || st.Tunnel != TunnelUp {
		t.Fatalf("serves %d cloudflared %d port %d status %+v", serves.Load(), fakes.starts.Load(), servedPort.Load(), st)
	}
	get := func(login string) int {
		r, _ := http.NewRequest("GET", remoteTestURL(port, "/api/waiting"), nil)
		if login != "" {
			r.Header.Set(tailnetLoginHeader, login)
		}
		resp, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := get(tailnetTestLogin); code != http.StatusOK {
		t.Errorf("owner got %d", code)
	}
	if code := get("other@example.com"); code != http.StatusForbidden {
		t.Errorf("another login got %d", code)
	}
	if code := get(""); code != http.StatusForbidden {
		t.Errorf("no login got %d", code)
	}
}
