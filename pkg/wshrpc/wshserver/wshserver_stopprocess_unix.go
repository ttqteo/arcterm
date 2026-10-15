// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wshserver

import (
	"context"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func stopProcessTree(_ context.Context, _ *WshServer, table memusage.Table, data wshrpc.CommandStopProcessData) error {
	return memusage.StopTree(table, data.Pid, 3*time.Second,
		func(pid int32, sig syscall.Signal) error { return syscall.Kill(int(pid), sig) },
		func(pid int32) bool { return syscall.Kill(int(pid), 0) == nil })
}
