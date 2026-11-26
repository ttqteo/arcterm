// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The one scan guard. The Scan command and the schedule's loop both start a scan here, so two never run at once and a
// Stop reaches whichever one is running.
var (
	sessionIdeasScanMu     sync.Mutex
	sessionIdeasScanCancel context.CancelFunc // non-nil while a scan runs
)

// runSessionIdeasScan is the scan itself, a seam so a test can hold one open.
var runSessionIdeasScan = func(ctx context.Context, opts sessionideas.ScanOpts) error {
	return sessionideas.ScanNow(ctx, sessionideas.Default(), sessionIdeasScanDeps(), opts)
}

// startSessionIdeasScan runs a scan in the background, or refuses when one runs. A scan that ends with an error has
// recorded it in the store; the log line is for the person reading waveapp.log.
func startSessionIdeasScan(opts sessionideas.ScanOpts) error {
	sessionIdeasScanMu.Lock()
	defer sessionIdeasScanMu.Unlock()
	if sessionIdeasScanCancel != nil {
		return errors.New("a scan is running")
	}
	ctx, cancel := context.WithCancel(context.Background())
	sessionIdeasScanCancel = cancel
	go func() {
		defer func() {
			panichandler.PanicHandler("sessionideas scan", recover())
			cancel()
			sessionIdeasScanMu.Lock()
			sessionIdeasScanCancel = nil
			sessionIdeasScanMu.Unlock()
		}()
		if err := runSessionIdeasScan(ctx, opts); err != nil && ctx.Err() == nil {
			log.Printf("sessionideas: scan ended with an error: %v", err)
		}
	}()
	return nil
}

// stopSessionIdeasScan cancels the scan that runs; with none running it does nothing.
func stopSessionIdeasScan() {
	sessionIdeasScanMu.Lock()
	defer sessionIdeasScanMu.Unlock()
	if sessionIdeasScanCancel != nil {
		sessionIdeasScanCancel()
	}
}

// The fixture mode the dev app's scenarios turn on through SessionIdeasSeed: the scan's candidates are the seeded
// sessions and its model call returns the seeded reply, so no scenario reads ~/.claude or spends a token.
var (
	sessionIdeasFixtureMu   sync.Mutex
	sessionIdeasFixtureData *wshrpc.CommandSessionIdeasSeedData
)

// sessionIdeasFixture is what Seed set while fixture mode is on. The caller must not change it.
func sessionIdeasFixture() (*wshrpc.CommandSessionIdeasSeedData, bool) {
	sessionIdeasFixtureMu.Lock()
	defer sessionIdeasFixtureMu.Unlock()
	return sessionIdeasFixtureData, sessionIdeasFixtureData != nil
}

// setSessionIdeasFixture turns fixture mode on with a copy of seed, or off with nil.
func setSessionIdeasFixture(seed *wshrpc.CommandSessionIdeasSeedData) {
	sessionIdeasFixtureMu.Lock()
	defer sessionIdeasFixtureMu.Unlock()
	if seed == nil {
		sessionIdeasFixtureData = nil
		return
	}
	c := *seed
	c.Sessions = append([]wshrpc.SessionIdeasSession(nil), seed.Sessions...)
	sessionIdeasFixtureData = &c
}

// sessionIdeasScanDeps is what a scan reaches outside pkg/sessionideas for.
func sessionIdeasScanDeps() sessionideas.Deps {
	return sessionideas.Deps{}
}
