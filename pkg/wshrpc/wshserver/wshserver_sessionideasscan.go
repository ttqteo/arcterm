// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/sessionarchive"
	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The one scan guard. The Scan command and the schedule's loop both start a scan here, so two never run at once and a
// Stop reaches whichever one is running.
var (
	sessionIdeasScanMu     sync.Mutex
	sessionIdeasScanCancel context.CancelFunc // non-nil while a scan runs
)

// runSessionIdeasScan is the scan itself, a seam so a test can hold one open.
var runSessionIdeasScan = func(ctx context.Context, opts sessionideas.ScanOpts) error {
	return sessionideas.ScanNow(ctx, sessionideas.Default(), sessionIdeasScanDeps(), opts)
}

// startSessionIdeasScan runs a scan in the background, or refuses when one runs. A scan that ends with an error has
// recorded it in the store; the log line is for the person reading waveapp.log.
func startSessionIdeasScan(opts sessionideas.ScanOpts) error {
	sessionIdeasScanMu.Lock()
	defer sessionIdeasScanMu.Unlock()
	if sessionIdeasScanCancel != nil {
		return errors.New("a scan is running")
	}
	ctx, cancel := context.WithCancel(context.Background())
	sessionIdeasScanCancel = cancel
	go func() {
		defer func() {
			panichandler.PanicHandler("sessionideas scan", recover())
			cancel()
			sessionIdeasScanMu.Lock()
			sessionIdeasScanCancel = nil
			sessionIdeasScanMu.Unlock()
		}()
		if err := runSessionIdeasScan(ctx, opts); err != nil && ctx.Err() == nil {
			log.Printf("sessionideas: scan ended with an error: %v", err)
		}
	}()
	return nil
}

// sessionIdeasScanRunning says whether a scan holds the guard.
func sessionIdeasScanRunning() bool {
	sessionIdeasScanMu.Lock()
	defer sessionIdeasScanMu.Unlock()
	return sessionIdeasScanCancel != nil
}

// stopSessionIdeasScan cancels the scan that runs; with none running it does nothing.
func stopSessionIdeasScan() {
	sessionIdeasScanMu.Lock()
	defer sessionIdeasScanMu.Unlock()
	if sessionIdeasScanCancel != nil {
		sessionIdeasScanCancel()
	}
}

// The fixture mode the dev app's scenarios turn on through SessionIdeasSeed: the scan's candidates are the seeded
// sessions and its model call returns the seeded reply, so no scenario reads ~/.claude or spends a token.
var (
	sessionIdeasFixtureMu   sync.Mutex
	sessionIdeasFixtureData *wshrpc.CommandSessionIdeasSeedData
)

// sessionIdeasFixture is what Seed set while fixture mode is on. The caller must not change it.
func sessionIdeasFixture() (*wshrpc.CommandSessionIdeasSeedData, bool) {
	sessionIdeasFixtureMu.Lock()
	defer sessionIdeasFixtureMu.Unlock()
	return sessionIdeasFixtureData, sessionIdeasFixtureData != nil
}

// setSessionIdeasFixture turns fixture mode on with a copy of seed, or off with nil.
func setSessionIdeasFixture(seed *wshrpc.CommandSessionIdeasSeedData) {
	sessionIdeasFixtureMu.Lock()
	defer sessionIdeasFixtureMu.Unlock()
	if seed == nil {
		sessionIdeasFixtureData = nil
		return
	}
	c := *seed
	c.Sessions = append([]wshrpc.SessionIdeasSession(nil), seed.Sessions...)
	sessionIdeasFixtureData = &c
}

// sessionIdeasScanDeps is what a scan reaches outside pkg/sessionideas for: the real ones, or while fixture mode is on the
// seeded sessions and the seeded reply, which read nothing under ~/.claude and call no model.
func sessionIdeasScanDeps() sessionideas.Deps {
	if fx, on := sessionIdeasFixture(); on {
		return fixtureSessionIdeasDeps(fx)
	}
	return realSessionIdeasDeps()
}

// realSessionIdeasDeps is a seam, so a test can tell that fixture mode never reaches it.
var realSessionIdeasDeps = func() sessionideas.Deps {
	return sessionideas.Deps{
		Run:            runSessionIdeasModel,
		ProjectContext: sessionIdeasProjectContext,
		// the person's sessions only: a scan never reads, and the list never counts, one arcterm's machinery left, by
		// its folder (a run's tree or a temp folder not yet archived) or by its head
		Candidates: func() []agentsessions.DigestSession {
			cands := agentsessions.ClaudeDigestCandidates(agentsessions.DigestWindowDays)
			return sessionideas.PersonSessions(sessionideas.LeaveOutArcterms(cands, SessionArchiveRules().Owns))
		},
		Read:        agentsessions.ReadDigestFor,
		CleanupDays: func() int { return sessionideas.CleanupPeriodDays(sessionideas.ClaudeSettingsPath()) },
		Now:         time.Now,
	}
}

// SessionArchiveRules is which Claude Code folders are arcterm's own: the archive's sweep moves them out of
// ~/.claude/projects, and Session ideas never offers or reads them.
func SessionArchiveRules() sessionarchive.Rules {
	return sessionarchive.Rules{
		TempDir:      os.TempDir(),
		WorktreeRoot: orchestrate.WorktreeRoot(),
		HeadlessSlug: agentobserve.HeadlessAgentSlug(),
	}
}

// fixtureCleanupDays is the cleanupPeriodDays fixture mode assumes: arcterm's own 90, so a scenario does not depend on
// the settings of the machine it runs on.
const fixtureCleanupDays = 90

// sessionIdeasOnDisk is the transcripts and the cleanupPeriodDays the session list and the schedule read: the real ones,
// or the seeded sessions while fixture mode is on. A seeded session carries its title, as a digest would, so its row has
// one.
func sessionIdeasOnDisk() ([]agentsessions.DigestSession, int) {
	if fx, on := sessionIdeasFixture(); on {
		return fixtureCandidates(fx, true), fixtureCleanupDays
	}
	deps := sessionIdeasScanDeps()
	return deps.Candidates(), deps.CleanupPeriod()
}

// fixtureSession is a seeded session as a transcript on disk: the file's own fields, and with named its session too.
func fixtureSession(s wshrpc.SessionIdeasSession, named bool) agentsessions.DigestSession {
	// a seeded ProjectPath stands for the cwd its head would name, so the list names the row's project by it
	d := agentsessions.DigestSession{Path: s.TranscriptPath, Stem: s.SessionID, Mtime: time.UnixMilli(s.LastWriteTs), Size: s.Size, Cwd: s.ProjectPath}
	if named {
		d.Session = &agentsessions.SessionInfo{ID: s.SessionID, Task: s.Title, ProjectName: s.Project, ProjectPath: s.Project}
	}
	return d
}

// fixtureCandidates is the seeded sessions as the walk of ~/.claude would list them (named: with their sessions, which
// the walk does not read).
func fixtureCandidates(fx *wshrpc.CommandSessionIdeasSeedData, named bool) []agentsessions.DigestSession {
	out := make([]agentsessions.DigestSession, len(fx.Sessions))
	for i, s := range fx.Sessions {
		out[i] = fixtureSession(s, named)
	}
	return out
}

// runSessionIdeasModel is one haiku call on a session's digest, with no tools, no settings and nothing kept of the
// session (the flags pkg/chatsuggest passes). The tokens are what the call's result event reported, cache included, as
// the Complete event's Tokens are (pkg/consult/consult.go:150).
func runSessionIdeasModel(ctx context.Context, prompt string) (string, int64, error) {
	reply, usage, err := consult.RunClaude(ctx, wavebase.HeadlessAgentCwd(), prompt, consult.CallOpts{
		Model:     "haiku",
		ExtraArgs: []string{"--setting-sources=", "--no-session-persistence", "--disable-slash-commands"},
	}, nil)
	return reply, int64(usage.TotalTokens), err
}

// fixtureSessionIdeasDeps is a scan over the seeded sessions: each reads as one canned prompt, the model answers the
// seeded Reply (an empty list by default) for 1000 tokens, and the project holds nothing.
func fixtureSessionIdeasDeps(fx *wshrpc.CommandSessionIdeasSeedData) sessionideas.Deps {
	reply := fx.Reply
	if reply == "" {
		reply = "[]"
	}
	return sessionideas.Deps{
		Run: func(context.Context, string) (string, int64, error) { return reply, 1000, nil },
		ProjectContext: func(context.Context, string) (sessionideas.ProjectContext, error) {
			return sessionideas.ProjectContext{}, nil
		},
		Candidates: func() []agentsessions.DigestSession { return fixtureCandidates(fx, false) },
		Read: func(path string) (agentsessions.DigestSession, error) {
			d := agentsessions.DigestSession{Path: path, Stem: path}
			for _, s := range fx.Sessions {
				if s.TranscriptPath == path {
					d = fixtureSession(s, true)
					break
				}
			}
			d.Turns = []agentsessions.Turn{{Speaker: "user", Text: "A canned prompt from a fixture session.", Ts: d.Mtime.UnixMilli()}}
			return d, nil
		},
		CleanupDays: func() int { return fixtureCleanupDays },
		Now:         time.Now,
	}
}

const (
	projectDocTimeout = 10 * time.Second
	// A project with hundreds of specs would make every session's prompt big. The names start with their date, so the
	// last ones are the newest.
	maxDocNames = 100
)

// sessionIdeasProjectContext is what the project of a session's folder already holds: its initiatives and ideas, the
// names in its specs and plans folders, the headings of docs/deferred.md and its last 200 commit subjects. A session in a
// linked worktree reads the main checkout's project. A part that cannot be read is left out and joined into the error
// that comes back with the rest.
func sessionIdeasProjectContext(ctx context.Context, cwd string) (sessionideas.ProjectContext, error) {
	if strings.TrimSpace(cwd) == "" {
		return sessionideas.ProjectContext{}, nil
	}
	root, ok := mainCheckoutPath(cwd)
	if !ok {
		root = repoRootOf(cwd)
	}
	home, _ := os.UserHomeDir()
	name, kw, registered := wconfig.ProjectForDir(root, wconfig.GetWatcher().GetFullConfig().Projects, home)
	dir := root
	if p := strings.TrimSpace(kw.Path); registered && p != "" {
		dir = p
		if rest, isHome := strings.CutPrefix(p, "~"); isHome {
			dir = filepath.Join(home, rest)
		}
	}

	var errs []error
	var efforts []sessionideas.EffortFacts
	if registered {
		all, err := effortstore.GetAll(ctx)
		if err != nil {
			errs = append(errs, fmt.Errorf("initiatives: %w", err))
		}
		for _, e := range all {
			if e.Project != name || e.Status == "archived" {
				continue
			}
			labels := make([]string, len(e.Chunks))
			for i, c := range e.Chunks {
				labels[i] = c.Label
			}
			efforts = append(efforts, sessionideas.EffortFacts{OID: e.OID, Title: e.Title, Chunks: labels})
		}
	}
	docs, err := readProjectDocs(ctx, dir)
	errs = append(errs, err)
	pc := sessionideas.BuildProjectContext(efforts, docs.specs, docs.plans, docs.deferred, docs.gitLog)
	pc.Name, pc.Root = name, dir
	return pc, errors.Join(errs...)
}

// projectDocs is what a project's folder says about what is decided.
type projectDocs struct {
	specs, plans []string // file names, the newest maxDocNames
	deferred     string   // docs/deferred.md
	gitLog       string   // git log -200 --format=%s
}

// readProjectDocs reads the specs and plans folders, docs/deferred.md and the commit subjects of a project folder. What
// the folder does not have (no docs, no .git) is no error; anything else that fails is, with the rest still read.
func readProjectDocs(ctx context.Context, dir string) (projectDocs, error) {
	var docs projectDocs
	var errs []error
	names := func(sub string) []string {
		entries, err := os.ReadDir(filepath.Join(dir, "docs", "superpowers", sub))
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				errs = append(errs, err)
			}
			return nil
		}
		var out []string
		for _, e := range entries {
			if !e.IsDir() {
				out = append(out, e.Name())
			}
		}
		if len(out) > maxDocNames {
			out = out[len(out)-maxDocNames:]
		}
		return out
	}
	docs.specs, docs.plans = names("specs"), names("plans")
	if raw, err := os.ReadFile(filepath.Join(dir, "docs", "deferred.md")); err == nil {
		docs.deferred = string(raw)
	} else if !errors.Is(err, fs.ErrNotExist) {
		errs = append(errs, err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		gctx, cancel := context.WithTimeout(ctx, projectDocTimeout)
		defer cancel()
		out, err := exec.CommandContext(gctx, "git", "-c", "core.quotePath=false", "-C", dir, "log", "-200", "--format=%s").Output()
		if err != nil {
			errs = append(errs, fmt.Errorf("git log in %s: %w", dir, err))
		}
		docs.gitLog = string(out)
	}
	return docs, errors.Join(errs...)
}
