# Brainstorm skill bench: round 2 fixes

**Goal:** Correct three statements the run left wrong: the `go run` tool's comment on Ctrl+C, the spec's claim about
how the token cap cuts a bare bench, and the spec's two mentions of the old unexported `judgeFileBytes`.

No behaviour changes. Text and comments only.

### Task 1: Say what Ctrl+C and the token cap really do

**Depends on:** none

**Files:** `cmd/council-bench-brainstorm/main.go`, `docs/superpowers/specs/2026-11-10-brainstorm-skill-bench-design.md`, `docs/guide/council.md`

In `main.go`, change only the package comment. In `council.md`, change only the bench section, near the
`go run ./cmd/council-bench-brainstorm` line.

**Decisions:**
- The code stays as it is. `bench.Run` returns the context's error when Ctrl+C cancels it, and the item in flight
  gets no row; the team variant behaves the same. So the comment is what changes, not the code.
- `bench.Run` checks the cap before every item (`pkg/council/bench/run.go`, the `spent >= limit` check), so the cap
  can stop a bare bench between a case's council and its team or brainstorm items. The spec claims whole runs are
  cut and never half pairs, which is wrong.

**What to change:**
1. `main.go`'s package comment: replace "Ctrl+C stops it between turns and the item in flight gets a stopped row"
   with what happens: Ctrl+C stops it, the item in flight writes no row, and the rows already written stay.
2. The spec's "Running it" section: replace the parenthetical "(`Plan` orders run 1 of every case before run 2, so
   whole runs are cut, not half pairs)" with the truth. `Plan` orders run 1 of every case before run 2, and `Run`
   checks the cap before every item, so the cap can fall between one case's variants. Then a case's council has a row
   for that run and its team or brainstorm does not, and the team verdict for that case reads incomplete. A bare
   bench over today's cases is estimated at ~73M against the 50M cap, so a bare bench's run 2 is likely cut this way.
   To measure the skill alone, name the variant.
3. The spec names `brainstormcheck`'s `judgeFileBytes` as it is today in two places: "How the bench drives the
   skill" (around line 39) and "Launch and limits", in the item on the skill's judge and reviewer (around line 106).
   Both now name `JudgeFileBytes`. Leave planning call 5 as it is: it records the rename.
4. `docs/guide/council.md`, in the bench section (Vietnamese, like the rest of the page): add one sentence. A bare
   `wsh council bench` can hit the 50M cap partway through a case's variants, so to measure the brainstorm skill
   alone, run `wsh council bench --variant brainstorm` or the `go run` command. Only add it if the section does not
   already say this.

**Acceptance:**
- `go build ./cmd/council-bench-brainstorm` and `go vet ./cmd/council-bench-brainstorm` pass, and the diff to
  `main.go` touches only comment lines.
- `grep -n "judgeFileBytes" docs/superpowers/specs/2026-11-10-brainstorm-skill-bench-design.md` matches only inside
  planning call 5.
- `grep -n "half pairs" docs/superpowers/specs/2026-11-10-brainstorm-skill-bench-design.md` matches nothing.
- No change to `CHANGELOG.md`: nothing a user sees changes.
