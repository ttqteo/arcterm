# Chat bash mode, fix round 1: command completions with Windows' PATH order

**Goal:** `shellcomplete.Complete` returns command completions whatever the PATH order, so the Final's Verify
(`TestCompleteVariablesAndCommands`, which saw `commands: []`) passes and Tab completes commands in the packaged app.

**Verify:** `node scripts/verify.mjs ./pkg/shellcomplete/... ./pkg/wshrpc/...`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs agent-chat`

---

## What failed and why (checked by the lead)

The Final's Verify failed twice (the run and the rerun alone) with
`complete_test.go:40: commands: []`. It passes in a Git Bash shell and fails under the engine. The cause is the PATH
that `bash --noprofile --norc -c` inherits. `FindGitBash` takes the first `bash.exe` in a Git folder on PATH, which can
be `Git\usr\bin\bash.exe` itself, not the `Git\bin\bash.exe` launcher that puts `usr\bin` in front. So when the
inherited Windows PATH lists `C:\Windows\System32` before `Git\usr\bin`, the command script's `sort -u` runs Windows'
`sort.exe`. That fails on `-u`, and the pipe yields nothing. The variable and file scripts survive only because Windows
has no `head`. wavesrv inherits the same Windows PATH, so the packaged app would complete no commands either.

The lead reproduced it with the test binary:
`PATH="/c/Windows/System32:/c/Windows:/c/Program Files/Git/usr/bin:/c/Program Files/Go/bin" ./shellcomplete.test.exe -test.run TestCompleteVariablesAndCommands`
prints `commands: []`. With `usr/bin` first it passes.

The rest of the Final was checked by hand on the merged tree: `task check:ts` exits 0 and
`npx vitest run frontend/app/view/agents/` passes (378 files). The `agent-chat` scenario has not run yet, because Verify
failed first.

### Task 1: Complete uses no programs outside bash

**Depends on:** none

**Files:** `pkg/shellcomplete/complete.go`, `pkg/shellcomplete/complete_windows_test.go`

**Step 1: Write the failing test.** In `complete_windows_test.go` (`//go:build windows`), add
`TestCompleteCommandsWithSystem32FirstOnPath`. Skip it when `bashPath()` is empty. Then
`t.Setenv("PATH", os.Getenv("SystemRoot")+`\System32;`+os.Getenv("PATH"))`, and assert that
`Complete(ctx, t.TempDir(), KindCommand, "ech")` contains `echo` and that `KindVariable`/`"PAT"` contains `PATH`.
Run `go test ./pkg/shellcomplete -run TestCompleteCommandsWithSystem32FirstOnPath` (with
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in Bash) and see it fail with an empty command list.

**Step 2: Fix the scripts.** Drop every external program from the `scripts` map. They become
`compgen -c -- "$1" 2>/dev/null`, `compgen -v -- "$1" 2>/dev/null`, and the file script keeps its builtin-only
`while IFS= read -r f; do [ -d "$f" ] && echo "$f/" || echo "$f"; done` loop fed by `compgen -f -- "$1" 2>/dev/null`.
Drop `sort` and `head`. The file loop gets a builtin counter that stops it after 1000 names, so a huge folder's
`[ -d ]` checks stay well inside the 3 s timeout. Go already dedups, sorts and caps the answer at `MaxItems`, which now applies to the whole
answer, not to its first 200 lines. Do not prefix PATH or call the `bin\bash.exe` launcher instead: a script with no
outside programs cannot pick the wrong one. Update the comment above `scripts` to say why it uses builtins only (a
Windows PATH can put System32's `sort.exe` first). Keep `TestCompleteTakesTheWordAsAnArgumentNotAsScript` and the cap
test passing.

**Step 3: Verify.** Run the new test, then the whole package (`go test ./pkg/shellcomplete`) both from Git Bash and
with System32 first on PATH, as above. `gofmt -l pkg/shellcomplete` must print nothing.

**Step 4: Commit** `fix(shellcomplete): complete with bash builtins only, so Windows' sort.exe never answers`. The
change is invisible to the user beyond the feature working, and the feature's CHANGELOG line is unreleased, so the
changelog takes no new line.
