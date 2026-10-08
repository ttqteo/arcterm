// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	BlockController_Shell = "shell"
	BlockController_Cmd   = "cmd"
)

const (
	Status_Running = "running"
	Status_Done    = "done"
	Status_Init    = "init"
)

const (
	DefaultTermMaxFileSize = 2 * 1024 * 1024
	DefaultHtmlMaxFileSize = 256 * 1024
	MaxInitScriptSize      = 50 * 1024
)

const DefaultTimeout = 2 * time.Second
const DefaultGracefulKillWait = 400 * time.Millisecond

// AgentStatusEvent builds the retained agent:status event the roster keys off. Shared by the
// run-worker spawn emit (working) and the process-exit emit (idle) so their shape cannot drift.
// Persist:1 so a late-subscribing frontend replays the last state.
func AgentStatusEvent(blockId, state, agent string, ts int64) wps.WaveEvent {
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	return wps.WaveEvent{
		Event:   wps.Event_AgentStatus,
		Scopes:  []string{oref},
		Persist: 1,
		Data: baseds.AgentStatusData{
			ORef:  oref,
			State: state,
			Agent: agent,
			Ts:    ts,
		},
	}
}

type BlockInputUnion struct {
	InputData []byte            `json:"inputdata,omitempty"`
	SigName   string            `json:"signame,omitempty"`
	TermSize  *waveobj.TermSize `json:"termsize,omitempty"`
}

type BlockControllerRuntimeStatus struct {
	BlockId           string `json:"blockid"`
	Version           int64  `json:"version"`
	ShellProcStatus   string `json:"shellprocstatus,omitempty"`
	ShellProcConnName string `json:"shellprocconnname,omitempty"`
	ShellProcExitCode int    `json:"shellprocexitcode"`
	LastOutputTs      int64  `json:"lastoutputts,omitempty"`
}

// Controller interface that all block controllers must implement
type Controller interface {
	Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error
	Stop(graceful bool, newStatus string, destroy bool)
	GetRuntimeStatus() *BlockControllerRuntimeStatus // does not return nil
	GetConnName() string
	SendInput(input *BlockInputUnion) error
}

// Registry for all controllers
var (
	controllerRegistry  = make(map[string]Controller)
	registryLock        sync.RWMutex
	blockResyncMutexMap = ds.MakeSyncMap[*sync.Mutex]()
)

// blockLastOutputTs is the most recent time (ms) each block appended terminal output — always
// current, read by the runtime-status getters. blockLastPublishAt is the last time that output was
// actually broadcast, which outputPublishDue throttles against; the two differ because output arrives
// far more often than we want to wake every subscriber.
var (
	blockLastOutputTs  = ds.MakeSyncMap[int64]()
	blockLastPublishAt = ds.MakeSyncMap[int64]()
)

// outputPublishInterval bounds how stale a working agent's published last-output time can be. It sits far under
// the frontend's hung threshold, so continuous output never reads as silence.
const outputPublishInterval = 30 * time.Second

// outputPublishDue reports whether a block's newest output is worth republishing: its first output, or the first
// after outputPublishInterval since the last publish.
func outputPublishDue(lastPublished, now int64) bool {
	return lastPublished == 0 || now-lastPublished >= outputPublishInterval.Milliseconds()
}

// recordAndMaybePublishOutput stamps a block's last-output time and, throttled to outputPublishInterval,
// broadcasts its runtime status so the frontend can tell a silent terminal from one that never had a
// controller in the first place. No-op if the block has no registered controller.
func recordAndMaybePublishOutput(blockId string, now int64) {
	blockLastOutputTs.Set(blockId, now)
	if !outputPublishDue(blockLastPublishAt.Get(blockId), now) {
		return
	}
	blockLastPublishAt.Set(blockId, now)
	controller := getController(blockId)
	if controller == nil {
		return
	}
	status := controller.GetRuntimeStatus()
	scopes := []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String()}
	if tabId, err := wstore.DBFindTabForBlockId(context.Background(), blockId); err == nil && tabId != "" {
		scopes = append([]string{waveobj.MakeORef(waveobj.OType_Tab, tabId).String()}, scopes...)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_ControllerStatus,
		Scopes: scopes,
		Data:   *status,
	})
}

func getBlockResyncMutex(blockId string) *sync.Mutex {
	return blockResyncMutexMap.GetOrCreate(blockId, func() *sync.Mutex {
		return &sync.Mutex{}
	})
}

// Registry operations
func getController(blockId string) Controller {
	registryLock.RLock()
	defer registryLock.RUnlock()
	return controllerRegistry[blockId]
}

func registerController(blockId string, controller Controller) {
	var existingController Controller

	registryLock.Lock()
	existing, exists := controllerRegistry[blockId]
	if exists {
		existingController = existing
	}
	controllerRegistry[blockId] = controller
	registryLock.Unlock()

	if existingController != nil {
		existingController.Stop(false, Status_Done, true)
		wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
	}
}

func deleteController(blockId string) {
	registryLock.Lock()
	defer registryLock.Unlock()
	delete(controllerRegistry, blockId)
}

func getAllControllers() map[string]Controller {
	registryLock.RLock()
	defer registryLock.RUnlock()
	// Return a copy to avoid lock issues
	result := make(map[string]Controller)
	for k, v := range controllerRegistry {
		result[k] = v
	}
	return result
}

func InitBlockController() {
	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_BlockClose, handleBlockCloseEvent)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_BlockClose,
		AllScopes: true,
	}, nil)
}

func handleBlockCloseEvent(event *wps.WaveEvent) {
	blockId, ok := event.Data.(string)
	if !ok {
		log.Printf("[blockclose] invalid event data type")
		return
	}
	go DestroyBlockController(blockId)
}

// Public API Functions

func ResyncController(ctx context.Context, tabId string, blockId string, rtOpts *waveobj.RuntimeOpts, force bool) error {
	if tabId == "" || blockId == "" {
		return fmt.Errorf("invalid tabId or blockId passed to ResyncController")
	}

	mu := getBlockResyncMutex(blockId)
	mu.Lock()
	defer mu.Unlock()

	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}

	controllerName := blockData.Meta.GetString(waveobj.MetaKey_Controller, "")
	connName := blockData.Meta.GetString(waveobj.MetaKey_Connection, "")

	// Get existing controller
	existing := getController(blockId)

	// Check for connection change FIRST - always destroy on conn change
	if existing != nil {
		existingConnName := existing.GetConnName()
		if existingConnName != connName {
			log.Printf("stopping blockcontroller %s due to conn change (from %q to %q)\n", blockId, existingConnName, connName)
			DestroyBlockController(blockId)
			time.Sleep(100 * time.Millisecond)
			existing = nil
		}
	}

	// If no controller needed, stop existing if present
	if controllerName == "" {
		if existing != nil {
			DestroyBlockController(blockId)
		}
		return nil
	}

	// Check if we need to morph controller type
	if existing != nil {
		_, isShell := existing.(*ShellController)
		needsReplace := !isShell || (controllerName != BlockController_Shell && controllerName != BlockController_Cmd)

		if needsReplace {
			log.Printf("stopping blockcontroller %s due to controller type change\n", blockId)
			DestroyBlockController(blockId)
			time.Sleep(100 * time.Millisecond)
			existing = nil
		}
	}

	// Force restart if requested
	if force && existing != nil {
		DestroyBlockController(blockId)
		time.Sleep(100 * time.Millisecond)
		existing = nil
	}

	// Destroy done controllers before restarting
	if existing != nil {
		status := existing.GetRuntimeStatus()
		if status.ShellProcStatus == Status_Done {
			log.Printf("destroying blockcontroller %s with done status before restart\n", blockId)
			DestroyBlockController(blockId)
			time.Sleep(100 * time.Millisecond)
			existing = nil
		}
	}

	// Create or restart controller
	var controller Controller
	if existing != nil {
		controller = existing
	} else {
		// Create new controller based on type
		switch controllerName {
		case BlockController_Shell, BlockController_Cmd:
			controller = MakeShellController(tabId, blockId, controllerName, connName)
			registerController(blockId, controller)

		default:
			return fmt.Errorf("unknown controller type %q", controllerName)
		}
	}

	// Check if we need to start/restart
	status := controller.GetRuntimeStatus()
	if status.ShellProcStatus == Status_Init {
		if (controllerName == BlockController_Shell || controllerName == BlockController_Cmd) && !isLocalConnName(connName) {
			return fmt.Errorf("cannot start shellproc: remote connections are not supported (%q)", connName)
		}

		// Start controller
		err = controller.Start(ctx, blockData.Meta, rtOpts, force)
		if err != nil {
			return fmt.Errorf("error starting controller: %w", err)
		}
	}

	return nil
}

func GetBlockControllerRuntimeStatus(blockId string) *BlockControllerRuntimeStatus {
	controller := getController(blockId)
	if controller == nil {
		return nil
	}
	return controller.GetRuntimeStatus()
}

// GetBlockControllerPid is the OS pid of a block's local shell process, or 0 when there is none to read
// (remote and wsl blocks, or a block that has not started).
func GetBlockControllerPid(blockId string) int {
	sc, ok := getController(blockId).(*ShellController)
	if !ok || sc == nil {
		return 0
	}
	sc.Lock.Lock()
	defer sc.Lock.Unlock()
	if sc.ShellProc == nil {
		return 0
	}
	cw, ok := sc.ShellProc.Cmd.(shellexec.CmdWrap)
	if !ok || cw.Cmd == nil || cw.Cmd.Process == nil {
		return 0
	}
	return cw.Cmd.Process.Pid
}

func DestroyBlockController(blockId string) {
	controller := getController(blockId)
	if controller == nil {
		return
	}
	controller.Stop(true, Status_Done, true)
	wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
	deleteController(blockId)
	blockLastOutputTs.Delete(blockId)
	blockLastPublishAt.Delete(blockId)
}

// "local:<shell>" names pick a local shell variant; every other connection name is a remote host.
func isLocalConnName(connName string) bool {
	return strings.HasPrefix(connName, "local:") || connName == "local" || connName == ""
}

func SendInput(blockId string, inputUnion *BlockInputUnion) error {
	controller := getController(blockId)
	if controller == nil {
		return fmt.Errorf("no controller found for block %s", blockId)
	}
	return controller.SendInput(inputUnion)
}

// shuttingDown is set once the server starts stopping every controller: a quit kills every worker, and that is
// not a worker failure for any exit reconciler to act on.
var shuttingDown atomic.Bool

// exitHook is the outcome hook an exited block should run, or nil while the server shuts down.
func exitHook() func(blockId string, exitCode int) {
	if shuttingDown.Load() {
		return nil
	}
	return AgentOutcomeHook
}

// only call this on shutdown
func StopAllBlockControllersForShutdown() {
	shuttingDown.Store(true)
	controllers := getAllControllers()
	for blockId, controller := range controllers {
		status := controller.GetRuntimeStatus()
		if status != nil && status.ShellProcStatus == Status_Running {
			go func(id string, c Controller) {
				c.Stop(true, Status_Done, false)
				wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, id))
			}(blockId, controller)
		}
	}
}

func getBoolFromMeta(meta map[string]any, key string, def bool) bool {
	ival, found := meta[key]
	if !found || ival == nil {
		return def
	}
	if val, ok := ival.(bool); ok {
		return val
	}
	return def
}

func getTermSize(bdata *waveobj.Block) waveobj.TermSize {
	if bdata.RuntimeOpts != nil {
		return bdata.RuntimeOpts.TermSize
	} else {
		return waveobj.TermSize{
			Rows: 25,
			Cols: 80,
		}
	}
}

func HandleAppendBlockFile(blockId string, blockFile string, data []byte) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.AppendData(ctx, blockId, blockFile, data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile: %w", err)
	}
	if blockFile == wavebase.BlockFile_Term {
		recordAndMaybePublishOutput(blockId, time.Now().UnixMilli())
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_BlockFile,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   wps.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
}

func HandleTruncateBlockFile(blockId string) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.WriteFile(ctx, blockId, wavebase.BlockFile_Term, nil)
	if err == fs.ErrNotExist {
		return nil
	}
	if err != nil {
		return fmt.Errorf("error truncating blockfile: %w", err)
	}
	err = filestore.WFS.DeleteFile(ctx, blockId, wavebase.BlockFile_Cache)
	if err == fs.ErrNotExist {
		err = nil
	}
	if err != nil {
		log.Printf("error deleting cache file (continuing): %v\n", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: wavebase.BlockFile_Term,
			FileOp:   wps.FileOp_Truncate,
		},
	})
	return nil

}

// A session tab is kept for good and so was its terminal output, up to 2 MB each: 426 MB across 342 terminals,
// 264 MB of it not written to for over a month. The tab and the agent's transcript outlive the output.
const TermOutputRetention = 30 * 24 * time.Hour

// SweepIdleTerminalOutput deletes the stored output of terminals that have printed nothing for
// TermOutputRetention and are not running. Such a terminal opens empty, as a new one does.
func SweepIdleTerminalOutput() {
	ctx, cancelFn := context.WithTimeout(context.Background(), time.Minute)
	defer cancelFn()
	running := func(blockId string) bool {
		status := GetBlockControllerRuntimeStatus(blockId)
		return status != nil && status.ShellProcStatus == Status_Running
	}
	cutoff := time.Now().Add(-TermOutputRetention)
	cleared, err := filestore.WFS.DeleteIdleFiles(ctx, wavebase.BlockFile_Term, []string{wavebase.BlockFile_Cache}, cutoff, running)
	if err != nil {
		log.Printf("SweepIdleTerminalOutput: %v\n", err)
	}
	if cleared > 0 {
		log.Printf("SweepIdleTerminalOutput: cleared the output of %d idle terminals\n", cleared)
	}
}

func debugLog(ctx context.Context, fmtStr string, args ...interface{}) {
	blocklogger.Infof(ctx, "[conndebug] "+fmtStr, args...)
	log.Printf(fmtStr, args...)
}

func makeSwapToken(ctx context.Context, logCtx context.Context, blockId string, blockMeta waveobj.MetaMapType, remoteName string, shellType string) *shellutil.TokenSwapEntry {
	token := &shellutil.TokenSwapEntry{
		Token: uuid.New().String(),
		Env:   make(map[string]string),
		Exp:   time.Now().Add(5 * time.Minute),
	}
	token.Env["TERM_PROGRAM"] = "waveterm"
	token.Env["WAVETERM_BLOCKID"] = blockId
	token.Env["WAVETERM_VERSION"] = wavebase.WaveVersion
	token.Env["WAVETERM"] = "1"
	tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil {
		log.Printf("error finding tab for block: %v\n", err)
	} else {
		token.Env["WAVETERM_TABID"] = tabId
	}
	if tabId != "" {
		wsId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
		if err != nil {
			log.Printf("error finding workspace for tab: %v\n", err)
		} else {
			token.Env["WAVETERM_WORKSPACEID"] = wsId
		}
	}
	token.Env["WAVETERM_CLIENTID"] = wstore.GetClientId()
	token.Env["WAVETERM_CONN"] = remoteName
	envMap, err := resolveEnvMap(blockId, blockMeta, remoteName)
	if err != nil {
		log.Printf("error resolving env map: %v\n", err)
	}
	for k, v := range envMap {
		token.Env[k] = v
	}
	token.ScriptText = getCustomInitScript(logCtx, blockMeta, remoteName, shellType)
	return token
}
