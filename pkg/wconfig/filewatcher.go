// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

type fsnotifyFactory func() (*fsnotify.Watcher, error)

var watcherOnce = sync.OnceValues(func() (*Watcher, error) {
	return newWatcher(fsnotify.NewWatcher)
})

type Watcher struct {
	initialized bool
	watcher     *fsnotify.Watcher
	mutex       sync.Mutex
	fullConfig  FullConfigType
	// the watched <vault>/config dir; it moves when the vault path setting changes
	vaultConfigDir string
	// reloadMu serializes reloads, each a read, store and broadcast: the watcher's goroutine and a command reloading
	// after its own write (Reload) run at once, and a slower older read must not land after a newer one
	reloadMu sync.Mutex
}

type WatcherUpdate struct {
	FullConfig FullConfigType `json:"fullconfig"`
}

func newWatcher(factory fsnotifyFactory) (*Watcher, error) {
	fileWatcher, err := factory()
	if err != nil {
		return nil, err
	}
	watcher := &Watcher{
		watcher: fileWatcher,
	}
	configDirAbsPath := wavebase.GetWaveConfigDir()
	log.Printf("create config watcher, configdir=%q", configDirAbsPath)
	const failedStr = "failed to add path %s to watcher: %v"
	if err := watcher.watcher.Add(configDirAbsPath); err != nil {
		log.Printf(failedStr, configDirAbsPath, err)
	}
	for _, dir := range GetConfigSubdirs() {
		if err := watcher.watcher.Add(dir); err != nil && !os.IsNotExist(err) {
			log.Printf(failedStr, dir, err)
		}
	}
	watcher.retargetVaultConfigDir()
	return watcher, nil
}

// retargetVaultConfigDir watches the current vault's config dir (creating it, since a missing dir cannot
// be watched) so a pulled vault-layer change reloads like a local edit, and drops the previous vault's.
func (w *Watcher) retargetVaultConfigDir() {
	dir := filepath.Join(VaultRoot(), VaultConfigDir)
	w.mutex.Lock()
	defer w.mutex.Unlock()
	if w.watcher == nil || dir == w.vaultConfigDir {
		return
	}
	if w.vaultConfigDir != "" {
		if err := w.watcher.Remove(w.vaultConfigDir); err != nil {
			log.Printf("failed to remove path %s from watcher: %v", w.vaultConfigDir, err)
		}
		w.vaultConfigDir = ""
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("failed to create vault config dir %s: %v", dir, err)
		return
	}
	if err := w.watcher.Add(dir); err != nil {
		log.Printf("failed to add path %s to watcher: %v", dir, err)
		return
	}
	w.vaultConfigDir = dir
}

func InitWatcher() (*Watcher, error) {
	return watcherOnce()
}

// GetWatcher returns the singleton instance of the Watcher.
func GetWatcher() *Watcher {
	watcher, err := InitWatcher()
	if err != nil {
		panic(fmt.Errorf("initializing config watcher: %w", err))
	}
	return watcher
}

func (w *Watcher) Start() {
	w.mutex.Lock()
	if w.initialized || w.watcher == nil {
		w.mutex.Unlock()
		return
	}
	w.initialized = true
	fileWatcher := w.watcher
	w.mutex.Unlock()

	log.Printf("starting file watcher\n")
	w.sendInitialValues()

	go func() {
		defer func() {
			panichandler.PanicHandler("filewatcher:Start", recover())
		}()
		var settle <-chan time.Time
		for {
			select {
			case event, ok := <-fileWatcher.Events:
				if !ok {
					return
				}
				if w.handleEvent(event) {
					settle = time.After(settleRereadAfter)
				}
			case <-settle:
				settle = nil
				w.rereadIfChanged()
			case err, ok := <-fileWatcher.Errors:
				if !ok {
					return
				}
				log.Println("watcher error:", err)
			}
		}
	}()
}

// for initial values, exit on first error
func (w *Watcher) sendInitialValues() error {
	fullConfig := ReadFullConfig()
	w.mutex.Lock()
	w.fullConfig = fullConfig
	w.mutex.Unlock()
	w.broadcast(WatcherUpdate{FullConfig: fullConfig})
	return nil
}

func (w *Watcher) Close() {
	w.mutex.Lock()
	fileWatcher := w.watcher
	w.watcher = nil
	w.mutex.Unlock()
	if fileWatcher != nil {
		fileWatcher.Close()
		log.Println("file watcher closed")
	}
}

// ConfigHook runs on the initial config and on every change, before the broadcast, so anything it derives
// (a registered project's channel) exists by the time the frontend sees the config that caused it. Set once
// at startup, before Start.
var ConfigHook func(FullConfigType)

func (w *Watcher) broadcast(message WatcherUpdate) {
	if ConfigHook != nil {
		ConfigHook(message.FullConfig)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_Config,
		Data:  message,
	})
}

func (w *Watcher) GetFullConfig() FullConfigType {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	return w.fullConfig
}

// handleEvent reports whether the event made it read the config.
func (w *Watcher) handleEvent(event fsnotify.Event) bool {
	fileName := filepath.ToSlash(event.Name)
	if event.Op == fsnotify.Chmod {
		return false
	}
	if !isValidSubSettingsFileName(fileName) {
		return false
	}
	w.handleSettingsFileEvent(event, fileName)
	return true
}

var validFileRe = regexp.MustCompile(`^[a-zA-Z0-9_@.-]+\.json$`)

func isValidSubSettingsFileName(fileName string) bool {
	if filepath.Ext(fileName) != ".json" {
		return false
	}
	baseName := filepath.Base(fileName)
	return validFileRe.MatchString(baseName)
}

func (w *Watcher) handleSettingsFileEvent(_ fsnotify.Event, _ string) {
	w.Reload()
}

// Reload reads the config files now and publishes them, as a file event does. A command whose caller reads the
// config as soon as it returns calls it after its write: the watcher's own reload waits for the file event and
// every event queued before it, each a full read, and under load a project created by createproject was still
// missing from getfullconfig 30 s later (council-tree's arrange, 2026-11-18).
func (w *Watcher) Reload() {
	w.reloadMu.Lock()
	defer w.reloadMu.Unlock()
	fullConfig := readFullConfigSettled(ReadFullConfig)
	w.retargetVaultConfigDir()
	w.mutex.Lock()
	w.fullConfig = fullConfig
	w.mutex.Unlock()
	w.broadcast(WatcherUpdate{FullConfig: fullConfig})
}

// An event's read can still miss the write that caused it: on windows a file just replaced by a rename can refuse
// the open for a moment ("used by another process"), which drops that file's part from the whole config, and a
// read can land between a replace's events. Nothing reads again until the next config change, so a project
// registered last would stay missing. The open is retried, and once the events go quiet the config is read once
// more and broadcast if it differs.
const (
	settleRereadAfter = 100 * time.Millisecond
	openRetryFor      = time.Second
	openRetryMaxDelay = 50 * time.Millisecond
	openFailurePrefix = "open "
)

// readFullConfigSettled retries while a config file failed to open, up to openRetryFor, and returns the last read.
// A parse error is the file's content and is not retried.
func readFullConfigSettled(read func() FullConfigType) FullConfigType {
	deadline := time.Now().Add(openRetryFor)
	for delay := time.Millisecond; ; delay = min(delay*2, openRetryMaxDelay) {
		fullConfig := read()
		if !hasOpenFailure(fullConfig.ConfigErrors) || time.Now().After(deadline) {
			return fullConfig
		}
		time.Sleep(delay)
	}
}

// a failed open is an fs.PathError, whose message starts with its op whatever the os's locale
func hasOpenFailure(errs []ConfigError) bool {
	for _, e := range errs {
		if strings.HasPrefix(e.Err, openFailurePrefix) {
			return true
		}
	}
	return false
}

// rereadIfChanged reads the config once more after the events went quiet and broadcasts it only if it differs from
// the held one. It takes reloadMu like Reload, so it cannot land an older read after a newer Reload's.
func (w *Watcher) rereadIfChanged() {
	w.reloadMu.Lock()
	defer w.reloadMu.Unlock()
	fullConfig := readFullConfigSettled(ReadFullConfig)
	w.mutex.Lock()
	same := reflect.DeepEqual(fullConfig, w.fullConfig)
	if !same {
		w.fullConfig = fullConfig
	}
	w.mutex.Unlock()
	if !same {
		w.broadcast(WatcherUpdate{FullConfig: fullConfig})
	}
}
