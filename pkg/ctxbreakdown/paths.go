package ctxbreakdown

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func exists(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }

// pluginOf is the plugin a "Plugin (x)" source or an "x:name" item belongs to, and the item's own name
func pluginOf(name, source string) (plugin, short string) {
	short = name
	if i := strings.Index(name, ":"); i >= 0 {
		plugin, short = name[:i], name[i+1:]
	}
	if open, close := strings.Index(source, "("), strings.LastIndex(source, ")"); open >= 0 && close > open {
		plugin = strings.TrimSpace(source[open+1 : close])
	}
	return plugin, short
}

func firstGlob(pattern string) string {
	m, _ := filepath.Glob(pattern)
	for _, p := range m {
		if exists(p) {
			return p
		}
	}
	return ""
}

// ResolvePaths fills the file a skill or agent row opens; one it cannot find (built in, claude.ai sync, removed) keeps "".
func ResolvePaths(b *wshrpc.ContextBreakdown, cwd, home string) {
	resolve := func(it *wshrpc.ContextItem, user, project func(short string) string, plugin func(p, short string) string) {
		src := strings.ToLower(it.Source)
		var p string
		switch {
		case src == "user":
			p = user(it.Name)
		case src == "project" && cwd != "":
			p = project(it.Name)
		case strings.HasPrefix(src, "plugin"):
			pl, short := pluginOf(it.Name, it.Source)
			if pl != "" {
				p = plugin(pl, short)
			}
		}
		if p != "" && exists(p) {
			it.Path = p
		}
	}
	for i := range b.Skills {
		resolve(&b.Skills[i],
			func(n string) string { return filepath.Join(home, ".claude", "skills", n, "SKILL.md") },
			func(n string) string { return filepath.Join(cwd, ".claude", "skills", n, "SKILL.md") },
			func(pl, n string) string {
				if pl == "arc" {
					return filepath.Join(home, ".arc", "claude-mod", "skills", n, "SKILL.md")
				}
				return firstGlob(filepath.Join(home, ".claude", "plugins", "cache", "*", pl, "*", "skills", n, "SKILL.md"))
			})
	}
	for i := range b.Agents {
		resolve(&b.Agents[i],
			func(n string) string { return filepath.Join(home, ".claude", "agents", n+".md") },
			func(n string) string { return filepath.Join(cwd, ".claude", "agents", n+".md") },
			func(pl, n string) string {
				return firstGlob(filepath.Join(home, ".claude", "plugins", "cache", "*", pl, "*", "agents", n+".md"))
			})
	}
}
