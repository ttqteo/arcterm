// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package keepawake

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"sync"
)

// Holder takes and drops the idle-sleep assertion: a `caffeinate -i -w <wavesrv pid>` while held, so the assertion
// ends with wavesrv even when wavesrv crashes.
type Holder struct {
	mu  sync.Mutex
	cmd *exec.Cmd
}

// Set takes the assertion when on and drops it when off; holding twice is one caffeinate. A caffeinate that died is
// started again at the next Set(true).
func (h *Holder) Set(on bool) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if on == (h.cmd != nil) {
		return nil
	}
	if !on {
		cmd := h.cmd
		h.cmd = nil
		return cmd.Process.Kill()
	}
	cmd := exec.Command("caffeinate", "-i", "-w", strconv.Itoa(os.Getpid()))
	if err := cmd.Start(); err != nil {
		return err
	}
	h.cmd = cmd
	go func() {
		cmd.Wait()
		h.mu.Lock()
		if h.cmd == cmd {
			h.cmd = nil
		}
		h.mu.Unlock()
	}()
	return nil
}

// ReadBattery is the power source and charge now; on AC with Pct -1 when pmset cannot be read.
func ReadBattery(ctx context.Context) Battery {
	out, err := exec.CommandContext(ctx, "pmset", "-g", "batt").Output()
	if err != nil {
		return Battery{Pct: -1}
	}
	return ParseBatt(string(out))
}
