// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

// this file contains the implementation of the wsh server methods

import (
	"context"
	"fmt"
	"log"
	"path/filepath"

	"github.com/skratchdot/open-golang/open"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type WshServer struct{}

func (*WshServer) WshServerImpl() {}

var WshServerImpl = WshServer{}

// for testing
func (ws *WshServer) MessageCommand(ctx context.Context, data wshrpc.CommandMessageData) error {
	log.Printf("MESSAGE: %s\n", data.Message)
	return nil
}

func (ws *WshServer) GetMetaCommand(ctx context.Context, data wshrpc.CommandGetMetaData) (waveobj.MetaMapType, error) {
	obj, err := wstore.DBGetORef(ctx, data.ORef)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if obj == nil {
		return nil, fmt.Errorf("object not found: %s", data.ORef)
	}
	return waveobj.GetMeta(obj), nil
}

func (ws *WshServer) UpdateWorkspaceTabIdsCommand(ctx context.Context, workspaceId string, tabIds []string) error {
	oref := waveobj.ORef{OType: waveobj.OType_Workspace, OID: workspaceId}
	err := wcore.UpdateWorkspaceTabIds(ctx, workspaceId, tabIds)
	if err != nil {
		return fmt.Errorf("error updating workspace tab ids: %w", err)
	}
	wcore.SendWaveObjUpdate(oref)
	return nil
}

func (ws *WshServer) SetMetaCommand(ctx context.Context, data wshrpc.CommandSetMetaData) error {
	metaKeys := make([]string, 0, len(data.Meta))
	for k := range data.Meta {
		metaKeys = append(metaKeys, k)
	}
	// log key names only; meta values can contain secrets (env, keys)
	log.Printf("SetMetaCommand: %s | meta keys=%v\n", data.ORef, metaKeys)
	oref := data.ORef
	changed, err := wstore.UpdateObjectMeta(ctx, oref, data.Meta, false)
	if err != nil {
		return fmt.Errorf("error updating object meta: %w", err)
	}
	if changed {
		wcore.SendWaveObjUpdate(oref)
	}
	return nil
}

func (ws *WshServer) GetRTInfoCommand(ctx context.Context, data wshrpc.CommandGetRTInfoData) (*waveobj.ObjRTInfo, error) {
	return wstore.GetRTInfo(data.ORef), nil
}

func (ws *WshServer) SetRTInfoCommand(ctx context.Context, data wshrpc.CommandSetRTInfoData) error {
	if data.Delete {
		wstore.DeleteRTInfo(data.ORef)
		return nil
	}
	wstore.SetRTInfo(data.ORef, data.Data)
	return nil
}

func (ws *WshServer) ResolveIdsCommand(ctx context.Context, data wshrpc.CommandResolveIdsData) (wshrpc.CommandResolveIdsRtnData, error) {
	rtn := wshrpc.CommandResolveIdsRtnData{}
	rtn.ResolvedIds = make(map[string]waveobj.ORef)
	var firstErr error
	for _, simpleId := range data.Ids {
		oref, err := resolveSimpleId(ctx, data, simpleId)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if oref == nil {
			continue
		}
		rtn.ResolvedIds[simpleId] = *oref
	}
	if firstErr != nil && len(data.Ids) == 1 {
		return rtn, firstErr
	}
	return rtn, nil
}

func (ws *WshServer) EventRecvCommand(ctx context.Context, data wps.WaveEvent) error {
	return nil
}

func (ws *WshServer) EventPublishCommand(ctx context.Context, data wps.WaveEvent) error {
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	if rpcSource == "" {
		return fmt.Errorf("no rpc source set")
	}
	if data.Sender == "" {
		data.Sender = rpcSource
	}
	publishEvent(ctx, data)
	return nil
}

// staleStatusWindowMs bounds how much older than the retained report a state report may be and still be
// taken for an overtaken one. Older than that is a clock that stepped back, and dropping those would
// freeze the agent's status until the clock caught up.
const staleStatusWindowMs = 60_000

// staleAgentStatus reports whether a state report was overtaken: its scope already retains a newer one.
// The per-tool hooks run in the background, so a slow one can land after the report of a later event,
// and a working that outlives its turn's idle would hold every wake to that lead.
func staleAgentStatus(ev *wps.WaveEvent) bool {
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil || data.State == "" || data.Ts == 0 {
		return false
	}
	for _, scope := range ev.Scopes {
		for _, prev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, scope, 1) {
			var last baseds.AgentStatusData
			if utilfn.ReUnmarshal(&last, prev.Data) != nil {
				continue
			}
			if age := last.Ts - data.Ts; age > 0 && age <= staleStatusWindowMs {
				return true
			}
		}
	}
	return false
}

// publishEvent is EventPublishCommand past its caller check, which a test cannot satisfy.
func publishEvent(ctx context.Context, data wps.WaveEvent) {
	if data.Event == wps.Event_AgentStatus && staleAgentStatus(&data) {
		return
	}
	if data.Event == wps.Event_AgentStatus {
		PiTitleProviderInstance.NoteEvent(&data)
		retireAskOnResume(&data)
	}
	wps.Broker.Publish(data)
	if data.Event == wps.Event_AgentStatus {
		// after the publish: the wake adapter re-reads the lead's state from event history, which has
		// to hold this event already
		orchestrate.NoteLeadStatus(ctx, &data)
		// an agy worker names its own conversation: its first report is where the run learns the id
		orchestrate.NoteWorkerSession(ctx, &data)
		noteAgentTurnEnded(ctx, &data)
	}
}

func (ws *WshServer) EventSubCommand(ctx context.Context, data wps.SubscriptionRequest) error {
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	if rpcSource == "" {
		return fmt.Errorf("no rpc source set")
	}
	wps.Broker.Subscribe(rpcSource, data)
	return nil
}

func (ws *WshServer) EventUnsubCommand(ctx context.Context, data string) error {
	rpcSource := wshutil.GetRpcSourceFromContext(ctx)
	if rpcSource == "" {
		return fmt.Errorf("no rpc source set")
	}
	wps.Broker.Unsubscribe(rpcSource, data)
	return nil
}

func (ws *WshServer) EventReadHistoryCommand(ctx context.Context, data wshrpc.CommandEventReadHistoryData) ([]*wps.WaveEvent, error) {
	events := wps.Broker.ReadEventHistory(data.Event, data.Scope, data.MaxItems)
	return events, nil
}

func validatePreferredRoutePatch(patch waveobj.MetaMapType) error {
	runtimeValue, runtimePresent := patch[wconfig.ConfigKey_HarnessPreferredRuntime]
	modelValue, modelPresent := patch[wconfig.ConfigKey_HarnessPreferredModel]
	if !runtimePresent && !modelPresent {
		return nil
	}
	// the keys travel together so a runtime change cannot strand the previous runtime's model;
	// an empty model string selects the runtime default
	if runtimePresent != modelPresent {
		return fmt.Errorf("preferred route runtime and model must be patched together")
	}
	runtime, runtimeIsString := runtimeValue.(string)
	model, modelIsString := modelValue.(string)
	if !runtimeIsString || !modelIsString {
		return fmt.Errorf("preferred route values must be strings")
	}
	if _, err := runroute.Resolve(waveobj.RoutePin{Runtime: runtime, Model: model}); err != nil {
		return fmt.Errorf("invalid preferred route: %w", err)
	}
	return nil
}

func (ws *WshServer) SetConfigCommand(ctx context.Context, data wshrpc.MetaSettingsType) error {
	if err := validatePreferredRoutePatch(data.MetaMapType); err != nil {
		return err
	}
	return wconfig.SetBaseConfigValue(data.MetaMapType)
}

func (ws *WshServer) GetFullConfigCommand(ctx context.Context) (wconfig.FullConfigType, error) {
	watcher := wconfig.GetWatcher()
	return watcher.GetFullConfig(), nil
}

func (ws *WshServer) WaveInfoCommand(ctx context.Context) (*wshrpc.WaveInfoData, error) {
	return &wshrpc.WaveInfoData{
		Version:   wavebase.WaveVersion,
		ClientId:  wstore.GetClientId(),
		BuildTime: wavebase.BuildTime,
		ConfigDir: wavebase.GetWaveConfigDir(),
		DataDir:   wavebase.GetWaveDataDir(),
	}, nil
}

func (ws *WshServer) PathCommand(ctx context.Context, data wshrpc.PathCommandData) (string, error) {
	pathType := data.PathType
	openExternal := data.OpenExternal
	var path string
	switch pathType {
	case "config":
		path = wavebase.GetWaveConfigDir()
	case "data":
		path = wavebase.GetWaveDataDir()
	case "log":
		path = filepath.Join(wavebase.GetWaveDataDir(), "waveapp.log")
	}

	if openExternal {
		err := open.Run(path)
		if err != nil {
			return path, fmt.Errorf("error opening path: %w", err)
		}
	}
	return path, nil
}

func (ws *WshServer) GetAllBadgesCommand(ctx context.Context) ([]baseds.BadgeEvent, error) {
	return wcore.GetAllBadges(), nil
}
