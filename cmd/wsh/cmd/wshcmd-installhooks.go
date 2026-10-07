// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// managedHook is one (event, matcher) hook arcterm owns in the user's settings.json.
type managedHook struct {
	Event   string
	Matcher string // "" => no matcher key (matches all)
	Args    string // wsh subcommand + flags, e.g. "agent-hook", "ask", "ask --clear"
	Timeout int
	// Async runs the hook in the background, so claude does not wait for it. Only the two reports that
	// fire on every tool call take it: the rest fire once a turn, and a headless claude kills an async
	// hook still running at teardown, which would lose a Stop.
	Async bool
}

// order is deterministic so re-runs produce stable output
var managedHooks = []managedHook{
	{Event: "PreToolUse", Args: "agent-hook", Timeout: 10, Async: true},
	{Event: "PreToolUse", Matcher: "AskUserQuestion", Args: "ask", Timeout: 3600},
	{Event: "PostToolUse", Args: "agent-hook", Timeout: 10, Async: true},
	{Event: "PostToolUse", Matcher: "AskUserQuestion", Args: "ask --clear", Timeout: 10},
	{Event: "Notification", Args: "agent-hook", Timeout: 10},
	{Event: "Stop", Args: "agent-hook", Timeout: 10},
	{Event: "SubagentStop", Args: "agent-hook", Timeout: 10},
	{Event: "UserPromptSubmit", Args: "agent-hook", Timeout: 10},
	// a compaction reports working and its end reports idle: the wake adapter types a lead's handoff
	// /compact as a wake that working confirms, and holds later wakes until the session is back
	{Event: "PreCompact", Args: "agent-hook", Timeout: 10},
	{Event: "SessionStart", Matcher: "compact", Args: "agent-hook", Timeout: 10},
	// a compaction drops a lead's launch prompt, so its orchestration rules come back in its place
	{Event: "SessionStart", Matcher: "compact", Args: "jarvis dag rules --inject", Timeout: 15},
	// /clear opens a new transcript: report it now so the cockpit follows the new file before the next prompt
	{Event: "SessionStart", Matcher: "clear", Args: "agent-hook", Timeout: 10},
	// a resume (--resume, /resume) is silent until its next prompt: report it at its prompt, with its title
	{Event: "SessionStart", Matcher: "resume", Args: "agent-hook", Timeout: 10},
}

func managedEventOrder() []string {
	seen := map[string]bool{}
	var order []string
	for _, mh := range managedHooks {
		if !seen[mh.Event] {
			seen[mh.Event] = true
			order = append(order, mh.Event)
		}
	}
	return order
}

// managedEventScan is every event the merge and the health check must visit: the events arcterm manages
// now, then any other event already in the file. Visiting the file's own events is what lets a hook
// arcterm wrote under an event it no longer manages still be pruned — when agent-memory-hook was removed
// it took SessionEnd out of managedHooks entirely, and a scan over managedHooks alone would never
// look at the stale group again. Extras are sorted so output stays deterministic across runs.
func managedEventScan(hooks map[string]any) []string {
	order := managedEventOrder()
	managed := map[string]bool{}
	for _, e := range order {
		managed[e] = true
	}
	extra := make([]string, 0, len(hooks))
	for e := range hooks {
		if !managed[e] {
			extra = append(extra, e)
		}
	}
	sort.Strings(extra)
	return append(order, extra...)
}

// isManagedCommand reports whether a hook command string is one arcterm wrote: the first
// token's basename starts with "wsh" and the remaining args are exactly one of our
// subcommands. Path- and version-independent so app updates self-heal.
func isManagedCommand(command string) bool {
	exe, rest := splitFirstToken(command)
	if exe == "" {
		return false
	}
	base := strings.ToLower(filepath.Base(exe))
	if !strings.HasPrefix(base, "wsh") {
		return false
	}
	switch strings.TrimSpace(rest) {
	// the agent-memory-* entries name removed subcommands and stay listed so a reinstall still
	// recognizes — and therefore strips — a hook an older arcterm wrote
	case "agent-hook", "ask", "ask --clear", "jarvis dag rules --inject",
		"agent-memory-hook", "agent-memory-project", "agent-memory-project --inject":
		return true
	}
	return false
}

// splitFirstToken splits a command string into its first token (respecting a leading
// double-quoted path) and the remainder.
func splitFirstToken(command string) (string, string) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", ""
	}
	if command[0] == '"' {
		if end := strings.IndexByte(command[1:], '"'); end >= 0 {
			return command[1 : 1+end], strings.TrimSpace(command[end+2:])
		}
		return command[1:], ""
	}
	if sp := strings.IndexByte(command, ' '); sp >= 0 {
		return command[:sp], strings.TrimSpace(command[sp+1:])
	}
	return command, ""
}

func quotePath(p string) string {
	return `"` + p + `"`
}

// stableWshPath is the wsh every agent integration names: a fixed, versionless copy under ~/.arc/bin.
// The running binary is the wrong target — its name carries the version, and a rebuild, an app update,
// `task clean` or a worktree removal deletes it while every hook still names it.
func stableWshPath(home string) string {
	name := "wsh"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(home, ".arc", "bin", name)
}

//go:embed all:claude-mod all:claude-view-mod
var claudeModFS embed.FS

// claudeMods are the embedded mods' directories, written by `task sync:claudemod` from claude/arc-mod and
// claude/arc-view-mod. The view mod is its own plugin because claude never runs a plugin's render hook
// on a transcript row that plugin raised.
var claudeMods = []string{"claude-mod", "claude-view-mod"}

const claudePluginDirsVar = "CLAUDE_CODE_PLUGIN_DIRS"

// claudeModDirs is where the arcterm Claude mods are installed, in claudeMods' order: fixed and versionless
// like stableWshPath, so the CLAUDE_CODE_PLUGIN_DIRS entries naming them never go stale.
func claudeModDirs(home string) []string {
	dirs := make([]string, len(claudeMods))
	for i, name := range claudeMods {
		dirs[i] = filepath.Join(home, ".arc", name)
	}
	return dirs
}

// installClaudeMod writes the embedded mods into claudeModDirs with the wsh path substituted. A file
// whose bytes already match is left alone: every interactive claude session watches its plugin
// folders and reloads the mod on a write, so rewriting on every arcterm launch would reload it everywhere.
func installClaudeMod(home, wshExe string) error {
	for i, dir := range claudeModDirs(home) {
		root := claudeMods[i]
		err := fs.WalkDir(claudeModFS, root, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			body, err := claudeModFS.ReadFile(p)
			if err != nil {
				return fmt.Errorf("reading embedded %s: %w", p, err)
			}
			want := strings.ReplaceAll(string(body), `"__WSH_PATH__"`, jsonString(wshExe))
			rel := strings.TrimPrefix(p, root+"/")
			return writeFileIfChanged(filepath.Join(dir, filepath.FromSlash(rel)), want)
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// writeFileIfChanged writes body to path through a temp file and a rename, unless path already holds it.
func writeFileIfChanged(path, body string) error {
	if cur, err := os.ReadFile(path); err == nil && string(cur) == body {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replacing %s: %w", path, err)
	}
	return nil
}

func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// mergeClaudePluginDirs returns a copy of existing whose env.CLAUDE_CODE_PLUGIN_DIRS lists each of modDirs
// once, last, after the user's own entries in their order. Claude reads that variable from the user
// settings' env block and loads each folder as --plugin-dir, which covers every launch without touching any.
func mergeClaudePluginDirs(existing map[string]any, modDirs ...string) map[string]any {
	out := map[string]any{}
	if b, err := json.Marshal(existing); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	env, _ := out["env"].(map[string]any)
	if env == nil {
		env = map[string]any{}
	}
	cur, _ := env[claudePluginDirsVar].(string)
	var entries []string
	for _, e := range filepath.SplitList(cur) {
		if e != "" && !listsPath(modDirs, e) {
			entries = append(entries, e)
		}
	}
	env[claudePluginDirsVar] = strings.Join(append(entries, modDirs...), string(os.PathListSeparator))
	out["env"] = env
	return out
}

func listsPath(paths []string, want string) bool {
	for _, p := range paths {
		if samePath(p, want) {
			return true
		}
	}
	return false
}

// pluginDirsInclude reports whether env.CLAUDE_CODE_PLUGIN_DIRS already lists every one of modDirs.
func pluginDirsInclude(existing map[string]any, modDirs []string) bool {
	env, _ := existing["env"].(map[string]any)
	cur, _ := env[claudePluginDirsVar].(string)
	listed := filepath.SplitList(cur)
	for _, dir := range modDirs {
		if !listsPath(listed, dir) {
			return false
		}
	}
	return true
}

// syncStableWsh makes dst a byte-identical copy of src and leaves an identical copy untouched. The
// previous copy is renamed aside rather than overwritten because Windows refuses to overwrite an exe a
// running hook is executing, but allows renaming it.
func syncStableWsh(src, dst string) error {
	if src == dst {
		return nil
	}
	want, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("reading %s: %w", src, err)
	}
	if cur, err := os.ReadFile(dst); err == nil && bytes.Equal(cur, want) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(dst), err)
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, want, 0o755); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	old := dst + ".old"
	// a previous swap's copy may still be executing; if it cannot go, the rename below reports it
	_ = os.Remove(old)
	if _, err := os.Stat(dst); err == nil {
		if err := os.Rename(dst, old); err != nil {
			return fmt.Errorf("moving aside %s: %w", dst, err)
		}
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Rename(old, dst) // restore the previous copy so the hooks keep a binary to run
		return fmt.Errorf("replacing %s: %w", dst, err)
	}
	_ = os.Remove(old) // fails only while the previous copy is still executing; the next sync retries
	return nil
}

// resolveHookWsh returns the wsh path to write into the integrations. A failed refresh keeps an existing
// copy (stale but runnable); only with no copy at all does it fall back to the running binary.
func resolveHookWsh(exe, home string) string {
	stable := stableWshPath(home)
	err := syncStableWsh(exe, stable)
	if err == nil {
		return stable
	}
	if _, statErr := os.Stat(stable); statErr == nil {
		fmt.Fprintf(os.Stderr, "keeping the existing %s (refresh failed: %v)\n", stable, err)
		return stable
	}
	fmt.Fprintf(os.Stderr, "naming %s in the hooks (no stable copy: %v)\n", exe, err)
	return exe
}

func buildManagedGroup(mh managedHook, wshExe string) map[string]any {
	hook := map[string]any{
		"type":    "command",
		"command": quotePath(wshExe) + " " + mh.Args,
		"timeout": mh.Timeout,
	}
	if mh.Async {
		hook["async"] = true
	}
	group := map[string]any{"hooks": []any{hook}}
	if mh.Matcher != "" {
		group["matcher"] = mh.Matcher
	}
	return group
}

func groupIsManaged(group any) bool {
	gm, ok := group.(map[string]any)
	if !ok {
		return false
	}
	hs, ok := gm["hooks"].([]any)
	if !ok {
		return false
	}
	for _, h := range hs {
		hm, ok := h.(map[string]any)
		if !ok {
			continue
		}
		if c, ok := hm["command"].(string); ok && isManagedCommand(c) {
			return true
		}
	}
	return false
}

// managedHookAsync is whether arcterm writes the (event, matcher, args) hook as a background one.
func managedHookAsync(event, matcher, args string) bool {
	for _, mh := range managedHooks {
		if mh.Event == event && mh.Matcher == matcher && mh.Args == args {
			return mh.Async
		}
	}
	return false
}

// mergeAgentHooks returns a copy of existing with arcterm's managed hook entries added or
// refreshed, preserving every other key and every non-managed hook group.
func mergeAgentHooks(existing map[string]any, wshExe string) map[string]any {
	// deep copy via round-trip so the caller's map is never mutated
	out := map[string]any{}
	if b, err := json.Marshal(existing); err == nil {
		_ = json.Unmarshal(b, &out)
	}

	hooks, _ := out["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
		out["hooks"] = hooks
	}

	for _, event := range managedEventScan(hooks) {
		var kept []any
		if groups, ok := hooks[event].([]any); ok {
			for _, g := range groups {
				if !groupIsManaged(g) {
					kept = append(kept, g)
				}
			}
		}
		for _, mh := range managedHooks {
			if mh.Event == event {
				kept = append(kept, buildManagedGroup(mh, wshExe))
			}
		}
		// an event left with nothing loses its key rather than becoming null/[]
		if len(kept) == 0 {
			delete(hooks, event)
			continue
		}
		hooks[event] = kept
	}
	return out
}

// isManagedStatusLine reports whether a statusLine command is arcterm's wrapper: first token's
// basename starts with "wsh" and the remainder begins with "statusline". Path/version-independent.
func isManagedStatusLine(command string) bool {
	exe, rest := splitFirstToken(command)
	if exe == "" {
		return false
	}
	if !strings.HasPrefix(strings.ToLower(filepath.Base(exe)), "wsh") {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(rest), "statusline")
}

func encodeInner(inner string) string {
	return base64.StdEncoding.EncodeToString([]byte(inner))
}

func decodeInner(b64 string) string {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return ""
	}
	return string(data)
}

// recoverInner extracts the base64 --inner= value from a managed statusLine command, decoded
// back to the user's original command (empty string if none / unparseable).
func recoverInner(command string) string {
	_, rest := splitFirstToken(command)
	for _, f := range strings.Fields(strings.TrimSpace(rest)) {
		if strings.HasPrefix(f, "--inner=") {
			return decodeInner(strings.TrimPrefix(f, "--inner="))
		}
	}
	return ""
}

// mergeStatusLine returns a copy of existing with statusLine.command wrapped by arcterm's
// "wsh statusline --inner=<b64>", carrying the user's original command so their terminal
// statusline display is unchanged. Idempotent: re-wrapping recovers the original instead of nesting.
func mergeStatusLine(existing map[string]any, wshExe string) map[string]any {
	out := map[string]any{}
	if b, err := json.Marshal(existing); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	sl, _ := out["statusLine"].(map[string]any)
	if sl == nil {
		sl = map[string]any{}
	}
	inner := ""
	if cur, _ := sl["command"].(string); cur != "" {
		if isManagedStatusLine(cur) {
			inner = recoverInner(cur)
		} else {
			inner = cur
		}
	}
	sl["type"] = "command"
	sl["command"] = quotePath(wshExe) + " statusline --inner=" + encodeInner(inner)
	out["statusLine"] = sl
	return out
}

// claudeModsMinVersion is the first Claude Code build the arcterm mod was verified on. At or above it the
// mod reports usage and the statusLine wrapper is retired; below it the wrapper stays.
var claudeModsMinVersion = [3]int{2, 1, 287}

const claudeVersionTimeout = 10 * time.Second

// claudeVersionOutput is a var so tests can stand in for the installed claude.
var claudeVersionOutput = func() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), claudeVersionTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "claude", "--version").Output()
	return string(out), err
}

var claudeVersionRe = regexp.MustCompile(`^\s*(\d+)\.(\d+)\.(\d+)`)

func parseClaudeVersion(s string) ([3]int, bool) {
	m := claudeVersionRe.FindStringSubmatch(s)
	if m == nil {
		return [3]int{}, false
	}
	var v [3]int
	for i := range v {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return [3]int{}, false
		}
		v[i] = n
	}
	return v, true
}

// claudeSupportsMods reports whether the installed claude loads the arcterm mod. No claude, or a version
// that does not parse, keeps the wrapper: a dark usage readout is worse than a wrapped status line.
func claudeSupportsMods() bool {
	out, err := claudeVersionOutput()
	if err != nil {
		return false
	}
	v, ok := parseClaudeVersion(out)
	if !ok {
		return false
	}
	for i := range v {
		if v[i] != claudeModsMinVersion[i] {
			return v[i] > claudeModsMinVersion[i]
		}
	}
	return true
}

// unwrapStatusLine returns a copy of existing with arcterm's statusLine wrapper removed: the user's original
// command restored, or statusLine dropped when arcterm had added it with none. A statusLine arcterm does not
// manage is left alone.
func unwrapStatusLine(existing map[string]any) map[string]any {
	out := map[string]any{}
	if b, err := json.Marshal(existing); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	sl, _ := out["statusLine"].(map[string]any)
	cur, _ := sl["command"].(string)
	if !isManagedStatusLine(cur) {
		return out
	}
	if inner := recoverInner(cur); inner != "" {
		sl["command"] = inner
	} else {
		delete(out, "statusLine")
	}
	return out
}

// configIsHealthy reports whether existing already carries arcterm's full managed hook set and, unless
// modsSupported (then no wrapper at all), managed statusLine, all naming wantExe — the path this
// install would write. When true the install skips its
// rewrite, so a working config is not rewritten every launch. A config naming any other binary (a
// versioned build a rebuild will delete, or one already gone) returns false and the caller rewrites it.
func configIsHealthy(existing map[string]any, wantExe string, modDirs []string, modsSupported bool) bool {
	hooks, _ := existing["hooks"].(map[string]any)
	if hooks == nil {
		return false
	}
	count := 0
	for _, event := range managedEventScan(hooks) {
		groups, _ := hooks[event].([]any)
		for _, g := range groups {
			gm, ok := g.(map[string]any)
			if !ok {
				continue
			}
			hs, _ := gm["hooks"].([]any)
			for _, h := range hs {
				hm, ok := h.(map[string]any)
				if !ok {
					continue
				}
				c, _ := hm["command"].(string)
				if !isManagedCommand(c) {
					continue
				}
				exe, rest := splitFirstToken(c)
				if exe != wantExe {
					return false
				}
				// a hook written before its async flag changed is rewritten, like one naming an old binary
				matcher, _ := gm["matcher"].(string)
				if async, _ := hm["async"].(bool); async != managedHookAsync(event, matcher, strings.TrimSpace(rest)) {
					return false
				}
				count++
			}
		}
	}
	if count != len(managedHooks) {
		return false
	}
	if !pluginDirsInclude(existing, modDirs) {
		return false
	}
	sl, _ := existing["statusLine"].(map[string]any)
	slc, _ := sl["command"].(string)
	if modsSupported {
		return !isManagedStatusLine(slc)
	}
	if !isManagedStatusLine(slc) {
		return false
	}
	exe, _ := splitFirstToken(slc)
	return exe == wantExe
}

//go:embed opencode-plugin.js
var opencodePluginTemplate string

// opencodeLookPath is a var so tests can simulate a machine with or without opencode installed.
var opencodeLookPath = exec.LookPath

//go:embed pi-status-extension.ts
var piStatusExtensionTemplate string

//go:embed pi-tools-extension.ts
var piToolsExtensionTemplate string

//go:embed pi-tools-core-extension.ts
var piToolsCoreExtensionTemplate string

//go:embed pi-ask-extension.ts
var piAskExtensionTemplate string

//go:embed pi-ask-core-extension.ts
var piAskCoreExtensionTemplate string

//go:embed pi-prose-core-extension.ts
var piProseCoreExtensionTemplate string

//go:embed pi-simplify-gate-extension.ts
var piSimplifyGateExtensionTemplate string

//go:embed pi-simplify-gate-core-extension.ts
var piSimplifyGateCoreExtensionTemplate string

//go:embed arc-theme.json
var arcThemeTemplate string

// piLookPath is a var so tests can simulate a machine with or without pi installed.
var piLookPath = exec.LookPath

// jsonString marshals s as a JSON string literal (escapes backslashes/quotes) for substitution
// into the plugin's WSH constant.
func jsonString(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `""`
	}
	return string(b)
}

// installOpencodePlugin writes the Wave status plugin into opencode's global plugin directory
// (~/.config/opencode/plugins/), where opencode auto-loads every file. No-op when opencode is not
// installed. Idempotent: rewrites only when the installed copy differs (the wsh path changes when
// the app install moves), so re-running on every launch self-heals without churn.
func installOpencodePlugin(home, wshExe string) error {
	if _, err := opencodeLookPath("opencode"); err != nil {
		return nil // opencode not installed; nothing to hook
	}
	want := strings.ReplaceAll(opencodePluginTemplate, "__WSH_PATH__", jsonString(wshExe))
	dir := filepath.Join(home, ".config", "opencode", "plugins")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	path := filepath.Join(dir, "waveterm-status.js")
	if cur, err := os.ReadFile(path); err == nil && string(cur) == want {
		return nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(want), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replacing %s: %w", path, err)
	}
	fmt.Printf("installed opencode status plugin into %s\n", path)
	return nil
}

// installPiStatusExtension writes the Wave status extension into pi's global extension directory
// (~/.pi/agent/extensions/), where pi auto-loads every file. No-op when pi is not installed.
// Idempotent: rewrites only when the installed copy differs (the wsh path changes when the app
// install moves), so re-running on every launch self-heals without churn. Mirrors the OpenCode
// installer: the complete quoted "__WSH_PATH__" placeholder is replaced with a JSON string literal
// of the current wsh executable path.
func installPiStatusExtension(home, wshExe string) error {
	if _, err := piLookPath("pi"); err != nil {
		return nil // pi not installed; nothing to hook
	}
	want := strings.ReplaceAll(piStatusExtensionTemplate, `"__WSH_PATH__"`, jsonString(wshExe))
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	path := filepath.Join(dir, "waveterm-status.ts")
	if cur, err := os.ReadFile(path); err == nil && string(cur) == want {
		return nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(want), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replacing %s: %w", path, err)
	}
	fmt.Printf("installed pi status extension into %s\n", path)
	return nil
}

// installPiToolsExtension writes the Wave tools + steering extension pair into pi's global
// extension directory, where pi auto-loads every file. Same contract as
// installPiStatusExtension: __WSH_PATH__ is replaced with the absolute wsh exe path.
func installPiToolsExtension(home, wshExe string) error {
	if _, err := piLookPath("pi"); err != nil {
		return nil // pi not installed; nothing to hook
	}
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating pi extensions dir: %w", err)
	}
	tools := strings.ReplaceAll(piToolsExtensionTemplate, `"__WSH_PATH__"`, jsonString(wshExe))
	if err := os.WriteFile(filepath.Join(dir, "waveterm-tools.ts"), []byte(tools), 0o644); err != nil {
		return fmt.Errorf("writing waveterm-tools.ts: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "waveterm-tools-core.ts"), []byte(piToolsCoreExtensionTemplate), 0o644); err != nil {
		return fmt.Errorf("writing waveterm-tools-core.ts: %w", err)
	}
	return nil
}

// installPiAskExtension writes the Wave ask-bridge extension pair into pi's global extension
// directory, where pi auto-loads every file. Same contract as installPiToolsExtension:
// __WSH_PATH__ is replaced with the absolute wsh exe path on the tool file; the core module
// has no placeholder.
func installPiAskExtension(home, wshExe string) error {
	if _, err := piLookPath("pi"); err != nil {
		return nil // pi not installed; nothing to hook
	}
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating pi extensions dir: %w", err)
	}
	tool := strings.ReplaceAll(piAskExtensionTemplate, `"__WSH_PATH__"`, jsonString(wshExe))
	if err := os.WriteFile(filepath.Join(dir, "waveterm-ask.ts"), []byte(tool), 0o644); err != nil {
		return fmt.Errorf("writing waveterm-ask.ts: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "waveterm-ask-core.ts"), []byte(piAskCoreExtensionTemplate), 0o644); err != nil {
		return fmt.Errorf("writing waveterm-ask-core.ts: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "waveterm-prose-core.ts"), []byte(piProseCoreExtensionTemplate), 0o644); err != nil {
		return fmt.Errorf("writing waveterm-prose-core.ts: %w", err)
	}
	return nil
}

// installPiSimplifyGateExtension writes the pi-simplify commit gate pair into pi's global extension
// directory, where pi auto-loads every file. Unlike the status/tools/ask pairs these templates carry
// no __WSH_PATH__ placeholder (the gate shells out to git itself), so the authored bytes embed
// verbatim. Same contract as installPiStatusExtension: skips when pi is absent, rewrites only the
// files that changed so a no-op reinstall preserves mtime.
func installPiSimplifyGateExtension(home string) error {
	if _, err := piLookPath("pi"); err != nil {
		return nil // pi not installed; nothing to hook
	}
	dir := filepath.Join(home, ".pi", "agent", "extensions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating pi extensions dir: %w", err)
	}
	write := func(name, want string) error {
		path := filepath.Join(dir, name)
		if cur, err := os.ReadFile(path); err == nil && string(cur) == want {
			return nil
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, []byte(want), 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", tmp, err)
		}
		if err := os.Rename(tmp, path); err != nil {
			return fmt.Errorf("replacing %s: %w", path, err)
		}
		return nil
	}
	if err := write("waveterm-simplify-gate.ts", piSimplifyGateExtensionTemplate); err != nil {
		return err
	}
	return write("waveterm-simplify-gate-core.ts", piSimplifyGateCoreExtensionTemplate)
}

// removeStalePiMemoryExtension deletes the waveterm-memory.ts an older arcterm installed. pi auto-loads
// every file in its extensions dir, so leaving it there keeps registering tools that shell out to a
// `wsh memory` subcommand that no longer exists. Absent file, or pi not installed, is a no-op.
func removeStalePiMemoryExtension(home string) error {
	if _, err := piLookPath("pi"); err != nil {
		return nil // pi not installed; nothing to clean up
	}
	path := filepath.Join(home, ".pi", "agent", "extensions", "waveterm-memory.ts")
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("removing stale %s: %w", path, err)
	}
	fmt.Printf("removed stale pi memory extension %s\n", path)
	return nil
}

// installPiTheme writes the arc theme into pi's global theme directory (~/.pi/agent/themes/), where
// pi hot-reloads custom theme files. No-op when pi is not installed. Idempotent: rewrites only when
// the installed copy differs (self-heals if the user edits it away; their edits to a present file
// are respected because the rewrite compares against the authored template).
func installPiTheme(home string) error {
	if _, err := piLookPath("pi"); err != nil {
		return nil // pi not installed; nothing to hook
	}
	dir := filepath.Join(home, ".pi", "agent", "themes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	path := filepath.Join(dir, "arc.json")
	if cur, err := os.ReadFile(path); err == nil && string(cur) == arcThemeTemplate {
		return nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(arcThemeTemplate), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replacing %s: %w", path, err)
	}
	fmt.Printf("installed pi arc theme into %s\n", path)
	return nil
}

// arcPackageEntry is the settings.packages entry provisioning adds so pi loads the arc package
// (extensions/skills/prompts/themes declared in the pi manifest).
const arcPackageEntry = "git:github.com/kaeltran16/waveterm"

// mergePiSettingsDefaults writes pi settings defaults only when keys are absent: the arc theme and
// the arc package entry. provider/model/thinking defaults are deliberately not written (arc defines
// no canonical values; pi's built-ins apply on fresh installs). Never clobbers existing values.
// Returns what was installed and what was skipped for the idempotent report.
func mergePiSettingsDefaults(home string) (installed []string, skipped []string, err error) {
	path := filepath.Join(home, ".pi", "agent", "settings.json")
	settings := map[string]any{}
	if b, rerr := os.ReadFile(path); rerr == nil && len(strings.TrimSpace(string(b))) > 0 {
		if uerr := json.Unmarshal(b, &settings); uerr != nil {
			return nil, nil, fmt.Errorf("parsing %s: %w", path, uerr)
		}
	}
	if _, ok := settings["theme"]; !ok {
		settings["theme"] = "arc"
		installed = append(installed, "theme")
	} else {
		skipped = append(skipped, "theme")
	}
	if pkgs, _ := settings["packages"].([]any); !containsString(pkgs, arcPackageEntry) {
		settings["packages"] = append(pkgs, arcPackageEntry)
		installed = append(installed, "packages")
	} else {
		skipped = append(skipped, "packages")
	}
	out, merr := json.MarshalIndent(settings, "", "  ")
	if merr != nil {
		return nil, nil, fmt.Errorf("encoding settings: %w", merr)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, nil, fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(out, '\n'), 0o644); err != nil {
		return nil, nil, fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return nil, nil, fmt.Errorf("replacing %s: %w", path, err)
	}
	return installed, skipped, nil
}

func containsString(items []any, want string) bool {
	for _, it := range items {
		if s, ok := it.(string); ok && s == want {
			return true
		}
	}
	return false
}

// installPiKeybindings writes a minimal arc-aligned keybindings.json only when no user file exists.
// User bindings always win; the four entries mirror the known-good pi 0.84.1 ids (editor history +
// alt-screen navigation). A model-picker binding is deferred until pi's binding id is confirmed.
func installPiKeybindings(home string) (bool, error) {
	path := filepath.Join(home, ".pi", "agent", "keybindings.json")
	if _, err := os.Stat(path); err == nil {
		return false, nil // user file exists; never merge over it
	}
	content := `{
  "tui.editor.historyPrevious": "up",
  "tui.editor.historyNext": "down",
  "tui.altScreen.top": "ctrl+home",
  "tui.altScreen.bottom": "ctrl+end"
}
`
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		return false, fmt.Errorf("writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return false, fmt.Errorf("replacing %s: %w", path, err)
	}
	fmt.Printf("installed pi arc keybindings into %s\n", path)
	return true, nil
}

var installAgentHooksCmd = &cobra.Command{
	Use:                   "install-agent-hooks",
	Short:                 "install arcterm's Claude Code hooks into ~/.claude/settings.json (idempotent)",
	Args:                  cobra.NoArgs,
	RunE:                  installAgentHooksRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(installAgentHooksCmd)
}

func installAgentHooksRun(cmd *cobra.Command, args []string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolving home dir: %w", err)
	}
	dir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	path := filepath.Join(dir, "settings.json")

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving wsh path: %w", err)
	}
	wsh := resolveHookWsh(exe, home)
	modDirs := claudeModDirs(home)
	// the files land before settings name their folders, so no claude launch loads a missing mod
	if err := installClaudeMod(home, wsh); err != nil {
		return err
	}

	existing := map[string]any{}
	if b, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(b))) > 0 {
		if err := json.Unmarshal(b, &existing); err != nil {
			return fmt.Errorf("parsing %s: %w", path, err)
		}
	}

	modsSupported := claudeSupportsMods()
	if configIsHealthy(existing, wsh, modDirs, modsSupported) {
		fmt.Printf("arcterm agent hooks already installed in %s (skipping)\n", path)
	} else {
		merged := mergeAgentHooks(existing, wsh)
		if modsSupported {
			merged = unwrapStatusLine(merged)
		} else {
			merged = mergeStatusLine(merged, wsh)
		}
		merged = mergeClaudePluginDirs(merged, modDirs...)
		out, err := json.MarshalIndent(merged, "", "  ")
		if err != nil {
			return fmt.Errorf("encoding settings: %w", err)
		}

		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, append(out, '\n'), 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", tmp, err)
		}
		if err := os.Rename(tmp, path); err != nil {
			return fmt.Errorf("replacing %s: %w", path, err)
		}
		fmt.Printf("installed arcterm agent hooks into %s\n", path)
	}
	if err := installOpencodePlugin(home, wsh); err != nil {
		return err
	}
	if err := installPiStatusExtension(home, wsh); err != nil {
		return err
	}
	if err := installPiToolsExtension(home, wsh); err != nil {
		return err
	}
	if err := installPiAskExtension(home, wsh); err != nil {
		return err
	}
	if err := installPiSimplifyGateExtension(home); err != nil {
		return err
	}
	if err := removeStalePiMemoryExtension(home); err != nil {
		return err
	}
	if err := installPiTheme(home); err != nil {
		return err
	}
	// settings defaults + keybindings are pi config; skip entirely when pi is absent (the extension
	// and theme installers above self-gate the same way)
	if _, perr := piLookPath("pi"); perr == nil {
		installed, skipped, err := mergePiSettingsDefaults(home)
		if err != nil {
			return err
		}
		kbInstalled, err := installPiKeybindings(home)
		if err != nil {
			return err
		}
		fmt.Printf("pi settings: installed %v, skipped %v\n", installed, skipped)
		if kbInstalled {
			fmt.Println("pi keybindings: installed (no existing file)")
		} else {
			fmt.Println("pi keybindings: skipped (user file present)")
		}
	}
	return nil
}
