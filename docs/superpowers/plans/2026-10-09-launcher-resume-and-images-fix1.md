# Launcher resume and images: fix round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The run's Verify (`node scripts/verify.mjs ./pkg/agentsessions/...`) passes on Windows. On the merged result it fails in two agy tests that already fail on the base (the run changed nothing under `pkg/`): `fileURIToPath` (`pkg/agentsessions/agy.go:103`) returns a native path through `filepath.FromSlash`, so on Windows `file:///Users/x/repo` becomes `\Users\x\repo`, while the tests compare against the slash form `/Users/x/repo`.

**Spec:** `docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md`

### Task 1: agy tests expect the native project path

**Depends on:** none

**Files:** `pkg/agentsessions/agy_test.go`

The provider is right to return a native path (project paths are compared against native paths elsewhere); the tests are wrong on Windows. Change only the test expectations, not `agy.go`.

- [ ] In `TestAgyProviderListsConversationsWithDBTitleAndCwd` (around `agy_test.go:131` and `:145`), compare `a.ProjectPath` with `filepath.FromSlash("/Users/x/repo")` and `b.ProjectPath` with `filepath.FromSlash("/Users/x/My Project")`, and print those values in the error messages. `ProjectName` stays `repo` / `My Project`.
- [ ] In `TestExtractSessionAgyReadsItsDatabaseBesideBrain` (around `agy_test.go:259`), compare `s.ProjectPath` with `filepath.FromSlash("/Users/x/repo")`.
- [ ] Check the rest of `agy_test.go` for any other literal slash-form `ProjectPath` comparison and give it the same treatment; leave the `file:///…` URIs in the fixtures unchanged.
- [ ] Run `go test ./pkg/agentsessions` and confirm it passes, then `node scripts/verify.mjs ./pkg/agentsessions/...`.
- [ ] Commit `pkg/agentsessions/agy_test.go` with a pathspec.
