package ctxbreakdown

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func touch(t *testing.T, parts ...string) string {
	t.Helper()
	p := filepath.Join(parts...)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestResolvePaths(t *testing.T) {
	home, cwd := t.TempDir(), t.TempDir()
	paper := touch(t, home, ".claude", "skills", "paper", "SKILL.md")
	local := touch(t, cwd, ".claude", "skills", "local", "SKILL.md")
	design := touch(t, home, ".arc", "claude-mod", "skills", "design", "SKILL.md")
	brainstorming := touch(t, home, ".claude", "plugins", "cache", "superpowers-marketplace", "superpowers", "4.0.3", "skills", "brainstorming", "SKILL.md")
	reviewer := touch(t, home, ".claude", "plugins", "cache", "superpowers-marketplace", "superpowers", "4.0.3", "agents", "code-reviewer.md")
	mine := touch(t, home, ".claude", "agents", "mine.md")

	b := &wshrpc.ContextBreakdown{
		Skills: []wshrpc.ContextItem{
			{Name: "paper", Source: "User"}, {Name: "local", Source: "Project"}, {Name: "arc:design", Source: "Plugin (arc)"},
			{Name: "superpowers:brainstorming", Source: "Plugin (superpowers)"}, {Name: "gone", Source: "User"},
			{Name: "dataviz", Source: "Built-in"}, {Name: "docx", Source: "claude.ai sync"},
		},
		Agents: []wshrpc.ContextItem{{Name: "superpowers:code-reviewer", Source: "Plugin"}, {Name: "mine", Source: "User"}},
	}
	ResolvePaths(b, cwd, home)

	want := map[string]string{
		"paper": paper, "local": local, "arc:design": design, "superpowers:brainstorming": brainstorming,
		"gone": "", "dataviz": "", "docx": "",
	}
	for _, s := range b.Skills {
		if s.Path != want[s.Name] {
			t.Errorf("skill %q path = %q, want %q", s.Name, s.Path, want[s.Name])
		}
	}
	wantAgents := map[string]string{"superpowers:code-reviewer": reviewer, "mine": mine}
	for _, a := range b.Agents {
		if a.Path != wantAgents[a.Name] {
			t.Errorf("agent %q path = %q, want %q", a.Name, a.Path, wantAgents[a.Name])
		}
	}
}
