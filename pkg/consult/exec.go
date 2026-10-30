// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The process-running half of pkg/consult: stream a headless CLI's reply to a callback while
// capturing the full text. Three read strategies, selected by RuntimeSpec: raw stdout, JSONL-parsed
// stdout, or a pty (see RuntimeSpec docs). Installation probing lives in pkg/harness, the single
// catalog all runtime identity flows through.

package consult

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/creack/pty"
)

// stderrCapBytes bounds the owned stderr capture file: a hung child or a descendant
// that outlives it can keep writing indefinitely, and truncation keeps disk bounded.
const stderrCapBytes = int64(16 << 20)

// Run executes the runtime in one-shot mode with the given prompt and cwd, calling emit for each
// reply fragment as it arrives, and returns the complete captured reply.
func Run(ctx context.Context, spec RuntimeSpec, cwd, prompt string, emit func(string)) (string, error) {
	if spec.ApiBackend != nil {
		return spec.ApiBackend.Run(ctx, spec, prompt, emit)
	}
	if spec.UsePty {
		return runPty(ctx, spec, cwd, prompt, emit)
	}
	return runPipe(ctx, spec, cwd, prompt, emit)
}

// Usage is what one call consumed, as the runtime reported it. Zero fields mean unreported: CLI
// runtimes surface neither the model they resolved nor token counts.
type Usage struct {
	Model       string
	TotalTokens int
}

// usageBackend is an apiBackend that also reports usage.
type usageBackend interface {
	RunWithUsage(ctx context.Context, spec RuntimeSpec, prompt string, emit func(string)) (string, Usage, error)
}

// RunWithUsage is Run plus the call's usage, when the runtime reports it.
func RunWithUsage(ctx context.Context, spec RuntimeSpec, cwd, prompt string, emit func(string)) (string, Usage, error) {
	if ub, ok := spec.ApiBackend.(usageBackend); ok {
		return ub.RunWithUsage(ctx, spec, prompt, emit)
	}
	full, err := Run(ctx, spec, cwd, prompt, emit)
	return full, Usage{}, err
}

// RunClaude runs claude once with the call's own model and tools, returns the reply and what the
// call consumed (the model alias it asked for, and the token total its result event reported), and
// calls onTool with a description of each tool call the assistant makes while it works. onTool may
// be nil. Run and RunWithUsage are unchanged: this is the path for a caller that picks the model and
// tools per call and shows the work.
func RunClaude(ctx context.Context, cwd, prompt string, o CallOpts, onTool func(string)) (string, Usage, error) {
	spec, ok := SpecFor("claude")
	if !ok {
		return "", Usage{}, fmt.Errorf("claude has no headless spec")
	}
	spec.BaseArgs = ClaudeArgs(o)
	return runClaudeSpec(ctx, spec, cwd, prompt, o.Model, onTool)
}

// runClaudeSpec is RunClaude on a given spec: it wraps the spec's parser to watch the tool and result
// events and runs it through the pipe path. The wrapper runs on the read loop's goroutine, one line at
// a time, so the token total needs no lock.
func runClaudeSpec(ctx context.Context, spec RuntimeSpec, cwd, prompt, model string, onTool func(string)) (string, Usage, error) {
	parse := spec.ParseLine
	var tokens int64
	spec.ParseLine = func(line []byte) ParsedEvent {
		ev := parse(line)
		if ev.Tool != "" && onTool != nil {
			onTool(ev.Tool)
		}
		if ev.Tokens > 0 {
			tokens = ev.Tokens
		}
		return ev
	}
	full, err := runPipe(ctx, spec, cwd, prompt, func(string) {})
	return full, Usage{Model: model, TotalTokens: int(tokens)}, err
}

// runPipe spawns the CLI with stdout piped. With a ParseLine it reads JSONL events line-by-line and
// emits the text each reply event carries; without one it emits raw stdout chunks verbatim. It drains
// stdout to EOF (a Complete/settlement event does not stop the drain) and only then reaps the process,
// so a runtime that never emits a settlement marker still returns on process exit.
func runPipe(ctx context.Context, spec RuntimeSpec, cwd, prompt string, emit func(string)) (string, error) {
	cmd, stderr, err := startCmd(ctx, spec, cwd, prompt)
	if err != nil {
		return "", err
	}
	// stderr goes to an owned capped temp file rather than a pipe: os/exec spawns no copy
	// goroutine for an *os.File target, so a descendant that inherits the fd and holds it
	// open after the child dies cannot strand a goroutine waiting for EOF (R5). Wait returns
	// as soon as the direct child is gone; the file's tail still carries the error text.
	defer func() {
		if stderr != nil {
			stderr.Close()
			os.Remove(stderr.Name())
		}
	}()
	stop := make(chan struct{})
	defer close(stop)
	go capStderrFile(stderr, stop)
	var stdout io.ReadCloser
	stdout, err = cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("starting %s: %w", spec.Bin, err)
	}
	// Grandchildren (e.g. codex hook subprocesses) can inherit and hold the stdout pipe open after the
	// CLI itself exits, so an EOF-driven read loop would block forever; and a ctx-killed process's pipe
	// may never EOF either. Closing stdout when ctx fires guarantees the read loop ends.
	go func() {
		select {
		case <-ctx.Done():
			stdout.Close()
		case <-stop:
		}
	}()
	var full strings.Builder
	var parseErr error
	if spec.ParseLine != nil {
		// claude/codex hook and init events can be far larger than bufio.Scanner's 64KB token cap,
		// so read with a growing Reader instead.
		r := bufio.NewReader(stdout)
		for {
			line, rerr := r.ReadBytes('\n')
			if len(line) > 0 {
				ev := spec.ParseLine(line)
				if ev.Err != nil && parseErr == nil {
					parseErr = ev.Err
				}
				if ev.Text != "" {
					full.WriteString(ev.Text)
					emit(ev.Text)
				}
			}
			if rerr != nil {
				break
			}
		}
	} else {
		buf := make([]byte, 4096)
		for {
			n, rerr := stdout.Read(buf)
			if n > 0 {
				chunk := string(buf[:n])
				full.WriteString(chunk)
				emit(chunk)
			}
			if rerr != nil {
				break
			}
		}
	}
	if werr := waitCmd(ctx, cmd); werr != nil {
		// A non-zero exit by itself ("exit status 1") says nothing. Prefer, in order: a
		// runtime-reported assistant error the parser surfaced (a safeguard refusal, a
		// result event with is_error), the process's stderr tail, a model-error line
		// mined from the captured reply, and only then the bare exit error.
		msg := exitMessage(parseErr, stderrTail(stderr), full.String(), werr)
		return full.String(), fmt.Errorf("%s", msg)
	}
	if parseErr != nil {
		return full.String(), fmt.Errorf("%s: %w", spec.Bin, parseErr)
	}
	return full.String(), nil
}

// waitCmd reaps the process but never blocks past ctx: a killed CLI whose grandchildren hold its
// stderr pipe open can make cmd.Wait hang, so on ctx cancellation we return without waiting (the
// process was already killed by exec.CommandContext).
func waitCmd(ctx context.Context, cmd *exec.Cmd) error {
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// runPty spawns the CLI under a pseudo-terminal so a TUI-only CLI actually emits output, then
// cleans the raw terminal stream. The fully-cleaned capture is authoritative; per-chunk emits are
// best-effort liveness (the persisted consult-reply supersedes the live stream on the FE).
func runPty(ctx context.Context, spec RuntimeSpec, cwd, prompt string, emit func(string)) (string, error) {
	cmd, _, err := startCmd(ctx, spec, cwd, prompt)
	if err != nil {
		return "", err
	}
	// a wide, tall window minimizes the CLI wrapping/repainting its output
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 200, Cols: 220})
	if err != nil {
		return "", fmt.Errorf("starting %s under pty: %w", spec.Bin, err)
	}
	defer f.Close()
	// closing the pty master when ctx fires unblocks a stuck Read (e.g. a CLI that leaves a language-server
	// child that holds the pty open after the print run finishes)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			f.Close()
		case <-stop:
		}
	}()
	var raw bytes.Buffer
	buf := make([]byte, 4096)
	for {
		n, rerr := f.Read(buf)
		if n > 0 {
			raw.Write(buf[:n])
			if cleaned := cleanTUI(string(buf[:n])); cleaned != "" {
				emit(cleaned)
			}
		}
		if rerr != nil {
			break
		}
	}
	// A pty master read commonly ends in EIO once the child exits; that is not a real failure. Only
	// surface a Wait error when the context was cancelled (timeout) so the caller can report it.
	werr := waitCmd(ctx, cmd)
	final := cleanTUI(raw.String())
	if ctx.Err() != nil {
		if final != "" {
			return final, nil
		}
		return "", ctx.Err()
	}
	if werr != nil && final == "" {
		return "", fmt.Errorf("%s produced no output", spec.Bin)
	}
	return final, nil
}

// capStderrFile keeps the owned stderr file bounded while the child and whatever it
// spawned may still hold it open. exits on stop (runPipe cleanup) or file errors.
func capStderrFile(f *os.File, stop <-chan struct{}) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if info, serr := f.Stat(); serr == nil && info.Size() > stderrCapBytes {
				f.Truncate(stderrCapBytes)
			}
		}
	}
}

// stderrTail returns the last chunk of the stderr file, trimmed — the real error text
// sits at the tail even when a descendant keeps writing past us.
func stderrTail(f *os.File) string {
	if f == nil {
		return ""
	}
	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		return ""
	}
	const tailBytes = 32 << 10
	off := info.Size() - tailBytes
	if off < 0 {
		off = 0
	}
	buf := make([]byte, info.Size()-off)
	if _, rerr := f.ReadAt(buf, off); rerr != nil && rerr != io.EOF {
		return ""
	}
	return strings.TrimSpace(string(buf))
}

// exitMessage turns a non-zero CLI exit into the most informative message available: a parser-surfaced
// assistant error (safeguard refusal, result is_error), else the stderr tail, else a model-error line
// mined from the captured reply, else the bare exit error. A refusal commonly arrives only as an
// assistant text block on stdout ("API Error: … safeguards flagged this session"), with an empty
// stderr and a bare "exit status 1" — mining full is what recovers it then.
func exitMessage(parseErr error, stderrTail, full string, werr error) string {
	if parseErr != nil {
		return strings.TrimSpace(parseErr.Error())
	}
	if s := strings.TrimSpace(stderrTail); s != "" {
		return s
	}
	if s := mineModelError(full); s != "" {
		return s
	}
	return werr.Error()
}

// mineModelError returns the first line of captured output that looks like a model/runtime error —
// an "API Error" line (the CLI's synthetic AUP/safeguard message) or a stated refusal — or "" when
// the output holds no such line.
func mineModelError(full string) string {
	for line := range strings.SplitSeq(full, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		low := strings.ToLower(line)
		if strings.Contains(low, "api error") || strings.Contains(low, "safeguards flagged") || strings.Contains(low, "declined to") {
			return line
		}
	}
	return ""
}

func startCmd(ctx context.Context, spec RuntimeSpec, cwd, prompt string) (*exec.Cmd, *os.File, error) {
	args := append([]string{}, spec.BaseArgs...)
	if !spec.PromptViaStdin {
		args = append(args, prompt)
	}
	cmd := exec.CommandContext(ctx, spec.Bin, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	if spec.PromptViaStdin {
		cmd.Stdin = strings.NewReader(prompt)
	}
	// pty runtimes merge stderr onto the pty; pipe runtimes capture it in an owned file
	// (see runPipe for why a pipe target + copy goroutine would strand on descendant-held EOF).
	var stderr *os.File
	if !spec.UsePty {
		f, cerr := os.CreateTemp("", "wave-consult-stderr-*")
		if cerr != nil {
			return nil, nil, fmt.Errorf("creating stderr capture: %w", cerr)
		}
		cmd.Stderr = f
		stderr = f
	}
	if _, err := exec.LookPath(spec.Bin); err != nil {
		return nil, nil, fmt.Errorf("starting %s: %w", spec.Bin, err)
	}
	return cmd, stderr, nil
}

var (
	ansiCSI = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
	ansiOSC = regexp.MustCompile("\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)?")
	ansiEsc = regexp.MustCompile(`\x1b[@-Z\\-_]`)
)

// cleanTUI turns a raw pty/terminal stream into plain text: strip ANSI escapes, resolve carriage-
// return repaints (keep the last-drawn content of each line), drop box-drawing chrome, and collapse
// blank runs. Best-effort — enough to recover the model's answer from a repainting TUI.
func cleanTUI(s string) string {
	s = ansiCSI.ReplaceAllString(s, "")
	s = ansiOSC.ReplaceAllString(s, "")
	s = ansiEsc.ReplaceAllString(s, "")
	var out []string
	for _, line := range strings.Split(s, "\n") {
		// a \r repaints the line in place; keep the last non-empty segment
		if strings.ContainsRune(line, '\r') {
			segs := strings.Split(line, "\r")
			line = ""
			for i := len(segs) - 1; i >= 0; i-- {
				if strings.TrimSpace(segs[i]) != "" {
					line = segs[i]
					break
				}
			}
		}
		line = stripBoxDrawing(line)
		if strings.TrimSpace(line) != "" {
			out = append(out, strings.TrimRight(line, " \t"))
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func stripBoxDrawing(s string) string {
	return strings.Map(func(r rune) rune {
		// box drawing (U+2500–U+257F) + block elements (U+2580–U+259F) are TUI chrome, not content
		if (r >= 0x2500 && r <= 0x259F) || r == '\x00' {
			return -1
		}
		return r
	}, s)
}
