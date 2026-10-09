// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	// SetupTimeout bounds a plan's Setup command. It runs under the dag mutation lock, so Setup is for
	// preparing a worktree (junctions, a config file), not for an install.
	SetupTimeout = 2 * time.Minute
	// VerifyTimeout bounds a plan's Verify command at a merge point.
	VerifyTimeout = 20 * time.Minute
	// VerifyProgressInterval is how often a running Verify, or a final stage command, publishes its output
	// tail. They are the engine steps that run a long command outside a block, so without this their output
	// does not exist anywhere until they exit and a 20-minute run is opaque for 20 minutes.
	VerifyProgressInterval = 10 * time.Second
	// MaxPlanOutputLen is how much of a plan command's output is kept: the tail. It is sized so a failing
	// early stage of a chained Verify is still in it after the later stages have run.
	MaxPlanOutputLen = 8000
	// MaxFailureBlocksLen bounds the failure blocks a failed plan command keeps from its whole output. The
	// tail alone loses them: a failing Go package prints its whole log, and a chatty one pushes the failing
	// test out of the last MaxPlanOutputLen bytes.
	MaxFailureBlocksLen = 4000
	// panicBlockLines is how much of a panic's goroutine trace its block keeps.
	panicBlockLines = 20
	// a killed shell's children can hold its output pipe open; this bounds the wait for them.
	planCommandWaitDelay = 5 * time.Second
)

// planCommandError is a Setup or Verify command that did not exit 0.
type planCommandError struct {
	exitCode int           // -1 when there is no exit code to report
	timeout  time.Duration // set when the command was killed at its timeout
	killed   string        // the forced exit, set when something outside ended the command
	output   string
}

// reason is the short cause a wake line carries.
func (e *planCommandError) reason() string {
	switch {
	case e.timeout > 0:
		return "timed out after " + shortDuration(e.timeout)
	case e.killed != "":
		return "killed from outside (" + e.killed + ")"
	}
	return fmt.Sprintf("exit %d", e.exitCode)
}

// windowsKillStatuses are exit statuses Windows gives a process something else ended, never one it chose.
var windowsKillStatuses = map[uint32]bool{
	0x40010004: true, // DBG_TERMINATE_PROCESS
	0xC000013A: true, // STATUS_CONTROL_C_EXIT
}

// killedFromOutside names an exit forced on a command, from its exit code and process state text, or "" for an
// exit the command made: a POSIX signal reports -1, a Windows kill one of windowsKillStatuses.
func killedFromOutside(code int, state string) string {
	switch {
	case code == -1:
		return state
	case windowsKillStatuses[uint32(code)]:
		return fmt.Sprintf("exit %#x", uint32(code))
	}
	return ""
}

// planCommandKilled reports whether err is a plan command something outside ended.
func planCommandKilled(err error) bool {
	var pe *planCommandError
	return errors.As(err, &pe) && pe.killed != ""
}

func (e *planCommandError) Error() string {
	if e.output == "" {
		return e.reason()
	}
	return e.reason() + ": " + e.output
}

// preferredFailureMarkers open a line that names the failure itself. They win over failureMarkers
// anywhere in the output: a bare FAIL is only the package summary printed under the failing test.
var preferredFailureMarkers = []string{"--- FAIL", "panic:"}

// failureMarkers start a line of a failing stage's output. Heuristic and additive: a marker that does not
// match costs the old tail behavior, nothing worse.
var failureMarkers = []string{"FAIL", "error:", "assert"}

// firstFailureExcerpt is a window of output, within MaxFailureDetailLen, that starts at the first line a
// preferred failure marker opens, else the first line any other marker opens. It reports "" when no line does.
func firstFailureExcerpt(output string) string {
	if excerpt := excerptAtMarker(output, preferredFailureMarkers); excerpt != "" {
		return excerpt
	}
	return excerptAtMarker(output, failureMarkers)
}

func excerptAtMarker(output string, markers []string) string {
	for rest := output; rest != ""; {
		line, next, _ := strings.Cut(rest, "\n")
		trimmed := strings.TrimSpace(line)
		for _, marker := range markers {
			if len(trimmed) >= len(marker) && strings.EqualFold(trimmed[:len(marker)], marker) {
				start := len(output) - len(rest) + strings.Index(line, trimmed)
				return strings.ToValidUTF8(truncateText(output[start:], MaxFailureDetailLen), "")
			}
		}
		rest = next
	}
	return ""
}

// failureDetail is the cause a failure event carries, within MaxFailureDetailLen. A plan command's output
// chains stages, so its first failing line is the cause and whatever ran after it is noise: the detail
// starts there. Output with no such line is cut from the front, like the tail it was kept as, so its end
// survives. Any other error keeps its head.
func failureDetail(err error) string {
	var pe *planCommandError
	if !errors.As(err, &pe) {
		return truncateText(err.Error(), MaxFailureDetailLen)
	}
	head := pe.reason() + ": "
	room := MaxFailureDetailLen - len(head)
	if excerpt := firstFailureExcerpt(pe.output); excerpt != "" {
		return head + strings.ToValidUTF8(truncateText(excerpt, room), "")
	}
	if len(pe.output) > room {
		return head + strings.ToValidUTF8(pe.output[len(pe.output)-room:], "")
	}
	return pe.Error()
}

func shortDuration(d time.Duration) string {
	if d >= time.Minute && d%time.Minute == 0 {
		return fmt.Sprintf("%dm", int(d/time.Minute))
	}
	return d.String()
}

// planProgress publishes a plan command's output tail while it is still running, reporting whether the
// tail was taken — a sink that declines (its dag was busy, or the task has stopped verifying) must not be
// recorded as having shown this tail, or it would go unpublished until the output changes again. nil for
// a command nobody watches: only Verify has a surface waiting on its progress.
type planProgress func(tail string) bool

// runPlanCommand runs a plan command through a POSIX shell in dir, with env added to its environment, and
// returns the tail of its output, on a pass as well as a failure. A var so engine tests can script Setup and
// Verify without running anything; a stub calls progress itself to script mid-run output.
var runPlanCommand = execPlanCommandEnv

// RunSetup runs a plan's Setup command in dir under SetupTimeout and returns its output tail.
func RunSetup(ctx context.Context, dir, command string) (string, error) {
	return runPlanCommand(ctx, dir, command, nil, SetupTimeout, nil)
}

// ProjectSetupFile is where a project checks in its default Setup: the command every tree the engine makes runs
// when the plan names none, so a lead that leaves Setup out still gets prepared trees.
const ProjectSetupFile = ".arc/setup"

// ProjectSetup reads dir's default Setup command. No file is no default.
func ProjectSetup(dir string) (string, error) {
	b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(ProjectSetupFile)))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", ProjectSetupFile, err)
	}
	var lines []string
	for _, line := range strings.Split(string(b), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) > 1 {
		return "", fmt.Errorf("%s must hold one command, found %d lines", ProjectSetupFile, len(lines))
	}
	if len(lines) == 0 {
		return "", nil
	}
	return lines[0], nil
}

// engineStepBytes is the RAM a Verify claims when memgate does not know its command: verify.mjs's peak. A Final
// claims a dev app's (Source.Peak = memgate.DevBytes).
const engineStepBytes = 2560 << 20

// holdPlanSlot waits for a slot in the heavy-job queue for a plan command memgate calls heavy, or for any
// Verify or Final (Source.Always). A light Setup (this repo's .arc/setup only makes junctions) runs at once.
func holdPlanSlot(ctx context.Context, command string) (func(), error) {
	src := jobqueue.SourceFrom(ctx)
	job, heavy := memgate.Classify(command)
	// a dev server runs until stopped: it never holds a slot, and only an Always step stands in for it
	known := heavy && !job.LongRunning()
	if !known && !src.Always {
		return func() {}, nil
	}
	name, bytes := job.Name, job.Bytes
	if !known {
		name, bytes = src.Label, engineStepBytes
		if src.Peak > 0 {
			bytes = src.Peak
		}
	}
	return jobqueue.Hold(ctx, jobqueue.Request{Name: name, Bytes: bytes, Engine: true, Source: src})
}

// taskStepLabel names an engine step for the cockpit's queue: "Verify · Build the chip", the task's label, or its id
// when it has none, and the step alone when the task is unknown.
func taskStepLabel(step string, g *waveobj.TaskGroup, taskID string) string {
	t := taskByID(g, taskID)
	switch {
	case t == nil:
		return step
	case t.Label != "":
		return step + " · " + t.Label
	}
	return step + " · " + t.ID
}

func execPlanCommandEnv(ctx context.Context, dir, command string, env []string, timeout time.Duration, progress planProgress) (string, error) {
	// before the timeout starts, so the time spent queued never counts against it
	release, err := holdPlanSlot(ctx, command)
	if err != nil {
		return "", err
	}
	defer release()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	c, err := shellCommand(ctx, command)
	if err != nil {
		return "", err
	}
	c.Dir = dir
	if len(env) > 0 {
		if c.Env == nil {
			c.Env = os.Environ()
		}
		c.Env = append(c.Env, env...)
	}
	c.WaitDelay = planCommandWaitDelay
	out := &tailBuffer{max: MaxPlanOutputLen, publish: progress, publishEvery: VerifyProgressInterval}
	c.Stdout, c.Stderr = out, out
	err = runShellCmd(c)
	if err == nil {
		return out.String(), nil
	}
	pe := &planCommandError{exitCode: -1, output: out.failureOutput()}
	var exitErr *exec.ExitError
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		pe.timeout = timeout
	case errors.As(err, &exitErr):
		pe.exitCode = exitErr.ExitCode()
		pe.killed = killedFromOutside(pe.exitCode, exitErr.ProcessState.String())
	case pe.output == "":
		pe.output = err.Error()
	}
	return pe.output, pe
}

// lastOutputLine is the last non-blank line of a plan command's output: the one line a status row has
// room for. "" when there is nothing to show yet.
func lastOutputLine(output string) string {
	lines := strings.Split(output, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return ""
}

// tailBuffer keeps the last max bytes written to it, and hands the tail to publish (when set) at most
// once per publishEvery. Publishing from the write path rather than a ticker goroutine keeps every
// publish inside the command's own lifetime — exec finishes copying output before Wait returns — so no
// publish can outlive the run and overwrite the result it records. Needs no lock: os/exec copies a
// command's output on one goroutine when Stdout and Stderr are the same writer. It also keeps the failure
// blocks it saw in the whole stream, for failureOutput.
type tailBuffer struct {
	max          int
	buf          []byte
	publish      planProgress
	publishEvery time.Duration
	lastPublish  time.Time
	lastSent     string
	total        int             // bytes written, to tell whether the tail dropped any
	partial      []byte          // the line being written, until its newline arrives; bounded by MaxFailureBlocksLen
	blocks       strings.Builder // failure blocks, earliest first, within MaxFailureBlocksLen
	blocksFull   bool            // a block line did not fit: later ones are dropped, not interleaved
	inFailTest   bool            // a --- FAIL block is open: indented lines continue it
	panicLeft    int             // trace lines a panic block still takes
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.total += len(p)
	b.scanLines(p)
	b.buf = append(b.buf, p...)
	if over := len(b.buf) - b.max; over > 0 {
		b.buf = append(b.buf[:0], b.buf[over:]...)
	}
	b.maybePublish(time.Now())
	return len(p), nil
}

func (b *tailBuffer) scanLines(p []byte) {
	for len(p) > 0 {
		i := bytes.IndexByte(p, '\n')
		if i < 0 {
			b.appendPartial(p)
			return
		}
		b.appendPartial(p[:i])
		b.scanLine(strings.TrimRight(string(b.partial), "\r"))
		b.partial = b.partial[:0]
		p = p[i+1:]
	}
}

// appendPartial keeps at most MaxFailureBlocksLen of a line: a marker opens a line, so a longer one's
// rest is never needed.
func (b *tailBuffer) appendPartial(p []byte) {
	if room := MaxFailureBlocksLen - len(b.partial); room > 0 {
		b.partial = append(b.partial, p[:min(len(p), room)]...)
	}
}

func (b *tailBuffer) scanLine(line string) {
	trimmed := strings.TrimSpace(line)
	switch {
	case b.panicLeft > 0:
		b.panicLeft--
		b.keep(line)
	case strings.HasPrefix(trimmed, "--- FAIL:"):
		b.inFailTest = true
		b.keep(line)
	case strings.HasPrefix(trimmed, "panic:"):
		b.inFailTest, b.panicLeft = false, panicBlockLines
		b.keep(line)
	case strings.HasPrefix(line, "FAIL\t") || (strings.HasPrefix(line, "FAIL ") && trimmed != "FAIL"):
		b.inFailTest = false
		b.keep(line) // go test's per-package summary: which package failed
	case b.inFailTest && (strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")):
		b.keep(line)
	default:
		b.inFailTest = false
	}
}

func (b *tailBuffer) keep(line string) {
	if b.blocksFull || b.blocks.Len()+len(line)+1 > MaxFailureBlocksLen {
		b.blocksFull = true
		return
	}
	b.blocks.WriteString(line)
	b.blocks.WriteByte('\n')
}

// failureOutput is what a failed command records. When the tail dropped part of the output, the failure
// blocks found in the whole of it come first, so the failing test outlives a noisy package's log.
func (b *tailBuffer) failureOutput() string {
	if len(b.partial) > 0 {
		b.scanLine(strings.TrimRight(string(b.partial), "\r"))
		b.partial = b.partial[:0]
	}
	tail := b.String()
	if b.total <= b.max || b.blocks.Len() == 0 {
		return tail
	}
	head := strings.TrimSpace(b.blocks.String()) + "\n…\n"
	if room := b.max - len(head); len(tail) > room {
		tail = strings.TrimSpace(strings.ToValidUTF8(tail[len(tail)-room:], ""))
	}
	return head + tail
}

// maybePublish hands the tail over no more than once per publishEvery, and only when it has CHANGED: a
// command whose tail has not moved costs no writes at all. The first write publishes immediately, so a
// command that prints once and then thinks is not reported as silent.
func (b *tailBuffer) maybePublish(now time.Time) {
	if b.publish == nil || now.Sub(b.lastPublish) < b.publishEvery {
		return
	}
	b.lastPublish = now
	if cur := b.String(); cur != b.lastSent && b.publish(cur) {
		b.lastSent = cur
	}
}

// String drops a multi-byte character the cut went through rather than rendering half of it.
func (b *tailBuffer) String() string {
	return strings.TrimSpace(strings.ToValidUTF8(string(b.buf), ""))
}
