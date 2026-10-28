# New dialog, decluttered — fix round 1

The final stage stopped at Verify (`node scripts/verify.mjs ./pkg/agentsessions`) on two Go tests that fail on Windows
on the base as well, so the CDP Final never ran on the merged dialog. The human chose to fix the test in this round so
Final can run. This run changed no Go code.

### Task 1: canvas-session tests escape their Windows paths in JSON

**Depends on:** none

**Files:** `pkg/agentsessions/canvassessions_test.go`

`TestCanvasSessions_listsTheSessionsThatWroteIntoTheTopicLatestWriterFirst` (fails at line 60, `sessions = []`) and
`TestCanvasSessions_skipsTranscriptsOlderThanSince` (line 134) build transcript lines by pasting
`filepath.Join(...)` paths into JSON strings (`"file_path":"`+board+`"`, the `Bash` `command` with `topic`, the
`rail-sections` path, and the `Main.dc.html` path in the second test). On Windows those paths hold backslashes, so
`\w`, `\.` and similar make the line invalid JSON and the provider skips it.

- Make every path these tests put inside a JSON string JSON-safe, through one small helper in the test file (for
  example a `jsonStr(s string) string` that returns `json.Marshal`'s quoted output, used in place of the
  `"` + path + `"` pasting), so the decoded path is exactly the `filepath.Join` path the test passes as `topic`. Keep
  each test's meaning and expectations as they are; do not switch the paths to forward slashes and do not touch
  `canvassessions.go` or any non-test file.
- Leave the other tests in the file as they are unless they paste a `filepath.Join` path into JSON the same way; if one
  does, route it through the same helper.
- Acceptance: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/agentsessions` passes on Windows
  (Bash), with both named tests passing, and the file still passes `gofmt -l`. The run's Verify proves it at the
  merge; Final then runs the run's CDP scenarios unchanged.
