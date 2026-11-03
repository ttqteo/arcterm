// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/memgate"
)

// Verify commands: an expert may ask Go to run a command that tests its claim. Go parses the command with no shell,
// runs it only when it is one of three forms, in a throwaway tree at the snapshot the council took at Start, and records
// what came of it on the proposal (CouncilProposal.Runs). No model gets a shell: the command is data Go checks.

// ErrNotOnList is what every rejection of ParseVerifyCommand wraps. Its text, "not on the list", is the start of the
// reason the timeline shows for a command that did not run.
var ErrNotOnList = errors.New("not on the list")

func notOnList(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrNotOnList, fmt.Sprintf(format, a...))
}

// ParseVerifyCommand splits cmd into words, with no shell, and accepts it only as one of
//
//	go test <one package> -run <pattern>     (and the go test flags -v -short -failfast -race -count -timeout -p -parallel
//	                                          -cpu -shuffle -tags -vet, nothing else: -exec and -args would run anything)
//	npx vitest run <one file> [-t <name>]
//	cargo test [--manifest-path <path>] <one test name>
//
// A package, file or manifest path must stay inside the tree: relative, with no .. step. Anything else is an error
// that wraps ErrNotOnList and says which rule it broke: a shell operator anywhere in the text (| & ; < > a backtick,
// $( or a line break, quoted or not: no shell reads the quotes, but a Windows npx goes through cmd.exe), a second
// package or file, a path that leaves the tree, a flag off the list, or another program. The words come back as typed,
// quotes removed.
func ParseVerifyCommand(cmd string) ([]string, error) {
	if strings.TrimSpace(cmd) == "" {
		return nil, notOnList("an empty command")
	}
	if op := verifyShellOperator(cmd); op != "" {
		return nil, notOnList("a shell operator (%s)", op)
	}
	words, err := verifyWords(cmd)
	if err != nil {
		return nil, err
	}
	switch words[0] {
	case "go":
		err = parseGoTest(words)
	case "npx":
		err = parseVitest(words)
	case "cargo":
		err = parseCargoTest(words)
	default:
		err = notOnList("%s is not go test, npx vitest run or cargo test", words[0])
	}
	if err != nil {
		return nil, err
	}
	return words, nil
}

// the shell operators, longest first so the reason names "&&" rather than its first "&"
var verifyOperators = []struct{ op, shown string }{
	{"&&", "&&"}, {"||", "||"}, {"$(", "$("}, {"|", "|"}, {"&", "&"}, {";", ";"}, {">", ">"}, {"<", "<"}, {"`", "`"},
	{"\n", "a line break"}, {"\r", "a line break"},
}

func verifyShellOperator(cmd string) string {
	for _, o := range verifyOperators {
		if strings.Contains(cmd, o.op) {
			return o.shown
		}
	}
	return ""
}

// verifyWords splits on spaces and tabs; a word may hold single- or double-quoted text, which stays in it with the
// quotes dropped. There is no escaping and no expansion: a backslash is a character.
func verifyWords(cmd string) ([]string, error) {
	var (
		words []string
		cur   strings.Builder
		in    bool
		quote rune
	)
	for _, r := range cmd {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote, in = r, true
		case r == ' ' || r == '\t':
			if in {
				words = append(words, cur.String())
				cur.Reset()
				in = false
			}
		default:
			cur.WriteRune(r)
			in = true
		}
	}
	if quote != 0 {
		return nil, notOnList("a quote that is never closed")
	}
	if in {
		words = append(words, cur.String())
	}
	return words, nil
}

var (
	verifyPathChars = regexp.MustCompile(`^[A-Za-z0-9_./@+-]+$`)
	verifyNameChars = regexp.MustCompile(`^[A-Za-z0-9_ ./:@+,-]+$`)
	verifyFlagValue = regexp.MustCompile(`^[A-Za-z0-9_.,:+-]+$`)
	verifyTestName  = regexp.MustCompile(`^[A-Za-z0-9_:]+$`)
)

// verifyTreePath checks p stays inside the tree: not empty, relative, no drive letter, no .. step once cleaned.
func verifyTreePath(p string) error {
	q := strings.ReplaceAll(p, `\`, "/")
	switch {
	case q == "":
		return notOnList("an empty path")
	case strings.HasPrefix(q, "/") || strings.HasPrefix(q, "~") || len(q) >= 2 && q[1] == ':':
		return notOnList("%s is a path outside the tree", p)
	}
	if c := path.Clean(q); c == ".." || strings.HasPrefix(c, "../") {
		return notOnList("%s is a path outside the tree", p)
	}
	return nil
}

// verifyFlag splits a flag word into its name and value: "-count=1", "--count=1" and "-count" all name "count", the first
// two with the value 1. It reports false for a word that is not a flag.
func verifyFlag(w string) (name, val string, hasVal, ok bool) {
	if !strings.HasPrefix(w, "-") || w == "-" || w == "--" {
		return "", "", false, false
	}
	name = strings.TrimPrefix(strings.TrimPrefix(w, "-"), "-")
	name, val, hasVal = strings.Cut(name, "=")
	return name, val, hasVal, true
}

// the go test flags on the list: bool ones, and ones that take a value
var (
	goTestBoolFlags  = map[string]bool{"v": true, "short": true, "failfast": true, "race": true}
	goTestValueFlags = map[string]bool{"run": true, "count": true, "timeout": true, "p": true, "parallel": true, "cpu": true,
		"shuffle": true, "tags": true, "vet": true}
)

func parseGoTest(words []string) error {
	if len(words) < 2 || words[1] != "test" {
		return notOnList("only go test is on the list for go")
	}
	var pkg, run string
	for i := 2; i < len(words); i++ {
		w := words[i]
		name, val, hasVal, isFlag := verifyFlag(w)
		if !isFlag {
			if pkg != "" {
				return notOnList("more than one package (%s and %s): it must be one package", pkg, w)
			}
			if strings.Contains(w, "...") {
				return notOnList("%s names more than one package: it must be one package", w)
			}
			if err := verifyTreePath(w); err != nil {
				return err
			}
			if !verifyPathChars.MatchString(w) || w != "." && !strings.HasPrefix(strings.ReplaceAll(w, `\`, "/"), "./") {
				return notOnList("the package %s must be written ./path", w)
			}
			pkg = w
			continue
		}
		switch {
		case goTestBoolFlags[name]:
			if hasVal && val != "true" && val != "false" {
				return notOnList("-%s takes no value", name)
			}
		case goTestValueFlags[name]:
			if !hasVal {
				if i+1 >= len(words) || strings.HasPrefix(words[i+1], "-") {
					return notOnList("go test -%s needs a value", name)
				}
				i++
				val = words[i]
			}
			if val == "" {
				return notOnList("go test -%s needs a value", name)
			}
			if name != "run" && !verifyFlagValue.MatchString(val) {
				return notOnList("go test -%s has a value off the list (%s)", name, val)
			}
			if name == "run" {
				run = val
			}
		default:
			return notOnList("go test -%s is not a flag on the list", name)
		}
	}
	switch {
	case pkg == "":
		return notOnList("go test needs one package")
	case run == "":
		return notOnList("go test needs -run <pattern>: a whole package is not a test of one claim")
	}
	return nil
}

var vitestFileExts = []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}

func parseVitest(words []string) error {
	if len(words) < 3 || words[1] != "vitest" || words[2] != "run" {
		return notOnList("only npx vitest run is on the list for npx")
	}
	var file string
	for i := 3; i < len(words); i++ {
		w := words[i]
		name, val, hasVal, isFlag := verifyFlag(w)
		if !isFlag {
			if file != "" {
				return notOnList("more than one file (%s and %s): it must be one file", file, w)
			}
			if err := verifyTreePath(w); err != nil {
				return err
			}
			if !verifyPathChars.MatchString(w) || !hasAnySuffix(w, vitestFileExts) {
				return notOnList("%s is not one test file", w)
			}
			file = w
			continue
		}
		if name != "t" && name != "testNamePattern" {
			return notOnList("vitest -%s is not a flag on the list", name)
		}
		if !hasVal {
			if i+1 >= len(words) {
				return notOnList("vitest -%s needs a test name", name)
			}
			i++
			val = words[i]
		}
		if val == "" || strings.HasPrefix(val, "-") || !verifyNameChars.MatchString(val) {
			return notOnList("vitest -%s has a test name off the list (%s)", name, val)
		}
	}
	if file == "" {
		return notOnList("npx vitest run needs one file")
	}
	return nil
}

func hasAnySuffix(s string, suffixes []string) bool {
	for _, x := range suffixes {
		if strings.HasSuffix(s, x) {
			return true
		}
	}
	return false
}

func parseCargoTest(words []string) error {
	if len(words) < 2 || words[1] != "test" {
		return notOnList("only cargo test is on the list for cargo")
	}
	var testName, manifest string
	for i := 2; i < len(words); i++ {
		w := words[i]
		name, val, hasVal, isFlag := verifyFlag(w)
		if !isFlag {
			if testName != "" {
				return notOnList("more than one test (%s and %s): it must be one test name", testName, w)
			}
			if !verifyTestName.MatchString(w) {
				return notOnList("%s is not one test name", w)
			}
			testName = w
			continue
		}
		if name != "manifest-path" {
			return notOnList("cargo test -%s is not a flag on the list", name)
		}
		if !hasVal {
			if i+1 >= len(words) {
				return notOnList("--manifest-path needs a path")
			}
			i++
			val = words[i]
		}
		if err := verifyTreePath(val); err != nil {
			return err
		}
		if !verifyPathChars.MatchString(val) || path.Base(strings.ReplaceAll(val, `\`, "/")) != "Cargo.toml" || manifest != "" {
			return notOnList("--manifest-path %s is not one Cargo.toml", val)
		}
		manifest = val
	}
	if testName == "" {
		return notOnList("cargo test needs one test name")
	}
	return nil
}

// ---- the snapshot ----

// Snapshot takes the project's tree as it is now, HEAD plus the uncommitted changes and the untracked files, as a
// commit, and returns its id. The person's checkout is not touched: it goes through a private GIT_INDEX_FILE seeded from
// HEAD (read-tree, add -A, write-tree, commit-tree with HEAD as the parent), so the real index, the files, HEAD and the
// refs stay as they were. The commit is made under a fixed identity, whatever the user's git config says, and unsigned: commit-tree
// signs only when asked with -S, so a commit.gpgsign setting does not reach it.
// It holds what git would add: ignored files are not in it.
//
// It returns "" and no error for a project that is not in a git repo (or is not there), and for a repo with no commit,
// since no tree can be made at a snapshot that has no parent.
func Snapshot(ctx context.Context, project string) (string, error) {
	if project == "" {
		return "", nil
	}
	inside, err := verifyGit(ctx, project, nil, "rev-parse", "--is-inside-work-tree")
	if err != nil {
		if exitedWith(err) {
			return "", nil
		}
		return "", err
	}
	if inside != "true" {
		return "", nil
	}
	head, err := verifyGit(ctx, project, nil, "rev-parse", "--verify", "HEAD^{commit}")
	if err != nil {
		if exitedWith(err) {
			return "", nil
		}
		return "", err
	}
	dir, err := os.MkdirTemp("", "council-snapshot-")
	if err != nil {
		return "", fmt.Errorf("making the snapshot's index folder: %w", err)
	}
	defer os.RemoveAll(dir)
	env := []string{
		"GIT_INDEX_FILE=" + filepath.Join(dir, "index"),
		"GIT_AUTHOR_NAME=arcterm council", "GIT_AUTHOR_EMAIL=council@arcterm.invalid",
		"GIT_COMMITTER_NAME=arcterm council", "GIT_COMMITTER_EMAIL=council@arcterm.invalid",
	}
	if _, err := verifyGit(ctx, project, env, "read-tree", head); err != nil {
		return "", err
	}
	if _, err := verifyGit(ctx, project, env, "add", "-A"); err != nil {
		return "", err
	}
	tree, err := verifyGit(ctx, project, env, "write-tree")
	if err != nil {
		return "", err
	}
	return verifyGit(ctx, project, env, "commit-tree", tree, "-p", head, "-m", "arcterm council snapshot")
}

// exitedWith says err is git itself exiting non-zero, as opposed to git not starting or the context ending.
func exitedWith(err error) bool {
	var ee *exec.ExitError
	return errors.As(err, &ee)
}

// verifyGit runs git in dir with env added and returns its trimmed stdout. Its stderr (an
// autocrlf warning, say) stays out of the result and goes into the error on a failure.
func verifyGit(ctx context.Context, dir string, env []string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), append(env, "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")...)
	cmd.WaitDelay = 10 * time.Second
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil && !errors.Is(err, exec.ErrWaitDelay) {
		return "", fmt.Errorf("git %s: %w: %s", args[0], err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// ---- the tree seam ----

// TreeMaker makes and removes the throwaway tree the verify commands run in. pkg/orchestrate implements it (it already
// imports this package, so this one cannot import it) and wavesrv wires it into Runner.Trees.
type TreeMaker interface {
	// Make checks the project's repo out, detached, at commit (the council's Snapshot) in a tree of its own named for key
	// ("council-<id>"), links the dependencies the project's tests need, and returns the directory the commands run in:
	// the tree's counterpart of project. It makes no branch.
	Make(ctx context.Context, project, commit, key string) (dir string, err error)
	// Remove deletes the tree Make returned, without following a link into the project's own folders.
	Remove(ctx context.Context, project, dir string) error
}

// ---- running the commands ----

const (
	verifyCap       = 2               // commands one expert may have run per council
	verifyTailLines = 40              // lines of a command's output kept on the run
	verifyTailBytes = 16 << 10        // and at most this many bytes of them, the end of the output
	verifyKeepBytes = 256 << 10       // the output the launcher holds to classify a result by
	verifyRemoveFor = 2 * time.Minute // how long removing the tree may take, a Stop included
	verifyReasonCap = "over the 2-command cap"
	// reasons a run does not run, besides ErrNotOnList's
	verifyReasonNoRepo = "not a git repo"
	verifyReasonNoTree = "no tree to run it in"
)

// the seams a test replaces
var (
	// verifyTimeout bounds one command's run, not the wait for its slot.
	verifyTimeout = 3 * time.Minute
	verifyNow     = func() int64 { return time.Now().UnixMilli() }
	// runVerifyCmd runs argv in dir and returns its output (stdout and stderr together) and its exit code. A non-zero
	// exit is a result, not an error: the error is for a command that could not be started, and for a ctx that ended
	// (the process tree is killed first).
	runVerifyCmd = realVerifyCmd
)

// RunVerifies runs the verify commands the sent, uncut proposals of c asked for (the runs whose State is still empty)
// and records on each run its State, Exit, Tail, Matched and Reason. It works on c in place: the caller gives it a council
// no one else writes while it runs, and reads the runs back after, or as onStep says one finished.
//
// At most 2 commands per expert are kept, in the order asked, the off-the-list ones counting (the rest are not-run, over
// the cap); runs a first call already handled count too. One tree is made, keyed council-<id> at c.Snapshot, only when
// a command that may run is left; each command takes a job-queue slot sized by memgate (the size of a council call with
// tools when memgate calls it light) and stops after 3 minutes. A result counts as pass or fail only when it tested the
// claim: a timeout, a filter that matched no test and a build failure are not-run, with the reason.
//
// onStep is told of every command twice, a run step before it starts and one after with the same Ts and Target and the
// Result filled (pass, fail, or "not run: <reason>"): the second replaces the first row on the timeline. A command that
// never started gets only the second.
//
// A nil trees, an empty c.Snapshot (the project is not a git repo) and a tree that cannot be made run nothing, and say why
// in each run's Reason. The tree is removed when this returns, on an error and when ctx ends too (a Stop): a Stop leaves
// the commands it cut off as requests, so a later call can run them.
func RunVerifies(ctx context.Context, trees TreeMaker, c *Council, onStep func(expertId string, s CouncilStep)) {
	if c == nil {
		return
	}
	if onStep == nil {
		onStep = func(string, CouncilStep) {}
	}
	v := &verifier{c: c, onStep: onStep}

	// the requests still open, in the order asked; the ones that may not run carry their reason already. What each
	// expert's cap already holds is the runs a first call handled, bar the ones it capped.
	taken := map[string]int{}
	forEachAsked := func(f func(p *CouncilProposal, r *CouncilRun)) {
		for i := range c.Proposals {
			if p := &c.Proposals[i]; Sent(p.Draft) && !p.Cut {
				for j := range p.Runs {
					f(p, &p.Runs[j])
				}
			}
		}
	}
	forEachAsked(func(p *CouncilProposal, r *CouncilRun) {
		if r.State != "" && r.Reason != verifyReasonCap {
			taken[p.Author]++
		}
	})
	var items []verifyItem
	runnable := 0
	forEachAsked(func(p *CouncilProposal, r *CouncilRun) {
		if r.State != "" {
			return
		}
		it := verifyItem{author: p.Author, run: r}
		if taken[p.Author] >= verifyCap {
			it.reason = verifyReasonCap
		} else {
			taken[p.Author]++
			var err error
			if it.argv, err = ParseVerifyCommand(r.Command); err != nil {
				it.reason = err.Error()
			} else {
				runnable++
			}
		}
		items = append(items, it)
	})

	// where the runnable ones go, when anywhere does: the tree is made only if one is left
	why, dir := "", ""
	switch {
	case runnable == 0:
	case c.Snapshot == "":
		why = verifyReasonNoRepo
	case trees == nil:
		why = verifyReasonNoTree
	default:
		var err error
		if dir, err = trees.Make(ctx, c.Project, c.Snapshot, "council-"+c.Id); err != nil {
			if ctx.Err() != nil {
				return
			}
			why = "could not make the tree: " + verifyShortErr(err)
			break
		}
		defer func() {
			// not ctx: a Stop has ended it, and the tree still has to go
			rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), verifyRemoveFor)
			defer cancel()
			if err := trees.Remove(rctx, c.Project, dir); err != nil {
				log.Printf("council %s: removing the verify tree %s: %v", c.Id, dir, err)
			}
		}()
	}

	for _, it := range items {
		if ctx.Err() != nil {
			return
		}
		switch {
		case it.reason != "":
			v.skip(it.author, it.run, it.reason)
		case why != "":
			v.skip(it.author, it.run, why)
		case !v.runOne(ctx, dir, it):
			return
		}
	}
}

// verifyItem is one open request: its argv when it may run, else the reason it may not.
type verifyItem struct {
	author string
	run    *CouncilRun
	argv   []string
	reason string
}

type verifier struct {
	c      *Council
	onStep func(string, CouncilStep)
}

func (v *verifier) expertName(id string) string {
	for _, e := range v.c.Experts {
		if e.Id == id && e.Name != "" {
			return e.Name
		}
	}
	return id
}

// skip records a command that did not start: one closing step is all the timeline gets for it.
func (v *verifier) skip(author string, r *CouncilRun, reason string) {
	markNotRun(r, reason)
	v.onStep(author, CouncilStep{Ts: verifyNow(), Kind: StepRun, Target: r.Command, Result: "not run: " + reason})
}

func markNotRun(r *CouncilRun, reason string) {
	r.State, r.Reason, r.Matched = RunNotRun, reason, false
}

// runOne runs one command and records it. It reports false when ctx ended (a Stop) before there was a result, in which
// case it records none and the run stays a request.
func (v *verifier) runOne(ctx context.Context, dir string, it verifyItem) bool {
	r := it.run
	step := CouncilStep{Ts: verifyNow(), Kind: StepRun, Target: r.Command}
	v.onStep(it.author, step)
	closing := func() {
		step.Result = "not run: " + r.Reason
		if r.State != RunNotRun {
			step.Result = r.State
		}
		v.onStep(it.author, step)
	}

	// the size memgate gives the command, or what a council call with tools claims when it calls the command light
	need := toolSlotBytes
	if job, ok := memgate.Classify(r.Command); ok {
		need = job.Bytes
	}
	src := jobqueue.SourceFrom(ctx)
	src.Label = "Council verify · " + v.expertName(it.author)
	release, err := holdSlot(ctx, jobqueue.Request{Name: src.Label, Bytes: need, Engine: true, Source: src})
	if err != nil {
		if ctx.Err() != nil {
			return false
		}
		if errors.Is(err, jobqueue.ErrSkipped) {
			markNotRun(r, "skipped from the job queue")
		} else {
			markNotRun(r, "waiting for a slot: "+verifyShortErr(err))
		}
		closing()
		return true
	}
	runCtx, cancel := context.WithTimeout(ctx, verifyTimeout)
	out, exit, err := runVerifyCmd(runCtx, dir, it.argv)
	timedOut := ctx.Err() == nil && errors.Is(runCtx.Err(), context.DeadlineExceeded)
	cancel()
	release()
	if ctx.Err() != nil {
		return false
	}

	r.Tail = verifyTail(out)
	switch {
	case timedOut:
		markNotRun(r, verifyTimeoutReason(verifyTimeout))
	case err != nil:
		r.Tail = ""
		markNotRun(r, "could not start: "+verifyShortErr(err))
	default:
		state, reason := verifyOutcome(it.argv, out, exit)
		r.Exit = exit
		if state == RunNotRun {
			markNotRun(r, reason)
		} else {
			r.State, r.Reason, r.Matched = state, "", state == r.Expect
		}
	}
	closing()
	return true
}

func verifyTimeoutReason(d time.Duration) string {
	if d%time.Minute == 0 {
		return fmt.Sprintf("timed out after %d min", d/time.Minute)
	}
	return "timed out after " + d.Round(time.Millisecond).String()
}

func verifyShortErr(err error) string {
	s := strings.Join(strings.Fields(err.Error()), " ")
	if r := []rune(s); len(r) > 200 {
		return string(r[:200]) + "…"
	}
	return s
}

// ---- reading a result ----

var (
	goBuildFailed = regexp.MustCompile(`\[(build|setup) failed\]`)
	goTestFailed  = regexp.MustCompile(`(?m)^\s*(--- FAIL|FAIL\b|panic:)`)
	cargoRunning  = regexp.MustCompile(`(?m)^running (\d+) tests?\b`)
	cargoResult   = regexp.MustCompile(`(?m)^test result:`)
	vitestFiles   = regexp.MustCompile(`(?m)^\s*Test Files\s`)
	vitestTests   = regexp.MustCompile(`(?m)^\s*Tests\s+(.*)$`)
	// what a vitest run says when a test file never loaded
	vitestLoadErrors = []string{"Transform failed", "SyntaxError", "Failed to parse source", "Failed to resolve import", "Cannot find module"}
)

const (
	verifyNoTestMatched = "no test matched the filter"
	verifyDidNotBuild   = "did not build"
	verifyDidNotRun     = "did not run"
)

// verifyOutcome reads what a command printed and how it exited: RunPass or RunFail when it ran a test, and RunNotRun
// with the reason when it did not test the claim (no test matched the filter, or it did not build or start), since
// only a test that ran says anything about the claim.
func verifyOutcome(argv []string, out string, exit int) (state, reason string) {
	verdict := func() (string, string) {
		if exit == 0 {
			return RunPass, ""
		}
		return RunFail, ""
	}
	switch argv[0] {
	case "go":
		switch {
		case goBuildFailed.MatchString(out):
			return RunNotRun, verifyDidNotBuild
		case strings.Contains(out, "no tests to run") || strings.Contains(out, "[no test files]"):
			return RunNotRun, verifyNoTestMatched
		case exit != 0 && !goTestFailed.MatchString(out):
			// go test exited before any test failed: a package it could not find or load
			return RunNotRun, verifyDidNotBuild
		}
	case "npx":
		for _, m := range vitestLoadErrors {
			if strings.Contains(out, m) {
				return RunNotRun, verifyDidNotBuild
			}
		}
		switch {
		case strings.Contains(out, "No test files found"):
			return RunNotRun, verifyNoTestMatched
		case exit == 0:
			// a -t filter that matched nothing leaves every test skipped
			if m := vitestTests.FindStringSubmatch(out); m != nil && !strings.Contains(m[1], "passed") {
				return RunNotRun, verifyNoTestMatched
			}
		case !vitestFiles.MatchString(out):
			return RunNotRun, verifyDidNotRun
		}
	case "cargo":
		running, total := cargoRunning.FindAllStringSubmatch(out, -1), 0
		for _, m := range running {
			n, _ := strconv.Atoi(m[1])
			total += n
		}
		switch {
		case len(running) == 0 && (strings.Contains(out, "error[E") || strings.Contains(out, "could not compile")):
			return RunNotRun, verifyDidNotBuild
		case len(running) > 0 && total == 0:
			return RunNotRun, verifyNoTestMatched
		case exit != 0 && !cargoResult.MatchString(out):
			return RunNotRun, verifyDidNotBuild
		}
	}
	return verdict()
}

var verifyANSI = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

// verifyTail is the last 40 lines of a command's output, as text for the card: colour codes and carriage-return
// repaints gone, trailing blanks dropped, and at most 16 KB of it, the end.
func verifyTail(out string) string {
	out = verifyANSI.ReplaceAllString(strings.ToValidUTF8(out, ""), "")
	lines := strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n")
	for i, l := range lines {
		if k := strings.LastIndex(strings.TrimRight(l, "\r"), "\r"); k >= 0 {
			// a progress meter repaints the line: keep what it ended on
			l = l[k+1:]
		}
		lines[i] = strings.TrimRight(l, " \t\r")
	}
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) > verifyTailLines {
		lines = lines[len(lines)-verifyTailLines:]
	}
	s := strings.Join(lines, "\n")
	if len(s) > verifyTailBytes {
		// the cut may fall inside a rune
		s = strings.ToValidUTF8(s[len(s)-verifyTailBytes:], "")
	}
	return s
}

// ---- the real launcher ----

// tailBuffer keeps the end of what is written to it: a command's output is read for its last lines and a few markers,
// and a test run can print a great deal.
type tailBuffer struct {
	mu   sync.Mutex
	keep int
	b    []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.b = append(t.b, p...)
	if len(t.b) > 2*t.keep {
		t.b = append(t.b[:0], t.b[len(t.b)-t.keep:]...)
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	b := t.b
	if len(b) > t.keep {
		b = b[len(b)-t.keep:]
	}
	return string(b)
}

// realVerifyCmd starts argv in dir, with colour and watch modes off, and waits for it. When ctx ends (the limit, or a
// Stop) it kills the command's whole process tree, not only the launcher: `go test` leaves its test binary, and `npx` its
// node, running otherwise.
func realVerifyCmd(ctx context.Context, dir string, argv []string) (string, int, error) {
	c := exec.CommandContext(ctx, argv[0], argv[1:]...)
	c.Dir = dir
	c.Env = append(os.Environ(), "CI=1", "NO_COLOR=1", "CARGO_TERM_COLOR=never")
	buf := &tailBuffer{keep: verifyKeepBytes}
	c.Stdout, c.Stderr = buf, buf
	// a grandchild that outlives the command and holds the pipe must not hold the wait
	c.WaitDelay = 5 * time.Second
	err := runTree(c)
	out := buf.String()
	var ee *exec.ExitError
	switch {
	case ctx.Err() != nil:
		return out, -1, ctx.Err()
	case err == nil, errors.Is(err, exec.ErrWaitDelay):
		return out, 0, nil
	case errors.As(err, &ee):
		return out, ee.ExitCode(), nil
	}
	return out, -1, err
}
