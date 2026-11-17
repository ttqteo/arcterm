// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	remoteTestHost    = "arc.example.com"
	remoteTestOrigin  = "https://" + remoteTestHost
	remoteTestTimeout = 5 * time.Second
)

type remoteTestFakes struct {
	starts   atomic.Int32
	stops    atomic.Int32
	releases atomic.Int32
}

type remoteTestTunnel struct {
	fakes   *remoteTestFakes
	onState func(state, lastErr string)
	once    sync.Once
}

func (tt *remoteTestTunnel) Stop() {
	tt.once.Do(func() {
		tt.fakes.stops.Add(1)
		tt.onState(TunnelOff, "")
	})
}

func remoteTestFreePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// remoteTestEnv stores a complete setup on a free port and fakes cloudflared, keep-awake and the waiting
// list; remote mode is turned off when the test ends.
func remoteTestEnv(t *testing.T, setup wshrpc.CommandRemoteSetupData) (*remoteTestFakes, int) {
	t.Helper()
	configUseTempDir(t)
	fakes := &remoteTestFakes{}
	prevStart, prevAwake, prevWaiting := remoteStartTunnel, remoteKeepAwake, remoteWaitingList
	remoteStartTunnel = func(path, token string, onState func(state, lastErr string)) (remoteTunnel, error) {
		fakes.starts.Add(1)
		onState(TunnelStarting, "")
		onState(TunnelUp, "")
		return &remoteTestTunnel{fakes: fakes, onState: onState}, nil
	}
	remoteKeepAwake = func() func() {
		var once sync.Once
		return func() { once.Do(func() { fakes.releases.Add(1) }) }
	}
	remoteWaitingList = func(context.Context) (WaitingList, error) { return WaitingList{}, nil }
	t.Cleanup(func() { remoteStartTunnel, remoteKeepAwake, remoteWaitingList = prevStart, prevAwake, prevWaiting })
	port := remoteTestFreePort(t)
	setup.Port = port
	if _, err := Setup(setup); err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Cleanup(func() { Off() })
	return fakes, port
}

// remoteTestAccessEnv sets up remote mode for the access test team, with the certs fetch sent to the
// test certs server, and returns a token the live listener accepts.
func remoteTestAccessEnv(t *testing.T) (*remoteTestFakes, int, string) {
	t.Helper()
	env := newAccessTestEnv(t)
	env.clock = time.Now()
	certs, err := url.Parse(env.verifier.certsURL)
	if err != nil {
		t.Fatal(err)
	}
	prevClient := remoteAccessClient
	remoteAccessClient = &http.Client{Timeout: remoteTestTimeout, Transport: remoteTestRedirect{to: certs}}
	t.Cleanup(func() { remoteAccessClient = prevClient })
	fakes, port := remoteTestEnv(t, wshrpc.CommandRemoteSetupData{
		TunnelToken: configTestToken, Team: accessTestTeam, Aud: accessTestAud, Email: accessTestEmail, Hostname: remoteTestHost,
	})
	return fakes, port, env.sign(env.claims())
}

// remoteTestRedirect sends the verifier's fetch of the real team certs url to the test server.
type remoteTestRedirect struct{ to *url.URL }

func (rt remoteTestRedirect) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.URL.Scheme, r.URL.Host, r.Host = rt.to.Scheme, rt.to.Host, ""
	return http.DefaultTransport.RoundTrip(r)
}

func remoteTestURL(port int, path string) string {
	return "http://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(port)) + path
}

func remoteTestPost(t *testing.T, port int, path, token, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, remoteTestURL(port, path), strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(accessHeader, token)
	req.Header.Set("Origin", remoteTestOrigin)
	req.Header.Set("Content-Type", handlerJSONType)
	return remoteTestDo(t, req)
}

func remoteTestGet(t *testing.T, port int, path, token string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, remoteTestURL(port, path), nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set(accessHeader, token)
	}
	return remoteTestDo(t, req)
}

func remoteTestDo(t *testing.T, req *http.Request) (int, string) {
	t.Helper()
	client := &http.Client{Timeout: remoteTestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

func remoteTestPortOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func remoteTestStoredOn(t *testing.T) bool {
	t.Helper()
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	return cfg.On
}

func TestOnRefusesIncompleteSetup(t *testing.T) {
	fakes, _ := remoteTestEnv(t, wshrpc.CommandRemoteSetupData{Team: "acme"})
	_, err := On()
	if err == nil {
		t.Fatal("On with an incomplete setup must fail")
	}
	for _, field := range []string{"tunneltoken", "aud", "email", "hostname"} {
		if !strings.Contains(err.Error(), field) {
			t.Errorf("error %q does not name missing field %s", err, field)
		}
	}
	if strings.Contains(err.Error(), "team") {
		t.Errorf("error %q names team, which is stored", err)
	}
	if fakes.starts.Load() != 0 || remoteTestStoredOn(t) || Status().On {
		t.Error("nothing may start, and remote mode must stay off")
	}
	if st := Status(); st.TunnelError == "" {
		t.Error("status must carry why remote mode could not turn on")
	}
}

func TestOnRefusesMissingCloudflared(t *testing.T) {
	fakes, port := remoteTestEnv(t, configValidSetup())
	remoteFindCloudflared = func() (string, error) { return "", errors.New("not found") }
	_, err := On()
	if err == nil || !strings.Contains(err.Error(), remoteWingetLine) {
		t.Fatalf("want the winget line, got %v", err)
	}
	if fakes.starts.Load() != 0 || remoteTestPortOpen(port) {
		t.Error("nothing may start without cloudflared")
	}
}

func TestOnPortInUse(t *testing.T) {
	fakes, port := remoteTestEnv(t, configValidSetup())
	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	_, err = On()
	if err == nil || !strings.Contains(err.Error(), strconv.Itoa(port)) {
		t.Fatalf("want an error naming port %d, got %v", port, err)
	}
	if fakes.starts.Load() != 0 || fakes.releases.Load() != 0 || remoteTestStoredOn(t) {
		t.Error("a port in use must leave nothing started and remote mode off")
	}
}

func TestOnOffLifecycle(t *testing.T) {
	fakes, port := remoteTestEnv(t, configValidSetup())
	st, err := On()
	if err != nil {
		t.Fatalf("On: %v", err)
	}
	if !st.On || st.Tunnel != TunnelUp {
		t.Errorf("status after On = on %v tunnel %q, want on and up", st.On, st.Tunnel)
	}
	if host, _, _ := net.SplitHostPort(remoteLive.ln.Addr().String()); host != "127.0.0.1" {
		t.Errorf("listener bound to %s, want 127.0.0.1 only", remoteLive.ln.Addr())
	}
	for _, path := range []string{"/", "/index.html", "/api/waiting"} {
		if code, _ := remoteTestGet(t, port, path, ""); code != http.StatusForbidden {
			t.Errorf("GET %s without a token = %d, want 403", path, code)
		}
	}
	if _, err := On(); err != nil || fakes.starts.Load() != 1 {
		t.Errorf("a second On must do nothing: err %v, tunnel starts %d", err, fakes.starts.Load())
	}
	if !remoteTestStoredOn(t) {
		t.Error("On must store on")
	}

	st, err = Off()
	if err != nil {
		t.Fatalf("Off: %v", err)
	}
	if remoteTestPortOpen(port) {
		t.Error("the port is still open after Off")
	}
	if fakes.stops.Load() != 1 || fakes.releases.Load() != 1 {
		t.Errorf("Off: tunnel stops %d, keep-awake releases %d, want 1 and 1", fakes.stops.Load(), fakes.releases.Load())
	}
	if st.On || st.Tunnel != TunnelOff || remoteTestStoredOn(t) {
		t.Errorf("after Off: status on %v tunnel %q, stored on %v", st.On, st.Tunnel, remoteTestStoredOn(t))
	}
	if _, err := Off(); err != nil || fakes.stops.Load() != 1 {
		t.Errorf("a second Off must do nothing: err %v, stops %d", err, fakes.stops.Load())
	}
}

func TestOffFromPhone(t *testing.T) {
	fakes, port, token := remoteTestAccessEnv(t)
	if _, err := On(); err != nil {
		t.Fatalf("On: %v", err)
	}
	if code, body := remoteTestGet(t, port, "/api/waiting", token); code != http.StatusOK || !strings.Contains(body, `"vapidpublic":"B`) {
		t.Fatalf("GET /api/waiting with a valid token = %d %s", code, body)
	}
	if code, body := remoteTestPost(t, port, "/api/off", token, "{}"); code != http.StatusOK {
		t.Fatalf("POST /api/off = %d %s", code, body)
	}
	deadline := time.Now().Add(remoteTestTimeout)
	for Status().On || remoteTestPortOpen(port) || remoteTestStoredOn(t) {
		if time.Now().After(deadline) {
			t.Fatal("remote mode is still on after the phone turned it off")
		}
		time.Sleep(20 * time.Millisecond)
	}
	// the phone's off still holds remoteMu while it publishes; join it before the fakes are restored
	remoteMu.Lock()
	stillOn := remoteLive != nil
	remoteMu.Unlock()
	if stillOn {
		t.Error("remote mode is live after the phone turned it off")
	}
	if fakes.stops.Load() != 1 || fakes.releases.Load() != 1 || remoteTestStoredOn(t) {
		t.Errorf("off from the phone: tunnel stops %d, releases %d, stored on %v", fakes.stops.Load(), fakes.releases.Load(), remoteTestStoredOn(t))
	}
}

func TestAnswerGoneMapping(t *testing.T) {
	_, port, token := remoteTestAccessEnv(t)
	if _, err := On(); err != nil {
		t.Fatalf("On: %v", err)
	}
	const oref = "block:remote-test-b1"
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: "a2", BlockId: "remote-test-b1", Questions: []baseds.AgentAskQuestion{
		{Question: "Which?", Options: []baseds.AgentAskOption{{Label: "A"}, {Label: "B"}}},
	}})
	t.Cleanup(func() { agentask.GlobalRegistry.Drop(oref) })

	body := `{"oref":"` + oref + `","askid":"a1","answers":[{"selectedindexes":[0]}]}`
	code, resp := remoteTestPost(t, port, "/api/answer", token, body)
	if code != http.StatusConflict || !strings.Contains(resp, `"gone"`) {
		t.Fatalf("answer to a replaced ask = %d %s, want 409 gone", code, resp)
	}
	if p, ok := agentask.GlobalRegistry.Get(oref); !ok || p.AskId != "a2" {
		t.Error("a stale answer must leave the new ask pending")
	}
	if err := remoteAnswer(context.Background(), "block:remote-test-none", "a1", []baseds.AgentAnswerItem{{SelectedIndexes: []int{0}}}); !errors.Is(err, ErrAskGone) {
		t.Errorf("answer with nothing pending = %v, want ErrAskGone", err)
	}
}

func TestRestore(t *testing.T) {
	t.Run("on when stored on", func(t *testing.T) {
		fakes, port := remoteTestEnv(t, configValidSetup())
		if err := remoteSaveOn(true); err != nil {
			t.Fatal(err)
		}
		Restore()
		if !Status().On || fakes.starts.Load() != 1 || !remoteTestPortOpen(port) {
			t.Error("Restore with on stored must turn remote mode on")
		}
	})
	t.Run("stays off when stored off", func(t *testing.T) {
		fakes, _ := remoteTestEnv(t, configValidSetup())
		Restore()
		if Status().On || fakes.starts.Load() != 0 {
			t.Error("Restore with off stored must do nothing")
		}
	})
	t.Run("a failure keeps on stored", func(t *testing.T) {
		remoteTestEnv(t, configValidSetup())
		if err := remoteSaveOn(true); err != nil {
			t.Fatal(err)
		}
		remoteFindCloudflared = func() (string, error) { return "", errors.New("not found") }
		Restore()
		if Status().On || !remoteTestStoredOn(t) {
			t.Error("a failed Restore must leave remote mode off with on still stored")
		}
	})
}

func TestSetupWhileOnRestarts(t *testing.T) {
	fakes, _ := remoteTestEnv(t, configValidSetup())
	if _, err := On(); err != nil {
		t.Fatalf("On: %v", err)
	}
	newPort := remoteTestFreePort(t)
	if _, err := Setup(wshrpc.CommandRemoteSetupData{Port: newPort}); err != nil {
		t.Fatalf("re-setup: %v", err)
	}
	if fakes.starts.Load() != 2 || fakes.stops.Load() != 1 || !Status().On || !remoteTestPortOpen(newPort) {
		t.Errorf("re-setup while on must restart on the new port: starts %d stops %d", fakes.starts.Load(), fakes.stops.Load())
	}
}

func TestSubscribeReplacesSameEndpoint(t *testing.T) {
	configUseTempDir(t)
	for _, s := range []PushSubscription{configSub("https://push.example/1"), configSub("https://push.example/2"), configSub("https://push.example/1")} {
		if err := remoteSubscribe(s); err != nil {
			t.Fatal(err)
		}
	}
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if raw, _ := json.Marshal(cfg.Subscriptions); len(cfg.Subscriptions) != 2 {
		t.Errorf("subscriptions = %s, want one per endpoint", raw)
	}
}
