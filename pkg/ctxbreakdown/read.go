// Package ctxbreakdown reads what Claude Code's /context reports for a folder: run headless, it measures a fresh
// session there, which is what loads every turn (tools, memory files, skills, agents, MCP, the system prompt).
package ctxbreakdown

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	readTimeout = 90 * time.Second // a headless /context boots a whole session: ~30 s measured 2026-11-12
	okTTL       = 30 * time.Minute
	errTTL      = time.Minute
)

var now = time.Now

// runContext runs /context headless in cwd. --no-session-persistence: without it each run leaves a transcript in
// ~/.claude/projects that Conversation History would list.
var runContext = func(ctx context.Context, cwd string, env []string) (string, error) {
	bin, err := exec.LookPath("claude")
	if err != nil {
		return "", errors.New("claude is not on PATH")
	}
	cmd := exec.CommandContext(ctx, bin, "-p", "--no-session-persistence", "/context")
	cmd.Dir, cmd.Env = cwd, env
	cmd.WaitDelay = 5 * time.Second // a grandchild holding the pipes open must not outlast the timeout
	hideWindow(cmd)                 // wavesrv has no console: a console child would flash a window on Windows
	out, err := cmd.Output()
	if ctx.Err() != nil {
		return "", errors.New("/context took longer than 90 s")
	}
	if err != nil {
		return "", fmt.Errorf("claude -p /context: %w", err)
	}
	return string(out), nil
}

// childEnv is wavesrv's environment without the block identity, so the session's hooks report into no agent
func childEnv(env []string) []string {
	out := make([]string, 0, len(env))
	for _, kv := range env {
		if strings.HasPrefix(kv, "WAVETERM_BLOCKID=") || strings.HasPrefix(kv, "WAVETERM_JWT=") {
			continue
		}
		out = append(out, kv)
	}
	return out
}

type entry struct {
	done chan struct{}
	at   time.Time
	b    *wshrpc.ContextBreakdown
	err  error
}

var (
	mu    sync.Mutex
	cache = map[string]*entry{}
)

func fresh(e *entry) bool {
	select {
	case <-e.done:
	default:
		return true // in flight: wait for it
	}
	ttl := okTTL
	if e.err != nil {
		ttl = errTTL
	}
	return now().Sub(e.at) < ttl
}

// Read returns the breakdown for cwd: one run in flight per folder, kept okTTL (an error errTTL); refresh skips the cache.
func Read(ctx context.Context, cwd string, refresh bool) (*wshrpc.ContextBreakdown, error) {
	key := filepath.Clean(cwd)
	mu.Lock()
	e := cache[key]
	if e == nil || (refresh && !inFlight(e)) || !fresh(e) {
		e = &entry{done: make(chan struct{})}
		cache[key] = e
		go fill(e, key)
	}
	mu.Unlock()
	select {
	case <-e.done:
		return e.b, e.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func inFlight(e *entry) bool {
	select {
	case <-e.done:
		return false
	default:
		return true
	}
}

func fill(e *entry, cwd string) {
	defer close(e.done)
	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()
	md, err := runContext(ctx, cwd, childEnv(os.Environ()))
	e.at = now()
	if err != nil {
		e.err = err
		return
	}
	b, err := Parse(md)
	if err != nil {
		e.err = err
		return
	}
	home, _ := os.UserHomeDir()
	ResolvePaths(b, cwd, home)
	b.ReadAt = e.at.UnixMilli()
	e.b = b
}
