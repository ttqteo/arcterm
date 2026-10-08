package devservers

import (
	"os"
	"path/filepath"
	"testing"
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
