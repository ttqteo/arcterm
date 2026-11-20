// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentedits"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	reasonNoCwd        = "No working directory for this agent"
	reasonNoTranscript = "No transcript for this agent yet"
	reasonNotRepo      = "Not a git repository"
	reasonNoCommits    = "No commits yet"
	reasonNoEdits      = "No file edits by this agent in this repository yet"
)

type agentEditsEntry struct {
	key       string
	editCalls int
	rtn       wshrpc.CommandGitAgentEditsRtnData
}

// one entry per transcript path, so the Diff surface's poll rebuilds only when a transcript has grown
var agentEditsCache = struct {
	sync.Mutex
	m map[string]agentEditsEntry
}{m: map[string]agentEditsEntry{}}

func (ws *WshServer) GitAgentEditsCommand(ctx context.Context, data wshrpc.CommandGitAgentEditsData) (*wshrpc.CommandGitAgentEditsRtnData, error) {
	start := time.Now()
	rtn, calls, hit, err := readAgentEdits(ctx, data)
	files, cache := 0, "miss"
	if rtn != nil {
		files = len(rtn.Files)
	}
	if hit {
		cache = "hit"
	}
	line := fmt.Sprintf("agentedits: transcript=%q calls=%d files=%d cache=%s ms=%d", data.TranscriptPath, calls, files, cache, time.Since(start).Milliseconds())
	if err != nil {
		line += fmt.Sprintf(" err=%q", err.Error())
	}
	log.Print(line)
	return rtn, err
}

func nothingToShow(reason string) *wshrpc.CommandGitAgentEditsRtnData {
	return &wshrpc.CommandGitAgentEditsRtnData{Files: []wshrpc.GitAgentEditFile{}, Reason: reason}
}

func readAgentEdits(ctx context.Context, data wshrpc.CommandGitAgentEditsData) (rtn *wshrpc.CommandGitAgentEditsRtnData, calls int, hit bool, err error) {
	if data.Cwd == "" {
		return nothingToShow(reasonNoCwd), 0, false, nil
	}
	if data.TranscriptPath == "" {
		return nothingToShow(reasonNoTranscript), 0, false, nil
	}
	co, err := agentedits.CheckoutOf(ctx, data.Cwd)
	switch {
	case errors.Is(err, agentedits.ErrNotRepo):
		return nothingToShow(reasonNotRepo), 0, false, nil
	case errors.Is(err, agentedits.ErrNoCommits):
		return nothingToShow(reasonNoCommits), 0, false, nil
	case err != nil:
		return nil, 0, false, err
	}
	key, err := agentEditsKey(data.Cwd, data.TranscriptPath)
	if errors.Is(err, os.ErrNotExist) {
		return nothingToShow(reasonNoTranscript), 0, false, nil
	}
	if err != nil {
		return nil, 0, false, err
	}
	agentEditsCache.Lock()
	e, ok := agentEditsCache.m[data.TranscriptPath]
	agentEditsCache.Unlock()
	if ok && e.key == key {
		r := e.rtn
		return &r, e.editCalls, true, nil
	}
	l, err := agentedits.Parse(data.TranscriptPath, agentedits.FileHistoryDir(data.TranscriptPath))
	if err != nil {
		return nil, 0, false, err
	}
	rtn, err = buildAgentEdits(ctx, data.Cwd, co, l)
	if err != nil {
		return nil, l.EditCalls, false, err
	}
	agentEditsCache.Lock()
	agentEditsCache.m[data.TranscriptPath] = agentEditsEntry{key: key, editCalls: l.EditCalls, rtn: *rtn}
	agentEditsCache.Unlock()
	return rtn, l.EditCalls, false, nil
}

// agentEditsKey is the request cwd plus the size and mtime of the transcript and each subagent transcript.
func agentEditsKey(cwd, transcript string) (string, error) {
	subs, err := agentedits.SubagentTranscripts(transcript)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(cwd)
	for _, p := range append([]string{transcript}, subs...) {
		fi, err := os.Stat(p)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "\x00%s|%d|%d", p, fi.Size(), fi.ModTime().UnixNano())
	}
	return b.String(), nil
}

func buildAgentEdits(ctx context.Context, cwd string, co agentedits.Checkout, l *agentedits.Log) (*wshrpc.CommandGitAgentEditsRtnData, error) {
	// CommitBefore answers "" for no anchor; HEAD then stands in for the session start
	anchor, _ := gitinfo.CommitBefore(ctx, cwd, l.SessionStart)
	if anchor == "" {
		anchor = co.Head
	}
	spell, err := agentedits.TreeSpelling(ctx, co.Root, anchor)
	if err != nil {
		return nil, err
	}
	base, closeBase := agentedits.BaseReader(ctx, co.Root, anchor)
	files, err := agentedits.Replay(l, co.Root, spell, base, agentedits.WorktreeReader(co.Root))
	if cerr := closeBase(); err == nil && cerr != nil {
		err = cerr
	}
	if err != nil {
		return nil, err
	}
	// a net no-op is in no diff of B..H, so it gets no row to flag
	var changed []agentedits.File
	for _, f := range files {
		if f.PreExists != f.PostExists || string(f.Pre) != string(f.Post) {
			changed = append(changed, f)
		}
	}
	if len(changed) == 0 {
		rtn := nothingToShow(reasonNoEdits)
		rtn.BashCalls = l.BashCalls
		return rtn, nil
	}
	b, h, err := agentedits.BuildCommits(ctx, co.Root, anchor, l.SessionStart, changed)
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.CommandGitAgentEditsRtnData{Base: b, End: h, Files: []wshrpc.GitAgentEditFile{}, BashCalls: l.BashCalls}
	for _, f := range changed {
		// the change list lists paths below the cwd only, relative to it
		if rel, ok := cutPathPrefix(f.Path, co.Prefix); ok {
			rtn.Files = append(rtn.Files, wshrpc.GitAgentEditFile{Path: rel, Flag: string(f.Flag)})
		}
	}
	return rtn, nil
}

// cutPathPrefix strips a repo-relative directory prefix, case-insensitively where the filesystem is.
func cutPathPrefix(p, prefix string) (string, bool) {
	if len(p) < len(prefix) {
		return "", false
	}
	head := p[:len(prefix)]
	if head == prefix || (runtime.GOOS == "windows" && strings.EqualFold(head, prefix)) {
		return p[len(prefix):], true
	}
	return "", false
}
