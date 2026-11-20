// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentedits

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// a fixed identity and session-start dates make identical inputs rebuild identical shas, and let a machine
// with no user.email build at all
const (
	synthName  = "Arc agent edits"
	synthEmail = "agent-edits@arc.invalid"
	baseMsg    = "Session start, as the agent's edits saw it"
	endMsg     = "The agent's edits"
)

var (
	ErrNotRepo   = errors.New("not a git repository")
	ErrNoCommits = errors.New("no commits yet")
)

// Checkout is the repository holding a directory.
type Checkout struct {
	Root   string // the work tree's top
	Prefix string // the directory's path below Root, forward slashes, "" or ending in "/"
	Head   string
}

// git runs git in dir; env nil inherits wavesrv's environment. The error carries git's stderr.
func git(ctx context.Context, dir string, env []string, stdin io.Reader, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = env
	cmd.Stdin = stdin
	out, err := cmd.Output()
	if err != nil {
		name := strings.Join(args, " ")
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(bytes.TrimSpace(ee.Stderr)) > 0 {
			return "", fmt.Errorf("git %s: %w: %s", name, err, bytes.TrimSpace(ee.Stderr))
		}
		return "", fmt.Errorf("git %s: %w", name, err)
	}
	return string(out), nil
}

// CheckoutOf reads dir's repository: ErrNotRepo outside one, ErrNoCommits on an unborn HEAD.
func CheckoutOf(ctx context.Context, dir string) (Checkout, error) {
	out, err := git(ctx, dir, nil, nil, "rev-parse", "--show-toplevel", "--show-prefix", "HEAD")
	if err != nil {
		inside, ierr := git(ctx, dir, nil, nil, "rev-parse", "--is-inside-work-tree")
		if ierr == nil && strings.TrimSpace(inside) == "true" {
			return Checkout{}, ErrNoCommits
		}
		return Checkout{}, ErrNotRepo
	}
	// one line per flag; the prefix line is empty at the root, so the output is not trimmed first
	ln := strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n")
	if len(ln) < 3 {
		return Checkout{}, fmt.Errorf("unexpected git rev-parse output %q", out)
	}
	return Checkout{Root: filepath.FromSlash(ln[0]), Prefix: ln[1], Head: strings.TrimSpace(ln[2])}, nil
}

// WorktreeReader reads files from the working tree at repoRoot.
func WorktreeReader(repoRoot string) Reader {
	return func(p string) ([]byte, bool, error) {
		content, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(p)))
		if errors.Is(err, os.ErrNotExist) {
			return nil, false, nil
		}
		return content, err == nil, err
	}
}

// TreeSpelling maps a repo-relative path onto the spelling rev's tree holds when the repository's
// core.ignorecase is true, so a path the agent spelled in another case reads, commits and reports as git's
// own entry. A path the tree lacks, or any path with core.ignorecase false or unset, stays as spelled.
func TreeSpelling(ctx context.Context, repoRoot, rev string) (func(string) string, error) {
	asSpelled := func(p string) string { return p }
	ic, err := git(ctx, repoRoot, nil, nil, "config", "--type=bool", "--default=false", "core.ignorecase")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(ic) != "true" {
		return asSpelled, nil
	}
	out, err := git(ctx, repoRoot, nil, nil, "ls-tree", "-r", "-z", "--name-only", rev)
	if err != nil {
		return nil, err
	}
	tree := map[string]string{}
	for p := range strings.SplitSeq(out, "\x00") {
		if p != "" {
			tree[strings.ToLower(p)] = p
		}
	}
	return func(p string) string {
		if t, ok := tree[strings.ToLower(p)]; ok {
			return t
		}
		return p
	}, nil
}

// BaseReader reads files at rev through one `cat-file --batch`, started on the first read. close ends it.
func BaseReader(ctx context.Context, repoRoot, rev string) (r Reader, close func() error) {
	c := &catFile{ctx: ctx, root: repoRoot, rev: rev}
	return c.read, c.close
}

type catFile struct {
	ctx       context.Context
	root, rev string
	cmd       *exec.Cmd
	in        io.WriteCloser
	out       *bufio.Reader
}

func (c *catFile) start() error {
	c.cmd = exec.CommandContext(c.ctx, "git", "-C", c.root, "cat-file", "--batch")
	in, err := c.cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := c.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := c.cmd.Start(); err != nil {
		return fmt.Errorf("git cat-file: %w", err)
	}
	c.in, c.out = in, bufio.NewReader(out)
	return nil
}

func (c *catFile) read(p string) ([]byte, bool, error) {
	if c.cmd == nil {
		if err := c.start(); err != nil {
			return nil, false, err
		}
	}
	if _, err := fmt.Fprintf(c.in, "%s:%s\n", c.rev, p); err != nil {
		return nil, false, fmt.Errorf("git cat-file: %w", err)
	}
	header, err := c.out.ReadString('\n')
	if err != nil {
		return nil, false, fmt.Errorf("git cat-file: %w", err)
	}
	// "<sha> <type> <size>", or "<name> missing" (and other two-field answers) when there is no object
	fields := strings.Fields(header)
	if len(fields) != 3 {
		return nil, false, nil
	}
	size, err := strconv.Atoi(fields[2])
	if err != nil {
		return nil, false, fmt.Errorf("git cat-file: bad header %q", header)
	}
	content := make([]byte, size+1) // the object plus its trailing newline
	if _, err := io.ReadFull(c.out, content); err != nil {
		return nil, false, fmt.Errorf("git cat-file: %w", err)
	}
	if fields[1] != "blob" {
		return nil, false, nil
	}
	return content[:size], true, nil
}

func (c *catFile) close() error {
	if c.cmd == nil {
		return nil
	}
	c.in.Close()
	if err := c.cmd.Wait(); err != nil {
		return fmt.Errorf("git cat-file: %w", err)
	}
	return nil
}

// BuildCommits commits the files' pre-images as B (parent: parent) and their post-images as H (parent: B),
// in a temporary index so the repository's own index and tree are untouched. The images are written to a
// temporary work tree and staged with update-index, so each blob is what `git add` would store at its path.
func BuildCommits(ctx context.Context, repoRoot, parent string, sessionStart int64, files []File) (base, end string, err error) {
	tmp, err := os.MkdirTemp("", "agentedits-*")
	if err != nil {
		return "", "", fmt.Errorf("creating the temporary index: %w", err)
	}
	defer func() {
		if rerr := os.RemoveAll(tmp); rerr != nil {
			log.Printf("agentedits: removing %s: %v", tmp, rerr)
		}
	}()
	date := fmt.Sprintf("@%d +0000", sessionStart)
	env := append(os.Environ(),
		"GIT_INDEX_FILE="+filepath.Join(tmp, "index"),
		"GIT_AUTHOR_NAME="+synthName, "GIT_AUTHOR_EMAIL="+synthEmail, "GIT_AUTHOR_DATE="+date,
		"GIT_COMMITTER_NAME="+synthName, "GIT_COMMITTER_EMAIL="+synthEmail, "GIT_COMMITTER_DATE="+date,
	)
	if _, err := git(ctx, repoRoot, env, nil, "read-tree", parent); err != nil {
		return "", "", err
	}
	// update-index refuses a work tree that does not exist, which B's step leaves when every file is new
	wt := filepath.Join(tmp, "wt")
	if err := os.Mkdir(wt, 0o755); err != nil {
		return "", "", fmt.Errorf("creating the temporary work tree: %w", err)
	}
	if base, err = commitImages(ctx, repoRoot, wt, env, files, false, parent, baseMsg); err != nil {
		return "", "", err
	}
	if end, err = commitImages(ctx, repoRoot, wt, env, files, true, base, endMsg); err != nil {
		return "", "", err
	}
	return base, end, nil
}

// commitImages writes each file's pre- or post-image into wt (removing absent ones), stages them all in one
// update-index, and commits the tree.
func commitImages(ctx context.Context, repoRoot, wt string, env []string, files []File, post bool, parent, msg string) (string, error) {
	var paths bytes.Buffer
	for _, f := range files {
		content, exists := f.Pre, f.PreExists
		if post {
			content, exists = f.Post, f.PostExists
		}
		abs := filepath.Join(wt, filepath.FromSlash(f.Path))
		if err := placeImage(abs, content, exists); err != nil {
			return "", fmt.Errorf("writing %s: %w", f.Path, err)
		}
		paths.WriteString(f.Path)
		paths.WriteByte(0)
	}
	// safecrlf would refuse an irreversible conversion; this is hashing, not a checkout to protect
	if _, err := git(ctx, repoRoot, env, &paths, "-c", "core.safecrlf=false", "--work-tree="+wt,
		"update-index", "--add", "--remove", "--replace", "-z", "--stdin"); err != nil {
		return "", err
	}
	tree, err := git(ctx, repoRoot, env, nil, "write-tree")
	if err != nil {
		return "", err
	}
	sha, err := git(ctx, repoRoot, env, nil, "commit-tree", "--no-gpg-sign", strings.TrimSpace(tree), "-p", parent, "-m", msg)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(sha), nil
}

func placeImage(abs string, content []byte, exists bool) error {
	if !exists {
		if err := os.Remove(abs); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, content, 0o644)
}
