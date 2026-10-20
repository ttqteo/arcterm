// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/arctools"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/devservers"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// logTail is how much of a service's output the port fallback reads.
const logTail = 64 * 1024

// Default is the supervisor wavesrv runs, set by Init.
var Default *Supervisor

var defaultMu sync.Mutex

func defaultSupervisor() *Supervisor {
	defaultMu.Lock()
	defer defaultMu.Unlock()
	return Default
}

// Current is Default read under the lock Init sets it with: nil until Init has run.
func Current() *Supervisor {
	return defaultSupervisor()
}

var probeClient = &http.Client{
	Timeout:       ProbeTimeout,
	Transport:     &http.Transport{DisableKeepAlives: true},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// realDeps is the supervisor's wiring onto the controller, the store and the machine.
func realDeps(state StateStore) Deps {
	return Deps{
		Now: time.Now,
		After: func(d time.Duration, f func()) func() {
			t := time.AfterFunc(d, f)
			return func() { t.Stop() }
		},
		Probe:         probe,
		FreePort:      freePort,
		PortHolder:    portHolder,
		ServiceBlocks: serviceBlocks,
		Ensure:        ensure,
		Start: func(ctx context.Context, tabId, blockId string) error {
			markLog(blockId) // the log is kept across runs: the port fallback reads only what this start prints
			rtopts := &waveobj.RuntimeOpts{TermSize: waveobj.TermSize{Rows: 30, Cols: 120}}
			return blockcontroller.ResyncController(ctx, tabId, blockId, rtopts, true)
		},
		Stop: func(blockId string) {
			blockcontroller.DestroyBlockController(blockId)
			blockcontroller.StopLeftovers(blockId) // the node under npm keeps the port after its parent is gone
		},
		Sweep:    blockcontroller.StopLeftovers,
		ReadLog:  readLog,
		CloseTab: closeTab,
		Publish: func(data wshrpc.ServicesData) {
			wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_ServicesChanged, Data: data})
		},
		State: state,
	}
}

// probe asks for the page; any response counts as the page answering.
func probe(ctx context.Context, url string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := probeClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// portHolder reports whether something holds 127.0.0.1:port, and the program's name when the machine's listeners say.
func portHolder(ctx context.Context, port int) (string, bool) {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err == nil {
		l.Close()
		return "", false
	}
	servers, lerr := devservers.ListAll(ctx, nil)
	if lerr == nil {
		for _, srv := range servers {
			for _, p := range srv.Ports {
				if p == port {
					return srv.Name, true
				}
			}
		}
	}
	return "", true
}

func serviceBlocks(ctx context.Context) ([]BlockRef, error) {
	blocks, err := wstore.DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		return nil, err
	}
	var out []BlockRef
	for _, b := range blocks {
		if !b.Meta.GetBool(waveobj.MetaKey_ToolService, false) {
			continue
		}
		tabId, err := wstore.DBFindTabForBlockId(ctx, b.OID)
		if err != nil {
			log.Printf("[services] block %s has no tab: %v\n", b.OID, err)
			continue
		}
		out = append(out, BlockRef{ToolId: b.Meta.GetString(waveobj.MetaKey_ToolId, ""), TabId: tabId, BlockId: b.OID})
	}
	return out, nil
}

// ensure gives the service its tab and block: the ones it has while the block still exists, else new ones in the
// workspace of the client's first window. It always sends the updates it collected, even after a part-way failure,
// because the tab may exist by then and the frontend only learns of it from them.
func ensure(ctx context.Context, d Def) (tabId, blockId string, rtnErr error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	defer func() { wps.Broker.SendUpdateEvents(waveobj.ContextGetUpdatesRtn(ctx)) }()

	if d.TabId != "" && d.BlockId != "" {
		blk, err := wstore.DBGet[*waveobj.Block](ctx, d.BlockId)
		if err != nil {
			return "", "", fmt.Errorf("reading the service's block: %w", err)
		}
		if blk != nil {
			if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, d.BlockId), BlockMeta(d), false); err != nil {
				return "", "", fmt.Errorf("updating the service's block: %w", err)
			}
			if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Tab, d.TabId), TabMeta(d), false); err != nil {
				return "", "", fmt.Errorf("updating the service's tab: %w", err)
			}
			return d.TabId, d.BlockId, nil
		}
	}

	wsId, err := firstWorkspaceId(ctx)
	if err != nil {
		return "", "", err
	}
	tabId, err = wcore.CreateTab(ctx, wsId, d.Tool.Name, false, true)
	if err != nil {
		return "", "", fmt.Errorf("creating the service's tab: %w", err)
	}
	blk, err := wcore.CreateBlock(ctx, tabId, &waveobj.BlockDef{Meta: BlockMeta(d)}, nil)
	if err != nil {
		return "", "", fmt.Errorf("creating the service's block: %w", err)
	}
	if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Tab, tabId), TabMeta(d), false); err != nil {
		return "", "", fmt.Errorf("naming the service's tab: %w", err)
	}
	return tabId, blk.OID, nil
}

func firstWorkspaceId(ctx context.Context) (string, error) {
	client, err := wcore.GetClientData(ctx)
	if err != nil {
		return "", err
	}
	if len(client.WindowIds) == 0 {
		return "", fmt.Errorf("no window to put the service's tab in")
	}
	win, err := wcore.GetWindow(ctx, client.WindowIds[0])
	if err != nil {
		return "", err
	}
	return win.WorkspaceId, nil
}

func closeTab(ctx context.Context, tabId string) error {
	ctx = waveobj.ContextWithUpdates(ctx)
	defer func() { wps.Broker.SendUpdateEvents(waveobj.ContextGetUpdatesRtn(ctx)) }()
	wsId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
	if err != nil {
		return err
	}
	_, err = wcore.DeleteTab(ctx, wsId, tabId, false)
	return err
}

// logMarks is, per service block, how long its terminal output already was when its latest start began. The output is
// kept across runs, so what an earlier run printed (a port it listened on then) must not steer this one.
var logMarks = struct {
	mu sync.Mutex
	m  map[string]*logMark
}{m: map[string]*logMark{}}

// logMark is where a start's output begins, and the longest the output was when readLog last looked, which tells a
// cleared output (shorter than before) from a growing one.
type logMark struct {
	from int64
	seen int64
}

// markLog records the logical size of the block's terminal output, 0 when it has none yet.
func markLog(blockId string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var size int64
	if file, err := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term); err == nil && file != nil {
		size = file.Size
	}
	logMarks.mu.Lock()
	logMarks.m[blockId] = &logMark{from: size, seen: size}
	logMarks.mu.Unlock()
}

// readLog is the end of the service's terminal output, from this start's mark on.
func readLog(blockId string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	file, err := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)
	if err != nil || file == nil {
		return ""
	}
	var mark int64
	logMarks.mu.Lock()
	if m := logMarks.m[blockId]; m != nil {
		if file.Size < m.seen {
			m.from = 0 // the output was cleared since: all of it is newer than the mark
		}
		m.seen = file.Size
		mark = m.from
	}
	logMarks.mu.Unlock()
	offset := mark
	if file.Size-logTail > offset {
		offset = file.Size - logTail
	}
	_, data, err := filestore.WFS.ReadAt(ctx, blockId, wavebase.BlockFile_Term, offset, logTail)
	if err != nil {
		return ""
	}
	return string(data)
}

// toolsFromConfig is the services of a config: the built-in and the person's tools with a page, and the registered
// projects' paths.
func toolsFromConfig(fc wconfig.FullConfigType) ([]arctools.Tool, map[string]string) {
	var tools []arctools.Tool
	for _, t := range arctools.Merge(arctools.Builtin(), fc.Tools) {
		if arctools.IsService(t) {
			tools = append(tools, t)
		}
	}
	projects := make(map[string]string, len(fc.Projects))
	for name, p := range fc.Projects {
		projects[name] = p.Path
	}
	return tools, projects
}

func userHome() string {
	return wavebase.GetHomeDir()
}

// configWork is the latest config OnConfig was given and not yet applied: a change is applied off the watcher's
// goroutine (a Stop can take seconds), one at a time, and a newer config replaces one still waiting.
var configWork struct {
	mu      sync.Mutex
	pending *wconfig.FullConfigType
	running bool
}

// OnConfig applies a config change to the supervisor; it does nothing until Init has run.
func OnConfig(fc wconfig.FullConfigType) {
	if defaultSupervisor() == nil {
		return
	}
	configWork.mu.Lock()
	configWork.pending = &fc
	if configWork.running {
		configWork.mu.Unlock()
		return
	}
	configWork.running = true
	configWork.mu.Unlock()
	go func() {
		for {
			configWork.mu.Lock()
			next := configWork.pending
			configWork.pending = nil
			if next == nil {
				configWork.running = false
				configWork.mu.Unlock()
				return
			}
			configWork.mu.Unlock()
			if sup := defaultSupervisor(); sup != nil {
				tools, projects := toolsFromConfig(*next)
				sup.SetTools(context.Background(), tools, projects, userHome())
			}
		}
	}()
}

// Init builds the real supervisor, hooks the controller's exits and block closes into it, loads the services from the
// config and boots them. It runs after the block controller's own init, which sets up the event client.
func Init(ctx context.Context) {
	state := NewFileStore(filepath.Join(wavebase.GetWaveDataDir(), "services.json"))
	sup := New(realDeps(state))
	defaultMu.Lock()
	Default = sup
	defaultMu.Unlock()

	blockcontroller.ServiceExitHook = func(blockId string, exitCode int) {
		interrupted := blockcontroller.InterruptedWithin(blockId, blockcontroller.InterruptWindow, time.Now())
		sup.OnExit(blockId, exitCode, interrupted)
	}
	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_BlockClose, func(event *wps.WaveEvent) {
		if blockId, ok := event.Data.(string); ok {
			sup.OnBlockClosed(blockId)
		}
	})
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_BlockClose,
		AllScopes: true,
	}, nil)

	tools, projects := toolsFromConfig(wconfig.GetWatcher().GetFullConfig())
	sup.SetTools(ctx, tools, projects, userHome())
	sup.Boot(ctx)
}
