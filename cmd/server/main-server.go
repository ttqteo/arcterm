// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"runtime"
	"sync"
	"time"

	"github.com/joho/godotenv"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/claudeaccount"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/harnessupdate"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisvolunteer"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/wshfs"
	"github.com/wavetermdev/waveterm/pkg/reporadar"
	"github.com/wavetermdev/waveterm/pkg/service"
	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
	"github.com/wavetermdev/waveterm/pkg/sleepwatch"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/sigutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/web"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshremote"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshserver"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"

	"net/http"
	_ "net/http/pprof"
)

// these are set at build time
var WaveVersion = "0.0.0"
var BuildTime = "0"

const TempAttachmentSweepInterval = 4 * time.Hour

var shutdownOnce sync.Once
var initConfigWatcher = wconfig.InitWatcher

func init() {
	envFilePath := os.Getenv("WAVETERM_ENVFILE")
	if envFilePath != "" {
		log.Printf("applying env file: %s\n", envFilePath)
		_ = godotenv.Load(envFilePath)
	}
}

func doShutdown(reason string) {
	shutdownOnce.Do(func() {
		log.Printf("shutting down: %s\n", reason)
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		go blockcontroller.StopAllBlockControllersForShutdown()
		// TODO deal with flush in progress
		clearTempFiles()
		filestore.WFS.FlushCache(ctx)
		watcher, err := wconfig.InitWatcher()
		if err == nil {
			watcher.Close()
		}
		time.Sleep(500 * time.Millisecond)
		log.Printf("shutdown complete\n")
		os.Exit(0)
	})
}

// watch stdin, kill server if stdin is closed
func stdinReadWatch() {
	defer func() {
		panichandler.PanicHandler("stdinReadWatch", recover())
	}()
	buf := make([]byte, 1024)
	for {
		_, err := os.Stdin.Read(buf)
		if err != nil {
			doShutdown(fmt.Sprintf("stdin closed/error (%v)", err))
			break
		}
	}
}

func startConfigWatcher() error {
	watcher, err := initConfigWatcher()
	if err != nil {
		return fmt.Errorf("initializing config watcher: %w", err)
	}
	watcher.Start()
	return nil
}

// sweeps stale channel-composer attachment temp dirs, canvas feedback pictures, final-stage screenshots and the
// output of terminals idle for a month. First iteration runs
// immediately (startup sweep of files left by prior sessions), then periodically for very long-running sessions.
func tempAttachmentCleanupLoop() {
	defer func() {
		panichandler.PanicHandler("tempAttachmentCleanupLoop", recover())
	}()
	for {
		wshserver.SweepTempAttachments()
		wshserver.SweepCanvasFeedback()
		orchestrate.SweepFinalShots(time.Now())
		blockcontroller.SweepIdleTerminalOutput()
		time.Sleep(TempAttachmentSweepInterval)
	}
}

// retryCleanupDebtAtStartup sweeps worktree-cleanup debt left by a previous process (interrupted
// or failed merges/cancels) through the same idempotent helper the merge path uses, so an old
// locked worktree cannot strand a merged task forever. Best effort: a still-stuck tree stays on
// the dag as debt (digest attention) until the next startup or retry — startup never fails over
// cleanup, and the sweep never re-runs content integration.
func retryCleanupDebtAtStartup() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	groups, err := wstore.GetDagsWithPendingCleanup(ctx)
	if err != nil {
		log.Printf("error loading cleanup debt at startup: %v\n", err)
		return
	}
	for _, g := range groups {
		// records and logs its own results
		orchestrate.RetryCleanupDebt(ctx, g.OID)
	}
}

// publishNotice raises a backend notice (vault sync, a harness update) through the same event NotifyCommand publishes.
func publishNotice(title, message, level string) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_Notify, Data: wshrpc.NotifyCommandData{Title: title, Message: message, Level: level}})
}

// harnessUpdateCheckEnabled reads harness:updatecheck at each check, so turning it off in Settings takes effect without
// a restart; unset is on.
func harnessUpdateCheckEnabled() bool {
	v := wconfig.GetWatcher().GetFullConfig().Settings.HarnessUpdateCheck
	return v == nil || *v
}

func createMainWshClient() {
	rpc := wshserver.GetMainRpcClient()
	wshutil.DefaultRouter.RegisterTrustedLeaf(rpc, wshutil.DefaultRoute)
	wps.Broker.SetClient(wshutil.DefaultRouter)
	localInitialEnv := envutil.PruneInitialEnv(envutil.SliceToMap(os.Environ()))
	sockName := wavebase.GetDomainSocketName()
	remoteImpl := wshremote.MakeRemoteRpcServerImpl(nil, wshutil.DefaultRouter, wshclient.GetBareRpcClient(), true, localInitialEnv, sockName)
	localConnWsh := wshutil.MakeWshRpc(wshrpc.RpcContext{Conn: wshrpc.LocalConnName}, remoteImpl, "conn:local")
	wshutil.DefaultRouter.RegisterTrustedLeaf(localConnWsh, wshutil.MakeConnectionRouteId(wshrpc.LocalConnName))
	wshfs.RpcClient = localConnWsh
	wshfs.RpcClientRouteId = wshutil.MakeConnectionRouteId(wshrpc.LocalConnName)
}

func grabAndRemoveEnvVars() error {
	err := authkey.SetAuthKeyFromEnv()
	if err != nil {
		return fmt.Errorf("setting auth key: %v", err)
	}
	err = wavebase.CacheAndRemoveEnvVars()
	if err != nil {
		return err
	}
	// before the config hook's first ApplyEnv, so Default can put back what wavesrv was started with
	claudeaccount.CaptureInherited()

	// Remove WAVETERM env vars that leak from prod => dev
	os.Unsetenv("WAVETERM_CLIENTID")
	os.Unsetenv("WAVETERM_WORKSPACEID")
	os.Unsetenv("WAVETERM_TABID")
	os.Unsetenv("WAVETERM_BLOCKID")
	os.Unsetenv("WAVETERM_CONN")
	os.Unsetenv("WAVETERM_JWT")
	os.Unsetenv("WAVETERM_VERSION")

	return nil
}

func clearTempFiles() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client: %v", err)
	}
	filestore.WFS.DeleteZone(ctx, client.TempOID)
	return nil
}

func maybeStartPprofServer() {
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if settings.DebugPprofMemProfileRate != nil {
		runtime.MemProfileRate = *settings.DebugPprofMemProfileRate
		log.Printf("set runtime.MemProfileRate to %d\n", runtime.MemProfileRate)
	}
	if settings.DebugPprofPort == nil {
		return
	}
	pprofPort := *settings.DebugPprofPort
	if pprofPort < 1 || pprofPort > 65535 {
		log.Printf("[error] debug:pprofport must be between 1 and 65535, got %d\n", pprofPort)
		return
	}
	go func() {
		addr := fmt.Sprintf("localhost:%d", pprofPort)
		log.Printf("starting pprof server on %s\n", addr)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Printf("[error] pprof server failed: %v\n", err)
		}
	}()
}

func main() {
	log.SetFlags(0) // disable timestamp since the tauri host's applog already timestamps each stderr line
	log.SetPrefix("[wavesrv] ")
	wavebase.WaveVersion = WaveVersion
	wavebase.BuildTime = BuildTime
	wshutil.DefaultRouter = wshutil.NewWshRouter()
	wshutil.DefaultRouter.SetAsRootRouter()

	err := grabAndRemoveEnvVars()
	if err != nil {
		log.Printf("[error] %v\n", err)
		return
	}
	err = service.ValidateServiceMap()
	if err != nil {
		log.Printf("error validating service map: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveDataDir()
	if err != nil {
		log.Printf("error ensuring wave home dir: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveDBDir()
	if err != nil {
		log.Printf("error ensuring wave db dir: %v\n", err)
		return
	}
	err = wavebase.EnsureWaveConfigDir()
	if err != nil {
		log.Printf("error ensuring wave config dir: %v\n", err)
		return
	}

	err = wavebase.EnsureWaveCachesDir()
	if err != nil {
		log.Printf("error ensuring wave caches dir: %v\n", err)
		return
	}
	waveLock, err := wavebase.AcquireWaveLock()
	if err != nil {
		log.Printf("error acquiring wave lock (another instance of Wave is likely running): %v\n", err)
		return
	}
	defer func() {
		err = waveLock.Close()
		if err != nil {
			log.Printf("error releasing wave lock: %v\n", err)
		}
	}()
	log.Printf("wave version: %s (%s)\n", WaveVersion, BuildTime)
	log.Printf("wave data dir: %s\n", wavebase.GetWaveDataDir())
	log.Printf("wave config dir: %s\n", wavebase.GetWaveConfigDir())
	err = filestore.InitFilestore()
	if err != nil {
		log.Printf("error initializing filestore: %v\n", err)
		return
	}
	err = wstore.InitWStore()
	if err != nil {
		log.Printf("error initializing wstore: %v\n", err)
		return
	}
	// before the first config read (the watcher inits lazily) and before the efforts, which resolve the vault from config
	wconfig.OnVaultLayerWrite = wavevault.Poke
	if err := wconfig.MigrateSettingsToVault(); err != nil {
		log.Printf("error migrating settings to the vault: %v\n", err)
	}
	if err := jarvis.MigrateGlobalProfile(); err != nil {
		log.Printf("error migrating the jarvis profile to the vault: %v\n", err)
	}
	if n, err := effortstore.MigrateFromDB(context.Background()); err != nil {
		log.Printf("error migrating efforts to the vault (moved %d): %v\n", n, err)
	} else if n > 0 {
		log.Printf("migrated %d efforts from the db to the vault\n", n)
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("InitCustomShellStartupFiles", recover())
		}()
		err := shellutil.InitCustomShellStartupFiles()
		if err != nil {
			log.Printf("error initializing wsh and shell-integration files: %v\n", err)
		}
	}()
	firstLaunch, err := wcore.EnsureInitialData()
	if err != nil {
		log.Printf("error ensuring initial data: %v\n", err)
		return
	}
	if firstLaunch {
		log.Printf("first launch detected")
	}
	reporadar.RecoverInterruptedScans(context.Background())
	err = clearTempFiles()
	if err != nil {
		log.Printf("error clearing temp files: %v\n", err)
		return
	}
	err = wcore.InitMainServer()
	if err != nil {
		log.Printf("error initializing mainserver: %v\n", err)
		return
	}

	err = shellutil.FixupWaveZshHistory()
	if err != nil {
		log.Printf("error fixing up wave zsh history: %v\n", err)
	}
	createMainWshClient()
	retryCleanupDebtAtStartup()
	sigutil.InstallShutdownSignalHandlers(doShutdown)
	sigutil.InstallSIGUSR1Handler()
	if err := jarvis.MigrateTierPins(context.Background()); err != nil {
		log.Printf("error migrating route tier pins: %v\n", err)
	}
	wconfig.ConfigHook = func(fc wconfig.FullConfigType) {
		wshserver.SyncProjectChannels(context.Background(), fc.Projects)
		claudeaccount.ApplyEnv(fc.Settings.ClaudeActiveAccount)
	}
	err = startConfigWatcher()
	if err != nil {
		log.Printf("error starting config watcher: %v\n", err)
		return
	}
	// after the config watcher: each run resolves the vault path from config
	wavevault.StartSyncLoop(context.Background(), publishNotice)
	harnessupdate.StartLoop(context.Background(), harnessUpdateCheckEnabled, publishNotice)
	maybeStartPprofServer()
	go stdinReadWatch()
	go tempAttachmentCleanupLoop()
	// trashed sessions older than 7 days are removed: now, then daily
	sessiontrash.StartPurgeLoop(context.Background())
	// the machine slept: the pet says so when agents were working through it
	sleepwatch.StartLoop(context.Background(), func(d baseds.SleptData) {
		wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_Slept, Data: d})
	})
	orchestrate.SealRunEvidenceHook = wshserver.SealDoneRunEvidenceAsync // a run the engine closed itself gets the same evidence snapshot `wsh jarvis complete` produces; before StartWatchdog, whose first tick is immediate and can be the tick that closes one
	orchestrate.LaunchLeadHook = wshserver.LaunchPlanLead                // a run submitted with no lead gets one at its first judgment event; before StartWatchdog, whose first tick can deliver one
	orchestrate.MarkInterruptedRuns(context.Background())                // no worker survives a restart; the previous wavesrv's non-dag runs would otherwise read executing forever
	orchestrate.ResumeInterruptedLeads(context.Background())             // nor does a dag run's lead, and unlike its workers nothing else restarts it
	orchestrate.StartWatchdog(context.Background())                      // dag advance + stall detection tick
	agentask.AnswerHook = wshserver.RecordAskAnswered                    // one ask lifecycle row per delivered answer, whichever surface delivered it
	blocklogger.InitBlockLogger()
	blockcontroller.InitBlockController()
	blockcontroller.RestoreLiveAgents(context.Background()) // an update or a crash kills every agent, and nothing else restarts one
	jarvisvolunteer.StartLooseEndSweep(context.Background())
	err = wcore.InitBadgeStore()
	if err != nil {
		log.Printf("error initializing badge store: %v\n", err)
		return
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("GetSystemSummary", recover())
		}()
		wavebase.GetSystemSummary()
	}()

	webListener, err := web.MakeTCPListener("web")
	if err != nil {
		log.Printf("error creating web listener: %v\n", err)
		return
	}
	wsListener, err := web.MakeTCPListener("websocket")
	if err != nil {
		log.Printf("error creating websocket listener: %v\n", err)
		return
	}
	go web.RunWebSocketServer(wsListener)
	unixListener, err := web.MakeUnixListener()
	if err != nil {
		log.Printf("error creating unix listener: %v\n", err)
		return
	}
	go func() {
		if BuildTime == "" {
			BuildTime = "0"
		}
		// use fmt instead of log here to make sure it goes directly to stderr
		fmt.Fprintf(os.Stderr, "WAVESRV-ESTART ws:%s web:%s version:%s buildtime:%s\n", wsListener.Addr(), webListener.Addr(), WaveVersion, BuildTime)
	}()
	go wshutil.RunWshRpcOverListener(unixListener, nil)
	web.RunWebServer(webListener) // blocking
	runtime.KeepAlive(waveLock)
}
