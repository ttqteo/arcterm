# Diff surface as a Commit | Log tool window: implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **Progress:** run 57b7ed36 (2026-10-09) landed Tasks 1–7. Tasks 8–10 were paused by the human and are left for a
> later run; a later run takes only those three (re-number them, and Task 8 depends on nothing then). Task 8's
> unfinished, unreviewed attempt is kept at tag `arc/57b7ed36-t-8-wip` (`committab.tsx`, `commitstore.ts`,
> `commitrows.ts`). Task 7's review notes for them: `diff-log-tab` seeds a feature branch four commits ahead of main
> (history rows 0 = touch a and b, 1 = tweak c, 2 = tweak a, 3 = empty), and `pickFilesSource` clicks
> `[data-folded-source]` when the panel is folded, which pins `panelFoldedAtom` false, so a scenario relying on the
> width fold picks before it narrows and restores `PANEL_FOLD_KEY` in teardown.

**Goal:** Rebuild the Diff surface as one left panel (Commit | Log tabs, a source dropdown, a sync bar) beside a wide
diff. Add commit, fetch, pull and push. Make every selection show a diff at once, never `0 files` while loading.

**Architecture:** Go adds four writes to `pkg/gitinfo` (commit with `--only`, fast-forward pull, non-force push,
HEAD's message) and upstream counts on the existing change read, each behind a wshrpc command (`task generate`). The
frontend keeps its stores (`filesstore`, `githistorystore`, `comparestore`) and adds:
- pure models: `commitselection.ts`, `syncstate.ts` and the panel rules in `difflayout.ts`;
- two stores: `commitstore.ts`, `syncstore.ts`;
- thin views: `diffpanel.tsx`, `sourcepicker.tsx`, `committab.tsx`, `syncbar.tsx`.

`filessurface.tsx` loses its four-column layout, the range strip and the summary.

**Tech stack:** Go (`os/exec` git), wshrpc codegen, React 19 + jotai + Tailwind 4, vitest, CDP scenarios
(`scripts/cdp/scenarios.mjs`).

Read the spec named below first; its decision 0 (quick look) outranks the rest.

**Spec:** `docs/superpowers/specs/2026-10-09-diff-commit-log-redesign-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo ./pkg/wshrpc/...`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: diff-log-tab, diff-commit-tab, diff-sync and the Diff scenarios need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs surface-smoke diff-log-tab diff-commit-tab diff-sync diff-worktrees diff-compare git-history agent-rail-file-link line-review record-band-detach-restore`
**Prototype:** .superpowers/design/diff-commit-log/project

Board → scenario step:

| Board | Scenario step |
|---|---|
| Main | `diff-commit-tab` step 1 (the tab, and the source dropdown open) and step 2 (the toast's link) |
| Log | `diff-log-tab` step 2 (the rail's View diff: Log tab, "Since session start" selected, first file open) |
| Loading | `diff-log-tab` step 3 |
| Rail | `diff-log-tab` step 5 |
| Compare | `diff-log-tab` step 6 |
| States | `diff-commit-tab` steps 4–6 (failed, locked rows / amend, empty) and `diff-sync` steps 2–4 (diverged, confirm, publish) |

Interactions with no board of their own have steps too: `↑`/`↓` in a file list (`diff-log-tab` steps 1 and 6), the
`⋯` menu (step 7), the panel and Log split drags (step 8), `[data-file-step]` (step 5); and in the Commit list `↑`/`↓`,
`Space`, `Ctrl+Enter` and `Shift+C` (`diff-commit-tab` steps 2–3).

## Conventions for every task

- **Repo rules:** read `AGENTS.md` first. In particular:
  - never hand-edit generated files; run `task generate` after any wshrpc type change;
  - typecheck with `task check:ts`, never `npx tsc`, with a timeout above 2 min;
  - check only the files you touched with `npx eslint <paths>` / `npx prettier --check <paths>` / `gofmt -l <paths>`;
  - never run prettier on `scripts/*.mjs`.
- **Colors and design:**
  - colors come from `@theme` tokens only (`DESIGN.md`);
  - checkboxes are grey (`bg-ink-mid` when ticked); `bg-accent` is for the Commit button alone;
  - copy every size from the boards in the Prototype folder.
- **Commits:** stage files by pathspec. Other sessions share this index, so never run a bare `git commit` or `git add -A`.
- **Running a scenario** needs the dev app (`task dev`). Run only the scenarios a task names:
  `task verify:ui -- <name>`.

---

### Task 1: Upstream counts on the change read
**Depends on:** none
**Files:** `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitinfo_test.go`, `pkg/wshrpc/wshrpctypes_projects.go`, `pkg/wshrpc/wshserver/wshserver_projects.go`, `frontend/app/view/agents/filesstore.ts`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**What changes where:**
- Modify: `pkg/gitinfo/gitinfo.go` (`Changes` struct ~line 28, `GetChanges` ~line 46)
- Modify: `pkg/wshrpc/wshrpctypes_projects.go` (`CommandGitChangesRtnData`)
- Modify: `pkg/wshrpc/wshserver/wshserver_projects.go` (`GitChangesCommand`)
- Modify: `frontend/app/view/agents/filesstore.ts` (`FilesState`, `loadChangesForCwd`)
- Test: `pkg/gitinfo/gitinfo_test.go`

**Step 1: Write the failing tests** (append to `gitinfo_test.go`)

```go
// A bare remote the repo pushes to, so @{u} resolves.
func repoWithUpstream(t *testing.T) (dir, bare string) {
	t.Helper()
	dir = repoWithChange(t)
	bare = t.TempDir()
	git(t, bare, "init", "-q", "--bare", "-b", "main")
	git(t, dir, "remote", "add", "origin", bare)
	git(t, dir, "push", "-q", "-u", "origin", "main")
	return dir, bare
}

func TestGetChangesUpstreamCounts(t *testing.T) {
	dir, _ := repoWithUpstream(t)
	git(t, dir, "commit", "-q", "--allow-empty", "-m", "local only")
	ch, err := GetChanges(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if ch.Upstream != "origin/main" || ch.UpstreamAhead != 1 || ch.UpstreamBehind != 0 {
		t.Fatalf("upstream = %q +%d -%d, want origin/main +1 -0", ch.Upstream, ch.UpstreamAhead, ch.UpstreamBehind)
	}
}

func TestGetChangesNoUpstream(t *testing.T) {
	ch, err := GetChanges(context.Background(), repoWithChange(t), "")
	if err != nil {
		t.Fatal(err)
	}
	if ch.Upstream != "" || ch.UpstreamAhead != 0 || ch.UpstreamBehind != 0 {
		t.Fatalf("want no upstream, got %q +%d -%d", ch.Upstream, ch.UpstreamAhead, ch.UpstreamBehind)
	}
}
```

**Step 2:** Run `go test ./pkg/gitinfo -run 'TestGetChanges(UpstreamCounts|NoUpstream)$'`. Expected: FAIL to compile
(`ch.Upstream undefined`).

**Step 3: Implement.**

Add the fields to `Changes`:

```go
	// HEAD's upstream ("origin/main") and how far HEAD is from it. "" when the branch has none or HEAD is
	// detached: a state the sync bar draws, not an error.
	Upstream       string
	UpstreamAhead  int
	UpstreamBehind int
```

Add the helper near `GetChanges`:

```go
// upstreamCounts names HEAD's upstream and counts the commits each side has that the other lacks.
func upstreamCounts(ctx context.Context, cwd string) (string, int, int) {
	up, err := run(ctx, cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
	if err != nil {
		return "", 0, 0
	}
	up = strings.TrimSpace(up)
	out, err := run(ctx, cwd, "rev-list", "--left-right", "--count", "@{u}...HEAD")
	f := strings.Fields(out)
	if err != nil || len(f) != 2 {
		return up, 0, 0
	}
	behind, _ := strconv.Atoi(f[0])
	ahead, _ := strconv.Atoi(f[1])
	return up, ahead, behind
}
```

In `GetChanges`, after `head` is resolved, call `up, ahead, behind := upstreamCounts(ctx, cwd)` and set the three
fields on both returned `Changes` values.

Wire type (`CommandGitChangesRtnData`):

```go
	// HEAD's upstream and the commits each side lacks; Upstream "" = none. The Diff surface's sync bar reads these
	// off the poll it already runs, so no second timer reads the repository.
	Upstream       string `json:"upstream,omitempty"`
	UpstreamAhead  int    `json:"upstreamahead,omitempty"`
	UpstreamBehind int    `json:"upstreambehind,omitempty"`
```

Pass the three fields through in `wshserver_projects.go`. Run `task generate`.

In `filesstore.ts`:
- add `upstream: string; upstreamAhead: number; upstreamBehind: number;` to `FilesState` (and to `EMPTY` as `""`, `0`, `0`);
- set them from `ch.upstream ?? ""`, `ch.upstreamahead ?? 0`, `ch.upstreambehind ?? 0`.

**Step 4:** Run the two tests again (PASS), then `node scripts/verify.mjs ./pkg/gitinfo` and `task check:ts`.

**Step 5: Commit**

```bash
git add pkg/gitinfo/gitinfo.go pkg/gitinfo/gitinfo_test.go pkg/wshrpc/wshrpctypes_projects.go pkg/wshrpc/wshserver/wshserver_projects.go frontend/app/view/agents/filesstore.ts frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts pkg/wshrpc/wshclient/wshclient.go
git commit -m "feat(gitinfo): the change read reports HEAD's upstream and how far it is from it" -- <same paths>
```

---

### Task 2: Commit with `--only`, and HEAD's message
**Depends on:** Task 1
**Files:** `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitinfo_test.go`, `pkg/wshrpc/wshrpctypes_git.go`, `pkg/wshrpc/wshserver/wshserver_git.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**What changes where:**
- Modify: `pkg/gitinfo/gitinfo.go`
- Modify: `pkg/wshrpc/wshrpctypes_git.go` (interface + types)
- Modify: `pkg/wshrpc/wshserver/wshserver_git.go`
- Test: `pkg/gitinfo/gitinfo_test.go`

**Step 1: Write the failing tests**

```go
// Commit runs git without the test env's author vars, so the repo carries its own identity.
func commitRepo(t *testing.T) string {
	t.Helper()
	dir := repoWithChange(t) // a.txt committed then modified, b.txt untracked
	git(t, dir, "config", "user.name", "t")
	git(t, dir, "config", "user.email", "t@t")
	return dir
}

func headFiles(t *testing.T, dir string) string {
	t.Helper()
	out, err := exec.Command("git", "-C", dir, "show", "--name-only", "--format=", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out))
}

func TestCommitOnlyLeavesOtherStagedPaths(t *testing.T) {
	dir := commitRepo(t)
	os.WriteFile(filepath.Join(dir, "c.txt"), []byte("staged by another session\n"), 0o644)
	git(t, dir, "add", "c.txt")
	r, err := Commit(context.Background(), dir, "edit a", []string{"a.txt"}, false)
	if err != nil || r.Failure != nil {
		t.Fatalf("commit: %v %+v", err, r)
	}
	if got := headFiles(t, dir); got != "a.txt" {
		t.Fatalf("HEAD carries %q, want only a.txt", got)
	}
	staged, _ := exec.Command("git", "-C", dir, "diff", "--cached", "--name-only").Output()
	if strings.TrimSpace(string(staged)) != "c.txt" {
		t.Fatalf("index lost another session's staging: %q", staged)
	}
}

func TestCommitAddsUntracked(t *testing.T) {
	dir := commitRepo(t)
	r, err := Commit(context.Background(), dir, "add b", []string{"b.txt"}, false)
	if err != nil || r.Failure != nil || r.Hash == "" {
		t.Fatalf("commit: %v %+v", err, r)
	}
	if got := headFiles(t, dir); got != "b.txt" {
		t.Fatalf("HEAD carries %q, want b.txt", got)
	}
}

func TestCommitRefusesAPathWithNoChange(t *testing.T) {
	dir := commitRepo(t)
	before, _ := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	r, err := Commit(context.Background(), dir, "nope", []string{"nope.txt"}, false)
	if err != nil || r.Failure == nil {
		t.Fatalf("want a Failure, got %v %+v", err, r)
	}
	after, _ := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if string(before) != string(after) {
		t.Fatal("HEAD moved on a refused commit")
	}
}

func TestCommitHookFailureIsData(t *testing.T) {
	dir := commitRepo(t)
	hook := filepath.Join(dir, ".git", "hooks", "pre-commit")
	os.WriteFile(hook, []byte("#!/bin/sh\necho 'lint failed' >&2\nexit 1\n"), 0o755)
	r, err := Commit(context.Background(), dir, "edit a", []string{"a.txt"}, false)
	if err != nil || r.Failure == nil || !strings.Contains(r.Failure.Stderr, "lint failed") {
		t.Fatalf("want the hook's words in Failure, got %v %+v", err, r)
	}
}

func TestCommitRename(t *testing.T) {
	dir := commitRepo(t)
	git(t, dir, "mv", "a.txt", "renamed.txt")
	r, err := Commit(context.Background(), dir, "rename a", []string{"renamed.txt", "a.txt"}, false)
	if err != nil || r.Failure != nil {
		t.Fatalf("commit: %v %+v", err, r)
	}
	out := gitOutT(t, dir, "show", "--name-status", "-M", "--format=", "HEAD")
	if !strings.HasPrefix(out, "R") || !strings.Contains(out, "a.txt") || !strings.Contains(out, "renamed.txt") {
		t.Fatalf("HEAD should record the rename, got %q", out)
	}
	if st := gitOutT(t, dir, "status", "--porcelain", "--", "a.txt", "renamed.txt"); st != "" {
		t.Fatalf("both ends should be committed, status %q", st)
	}
}

func TestCommitFailureUnstagesAddedPaths(t *testing.T) {
	dir := commitRepo(t)
	hook := filepath.Join(dir, ".git", "hooks", "pre-commit")
	os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0o755)
	r, err := Commit(context.Background(), dir, "add b", []string{"b.txt"}, false)
	if err != nil || r.Failure == nil {
		t.Fatalf("want a Failure, got %v %+v", err, r)
	}
	if st := gitOutT(t, dir, "status", "--porcelain", "--", "b.txt"); st != "?? b.txt" {
		t.Fatalf("a failed commit must leave b.txt untracked, status %q", st)
	}
}

// gitOutT is git's trimmed stdout, failing the test when git does.
func gitOutT(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

func TestCommitAmendRewritesHead(t *testing.T) {
	dir := commitRepo(t)
	if r, _ := Commit(context.Background(), dir, "first", []string{"a.txt"}, false); r.Failure != nil {
		t.Fatal(r.Failure.Stderr)
	}
	r, err := Commit(context.Background(), dir, "first, reworded", []string{"b.txt"}, true)
	if err != nil || r.Failure != nil {
		t.Fatalf("amend: %v %+v", err, r)
	}
	msg, _ := HeadMessage(context.Background(), dir)
	if strings.TrimSpace(msg) != "first, reworded" {
		t.Fatalf("HEAD message %q", msg)
	}
	if got := headFiles(t, dir); got != "a.txt\nb.txt" {
		t.Fatalf("amended HEAD carries %q", got)
	}
}
```

**Step 2:** Run `go test ./pkg/gitinfo -run '^TestCommit'`. Expected: FAIL (`undefined: Commit`).

**Step 3: Implement** in `gitinfo.go`:

```go
const commitTimeout = 60 * time.Second // hooks run inside it

// CommitResult is a commit's outcome. A refusal from git (a hook, a lock, nothing to commit) is data, as with Fetch:
// the surface draws git's own words.
type CommitResult struct {
	Hash    string      `json:"hash,omitempty"`
	Failure *GitFailure `json:"failure,omitempty"`
}

// runInput is run with stdin and git's whole output: a commit message travels on stdin so no quoting or argument
// limit touches it, and a hook may write its reason to either stream.
func runInput(ctx context.Context, cwd, input string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-c", "core.quotePath=false", "-C", cwd}, args...)...)
	cmd.Stdin = strings.NewReader(input)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// statusPaths reads a porcelain -z listing into the paths it names (a rename's source included) and the untracked
// ones.
func statusPaths(statusZ string) (known, untracked map[string]bool) {
	known, untracked = map[string]bool{}, map[string]bool{}
	parts := strings.Split(statusZ, "\x00")
	for i := 0; i < len(parts); i++ {
		e := parts[i]
		if len(e) < 4 {
			continue
		}
		known[e[3:]] = true
		if e[:2] == "??" {
			untracked[e[3:]] = true
		}
		if (e[0] == 'R' || e[0] == 'C') && i+1 < len(parts) {
			i++
			known[parts[i]] = true
		}
	}
	return known, untracked
}

func refused(command, why string) *CommitResult {
	return &CommitResult{Failure: &GitFailure{Command: command, ExitCode: -1, Stderr: why}}
}

// Commit records exactly paths (cwd-relative, as GetChanges lists them) with --only, so what another session
// staged for other paths stays in the index and out of this commit. Untracked paths are added first, since --only
// takes only paths git knows, and unstaged again when the commit fails. A path the status does not list, or a nested
// repository, is refused before git runs.
func Commit(ctx context.Context, cwd, message string, paths []string, amend bool) (*CommitResult, error) {
	ctx, cancel := context.WithTimeout(ctx, commitTimeout)
	defer cancel()
	if strings.TrimSpace(message) == "" {
		return refused("git commit", "the commit message is empty"), nil
	}
	if len(paths) == 0 {
		return refused("git commit", "no files are ticked"), nil
	}
	prefix, _ := run(ctx, cwd, "rev-parse", "--show-prefix")
	statusZ, err := run(ctx, cwd, "status", "--porcelain=v1", "-z", "-uall", "--", ".")
	if err != nil {
		return nil, err
	}
	known, untracked := statusPaths(stripPrefixZ(statusZ, strings.TrimSpace(prefix)))
	var add []string
	for _, p := range paths {
		if strings.HasSuffix(p, "/") {
			return refused("git commit", p+" is a nested repository; commit it in its own repository"), nil
		}
		if !known[p] {
			return refused("git commit", p+" has no uncommitted change"), nil
		}
		if untracked[p] {
			add = append(add, p)
		}
	}
	if len(add) > 0 {
		args := append([]string{"add", "--"}, add...)
		if out, err := runInput(ctx, cwd, "", args...); err != nil {
			return &CommitResult{Failure: &GitFailure{Command: "git add", ExitCode: exitCodeOf(err), Stderr: strings.TrimSpace(out)}}, nil
		}
	}
	args := []string{"commit", "--only", "-F", "-"}
	if amend {
		args = append(args, "--amend")
	}
	args = append(append(args, "--"), paths...)
	if out, err := runInput(ctx, cwd, message, args...); err != nil {
		// put the index back as it was: a path this call added must not wait, staged, for someone else's commit
		if len(add) > 0 {
			runInput(ctx, cwd, "", append([]string{"reset", "-q", "--"}, add...)...)
		}
		cmd := fmt.Sprintf("git commit --only -F - -- %d paths", len(paths))
		return &CommitResult{Failure: &GitFailure{Command: cmd, ExitCode: exitCodeOf(err), Stderr: strings.TrimSpace(out)}}, nil
	}
	hash, _ := run(ctx, cwd, "rev-parse", "--short", "HEAD")
	return &CommitResult{Hash: strings.TrimSpace(hash)}, nil
}

// HeadMessage is HEAD's whole message, which Amend loads into the box; the history read carries subjects only.
func HeadMessage(ctx context.Context, cwd string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	return run(ctx, cwd, "log", "-1", "--format=%B")
}
```

Wire it in `wshrpctypes_git.go`:
- add `GitCommitCommand(ctx, CommandGitCommitData) (*CommandGitCommitRtnData, error)` and
  `GitHeadMessageCommand(ctx, CommandGitHeadMessageData) (*CommandGitHeadMessageRtnData, error)` to `GitCommands`;
- add the types:

```go
type CommandGitCommitData struct {
	Cwd     string   `json:"cwd"`
	Message string   `json:"message"`
	Paths   []string `json:"paths"` // cwd-relative, as GitChangesCommand lists them; a rename lists both ends
	Amend   bool     `json:"amend,omitempty"`
}

// A refused commit is data (Failure), as with Fetch; the RPC errors only when git cannot be asked at all.
type CommandGitCommitRtnData struct {
	Hash    string              `json:"hash,omitempty"`
	Failure *gitinfo.GitFailure `json:"failure,omitempty"`
}

type CommandGitHeadMessageData struct {
	Cwd string `json:"cwd"`
}

type CommandGitHeadMessageRtnData struct {
	Message string `json:"message"`
}
```

Add both handlers to `wshserver_git.go` in the shape of `GitFetchCommand`. Run `task generate`.

**Step 4:** Run `go test ./pkg/gitinfo -run '^TestCommit'` (PASS), `node scripts/verify.mjs ./pkg/gitinfo ./pkg/wshrpc/...`
and `gofmt -l pkg/gitinfo pkg/wshrpc`.

**Step 5:** Commit the Go files and the generated files by pathspec:
`feat(gitinfo): commit ticked paths with --only, leaving others' staging alone`.

---

### Task 3: Pull (fast-forward only) and push (never forced)
**Depends on:** Task 2
**Files:** `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitinfo_test.go`, `pkg/wshrpc/wshrpctypes_git.go`, `pkg/wshrpc/wshserver/wshserver_git.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

**Step 1: Write the failing tests.** Besides the four below, add `TestNetCommandsFailAsData`: point a clone's
`origin` at `http://127.0.0.1:1/nope.git` and assert that `Fetch`, `Pull` and `Push` each return a `Failure` (not an
error) well inside their budgets. Nothing listens there, so no prompt can appear; the test pins all three as data.

```go
// two clones of one bare remote: a is the source the surface shows, b stands in for a colleague
func twoClones(t *testing.T) (a, b string) {
	t.Helper()
	seed, _ := repoWithUpstream(t) // pushed main to a bare origin
	bare := strings.TrimSpace(gitOut(t, seed, "remote", "get-url", "origin"))
	parent := t.TempDir()
	git(t, parent, "clone", "-q", bare, "a")
	git(t, parent, "clone", "-q", bare, "b")
	a, b = filepath.Join(parent, "a"), filepath.Join(parent, "b")
	for _, d := range []string{a, b} {
		git(t, d, "config", "user.name", "t")
		git(t, d, "config", "user.email", "t@t")
	}
	return a, b
}

func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return string(out)
}

func TestPullFastForwards(t *testing.T) {
	a, b := twoClones(t)
	git(t, b, "commit", "-q", "--allow-empty", "-m", "from b")
	git(t, b, "push", "-q")
	git(t, a, "fetch", "-q")
	r, err := Pull(context.Background(), a)
	if err != nil || r.Failure != nil || r.Moved != 1 {
		t.Fatalf("pull: %v %+v", err, r)
	}
}

func TestPullRefusesDiverged(t *testing.T) {
	a, b := twoClones(t)
	git(t, b, "commit", "-q", "--allow-empty", "-m", "from b")
	git(t, b, "push", "-q")
	git(t, a, "commit", "-q", "--allow-empty", "-m", "from a")
	before := gitOut(t, a, "rev-parse", "HEAD")
	r, err := Pull(context.Background(), a)
	if err != nil || r.Failure == nil {
		t.Fatalf("want a Failure, got %v %+v", err, r)
	}
	if gitOut(t, a, "rev-parse", "HEAD") != before {
		t.Fatal("a refused pull moved HEAD")
	}
}

func TestPushRejectedIsData(t *testing.T) {
	a, b := twoClones(t)
	git(t, b, "commit", "-q", "--allow-empty", "-m", "from b")
	git(t, b, "push", "-q")
	git(t, a, "commit", "-q", "--allow-empty", "-m", "from a")
	r, err := Push(context.Background(), a)
	if err != nil || r.Failure == nil {
		t.Fatalf("want a Failure, got %v %+v", err, r)
	}
}

func TestPushPublishesANewBranch(t *testing.T) {
	a, _ := twoClones(t)
	git(t, a, "checkout", "-q", "-b", "feature")
	git(t, a, "commit", "-q", "--allow-empty", "-m", "feature work")
	r, err := Push(context.Background(), a)
	if err != nil || r.Failure != nil {
		t.Fatalf("publish: %v %+v", err, r)
	}
	if up := strings.TrimSpace(gitOut(t, a, "rev-parse", "--abbrev-ref", "@{u}")); up != "origin/feature" {
		t.Fatalf("upstream %q", up)
	}
}
```

**Step 2:** Run `go test ./pkg/gitinfo -run '^Test(Pull|Push)'`. Expected: FAIL (`undefined: Pull`).

**Step 3: Implement**

```go
const (
	pullTimeout = 55 * time.Second
	pushTimeout = 120 * time.Second
)

// SyncResult is a pull's or push's outcome: how many commits moved, or git's refusal as data.
type SyncResult struct {
	Moved   int         `json:"moved"`
	Branch  string      `json:"branch,omitempty"`
	Failure *GitFailure `json:"failure,omitempty"`
}

// runNet is run for a command that talks to a remote (fetch, pull, push): GIT_TERMINAL_PROMPT=0 makes a missing
// credential fail at once instead of waiting on a prompt nobody can see. A credential manager's own window still
// appears. It keeps run's cmd.Output(), so failureOf finds git's stderr on the ExitError.
func runNet(ctx context.Context, cwd string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-c", "core.quotePath=false", "-C", cwd}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.Output()
	return string(out), err
}

func syncFailure(args []string, err error) *SyncResult {
	return &SyncResult{Failure: failureOf(args, err)}
}

// Pull fast-forwards to the upstream and nothing else: no merge commit, no rebase, so no conflict can leave the
// tree half-done under an agent. A diverged branch is refused with git's own words.
func Pull(ctx context.Context, cwd string) (*SyncResult, error) {
	ctx, cancel := context.WithTimeout(ctx, pullTimeout)
	defer cancel()
	up, _, behind := upstreamCounts(ctx, cwd)
	if up == "" {
		return &SyncResult{Failure: &GitFailure{Command: "git pull --ff-only", ExitCode: -1, Stderr: "this branch has no upstream to pull from"}}, nil
	}
	if _, err := runNet(ctx, cwd, "pull", "--ff-only"); err != nil {
		return syncFailure([]string{"pull", "--ff-only"}, err), nil
	}
	return &SyncResult{Moved: behind}, nil
}

// Push sends the branch to its upstream, or publishes it to origin when it has none. It never forces.
func Push(ctx context.Context, cwd string) (*SyncResult, error) {
	ctx, cancel := context.WithTimeout(ctx, pushTimeout)
	defer cancel()
	b, err := run(ctx, cwd, "rev-parse", "--abbrev-ref", "HEAD")
	branch := strings.TrimSpace(b)
	if err != nil || branch == "HEAD" || branch == "" {
		return &SyncResult{Failure: &GitFailure{Command: "git push", ExitCode: -1, Stderr: "HEAD is detached: check out a branch to push"}}, nil
	}
	up, ahead, _ := upstreamCounts(ctx, cwd)
	args := []string{"push"}
	if up == "" {
		args = []string{"push", "-u", "origin", branch}
	}
	if _, err := runNet(ctx, cwd, args...); err != nil {
		return syncFailure(args, err), nil
	}
	return &SyncResult{Moved: ahead, Branch: branch}, nil
}
```

`Fetch` (`gitinfo.go` ~line 1260) already has its 55s `fetchTimeout`, but its `git fetch` goes through `run`, so it can
wait on a credential prompt. Change that one call to `runNet(ctx, cwd, args...)`, keeping `failureOf`. Spec §3: every
sync command (Fetch, Pull, Push) runs through `runNet`, and no network git command runs any other way.

Wire it: `GitPullCommand` and `GitPushCommand` take `CommandGitSyncData{Cwd}` and return
`CommandGitSyncRtnData{Moved int "moved"; Branch string "branch,omitempty"; Failure *gitinfo.GitFailure "failure,omitempty"}`,
with a comment that the client must raise `opts.timeout` past `pullTimeout` / `pushTimeout`, as Fetch does. Add the
handlers and run `task generate`.

**Step 4:** Run the tests (PASS) and `node scripts/verify.mjs ./pkg/gitinfo ./pkg/wshrpc/...`.

**Step 5:** Commit by pathspec: `feat(gitinfo): fast-forward pull and unforced push for the Diff surface`.

---

### Task 4: Commit selection model (pure)
**Depends on:** none
**Files:** `frontend/app/view/agents/gitstatus.ts`, `frontend/app/view/agents/gitstatus.test.ts`, `frontend/app/view/agents/commitselection.ts`, `frontend/app/view/agents/commitselection.test.ts`

**What changes where:**
- Modify: `frontend/app/view/agents/gitstatus.ts` (`GitChange` gains `from?: string`; `parseStatusZ` keeps a
  rename's source)
- Create: `frontend/app/view/agents/commitselection.ts`
- Test: `frontend/app/view/agents/commitselection.test.ts`, `frontend/app/view/agents/gitstatus.test.ts`

**Step 1: Write the failing tests**

```ts
// frontend/app/view/agents/commitselection.test.ts
import { describe, expect, it } from "vitest";
import {
    NO_TICKS, amendAllowed, canCommit, commitLabel, groupTickState, isTicked, pruneTicks, setManyTicked, setTicked,
    tickedPaths,
} from "./commitselection";
import type { GitChange } from "./gitstatus";

const f = (path: string, status: string, extra: Partial<GitChange> = {}): GitChange => ({ path, status, adds: 1, dels: 0, ...extra });
const a = f("a.ts", "M");
const n = f("new.md", "?");
const repo = f("vendor/tool/", "?", { note: "repo" });
const sub = f("reference/PoCGen", "M", { note: "dirty" });
const mv = f("lib/b.ts", "R", { from: "lib/a.ts" });

describe("commit ticks", () => {
    it("ticks tracked changes and leaves untracked ones off by default", () => {
        expect(isTicked(NO_TICKS, a)).toBe(true);
        expect(isTicked(NO_TICKS, n)).toBe(false);
    });
    it("never ticks a row a commit here cannot carry", () => {
        expect(isTicked(NO_TICKS, sub)).toBe(false);
        expect(isTicked(setTicked(NO_TICKS, repo, true), repo)).toBe(false);
    });
    it("stores only exceptions, so a choice equal to the default leaves nothing behind", () => {
        const t = setTicked(setTicked(NO_TICKS, a, false), a, true);
        expect(t).toEqual(NO_TICKS);
    });
    it("prunes paths that left the list", () => {
        const t = setTicked(setTicked(NO_TICKS, a, false), n, true);
        expect(pruneTicks(t, [a])).toEqual({ off: ["a.ts"], on: [] });
    });
    it("sends both ends of a rename", () => {
        expect(tickedPaths(NO_TICKS, [a, n, mv])).toEqual(["a.ts", "lib/b.ts", "lib/a.ts"]);
    });
    it("reads a group as all, some or none over its committable rows", () => {
        expect(groupTickState(NO_TICKS, [a, sub])).toBe("all");
        expect(groupTickState(setTicked(NO_TICKS, a, false), [a, mv])).toBe("some");
        expect(groupTickState(setManyTicked(NO_TICKS, [a, mv], false), [a, mv])).toBe("none");
    });
});

describe("commit button", () => {
    it("names the count and the verb", () => {
        expect(commitLabel(1, false)).toBe("Commit 1 file");
        expect(commitLabel(3, true)).toBe("Amend with 3 files");
    });
    it("needs a message and a ticked file", () => {
        expect(canCommit("  ", 2)).toBe(false);
        expect(canCommit("fix", 0)).toBe(false);
        expect(canCommit("fix", 1)).toBe(true);
    });
    it("allows amend only while HEAD is unpushed", () => {
        expect(amendAllowed({ head: "abc", upstream: "origin/main", upstreamAhead: 0 })).toBe(false);
        expect(amendAllowed({ head: "abc", upstream: "origin/main", upstreamAhead: 2 })).toBe(true);
        expect(amendAllowed({ head: "abc", upstream: "", upstreamAhead: 0 })).toBe(true);
        expect(amendAllowed({ head: "", upstream: "", upstreamAhead: 0 })).toBe(false);
    });
});
```

In `gitstatus.test.ts`, extend the rename case: `parseGitChanges(\`R  new.ts${NUL}old.ts${NUL}\`, "0\t0\tnew.ts\n").files[0].from`
is `"old.ts"`.

**Step 2:** Run `npx vitest run frontend/app/view/agents/commitselection.test.ts frontend/app/view/agents/gitstatus.test.ts`.
Expected: FAIL (module not found).

**Step 3: Implement.**

`gitstatus.ts`:
- add `from?: string; // a rename's or copy's source path` to `GitChange`;
- in `parseStatusZ`, read `parts[i + 1]` as `from` before `i++`;
- pass `from` through in `parseGitChanges`, setting the key only when it has a value, so existing `toEqual` tests keep
  passing.

`commitselection.ts`:

```ts
// frontend/app/view/agents/commitselection.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Commit tab's ticks and its button. Ticks are kept as exceptions to the defaults, so a file that appears
// later takes its default and a file that left the list stops counting. No React.

import type { GitChange } from "./gitstatus";

export interface CommitTicks {
    off: string[]; // tracked paths the person unticked
    on: string[]; // untracked paths the person ticked
}

export const NO_TICKS: CommitTicks = { off: [], on: [] };

// a nested repository, or a submodule whose only change is inside it: a commit here cannot carry either
export function committable(f: GitChange): boolean {
    return f.note !== "repo" && f.note !== "dirty";
}

function byDefault(f: GitChange): boolean {
    return f.status !== "?";
}

export function isTicked(t: CommitTicks, f: GitChange): boolean {
    if (!committable(f)) {
        return false;
    }
    if (t.off.includes(f.path)) {
        return false;
    }
    return t.on.includes(f.path) || byDefault(f);
}

export function setTicked(t: CommitTicks, f: GitChange, on: boolean): CommitTicks {
    const next = { off: t.off.filter((p) => p !== f.path), on: t.on.filter((p) => p !== f.path) };
    if (committable(f) && on !== byDefault(f)) {
        (on ? next.on : next.off).push(f.path);
    }
    return next;
}

export function setManyTicked(t: CommitTicks, files: GitChange[], on: boolean): CommitTicks {
    return files.reduce((acc, f) => setTicked(acc, f, on), t);
}

export function pruneTicks(t: CommitTicks, files: GitChange[]): CommitTicks {
    const live = new Set(files.map((f) => f.path));
    return { off: t.off.filter((p) => live.has(p)), on: t.on.filter((p) => live.has(p)) };
}

// what GitCommitCommand receives: a rename's source travels with it, or git would keep the old path
export function tickedPaths(t: CommitTicks, files: GitChange[]): string[] {
    return files.filter((f) => isTicked(t, f)).flatMap((f) => (f.from ? [f.path, f.from] : [f.path]));
}

export function tickedCount(t: CommitTicks, files: GitChange[]): number {
    return files.filter((f) => isTicked(t, f)).length;
}

export type TickState = "all" | "some" | "none";

export function groupTickState(t: CommitTicks, files: GitChange[]): TickState {
    const rows = files.filter(committable);
    const n = rows.filter((f) => isTicked(t, f)).length;
    return n === 0 ? "none" : n === rows.length ? "all" : "some";
}

export function commitLabel(n: number, amend: boolean): string {
    return `${amend ? "Amend with" : "Commit"} ${n} ${n === 1 ? "file" : "files"}`;
}

export function canCommit(message: string, ticked: number): boolean {
    return message.trim() !== "" && ticked > 0;
}

// Amend rewrites HEAD, which is safe only while no remote has it.
export function amendAllowed(s: { head: string; upstream: string; upstreamAhead: number }): boolean {
    return s.head !== "" && (s.upstream === "" || s.upstreamAhead > 0);
}
```

**Step 4:** Run the tests again (PASS) and `npx eslint` / `npx prettier --check` on the three files.

**Step 5:** Commit by pathspec: `feat(diff): the Commit tab's tick model`.

---

### Task 5: Sync bar model (pure)
**Depends on:** none
**Files:** `frontend/app/view/agents/syncstate.ts`, `frontend/app/view/agents/syncstate.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { agentsWorkingIn, explainSyncFailure, syncView } from "./syncstate";

const base = { branch: "main", upstream: "origin/main", ahead: 2, behind: 0, running: null, fetchedAgo: "" } as const;

describe("syncView", () => {
    it("counts against the upstream and names it in the title", () => {
        const v = syncView(base);
        expect(v.counts).toBe("↑2 ↓0");
        expect(v.countsTitle).toBe("Against origin/main");
        expect(v.push.label).toBe("Push");
    });
    it("offers Publish and no Pull when the branch has no upstream", () => {
        const v = syncView({ ...base, upstream: "" });
        expect(v.counts).toBe("no upstream");
        expect(v.pull.disabled).toBe(true);
        expect(v.push.label).toBe("Publish");
        expect(v.push.title).toBe("Push and set origin/main as upstream");
    });
    it("disables everything on a detached HEAD", () => {
        const v = syncView({ ...base, branch: "HEAD" });
        expect([v.fetch.disabled, v.pull.disabled, v.push.disabled]).toEqual([true, true, true]);
    });
    it("spins the running action and holds the other two", () => {
        const v = syncView({ ...base, running: "push" });
        expect(v.push.spinning).toBe(true);
        expect(v.fetch.disabled && v.pull.disabled).toBe(true);
    });
});

describe("explainSyncFailure", () => {
    it("says a diverged pull must be reconciled in a terminal", () => {
        const s = explainSyncFailure("pull", { command: "git pull --ff-only", exitcode: 128, stderr: "fatal: Not possible to fast-forward, aborting." }, "main", "origin/main");
        expect(s).toBe("main and origin/main have diverged. Pull here only fast-forwards; merge or rebase in a terminal.");
    });
    it("says a rejected push needs a pull first", () => {
        const s = explainSyncFailure("push", { command: "git push", exitcode: 1, stderr: "! [rejected] main -> main (fetch first)" }, "main", "origin/main");
        expect(s).toBe("origin/main has commits you lack. Pull first, then push.");
    });
    it("leaves anything else to git's own words", () => {
        expect(explainSyncFailure("push", { command: "git push", exitcode: 128, stderr: "fatal: Authentication failed" }, "main", "origin/main")).toBe("");
    });
});

describe("agentsWorkingIn", () => {
    it("names the working or asking agents whose directory is inside the worktree", () => {
        const agents = [
            { id: "1", name: "fix labels", state: "working" },
            { id: "2", name: "idle one", state: "idle" },
            { id: "3", name: "elsewhere", state: "working" },
        ];
        const cwds = { "1": "D:\\repo\\pkg", "2": "D:\\repo", "3": "D:\\other" };
        expect(agentsWorkingIn("D:/repo", agents, cwds)).toEqual(["fix labels"]);
    });
});
```

**Step 2:** Run `npx vitest run frontend/app/view/agents/syncstate.test.ts`. Expected: FAIL.

**Step 3: Implement** `syncstate.ts`. It exports `syncView(input)`, `explainSyncFailure(kind, failure, branch,
upstream)` and `agentsWorkingIn(cwd, agents, agentCwds)`. Use `normalizeRepoPath` from `@/util/paths`: an agent counts
when its normalized cwd equals the worktree's or starts with it plus `/`, and its state is not `idle`.

Rules for `syncView`:
- `branch` of `"HEAD"` or `""` means detached. Every button is disabled, and `counts` is `"detached"`.
- No upstream: `counts` is `"no upstream"`; Pull is disabled with the title `"<branch> has no upstream to pull from"`.
  Push is labelled `"Publish"` with the title `"Push and set origin/<branch> as upstream"`.
- `running` sets `spinning` on that button and disables the other two.
- Titles: Fetch is `"Fetch origin"`, or `"Fetch origin · fetched <ago> ago"` when `fetchedAgo` is set. Pull is
  `"Pull (fast-forward only)"`. Push is `"Push to <upstream>"`.

**Step 4:** Tests PASS, then eslint and prettier on the two files.

**Step 5:** Commit by pathspec: `feat(diff): the sync bar's model`.

---

### Task 6: Quick look: a loading commit never reads as 0 files
**Depends on:** none
**Files:** `frontend/app/view/agents/githistorystore.ts`, `frontend/app/view/agents/diffempty.ts`, `frontend/app/view/agents/diffempty.test.ts`, `frontend/app/view/agents/commitpane.tsx`, `frontend/app/view/agents/diffpane.tsx`, `frontend/app/view/agents/fileslistlabel.ts`, `frontend/app/view/agents/fileslistlabel.test.ts`

**What changes where:**
- Modify: `frontend/app/view/agents/githistorystore.ts` (`selectCommit` ~line 385)
- Modify: `frontend/app/view/agents/diffempty.ts` and `diffempty.test.ts`
- Modify: `frontend/app/view/agents/commitpane.tsx` (files header ~line 106)
- Modify: `frontend/app/view/agents/diffpane.tsx` (pass the list state to `emptyDiffState`)
- Create: `frontend/app/view/agents/fileslistlabel.ts` + `fileslistlabel.test.ts`

The bug (2026-10-09): `selectCommit` set `commitChangesAtom` to null on a failed or non-repo read. null also means
"loading", so the pane showed skeleton rows and `0 FILES +0 −0` forever beside "Pick a file". Commit `63736f8` has 4
files.

**Step 1: Write the failing tests.**

`fileslistlabel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filesListLabel } from "./fileslistlabel";

describe("filesListLabel", () => {
    it("says it is reading while the list loads, never 0 files", () => {
        expect(filesListLabel("loading", null)).toEqual({ text: "Reading this commit's files…", counts: false });
    });
    it("says the read failed", () => {
        expect(filesListLabel("failed", null)).toEqual({ text: "Couldn't read this commit's files", counts: false });
    });
    it("counts a loaded list", () => {
        expect(filesListLabel("ready", { files: [{ path: "a", status: "M", adds: 1, dels: 0 }], adds: 1, dels: 0 })).toEqual({ text: "1 file", counts: true });
    });
});
```

In `diffempty.test.ts`, add cases:
- with no path and `listStatus: "loading"`, `emptyDiffState` returns null (the skeleton);
- with `listStatus: "failed"` it returns kind `"listfailed"`;
- with `"ready"` and `fileCount: 0` it returns kind `"nofiles"`, title `"This commit changes no files"`.

**Step 2:** Run both test files. Expected: FAIL.

**Step 3: Implement.**
- `githistorystore.ts`:
  - add `export const commitChangesStatusAtom = atom<"loading" | "failed" | "ready">("ready")`;
  - `selectCommit` sets it to `"loading"` before the RPC, `"ready"` with the parsed changes, and `"failed"` on a throw
    or `!ch.isrepo`;
  - export a derived `activeChangesStatusAtom`. The working-tree row reads `"loading"` while `filesStateAtom` is null
    and `"ready"` otherwise; a commit reads `commitChangesStatusAtom`;
  - add `export function retrySelectedCommit()`, which re-runs `selectCommit` for the selected hash with
    `filesStateAtom`'s cwd;
  - in DEV only, read `window.__commitChangesFault` (`"hang"` | `"error"`) at the top of the commit read and clear it:
    `"hang"` awaits a never-resolving promise, and `"error"` throws. Model it on `devFault()` in
    `worktreesidebarstore.ts`, with a `declare global { interface Window { ... } }` block in `githistorystore.ts` as
    that file has.
- `fileslistlabel.ts`: export `filesListLabel(status, changes)` exactly as the tests read.
- `commitpane.tsx`:
  - the files header shows `filesListLabel(...).text` with `data-files-count`;
  - `+a −d` shows only when `counts` is true;
  - a failed list shows a `Retry` button (`data-files-retry`) that calls `retrySelectedCommit`.
- `diffempty.ts`: add `listStatus` and `fileCount` to `EmptyDiffInput` and the two kinds above. The `"nofile"` case
  applies only to a ready list with files and no path. `diffpane.tsx` passes both, read from
  `activeChangesStatusAtom` and the active changes.

**Step 4:** Run the tests (PASS), then `task check:ts`, eslint and prettier on the touched files.

**Step 5:** Commit by pathspec: `fix(diff): a commit's files read as loading or failed, never 0 files`.

---

### Task 7: The panel layout: source dropdown, Commit | Log tabs, one-line diff header
**Depends on:** Task 1, Task 6
**Files:** `frontend/app/view/agents/difflayout.ts`, `frontend/app/view/agents/difflayout.test.ts`, `frontend/app/view/agents/filesstore.ts`, `frontend/app/view/agents/comparestore.ts`, `frontend/app/view/agents/githistorystore.ts`, `frontend/app/view/agents/worktreesidebarstore.ts`, `frontend/app/view/agents/worktreesidebarstore.test.ts`, `frontend/app/view/agents/worktreesidebarview.tsx`, `frontend/app/view/agents/sourcepicker.tsx`, `frontend/app/view/agents/diffpanel.tsx`, `frontend/app/view/agents/historypane.tsx`, `frontend/app/view/agents/commitpane.tsx`, `frontend/app/view/agents/diffpane.tsx`, `frontend/app/view/agents/diffoptions.ts`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/rangestrip.tsx`, `frontend/app/view/agents/historyrail.tsx`, `frontend/app/view/agents/filestep.ts`, `frontend/app/view/agents/filestep.test.ts`, `frontend/app/view/agents/changedfilelist.tsx`, `frontend/app/store/keybindings/bindings.ts`, `scripts/cdp/scenarios.mjs`

This task rebuilds the surface layout to match `Log.dc.html`, `Rail.dc.html` and `Compare.dc.html`. The Commit tab
renders a read-only placeholder list here; Task 8 replaces it.

**What changes where:**
- Modify: `frontend/app/view/agents/difflayout.ts` + `difflayout.test.ts`:
  - delete `HISTORY_COLLAPSE_PX`, `historyCollapsedAtom`, `resolveCollapsed`, `SIDEBAR_FOLD_PX` and
    `resolveSidebarFolded`;
  - add:
    - `PANEL_FOLD_PX = 1000`;
    - `panelFoldedAtom = atomWithStorage<boolean | null>("cockpit.files.panel.folded", null)`;
    - `resolvePanelFolded(explicit, width)`, with the rule `resolveSidebarFolded` had;
    - `panelTabAtom = atom<"commit" | "log">("log")`;
    - `panelWidthAtom = atomWithStorage("cockpit.files.panel.width", 340)` and `clampPanelWidth(w)` (280–560);
    - `logSplitAtom = atomWithStorage("cockpit.files.log.split", 0.55)` and `clampLogSplit(f)` (0.25–0.8);
    - `defaultPanelTab(originKind, rangeKind, dirtyCount)`: `"log"` for an agent origin or a session, run or compare
      range; otherwise `"commit"` when `dirtyCount > 0`, else `"log"`;
    - `panelTabToApply(appliedKey, key, loaded, originKind, rangeKind, dirtyCount)`: the tab to set now, or `null`.
      It is `null` while the list for `key` is still loading (`loaded` false: `filesStateAtom` is null or holds another
      cwd), and `null` once `appliedKey === key`. Otherwise it is `defaultPanelTab(...)`. The surface stores `key` as
      applied only when this returns a tab. A fresh pick of a dirty tree therefore waits for its list and opens Commit,
      never Log off a list that has not arrived.

    Test every rule, including: a fresh key that is not loaded yet returns `null`; the same key once loaded with 3 dirty
    files returns `"commit"`; a reload of an applied key returns `null` even when its dirty count changes.
- Create: `frontend/app/view/agents/filestep.ts` + `filestep.test.ts` (spec decision 0). Pure:
  - `shownPaths(files, treeMode, collapsed)`: the file paths in the order the list draws them (`buildFileTree`'s rows
    in tree mode, the list order flat);
  - `stepFile(paths, current, delta)`: the next or previous path, clamped at the ends; the first path when `current`
    is null or no longer listed;
  - `fileStepLabel(paths, current)`: `"file i of n"`.

  Test each, including a tree whose order differs from the input order.
- Modify: `frontend/app/view/agents/changedfilelist.tsx` (spec decision 0). The list is focusable (`tabIndex=0`,
  `data-file-list`). `↑`/`↓` in it select the next file at once through its existing select callback (`selectFile`,
  `selectCompareFile`); no Enter. The selected row scrolls into view. The first file a source, commit, session row or
  compare range selects on load is `shownPaths(...)[0]`, so the pick matches the top row in tree mode too: change the
  `files[0]` picks in `filesstore.ts` and `comparestore.ts`, and `settleSelection` in `githistorystore.ts`, to it.
- Modify: `frontend/app/view/agents/worktreesidebarstore.ts`: delete `sidebarFoldedAtom`, `sidebarShownFoldedAtom`
  and `diffSurfaceWidthAtom`'s fold use (keep the atom if `filessurface` still measures with it).
- Modify: `frontend/app/view/agents/worktreesidebarview.tsx`:
  - rename the export `WorktreeSidebar` to `SourceTree`;
  - delete the folded rail branch and the fold button;
  - take `onPicked: () => void`, called after any pick so the dropdown closes;
  - keep the filter input and every `data-worktree-*` and `data-files-source-option` attribute;
  - the root becomes `data-source-tree`, with width `w-full` and a `max-h-[60vh]` scrolling body.
- Create: `frontend/app/view/agents/sourcepicker.tsx`:
  - a trigger button, `data-source-picker-trigger`, showing the source the way the boards do: a branch icon, then the
    project or agent name, then the branch, muted;
  - a popover, `data-source-picker="open"`, that holds `SourceTree`. It uses `shadow-popover-md`, closes on Escape or
    on a click outside, and focuses the filter when it opens.
- Create: `frontend/app/view/agents/diffpanel.tsx` (`DiffPanel`):
  - the top bar (40px): `SourcePicker`, then the existing Fetch control moved from the subject bar. Task 9 turns it
    into the sync bar;
  - the tab strip (34px): `Commit` (with the working tree's file count) and `Log`, each a
    `button[role=tab][data-panel-tab=commit|log][aria-selected]`. The Log tab carries a `Compare…` button with
    `data-compare-button`;
  - the body.
    - **Commit:** a placeholder list using `ChangedFileList` over `filesStateAtom` changes when the range is `working`.
      Task 8 replaces it.
    - **Log:** history on top and the selected commit below, split by a draggable divider (`data-log-split`,
      `role="separator"`, `aria-orientation="horizontal"`) that writes `logSplitAtom` through `clampLogSplit`.
  - The panel width comes from `panelWidthAtom`, with a drag handle on its right edge (`data-panel-resize`,
    `role="separator"`, `aria-orientation="vertical"`) that writes it through `clampPanelWidth`. The panel root is
    `data-diff-panel="open"`. Folded, the panel is not rendered, and the diff pane carries `data-diff-panel="folded"`.
- Modify: `frontend/app/view/agents/historypane.tsx`:
  - `ROW_H` 34 → 28;
  - drop the author column, the "HISTORY · n loaded" header and `onCollapse`;
  - keep the filter row, the graph toggle and the `data-history-*` attributes.
- Modify: `frontend/app/view/agents/commitpane.tsx`. Its header becomes:
  - one muted line `<hash> · <author> · <ago>`, with the hash in `font-mono` and a `button` that copies it
    (`title="Copy hash"`);
  - the subject;
  - the ref chips.

  Remove the accent hash chip and the avatar. The working-tree header keeps its label and caption.
- Modify: `frontend/app/view/agents/diffpane.tsx`. The header becomes one line: path (muted directory, bold name),
  `+a −d`, what it is measured against, previous/next change with the counter, `File | Review`, and a `⋯` menu
  (`data-diff-options`) holding split/unified, whitespace, wrap, Open in editor and Open in Code. When the panel is
  folded, the header starts with:
  - a source button that unfolds the panel (`data-folded-source`), then `↑a ↓b`;
  - `Commit n | Log` text buttons (`data-folded-tab`);
  - `‹ file i of n ›` (`data-file-step`), which moves through the shown file list.
- Modify: `frontend/app/view/agents/filessurface.tsx`:
  - delete the `h1`, `RangeStrip`, the `data-files-range-summary` span, the history column with its rail, and
    the 300px commit column;
  - render `DiffPanel` and `DiffPane` side by side;
  - compare lives in the Log tab. A compare bar (`data-compare-bar`) shows:
    - `RefPicker` (still `data-ref-pair`), swap and × (Escape);
    - `N ahead · M behind`;
    - the form toggle `since it left <base>` | `tip to tip`.

    `CompareColumn` lists the rows and `AggregatePane`/`CommitPane` sits below;
  - on each change of `scopeKey(scope)` or of the list's load state, call `panelTabToApply` with the last applied key
    (a ref) and set the tab only when it returns one. The rail's View diff also selects the session row, which the
    history store already does for an agent scope;
  - delete `rangestrip.tsx` and `historyrail.tsx` if nothing else imports them (`grep -rn`).
- Modify: `frontend/app/store/keybindings/bindings.ts`, `buildFilesBindings`:
  - `files:toggle-history` (`Shift:h`) becomes "Log tab": it sets `panelTabAtom` to `"log"` and `panelFoldedAtom` to
    `false`;
  - `files:toggle-sidebar` (`Shift:b`) becomes "Show / hide the panel": it flips the shown fold;
  - add `files:commit-tab` (`Shift:c`, "Commit tab"): it sets the tab, unfolds the panel and focuses
    `[data-commit-message]` when present;
  - `files:compare` clicks `[data-compare-button]` after setting the tab to `"log"`;
  - the keybinding conflict test must still pass (`npx vitest run frontend/app/store/keybindings`).
- Modify: `scripts/cdp/scenarios.mjs`:
  - `pickFilesSource`: when `[data-source-picker="open"]` is absent, click `[data-source-picker-trigger]` and wait for
    it; the rest stays;
  - rename `SIDEBAR_FOLD_KEY` to `PANEL_FOLD_KEY = "cockpit.files.panel.folded"`;
  - update `diff-worktrees`, `diff-compare` and `git-history`: replace the folded-rail, range-chip and
    `data-files-range-summary` steps with the panel equivalents. The fold is `Shift+B` on
    `[data-diff-panel="folded"|"open"]`, compare is `[data-compare-button]`, and the summary assertions read
    `[data-files-count]` and the diff header;
  - fix the other scenarios that reach the Diff surface:
    - `line-review` (`const LR` ~line 12400; the plan reviewer called it `doc-review-canvas`, but the lines are in
      `line-review`): ~line 12899 clicks `[data-range-chip="compare"]` and ~12901 waits for `[data-history-rail]`.
      Use `[data-compare-button]` and `[data-compare-bar]`. It also picks sources with `pickFilesSource`;
    - `agent-rail-file-link` and `record-band-detach-restore` read `[data-changed-file-row]` on the Diff surface: keep
      them passing under the new layout;
    - `doc-review-canvas`, `cockpit-needs-you-cross-channel` and `new-run-window` use none of the removed selectors
      (checked 2026-10-09; `SIDEBAR_FOLD_KEY` and `pickFilesSource` are only defined after the latter's object). Grep
      again after the rename and fix any hit;
    - every scenario you edit is in the plan's Final line; if you edit one that is not, say so in your report;
  - add the scenario `diff-log-tab` beside `git-history`. It seeds a clean repo with three commits (the newest
    touching two files) and registers it as a project. It also writes a fixture agent whose cwd is the repo and whose
    session started before the newest commit, the way `agent-rail-file-link` writes its fixture. Steps:
    1. Pick the project (a clean tree): the Log tab is selected, the top commit row is selected,
       `[data-changed-file-row]` count is 2, and a Monaco diff of the first shown file is mounted with no "Pick a file"
       text. Focus `[data-file-list]` and press `↓`: the diff header names the second file without Enter. Shot
       `cdp-shots/diff-log-project.png`.
    2. Open the fixture agent on the Agent surface and click its rail's View diff: the Diff surface opens on the Log
       tab, the `[data-history-row="worktree"]` row reads "Since session start" and is selected, and the first file
       is open in the diff. Shot `cdp-shots/diff-log-tab.png` (the Log board).
    3. Pick the project again. Set `window.__commitChangesFault = "hang"` and click the second commit:
       `[data-files-count]` reads "Reading this commit's files…" and the page has no "0 files". Shot
       `cdp-shots/diff-log-loading.png`.
    4. Set `"error"` and click the third commit: "Couldn't read" shows with `[data-files-retry]`; clicking it loads the
       list.
    5. Click the top commit and press `Shift+B`: `[data-diff-panel="folded"]`, `[data-folded-source]`,
       `[data-folded-tab]` and `[data-file-step]` show, with split view on (`Shift+D`). Shot
       `cdp-shots/diff-panel-folded.png`. Click the step's next arrow: the header names the second file and the step
       reads "file 2 of 2". Click `[data-folded-tab="commit"]`: the panel unfolds on the Commit tab. Press `Shift+H`:
       the Log tab.
    6. Press `c`: `[data-compare-bar]` shows, and the first shown file is open in the diff. Focus `[data-file-list]`
       and press `↓`: the next file opens. Shot `cdp-shots/diff-log-compare.png`. Escape leaves.
    7. Click `[data-diff-options]`: the menu lists split/unified, whitespace, wrap, Open in editor and Open in Code.
       Shot `cdp-shots/diff-options.png`. Click wrap: the menu's wrap item reads on (`aria-checked="true"`). Click it
       again to restore, then Escape: the menu closes.
    8. Drag `[data-panel-resize]` 100px right with `Input.dispatchMouseEvent`: `[data-diff-panel="open"]` is about
       100px wider (±4) and `localStorage["cockpit.files.panel.width"]` changed. Drag `[data-log-split]` 80px down: the
       history pane is taller and `cockpit.files.log.split` changed.

    Teardown restores the panel fold, width and split keys, removes the fixture agent and the project. Register the
    scenario in `SCENARIOS` right after `git-history`.

**Steps:**
1. Write the `difflayout.test.ts` and `filestep.test.ts` cases for the new rules, run them, and watch them fail.
2. Implement `difflayout.ts` and `filestep.ts` and run the tests until they pass.
3. Build the views in this order:
   1. `SourceTree` / `SourcePicker`;
   2. `DiffPanel`;
   3. `historypane` / `commitpane`;
   4. the `diffpane` header;
   5. the `changedfilelist` arrows and the first-file picks;
   6. `filessurface`;
   7. the bindings.
4. Run `task check:ts` and the keybinding tests.
5. With `task dev` running, run `task verify:ui -- surface-smoke diff-log-tab diff-worktrees diff-compare git-history agent-rail-file-link line-review record-band-detach-restore`.
   Every step must pass; the final verifier compares their shots with the boards.
6. Commit by pathspec: `feat(diff): one panel with Commit and Log tabs beside a wide diff`.

---

### Task 8: The Commit tab
**Depends on:** Task 2, Task 4, Task 5, Task 7
**Files:** `frontend/app/view/agents/commitstore.ts`, `frontend/app/view/agents/committab.tsx`, `frontend/app/view/agents/diffpanel.tsx`, `frontend/app/view/agents/filessurface.tsx`, `scripts/cdp/scenarios.mjs`

Build `Main.dc.html` and the commit half of `States.dc.html`.

**What changes where:**
- Create: `frontend/app/view/agents/commitstore.ts`. All its state is keyed by cwd, so it survives the surface
  unmounting.
  - Atoms:
    - `commitListAtom: Record<cwd, { changes: GitChanges | null; head: string; upstream: string; upstreamAhead: number } | undefined>`,
      read with a live `GitChangesCommand({ cwd })` (no ref), because an agent scope's `filesStateAtom` is anchored
      at the session start;
    - `commitTicksAtom: Record<cwd, CommitTicks>`;
    - `commitDraftAtom: Record<cwd, string>`;
    - `commitAmendAtom: Record<cwd, boolean>`;
    - `commitSelectedAtom: Record<cwd, string | null>`;
    - `commitRunAtom: Record<cwd, { running: boolean; failure: GitFailure | null }>`;
    - `unversionedOpenAtom` (default false).
  - Functions:
    - `loadCommitList(cwd)`: prunes ticks against the new list, and selects the first file when nothing is selected;
    - `startCommitPoll(cwd)`, at `FILES_POLL_MS`;
    - `toggleTick`, `setAllTicked`, `setDraft`, `selectCommitTabFile`;
    - `setAmend(cwd, on)`: on → fetch `GitHeadMessageCommand` and put its message in the draft; off → clear the draft
      only if it still equals HEAD's message;
    - `commitNow(cwd)`: calls `GitCommitCommand` with `tickedPaths`, `{ timeout: 65000 }`. On failure it stores the
      failure and keeps the draft and ticks. On success it clears the draft, amend and ticks, then reloads the list,
      calls `reloadChanges(cwd)` and `refreshHistory()`, and `pushToast({ title: \`Committed ${hash}\`, message:
      \`${n} ${n === 1 ? "file" : "files"}\`, level: "info", onOpen })`. `onOpen` switches to the Log tab and calls
      `selectCommit(cwd, hash)`, so the new commit's row is selected and its first file open.
- Create: `frontend/app/view/agents/committab.tsx`, as drawn in `Main.dc.html`:
  - The header row: a tri-state checkbox (`role="checkbox"`, `aria-checked="mixed"` for some), `Changes n`,
    `TreeModeToggle`, and a refresh icon button (`data-commit-refresh`, `aria-label="Refresh"`, `RefreshCw`) that calls
    `loadCommitList(cwd)` and spins while it runs.
  - The **Changes** group, then **Unversioned files** (folded by default), each built with `buildFileTree` /
    `treeModeAtom` as `ChangedFileList` does.
  - A row (`data-commit-row={path}`) holds a checkbox (`data-commit-tick={path}`, `aria-checked`, `disabled` with a
    `title` from `CHANGE_NOTE_TITLE` when `!committable`), the status letter, the name, and the counts or the note.
  - Clicking a row selects it and shows its diff. The list container (`data-commit-list`) is focusable: `↑`/`↓` move
    the selection and show that file's diff at once (`stepFile` from `filestep.ts`), and `Space` toggles its tick.
  - The box (`data-commit-box`) holds:
    - the textarea `data-commit-message` (3–10 lines, `aria-label="Commit message"`). `Ctrl+Enter` in it calls
      `commitNow`;
    - the Amend checkbox `data-commit-amend`, disabled with the title "Already pushed: amending would need a force
      push" when `!amendAllowed`;
    - the muted note `data-commit-agents-note`: "n agents running here", from `agentsWorkingIn` with
      `agentCwdsAtom` and `model.agentsAtom`;
    - the button `data-commit-button`: `commitLabel`, disabled unless `canCommit`, with the hint `Ctrl+Enter`.
  - A failure renders under the button as `data-commit-failure`: git's command, exit code and stderr in mono, then
    "Your message and ticks are kept."
  - A clean tree renders `data-commit-empty`: "No uncommitted changes", "The working tree matches HEAD." and a link
    "Open the Log (Shift+H)".
- Modify: `diffpanel.tsx` (the Commit body renders `CommitTab`). Modify `filessurface.tsx`: when `panelTabAtom` is
  `"commit"`, the diff shows `commitSelectedAtom[cwd]` with `{ kind: "worktree", anchorRef: "" }`, `editorCwd = cwd`,
  and the header measured "vs HEAD" (or "new file" for `?`).
- Modify: `scripts/cdp/scenarios.mjs`. Add `diff-commit-tab`, registered right after `diff-worktrees`. Its arrange
  seeds a repo (configured `user.name`/`email`) holding:
  - a committed `a.txt`, then modified;
  - `b.txt`, committed, modified and `git add`ed, as "another session" would;
  - an untracked `new.txt`;
  - `logo.png` with a NUL byte;
  - `vendor/tool/` with its own `git init`.

  Steps:
  1. Click `[data-source-picker-trigger]`: `[data-source-picker="open"]` shows the project row and the filter has
     focus. Shot `cdp-shots/diff-source-picker.png`. Pick the project with the dropdown (it closes): the Commit tab is
     selected (a dirty tree, decided once its list loaded), a.txt and b.txt are ticked, new.txt is unticked,
     `vendor/tool/` is disabled with "repo", and `logo.png` reads "bin". The diff shows a.txt. Shot
     `cdp-shots/diff-commit-tab.png`.
  2. Focus `[data-commit-list]` and press `↓`: b.txt is selected and the diff header names it, without Enter. Press
     `Space`: b.txt's `[data-commit-tick]` reads `aria-checked="false"`. Unfold Unversioned, tick new.txt, type a
     message into `[data-commit-message]` and press `Ctrl+Enter` there. A toast shows "Committed <hash>"; `git show
     --name-only HEAD` lists a.txt and new.txt, and `git diff --cached --name-only` is still b.txt. Click the toast's
     `[data-notification-open]`: the Log tab is selected and the `[data-history-row="<hash>"]` row is selected.
  3. Switch to the Log tab, then press `Shift+C`: the Commit tab is selected and `document.activeElement` is
     `[data-commit-message]`. Write `x.txt` in node and click `[data-commit-refresh]`: an x.txt row appears in
     Unversioned.
  4. Write a failing `pre-commit` hook, modify a.txt and commit: `[data-commit-failure]` holds the hook's text and the
     message is still in the box. Shot `cdp-shots/diff-commit-failed.png`. Remove the hook.
  5. Add a bare remote and `git push -u`: Amend is disabled with its title. Shot `cdp-shots/diff-commit-amend-locked.png`.
  6. Commit everything left (`git add -A && git commit` in node, unticking the nested repo first by ignoring it in
     `.git/info/exclude`): `[data-commit-empty]` shows. Shot `cdp-shots/diff-commit-empty.png`.

  Teardown removes the project and the temp dirs.

**Steps:**
1. Write `commitstore`'s pure parts as tests first where there is logic beyond atoms (none expected: the logic sits in
   `commitselection.ts`).
2. Build the store and the view.
3. Run `task check:ts`, then eslint and prettier on the touched files.
4. Run `task verify:ui -- diff-commit-tab diff-log-tab surface-smoke`; every step must pass.
5. Commit by pathspec: `feat(diff): commit ticked files from the Commit tab`.

---

### Task 9: The sync bar
**Depends on:** Task 3, Task 5, Task 8
**Files:** `frontend/app/view/agents/syncstore.ts`, `frontend/app/view/agents/syncbar.tsx`, `frontend/app/view/agents/diffpanel.tsx`, `frontend/app/view/agents/diffpane.tsx`, `scripts/cdp/scenarios.mjs`

Build the sync cluster of `Main.dc.html` and the sync half of `States.dc.html`.

**What changes where:**
- Create: `frontend/app/view/agents/syncstore.ts`:
  - `syncRunAtom: Record<cwd, { running: "pull" | "push" | null; failure: { kind: "pull" | "push"; failure: GitFailure } | null }>`;
  - `runPull(cwd)` calls `GitPullCommand` with `{ timeout: 60000 }`, and `runPush(cwd)` calls `GitPushCommand` with
    `{ timeout: 125000 }`;
  - on success, toast "Pulled n commits", "Pushed n commits", or "Published <branch>" when the push set an upstream;
    then run `runFetch(cwd)` (from `comparestore`), `reloadChanges(cwd)`, `refreshHistory()` and `loadCommitList(cwd)`;
  - an RPC throw becomes a failure with exit code -1 and "the pull did not complete" / "the push did not complete";
  - Fetch stays `comparestore.runFetch`, with its `fetchStatesAtom`.
- Create: `frontend/app/view/agents/syncbar.tsx`:
  - `syncView` drives the counts span (`data-sync-counts`, `title`) and three icon buttons, each `data-sync=fetch|pull|push`
    with an `aria-label`, `RefreshCw` / `ArrowDownToLine` / `ArrowUpFromLine`, and an `animate-spin` spinner while it
    runs. Publish is a text button.
  - **Pull confirm:** when `agentsWorkingIn(cwd, …)` is non-empty, Pull opens a popover (`data-pull-confirm`,
    `role="dialog"`) titled "Pull n commits into <branch>?". It names the agents and offers Cancel / "Pull n commits".
    For the scenario, in DEV only, `window.__syncWorkingAgents` (a string array) replaces the computed list; declare it in
    a `declare global` block in `syncbar.tsx`.
  - **Failure:** `GitFailureNotice` under the top bar (`data-sync-failure`), preceded by `explainSyncFailure`'s
    sentence when it is not empty.
- Modify: `diffpanel.tsx`. The top bar renders `SyncBar` in place of Task 7's Fetch control. Modify `diffpane.tsx` so
  the folded header shows `data-sync-counts` only.
- Modify: `scripts/cdp/scenarios.mjs`. Add `diff-sync`, registered right after `diff-compare`. Its arrange is a bare
  remote, clone A (registered as the project) and clone B, both with an identity. Steps:
  1. A commits once: `[data-sync-counts]` reads "↑1 ↓0". Click Push: a toast shows and the counts read "↑0 ↓0".
  2. B commits and pushes, and A commits: click Fetch, then Pull. `[data-sync-failure]` says main and origin/main have
     diverged. Shot `cdp-shots/diff-sync-diverged.png`. Reset A to origin/main.
  3. B pushes again, and set `window.__syncWorkingAgents = ["fixture agent"]`: click Pull. `[data-pull-confirm]` names
     the agent. Shot `cdp-shots/diff-sync-confirm.png`. Confirm: a toast shows "Pulled 1 commit".
  4. A checks out a new branch `feature` with a commit: the counts read "no upstream" and the push button reads
     Publish. Shot `cdp-shots/diff-sync-publish.png`. Click it: the counts become "↑0 ↓0".

  Teardown removes the project and the temp dirs.

**Steps:**
1. Build the store and the bar.
2. Run `task check:ts`, then eslint and prettier on the touched files.
3. Run `task verify:ui -- diff-sync diff-commit-tab diff-log-tab diff-compare surface-smoke`; every step must pass.
4. Commit by pathspec: `feat(diff): fetch, pull and push from the Diff panel`.

---

### Task 10: Docs
**Depends on:** Task 9
**Files:** `CHANGELOG.md`, `docs/keyboard-shortcuts.md`, `docs/deferred.md`, `docs/open-issues.md`, `docs/reference/architecture.md`

**What changes where:**
- `CHANGELOG.md`: under `## Unreleased`, add one `Added` line for commit and sync from the Diff surface, and one
  `Changed` line for the Commit | Log panel beside a wide diff. Add one `Fixed` line: a commit's files no longer read
  "0 files" while they load or after a failed read.
- `docs/keyboard-shortcuts.md`: in the Diff section, add `Shift+C` and change the descriptions of `Shift+H` and
  `Shift+B` to match `bindings.ts`.
- `docs/deferred.md` ("Diff surface — repository actions…") and `docs/open-issues.md` (Spec B): narrow both to
  checkout, cherry-pick and revert. Say that commit, fetch, pull and push shipped on 2026-10-09 under the spec above.
- `docs/reference/architecture.md`: fix any sentence that describes the Diff surface's columns.
- Leave this plan and the canvas folder alone: whoever lands the run deletes both afterwards (`AGENTS.md`: a plan is
  deleted once it ships; `DESIGN.md`: a canvas goes when its feature ships).

Commit by pathspec: `docs(diff): Commit | Log panel, commit and sync`.
