// pkg/wshrpc/wshserver/wshserver_verify.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"log"
	"sync/atomic"

	"github.com/wavetermdev/waveterm/pkg/verifyruns"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// verifyStore is the Verify store (pkg/verifyruns) of this wavesrv, set by StartVerify. The commands below only
// convert to and from its structs: the judging is in that package.
var verifyStore atomic.Pointer[verifyruns.Store]

// SetVerifyStore sets the store the Verify commands use; nil takes it away. StartVerify calls it; so do tests.
func SetVerifyStore(s *verifyruns.Store) { verifyStore.Store(s) }

var errNoVerifyStore = errors.New("verify is not running")

func currentVerifyStore() (*verifyruns.Store, error) {
	s := verifyStore.Load()
	if s == nil {
		return nil, errNoVerifyStore
	}
	return s, nil
}

// verifyChangedEvent is the event the cockpit's Verify tile refetches on: it names the block, and carries no scopes,
// like services:changed.
func verifyChangedEvent(blockId string) wps.WaveEvent {
	return wps.WaveEvent{Event: wps.Event_VerifyChanged, Data: wshrpc.VerifyChangedData{BlockId: blockId}}
}

// StartVerify opens the Verify store in the data dir, sweeps the files nobody has touched for a month, publishes
// `verify:changed` after every stored report or skip, and forgets a block's results when the block closes. Called once
// at startup, after the bare rpc client is up.
func StartVerify() {
	store := verifyruns.NewStore(verifyruns.DefaultDir())
	store.SetOnChange(func(blockId string) { wps.Broker.Publish(verifyChangedEvent(blockId)) })
	if err := store.Sweep(); err != nil {
		log.Printf("[verify] sweeping old results: %v\n", err)
	}
	SetVerifyStore(store)

	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_BlockClose, func(event *wps.WaveEvent) {
		if blockId, ok := event.Data.(string); ok {
			if err := store.Forget(blockId); err != nil {
				log.Printf("[verify] forgetting block %s: %v\n", blockId, err)
			}
		}
	})
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_BlockClose,
		AllScopes: true,
	}, nil)
}

// verifyBlockExists says whether the object store still holds the block. A harness can report after its agent's tab
// closed, and a report for a block that is gone would leave a file nobody removes.
func verifyBlockExists(ctx context.Context, blockId string) (bool, error) {
	if blockId == "" {
		return false, nil
	}
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return false, err
	}
	return block != nil, nil
}

func verifyReportFromWire(d wshrpc.CommandVerifyReportData) verifyruns.Report {
	r := verifyruns.Report{
		BlockId:  d.BlockId,
		RunId:    d.RunId,
		Phase:    d.Phase,
		Pid:      d.Pid,
		Cwd:      d.Cwd,
		Command:  d.Command,
		ShotsDir: d.ShotsDir,
		Reason:   d.Reason,
	}
	for _, s := range d.Scenarios {
		sc := verifyruns.Scenario{Name: s.Name, Files: s.Files, Done: s.Done}
		for _, step := range s.Steps {
			sc.Steps = append(sc.Steps, verifyruns.Step{Step: step.Step, State: step.State, Detail: step.Detail})
		}
		r.Scenarios = append(r.Scenarios, sc)
	}
	return r
}

// verifyStateToWire converts a derived State. Rows is never nil: a nil slice marshals to null, and the cockpit
// reads `rows` as an array.
func verifyStateToWire(st verifyruns.State) *wshrpc.VerifyStateData {
	out := &wshrpc.VerifyStateData{
		Rows:          make([]wshrpc.VerifyRowData, 0, len(st.Rows)),
		Verdict:       st.Verdict,
		NotRun:        st.NotRun,
		NotRunSkipped: st.NotRunSkipped,
		Changed:       st.Changed,
		Rerun:         st.Rerun,
	}
	for _, r := range st.Rows {
		out.Rows = append(out.Rows, wshrpc.VerifyRowData{
			Scenario:    r.Scenario,
			State:       r.State,
			Passed:      r.Passed,
			Total:       r.Total,
			Failed:      r.Failed,
			Done:        r.Done,
			Of:          r.Of,
			Command:     r.Command,
			ShotsDir:    r.ShotsDir,
			Reason:      r.Reason,
			Shots:       r.Shots,
			Started:     r.Started,
			Ended:       r.Ended,
			ChangedFile: r.ChangedFile,
		})
	}
	return out
}

// VerifyReportCommand stores one report of a harness run. A report for a block that no longer exists is dropped
// without an error: the harness is not told its agent's tab has closed.
func (ws *WshServer) VerifyReportCommand(ctx context.Context, data wshrpc.CommandVerifyReportData) error {
	store, err := currentVerifyStore()
	if err != nil {
		return err
	}
	exists, err := verifyBlockExists(ctx, data.BlockId)
	if err != nil {
		return err
	}
	if !exists {
		log.Printf("[verify] dropping a report (phase %s) of run %s: block %q does not exist\n", data.Phase, data.RunId, data.BlockId)
		return nil
	}
	return store.Report(verifyReportFromWire(data))
}

// GetVerifyStateCommand derives the agent's rows, warning and verdict, reading the watched changes in the agent's
// checkout (data.Cwd) now.
func (ws *WshServer) GetVerifyStateCommand(ctx context.Context, data wshrpc.CommandVerifyStateData) (*wshrpc.VerifyStateData, error) {
	store, err := currentVerifyStore()
	if err != nil {
		return nil, err
	}
	st, err := store.State(ctx, data.BlockId, data.Cwd)
	if err != nil {
		return nil, err
	}
	return verifyStateToWire(st), nil
}

// VerifySkipCommand sets one scenario (or, with an empty scenario, the not-run warning) aside, or takes it back. Like a
// report, a skip for a block that is gone is dropped, so Forget's work is not undone by a late click.
func (ws *WshServer) VerifySkipCommand(ctx context.Context, data wshrpc.CommandVerifySkipData) error {
	store, err := currentVerifyStore()
	if err != nil {
		return err
	}
	exists, err := verifyBlockExists(ctx, data.BlockId)
	if err != nil {
		return err
	}
	if !exists {
		log.Printf("[verify] dropping a skip of %q: block %q does not exist\n", data.Scenario, data.BlockId)
		return nil
	}
	return store.Skip(data.BlockId, data.Scenario, data.Undo)
}

// VerifyGateCommand says whether a merge into the default branch wants an ask. The arc mod decides a Bash command is a
// merge and only then calls this, so it is judged as one (data.Command is the mod's evidence, not read here); the
// answer comes from the branch and the default branch State read in the checkout, and the verdict.
func (ws *WshServer) VerifyGateCommand(ctx context.Context, data wshrpc.CommandVerifyGateData) (*wshrpc.VerifyGateData, error) {
	store, err := currentVerifyStore()
	if err != nil {
		return nil, err
	}
	st, err := store.State(ctx, data.BlockId, data.Cwd)
	if err != nil {
		return nil, err
	}
	ask, reason := verifyruns.Gate(st, st.Branch, st.DefaultBranch, true)
	return &wshrpc.VerifyGateData{Ask: ask, Reason: reason}, nil
}
