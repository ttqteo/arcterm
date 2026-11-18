//go:build darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

type pcExecCall struct {
	name string
	args []string
}

// pcFakeExec replaces pcExec for one test: it records each command it is asked to run and answers with out and
// err, so no pmset or osascript runs.
func pcFakeExec(t *testing.T, out string, err error) *[]pcExecCall {
	t.Helper()
	var calls []pcExecCall
	orig := pcExec
	pcExec = func(_ context.Context, name string, args ...string) ([]byte, error) {
		calls = append(calls, pcExecCall{name, slices.Clone(args)})
		return []byte(out), err
	}
	t.Cleanup(func() { pcExec = orig })
	return &calls
}

func TestPCDarwinIsSupported(t *testing.T) {
	if !pcSupported {
		t.Error("pcSupported is false on darwin, so remoteDeps would leave the Computer section hidden")
	}
}

func TestPCDarwinLockRunsPmset(t *testing.T) {
	calls := pcFakeExec(t, "", nil)
	if err := pcLock(context.Background()); err != nil {
		t.Fatalf("pcLock: %v", err)
	}
	want := []pcExecCall{{"pmset", []string{"displaysleepnow"}}}
	if !slices.EqualFunc(*calls, want, func(a, b pcExecCall) bool { return a.name == b.name && slices.Equal(a.args, b.args) }) {
		t.Fatalf("pcLock ran %v, want %v", *calls, want)
	}
}

// Each step is one osascript call with one -e per script line.
func TestPCDarwinVolumeRunsOsascript(t *testing.T) {
	for _, tc := range []struct {
		step string
		want []string
	}{
		{"down", []string{
			"-e", "set v to (output volume of (get volume settings)) - 6",
			"-e", "if v < 0 then set v to 0",
			"-e", "set volume output volume v",
		}},
		{"up", []string{
			"-e", "set v to (output volume of (get volume settings)) + 6",
			"-e", "if v > 100 then set v to 100",
			"-e", "set volume output volume v",
		}},
		{"mute", []string{
			"-e", "set volume output muted (not (output muted of (get volume settings)))",
		}},
	} {
		t.Run(tc.step, func(t *testing.T) {
			calls := pcFakeExec(t, "", nil)
			if err := pcVolume(context.Background(), tc.step); err != nil {
				t.Fatalf("pcVolume(%q): %v", tc.step, err)
			}
			if len(*calls) != 1 || (*calls)[0].name != "osascript" || !slices.Equal((*calls)[0].args, tc.want) {
				t.Fatalf("pcVolume(%q) ran %v, want one osascript call with %q", tc.step, *calls, tc.want)
			}
		})
	}
}

func TestPCDarwinCoversEveryStep(t *testing.T) {
	for _, step := range pcVolumeSteps {
		if _, err := pcMacVolumeScript(step); err != nil {
			t.Errorf("pcMacVolumeScript(%q): %v", step, err)
		}
	}
}

// A refused step or a cancelled request runs no command at all.
func TestPCDarwinRunsNothingWhenRefused(t *testing.T) {
	calls := pcFakeExec(t, "", nil)
	if err := pcVolume(context.Background(), "louder"); err == nil {
		t.Error("pcVolume(louder) = nil, want an error")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := pcLock(cancelled); !errors.Is(err, context.Canceled) {
		t.Errorf("pcLock with a cancelled context = %v, want context.Canceled", err)
	}
	if err := pcVolume(cancelled, "up"); !errors.Is(err, context.Canceled) {
		t.Errorf("pcVolume with a cancelled context = %v, want context.Canceled", err)
	}
	if len(*calls) != 0 {
		t.Errorf("ran %v, want no command", *calls)
	}
}

// A failing command comes back as an error that names the action, the command and what it printed.
func TestPCDarwinFailureNamesWhatFailed(t *testing.T) {
	pcFakeExec(t, "execution error: Can't make missing value into type number. (-1700)\n", errors.New("exit status 1"))
	err := pcVolume(context.Background(), "down")
	if err == nil {
		t.Fatal("pcVolume = nil, want the command's failure")
	}
	for _, want := range []string{"press volume down", "osascript", "exit status 1", "missing value"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
	}
	err = pcLock(context.Background())
	if err == nil || !strings.Contains(err.Error(), "lock the screen") || !strings.Contains(err.Error(), "pmset") {
		t.Errorf("pcLock = %v, want an error naming the lock and pmset", err)
	}
}
