// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workspaceservice

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/bgagents"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type WorkspaceService struct{}

func (svc *WorkspaceService) GetWorkspace_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"workspaceId"},
		ReturnDesc: "workspace",
	}
}

func (svc *WorkspaceService) GetWorkspace(workspaceId string) (*waveobj.Workspace, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ws, err := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %w", err)
	}
	return ws, nil
}

func (svc *WorkspaceService) CreateTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"workspaceId", "tabName", "activateTab"},
		ReturnDesc: "tabId",
	}
}

func (svc *WorkspaceService) CreateTab(workspaceId string, tabName string, activateTab bool) (string, waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	tabId, err := wcore.CreateTab(ctx, workspaceId, tabName, activateTab, false)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab: %w", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:CreateTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return tabId, updates, nil
}

type CloseTabRtnType struct {
	CloseWindow    bool   `json:"closewindow,omitempty"`
	NewActiveTabId string `json:"newactivetabid,omitempty"`
}

func (svc *WorkspaceService) CloseTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "workspaceId", "tabId"},
		ReturnDesc: "CloseTabRtn",
	}
}

// tabSessionIds is every Claude session the tab's blocks could be showing (bgagents.SessionIDs): the
// one a block's launch resumed, and the transcripts its agent reported, on the block's meta and in its
// latest status. Closing the tab kills each block's process tree, but a background session the tab
// only attached to runs in the Claude Code daemon, so CloseTab stops those by id.
func tabSessionIds(ctx context.Context, tabId string, blockIds []string) []string {
	var args []string
	var paths []string
	// an agent reports its status under its block or its tab
	addStatus := func(scope string) {
		for _, ev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, scope, 1) {
			var d baseds.AgentStatusData
			if utilfn.ReUnmarshal(&d, ev.Data) == nil {
				paths = append(paths, d.TranscriptPath)
			}
		}
	}
	addStatus(waveobj.MakeORef(waveobj.OType_Tab, tabId).String())
	for _, blockId := range blockIds {
		block, _ := wstore.DBGet[*waveobj.Block](ctx, blockId)
		if block == nil {
			continue
		}
		args = append(args, block.Meta.GetStringList(waveobj.MetaKey_CmdArgs)...)
		paths = append(paths, block.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, ""))
		addStatus(waveobj.MakeORef(waveobj.OType_Block, blockId).String())
	}
	return bgagents.SessionIDs(args, paths...)
}

// returns the new active tabid
func (svc *WorkspaceService) CloseTab(ctx context.Context, workspaceId string, tabId string) (*CloseTabRtnType, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err == nil && tab != nil {
		// read before DeleteTab removes the blocks
		sessionIds := tabSessionIds(ctx, tabId, tab.BlockIds)
		go func() {
			for _, blockId := range tab.BlockIds {
				blockcontroller.DestroyBlockController(blockId)
			}
		}()
		if len(sessionIds) > 0 {
			go func() {
				defer func() {
					panichandler.PanicHandler("WorkspaceService:CloseTab:StopBackgroundSessions", recover())
				}()
				if err := bgagents.Stop(context.Background(), sessionIds); err != nil {
					log.Printf("CloseTab %s: stopping background sessions: %v\n", tabId, err)
				}
			}()
		}
	}
	newActiveTabId, err := wcore.DeleteTab(ctx, workspaceId, tabId, true)
	if err != nil {
		return nil, nil, fmt.Errorf("error closing tab: %w", err)
	}
	rtn := &CloseTabRtnType{}
	if newActiveTabId == "" {
		rtn.CloseWindow = true
	} else {
		rtn.NewActiveTabId = newActiveTabId
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("WorkspaceService:CloseTab:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return rtn, updates, nil
}
