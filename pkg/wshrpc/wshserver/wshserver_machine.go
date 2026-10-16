// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/machinestats"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) GetMachineStatsCommand(ctx context.Context) (*wshrpc.MachineStatsData, error) {
	st, err := machinestats.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading the machine's memory: %w", err)
	}
	return &wshrpc.MachineStatsData{
		MemTotal:     st.MemTotal,
		MemAvailable: st.MemAvailable,
		Pressure:     st.Pressure,
		CpuPct:       st.CpuPct,
		CpuSamples:   st.CpuSamples,
		DiskName:     st.DiskName,
		DiskTotal:    st.DiskTotal,
		DiskFree:     st.DiskFree,
	}, nil
}

// StartMachineWatch publishes memorypressure whenever the level or the memory available changes: the tray icon's red
// dot and free memory while the popover is shut.
func StartMachineWatch(ctx context.Context) {
	go func() {
		defer func() {
			panichandler.PanicHandler("machinestats.WatchMemory", recover())
		}()
		machinestats.WatchMemory(ctx, machinestats.ReadMemory, 10*time.Second, func(r machinestats.MemReading) {
			data := wshrpc.MemoryPressureData{Level: r.Level, MemAvailable: r.Available}
			wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_MemoryPressure, Data: data})
		})
	}()
}
