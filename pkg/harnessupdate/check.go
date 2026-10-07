// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	checkInterval = 6 * time.Hour
	// off the launch path: the first check waits for the app to settle
	firstCheckDelay = 30 * time.Second
)

// seams for tests
var (
	probeAll      = harness.ProbeAll
	latestVersion = LatestVersion
	statePath     = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "harness-updates.json") }
)

var (
	mu     sync.Mutex
	latest = map[string]string{} // runtime -> latest version, from the last check
)

func resetLatest() {
	mu.Lock()
	defer mu.Unlock()
	latest = map[string]string{}
}

// Latest is the newest version the last check saw for runtime, "" before one has.
func Latest(runtime string) string {
	mu.Lock()
	defer mu.Unlock()
	return latest[runtime]
}

func channelFor(runtime string) string {
	if runtime == "claude" {
		return ClaudeChannel()
	}
	return "latest"
}

// announced is the version each harness was last announced at, kept in the data dir so a restart does not repeat it.
func loadAnnounced() map[string]string {
	out := map[string]string{}
	if b, err := os.ReadFile(statePath()); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

func saveAnnounced(a map[string]string) {
	b, _ := json.Marshal(a)
	if err := os.WriteFile(statePath(), b, 0o644); err != nil {
		log.Printf("harnessupdate: saving announced versions: %v", err)
	}
}

// Check runs one pass: each installed harness with an NpmPackage gets its latest version read, and one newer than the
// installed version is announced through notify, once per version.
func Check(ctx context.Context, notify func(title, message, level string)) {
	announced := loadAnnounced()
	changed := false
	for _, r := range probeAll(ctx) {
		if !r.Installed || r.Spec.NpmPackage == "" {
			continue
		}
		v, err := latestVersion(ctx, r.Spec.NpmPackage, channelFor(r.Spec.Runtime))
		if err != nil {
			log.Printf("harnessupdate: %s: %v", r.Spec.Runtime, err)
			continue
		}
		mu.Lock()
		latest[r.Spec.Runtime] = v
		mu.Unlock()
		if Newer(v, r.Version) && announced[r.Spec.Runtime] != v {
			notify(fmt.Sprintf("%s %s is out", r.Spec.Label, v), "Settings → About to update", "info")
			announced[r.Spec.Runtime] = v
			changed = true
		}
	}
	if changed {
		saveAnnounced(announced)
	}
}

// shortVersion is the bare x.y.z of a harness's --version output, or s itself when it has none.
func shortVersion(s string) string {
	if v, ok := ParseVersion(s); ok {
		return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2])
	}
	return s
}

// StartLoop checks shortly after startup and then every checkInterval, while enabled says so.
func StartLoop(ctx context.Context, enabled func() bool, notify func(title, message, level string)) {
	go func() {
		defer func() { panichandler.PanicHandler("harnessupdate:loop", recover()) }()
		timer := time.NewTimer(firstCheckDelay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			if enabled() {
				cctx, cancel := context.WithTimeout(ctx, time.Minute)
				Check(cctx, notify)
				cancel()
			}
			timer.Reset(checkInterval)
		}
	}()
}
