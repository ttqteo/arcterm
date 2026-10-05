// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package doccompile compiles a LaTeX document to a PDF for the doc review's PDF tab. It finds the root
// file a section belongs to, runs latexmk (else tectonic) with its output kept in Arc's data dir rather
// than the repo, and reads the page count and the first error back out of the engine's log.
package doccompile

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	defaultCompileTimeout = 90 * time.Second
	logTailLines          = 40
	// A magic root comment is only honoured in a file's first lines, as editors do.
	magicScanLines = 20
	// \documentclass opens a root file, so a prefix is enough to tell a root from a section.
	headReadLimit = 64 << 10
	// A runaway document can print without end; the engine's output is kept up to here.
	engineOutputCap = 4 << 20
	logReadLimit    = 16 << 20
	// How many lines after a "! " line the matching "l.<n>" line may sit: LaTeX prints its help text
	// between the two for a package error.
	errorLineWindow = 15
	// A log older than the run that just failed is somebody else's, but the clock and the file system
	// disagree by a little.
	logClockSlack = 2 * time.Second
	outDirHexLen  = 12
)

// Result is what one compile reports.
type Result struct {
	RootPath   string // "" = no root found
	PdfPath    string // set only when the compile succeeded
	Ok         bool
	Engine     string // "latexmk" | "tectonic" | "" (none on PATH, or no root)
	DurationMs int64
	Pages      int
	LogTail    string
	FirstError string
}

// engineCmd is one engine invocation, resolved far enough that a test can stand in for running it.
type engineCmd struct {
	Name     string // "latexmk" | "tectonic"
	Bin      string // what lookPath resolved
	Args     []string
	Dir      string // the root's directory: relative \input and \includegraphics resolve from here
	OutDir   string
	RootFile string // the root's base name, which is the engine's input and names its .pdf and .log
}

// Package-level so tests can substitute them: the engine runner, the PATH lookup, the data dir and the
// time limit.
var (
	runEngine      = execEngine
	lookPath       = exec.LookPath
	dataDir        = wavebase.GetWaveDataDir
	compileTimeout = defaultCompileTimeout
)

// flight is a compile in progress: later requests for the same root wait on done instead of starting
// their own, so two engines never fight over one root's .aux files.
type flight struct {
	done    chan struct{}
	res     *Result
	waiters int
}

var (
	mu       sync.Mutex
	inflight = map[string]*flight{}
)

var (
	magicRootRe = regexp.MustCompile(`(?i)^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$`)
	docClassRe  = regexp.MustCompile(`\\documentclass\b`)
	pagesRe     = regexp.MustCompile(`\((\d+) pages?\b`)
	texLineRe   = regexp.MustCompile(`^l\.\d+`)
)

// FindTexRoot returns the root .tex file that path belongs to, or "" when it has none. First match wins:
// a `% !TEX root = <rel>` line in the first 20 lines (resolved against the file's dir); the file itself
// when it has a \documentclass; else, in the file's parent dir and the one above it, a .tex file with a
// \documentclass (main.tex first, then by name). It errors only when path is not a readable .tex file.
func FindTexRoot(path string) (string, error) {
	if !strings.EqualFold(filepath.Ext(path), ".tex") {
		return "", fmt.Errorf("doccompile: %s is not a .tex file", path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	head, err := readHead(abs)
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(abs)

	if rel := magicRoot(head); rel != "" {
		if p := resolveMagicRoot(dir, rel); p != "" {
			return p, nil
		}
	}
	if hasDocumentClass(head) {
		return abs, nil
	}
	for range 2 {
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
		if p := rootIn(dir); p != "" {
			return p, nil
		}
	}
	return "", nil
}

func readHead(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf, err := io.ReadAll(io.LimitReader(f, headReadLimit))
	if err != nil {
		return "", err
	}
	return string(buf), nil
}

func splitLines(s string) []string {
	return strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
}

// stripComment drops a line's % comment: the first % that is not escaped as \%.
func stripComment(line string) string {
	for i := 0; i < len(line); i++ {
		if line[i] != '%' {
			continue
		}
		slashes := 0
		for j := i - 1; j >= 0 && line[j] == '\\'; j-- {
			slashes++
		}
		if slashes%2 == 0 {
			return line[:i]
		}
	}
	return line
}

func hasDocumentClass(text string) bool {
	for _, line := range splitLines(text) {
		if docClassRe.MatchString(stripComment(line)) {
			return true
		}
	}
	return false
}

func magicRoot(head string) string {
	for i, line := range splitLines(head) {
		if i >= magicScanLines {
			break
		}
		if m := magicRootRe.FindStringSubmatch(line); m != nil {
			return strings.Trim(m[1], `"`)
		}
	}
	return ""
}

// resolveMagicRoot turns a magic comment's target into an existing file, or "". Editors let the comment
// omit the .tex extension, so it is tried both ways. A comment that names a file that is gone is stale
// and does not count as a match.
func resolveMagicRoot(dir, rel string) string {
	p := filepath.FromSlash(rel)
	if !filepath.IsAbs(p) {
		p = filepath.Join(dir, p)
	}
	p = filepath.Clean(p)
	for _, cand := range []string{p, p + ".tex"} {
		if info, err := os.Stat(cand); err == nil && info.Mode().IsRegular() {
			return cand
		}
	}
	return ""
}

// rootIn returns the .tex file in dir that has a \documentclass, main.tex first and the rest by name.
func rootIn(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var names []string
	for _, e := range entries {
		if e.Type().IsRegular() && strings.EqualFold(filepath.Ext(e.Name()), ".tex") {
			names = append(names, e.Name())
		}
	}
	sort.Slice(names, func(i, j int) bool {
		mi, mj := strings.EqualFold(names[i], "main.tex"), strings.EqualFold(names[j], "main.tex")
		if mi != mj {
			return mi
		}
		return names[i] < names[j]
	})
	for _, name := range names {
		head, err := readHead(filepath.Join(dir, name))
		if err == nil && hasDocumentClass(head) {
			return filepath.Join(dir, name)
		}
	}
	return ""
}

// OutDir is where a root's compile output goes: <data dir>/doccompile/<12 hex of sha1(root)>. It is never
// inside the repo, so the repo's own compile folder and an agent's build are left alone.
func OutDir(root string) string {
	sum := sha1.Sum([]byte(root))
	return filepath.Join(dataDir(), "doccompile", hex.EncodeToString(sum[:])[:outDirHexLen])
}

// Compile compiles the root that path belongs to. With no root it returns at once with RootPath "" and
// looks for no engine, so the caller can tell "no root" from "no engine". A request that arrives while
// the same root is compiling waits for that compile and gets its result. An error is returned only when
// path cannot be read as a .tex file or the caller's ctx ends first; a failed compile is a Result.
func Compile(ctx context.Context, path string) (*Result, error) {
	root, err := FindTexRoot(path)
	if err != nil {
		return nil, err
	}
	if root == "" {
		return &Result{}, nil
	}

	mu.Lock()
	f := inflight[root]
	if f != nil {
		f.waiters++
	} else {
		f = &flight{done: make(chan struct{})}
		inflight[root] = f
		go runFlight(root, f)
	}
	mu.Unlock()

	select {
	case <-f.done:
		res := *f.res // each caller owns its copy
		return &res, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// runFlight runs the compile on its own goroutine, not the first caller's, so a caller that leaves does
// not cancel the result everyone else is waiting on. The time limit still bounds it.
func runFlight(root string, f *flight) {
	defer func() {
		if err := panichandler.PanicHandler("doccompile:compile", recover()); err != nil {
			f.res = &Result{RootPath: root, LogTail: err.Error()}
		}
		mu.Lock()
		delete(inflight, root)
		mu.Unlock()
		close(f.done)
	}()
	f.res = compileRoot(root)
}

func pickEngine(root string) (engineCmd, bool) {
	out := OutDir(root)
	file := filepath.Base(root)
	dir := filepath.Dir(root)
	if bin, err := lookPath("latexmk"); err == nil {
		return engineCmd{
			Name: "latexmk", Bin: bin, Dir: dir, OutDir: out, RootFile: file,
			Args: []string{"-pdf", "-interaction=nonstopmode", "-halt-on-error", "-outdir=" + out, file},
		}, true
	}
	if bin, err := lookPath("tectonic"); err == nil {
		return engineCmd{
			Name: "tectonic", Bin: bin, Dir: dir, OutDir: out, RootFile: file,
			Args: []string{"--keep-logs", "--outdir", out, file},
		}, true
	}
	return engineCmd{}, false
}

func compileRoot(root string) *Result {
	res := &Result{RootPath: root}
	cmd, found := pickEngine(root)
	if !found {
		return res
	}
	res.Engine = cmd.Name
	start := time.Now()
	defer func() { res.DurationMs = time.Since(start).Milliseconds() }()

	if err := os.MkdirAll(cmd.OutDir, 0o755); err != nil {
		res.LogTail = "Could not create the output folder: " + err.Error()
		return res
	}
	ctx, cancel := context.WithTimeout(context.Background(), compileTimeout)
	defer cancel()
	output, runErr := runEngine(ctx, cmd)
	timedOut := errors.Is(ctx.Err(), context.DeadlineExceeded)
	log.Printf("[doccompile] %s %s in %s: err=%v timedout=%v\n", cmd.Name, cmd.RootFile, time.Since(start).Round(time.Millisecond), runErr, timedOut)

	engineLog := readEngineLog(cmd, start, runErr == nil, output)
	res.Ok = runErr == nil && fileExists(pdfPath(cmd))
	if res.Ok {
		res.PdfPath = pdfPath(cmd)
		res.Pages = PagesFromLog(engineLog)
	} else {
		res.FirstError = FirstErrorFromLog(engineLog)
	}
	res.LogTail = lastLines(engineLog, logTailLines)
	// Failures that never reached TeX's own log have nothing in LogTail to explain them.
	if timedOut {
		res.LogTail = strings.TrimLeft(res.LogTail+"\nCompile timed out after "+compileTimeout.String()+".", "\n")
	} else if runErr != nil && strings.TrimSpace(engineLog) == "" {
		res.LogTail = runErr.Error()
	}
	return res
}

func pdfPath(c engineCmd) string {
	return filepath.Join(c.OutDir, strings.TrimSuffix(c.RootFile, filepath.Ext(c.RootFile))+".pdf")
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// readEngineLog returns the engine's .log file, which holds TeX's own transcript, else its console
// output. A log older than this run is used only after a clean exit: latexmk with nothing to do leaves the
// earlier run's log (and PDF) in place, and the page count lives in it, but after a failure it would
// describe somebody else's compile.
func readEngineLog(c engineCmd, start time.Time, clean bool, output string) string {
	path := strings.TrimSuffix(pdfPath(c), ".pdf") + ".log"
	info, err := os.Stat(path)
	if err != nil || (!clean && info.ModTime().Before(start.Add(-logClockSlack))) {
		return output
	}
	f, err := os.Open(path)
	if err != nil {
		return output
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, logReadLimit))
	if err != nil || len(data) == 0 {
		return output
	}
	return string(data)
}

func lastLines(s string, n int) string {
	lines := splitLines(strings.TrimRight(s, "\r\n"))
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// PagesFromLog reads the page count off the engine's `Output written on <file> (<n> pages, …)` line, which
// pdfTeX, XeTeX and LuaTeX all print: a PDF's page tree is compressed into object streams by default and
// cannot be read with a regex. 0 when there is no such line. TeX wraps its log at 79 columns, which can put
// the count on the line after a long path, so the line breaks after the marker are dropped before matching.
func PagesFromLog(log string) int {
	const marker = "Output written on"
	i := strings.LastIndex(log, marker)
	if i < 0 {
		return 0
	}
	rest := log[i+len(marker):]
	if j := strings.Index(rest, "Transcript written on"); j >= 0 {
		rest = rest[:j]
	}
	rest = strings.NewReplacer("\r", "", "\n", "").Replace(rest)
	m := pagesRe.FindStringSubmatch(rest)
	if m == nil {
		return 0
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return 0
	}
	return n
}

// FirstErrorFromLog returns the log's first "! " line and the "l.<n>" line that follows it, joined by a
// newline; just the "! " line when no l.<n> line is close behind it, and "" when the log has no error.
func FirstErrorFromLog(log string) string {
	lines := splitLines(log)
	for i, line := range lines {
		if !strings.HasPrefix(line, "! ") {
			continue
		}
		msg := strings.TrimRight(line, " \t")
		for j := i + 1; j < len(lines) && j <= i+errorLineWindow; j++ {
			if texLineRe.MatchString(lines[j]) {
				return msg + "\n" + strings.TrimRight(lines[j], " \t")
			}
		}
		return msg
	}
	return ""
}

// cappedBuffer keeps the first max bytes written to it and drops the rest, always reporting success so the
// engine never blocks on a full pipe.
type cappedBuffer struct {
	buf bytes.Buffer
	max int
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if room := c.max - c.buf.Len(); room > 0 {
		if len(p) > room {
			c.buf.Write(p[:room])
		} else {
			c.buf.Write(p)
		}
	}
	return len(p), nil
}

// engineEnv is env without MSYS_NO_PATHCONV. MiKTeX's latexmk can run on Git's msys perl, which passes
// pdflatex the -outdir as a POSIX path ("/tmp/..."); with conversion off pdflatex reads it against the drive
// root, writes the log where latexmk never looks, and every compile fails. Plan commands set the variable,
// so Verify and the dev app Final starts inherit it.
func engineEnv(env []string) []string {
	return slices.DeleteFunc(slices.Clone(env), func(kv string) bool {
		return strings.HasPrefix(strings.ToUpper(kv), "MSYS_NO_PATHCONV=")
	})
}

// execEngine runs the engine with stdout and stderr merged. wavesrv runs without a console window of its
// own, so a child inherits that and opens none. latexmk spawns pdflatex, so on Windows the engine runs in
// a job object and a timeout kills the whole tree, not only latexmk.
func execEngine(ctx context.Context, c engineCmd) (string, error) {
	cmd := exec.CommandContext(ctx, c.Bin, c.Args...)
	cmd.Dir = c.Dir
	cmd.Env = engineEnv(os.Environ())
	out := &cappedBuffer{max: engineOutputCap}
	cmd.Stdout = out
	cmd.Stderr = out
	// A killed latexmk can leave pdflatex holding the output pipe, which would keep Wait from returning.
	cmd.WaitDelay = 3 * time.Second
	var job atomic.Uint64
	// Set before Start so the context watcher Start spawns never reads it while it is written.
	cmd.Cancel = func() error {
		if j := job.Load(); j != 0 {
			jobobject.KillTree(uintptr(j))
		} else if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return nil
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}
	if j, err := jobobject.Attach(cmd.Process); err == nil {
		job.Store(uint64(j))
	}
	err := cmd.Wait()
	if j := job.Load(); j != 0 {
		jobobject.Close(uintptr(j))
	}
	return out.buf.String(), err
}
