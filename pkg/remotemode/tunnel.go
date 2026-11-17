// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

// tunnel states, as RemoteStatusData.Tunnel reports them
const (
	TunnelOff      = "off"
	TunnelStarting = "starting"
	TunnelUp       = "up"
	TunnelDown     = "down"
)

const (
	tunnelTokenEnv         = "TUNNEL_TOKEN"
	tunnelRegisteredMarker = "Registered tunnel connection"
	tunnelErrLevel         = "ERR"
	tunnelRedacted         = "[redacted]"
	// a line longer than this is logged in pieces rather than buffered without bound
	tunnelMaxLine = 64 * 1024
	// bounds Wait when something the child started still holds its output pipe
	tunnelWaitDelay = 5 * time.Second
)

// package vars so tests can run the fake cloudflared through the test binary and shrink the backoff
var (
	tunnelArgs         = []string{"tunnel", "--no-autoupdate", "run"}
	tunnelBackoffStart = time.Second
	tunnelBackoffMax   = time.Minute
	tunnelBackoffReset = 5 * time.Minute
)

// Tunnel supervises one cloudflared child, restarting it with a backoff until Stop.
type Tunnel struct {
	path    string
	token   string
	onState func(state, lastErr string)
	stopCh  chan struct{}
	done    chan struct{}
	once    sync.Once

	mu      sync.Mutex
	stopped bool
	cmd     *exec.Cmd
	job     uintptr
}

// StartTunnel runs `<path> tunnel --no-autoupdate run` with the token in TUNNEL_TOKEN, never in
// the arguments. onState calls never overlap; the last one, from Stop, is TunnelOff. An error means
// the first launch failed and nothing is left running.
func StartTunnel(path, token string, onState func(state, lastErr string)) (*Tunnel, error) {
	t := &Tunnel{
		path:    path,
		token:   token,
		onState: onState,
		stopCh:  make(chan struct{}),
		done:    make(chan struct{}),
	}
	out, err := t.launch()
	if err != nil {
		return nil, err
	}
	go t.supervise(out)
	return t, nil
}

// Stop kills cloudflared, ends the restarts, and reports TunnelOff once it is gone.
func (t *Tunnel) Stop() {
	t.once.Do(func() {
		t.mu.Lock()
		t.stopped = true
		t.killLocked()
		t.mu.Unlock()
		close(t.stopCh)
		<-t.done
		t.onState(TunnelOff, "")
	})
}

func (t *Tunnel) killLocked() {
	if t.job != 0 {
		jobobject.KillTree(t.job)
	} else if t.cmd != nil && t.cmd.Process != nil {
		t.cmd.Process.Kill()
	}
}

// launch reports starting and starts one cloudflared; nil out with a nil error means Stop came first.
// onState runs outside mu so a callback that takes its owner's lock cannot deadlock against Stop.
func (t *Tunnel) launch() (*tunnelOutput, error) {
	if t.isStopped() {
		return nil, nil
	}
	t.onState(TunnelStarting, "")
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.stopped {
		return nil, nil
	}
	out := &tunnelOutput{tunnel: t}
	cmd := exec.Command(t.path, tunnelArgs...)
	cmd.Env = append(os.Environ(), tunnelTokenEnv+"="+t.token)
	cmd.Stdout = out
	cmd.Stderr = out
	cmd.WaitDelay = tunnelWaitDelay
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting cloudflared: %w", err)
	}
	job, err := jobobject.Attach(cmd.Process)
	if err != nil {
		log.Printf("remotemode: cloudflared pid %d has no job object, it may outlive Arc: %v", cmd.Process.Pid, err)
	}
	t.cmd, t.job, out.cmd = cmd, job, cmd
	return out, nil
}

func (t *Tunnel) supervise(out *tunnelOutput) {
	defer close(t.done)
	var delay time.Duration
	for out != nil {
		lastErr, upFor := t.wait(out)
		out = t.restart(&delay, lastErr, upFor)
	}
}

// restart reports the exit, waits out the backoff and relaunches, retrying a launch that fails;
// nil means Stop came first.
func (t *Tunnel) restart(delay *time.Duration, lastErr string, upFor time.Duration) *tunnelOutput {
	for {
		if t.isStopped() {
			return nil
		}
		t.onState(TunnelDown, lastErr)
		*delay = tunnelNextBackoff(*delay, upFor)
		select {
		case <-t.stopCh:
			return nil
		case <-time.After(*delay):
		}
		out, err := t.launch()
		if err == nil {
			return out
		}
		log.Printf("remotemode: %v", err)
		lastErr, upFor = err.Error(), 0
	}
}

// wait reaps the child and returns the reason it exited and how long it was up.
func (t *Tunnel) wait(out *tunnelOutput) (string, time.Duration) {
	err := out.cmd.Wait()
	out.flush()
	t.mu.Lock()
	jobobject.Close(t.job)
	t.cmd, t.job = nil, 0
	t.mu.Unlock()
	var upFor time.Duration
	if !out.upAt.IsZero() {
		upFor = time.Since(out.upAt)
	}
	switch {
	case out.lastErr != "":
		return out.lastErr, upFor
	case err != nil:
		return "cloudflared " + err.Error(), upFor
	default:
		return "cloudflared exited", upFor
	}
}

func (t *Tunnel) isStopped() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.stopped
}

func (t *Tunnel) redact(line string) string {
	if t.token == "" {
		return line
	}
	return strings.ReplaceAll(line, t.token, tunnelRedacted)
}

// tunnelNextBackoff returns the wait before the next restart, given the previous wait (0 for none)
// and how long the child that just exited was up.
func tunnelNextBackoff(prev, upFor time.Duration) time.Duration {
	if prev == 0 || upFor >= tunnelBackoffReset {
		return tunnelBackoffStart
	}
	return min(prev*2, tunnelBackoffMax)
}

// tunnelOutput receives cloudflared's stdout and stderr; exec calls Write from one goroutine at a
// time because both streams share this writer, and Wait returns only after the last Write.
type tunnelOutput struct {
	tunnel  *Tunnel
	cmd     *exec.Cmd
	buf     []byte
	upAt    time.Time
	lastErr string
}

func (o *tunnelOutput) Write(p []byte) (int, error) {
	o.buf = append(o.buf, p...)
	for {
		i := bytes.IndexByte(o.buf, '\n')
		if i < 0 {
			break
		}
		o.line(string(o.buf[:i]))
		o.buf = o.buf[i+1:]
	}
	if len(o.buf) > tunnelMaxLine {
		o.flush()
	}
	return len(p), nil
}

func (o *tunnelOutput) flush() {
	if len(o.buf) > 0 {
		o.line(string(o.buf))
		o.buf = nil
	}
}

func (o *tunnelOutput) line(raw string) {
	line := o.tunnel.redact(strings.TrimRight(raw, "\r"))
	if line == "" {
		return
	}
	log.Printf("remotemode: cloudflared: %s", line)
	if tunnelIsErrLine(line) {
		o.lastErr = line
	}
	if o.upAt.IsZero() && strings.Contains(line, tunnelRegisteredMarker) {
		o.upAt = time.Now()
		o.tunnel.onState(TunnelUp, "")
	}
}

// cloudflared lines read `<timestamp> <LEVEL> <message>`
func tunnelIsErrLine(line string) bool {
	fields := strings.Fields(line)
	for i := 0; i < len(fields) && i < 2; i++ {
		if fields[i] == tunnelErrLevel {
			return true
		}
	}
	return false
}
