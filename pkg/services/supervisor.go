// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/arctools"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Def is what the controller needs to run one service: its tool, the port it was given, its project, and the tab and
// block it already has (empty before its first run).
type Def struct {
	Tool    arctools.Tool
	Port    int
	Project string
	TabId   string
	BlockId string
}

// BlockRef is a service block found in the store at boot.
type BlockRef struct {
	ToolId  string
	TabId   string
	BlockId string
}

// Remembered is what arcterm keeps about a service between runs, in its own state file, never in tools.json. A Stop is
// not kept: an older file's "stopped" key is ignored.
type Remembered struct {
	Port int `json:"port,omitempty"` // the port of a service on "port": "auto"
}

type StateStore interface {
	Get(id string) Remembered
	Set(id string, r Remembered) error
}

// Deps is everything the supervisor does to the world, so the state machine runs against fakes.
type Deps struct {
	Now           func() time.Time
	After         func(d time.Duration, f func()) (cancel func())
	Probe         func(ctx context.Context, url string) bool
	FreePort      func() (int, error)
	PortHolder    func(ctx context.Context, port int) (name string, held bool)
	ServiceBlocks func(ctx context.Context) ([]BlockRef, error)
	Ensure        func(ctx context.Context, d Def) (tabId, blockId string, err error)
	Start         func(ctx context.Context, tabId, blockId string) error
	Stop          func(blockId string)
	Sweep         func(blockId string)
	Procs         func(blockId string) []Proc // the service block's process tree; nil when it cannot be read, which counts as idle
	ReadLog       func(blockId string) string
	CloseTab      func(ctx context.Context, tabId string) error
	Publish       func(data wshrpc.ServicesData)
	State         StateStore
}

// exitIgnoreWindow is how long after a Stop its process's exit is still told apart from a crash.
const exitIgnoreWindow = 10 * time.Second

const otherProgram = "another program"

// commandLine is the command and its args as the person wrote them.
func commandLine(t arctools.Tool) string {
	return strings.TrimSpace(t.Command + " " + t.Args)
}

// BlockMeta is the meta of a service's terminal block. It never starts on its own (cmd:runonstart false): only the
// supervisor forces a start, so a pane that mounts the log cannot start a sleeping service.
func BlockMeta(d Def) waveobj.MetaMapType {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_View:          "term",
		waveobj.MetaKey_Controller:    "cmd",
		waveobj.MetaKey_Cmd:           commandLine(d.Tool),
		waveobj.MetaKey_CmdShell:      true, // the controller then runs the line through the shell and ignores cmd:args
		waveobj.MetaKey_CmdJwt:        true, // without it a command run with -c gets neither cmd:env nor WAVETERM_BLOCKID, which the leftover sweep finds it by
		waveobj.MetaKey_CmdRunOnStart: false,
		waveobj.MetaKey_CmdCwd:        ServiceDir(d.Tool),
		waveobj.MetaKey_ToolId:        d.Tool.Id,
		waveobj.MetaKey_ToolService:   true,
	}
	if d.Port > 0 {
		meta[waveobj.MetaKey_CmdEnv] = map[string]any{"PORT": strconv.Itoa(d.Port)}
	}
	return meta
}

// TabMeta is the meta of a service's tab.
func TabMeta(d Def) waveobj.MetaMapType {
	return waveobj.MetaMapType{
		waveobj.MetaKey_ToolId:         d.Tool.Id,
		waveobj.MetaKey_SessionProject: d.Project,
		waveobj.MetaKey_SessionLabel:   d.Tool.Name,
	}
}

// fixedPort is the port of a service's url, or 0 when it has none that arcterm can show. url wins over port.
func fixedPort(t arctools.Tool) int {
	if !arctools.AppURL(t.Url) {
		return 0
	}
	u, err := url.Parse(t.Url)
	if err != nil {
		return 0
	}
	p, err := strconv.Atoi(u.Port())
	if err != nil || p < 1 || p > 65535 {
		return 0
	}
	return p
}

type svc struct {
	tool    arctools.Tool
	project string
	fixed   int // the port of tool.Url; 0 for a service on "port": "auto"
	port    int

	state     string
	tabId     string
	blockId   string
	startedMs int64
	retryAtMs int64
	exitCode  int
	holder    string

	crashes   CrashLog
	procStart time.Time
	deadline  time.Time

	gen         int // bumped by every Start, Stop and exit: a step that wakes under an older gen gives up
	cancels     []func()
	ignoreExits int // Stops whose process exit has not arrived yet
	ignoreUntil time.Time

	// the idle timer is kept apart from cancels: a crash, a retry and a start cancel those, and none of them is a
	// reason to give the service its minute again
	sleepCancel func()
	sleepTok    int // a timer that already fired, or was cancelled, finds an older token and does nothing
}

// sleepable reports whether a service in this state sleeps when its idle timer fires.
func sleepable(state string) bool {
	return state == StateStarting || state == StateRunning || state == StateNoPage || state == StateRetrying
}

// pageURL is the url the probe asks.
func (v *svc) pageURL() string {
	if v.fixed > 0 {
		return v.tool.Url
	}
	if v.port > 0 {
		return fmt.Sprintf("http://127.0.0.1:%d/", v.port)
	}
	return ""
}

// owned reports whether a process of arcterm's is up (or coming up) for the service.
func (v *svc) owned() bool {
	return v.state == StateStarting || v.state == StateRunning || v.state == StateNoPage
}

type Supervisor struct {
	d Deps

	mu     sync.Mutex
	svcs   map[string]*svc
	booted bool
	shown  map[string]bool // the services on screen, as the frontend last reported them
}

func New(d Deps) *Supervisor {
	return &Supervisor{d: d, svcs: map[string]*svc{}}
}

// Seen takes the whole set of services on screen; each call replaces the last. Ids it does not know are kept. Before
// Boot it only records. After, a service that joined the set loses its idle timer and, when it sleeps, starts (not as
// the person's start); a service that left it gets a timer.
func (s *Supervisor) Seen(ctx context.Context, ids []string) {
	shown := make(map[string]bool, len(ids))
	for _, id := range ids {
		shown[id] = true
	}
	s.mu.Lock()
	old := s.shown
	s.shown = shown
	if !s.booted {
		s.mu.Unlock()
		return
	}
	var wake []string
	for id := range shown {
		if old[id] {
			continue
		}
		if v := s.svcs[id]; v != nil {
			s.cancelSleepLocked(v)
			if v.state == StateSleeping {
				wake = append(wake, id)
			}
		}
	}
	for id := range old {
		if shown[id] {
			continue
		}
		if v := s.svcs[id]; v != nil {
			s.armSleepLocked(v)
		}
	}
	sort.Strings(wake)
	s.mu.Unlock()
	for _, id := range wake {
		if err := s.startService(ctx, id, false); err != nil {
			log.Printf("[services] %s: starting when shown: %v\n", id, err)
		}
	}
}

// armSleepLocked gives a service its idle timer, unless it has one already (its minute is not pushed back), is
// on screen, has Keep running, or has no process to stop.
func (s *Supervisor) armSleepLocked(v *svc) {
	if v.sleepCancel != nil || v.tool.Autostart || s.shown[v.tool.Id] || !sleepable(v.state) {
		return
	}
	v.sleepTok++
	id, tok := v.tool.Id, v.sleepTok
	v.sleepCancel = s.d.After(IdleSleep, func() { s.sleepTick(id, tok) })
}

func (s *Supervisor) cancelSleepLocked(v *svc) {
	if v.sleepCancel != nil {
		v.sleepCancel()
		v.sleepCancel = nil
	}
	v.sleepTok++
}

// sleepTick is the idle timer firing: a service that is still off screen without Keep running stops, unless it is
// busy, in which case the timer is armed again for another IdleSleep. A service that comes back on screen meanwhile
// keeps running. It starts again when shown.
func (s *Supervisor) sleepTick(id string, tok int) {
	s.mu.Lock()
	v := s.svcs[id]
	if v == nil || v.sleepTok != tok {
		s.mu.Unlock()
		return
	}
	v.sleepCancel = nil
	if v.tool.Autostart || s.shown[id] || !sleepable(v.state) {
		s.mu.Unlock()
		return
	}

	// reading the tree takes a while: do it without the lock, then look again, since a Seen, a Stop or a crash may
	// have come in meanwhile (the token tells a Seen)
	blockId, upMs := v.blockId, v.startedMs
	s.mu.Unlock()
	var procs []Proc
	if blockId != "" && s.d.Procs != nil {
		procs = s.d.Procs(blockId)
	}
	s.mu.Lock()
	v = s.svcs[id]
	if v == nil || v.sleepTok != tok || v.tool.Autostart || s.shown[id] || !sleepable(v.state) {
		s.mu.Unlock()
		return
	}
	if Busy(procs, upMs, s.d.Now().UnixMilli()) {
		s.armSleepLocked(v) // ask again in IdleSleep
		s.mu.Unlock()
		return
	}
	if v.owned() {
		v.ignoreExits++
		v.ignoreUntil = s.d.Now().Add(exitIgnoreWindow)
	}
	s.cancelLocked(v)
	v.gen++
	v.state = StateSleeping
	v.startedMs, v.retryAtMs, v.exitCode, v.holder = 0, 0, 0, ""
	blockId = v.blockId
	s.publishLocked()
	s.mu.Unlock()
	if blockId != "" {
		s.d.Stop(blockId)
	}
}

// startsNowLocked reports whether a service starts as soon as the supervisor knows it: it has Keep running or is on
// screen.
func (s *Supervisor) startsNowLocked(v *svc) bool {
	return v.tool.Autostart || s.shown[v.tool.Id]
}

// Status is every service, by id. Never nil.
func (s *Supervisor) Status() []wshrpc.ServiceStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

func (s *Supervisor) statusLocked() []wshrpc.ServiceStatus {
	ids := make([]string, 0, len(s.svcs))
	for id := range s.svcs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]wshrpc.ServiceStatus, 0, len(ids))
	for _, id := range ids {
		out = append(out, s.statusOf(s.svcs[id]))
	}
	return out
}

func (s *Supervisor) statusOf(v *svc) wshrpc.ServiceStatus {
	return wshrpc.ServiceStatus{
		Id:        v.tool.Id,
		Name:      v.tool.Name,
		Command:   commandLine(v.tool),
		Dir:       ServiceDir(v.tool),
		Project:   v.project,
		State:     v.state,
		Port:      v.port,
		Url:       v.pageURL(),
		TabId:     v.tabId,
		BlockId:   v.blockId,
		StartedMs: v.startedMs,
		ExitCode:  v.exitCode,
		RetryAtMs: v.retryAtMs,
		Holder:    v.holder,
		Autostart: v.tool.Autostart,
	}
}

func (s *Supervisor) publishLocked() {
	s.d.Publish(wshrpc.ServicesData{Services: s.statusLocked()})
}

func (s *Supervisor) defLocked(v *svc) Def {
	return Def{Tool: v.tool, Port: v.port, Project: v.project, TabId: v.tabId, BlockId: v.blockId}
}

func (s *Supervisor) cancelLocked(v *svc) {
	for _, c := range v.cancels {
		if c != nil {
			c()
		}
	}
	v.cancels = nil
}

// remember changes what arcterm keeps about a service, writing only when something changed.
func (s *Supervisor) remember(id string, change func(r *Remembered)) {
	r := s.d.State.Get(id)
	old := r
	change(&r)
	if r == old {
		return
	}
	if err := s.d.State.Set(id, r); err != nil {
		log.Printf("[services] %s: saving its state: %v\n", id, err)
	}
}

func (s *Supervisor) byBlockLocked(blockId string) *svc {
	if blockId == "" {
		return nil
	}
	for _, v := range s.svcs {
		if v.blockId == blockId {
			return v
		}
	}
	return nil
}

// SetTools takes the current services (the tools with a page) from the config. projects maps a project's name to its
// path. Before Boot it only records them; after, a new service starts at once when it has Keep running or is on screen
// (else it sleeps), a changed one that runs restarts, and a removed one stops and closes its tab.
func (s *Supervisor) SetTools(ctx context.Context, tools []arctools.Tool, projects map[string]string, home string) {
	// the frontend matches project paths without regard to case (registeredProjectFor), and a Mac's disk does not
	// tell /Users/x/Workspaces from /Users/x/workspaces
	lowProjects := make(map[string]string, len(projects))
	for name, path := range projects {
		lowProjects[name] = strings.ToLower(path)
	}
	lowHome := strings.ToLower(home)

	next := map[string]arctools.Tool{}
	for _, t := range tools {
		if arctools.IsService(t) {
			next[t.Id] = t
		}
	}

	var after []func()
	s.mu.Lock()
	for id, v := range s.svcs {
		if _, ok := next[id]; ok {
			continue
		}
		s.cancelLocked(v)
		s.cancelSleepLocked(v)
		v.gen++
		delete(s.svcs, id)
		blockId, tabId := v.blockId, v.tabId
		after = append(after, func() {
			// the remembered port stays, for the page's address
			if blockId != "" {
				s.d.Stop(blockId)
			}
			if tabId != "" {
				if err := s.d.CloseTab(ctx, tabId); err != nil {
					log.Printf("[services] %s: closing its tab: %v\n", id, err)
				}
			}
		})
	}
	ids := make([]string, 0, len(next))
	for id := range next {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		t := next[id]
		project := ProjectFor(strings.ToLower(ServiceDir(t)), lowProjects, lowHome)
		v := s.svcs[id]
		if v == nil {
			v = &svc{tool: t, project: project, fixed: fixedPort(t), state: StateSleeping}
			v.port = v.fixed
			if v.fixed == 0 {
				v.port = s.d.State.Get(id).Port
			}
			s.svcs[id] = v
			if s.booted && s.startsNowLocked(v) {
				after = append(after, func() { _ = s.startService(ctx, id, false) })
			}
			continue
		}
		old := v.tool
		v.tool, v.project = t, project
		if old.Autostart != t.Autostart {
			if t.Autostart {
				s.cancelSleepLocked(v)
				if s.booted && v.state == StateSleeping {
					after = append(after, func() { _ = s.startService(ctx, id, false) })
				}
			} else {
				s.armSleepLocked(v)
			}
		}
		if !NeedsRestart(old, t) {
			continue
		}
		v.fixed = fixedPort(t)
		if v.fixed > 0 {
			v.port = v.fixed
		} else {
			v.port = s.d.State.Get(id).Port
		}
		switch v.state {
		case StateStarting, StateRunning, StateNoPage, StateRetrying:
			after = append(after, func() {
				if err := s.Restart(ctx, id); err != nil {
					log.Printf("[services] %s: restarting after a config change: %v\n", id, err)
				}
			})
		case StateElsewhere, StatePortTaken, StateCrashed:
			// the verdict was about the old entry
			v.state, v.holder, v.exitCode, v.retryAtMs = StateSleeping, "", 0, 0
			if s.booted && s.startsNowLocked(v) {
				after = append(after, func() { _ = s.startService(ctx, id, false) })
			}
		}
	}
	s.publishLocked()
	s.mu.Unlock()
	for _, f := range after {
		f()
	}
}

// Boot attaches the service blocks left by an earlier run, sweeps their leftover processes, closes the tabs of
// services that are gone, and starts every service that has Keep running or is on screen, BootStagger apart; the
// others sleep.
func (s *Supervisor) Boot(ctx context.Context) {
	blocks, err := s.d.ServiceBlocks(ctx)
	if err != nil {
		log.Printf("[services] listing the service blocks: %v\n", err)
	}
	var sweep []string
	var orphanTabs []string
	s.mu.Lock()
	for _, b := range blocks {
		v := s.svcs[b.ToolId]
		if v == nil {
			orphanTabs = append(orphanTabs, b.TabId)
			continue
		}
		if v.blockId != "" {
			orphanTabs = append(orphanTabs, b.TabId) // a second tab for the one service
			continue
		}
		v.tabId, v.blockId = b.TabId, b.BlockId
		sweep = append(sweep, b.BlockId)
	}
	s.booted = true
	ids := make([]string, 0, len(s.svcs))
	for id, v := range s.svcs {
		if s.startsNowLocked(v) {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	s.publishLocked()
	s.mu.Unlock()

	for _, blockId := range sweep {
		s.d.Sweep(blockId)
	}
	for _, tabId := range orphanTabs {
		if tabId == "" {
			continue
		}
		if err := s.d.CloseTab(ctx, tabId); err != nil {
			log.Printf("[services] closing a tab of a service that is gone: %v\n", err)
		}
	}
	for i, id := range ids {
		id := id
		s.d.After(time.Duration(i)*BootStagger, func() {
			if err := s.startService(context.Background(), id, false); err != nil {
				log.Printf("[services] %s: starting at boot: %v\n", id, err)
			}
		})
	}
}

// Open makes sure the service has its tab and block, without starting it.
func (s *Supervisor) Open(ctx context.Context, id string) (wshrpc.ServiceStatus, error) {
	s.mu.Lock()
	v := s.svcs[id]
	if v == nil {
		s.mu.Unlock()
		return wshrpc.ServiceStatus{}, fmt.Errorf("no service %q", id)
	}
	def := s.defLocked(v)
	s.mu.Unlock()

	tabId, blockId, err := s.d.Ensure(ctx, def)
	if err != nil {
		return wshrpc.ServiceStatus{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v = s.svcs[id]
	if v == nil {
		return wshrpc.ServiceStatus{}, fmt.Errorf("service %q was removed", id)
	}
	v.tabId, v.blockId = tabId, blockId
	s.publishLocked()
	return s.statusOf(v), nil
}

// Start starts a service the person asked for: it clears the crash count.
func (s *Supervisor) Start(ctx context.Context, id string) error {
	return s.startService(ctx, id, true)
}

func (s *Supervisor) startService(ctx context.Context, id string, byPerson bool) error {
	s.mu.Lock()
	v := s.svcs[id]
	if v == nil {
		s.mu.Unlock()
		return fmt.Errorf("no service %q", id)
	}
	if byPerson {
		switch v.state {
		case StateStarting, StateRunning:
			s.mu.Unlock()
			return nil
		case StateNoPage:
			// the process is up and the page has not answered: look again for a while
			s.cancelLocked(v)
			v.gen++
			v.state = StateStarting
			v.deadline = s.d.Now().Add(StartTimeout)
			s.armSleepLocked(v)
			s.scheduleProbeLocked(v, v.gen)
			s.publishLocked()
			s.mu.Unlock()
			return nil
		}
		v.crashes.Reset()
	} else if v.owned() {
		// a start that is not the person's (a wake, a boot start) finds it already up: leave it be
		s.mu.Unlock()
		return nil
	}
	if !sleepable(v.state) {
		s.cancelSleepLocked(v) // a timer left from an earlier run must not cut this one short
	}
	s.cancelLocked(v)
	v.gen++
	gen := v.gen
	v.holder, v.exitCode, v.retryAtMs, v.startedMs = "", 0, 0, 0
	fixed := v.fixed
	tool := v.tool
	if fixed > 0 {
		for _, o := range s.svcs {
			if o != v && o.owned() && o.port == fixed {
				v.state, v.port, v.holder = StatePortTaken, fixed, o.tool.Name
				s.publishLocked()
				s.mu.Unlock()
				return nil
			}
		}
	}
	s.mu.Unlock()

	port := fixed
	if fixed > 0 {
		if s.d.Probe(ctx, tool.Url) {
			return s.settle(id, gen, func(v *svc) { v.state, v.port = StateElsewhere, fixed })
		}
		if name, held := s.d.PortHolder(ctx, fixed); held {
			if name == "" {
				name = otherProgram
			}
			return s.settle(id, gen, func(v *svc) { v.state, v.port, v.holder = StatePortTaken, fixed, name })
		}
	} else {
		port = s.d.State.Get(id).Port
		if port != 0 {
			if _, held := s.d.PortHolder(ctx, port); held {
				port = 0
			}
		}
		if port == 0 {
			p, err := s.d.FreePort()
			if err != nil {
				_ = s.settle(id, gen, func(v *svc) { v.state = StateSleeping })
				return fmt.Errorf("picking a free port: %w", err)
			}
			port = p
		}
		s.remember(id, func(r *Remembered) { r.Port = port })
	}

	s.mu.Lock()
	v = s.svcs[id]
	if v == nil || v.gen != gen {
		s.mu.Unlock()
		return nil
	}
	v.port = port
	def := s.defLocked(v)
	s.mu.Unlock()

	tabId, blockId, err := s.d.Ensure(ctx, def)
	if err != nil {
		_ = s.settle(id, gen, func(v *svc) { s.crashLocked(v, 1) })
		return fmt.Errorf("preparing the service's terminal: %w", err)
	}
	s.mu.Lock()
	v = s.svcs[id]
	if v == nil || v.gen != gen {
		s.mu.Unlock()
		return nil
	}
	now := s.d.Now()
	v.tabId, v.blockId = tabId, blockId
	v.state = StateStarting
	v.procStart = now
	v.deadline = now.Add(StartTimeout)
	s.armSleepLocked(v)
	s.publishLocked()
	s.mu.Unlock()

	startErr := s.d.Start(ctx, tabId, blockId)

	s.mu.Lock()
	v = s.svcs[id]
	if v == nil || v.gen != gen {
		// stopped (or removed) while it was starting: what was just started must not outlive that
		s.mu.Unlock()
		s.d.Stop(blockId)
		return nil
	}
	if startErr != nil {
		s.crashLocked(v, 1)
		s.mu.Unlock()
		return fmt.Errorf("starting the service: %w", startErr)
	}
	s.scheduleProbeLocked(v, gen)
	s.mu.Unlock()
	return nil
}

// settle ends a start whose answer needs no process: it applies change to the service unless something else has
// changed it since gen was taken.
func (s *Supervisor) settle(id string, gen int, change func(v *svc)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.svcs[id]
	if v == nil || v.gen != gen {
		return nil
	}
	change(v)
	s.publishLocked()
	return nil
}

func (s *Supervisor) scheduleProbeLocked(v *svc, gen int) {
	id := v.tool.Id
	v.cancels = append(v.cancels, s.d.After(ProbeInterval, func() { s.probeTick(id, gen) }))
}

// probeTick is one readiness probe of a service that is starting.
func (s *Supervisor) probeTick(id string, gen int) {
	ctx := context.Background()
	s.mu.Lock()
	v := s.svcs[id]
	if v == nil || v.gen != gen || v.state != StateStarting {
		s.mu.Unlock()
		return
	}
	pageURL := v.pageURL()
	s.mu.Unlock()

	answered := s.d.Probe(ctx, pageURL)

	s.mu.Lock()
	v = s.svcs[id]
	if v == nil || v.gen != gen || v.state != StateStarting {
		s.mu.Unlock()
		return
	}
	now := s.d.Now()
	if answered {
		v.state = StateRunning
		v.startedMs = now.UnixMilli()
		s.publishLocked()
		s.mu.Unlock()
		return
	}
	if !now.Before(v.deadline) {
		v.state = StateNoPage
		s.publishLocked()
		s.mu.Unlock()
		return
	}
	auto, blockId, port := v.fixed == 0, v.blockId, v.port
	s.mu.Unlock()

	// a dev server that ignores PORT prints where it listens
	switched := 0
	if auto && blockId != "" {
		if p, ok := ScanLocalURL(s.d.ReadLog(blockId)); ok && p != port {
			switched = p
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	v = s.svcs[id]
	if v == nil || v.gen != gen || v.state != StateStarting {
		return
	}
	if switched != 0 {
		v.port = switched
		s.remember(id, func(r *Remembered) { r.Port = switched })
		s.publishLocked()
	}
	s.scheduleProbeLocked(v, gen)
}

// Stop stops a service now, whatever work it is in the middle of. Nothing remembers it: the service starts again the
// next time it is shown (a Seen that newly shows it), or when Start is called.
func (s *Supervisor) Stop(ctx context.Context, id string) error {
	return s.stop(id)
}

func (s *Supervisor) stop(id string) error {
	s.mu.Lock()
	v := s.svcs[id]
	if v == nil {
		s.mu.Unlock()
		return fmt.Errorf("no service %q", id)
	}
	if v.state == StateElsewhere {
		s.mu.Unlock()
		return fmt.Errorf("%s was not started by arcterm: nothing of arcterm's runs to stop", v.tool.Name)
	}
	wasOwned := v.owned()
	s.cancelLocked(v)
	s.cancelSleepLocked(v)
	v.gen++
	v.state = StateSleeping
	v.startedMs, v.retryAtMs, v.exitCode, v.holder = 0, 0, 0, ""
	if wasOwned {
		v.ignoreExits++
		v.ignoreUntil = s.d.Now().Add(exitIgnoreWindow)
	}
	blockId := v.blockId
	s.publishLocked()
	s.mu.Unlock()
	if blockId != "" {
		s.d.Stop(blockId)
	}
	return nil
}

// Restart is Stop then Start.
func (s *Supervisor) Restart(ctx context.Context, id string) error {
	if err := s.stop(id); err != nil {
		return err
	}
	return s.startService(ctx, id, true)
}

// OnExit hears that a service block's process ended. A Stop's own exit, and an exit of a block that is no service's,
// are ignored; a clean exit or one after Ctrl+C is a stop; anything else is a crash.
func (s *Supervisor) OnExit(blockId string, exitCode int, interrupted bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.byBlockLocked(blockId)
	if v == nil {
		return
	}
	if v.ignoreExits > 0 {
		if s.d.Now().Before(v.ignoreUntil) {
			v.ignoreExits--
			return
		}
		v.ignoreExits = 0
	}
	if !v.owned() {
		return
	}
	if ExitIsStop(exitCode, interrupted) {
		s.cancelLocked(v)
		s.cancelSleepLocked(v)
		v.gen++
		v.state = StateSleeping
		v.startedMs = 0
		s.publishLocked()
		return
	}
	s.crashLocked(v, exitCode)
}

// crashLocked records a crash of a service that was up: retry after a backoff, or give up after MaxCrashes inside
// CrashWindow.
func (s *Supervisor) crashLocked(v *svc, exitCode int) {
	now := s.d.Now()
	s.cancelLocked(v)
	v.gen++
	if !v.procStart.IsZero() && now.Sub(v.procStart) >= CrashWindow {
		v.crashes.Reset() // it stayed up long enough to count as healthy
	}
	n := v.crashes.Add(now)
	v.startedMs = 0
	v.exitCode = exitCode
	if n < MaxCrashes {
		wait := Backoff(n)
		v.state = StateRetrying
		v.retryAtMs = now.Add(wait).UnixMilli()
		id, gen := v.tool.Id, v.gen
		v.cancels = append(v.cancels, s.d.After(wait, func() { s.retry(id, gen) }))
	} else {
		v.state = StateCrashed
		v.retryAtMs = 0
	}
	s.publishLocked()
}

func (s *Supervisor) retry(id string, gen int) {
	s.mu.Lock()
	v := s.svcs[id]
	if v == nil || v.gen != gen || v.state != StateRetrying {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	if err := s.startService(context.Background(), id, false); err != nil {
		log.Printf("[services] %s: retrying: %v\n", id, err)
	}
}

// OnBlockClosed hears that a block was closed. When it was a service's (and not by the supervisor itself, which has
// dropped the service first), that counts as a Stop, and the next Start or Open makes a new tab.
func (s *Supervisor) OnBlockClosed(blockId string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.byBlockLocked(blockId)
	if v == nil {
		return
	}
	switch v.state {
	case StateStarting, StateRunning, StateNoPage, StateRetrying, StateCrashed:
		s.cancelLocked(v)
		s.cancelSleepLocked(v)
		v.gen++
		v.state = StateSleeping
		v.startedMs, v.retryAtMs, v.exitCode = 0, 0, 0
	}
	v.tabId, v.blockId = "", ""
	s.publishLocked()
}
