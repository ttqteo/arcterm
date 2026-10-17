// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/runroute"
)

// a refresh is the user saying the account changed, so it drops every refused-route mark
func TestRefreshRouteCatalogCommandClearsRefusedRoutes(t *testing.T) {
	now := time.Now().UnixMilli()
	if err := runroute.RecordRefused(now, runroute.RefusedRoute{Runtime: "pi", Text: "403", Ts: now}); err != nil {
		t.Fatal(err)
	}
	ws := &WshServer{}
	if err := ws.RefreshRouteCatalogCommand(context.Background()); err != nil {
		t.Fatalf("refresh must succeed: %v", err)
	}
	if got := runroute.RefusedRoutes(now); len(got) != 0 {
		t.Fatalf("refresh left refused marks: %+v", got)
	}
}
