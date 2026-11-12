// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	usageHarness_Claude = "claude"
	usageHarness_Pi     = "pi"
)

// a worktree folder directly under one of the roots that hold them: git's, claude's, and the engine's lanes
var worktreeTailRe = regexp.MustCompile(`[\\/](?:\.worktrees|\.claude[\\/]worktrees|\.waveterm[\\/]worktrees)[\\/][^\\/]+[\\/]?$`)

// repoRootOf cuts a worktree path back to the repo that holds it. Any other path is returned as it is.
func repoRootOf(path string) string {
	return worktreeTailRe.ReplaceAllString(path, "")
}

// usageDir holds the store and disk reads of one usageSessions call, a nil or empty entry included.
type usageDir struct {
	dags         map[string]*waveobj.TaskGroup
	owners       map[string]*waveobj.Run
	roots        map[string]string
	projectNames map[string]string // projectKey -> registered name
	tabEfforts   map[string]string // "<harness>:<session id>" -> effort oid; nil until first needed
}

// usageSessions builds the usage directory: one entry per scanned session, with the run, project and initiative
// it was spent on. Only claude and pi sessions are launched by runs, so only they are looked up.
func usageSessions(ctx context.Context, metas []usagestats.SessionMeta) ([]wshrpc.UsageSessionMeta, error) {
	var ids []string
	for _, m := range metas {
		if runHarness(m.Harness) {
			ids = append(ids, m.Session)
		}
	}
	bySession, err := runsBySession(ctx, ids)
	if err != nil {
		return nil, err
	}
	chans, err := wstore.GetChannels(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading projects: %w", err)
	}
	d := &usageDir{
		dags: map[string]*waveobj.TaskGroup{}, owners: map[string]*waveobj.Run{}, roots: map[string]string{},
		projectNames: map[string]string{},
	}
	for _, ch := range chans {
		// newest first, so the newest of a project's duplicate channels names it, as ChannelAtPath picks
		if key := projectKey(ch.ProjectPath); key != "" && d.projectNames[key] == "" {
			d.projectNames[key] = ch.Name
		}
	}
	out := make([]wshrpc.UsageSessionMeta, len(metas))
	for i, m := range metas {
		s := wshrpc.UsageSessionMeta{Harness: m.Harness, Session: m.Session, Title: m.Title, Project: d.repoRoot(m.Cwd)}
		if run := bySession[m.Session]; run != nil && runHarness(m.Harness) {
			if err := linkUsageSession(ctx, &s, run, d); err != nil {
				return nil, err
			}
		} else {
			s.Effort = d.tabEffort(ctx, s.Harness, s.Session)
		}
		s.ProjectName = d.projectNames[projectKey(s.Project)]
		out[i] = s
	}
	return out, nil
}

func runHarness(harness string) bool {
	return harness == usageHarness_Claude || harness == usageHarness_Pi
}

// projectKey is the comparison key of a project path: cleaned, slash-normalized, and case-insensitive on Windows,
// so a session's cwd and the path a project was registered with name one project however each is spelled.
func projectKey(p string) string {
	if p == "" {
		return ""
	}
	p = path.Clean(strings.ReplaceAll(p, `\`, "/"))
	if runtime.GOOS == "windows" {
		p = strings.ToLower(p)
	}
	return p
}

// repoRoot is the repo path p belongs to. A path inside a linked git worktree folds to the same path in its main
// checkout, which the worktree's .git file names, so every worktree layout folds; a path no longer on disk is cut
// back by the known worktree roots instead (repoRootOf). Any other path is returned as it is.
func (d *usageDir) repoRoot(p string) string {
	if p == "" {
		return ""
	}
	if root, ok := d.roots[p]; ok {
		return root
	}
	root, ok := mainCheckoutPath(p)
	if !ok {
		root = repoRootOf(p)
	}
	d.roots[p] = root
	return root
}

// mainCheckoutPath is p's counterpart in the main checkout when p lies in a linked git worktree.
func mainCheckoutPath(p string) (string, bool) {
	if _, err := os.Stat(p); err != nil {
		return "", false
	}
	for dir := filepath.Clean(p); ; {
		gitPath := filepath.Join(dir, ".git")
		if info, err := os.Stat(gitPath); err == nil {
			if info.IsDir() {
				return "", false // a main checkout
			}
			main, ok := worktreeMain(gitPath)
			if !ok {
				return "", false
			}
			rel, err := filepath.Rel(dir, p)
			if err != nil {
				return "", false
			}
			return filepath.Join(main, rel), true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// worktreeMain reads the main checkout from a linked worktree's .git file, "gitdir: <main>/.git/worktrees/<name>".
// Any other .git file (a submodule's) names none.
func worktreeMain(gitFile string) (string, bool) {
	raw, err := os.ReadFile(gitFile)
	if err != nil {
		log.Printf("usage: reading %s: %v", gitFile, err)
		return "", false
	}
	gitdir, ok := strings.CutPrefix(strings.TrimSpace(string(raw)), "gitdir:")
	if !ok {
		return "", false
	}
	gitdir = strings.TrimSpace(gitdir)
	if !filepath.IsAbs(gitdir) {
		gitdir = filepath.Join(filepath.Dir(gitFile), gitdir)
	}
	worktrees := filepath.Dir(filepath.Clean(gitdir))
	dotGit := filepath.Dir(worktrees)
	if filepath.Base(worktrees) != "worktrees" || filepath.Base(dotGit) != ".git" {
		return "", false
	}
	return filepath.Dir(dotGit), true
}

// tabAgentSession is the harness and session id of the agent in tab, read off its agent block's transcript, or
// ok false while the block names no transcript yet.
func tabAgentSession(ctx context.Context, tab *waveobj.Tab) (harness, session string, ok bool) {
	harness = tab.Meta.GetString(waveobj.MetaKey_SessionAgent, "")
	if harness == "" || len(tab.BlockIds) == 0 {
		return "", "", false
	}
	transcript, err := readBlockTranscriptMeta(ctx, tab.BlockIds[0])
	if err != nil {
		log.Printf("usage: the agent of tab %s: %v", tab.OID, err)
		return "", "", false
	}
	if transcript == "" {
		return "", "", false
	}
	return harness, usagestats.SessionIdOf(harness, transcript), true
}

// tabEffort is the initiative the tab of the agent running harness's session is tagged with. A closed tab's tag
// was recorded when it closed; an open tab's live tag overrides it. The map is built on first use.
func (d *usageDir) tabEffort(ctx context.Context, harness, session string) string {
	if d.tabEfforts == nil {
		d.tabEfforts = map[string]string{}
		closed, err := wstore.GetSessionEfforts(ctx)
		if err != nil {
			log.Printf("usage: loading the initiatives of closed tabs' sessions: %v", err)
		}
		for _, se := range closed {
			d.tabEfforts[se.Harness+":"+usagestats.SessionIdOf(se.Harness, se.Transcript)] = se.EffortOID
		}
		tabs, err := wstore.DBGetAllObjsByType[*waveobj.Tab](ctx, waveobj.OType_Tab)
		if err != nil {
			log.Printf("usage: loading tabs for their initiatives: %v", err)
		}
		for _, tab := range tabs {
			oid := effortstore.BareOID(tab.Meta.GetString(waveobj.MetaKey_SessionEffort, ""))
			if oid == "" {
				continue
			}
			if h, id, ok := tabAgentSession(ctx, tab); ok {
				d.tabEfforts[h+":"+id] = oid
			}
		}
	}
	return d.tabEfforts[harness+":"+session]
}

// usageEfforts names every effort a session belongs to. A missing effort is logged and left out, and its sessions
// keep the oid.
func usageEfforts(ctx context.Context, sessions []wshrpc.UsageSessionMeta) []wshrpc.UsageEffort {
	seen := map[string]bool{}
	var out []wshrpc.UsageEffort
	for _, s := range sessions {
		if s.Effort == "" || seen[s.Effort] {
			continue
		}
		seen[s.Effort] = true
		e, err := effortstore.Get(ctx, s.Effort)
		if err != nil {
			log.Printf("usage: the effort %s of session %s: %v", s.Effort, s.Session, err)
			continue
		}
		out = append(out, wshrpc.UsageEffort{OID: s.Effort, Title: e.Title})
	}
	return out
}

// consultRoleOf is the usage role of a one-shot session the run started outside its own agent.
func consultRoleOf(run *waveobj.Run, session string) (string, bool) {
	for _, c := range run.ConsultSessions {
		if c.SessionId == session {
			return c.Role, true
		}
	}
	return "", false
}

// linkBrainstormSession fills a brainstorm builder check's or judge's session. It is no work item of its own: no
// run list shows its run, so Open run would land on nothing. It is the role it played for the brainstorming agent
// its run names, or, for a run from before that was recorded, its role alone.
func (d *usageDir) linkBrainstormSession(s *wshrpc.UsageSessionMeta, run *waveobj.Run) {
	s.Role = run.StageRole
	if run.ProjectPath != "" {
		s.Project = d.repoRoot(run.ProjectPath)
	}
	if harness, session, ok := strings.Cut(run.BrainstormLead, ":"); ok {
		s.LeadHarness, s.LeadSession = harness, session
	}
}

// dagOf is run's dag, nil when it has none or it is gone.
func (d *usageDir) dagOf(ctx context.Context, run *waveobj.Run) *waveobj.TaskGroup {
	if run.DagORef == "" {
		return nil
	}
	dag, ok := d.dags[run.DagORef]
	if !ok {
		var err error
		if dag, err = wstore.GetDag(ctx, run.DagORef); err != nil {
			log.Printf("usage: loading dag %s of run %s: %v", run.DagORef, run.OID, err)
			dag = nil
		}
		d.dags[run.DagORef] = dag
	}
	return dag
}

// taskLabel is the label of dag's task id, or "" when there is none.
func taskLabel(dag *waveobj.TaskGroup, id string) string {
	if dag == nil || id == "" {
		return ""
	}
	for _, t := range dag.Tasks {
		if t.ID == id {
			return t.Label
		}
	}
	return ""
}

// linkUsageSession fills s's run fields from the run launched under it. d caches the store reads across one
// call, a nil entry included.
func linkUsageSession(ctx context.Context, s *wshrpc.UsageSessionMeta, run *waveobj.Run, d *usageDir) error {
	consultRole, consulted := consultRoleOf(run, s.Session)
	if !consulted && run.DagORef == "" && jarvis.IsBrainstormSession(run) {
		d.linkBrainstormSession(s, run)
		return nil
	}
	dag := d.dagOf(ctx, run)
	link, placed := runLinkOf(run, dag)
	if consulted {
		// a consult session is the run's own work whatever the run is, never a task of its dag
		placed = false
	} else if !placed && run.DagORef != "" {
		// a child whose dag is gone: nothing says which run it worked for
		return nil
	}
	if !placed {
		// a quick run is its own work item
		link = sessionRunLink{RunId: run.OID, ChannelId: run.ChannelOID}
	}
	owner := run
	if link.RunId != run.OID {
		var ok bool
		if owner, ok = d.owners[link.RunId]; !ok {
			var err error
			if owner, err = wstore.DBGet[*waveobj.Run](ctx, link.RunId); err != nil {
				return fmt.Errorf("loading run %s that owns session %s: %w", link.RunId, s.Session, err)
			}
			d.owners[link.RunId] = owner
		}
		if owner == nil {
			log.Printf("usage: run %s that owns session %s is gone", link.RunId, s.Session)
			return nil
		}
	}
	s.RunId, s.ChannelId, s.TaskId = link.RunId, link.ChannelId, link.TaskId
	s.TaskTitle = taskLabel(dag, link.TaskId)
	s.RunMode = owner.Mode
	goal, _, _ := strings.Cut(strings.TrimSpace(owner.Goal), "\n")
	s.RunGoal = strings.TrimSpace(goal)
	if ref := owner.EffortRef; ref != nil {
		s.RunChunk, s.Effort = ref.ChunkLabel, effortstore.BareOID(ref.EffortOID)
	}
	if consulted {
		s.Role = consultRole
	}
	if placed {
		s.Role = jarvis.UsageRole(run)
		if s.Role == jarvis.UsageRole_Lead && link.Role != sessionRole_Lead {
			// a legacy child carries no task on its run, so only the dag's link says what it did
			s.Role = jarvis.UsageRole_Worker
			if link.Role == sessionRole_Review {
				s.Role = jarvis.UsageRole_Reviewer
			}
		}
	}
	if owner.ProjectPath != "" {
		s.Project = d.repoRoot(owner.ProjectPath)
	}
	return nil
}
