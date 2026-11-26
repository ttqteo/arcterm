// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// Search reads a digest of each transcript, one JSON file per transcript under the data dir: the session as the
// scan derives it, and the turns Query.Match reads. A digest is built the first time a search needs it (within a
// budget per call; the warm-up builds the rest) and stays while the transcript is unchanged, so a search after a
// restart parses no transcript, and nothing of a digest stays in RAM once the search that read it is done.

const (
	// DigestWindowDays is how far back search reaches, for every runtime it covers.
	DigestWindowDays = 90

	// digestVersion is the version of a digest file's format and of what a build derives into it. Bump it when Turn or
	// SessionInfo change shape, or when the session, events or turns a build derives change meaning (a title rule, a
	// prompt rule): every file of another version is rebuilt.
	digestVersion = 1

	// digestStrayTmpAge is how old a temp file of a build is before the prune takes it for one a crash left behind.
	digestStrayTmpAge = time.Hour
)

var (
	// digestDir is the folder of digest files, resolved when used: the data dir is only known once wavesrv has started.
	// A var so tests point it at a temp dir.
	digestDir = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "sessiondigests") }

	// digestProviders are the providers search walks: those that read a transcript into a digest, claude (with its
	// archive) and pi. A var so tests point it at temp roots.
	digestProviders = func() []provider {
		var out []provider
		for _, p := range allProviders() {
			if p.digest != nil {
				out = append(out, p)
			}
		}
		return out
	}

	// what one search call may build before it answers from the digests it has and leaves the rest to the warm-up. By
	// size as well as count: pi transcripts run to 40 MB and parse at ~25 ms per MB, so 100 of them held a call for
	// minutes. Vars so tests can shrink them.
	digestBudgetFiles       = 100
	digestBudgetBytes int64 = 64 << 20
)

// digestWarming is set while the warm-up goroutine runs.
var digestWarming atomic.Bool

// digestHeader is what says whether a digest still stands for its transcript. Transcripts only change by append, so
// the same mtime and size are the same file, as in the scan cache.
type digestHeader struct {
	V     int    `json:"v"`
	Path  string `json:"path"`
	Mtime int64  `json:"mtime"` // ns
	Size  int64  `json:"size"`
}

func (h digestHeader) fresh(c candidate) bool {
	return h.V == digestVersion && h.Path == c.path && h.Mtime == c.mtime.UnixNano() && h.Size == c.size
}

// digest is the file written for one transcript. Session is nil for a transcript that carries none (a subagent's, a
// tool-only one: most of the walk), which is kept so it is never read again. Otherwise it holds what the scan derives,
// with the events, status and times of the transcript's sessionEvents beside the session's own fields. The JSON names
// are the file format; see digestVersion.
type digest struct {
	digestHeader
	Runtime string       `json:"runtime"`
	Session *SessionInfo `json:"session"`
	Turns   []Turn       `json:"turns"`
}

// digestPath is the file of a transcript's digest, named by the hash of the transcript's path, so a directory
// listing says which transcript a file belongs to without opening it.
func digestPath(transcript string) string {
	sum := sha1.Sum([]byte(transcript))
	return filepath.Join(digestDir(), hex.EncodeToString(sum[:])+".json")
}

// readDigest is c's digest when the file holds one that is fresh. A missing, unreadable, corrupt or stale file is no
// digest: the caller builds it again.
func readDigest(c candidate) (*digest, bool) {
	data, err := os.ReadFile(digestPath(c.path))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("agentsessions: reading digest of %q: %v", c.path, err)
		}
		return nil, false
	}
	var d digest
	if err := json.Unmarshal(data, &d); err != nil {
		log.Printf("agentsessions: digest of %q is corrupt, building it again: %v", c.path, err)
		return nil, false
	}
	return &d, d.fresh(c)
}

// digestFresh reports whether c has a fresh digest, decoding only the header.
func digestFresh(c candidate) bool {
	data, err := os.ReadFile(digestPath(c.path))
	if err != nil {
		return false
	}
	var h digestHeader
	return json.Unmarshal(data, &h) == nil && h.fresh(c)
}

// buildDigest reads c once, derives its session, events and turns from that one parse, and writes the digest. A
// transcript that could not be read gets no digest and an error, as the scan cache does not cache one: the next call
// reads it again. A digest that could not be written is logged; it still answers this call.
func buildDigest(c candidate) (*digest, error) {
	s, se, turns, err := c.p.digest(c.path, c.stem)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", c.path, err)
	}
	d := &digest{
		digestHeader: digestHeader{V: digestVersion, Path: c.path, Mtime: c.mtime.UnixNano(), Size: c.size},
		Runtime:      c.p.runtime,
	}
	if s != nil {
		s.Events, s.Status, s.StartedTs, s.DurationMs = se.Events, se.Status, se.StartedTs, se.DurationMs
		d.Session, d.Turns = s, turns
	}
	if err := writeDigest(d); err != nil {
		log.Printf("agentsessions: writing digest of %q: %v", c.path, err)
	}
	return d, nil
}

// writeDigest writes through a temp file in the same folder and renames it over, so a call building a digest and the
// warm-up writing the same one never leave a torn file.
func writeDigest(d *digest) error {
	dir := digestDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "digest-*.tmp")
	if err != nil {
		return err
	}
	enc := json.NewEncoder(tmp)
	enc.SetEscapeHTML(false) // the file is not HTML, and &, < and > would each grow to six bytes
	err = enc.Encode(d)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), digestPath(d.Path))
	}
	if err != nil {
		os.Remove(tmp.Name())
	}
	return err
}

// DigestSearch is one search of the digests.
type DigestSearch struct {
	Query       Query
	Runtime     string // "" = claude and pi; else only that runtime
	ProjectPath string // "" = every project; else only the sessions of this project folder
	MaxHits     int    // hits kept per session; the counts stay whole
}

// DigestResult is one session the query matches, with its hits.
type DigestResult struct {
	Session   SessionInfo
	Hits      []Hit
	TurnHits  int
	EventHits int
}

// SearchDigests finds the claude and pi sessions of the last DigestWindowDays the query matches, newest first, and
// every one of them: the caller cuts the list, since it alone knows which sessions a run owns. It reads the digest
// of each transcript and builds a missing or stale one within a budget of digestBudgetFiles and digestBudgetBytes,
// newest first. Past the budget it answers with what it has, incomplete is true, and the warm-up builds the rest.
func SearchDigests(opts DigestSearch) (results []DigestResult, incomplete bool) {
	cands := collectCandidates(digestProviders(), opts.Runtime, opts.ProjectPath, DigestWindowDays)
	sort.Slice(cands, func(i, j int) bool { return candidateLess(cands[i], cands[j]) })
	results, incomplete = searchCandidates(cands, opts)
	if incomplete {
		StartDigestWarmup()
	}
	return results, incomplete
}

// searchCandidates answers opts over cands, which are newest first. The digests are read on parseWorkers goroutines,
// each matched as soon as it is read and then dropped, so only the results are held. What is left stale after that
// is built, within the budget, in the same order.
func searchCandidates(cands []candidate, opts DigestSearch) (results []DigestResult, skipped bool) {
	tempDir := os.TempDir()
	found := make([]*DigestResult, len(cands))
	stale := make([]bool, len(cands))
	parallelFor(len(cands), func(i int) {
		if d, ok := readDigest(cands[i]); ok {
			found[i] = digestMatch(cands[i], d, opts, tempDir)
		} else {
			stale[i] = true
		}
	})

	var build []int
	files, bytes := 0, int64(0)
	for i, c := range cands {
		if !stale[i] {
			continue
		}
		if files >= digestBudgetFiles || bytes >= digestBudgetBytes {
			skipped = true
			break
		}
		files++
		bytes += c.size
		build = append(build, i)
	}
	parallelFor(len(build), func(k int) {
		i := build[k]
		d, err := buildDigest(cands[i])
		if err != nil {
			log.Printf("agentsessions: search skips a transcript: %v", err)
			return
		}
		found[i] = digestMatch(cands[i], d, opts, tempDir)
	})

	for _, r := range found {
		if r != nil {
			results = append(results, *r)
		}
	}
	sort.SliceStable(results, func(i, j int) bool { return results[i].Session.LastActiveTs > results[j].Session.LastActiveTs })
	return results, skipped
}

// digestMatch is the session of c's digest with its hits, or nil when the digest holds no session, the session is
// a throwaway one under tempDir (never history anyone resumes), it is in another project, or the query does not match.
func digestMatch(c candidate, d *digest, opts DigestSearch, tempDir string) *DigestResult {
	if d.Session == nil {
		return nil
	}
	se := sessionEvents{Events: d.Session.Events, Status: d.Session.Status, StartedTs: d.Session.StartedTs, DurationMs: d.Session.DurationMs}
	s := asSession(c, parsed{info: d.Session, se: se})
	if isUnderDir(s.ProjectPath, tempDir) {
		return nil
	}
	if opts.ProjectPath != "" && normProjectPath(s.ProjectPath) != normProjectPath(opts.ProjectPath) {
		return nil
	}
	ok, hits, turnHits, eventHits := opts.Query.Match(s.Task, d.Turns, s.Events, opts.MaxHits)
	if !ok {
		return nil
	}
	return &DigestResult{Session: *s, Hits: hits, TurnHits: turnHits, EventHits: eventHits}
}

// parallelFor runs fn(0) … fn(n-1) on up to parseWorkers goroutines. A panic in one call is logged and costs that call
// only, so a file that trips the code does not take wavesrv down with it.
func parallelFor(n int, fn func(i int)) {
	idx := make(chan int)
	var wg sync.WaitGroup
	for range min(parseWorkers, n) {
		wg.Go(func() {
			for i := range idx {
				func() {
					defer func() { panichandler.PanicHandler("agentsessions:digest search", recover()) }()
					fn(i)
				}()
			}
		})
	}
	for i := range n {
		idx <- i
	}
	close(idx)
	wg.Wait()
}

// StartDigestWarmup builds every missing or stale digest of the window, newest first, on one background goroutine,
// one transcript at a time and yielding between them so it stays low priority, then prunes the digest files no
// transcript of the window owns. Idempotent while one runs. It is not queued through pkg/jobqueue: that queue admits
// shell commands by their RAM estimate, and this holds one transcript at a time.
func StartDigestWarmup() {
	if !digestWarming.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer digestWarming.Store(false)
		defer func() { panichandler.PanicHandler("agentsessions:digest warm-up", recover()) }()
		warmDigests(digestProviders())
	}()
}

func warmDigests(providers []provider) {
	started := time.Now()
	cands := collectCandidates(providers, "", "", DigestWindowDays)
	sort.Slice(cands, func(i, j int) bool { return candidateLess(cands[i], cands[j]) })
	keep := make(map[string]bool, len(cands))
	built := 0
	for _, c := range cands {
		keep[filepath.Base(digestPath(c.path))] = true // also when its build fails: the digest it has is not an orphan
		if digestFresh(c) {
			continue
		}
		if _, err := buildDigest(c); err != nil {
			log.Printf("agentsessions: digest warm-up skips a transcript: %v", err)
			continue
		}
		built++
		runtime.Gosched()
	}
	pruned := pruneDigests(keep)
	log.Printf("agentsessions: digest warm-up built %d of %d transcripts and pruned %d files in %v",
		built, len(cands), pruned, time.Since(started).Round(time.Millisecond))
}

// pruneDigests removes the files of the digest folder whose name is not in keep: the digests of transcripts that aged
// out of the window or were deleted, and temp files a crash left behind (a recent one belongs to a build running now).
func pruneDigests(keep map[string]bool) (removed int) {
	dir := digestDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("agentsessions: pruning digests: %v", err)
		}
		return 0
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || keep[name] {
			continue
		}
		if strings.HasSuffix(name, ".tmp") {
			if info, err := e.Info(); err != nil || time.Since(info.ModTime()) < digestStrayTmpAge {
				continue
			}
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			log.Printf("agentsessions: pruning digest %s: %v", name, err)
			continue
		}
		removed++
	}
	return removed
}
