// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// wavesrv finds a command's handler by reflection on its name, so a renamed or re-typed method would drop out of the
// wire without an error: this keeps all five, with the interface's signatures, compiled in.
var _ wshrpc.SessionIdeasCommands = (*WshServer)(nil)

// snoozeFor is how long Snooze puts the nudges off.
const snoozeFor = 7 * 24 * time.Hour

// SessionIdeasGetCommand is the store with the session list and the counts the marks give. The list and the counts are
// computed on each read, never stored.
func (ws *WshServer) SessionIdeasGetCommand(ctx context.Context) (*wshrpc.SessionIdeasData, error) {
	store := sessionideas.Default()
	d, err := store.Load()
	if err != nil {
		return nil, err
	}
	d.Sessions, d.Scanned, d.NotYet, d.LeavingSoon = sessionideas.Sessions(d, store.Clock())
	return &d, nil
}

// SessionIdeasResolveCommand keeps or drops an idea that waits for review.
func (ws *WshServer) SessionIdeasResolveCommand(ctx context.Context, data wshrpc.CommandSessionIdeasResolveData) error {
	switch data.Op {
	case "drop":
		return dropSessionIdea(sessionideas.Default(), data.ID)
	case "keep":
		return errors.New("keep not built yet")
	}
	return fmt.Errorf("unknown op %q: keep or drop", data.Op)
}

// dropSessionIdea is the idea gone from the review list; the scan does not propose it again (its gist stays in the store).
func dropSessionIdea(store *sessionideas.Store, id string) error {
	return store.Update(func(d *wshrpc.SessionIdeasData) error {
		for i := range d.Ideas {
			if d.Ideas[i].ID != id {
				continue
			}
			if d.Ideas[i].State != wshrpc.SessionIdeaState_Review {
				return fmt.Errorf("idea %s is already %s", id, d.Ideas[i].State)
			}
			d.Ideas[i].State = wshrpc.SessionIdeaState_Dropped
			d.Ideas[i].ResolvedTs = store.Clock().UnixMilli()
			return nil
		}
		return fmt.Errorf("no idea %s", id)
	})
}

// SessionIdeasMarkCommand records that the person looked (seen) or put the nudges off for a week (snooze).
func (ws *WshServer) SessionIdeasMarkCommand(ctx context.Context, data wshrpc.CommandSessionIdeasMarkData) error {
	store := sessionideas.Default()
	switch data.Op {
	case "seen":
		return store.Update(func(d *wshrpc.SessionIdeasData) error {
			d.SeenTs = store.Clock().UnixMilli()
			return nil
		})
	case "snooze":
		return store.Update(func(d *wshrpc.SessionIdeasData) error {
			d.SnoozedUntil = store.Clock().Add(snoozeFor).UnixMilli()
			return nil
		})
	}
	return fmt.Errorf("unknown op %q: seen or snooze", data.Op)
}

// SessionIdeasScanCommand starts a scan, or stops the one that runs.
func (ws *WshServer) SessionIdeasScanCommand(ctx context.Context, data wshrpc.CommandSessionIdeasScanData) error {
	if data.Stop {
		stopSessionIdeasScan()
		return nil
	}
	return startSessionIdeasScan(sessionideas.ScanOpts{Paths: data.Paths})
}

// SessionIdeasSeedCommand is the dev app's fixture door: it writes Data to the store, turns fixture mode on when Fixture
// is set (a Seed without it leaves the mode as it was), or, with Clear, empties the store and turns the mode off.
func (ws *WshServer) SessionIdeasSeedCommand(ctx context.Context, data wshrpc.CommandSessionIdeasSeedData) error {
	if !wavebase.IsDevMode() {
		return errors.New("sessionideasseed is for the dev app only")
	}
	store := sessionideas.Default()
	if data.Clear {
		setSessionIdeasFixture(nil)
		return store.Update(func(d *wshrpc.SessionIdeasData) error {
			*d = wshrpc.SessionIdeasData{}
			return nil
		})
	}
	if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
		*d = data.Data
		return nil
	}); err != nil {
		return err
	}
	if data.Fixture {
		setSessionIdeasFixture(&data)
		log.Printf("sessionideas: fixture mode on, %d sessions", len(data.Sessions))
	}
	return nil
}
