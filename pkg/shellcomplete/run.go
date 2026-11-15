package shellcomplete

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"
	"unicode/utf8"
)

// RunTimeout is how long one command run while the agent sleeps may take, as Claude Code's own Bash tool waits by
// default. A command still running then is stopped, with its whole process tree.
const RunTimeout = 2 * time.Minute

// MaxRunOutput caps each stream of a run, as Claude Code caps a Bash result: the tail is kept, since an error is
// usually at the end, behind CutMark.
const MaxRunOutput = 30000

// CutMark leads a stream whose start was cut to MaxRunOutput.
const CutMark = "[… earlier output cut]\n"

// RunResult is what a command run printed and how it ended. ExitCode is -1 when it was stopped at the timeout.
type RunResult struct {
	Stdout    string
	Stderr    string
	ExitCode  int
	TimedOut  bool
	Truncated bool
	Dur       time.Duration
}

// Run runs one bash-mode command (Chat's `! cmd` sent to a sleeping agent) in cwd with the person's login shell, so
// their PATH is what it would be in a terminal: $SHELL off Windows (bash, then sh, when it is unset), Git Bash on
// Windows. Stdin is empty and there is no terminal, so an interactive command reads end of input. A start failure is
// an error; a command that ran and failed is a result with its exit code.
func Run(ctx context.Context, cwd, command string, timeout time.Duration) (RunResult, error) {
	shell := runShell()
	if shell == "" {
		return RunResult{}, errors.New("no shell to run with: install Git for Windows or set term:gitbashpath")
	}
	if timeout <= 0 {
		timeout = RunTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	c := exec.CommandContext(ctx, shell, "-l", "-c", command)
	c.Dir = cwd
	// colour and pagers have no screen to draw on: the output is read as text
	c.Env = append(os.Environ(), "NO_COLOR=1", "TERM=dumb", "PAGER=cat", "GIT_PAGER=cat")
	hideWindow(c)
	stopTree(c)
	// a child that outlives the shell and keeps the pipes open must not hold the answer past the timeout
	c.WaitDelay = 3 * time.Second
	var stdout, stderr tailBuffer
	c.Stdout = &stdout
	c.Stderr = &stderr
	start := time.Now()
	err := c.Run()
	res := RunResult{Dur: time.Since(start)}
	res.Stdout, res.Truncated = stdout.text()
	var errCut bool
	res.Stderr, errCut = stderr.text()
	res.Truncated = res.Truncated || errCut
	if ctx.Err() == context.DeadlineExceeded {
		res.TimedOut = true
		res.ExitCode = -1
		return res, nil
	}
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			res.ExitCode = exitErr.ExitCode()
			return res, nil
		}
		if errors.Is(err, exec.ErrWaitDelay) {
			return res, nil
		}
		return RunResult{}, err
	}
	return res, nil
}

func runShell() string {
	if runtime.GOOS != "windows" {
		if s := os.Getenv("SHELL"); s != "" {
			if _, err := os.Stat(s); err == nil {
				return s
			}
		}
		if b := bashPath(); b != "" {
			return b
		}
		if _, err := os.Stat("/bin/sh"); err == nil {
			return "/bin/sh"
		}
		return ""
	}
	return bashPath()
}

// tailBuffer keeps the last MaxRunOutput bytes written to it, so a command that prints without end holds no more.
type tailBuffer struct {
	mu   sync.Mutex
	buf  []byte
	over bool
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 2*MaxRunOutput {
		t.buf = append([]byte(nil), t.buf[len(t.buf)-MaxRunOutput:]...)
		t.over = true
	}
	return len(p), nil
}

// text is the kept output, CutMark in front when its start was cut, starting at a whole character.
func (t *tailBuffer) text() (string, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	b := t.buf
	cut := t.over
	if len(b) > MaxRunOutput {
		b = b[len(b)-MaxRunOutput:]
		cut = true
	}
	if !cut {
		return string(b), false
	}
	for len(b) > 0 && !utf8.RuneStart(b[0]) {
		b = b[1:]
	}
	return CutMark + string(b), true
}
