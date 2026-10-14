// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	stateDirName     = "memhygiene"
	fileNameMaxStem  = 60
	fileNameHashHex  = 8
	fileNameSafeRepl = '_'
)

// a seam so tests can observe the event without a broker
var publishUpdate = func() {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_MemHygieneUpdate})
}

var projectLocks sync.Map // project -> *sync.Mutex

func lockFor(project string) *sync.Mutex {
	mu, _ := projectLocks.LoadOrStore(project, &sync.Mutex{})
	return mu.(*sync.Mutex)
}

func StateDir() string {
	return filepath.Join(wavebase.GetWaveDataDir(), stateDirName)
}

// FileName maps a registry name to a safe, stable file name. The hash of the raw name keeps two names
// that differ only in unsafe characters from sharing a file.
func FileName(project string) string {
	var b strings.Builder
	for _, r := range project {
		if r < 0x80 && (r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-') {
			b.WriteRune(r)
		} else {
			b.WriteRune(fileNameSafeRepl)
		}
	}
	stem := b.String()
	if len(stem) > fileNameMaxStem {
		stem = stem[:fileNameMaxStem]
	}
	sum := sha256.Sum256([]byte(project))
	return stem + "-" + hex.EncodeToString(sum[:])[:fileNameHashHex] + ".json"
}

func statePath(project string) string {
	return filepath.Join(StateDir(), FileName(project))
}

// Load reads a project's state. A project never checked has no file and gets a zero state. It takes
// the project's lock because windows refuses to rename over a file another reader holds open.
func Load(project string) (*State, error) {
	mu := lockFor(project)
	mu.Lock()
	defer mu.Unlock()
	return load(project)
}

func load(project string) (*State, error) {
	path := statePath(project)
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return &State{MemHygieneProject: wshrpc.MemHygieneProject{Project: project}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("memory hygiene: reading state of %s: %w", project, err)
	}
	var st State
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, fmt.Errorf("memory hygiene: parsing state of %s (%s): %w", project, path, err)
	}
	st.Project = project
	return &st, nil
}

// Update is the only way state is written. It holds the project's lock, re-reads the file so fn sees
// every write that landed before it (a check finishing while the user applies), writes atomically,
// and publishes the update event. An error from fn writes nothing.
func Update(project string, fn func(*State) error) (*State, error) {
	mu := lockFor(project)
	mu.Lock()
	defer mu.Unlock()
	st, err := load(project)
	if err != nil {
		return nil, err
	}
	if err := fn(st); err != nil {
		return nil, err
	}
	st.Project = project
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("memory hygiene: encoding state of %s: %w", project, err)
	}
	if err := WriteAtomic(statePath(project), data); err != nil {
		return nil, fmt.Errorf("memory hygiene: saving state of %s: %w", project, err)
	}
	publishUpdate()
	return st, nil
}

// List returns one entry per registry project, sorted by name. It reads only the state files: no
// discovery, so the tab costs no disk walk. The registry's path wins over a stored one.
func List(registry map[string]string) ([]wshrpc.MemHygieneProject, error) {
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]wshrpc.MemHygieneProject, 0, len(names))
	for _, name := range names {
		st, err := Load(name)
		if err != nil {
			return nil, err
		}
		p := st.MemHygieneProject
		p.Path = registry[name]
		// the frontend reads these as arrays, never null
		if p.Changes == nil {
			p.Changes = []wshrpc.MemChange{}
		}
		if p.SharedWith == nil {
			p.SharedWith = []string{}
		}
		out = append(out, p)
	}
	return out, nil
}
