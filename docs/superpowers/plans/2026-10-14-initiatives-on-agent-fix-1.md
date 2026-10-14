# Initiatives on the Agent surface — fix round 1

The final stage's Verify failed on the merged result:

```
--- FAIL: TestGatherAttentionDropsAskForDeletedBlock
    attention_test.go:133: deleted block must not remain in attention: [{Kind:plan-review
    Key:plan-review:dd9204f2-… Source:Jarvis as graph Text:4 proposed …}]
FAIL	github.com/wavetermdev/waveterm/pkg/jarvis
```

Cause: `GatherAttentionFromLedger` (`pkg/jarvis/attention.go`, ~line 891) reads every initiative with
`effortstore.GetAll`, and `pkg/jarvis`'s `TestMain` (`pkg/jarvis/maintest_test.go`) points only the wave data dir
at a temp dir, not the effort store. So the package's tests read the user's real vault
(`memroots.VaultRoot()/efforts/`). Task 3 added `plan-review` items there, so any real initiative holding proposed
chunks now shows up in a test that expects an empty queue (`chunk-due` had the same leak, latent until a real chunk
fell due today).

### Task 1: Isolate pkg/jarvis's tests from the real initiatives vault

**Depends on:** none

Files: `pkg/jarvis/maintest_test.go`.

- In `TestMain`, after the wave data dir is set up, point the effort store at an empty temp vault root with
  `effortstore.UseRootForTest(<temp dir>)` (`pkg/effortstore/effortstore.go:50`), and call the returned restore
  before exiting. A sub-directory of the existing throwaway `dir` is fine, since `os.RemoveAll(dir)` already cleans
  it up. Update the doc comment above `TestMain` to say the effort store is pointed there too, and why: the
  attention gather reads every initiative, and the real vault's would leak into the queue.
- A test in the package that already calls `effortstore.UseRootForTest` itself keeps working (it overrides and
  restores the override); check with `grep -rn UseRootForTest pkg/jarvis`.
- Do not change `attention.go` or the test's expectations: the production read is right, the test environment is
  wrong.
- Check: `go test ./pkg/jarvis -run 'TestGatherAttention|PlanReview|Attention' -count=1` passes, then the whole
  package with `node scripts/verify.mjs ./pkg/jarvis`. The real vault on this machine holds initiatives with
  proposed chunks right now (three titled "Jarvis as graph"), so the failing test reproduces before the change.
  Leave those initiatives alone: they are the user's vault.
