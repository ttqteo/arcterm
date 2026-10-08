package devservers

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memusage"
)

func aliveIn(pids ...int32) func(int32) bool {
	set := map[int32]bool{}
	for _, p := range pids {
		set[p] = true
	}
	return func(p int32) bool { return set[p] }
}

// the 2026-10-08 :8100 chain: python <- uvicorn <- bash (Claude's wrapper) <- claude.exe <- powershell (the block's shell)
func TestOwnerOfAgentThroughItsShell(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "python.exe", Cmdline: "python -m uvicorn app.main:app", CreateMs: 900},
		Proc{Pid: 40, Ppid: 30, Name: "bash.exe", Cmdline: `bash -c "uv run uvicorn app.main:app --port 8100"`, CreateMs: 800},
		Proc{Pid: 30, Ppid: 20, Name: "claude.exe", Cmdline: "claude", CreateMs: 700},
		Proc{Pid: 20, Ppid: 10, Name: "powershell.exe", Cmdline: "powershell", CreateMs: 600},
	)
	holders := map[int32]ServerOwner{20: {Kind: OwnerAgent, BlockId: "b1", TabId: "t1", Name: "portal", Harness: "claude"}}
	o, launcher := OwnerOf(50, procs, aliveIn(50, 40, 30, 20, 10), holders)
	if o.Kind != OwnerAgent || o.TabId != "t1" {
		t.Fatalf("owner = %+v; want the agent", o)
	}
	if launcher != `bash -c "uv run uvicorn app.main:app --port 8100"` {
		t.Fatalf("launcher = %q; want the process claude started", launcher)
	}
}

func TestOwnerOfTerminal(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 20, Name: "node.exe", Cmdline: "node vite", CreateMs: 900},
		Proc{Pid: 20, Ppid: 10, Name: "pwsh.exe", Cmdline: "pwsh", CreateMs: 600},
	)
	holders := map[int32]ServerOwner{20: {Kind: OwnerTerminal, TabId: "t2", Name: "dev"}}
	if o, l := OwnerOf(50, procs, aliveIn(50, 20, 10), holders); o.Kind != OwnerTerminal || o.TabId != "t2" || l != "" {
		t.Fatalf("owner = %+v, %q; want the terminal and no launcher", o, l)
	}
}

func TestOwnerOfAppIsTheHighestBelowTheSessionRoot(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "Code.exe", Cmdline: "Code.exe --type=utility", CreateMs: 900},
		Proc{Pid: 40, Ppid: 4, Name: "Code.exe", Cmdline: "Code.exe", CreateMs: 800},
		Proc{Pid: 4, Ppid: 1, Name: "explorer.exe", Cmdline: "explorer.exe", CreateMs: 100},
	)
	if o, l := OwnerOf(50, procs, aliveIn(50, 40, 4, 1), nil); o.Kind != OwnerApp || o.Name != "Code.exe" || l != "" {
		t.Fatalf("owner = %+v, %q; want app Code.exe", o, l)
	}
}

// a parent that is running but could not be read (the system's) started an app
func TestOwnerOfUnreadableLiveParentIsAnApp(t *testing.T) {
	procs := procMap(Proc{Pid: 50, Ppid: 9, Name: "com.docker.backend.exe", Cmdline: "com.docker.backend services", CreateMs: 900})
	if o, _ := OwnerOf(50, procs, aliveIn(50, 9), nil); o.Kind != OwnerApp || o.Name != "com.docker.backend.exe" {
		t.Fatalf("owner = %+v; want app com.docker.backend.exe", o)
	}
}

// the 2026-10-08 :4310 chain: Claude's wrapper exited, sh -> pnpm -> node lives on
func TestOwnerOfDetachedWhenAParentIsGone(t *testing.T) {
	sh := `"C:\Program Files\Git\usr\bin\sh.exe" /c/nvm4w/nodejs/pnpm run start`
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "node.exe", Cmdline: "node ./dist/server/entry.mjs", CreateMs: 900},
		Proc{Pid: 40, Ppid: 30, Name: "sh.exe", Cmdline: sh, CreateMs: 800},
	)
	o, launcher := OwnerOf(50, procs, aliveIn(50, 40), nil)
	if o.Kind != OwnerDetached || launcher != sh {
		t.Fatalf("owner = %+v, %q; want detached with the sh launcher", o, launcher)
	}
}

func TestOwnerOfDetachedWhenTheParentPidWasReused(t *testing.T) {
	procs := procMap(
		Proc{Pid: 50, Ppid: 40, Name: "node.exe", Cmdline: "node astro dev", CreateMs: 900},
		Proc{Pid: 40, Ppid: 4, Name: "notepad.exe", Cmdline: "notepad", CreateMs: 5000}, // newer than its "child"
	)
	if o, l := OwnerOf(50, procs, aliveIn(50, 40, 4), nil); o.Kind != OwnerDetached || l != "node astro dev" {
		t.Fatalf("owner = %+v, %q; want detached, launcher the listener itself", o, l)
	}
}

func TestRepoFinder(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	wt := filepath.Join(root, "wt")
	for _, d := range []string{filepath.Join(repo, ".git"), filepath.Join(repo, "web", "src"), filepath.Join(wt, "api"), filepath.Join(root, "plain")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(wt, ".git"), []byte("gitdir: x"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := newRepoFinder()
	if got := f.find(filepath.Join(repo, "web", "src")); got != repo {
		t.Fatalf("find(repo/web/src) = %q; want %q", got, repo)
	}
	if got := f.find(filepath.Join(wt, "api")); got != wt {
		t.Fatalf("find(worktree/api) = %q; want %q (a .git file counts)", got, wt)
	}
	if got := f.find(filepath.Join(root, "plain")); got != "" {
		t.Fatalf("find(plain) = %q; want none", got)
	}
	if got := f.find(""); got != "" {
		t.Fatalf("find(\"\") = %q; want none", got)
	}
}

type fakeOS struct {
	listeners []Listener
	parents   map[int32]int32
	procs     map[int32]Proc
	details   atomic.Int32  // detail reads
	gate      chan struct{} // when set, listeners() waits on it
}

func (f *fakeOS) lister() *machineLister {
	return &machineLister{
		listeners: func(ctx context.Context) ([]Listener, error) {
			if f.gate != nil {
				<-f.gate
			}
			return f.listeners, nil
		},
		table: func() (memusage.Table, error) { return memusage.NewTable(f.parents), nil },
		createMs: func(_ context.Context, pid int32) (int64, bool) {
			p, ok := f.procs[pid]
			return p.CreateMs, ok
		},
		detail: func(_ context.Context, pid int32) (Proc, bool) {
			f.details.Add(1)
			p, ok := f.procs[pid]
			return p, ok
		},
		repos: newRepoFinder(),
	}
}

func machineFixture() *fakeOS {
	return &fakeOS{
		listeners: []Listener{{Pid: 50, Port: 4321}, {Pid: 50, Port: 4321}, {Pid: 60, Port: 135}},
		parents:   map[int32]int32{50: 40, 40: 4, 4: 1, 60: 1},
		procs: map[int32]Proc{
			50: {Pid: 50, Name: "node.exe", Cmdline: "node astro dev", Cwd: "", CreateMs: 900},
			40: {Pid: 40, Name: "sh.exe", Cmdline: "sh pnpm dev", CreateMs: 800},
			4:  {Pid: 4, Name: "explorer.exe", Cmdline: "explorer.exe", CreateMs: 100},
			60: {Pid: 60, Name: "svchost.exe", CreateMs: 50}, // its command line can't be read
		},
	}
}

func TestListAllListsReadableListenersOnce(t *testing.T) {
	f := machineFixture()
	got, err := f.lister().list(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Pid != 50 || len(got[0].Ports) != 1 || got[0].Owner == nil || got[0].Owner.Kind != OwnerApp {
		t.Fatalf("got %+v; want only node, one port, owned by the app below explorer", got)
	}
}

func TestListAllReadsAProcessOnceAndDropsGonePids(t *testing.T) {
	f := machineFixture()
	m := f.lister()
	if _, err := m.list(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	first := f.details.Load()
	if _, err := m.list(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if f.details.Load() != first {
		t.Fatalf("second poll read %d details; want 0 (cached by pid and create time)", f.details.Load()-first)
	}
	// pid 40 exits and its pid comes back as another process: read again, and the old entry is gone
	f.procs[40] = Proc{Pid: 40, Name: "notepad.exe", Cmdline: "notepad", CreateMs: 5000}
	if got, _ := m.list(context.Background(), nil); got[0].Owner.Kind != OwnerDetached {
		t.Fatalf("owner = %+v; want detached after the parent pid was reused", got[0].Owner)
	}
	delete(f.parents, 40)
	delete(f.procs, 40)
	m.list(context.Background(), nil)
	if _, kept := m.cache[40]; kept {
		t.Fatal("cache kept a pid that left the snapshot")
	}
}

// waitJoined blocks until n calls are waiting on the read in flight
func waitJoined(t *testing.T, m *machineLister, n int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for m.joinedForTest() < n {
		if time.Now().After(deadline) {
			t.Fatalf("only %d calls joined the read in flight; want %d", m.joinedForTest(), n)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestListAllSharesOneReadBetweenConcurrentCalls(t *testing.T) {
	f := machineFixture()
	f.gate = make(chan struct{})
	m := f.lister()
	var reads atomic.Int32
	inner := m.listeners
	m.listeners = func(ctx context.Context) ([]Listener, error) {
		reads.Add(1)
		return inner(ctx)
	}
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); m.list(context.Background(), nil) }()
	}
	// the read in flight is held at the gate, so two of the three can only be waiting on it
	waitJoined(t, m, 2)
	close(f.gate)
	wg.Wait()
	if reads.Load() != 1 {
		t.Fatalf("%d reads for three concurrent calls; want 1", reads.Load())
	}
}

// a call whose own context is live does not fail because the call that was reading was cancelled
func TestListAllRetriesWhenTheReadingCallWasCancelled(t *testing.T) {
	f := machineFixture()
	m := f.lister()
	var reads atomic.Int32
	m.listeners = func(ctx context.Context) ([]Listener, error) {
		if reads.Add(1) == 1 {
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return f.listeners, nil
	}
	leaderCtx, cancel := context.WithCancel(context.Background())
	leaderDone := make(chan error, 1)
	go func() { _, err := m.list(leaderCtx, nil); leaderDone <- err }()
	for reads.Load() < 1 {
		time.Sleep(time.Millisecond)
	}
	type result struct {
		got []Server
		err error
	}
	joinerDone := make(chan result, 1)
	go func() { got, err := m.list(context.Background(), nil); joinerDone <- result{got, err} }()
	waitJoined(t, m, 1)
	cancel()
	if err := <-leaderDone; err == nil {
		t.Fatal("the cancelled call returned no error")
	}
	r := <-joinerDone
	if r.err != nil || len(r.got) != 1 {
		t.Fatalf("joiner got %+v, %v; want its own read to succeed", r.got, r.err)
	}
	if reads.Load() != 2 {
		t.Fatalf("%d reads; want the cancelled one and one retry", reads.Load())
	}
}
