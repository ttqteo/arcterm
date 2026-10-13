// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestNotifyDataFromArgs(t *testing.T) {
	got := notifyDataFromArgs("build failed", "the build failed", "error", "", false)
	want := wshrpc.NotifyCommandData{Title: "build failed", Message: "the build failed", Level: "error"}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if got := notifyDataFromArgs("hi", "", "", "", false); got.Level != "" {
		t.Fatalf("default level should be empty (server defaults to info), got %q", got.Level)
	}
}

func TestNotifyDataFromArgsSenderAndTransient(t *testing.T) {
	got := notifyDataFromArgs("cache miss", "", "warn", "blk-1", true)
	want := wshrpc.NotifyCommandData{Title: "cache miss", Level: "warn", ORef: "block:blk-1", Transient: true}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}
