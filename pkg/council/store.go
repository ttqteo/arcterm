// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// CouncilsDir holds one <id>.json file per council, under the data dir.
const CouncilsDir = "councils"

const fileExt = ".json"

var (
	// an id is what NewId makes; the pattern also keeps it inside councils/
	idRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

	isWindows = runtime.GOOS == "windows"
	now       = time.Now

	rootMu       sync.RWMutex
	rootOverride string

	// ponytail: one mutex per council id, kept for the life of the process; a council is a few KB of state to the map
	locksMu sync.Mutex
	locks   = map[string]*sync.Mutex{}
)

// UseRootForTest points the store at a temp data dir and returns the restore func.
func UseRootForTest(root string) (restore func()) {
	rootMu.Lock()
	defer rootMu.Unlock()
	prev := rootOverride
	rootOverride = root
	return func() {
		rootMu.Lock()
		defer rootMu.Unlock()
		rootOverride = prev
	}
}

// Dir is the folder the council files live in.
func Dir() string {
	rootMu.RLock()
	defer rootMu.RUnlock()
	if rootOverride != "" {
		return filepath.Join(rootOverride, CouncilsDir)
	}
	return filepath.Join(wavebase.GetWaveDataDir(), CouncilsDir)
}

// NewId makes an id that is unique and safe as a file name.
func NewId() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand does not fail on the platforms arcterm ships on; the clock keeps an id distinct if it ever does
		return fmt.Sprintf("c%x", now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

func idLock(id string) *sync.Mutex {
	locksMu.Lock()
	defer locksMu.Unlock()
	mu, ok := locks[id]
	if !ok {
		mu = &sync.Mutex{}
		locks[id] = mu
	}
	return mu
}

func councilPath(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", fmt.Errorf("invalid council id %q", id)
	}
	return filepath.Join(Dir(), id+fileExt), nil
}

const (
	readRetryFor      = time.Second
	readRetryMaxDelay = 20 * time.Millisecond

	errAccessDenied     syscall.Errno = 5  // ERROR_ACCESS_DENIED
	errSharingViolation syscall.Errno = 32 // ERROR_SHARING_VIOLATION
)

// busyOnWindows reports whether err is Windows refusing to open a file that a rename is replacing at that moment.
func busyOnWindows(err error) bool {
	var errno syscall.Errno
	return isWindows && errors.As(err, &errno) && (errno == errAccessDenied || errno == errSharingViolation)
}

// readBytes is os.ReadFile, retrying for a moment when Windows refuses to open a file a Save is replacing: the
// rename is brief, and the reader would otherwise see an error for a council that is fine.
func readBytes(path string) ([]byte, error) {
	deadline := time.Now().Add(readRetryFor)
	for delay := time.Millisecond; ; delay = min(delay*2, readRetryMaxDelay) {
		b, err := os.ReadFile(path)
		if err == nil || !busyOnWindows(err) || time.Now().After(deadline) {
			return b, err
		}
		time.Sleep(delay)
	}
}

// readFile reads a council from path. A missing file is an error that wraps fs.ErrNotExist.
func readFile(path string) (*Council, error) {
	b, err := readBytes(path)
	if err != nil {
		return nil, err
	}
	var c Council
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("parse council %s: %w", path, err)
	}
	return &c, nil
}

// Load reads a council by id. A missing council is an error that wraps fs.ErrNotExist.
func Load(id string) (*Council, error) {
	path, err := councilPath(id)
	if err != nil {
		return nil, err
	}
	c, err := readFile(path)
	if err != nil {
		return nil, fmt.Errorf("load council %s: %w", id, err)
	}
	return c, nil
}

// writeLocked stamps Updated and writes the council through a temp file and a rename, so a reader sees the old
// file or the new one and never half of either. Callers hold the id's lock.
func writeLocked(c *Council) error {
	path, err := councilPath(c.Id)
	if err != nil {
		return err
	}
	c.Updated = now().UnixMilli()
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("encode council %s: %w", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(path), err)
	}
	if err := fileutil.AtomicWriteFile(path, append(b, '\n'), 0o644); err != nil {
		return fmt.Errorf("write council %s: %w", path, err)
	}
	return nil
}

// Save writes the council and sets its Updated.
func Save(c *Council) error {
	// the id is checked before the lock so a bad id never grows the lock map
	if _, err := councilPath(c.Id); err != nil {
		return err
	}
	mu := idLock(c.Id)
	mu.Lock()
	defer mu.Unlock()
	return writeLocked(c)
}

// Update loads the council, applies fn and saves it, all under the id's lock, so two updates never lose one
// another's change. When fn returns an error nothing is saved and the error comes back.
func Update(id string, fn func(*Council) error) (*Council, error) {
	if _, err := councilPath(id); err != nil {
		return nil, err
	}
	mu := idLock(id)
	mu.Lock()
	defer mu.Unlock()
	c, err := Load(id)
	if err != nil {
		return nil, err
	}
	if err := fn(c); err != nil {
		return nil, err
	}
	if err := writeLocked(c); err != nil {
		return nil, err
	}
	return c, nil
}

// Remove deletes the council's file, under the id's lock so no save writes it back. A missing council is an error that
// wraps fs.ErrNotExist.
func Remove(id string) error {
	path, err := councilPath(id)
	if err != nil {
		return err
	}
	mu := idLock(id)
	mu.Lock()
	defer mu.Unlock()
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("remove council %s: %w", id, err)
	}
	return nil
}

// SetRating keeps the person's "Was this useful?" answer on the council: RatingUseful or RatingNot, given at `at` (ms).
// A later rating replaces the earlier one and its time; any other word is refused and nothing is saved.
func SetRating(id, rating string, at int64) (*Council, error) {
	if rating != RatingUseful && rating != RatingNot {
		return nil, fmt.Errorf("rating %q is not %q or %q", rating, RatingUseful, RatingNot)
	}
	return Update(id, func(c *Council) error {
		c.Rating = rating
		c.RatedAt = at
		return nil
	})
}

// samePath compares two paths as the OS does: cleaned, and without case on Windows.
func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if isWindows {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// List returns the project's councils, newest Updated first; an empty project lists every council. It reads the
// folder each call, with no cache. A file that does not parse is left out rather than hiding the others.
func List(project string) ([]*Council, error) {
	entries, err := os.ReadDir(Dir())
	if errors.Is(err, fs.ErrNotExist) {
		return []*Council{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", Dir(), err)
	}
	out := []*Council{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, fileExt) || !idRe.MatchString(strings.TrimSuffix(name, fileExt)) {
			continue
		}
		c, err := readFile(filepath.Join(Dir(), name))
		if err != nil {
			continue
		}
		if project != "" && !samePath(c.Project, project) {
			continue
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Updated != out[j].Updated {
			return out[i].Updated > out[j].Updated
		}
		return out[i].Id < out[j].Id
	})
	return out, nil
}
