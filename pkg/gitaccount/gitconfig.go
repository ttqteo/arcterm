// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	blockBegin    = "# >>> arcterm git accounts: managed by arcterm, edits here are overwritten >>>"
	blockEnd      = "# <<< arcterm git accounts <<<"
	accountHeader = "# managed by arcterm"
	keepBackups   = 20
	gitTimeout    = 30 * time.Second
)

func homeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("finding the home folder: %w", err)
	}
	return home, nil
}

// runGit is the one way this package runs git: prompts off, stderr in the error. The error names the subcommand and
// never the arguments (a fix passes a URL that holds a token) or stdin (the token a store call carries).
func runGit(dir string, extraEnv []string, stdin string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never"), extraEnv...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return stdout.String(), fmt.Errorf("git %s: %w: %s", subcommand(args), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

func subcommand(args []string) string {
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "-c" || a == "-C":
			i++
		case strings.HasPrefix(a, "-"):
		default:
			return a
		}
	}
	return ""
}

// gitExit is the exit code of a git that ran and failed, -1 for anything else (git missing, a timeout).
func gitExit(err error) int {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

// gitConfigValue reads one value; a missing key is "" and nil.
func gitConfigValue(scope, key string) (string, error) {
	home, err := homeDir()
	if err != nil {
		return "", err
	}
	out, err := runGit(home, nil, "", "config", scope, "--get", key)
	if gitExit(err) == 1 {
		return "", nil
	}
	return strings.TrimSpace(out), err
}

// ---- helpers (credential.helper) ----

const helperKeys = `^credential\.(https://github\.com\.)?helper$`

// effectiveHelpers is the helper list git runs for github.com, empty-value resets applied in order. With stripBlock it
// reads ~/.gitconfig as it would be without arcterm's block (GIT_CONFIG_GLOBAL, so the XDG global file is not read
// then): what Fix saves, to put back after the block's reset.
func effectiveHelpers(stripBlock bool) ([]string, error) {
	home, err := homeDir()
	if err != nil {
		return nil, err
	}
	var env []string
	if stripBlock {
		raw, err := os.ReadFile(filepath.Join(home, ".gitconfig"))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		stripped, _, err := stripBlockText(string(raw))
		if err != nil {
			return nil, err
		}
		tmp, err := os.CreateTemp("", "arcterm-gitconfig-*")
		if err != nil {
			return nil, err
		}
		defer os.Remove(tmp.Name())
		_, werr := io.WriteString(tmp, stripped)
		if cerr := tmp.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			return nil, werr
		}
		env = []string{"GIT_CONFIG_GLOBAL=" + tmp.Name()}
	}
	out, err := runGit(home, env, "", "config", "-z", "--get-regexp", helperKeys)
	if gitExit(err) == 1 {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var values []string
	for _, rec := range strings.Split(out, "\x00") {
		if rec == "" {
			continue
		}
		_, v, _ := strings.Cut(rec, "\n")
		values = append(values, v)
	}
	return applyResets(values), nil
}

// applyResets folds a helper list the way git does: an empty value clears what came before.
func applyResets(values []string) []string {
	var out []string
	for _, v := range values {
		if strings.TrimSpace(v) == "" {
			out = nil
			continue
		}
		out = append(out, v)
	}
	return out
}

func helperName(h string) string {
	h = strings.TrimPrefix(strings.TrimSpace(h), "!")
	if i := strings.Index(strings.ToLower(h), ".exe"); i >= 0 {
		h = h[:i] // a Windows path may hold spaces: the command ends at .exe
	} else if fields := strings.Fields(h); len(fields) > 0 {
		h = fields[0]
	} else {
		return ""
	}
	name := filepath.Base(strings.ReplaceAll(h, "\\", "/"))
	name = strings.TrimPrefix(name, "git-")
	return strings.TrimPrefix(name, "credential-")
}

// keepHelpers is the list Fix saves: resets applied in order, the `store` family dropped (a global store helper no
// longer runs for github.com, and `store` stays for other hosts).
func keepHelpers(values []string) []string {
	kept := []string{}
	for _, h := range applyResets(values) {
		if helperName(h) != "store" {
			kept = append(kept, h)
		}
	}
	return kept
}

// ---- render ----

// render writes every file from cfg: the account files first (the block's includes never dangle), then the block,
// then the account files of logins that are gone.
func render(cfg config, b *backup) error {
	home, err := homeDir()
	if err != nil {
		return err
	}
	for _, a := range cfg.Accounts {
		if err := writeAccountFile(home, a, b); err != nil {
			return err
		}
	}
	if err := rewriteGitconfig(home, cfg, b); err != nil {
		return err
	}
	return removeStaleAccountFiles(home, cfg)
}

func accountFilePath(home, login string) string { return filepath.Join(home, ".gitconfig-"+login) }

// quote is git-config's double-quoted form, for values and subsection names.
func quote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func accountFileText(a account) string {
	var sb strings.Builder
	sb.WriteString(accountHeader + "\n")
	sb.WriteString("[user]\n\tname = " + quote(a.Name) + "\n\temail = " + quote(a.Email) + "\n")
	sb.WriteString("[credential \"https://github.com\"]\n\thelper =\n\thelper = " + quote(osHelper) + "\n\tusername = " + quote(a.Login) + "\n")
	return sb.String()
}

func writeAccountFile(home string, a account, b *backup) error {
	path := accountFilePath(home, a.Login)
	want := accountFileText(a)
	have, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		if string(have) == want {
			return nil
		}
		if !strings.HasPrefix(string(have), accountHeader+"\n") {
			if err := b.save("gitconfig-"+a.Login, path); err != nil {
				return err
			}
		}
	}
	return writeFileAtomic(path, []byte(want), 0o644)
}

func removeStaleAccountFiles(home string, cfg config) error {
	files, err := filepath.Glob(filepath.Join(home, ".gitconfig-*"))
	if err != nil {
		return err
	}
	live := map[string]bool{}
	for _, a := range cfg.Accounts {
		live[accountFilePath(home, a.Login)] = true
	}
	for _, f := range files {
		if live[f] {
			continue
		}
		raw, err := os.ReadFile(f)
		if err != nil || !strings.HasPrefix(string(raw), accountHeader+"\n") {
			continue // not ours, or not a file
		}
		if err := os.Remove(f); err != nil {
			return err
		}
	}
	return nil
}

func blockText(cfg config, home string) string {
	var sb strings.Builder
	sb.WriteString(blockBegin + "\n")
	if cfg.GithubHelpers != nil || cfg.DefaultLogin != "" {
		sb.WriteString("[credential \"https://github.com\"]\n")
		if cfg.GithubHelpers != nil {
			sb.WriteString("\thelper =\n")
			for _, h := range cfg.GithubHelpers {
				sb.WriteString("\thelper = " + quote(h) + "\n")
			}
		}
		if cfg.DefaultLogin != "" {
			sb.WriteString("\tusername = " + quote(cfg.DefaultLogin) + "\n")
		}
	}
	for _, a := range cfg.Accounts {
		file := filepath.ToSlash(accountFilePath(home, a.Login))
		for _, root := range a.Roots {
			dir := strings.TrimSuffix(filepath.ToSlash(root), "/") + "/"
			sb.WriteString("[includeIf " + quote("gitdir/i:"+dir) + "]\n\tpath = " + quote(file) + "\n")
		}
	}
	sb.WriteString(blockEnd + "\n")
	return sb.String()
}

// stripBlockText removes arcterm's block, markers included. A begin marker with no end is an error: cutting to the
// end of the file would delete the person's lines.
func stripBlockText(content string) (string, bool, error) {
	var out strings.Builder
	in, found := false, false
	for _, line := range strings.SplitAfter(content, "\n") {
		trimmed := strings.TrimRight(line, "\r\n")
		switch {
		case !in && trimmed == blockBegin:
			in, found = true, true
		case in && trimmed == blockEnd:
			in = false
		case !in:
			out.WriteString(line)
		}
	}
	if in {
		return "", false, errors.New("~/.gitconfig has arcterm's begin marker but no end marker: fix or remove the block by hand")
	}
	return out.String(), found, nil
}

func rewriteGitconfig(home string, cfg config, b *backup) error {
	path := filepath.Join(home, ".gitconfig")
	raw, err := os.ReadFile(path)
	existed := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	content, _, err := stripBlockText(string(raw))
	if err != nil {
		return err
	}
	if len(cfg.Accounts) > 0 {
		if content != "" && !strings.HasSuffix(content, "\n") {
			content += "\n"
		}
		content += blockText(cfg, home)
	}
	if existed && content == string(raw) {
		return nil
	}
	if !existed && content == "" {
		return nil
	}
	if err := b.save("gitconfig", path); err != nil {
		return err
	}
	return writeFileAtomic(path, []byte(content), 0o644)
}

// writeFileAtomic replaces path through a temp file and a rename. A symlink (dotfiles managers link ~/.gitconfig) is
// followed, so the link survives, and an existing file keeps its mode.
func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	if st, err := os.Stat(path); err == nil {
		mode = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(data)
	if cerr := tmp.Close(); werr == nil {
		werr = cerr
	}
	if werr == nil {
		werr = os.Chmod(tmp.Name(), mode)
	}
	if werr == nil {
		werr = os.Rename(tmp.Name(), path)
	}
	if werr != nil {
		os.Remove(tmp.Name())
	}
	return werr
}

// ---- backups ----

// backup is one operation's folder, <backup dir>/<YYYYMMDD-HHMMSS>/, made when the first file is saved into it.
type backup struct{ dir string }

func (b *backup) save(rel, src string) error {
	data, err := os.ReadFile(src)
	if errors.Is(err, os.ErrNotExist) {
		return nil // nothing to lose
	}
	if err != nil {
		return err
	}
	if b.dir == "" {
		if err := b.open(); err != nil {
			return err
		}
	}
	dst := filepath.Join(b.dir, rel)
	if _, err := os.Stat(dst); err == nil {
		return nil // the first copy in an operation is the original: a later step must not replace it
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(dst, data, 0o600); err != nil {
		return fmt.Errorf("backing up %s: %w", src, err)
	}
	return nil
}

func (b *backup) open() error {
	root := backupDir()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	stamp := time.Now().Format("20060102-150405")
	for n := 1; ; n++ {
		dir := filepath.Join(root, stamp)
		if n > 1 {
			dir = fmt.Sprintf("%s-%d", dir, n)
		}
		err := os.Mkdir(dir, 0o755)
		if err == nil {
			b.dir = dir
			return nil
		}
		if !errors.Is(err, os.ErrExist) {
			return err
		}
	}
}

// prune keeps the newest keepBackups folders, so a long-lived machine does not grow them without end.
func (b *backup) prune() {
	if b.dir == "" {
		return
	}
	root := backupDir()
	entries, err := os.ReadDir(root)
	if err != nil {
		log.Printf("[gitaccount] could not list old backups in %s: %v", root, err)
		return
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for len(names) > keepBackups {
		if err := os.RemoveAll(filepath.Join(root, names[0])); err != nil {
			log.Printf("[gitaccount] could not remove old backup %s: %v", names[0], err)
		}
		names = names[1:]
	}
}
