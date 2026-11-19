// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bugreport

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// arctermModule is the module line of arcterm's own go.mod: it is a fork of Wave Terminal and keeps the name.
const arctermModule = "github.com/wavetermdev/waveterm"

// FindRepo is arcterm's own checkout, where the agent that handles reports works. The bugreport:repo setting wins
// when set: the repo is found iff that folder exists, so a folder that was moved reads as not found and the person can
// pick again. Otherwise it is the first project, by name, whose path is the arcterm repo (IsArctermRepo). project is
// the name in projects whose path is path, empty when none is. It reads only what it is given and the disk: never the
// projects file (wconfig.ProjectNameAtPath would), so a test sees only its own map.
func FindRepo(setting string, projects map[string]wconfig.ProjectKeywords) (path, project string, ok bool) {
	names := make([]string, 0, len(projects))
	for name := range projects {
		names = append(names, name)
	}
	sort.Strings(names)

	if setting = strings.TrimSpace(setting); setting != "" {
		if info, err := os.Stat(expandHome(setting)); err != nil || !info.IsDir() {
			return "", "", false
		}
		path = filepath.Clean(expandHome(setting))
		return path, projectAt(path, names, projects), true
	}
	for _, name := range names {
		dir := expandHome(projects[name].Path)
		if dir != "" && IsArctermRepo(dir) {
			return filepath.Clean(dir), name, true
		}
	}
	return "", "", false
}

// projectAt is the first project, by name, registered at exactly path.
func projectAt(path string, names []string, projects map[string]wconfig.ProjectKeywords) string {
	want := comparablePath(path)
	for _, name := range names {
		if p := expandHome(projects[name].Path); p != "" && comparablePath(p) == want {
			return name
		}
	}
	return ""
}

// expandHome is a project path with a leading ~ made the home directory, as the registry stores it.
func expandHome(p string) string {
	p = strings.TrimSpace(p)
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		return wavebase.GetHomeDir() + p[1:]
	}
	return p
}

// comparablePath is a path as two spellings of one folder compare equal: cleaned, with forward slashes, and with the
// case folded on Windows only (elsewhere two paths that differ in case are two folders).
func comparablePath(p string) string {
	p = filepath.ToSlash(filepath.Clean(p))
	if runtime.GOOS == "windows" {
		p = strings.ToLower(p)
	}
	return p
}

// IsArctermRepo says whether dir is arcterm's checkout: a Taskfile.yml, a src-tauri/ folder, and a go.mod whose module
// is github.com/wavetermdev/waveterm.
func IsArctermRepo(dir string) bool {
	if dir == "" {
		return false
	}
	if info, err := os.Stat(filepath.Join(dir, "Taskfile.yml")); err != nil || info.IsDir() {
		return false
	}
	if info, err := os.Stat(filepath.Join(dir, "src-tauri")); err != nil || !info.IsDir() {
		return false
	}
	f, err := os.Open(filepath.Join(dir, "go.mod"))
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		rest, isModule := strings.CutPrefix(line, "module")
		if !isModule || (rest != "" && rest[0] != ' ' && rest[0] != '\t') {
			continue
		}
		if i := strings.Index(rest, "//"); i >= 0 {
			rest = rest[:i]
		}
		return strings.Trim(strings.TrimSpace(rest), `"`) == arctermModule
	}
	return false
}
