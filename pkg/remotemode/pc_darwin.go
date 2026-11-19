//go:build darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// pcSupported: wavesrv runs in the owner's login session, so pmset and osascript reach it.
const pcSupported = true

// pcLocked is nil: the Mac does not read its lock state (only Windows does), so the waiting list's locked stays null.
var pcLocked func(context.Context) (bool, error)

// pcMacVolumeStep is how many points (of 100) one press of the phone's down or up moves the output volume.
const pcMacVolumeStep = 6

// pcExec runs a command and returns its combined output. A var so a test replaces it and no command runs.
var pcExec = func(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// pcLock puts the display to sleep. The screen then locks when the account asks for its password at once on
// sleep, which is macOS's default; nothing here changes that setting.
func pcLock(ctx context.Context) error {
	return pcRun(ctx, "lock the screen", "pmset", "displaysleepnow")
}

// pcVolume sets the output volume 6 points down or up (kept within 0 to 100), or toggles output muted.
func pcVolume(ctx context.Context, step string) error {
	if err := pcCheckStep(step); err != nil {
		return err
	}
	script, err := pcMacVolumeScript(step)
	if err != nil {
		return fmt.Errorf("press volume %s: %w", step, err)
	}
	args := make([]string, 0, 2*len(script))
	for _, line := range script {
		args = append(args, "-e", line)
	}
	return pcRun(ctx, "press volume "+step, "osascript", args...)
}

// pcMacVolumeScript is the AppleScript of a volume step, one line per osascript -e.
func pcMacVolumeScript(step string) ([]string, error) {
	switch step {
	case "down":
		return []string{
			fmt.Sprintf("set v to (output volume of (get volume settings)) - %d", pcMacVolumeStep),
			"if v < 0 then set v to 0",
			"set volume output volume v",
		}, nil
	case "up":
		return []string{
			fmt.Sprintf("set v to (output volume of (get volume settings)) + %d", pcMacVolumeStep),
			"if v > 100 then set v to 100",
			"set volume output volume v",
		}, nil
	case "mute":
		return []string{"set volume output muted (not (output muted of (get volume settings)))"}, nil
	}
	return nil, fmt.Errorf("no script for the step %q", step)
}

// pcRun runs one command for the action named by what, and on failure returns an error that names the action,
// the command and whatever the command printed (osascript says why it refused, for an output with no volume
// control, on stderr).
func pcRun(ctx context.Context, what, name string, args ...string) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	out, err := pcExec(ctx, name, args...)
	if err == nil {
		return nil
	}
	if msg := strings.TrimSpace(string(out)); msg != "" {
		return fmt.Errorf("%s: %s failed: %w: %s", what, name, err, msg)
	}
	return fmt.Errorf("%s: %s failed: %w", what, name, err)
}
