// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/remotemode/web"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	remoteMinPort = 1024
	remoteMaxPort = 65535

	// the phone listener is reached only through cloudflared on this machine
	remoteHost = "127.0.0.1"

	remoteWingetLine = "winget install --id Cloudflare.cloudflared"

	remoteReadHeaderTimeout = 10 * time.Second
	// bounds how long turning off waits on a phone request still in flight
	remoteShutdownTimeout = 2 * time.Second
)

// the team becomes the host of the certs url, so anything but a bare team name could aim that fetch
// at another host
var remoteTeamRe = regexp.MustCompile(`^[A-Za-z0-9-]+$`)

// remoteTunnel is the one thing remote mode does with a running tunnel.
type remoteTunnel interface {
	Stop()
}

// package vars so tests can fake cloudflared, keep-awake, the waiting list and the certs fetch
var (
	remoteFindCloudflared = FindCloudflared
	remoteStartTunnel     = func(path, token string, onState func(state, lastErr string)) (remoteTunnel, error) {
		t, err := StartTunnel(path, token, onState)
		if err != nil {
			return nil, err
		}
		return t, nil
	}
	remoteKeepAwake   = KeepAwake
	remoteWaitingList = remoteGatherWaiting
	// nil gives NewAccessVerifier's default client, which has a timeout
	remoteAccessClient *http.Client
)

// remoteConfigMu serializes every read-modify-write of the stored config (remoteUpdateConfig), so a
// re-setup, a new or dropped push subscription and the on flag never lose each other's change.
var remoteConfigMu sync.Mutex

// remoteRun is what remote mode holds while on.
type remoteRun struct {
	// cancel ends every open stream; stopping calls it first, so Shutdown is not left waiting on them
	cancel     context.CancelFunc
	ln         net.Listener
	srv        *http.Server
	tunnel     remoteTunnel
	release    func()
	stopPusher func()
}

var (
	// remoteMu serializes turning on and off and guards remoteLive; each transition publishes its status
	// before releasing it, so events arrive in order. A tunnel onState callback never takes it: Off holds
	// it across tunnel.Stop, which waits on that callback.
	remoteMu   sync.Mutex
	remoteLive *remoteRun

	// remoteStateMu guards what Status reports about the running state, and is never held across a call
	remoteStateMu     sync.Mutex
	remoteOn          bool
	remoteTunnelState = TunnelOff
	remoteTunnelErr   string
)

// Setup stores what the owner gives it; a field left empty keeps its stored value, so one flag can be
// changed alone. The VAPID pair is generated only when none is stored and subscriptions are kept, so a
// re-setup does not orphan a phone that already subscribed. While on, remote mode restarts with the new
// setup, since the listener, tunnel and token check were built from the old one.
func Setup(data wshrpc.CommandRemoteSetupData) (*wshrpc.RemoteStatusData, error) {
	if err := remoteValidateSetup(data); err != nil {
		return nil, err
	}
	err := remoteUpdateConfig(func(cfg *Config) error {
		remoteApplySetup(cfg, data)
		if cfg.VapidPrivate != "" && cfg.VapidPublic != "" {
			return nil
		}
		var err error
		cfg.VapidPrivate, cfg.VapidPublic, err = remoteNewVapidPair()
		return err
	})
	if err != nil {
		return nil, err
	}
	err = remoteRestartIfOn()
	publishStatus()
	if err != nil {
		return nil, fmt.Errorf("setup is saved, but restarting remote mode with it failed: %w", err)
	}
	return Status(), nil
}

func remoteValidateSetup(data wshrpc.CommandRemoteSetupData) error {
	if team := strings.TrimSpace(data.Team); team != "" && !remoteTeamRe.MatchString(team) {
		return fmt.Errorf("team must be the bare team name, e.g. \"acme\" for acme.cloudflareaccess.com")
	}
	if host := strings.TrimSpace(data.Hostname); strings.ContainsAny(host, "/:?#@ ") {
		return fmt.Errorf("hostname must be a bare host name with no scheme, port or path, e.g. \"arc.example.com\"")
	}
	if email := strings.TrimSpace(data.Email); email != "" && !strings.Contains(email, "@") {
		return fmt.Errorf("email must be an address containing @")
	}
	if p := data.Port; p != 0 && (p < remoteMinPort || p > remoteMaxPort) {
		return fmt.Errorf("port must be %d-%d, or 0 for the default (%d)", remoteMinPort, remoteMaxPort, DefaultPort)
	}
	return nil
}

func remoteApplySetup(cfg *Config, data wshrpc.CommandRemoteSetupData) {
	set := func(dst *string, v string) {
		if v = strings.TrimSpace(v); v != "" {
			*dst = v
		}
	}
	set(&cfg.TunnelToken, data.TunnelToken)
	set(&cfg.Team, data.Team)
	set(&cfg.Aud, data.Aud)
	set(&cfg.Email, data.Email)
	set(&cfg.Hostname, strings.ToLower(data.Hostname))
	switch {
	case data.Port != 0:
		cfg.Port = data.Port
	case cfg.Port == 0:
		cfg.Port = DefaultPort
	}
}

func remoteNewVapidPair() (private, public string, err error) {
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate vapid key: %w", err)
	}
	enc := base64.RawURLEncoding
	return enc.EncodeToString(key.Bytes()), enc.EncodeToString(key.PublicKey().Bytes()), nil
}

// remoteUpdateConfig is the only way to change the stored config; modify's error discards the change.
func remoteUpdateConfig(modify func(*Config) error) error {
	remoteConfigMu.Lock()
	defer remoteConfigMu.Unlock()
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	if err := modify(&cfg); err != nil {
		return err
	}
	return SaveConfig(cfg)
}

func remoteSaveOn(on bool) error {
	return remoteUpdateConfig(func(cfg *Config) error {
		cfg.On = on
		return nil
	})
}

// Status never carries the tunnel token. On is whether remote mode is running now, not the stored flag:
// after a failed start at boot the flag stays set while On is false, with the failure in TunnelError.
func Status() *wshrpc.RemoteStatusData {
	remoteStateMu.Lock()
	st := &wshrpc.RemoteStatusData{On: remoteOn, Tunnel: remoteTunnelState, TunnelError: remoteTunnelErr}
	remoteStateMu.Unlock()
	st.Handed = handStatusTabs()
	cfg, err := LoadConfig()
	if err != nil {
		st.TunnelError = err.Error()
		return st
	}
	st.Missing = cfg.Missing()
	st.Team, st.Aud, st.Email = cfg.Team, cfg.Aud, cfg.Email
	st.Hostname = cfg.Hostname
	st.Port = cfg.ListenPort()
	st.Subscriptions = len(cfg.Subscriptions)
	_, findErr := remoteFindCloudflared()
	st.CloudflaredMissing = findErr != nil
	return st
}

// On starts the phone listener, cloudflared, keep-awake and the pusher, and stores that remote mode is
// on. It does nothing when already on, and leaves nothing running when it fails.
func On() (*wshrpc.RemoteStatusData, error) {
	remoteMu.Lock()
	err := remoteStartLocked()
	publishStatus()
	remoteMu.Unlock()
	if err != nil {
		return nil, err
	}
	return Status(), nil
}

// Off stops everything On started and stores that remote mode is off. It is safe to call when off.
func Off() (*wshrpc.RemoteStatusData, error) {
	if err := remoteTurnOff(); err != nil {
		return nil, err
	}
	return Status(), nil
}

// remoteTurnOff is the one off path (desk, wsh, phone), so it alone ends the hand-overs; remoteStopLocked
// leaves them, so a re-setup's restart keeps them.
func remoteTurnOff() error {
	remoteMu.Lock()
	defer remoteMu.Unlock()
	remoteStopLocked()
	handClearOff()
	err := remoteSaveOn(false)
	publishStatus()
	return err
}

// Restore turns remote mode back on at wavesrv start when it was on. A failure is logged and the stored
// flag stays on, so the next start tries again.
func Restore() {
	cfg, err := LoadConfig()
	if err != nil {
		log.Printf("remote mode: restore at start: %v\n", err)
		return
	}
	if !cfg.On {
		return
	}
	remoteMu.Lock()
	err = remoteStartLocked()
	publishStatus()
	remoteMu.Unlock()
	if err != nil {
		log.Printf("remote mode: turning back on at start failed, the next start tries again: %v\n", err)
	}
}

func remoteRestartIfOn() error {
	remoteMu.Lock()
	defer remoteMu.Unlock()
	if remoteLive == nil {
		return nil
	}
	remoteStopLocked()
	return remoteStartLocked()
}

// remoteStartLocked refuses an incomplete setup before building anything from it: the token check
// trusts its inputs, and an empty email or issuer would weaken it.
func remoteStartLocked() (err error) {
	if remoteLive != nil {
		return nil
	}
	defer func() {
		if err != nil {
			remoteSetTunnel(TunnelOff, err.Error())
		}
	}()
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	if missing := cfg.Missing(); len(missing) > 0 {
		return fmt.Errorf("remote mode setup is incomplete, missing %s: run `wsh remote setup`", strings.Join(missing, ", "))
	}
	path, err := remoteFindCloudflared()
	if err != nil {
		return fmt.Errorf("remote mode needs cloudflared: install it with `%s`", remoteWingetLine)
	}
	port := cfg.ListenPort()
	addr := net.JoinHostPort(remoteHost, strconv.Itoa(port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("remote mode cannot listen on %s, is another program using port %d? %w", addr, port, err)
	}
	runCtx, cancel := context.WithCancel(context.Background())
	run := &remoteRun{cancel: cancel, ln: ln}
	run.srv = &http.Server{Handler: NewHandler(remoteDeps(cfg, runCtx)), ReadHeaderTimeout: remoteReadHeaderTimeout}
	go remoteServe(run.srv, ln)
	run.tunnel, err = remoteStartTunnel(path, cfg.TunnelToken, remoteOnTunnelState)
	if err != nil {
		cancel()
		run.srv.Close()
		return fmt.Errorf("remote mode: %w", err)
	}
	run.release = remoteKeepAwake()
	run.stopPusher = startPusher()
	if err := remoteSaveOn(true); err != nil {
		remoteStopRun(run)
		return err
	}
	remoteLive = run
	remoteStateMu.Lock()
	remoteOn = true
	remoteStateMu.Unlock()
	return nil
}

func remoteStopLocked() {
	if remoteLive == nil {
		return
	}
	remoteStopRun(remoteLive)
	remoteLive = nil
	remoteStateMu.Lock()
	remoteOn = false
	remoteStateMu.Unlock()
}

func remoteStopRun(run *remoteRun) {
	run.cancel()
	run.stopPusher()
	run.tunnel.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), remoteShutdownTimeout)
	defer cancel()
	if err := run.srv.Shutdown(ctx); err != nil {
		run.srv.Close()
	}
	run.release()
}

func remoteServe(srv *http.Server, ln net.Listener) {
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("remote mode: phone listener: %v\n", err)
	}
}

func remoteOnTunnelState(state, lastErr string) {
	remoteSetTunnel(state, lastErr)
	publishStatus()
}

func remoteSetTunnel(state, lastErr string) {
	remoteStateMu.Lock()
	defer remoteStateMu.Unlock()
	remoteTunnelState, remoteTunnelErr = state, lastErr
}

func remoteDeps(cfg Config, runCtx context.Context) Deps {
	verifier := NewAccessVerifier(TeamCertsURL(cfg.Team), TeamIssuer(cfg.Team), cfg.Aud, cfg.Email, remoteAccessClient)
	return Deps{
		Static:      web.FS,
		Verify:      verifier.Verify,
		Origin:      "https://" + cfg.Hostname,
		VapidPublic: cfg.VapidPublic,
		Waiting:     remoteWaitingList,
		Answer:      remoteAnswer,
		Off:         func(context.Context) error { return remoteTurnOff() },
		Subscribe: func(_ context.Context, sub PushSubscription) error {
			return remoteSubscribe(sub)
		},
		Handed: remoteHanded,
		Stream: func(ctx context.Context, tab string, sink StreamSink) error {
			ctx, cancel := context.WithCancel(ctx)
			defer cancel()
			defer context.AfterFunc(runCtx, cancel)()
			return remoteStream(ctx, tab, sink)
		},
		Act:      remoteAct,
		TakeBack: remoteTakeBack,
	}
}

func remoteGatherWaiting(ctx context.Context) (WaitingList, error) {
	items, err := jarvis.GatherAttention(ctx)
	if err != nil {
		return WaitingList{}, fmt.Errorf("gather what is waiting: %w", err)
	}
	blockInfo := func(oref string) (string, string) { return remoteBlockInfo(ctx, oref) }
	return BuildWaiting(items, agentask.GlobalRegistry.List(), blockInfo), nil
}

// remoteBlockInfo gives an ask block's agent runtime, which its tab carries, and the folder name of its
// cwd; each is "" when absent.
func remoteBlockInfo(ctx context.Context, oref string) (runtime, project string) {
	o, err := waveobj.ParseORef(oref)
	if err != nil || o.OType != waveobj.OType_Block {
		return "", ""
	}
	block, err := wstore.DBGet[*waveobj.Block](ctx, o.OID)
	if err != nil || block == nil {
		return "", ""
	}
	if cwd := block.Meta.GetString(waveobj.MetaKey_CmdCwd, ""); cwd != "" {
		project = filepath.Base(cwd)
	}
	tabORef, err := waveobj.ParseORef(block.ParentORef)
	if err != nil || tabORef.OType != waveobj.OType_Tab {
		return "", project
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabORef.OID)
	if err != nil || tab == nil {
		return "", project
	}
	return tab.Meta.GetString(waveobj.MetaKey_SessionAgent, ""), project
}

// remoteAnswer goes through the cockpit's delivery path; the ask id must match the pending ask, so an
// answer to a question answered at the desk, or replaced by the agent's next one, is refused.
func remoteAnswer(_ context.Context, oref, askID string, answers []baseds.AgentAnswerItem) error {
	_, err := agentask.DeliverAnswer(oref, askID, answers)
	if errors.Is(err, agentask.ErrNoPendingAsk) {
		return ErrAskGone
	}
	return err
}

// remoteSubscribe replaces a stored subscription with the same endpoint, so a phone that subscribes
// again is not pushed twice.
func remoteSubscribe(sub PushSubscription) error {
	err := remoteUpdateConfig(func(cfg *Config) error {
		cfg.Subscriptions = append(slices.DeleteFunc(cfg.Subscriptions, func(s PushSubscription) bool {
			return s.Endpoint == sub.Endpoint
		}), sub)
		return nil
	})
	if err != nil {
		return err
	}
	publishStatus()
	return nil
}

func publishStatus() {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_RemoteStatus, Data: Status()})
}
