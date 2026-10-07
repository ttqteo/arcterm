// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

const updateTimeout = 5 * time.Minute

// runUpdate is a seam for tests.
var runUpdate = func(ctx context.Context, bin string, args []string) ([]byte, error) {
	return exec.CommandContext(ctx, bin, args...).CombinedOutput()
}

type UpdateResult struct {
	Version string // x.y.z after the update
}

// Update runs runtime's own updater and reads back the version it left installed. Running sessions keep the binary
// they started with: Claude Code's native updater moves the running executable aside rather than overwriting it.
func Update(ctx context.Context, runtime string) (UpdateResult, error) {
	spec, ok := harness.Lookup(runtime)
	if !ok || len(spec.UpdateArgs) == 0 {
		return UpdateResult{}, fmt.Errorf("arcterm cannot update %s", runtime)
	}
	ctx, cancel := context.WithTimeout(ctx, updateTimeout)
	defer cancel()
	out, err := runUpdate(ctx, spec.Bin, spec.UpdateArgs)
	if err != nil {
		// a killed updater's last line is whatever it was printing, not why it stopped; exec reports the kill as
		// "signal: killed", so the context says it was the timeout
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return UpdateResult{}, fmt.Errorf("%s update timed out after %s: %w", spec.Label, updateTimeout, context.DeadlineExceeded)
		}
		if line := lastLine(string(out)); line != "" {
			return UpdateResult{}, errors.New(line)
		}
		return UpdateResult{}, fmt.Errorf("%s update: %w", spec.Label, err)
	}
	for _, r := range probeAll(ctx) {
		if r.Spec.Runtime == runtime {
			return UpdateResult{Version: shortVersion(r.Version)}, nil
		}
	}
	return UpdateResult{}, nil
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}
