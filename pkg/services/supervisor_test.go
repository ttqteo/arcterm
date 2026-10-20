// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/arctools"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type fakeTimer struct {
	at        time.Time
	f         func()
	cancelled bool
	fired     bool
}

type memState struct {
	m map[string]Remembered
}

func (s *memState) Get(id string) Remembered { return s.m[id] }
func (s *memState) Set(id string, r Remembered) error {
	s.m[id] = r
	return nil
}

// harness runs a supervisor on fakes: a clock the test moves, a page that answers when up, and a record of what the
// supervisor did to the world.
type harness struct {
	t     *testing.T
	sup   *Supervisor
	state *memState
	now   time.Time

	timers   []*fakeTimer
	afterLog []time.Duration

	up       map[string]bool // url -> answers
	holders  map[int]string  // port -> program holding it
	freePort []int
	log      string
	blocks   []BlockRef

	ensures    []Def
	starts     [][2]string
	stops      []string
	sweeps     []string
	closedTabs []string
	published  []wshrpc.ServicesData
	freeCalls  int
	order      []string // "stop" and "start" in the order they happened
}

func newHarness(t *testing.T) *harness {
	h := &harness{
		t:       t,
		state:   &memState{m: map[string]Remembered{}},
		now:     time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC),
		up:      map[string]bool{},
		holders: map[int]string{},
	}
	h.sup = New(h.deps())
	return h
}

func (h *harness) deps() Deps {
	return Deps{
		Now: func() time.Time { return h.now },
		After: func(d time.Duration, f func()) func() {
			tm := &fakeTimer{at: h.now.Add(d), f: f}
			h.timers = append(h.timers, tm)
			h.afterLog = append(h.afterLog, d)
			return func() { tm.cancelled = true }
		},
		Probe: func(_ context.Context, url string) bool { return h.up[url] },
		FreePort: func() (int, error) {
			h.freeCalls++
			if len(h.freePort) == 0 {
				return 0, errors.New("no free port")
			}
			p := h.freePort[0]
			h.freePort = h.freePort[1:]
			return p, nil
		},
		PortHolder: func(_ context.Context, port int) (string, bool) {
			name, ok := h.holders[port]
			return name, ok
		},
		ServiceBlocks: func(context.Context) ([]BlockRef, error) { return h.blocks, nil },
		Ensure: func(_ context.Context, d Def) (string, string, error) {
			h.ensures = append(h.ensures, d)
			if d.TabId != "" && d.BlockId != "" {
				return d.TabId, d.BlockId, nil
			}
			return "tab-" + d.Tool.Id, "blk-" + d.Tool.Id, nil
		},
		Start: func(_ context.Context, tabId, blockId string) error {
			h.starts = append(h.starts, [2]string{tabId, blockId})
			h.order = append(h.order, "start")
			return nil
		},
		Stop: func(blockId string) {
			h.stops = append(h.stops, blockId)
			h.order = append(h.order, "stop")
			for url := range h.up {
				h.up[url] = false // what was serving is gone
			}
		},
		Sweep:    func(blockId string) { h.sweeps = append(h.sweeps, blockId) },
		ReadLog:  func(string) string { return h.log },
		CloseTab: func(_ context.Context, tabId string) error { h.closedTabs = append(h.closedTabs, tabId); return nil },
		Publish:  func(data wshrpc.ServicesData) { h.published = append(h.published, data) },
		State:    h.state,
	}
}

// advance moves the clock by d and fires the timers that come due, in order, including ones they set.
func (h *harness) advance(d time.Duration) {
	target := h.now.Add(d)
	for {
		var next *fakeTimer
		for _, tm := range h.timers {
			if tm.cancelled || tm.fired || tm.at.After(target) {
				continue
			}
			if next == nil || tm.at.Before(next.at) {
				next = tm
			}
		}
		if next == nil {
			break
		}
		if next.at.After(h.now) {
			h.now = next.at
		}
		next.fired = true
		next.f()
	}
	h.now = target
}

func (h *harness) pendingTimers() int {
	n := 0
	for _, tm := range h.timers {
		if !tm.cancelled && !tm.fired {
			n++
		}
	}
	return n
}

func (h *harness) setTools(tools ...arctools.Tool) {
	h.sup.SetTools(context.Background(), tools, nil, "/Users/me")
}

func (h *harness) status(id string) wshrpc.ServiceStatus {
	h.t.Helper()
	for _, s := range h.sup.Status() {
		if s.Id == id {
			return s
		}
	}
	h.t.Fatalf("no service %q in %+v", id, h.sup.Status())
	return wshrpc.ServiceStatus{}
}

func (h *harness) wantState(id, want string) wshrpc.ServiceStatus {
	h.t.Helper()
	s := h.status(id)
	if s.State != want {
		h.t.Fatalf("%s is %q, want %q (%+v)", id, s.State, want, s)
	}
	return s
}

// run starts the service and lets its page answer, so it reads running
func (h *harness) run(id, url string) {
	h.t.Helper()
	if err := h.sup.Start(context.Background(), id); err != nil {
		h.t.Fatalf("Start(%s): %v", id, err)
	}
	h.up[url] = true
	h.advance(ProbeInterval)
	h.wantState(id, StateRunning)
}

const dashURL = "http://127.0.0.1:8386/"

func fixedTool(id, url string) arctools.Tool {
	return arctools.Tool{Id: id, Name: id, Command: "npm", Args: "run dash", Url: url, Autostart: true}
}

func autoTool(id string) arctools.Tool {
	return arctools.Tool{Id: id, Name: id, Command: "npm", Args: "run dev", Port: arctools.PortAuto, Autostart: true}
}

func TestBlockMeta(t *testing.T) {
	d := Def{Tool: arctools.Tool{Id: "portfolio", Name: "Portfolio", Command: "npm", Args: "run dash"}, Port: 8386, Project: "journal"}
	meta := BlockMeta(d)
	want := map[string]any{
		"view":           "term",
		"controller":     "cmd",
		"cmd":            "npm run dash",
		"cmd:shell":      true,
		"cmd:jwt":        true,
		"cmd:runonstart": false,
		"cmd:cwd":        "~",
		"cmd:env":        map[string]any{"PORT": "8386"},
		"tool:id":        "portfolio",
		"tool:service":   true,
	}
	if !reflect.DeepEqual(map[string]any(meta), want) {
		t.Errorf("BlockMeta = %#v, want %#v", meta, want)
	}
	for _, k := range []string{"cmd:args", "cmd:runonce", "cmd:closeonexit"} {
		if _, ok := meta[k]; ok {
			t.Errorf("BlockMeta carries %s", k)
		}
	}
	d.Tool.Dir = "~/code/journal"
	if got := BlockMeta(d)["cmd:cwd"]; got != "~/code/journal" {
		t.Errorf("cmd:cwd = %v, want the tool's dir", got)
	}

	tab := TabMeta(d)
	if tab["tool:id"] != "portfolio" || tab["session:project"] != "journal" || tab["session:label"] != "Portfolio" {
		t.Errorf("TabMeta = %#v", tab)
	}
}

func TestStartProbesThenRunning(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	if err := h.sup.Start(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	st := h.wantState("portfolio", StateStarting)
	if st.TabId != "tab-portfolio" || st.BlockId != "blk-portfolio" {
		t.Errorf("status ids = %q %q", st.TabId, st.BlockId)
	}
	if st.StartedMs != h.now.UnixMilli() {
		t.Errorf("starting StartedMs = %d, want %d: the waiting card counts from it", st.StartedMs, h.now.UnixMilli())
	}
	if len(h.starts) != 1 || h.ensures[0].Port != 8386 {
		t.Fatalf("starts %v, ensure %+v", h.starts, h.ensures)
	}
	h.advance(ProbeInterval) // the page does not answer yet
	h.wantState("portfolio", StateStarting)
	h.up[dashURL] = true
	h.advance(ProbeInterval)
	st = h.wantState("portfolio", StateRunning)
	if st.Port != 8386 || st.StartedMs != h.now.UnixMilli() {
		t.Errorf("running status = %+v", st)
	}
	if h.pendingTimers() != 0 {
		t.Errorf("%d timers still pending while running: nothing polls a running service", h.pendingTimers())
	}
}

func TestCrashRetriesWithBackoffThenGivesUp(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	for i, wait := range []time.Duration{1, 2, 4, 8} {
		wait *= time.Second
		h.exit("blk-portfolio", 1, false)
		st := h.wantState("portfolio", StateRetrying)
		if st.RetryAtMs != h.now.Add(wait).UnixMilli() {
			t.Errorf("crash %d: retry at %d, want now+%v", i+1, st.RetryAtMs, wait)
		}
		h.advance(wait)
		h.wantState("portfolio", StateStarting)
	}
	h.exit("blk-portfolio", 1, false)
	st := h.wantState("portfolio", StateCrashed)
	if st.ExitCode != 1 || st.RetryAtMs != 0 {
		t.Errorf("crashed status = %+v", st)
	}
	if h.pendingTimers() != 0 {
		t.Errorf("a service that gave up must have no timer, %d pending", h.pendingTimers())
	}
	if h.state.Get("portfolio").Stopped {
		t.Error("a crash that gave up is not a stop by the person")
	}
}

func TestLongRunResetsCrashCount(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	for _, wait := range []time.Duration{1, 2, 4} {
		h.exit("blk-portfolio", 1, false)
		h.advance(wait * time.Second)
	}
	h.wantState("portfolio", StateStarting)
	h.up[dashURL] = true
	h.advance(11 * time.Minute)
	h.exit("blk-portfolio", 1, false)
	st := h.wantState("portfolio", StateRetrying)
	if st.RetryAtMs != h.now.Add(time.Second).UnixMilli() {
		t.Errorf("after an 11 minute run the retry is %v away, want 1s", time.UnixMilli(st.RetryAtMs).Sub(h.now))
	}
}

func TestStopIsRememberedAndNotRetried(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	if err := h.sup.Stop(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	h.wantState("portfolio", StateStopped)
	if !h.state.Get("portfolio").Stopped {
		t.Error("Stop is not remembered")
	}
	if !slices.Equal(h.stops, []string{"blk-portfolio"}) {
		t.Errorf("stops = %v", h.stops)
	}
	h.exit("blk-portfolio", 143, false)
	h.wantState("portfolio", StateStopped)
	if h.pendingTimers() != 0 {
		t.Error("the exit after a Stop must not be retried")
	}

	// a boot leaves it stopped
	h2 := newHarness(t)
	h2.state = h.state
	h2.sup = New(h2.deps())
	h2.setTools(fixedTool("portfolio", dashURL))
	h2.sup.Boot(context.Background())
	h2.advance(time.Second)
	if len(h2.starts) != 0 || len(h2.ensures) != 0 {
		t.Errorf("boot started a service the person stopped: %v", h2.starts)
	}

	if err := h2.sup.Start(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	if h2.state.Get("portfolio").Stopped {
		t.Error("Start must clear the stop flag")
	}
}

func TestStopsExitDoesNotCountAgainstARestart(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	if err := h.sup.Restart(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	st := h.wantState("portfolio", StateStarting)
	if !slices.Equal(h.order, []string{"start", "stop", "start"}) {
		t.Errorf("order = %v", h.order)
	}
	// the old process's exit arrives after the new start
	h.exit(st.BlockId, 143, false)
	h.wantState("portfolio", StateStarting)
	// the next exit is the new process's
	h.exit(st.BlockId, 1, false)
	h.wantState("portfolio", StateRetrying)
}

func TestInterruptCountsAsStop(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	h.exit("blk-portfolio", 130, true)
	h.wantState("portfolio", StateStopped)
	if !h.state.Get("portfolio").Stopped {
		t.Error("Ctrl+C in the log is a remembered Stop")
	}
	if h.pendingTimers() != 0 {
		t.Error("no retry after the person's Ctrl+C")
	}
}

func TestExitZeroIsStop(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	h.exit("blk-portfolio", 0, false)
	h.wantState("portfolio", StateStopped)
	if !h.state.Get("portfolio").Stopped || h.pendingTimers() != 0 {
		t.Error("a clean exit is a remembered stop with no retry")
	}
}

func TestElsewhere(t *testing.T) {
	h := newHarness(t)
	h.up[dashURL] = true
	h.setTools(fixedTool("portfolio", dashURL))
	if err := h.sup.Start(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	st := h.wantState("portfolio", StateElsewhere)
	if st.Port != 8386 {
		t.Errorf("port = %d", st.Port)
	}
	if len(h.ensures) != 0 || len(h.starts) != 0 {
		t.Errorf("an elsewhere service started something: %v %v", h.ensures, h.starts)
	}
	if err := h.sup.Stop(context.Background(), "portfolio"); err == nil {
		t.Error("Stop of an elsewhere service must be refused")
	}
	if err := h.sup.Restart(context.Background(), "portfolio"); err == nil {
		t.Error("Restart of an elsewhere service must be refused")
	}
	if len(h.stops) != 0 {
		t.Errorf("stopped %v: arcterm must not stop what it did not start", h.stops)
	}
	h.wantState("portfolio", StateElsewhere)
}

func TestStartOnElsewhereProbesAgain(t *testing.T) {
	h := newHarness(t)
	h.up[dashURL] = true
	h.setTools(fixedTool("portfolio", dashURL))
	_ = h.sup.Start(context.Background(), "portfolio")
	h.wantState("portfolio", StateElsewhere)

	_ = h.sup.Start(context.Background(), "portfolio")
	h.wantState("portfolio", StateElsewhere)
	if len(h.ensures) != 0 {
		t.Fatal("Start while the page still answers must change nothing")
	}

	h.up[dashURL] = false
	if err := h.sup.Start(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	h.wantState("portfolio", StateStarting)
	if len(h.ensures) != 1 || len(h.starts) != 1 {
		t.Errorf("ensures %d starts %d, want 1 each", len(h.ensures), len(h.starts))
	}
}

func TestPortTaken(t *testing.T) {
	h := newHarness(t)
	h.holders[8386] = "python3"
	h.setTools(fixedTool("portfolio", dashURL))
	_ = h.sup.Start(context.Background(), "portfolio")
	st := h.wantState("portfolio", StatePortTaken)
	if st.Holder != "python3" || len(h.starts) != 0 {
		t.Errorf("status %+v, starts %v", st, h.starts)
	}

	h.holders[8386] = ""
	_ = h.sup.Start(context.Background(), "portfolio")
	if st := h.status("portfolio"); st.Holder != "another program" {
		t.Errorf("holder = %q, want another program", st.Holder)
	}
}

func TestSamePortAsAnotherService(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("a", dashURL), fixedTool("b", dashURL))
	h.run("a", dashURL)
	// a's page answers on the port b is configured for: that is a, not something running elsewhere
	if err := h.sup.Start(context.Background(), "b"); err != nil {
		t.Fatal(err)
	}
	st := h.wantState("b", StatePortTaken)
	if st.Holder != "a" {
		t.Errorf("holder = %q, want a", st.Holder)
	}
	if len(h.starts) != 1 {
		t.Errorf("starts = %v, only a runs", h.starts)
	}
}

func TestAutoPortRemembered(t *testing.T) {
	h := newHarness(t)
	h.freePort = []int{41207, 41999}
	h.setTools(autoTool("dev"))
	_ = h.sup.Start(context.Background(), "dev")
	st := h.wantState("dev", StateStarting)
	if st.Port != 41207 || h.ensures[0].Port != 41207 {
		t.Errorf("port = %d, ensure %d", st.Port, h.ensures[0].Port)
	}
	if h.state.Get("dev").Port != 41207 {
		t.Error("the port is not remembered")
	}
	if st.Url != "http://127.0.0.1:41207/" {
		t.Errorf("url = %q", st.Url)
	}

	_ = h.sup.Stop(context.Background(), "dev")
	_ = h.sup.Start(context.Background(), "dev")
	if st := h.status("dev"); st.Port != 41207 || h.freeCalls != 1 {
		t.Errorf("second start: port %d, FreePort called %d times", st.Port, h.freeCalls)
	}

	_ = h.sup.Stop(context.Background(), "dev")
	h.holders[41207] = "node"
	_ = h.sup.Start(context.Background(), "dev")
	if st := h.status("dev"); st.Port != 41999 || h.freeCalls != 2 {
		t.Errorf("remembered port held: port %d, FreePort called %d times", st.Port, h.freeCalls)
	}
	if h.state.Get("dev").Port != 41999 {
		t.Error("the new port is not remembered")
	}
}

func TestUrlWinsOverAutoPort(t *testing.T) {
	h := newHarness(t)
	both := fixedTool("portfolio", dashURL)
	both.Port = arctools.PortAuto
	h.setTools(both)
	_ = h.sup.Start(context.Background(), "portfolio")
	st := h.wantState("portfolio", StateStarting)
	if st.Port != 8386 || h.freeCalls != 0 {
		t.Errorf("port %d, FreePort called %d times: the url's port wins", st.Port, h.freeCalls)
	}
}

func TestLogFallback(t *testing.T) {
	h := newHarness(t)
	h.freePort = []int{41207}
	h.log = "  VITE ready\n  \x1b[32m➜\x1b[0m  Local: http://localhost:5173/"
	h.setTools(autoTool("dev"))
	_ = h.sup.Start(context.Background(), "dev")
	h.up["http://127.0.0.1:5173/"] = true
	h.advance(ProbeInterval) // misses 41207, reads the log, switches
	h.wantState("dev", StateStarting)
	h.advance(ProbeInterval)
	st := h.wantState("dev", StateRunning)
	if st.Port != 5173 || h.state.Get("dev").Port != 5173 {
		t.Errorf("port %d, remembered %d, want 5173", st.Port, h.state.Get("dev").Port)
	}
}

func TestNoPageAfterTimeout(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	_ = h.sup.Start(context.Background(), "portfolio")
	h.advance(StartTimeout - ProbeInterval)
	h.wantState("portfolio", StateStarting)
	h.advance(ProbeInterval)
	h.wantState("portfolio", StateNoPage)
	if len(h.stops) != 0 {
		t.Errorf("stopped %v: the process keeps running without a page", h.stops)
	}
	if h.pendingTimers() != 0 {
		t.Error("nothing polls after nopage")
	}
}

func TestIPv6OnlyEndsNoPage(t *testing.T) {
	h := newHarness(t)
	h.freePort = []int{41207}
	h.log = "Local: http://localhost:5173"
	h.setTools(autoTool("dev")) // 127.0.0.1:5173 never answers: the server listens on ::1
	_ = h.sup.Start(context.Background(), "dev")
	h.advance(StartTimeout)
	st := h.wantState("dev", StateNoPage)
	if st.Port != 5173 || len(h.stops) != 0 {
		t.Errorf("status %+v, stops %v", st, h.stops)
	}
	h.advance(time.Minute)
	h.wantState("dev", StateNoPage)
}

func TestStartOnNoPageLooksAgain(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	_ = h.sup.Start(context.Background(), "portfolio")
	h.advance(StartTimeout)
	h.wantState("portfolio", StateNoPage)
	_ = h.sup.Start(context.Background(), "portfolio")
	h.wantState("portfolio", StateStarting)
	if len(h.starts) != 1 {
		t.Errorf("the process was started again: %v", h.starts)
	}
	h.up[dashURL] = true
	h.advance(ProbeInterval)
	h.wantState("portfolio", StateRunning)
}

func TestConfigChangeRestarts(t *testing.T) {
	h := newHarness(t)
	tool := fixedTool("portfolio", dashURL)
	h.setTools(tool)
	h.run("portfolio", dashURL)

	tool.Name = "Portfolio journal"
	h.setTools(tool)
	if len(h.stops) != 0 || len(h.starts) != 1 {
		t.Errorf("a new name restarted it: stops %v starts %v", h.stops, h.starts)
	}
	if h.status("portfolio").Name != "Portfolio journal" {
		t.Error("the name did not change")
	}

	tool.Args = "run dash:fast"
	h.setTools(tool)
	if !slices.Equal(h.stops, []string{"blk-portfolio"}) || len(h.starts) != 2 {
		t.Errorf("changed args: stops %v starts %v", h.stops, h.starts)
	}
	if !slices.Equal(h.order, []string{"start", "stop", "start"}) {
		t.Errorf("order = %v, want stop then start", h.order)
	}
	st := h.wantState("portfolio", StateStarting)
	if st.Command != "npm run dash:fast" {
		t.Errorf("command = %q", st.Command)
	}
}

func TestRemovedToolStopsAndClosesTab(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	h.setTools()
	if !slices.Equal(h.stops, []string{"blk-portfolio"}) || !slices.Equal(h.closedTabs, []string{"tab-portfolio"}) {
		t.Errorf("stops %v, closed %v", h.stops, h.closedTabs)
	}
	if got := h.sup.Status(); len(got) != 0 || got == nil {
		t.Errorf("status = %#v, want an empty non-nil list", got)
	}
	// the tab closing is not a service stopping
	h.sup.OnBlockClosed("blk-portfolio")
}

// removing an entry forgets the person's Stop, so the same id added again sleeps; the remembered port stays, which
// keeps the page's address (and the app's own browser storage) for the entry that comes back
func TestRemovedToolForgetsTheStop(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	if err := h.sup.Stop(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	h.state.Set("portfolio", Remembered{Port: 8386, Stopped: true})
	h.setTools()
	if got := h.state.Get("portfolio"); got.Stopped || got.Port != 8386 {
		t.Errorf("remembered after removal = %+v, want the Stop forgotten and the port kept", got)
	}
	back := fixedTool("portfolio", dashURL)
	back.Autostart = false
	h.setTools(back)
	h.wantState("portfolio", StateSleeping)
}

func TestNewAutostartServiceStartsAtOnce(t *testing.T) {
	h := newHarness(t)
	h.sup.Boot(context.Background())
	h.setTools(fixedTool("a", "http://127.0.0.1:8001/"))
	h.wantState("a", StateStarting)
	if len(h.ensures) != 1 || len(h.starts) != 1 {
		t.Errorf("ensures %d starts %d", len(h.ensures), len(h.starts))
	}

	off := fixedTool("b", "http://127.0.0.1:8002/")
	off.Autostart = false
	h.setTools(fixedTool("a", "http://127.0.0.1:8001/"), off)
	h.wantState("b", StateSleeping)
	if len(h.starts) != 1 {
		t.Errorf("a service with autostart off was started: %v", h.starts)
	}
}

func TestSetToolsBeforeBootStartsNothing(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("a", "http://127.0.0.1:8001/"))
	h.advance(time.Second)
	if len(h.starts) != 0 || len(h.ensures) != 0 {
		t.Errorf("started before Boot: %v", h.starts)
	}
	h.wantState("a", StateSleeping)
}

func TestBootSweepsAndStartsAutostart(t *testing.T) {
	h := newHarness(t)
	off := fixedTool("c", "http://127.0.0.1:8003/")
	off.Autostart = false
	h.setTools(fixedTool("a", "http://127.0.0.1:8001/"), fixedTool("b", "http://127.0.0.1:8002/"), off)
	h.blocks = []BlockRef{{"a", "tab-a", "blk-a"}, {"b", "tab-b", "blk-b"}, {"c", "tab-c", "blk-c"}}
	h.sup.Boot(context.Background())
	if !slices.Equal(h.sweeps, []string{"blk-a", "blk-b", "blk-c"}) {
		t.Errorf("sweeps = %v, want one per service block", h.sweeps)
	}
	if len(h.starts) != 0 {
		t.Fatalf("Boot started services itself instead of staggering them: %v", h.starts)
	}
	if !slices.Equal(h.afterLog, []time.Duration{0, BootStagger}) {
		t.Errorf("start delays = %v, want 0 and %v", h.afterLog, BootStagger)
	}
	h.advance(0)
	if len(h.starts) != 1 {
		t.Fatalf("first boot start: %v", h.starts)
	}
	h.advance(BootStagger)
	if len(h.starts) != 2 {
		t.Fatalf("second boot start: %v", h.starts)
	}
	h.advance(time.Minute)
	for _, s := range h.starts {
		if s[1] == "blk-c" {
			t.Error("a service with autostart off was started at boot")
		}
	}
}

func TestBootStartsARetryingService(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	h.exit("blk-portfolio", 1, false)
	h.wantState("portfolio", StateRetrying)

	// arcterm restarts while it is retrying
	h2 := newHarness(t)
	h2.state = h.state
	h2.sup = New(h2.deps())
	h2.setTools(fixedTool("portfolio", dashURL))
	h2.blocks = []BlockRef{{"portfolio", "tab-portfolio", "blk-portfolio"}}
	h2.sup.Boot(context.Background())
	h2.advance(0)
	h2.wantState("portfolio", StateStarting)
}

func TestBootReusesExistingBlock(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.blocks = []BlockRef{{"portfolio", "tab-1", "blk-1"}}
	h.sup.Boot(context.Background())
	if !slices.Equal(h.sweeps, []string{"blk-1"}) {
		t.Errorf("sweeps = %v", h.sweeps)
	}
	if st := h.status("portfolio"); st.TabId != "tab-1" || st.BlockId != "blk-1" {
		t.Errorf("status ids %q %q before the start", st.TabId, st.BlockId)
	}
	h.advance(0)
	if len(h.ensures) != 1 || h.ensures[0].TabId != "tab-1" || h.ensures[0].BlockId != "blk-1" {
		t.Fatalf("ensures = %+v", h.ensures)
	}
	if st := h.status("portfolio"); st.TabId != "tab-1" || st.BlockId != "blk-1" {
		t.Errorf("status ids %q %q", st.TabId, st.BlockId)
	}
}

func TestBootClosesOrphanServiceTab(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.blocks = []BlockRef{{"gone", "tab-x", "blk-x"}}
	h.sup.Boot(context.Background())
	if !slices.Equal(h.closedTabs, []string{"tab-x"}) {
		t.Errorf("closed = %v", h.closedTabs)
	}
	if len(h.sweeps) != 0 {
		t.Errorf("swept %v: a service that is gone has nothing to sweep", h.sweeps)
	}
}

func TestOpenMakesTheTabWithoutStarting(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	st, err := h.sup.Open(context.Background(), "portfolio")
	if err != nil {
		t.Fatal(err)
	}
	if len(h.ensures) != 1 || len(h.starts) != 0 {
		t.Errorf("ensures %d starts %d", len(h.ensures), len(h.starts))
	}
	if st.State != StateSleeping || st.TabId != "tab-portfolio" || st.BlockId != "blk-portfolio" {
		t.Errorf("status = %+v", st)
	}
	if _, err := h.sup.Open(context.Background(), "nope"); err == nil {
		t.Error("Open of an unknown service must fail")
	}
}

// Task 5's commands pass the supervisor's error on: an unknown id reads `no service "nope"`.
func TestUnknownIdErrors(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	_, openErr := h.sup.Open(ctx, "nope")
	for name, err := range map[string]error{
		"Open":    openErr,
		"Start":   h.sup.Start(ctx, "nope"),
		"Stop":    h.sup.Stop(ctx, "nope"),
		"Restart": h.sup.Restart(ctx, "nope"),
	} {
		if err == nil || !strings.Contains(err.Error(), `no service "nope"`) {
			t.Errorf("%s of an unknown id = %v, want an error holding `no service \"nope\"`", name, err)
		}
	}
}

func TestBlockClosedCountsAsStop(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	h.up[dashURL] = false // closing the block took the server with it
	h.sup.OnBlockClosed("blk-portfolio")
	st := h.wantState("portfolio", StateStopped)
	if st.TabId != "" || st.BlockId != "" || !h.state.Get("portfolio").Stopped {
		t.Errorf("status %+v, remembered %+v", st, h.state.Get("portfolio"))
	}
	n := len(h.ensures)
	_ = h.sup.Start(context.Background(), "portfolio")
	if h.ensures[n].TabId != "" || h.ensures[n].BlockId != "" {
		t.Errorf("Ensure got ids %q %q for a closed tab", h.ensures[n].TabId, h.ensures[n].BlockId)
	}
}

func TestCommandNotFoundGivesUp(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("portfolio", dashURL))
	_ = h.sup.Start(context.Background(), "portfolio")
	for i := 1; i <= 4; i++ {
		h.exit("blk-portfolio", 127, false)
		h.wantState("portfolio", StateRetrying)
		h.advance(Backoff(i))
		h.wantState("portfolio", StateStarting)
	}
	h.exit("blk-portfolio", 127, false)
	st := h.wantState("portfolio", StateCrashed)
	if st.ExitCode != 127 {
		t.Errorf("exit code = %d", st.ExitCode)
	}
}

func TestProjectMatchIgnoresCase(t *testing.T) {
	h := newHarness(t)
	tool := fixedTool("portfolio", dashURL)
	tool.Dir = "~/workspaces/Journal/app"
	other := fixedTool("other", "http://127.0.0.1:8001/")
	other.Dir = "/elsewhere"
	h.sup.SetTools(context.Background(), []arctools.Tool{tool, other},
		map[string]string{"Journal": "/Users/me/Workspaces/journal"}, "/Users/me")
	if got := h.status("portfolio").Project; got != "Journal" {
		t.Errorf("project = %q, want Journal", got)
	}
	if got := h.status("other").Project; got != HomeProject {
		t.Errorf("project = %q, want %s", got, HomeProject)
	}
}

func TestEveryChangePublishesTheFullList(t *testing.T) {
	h := newHarness(t)
	h.setTools(fixedTool("a", "http://127.0.0.1:8001/"), fixedTool("b", "http://127.0.0.1:8002/"))
	before := len(h.published)
	_ = h.sup.Start(context.Background(), "a")
	if len(h.published) == before {
		t.Fatal("Start published nothing")
	}
	last := h.published[len(h.published)-1]
	if len(last.Services) != 2 {
		t.Errorf("published %d services, want the full list of 2", len(last.Services))
	}
}

// exit is a service's process ending: its page stops answering, then the controller reports the exit
func (h *harness) exit(blockId string, code int, interrupted bool) {
	for url := range h.up {
		h.up[url] = false
	}
	h.sup.OnExit(blockId, code, interrupted)
}

// demandTool is a service without Keep running: it runs while its page is on screen and sleeps after.
func demandTool(id, url string) arctools.Tool {
	t := fixedTool(id, url)
	t.Autostart = false
	return t
}

func (h *harness) seen(ids ...string) { h.sup.Seen(context.Background(), ids) }

// boot records the tools, boots, and lets the staggered boot starts fire.
func (h *harness) boot(tools ...arctools.Tool) {
	h.setTools(tools...)
	h.sup.Boot(context.Background())
	h.advance(0)
}

// answer lets a starting service's page answer, so it reads running.
func (h *harness) answer(id, url string) {
	h.t.Helper()
	h.up[url] = true
	h.advance(ProbeInterval)
	h.wantState(id, StateRunning)
}

func TestUnseenServiceSleepsAfterTenMinutes(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.wantState("portfolio", StateSleeping)
	h.seen("portfolio")
	h.wantState("portfolio", StateStarting)
	h.answer("portfolio", dashURL)

	h.seen()
	h.advance(IdleSleep - time.Second)
	h.wantState("portfolio", StateRunning)
	if len(h.stops) != 0 {
		t.Fatalf("stopped before ten minutes: %v", h.stops)
	}
	h.advance(time.Second)
	h.wantState("portfolio", StateSleeping)
	if !slices.Equal(h.stops, []string{"blk-portfolio"}) {
		t.Errorf("stops = %v, want one", h.stops)
	}
	if h.state.Get("portfolio").Stopped {
		t.Error("a sleep is not the person's Stop")
	}
}

func TestSeenAgainCancelsSleep(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.seen("portfolio")
	h.answer("portfolio", dashURL)

	h.seen()
	h.advance(5 * time.Minute)
	h.seen("portfolio")
	h.advance(20 * time.Minute)
	h.wantState("portfolio", StateRunning)
	if len(h.stops) != 0 {
		t.Errorf("stops = %v, want none", h.stops)
	}
}

func TestSeenSleepingStarts(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.wantState("portfolio", StateSleeping)
	if len(h.starts) != 0 {
		t.Fatalf("started before it was shown: %v", h.starts)
	}
	h.seen("portfolio")
	h.wantState("portfolio", StateStarting)
	if len(h.ensures) != 1 || len(h.starts) != 1 {
		t.Errorf("ensures %d starts %d, want one each", len(h.ensures), len(h.starts))
	}
	if h.state.Get("portfolio").Stopped {
		t.Error("a start when shown must not touch the stop flag")
	}
}

func TestSeenRunningDoesNothing(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.seen("portfolio")
	h.answer("portfolio", dashURL)
	h.seen("portfolio")
	h.seen("portfolio")
	h.wantState("portfolio", StateRunning)
	if len(h.starts) != 1 || len(h.stops) != 0 {
		t.Errorf("starts %v stops %v: a repeated report restarted it", h.starts, h.stops)
	}
}

func TestNewSetArmsTheOnesThatLeft(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("a", "http://127.0.0.1:8001/"), demandTool("b", "http://127.0.0.1:8002/"))
	h.seen("a", "b")
	h.up["http://127.0.0.1:8001/"], h.up["http://127.0.0.1:8002/"] = true, true
	h.advance(ProbeInterval)
	h.wantState("a", StateRunning)
	h.wantState("b", StateRunning)

	h.seen("a") // the page was reloaded and shows only a
	h.advance(IdleSleep)
	h.wantState("a", StateRunning)
	h.wantState("b", StateSleeping)
}

func TestStoppedServiceDoesNotStartWhenSeen(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.run("portfolio", dashURL)
	if err := h.sup.Stop(context.Background(), "portfolio"); err != nil {
		t.Fatal(err)
	}
	h.seen("portfolio")
	h.wantState("portfolio", StateStopped)
	if len(h.starts) != 1 {
		t.Errorf("starts = %v: showing a service the person stopped started it", h.starts)
	}
	if h.pendingTimers() != 0 {
		t.Errorf("%d timers pending after a Stop", h.pendingTimers())
	}
}

func TestStartOffScreenSleeps(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.run("portfolio", dashURL) // the person's Start, from the popover; its page is never shown
	h.advance(IdleSleep - 2*time.Second - ProbeInterval)
	h.wantState("portfolio", StateRunning)
	h.advance(2 * time.Second)
	h.wantState("portfolio", StateSleeping)
	if h.state.Get("portfolio").Stopped {
		t.Error("a sleep is not the person's Stop")
	}
}

func TestKeepRunningNeverSleeps(t *testing.T) {
	h := newHarness(t)
	h.boot(fixedTool("portfolio", dashURL))
	h.wantState("portfolio", StateStarting)
	h.answer("portfolio", dashURL)
	h.seen()
	h.advance(30 * time.Minute)
	h.wantState("portfolio", StateRunning)
	if len(h.stops) != 0 {
		t.Errorf("stops = %v", h.stops)
	}
}

func TestKeepRunningOffArmsTimer(t *testing.T) {
	h := newHarness(t)
	tool := fixedTool("portfolio", dashURL)
	h.boot(tool)
	h.answer("portfolio", dashURL)
	h.seen()
	h.advance(time.Hour)
	h.wantState("portfolio", StateRunning)

	tool.Autostart = false
	h.setTools(tool)
	h.advance(IdleSleep - time.Second)
	h.wantState("portfolio", StateRunning)
	h.advance(time.Second)
	h.wantState("portfolio", StateSleeping)
}

func TestKeepRunningOnStartsSleeping(t *testing.T) {
	h := newHarness(t)
	tool := demandTool("portfolio", dashURL)
	h.boot(tool)
	h.wantState("portfolio", StateSleeping)
	tool.Autostart = true
	h.setTools(tool)
	h.wantState("portfolio", StateStarting)
}

func TestBootLeavesOnDemandSleeping(t *testing.T) {
	h := newHarness(t)
	h.state.m["c"] = Remembered{Stopped: true}
	h.boot(fixedTool("a", "http://127.0.0.1:8001/"), demandTool("b", "http://127.0.0.1:8002/"), fixedTool("c", "http://127.0.0.1:8003/"))
	h.wantState("a", StateStarting)
	h.wantState("b", StateSleeping)
	h.wantState("c", StateStopped)
	h.advance(time.Minute)
	if len(h.starts) != 1 || h.starts[0][1] != "blk-a" {
		t.Errorf("starts = %v, want only a's", h.starts)
	}
}

func TestBootStartsShownOnDemand(t *testing.T) {
	h := newHarness(t)
	h.seen("portfolio") // the report lands before the config and Boot
	h.boot(demandTool("portfolio", dashURL))
	h.wantState("portfolio", StateStarting)
}

func TestSetToolsStartsShownNewEntry(t *testing.T) {
	h := newHarness(t)
	h.boot()
	h.seen("portfolio") // not a known service yet
	h.setTools(demandTool("portfolio", dashURL))
	h.wantState("portfolio", StateStarting)
}

func TestElsewhereNeverSleeps(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.up[dashURL] = true // something of the person's already serves the page
	h.seen("portfolio")
	h.wantState("portfolio", StateElsewhere)
	h.seen()
	h.advance(30 * time.Minute)
	h.wantState("portfolio", StateElsewhere)
	if len(h.stops) != 0 {
		t.Errorf("stops = %v: nothing of arcterm's runs to stop", h.stops)
	}
}

func TestRetryingSleepsAndRetriesEnd(t *testing.T) {
	h := newHarness(t)
	h.boot(demandTool("portfolio", dashURL))
	h.seen("portfolio")
	h.answer("portfolio", dashURL)

	h.seen()
	h.advance(2 * time.Minute)
	h.exit("blk-portfolio", 1, false)
	h.wantState("portfolio", StateRetrying)
	h.advance(time.Second)
	h.wantState("portfolio", StateStarting) // the retry did not push the ten minutes back
	h.answer("portfolio", dashURL)

	h.advance(IdleSleep - 2*time.Minute - time.Second - ProbeInterval - 2*time.Second)
	h.exit("blk-portfolio", 1, false)
	h.wantState("portfolio", StateRetrying)
	starts := len(h.starts)
	h.advance(5 * time.Second)
	h.wantState("portfolio", StateSleeping)
	h.advance(time.Minute)
	h.wantState("portfolio", StateSleeping)
	if len(h.starts) != starts {
		t.Errorf("a retry started it after it slept: %v", h.starts)
	}
}

func TestWakeReusesRememberedPort(t *testing.T) {
	h := newHarness(t)
	tool := autoTool("dev")
	tool.Autostart = false
	h.freePort = []int{9100}
	h.boot(tool)
	h.seen("dev")
	h.wantState("dev", StateStarting)
	h.answer("dev", "http://127.0.0.1:9100/")
	h.seen()
	h.advance(IdleSleep)
	h.wantState("dev", StateSleeping)

	h.seen("dev")
	h.wantState("dev", StateStarting)
	if got := h.ensures[len(h.ensures)-1].Port; got != 9100 {
		t.Errorf("woke on port %d, want the remembered 9100", got)
	}
	if h.freeCalls != 1 {
		t.Errorf("FreePort called %d times, want once", h.freeCalls)
	}
}
