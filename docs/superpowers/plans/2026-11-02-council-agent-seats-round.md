# Council agent seats — fix round

**Spec:** `docs/superpowers/specs/2026-11-02-council-agent-seats-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `go vet ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`

Work by: simple and direct, one source of truth, no abstraction for a single use, errors handled at the boundary and
never swallowed. On Windows run a Go test as `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '<names>'` (Bash).

### Task 1: One source for the agent group ids in wsh
**Depends on:** none
**Model:** sonnet
**Files:** `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`

`cmd/wsh/cmd/wshcmd-council.go` declares its own `councilAgentsGroup = "agents"` and
`councilAgentsIdeasGroup = "agents-ideas"` (lines 33-34), written while `pkg/council`'s exported
`council.AgentsGroupId` and `council.AgentsIdeasGroupId` (`pkg/council/roles.go`) were not yet on the base. Both are
now there. Delete the two local constants and use `council.AgentsGroupId` / `council.AgentsIdeasGroupId` at every use
(`councilGroupFor`, the `--group` help text near line 1123, and any test that names them). No behaviour changes.

Acceptance: `grep -n "councilAgentsGroup\|councilAgentsIdeasGroup" cmd/wsh/cmd` finds nothing; `go build ./cmd/...`
passes; `TestCouncilGroupForAgents` passes.
