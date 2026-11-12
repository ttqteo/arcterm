// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobmeter"
	"github.com/wavetermdev/waveterm/pkg/jobpeaks"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// meterRosterEvery is how often the meter's agent list is rebuilt from the roster: the roster reads every tab and run
// from the store, which a 2 s poll should not do. An agent started in between is picked up at the next read; one that
// ended drops out at once, because its shell's pid is looked up on every poll.
const meterRosterEvery = 10 * time.Second

// meterIsShell is isShellProcess, a seam so a test needs no real process.
var meterIsShell = isShellProcess

// JobMeterConfig wires pkg/jobmeter to wavesrv: it watches the agents the roster lists, and records each measured
// command's peak in jobpeaks.Default under its pattern and its project.
func JobMeterConfig() jobmeter.Config {
	return jobmeter.Config{
		Agents: newMeterAgents(time.Now),
		OnDone: recordJobPeak,
	}
}

// newMeterAgents is the meter's Agents: the live agent blocks as GetConsumersCommand finds them (the roster's rows, each
// block's shell from its controller, the agent under it from the poll's table). The meter calls it from its one
// goroutine, so the roster it keeps needs no lock. A roster that cannot be read is logged, the agents known before it
// are kept, and it is tried again after the same interval.
func newMeterAgents(now func() time.Time) func(t memusage.Table) []jobmeter.Agent {
	var readAt time.Time
	var blocks []string
	return func(t memusage.Table) []jobmeter.Agent {
		if at := now(); readAt.IsZero() || at.Sub(readAt) >= meterRosterEvery {
			readAt = at
			if facts, err := loadAgentRosterFacts(context.Background()); err != nil {
				log.Printf("jobmeter: reading the agent roster: %v", err)
			} else {
				blocks = nil
				for _, row := range buildAgentRoster(facts) {
					blocks = append(blocks, row.blockId)
				}
			}
		}
		var agents []jobmeter.Agent
		for _, blockId := range blocks {
			if root := consumerBlockPid(blockId); root > 0 {
				agents = append(agents, jobmeter.Agent{BlockId: blockId, Pid: memusage.AgentPid(t, int32(root), meterIsShell)})
			}
		}
		return agents
	}
}

// recordJobPeak is what the meter calls when a command it measured has ended. The pattern is the command's own, as
// memgate takes it; a compound command that did more than one thing has none, and nothing is recorded.
func recordJobPeak(d jobmeter.Done) {
	if jobpeaks.Default == nil {
		return
	}
	pattern, known, ok := memgate.Pattern(d.Command)
	if !ok {
		return
	}
	jobpeaks.Default.Record(pattern, jobProject(context.Background(), d.BlockId), known, d.Peak)
}

// jobProjects keeps jobProject's answer for each working directory (string → string): the answer reads a few files,
// and every heavy command asks. It is kept until wavesrv restarts, so a folder given a repository after its first look
// reads as the no-project key until then.
var jobProjects sync.Map

// jobProject is the project a heavy command's peak is kept under: the main checkout of the repository holding the
// block's working directory (its `cmd:cwd`). A linked worktree, where a run's workers work, is its main checkout's
// project, so what one run measures is there for the next. It reads the file system and starts no git process. "" is
// the "no project" key: no block, no working directory, or one outside any repository.
func jobProject(ctx context.Context, blockId string) string {
	if blockId == "" {
		return ""
	}
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil || block == nil {
		return ""
	}
	cwd := block.Meta.GetString(waveobj.MetaKey_CmdCwd, "")
	if cwd == "" {
		return "" // expanded, "" would read as ".": wavesrv's own working directory
	}
	cwd = wavebase.ExpandHomeDirSafe(cwd)
	if !filepath.IsAbs(cwd) {
		return ""
	}
	if v, ok := jobProjects.Load(cwd); ok {
		return v.(string)
	}
	project := ""
	if root := nearestGitRoot(cwd); root != "" {
		project = jarvis.MainCheckout(root)
	}
	jobProjects.Store(cwd, project)
	return project
}

// nearestGitRoot is the nearest folder from dir up that holds a `.git` (a directory, or the file of a linked worktree);
// "" when there is none.
func nearestGitRoot(dir string) string {
	for cur := filepath.Clean(dir); ; {
		if _, err := os.Lstat(filepath.Join(cur, ".git")); err == nil {
			return cur
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return ""
		}
		cur = parent
	}
}
