# Claude account switch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pick the Claude account in Settings (Default /login, or an account added through
`claude setup-token`); everything started afterwards runs on it, and the quota readout follows it.

**Architecture:** Spec: `docs/superpowers/specs/2026-10-07-claude-account-switch-design.md`. A new
`pkg/claudeaccount` keeps the account list in `<data dir>/claude-accounts.json` and the tokens in
`pkg/secretstore`, and applies the active account to wavesrv's own environment
(`CLAUDE_CODE_OAUTH_TOKEN`, `ARC_CLAUDE_ACCOUNT`) from the config hook, so every shell, agent and
headless run spawned later inherits it. `wsh agentstatus` tags usage with `ARC_CLAUDE_ACCOUNT`; the
frontend keys Claude rate-limit snapshots per account and shows only the active one.

**Tech Stack:** Go (wavesrv, wsh, wshrpc), React 19 + jotai + Tailwind, vitest, CDP scenarios.

**Verify:** `node scripts/verify.mjs ./pkg/claudeaccount/... ./pkg/claudequota/... ./pkg/wconfig/... ./pkg/wshrpc/... ./pkg/baseds/... ./pkg/waveobj/... ./cmd/wsh/... ./cmd/server/...`

**Final:** `node scripts/cdp/final-verify.mjs settings-claude-account usage-charts`

---

Conventions for every task: run `go test` / `npx vitest run` on what you touched; `gofmt -l` and
`npx prettier --check` only on files you touched (HEAD is not formatter-clean); `task check:ts` takes
~2 minutes, give it a 5-minute timeout. Never hand-edit generated files — edit Go, run `task generate`.
Commit on the current branch, no `Co-Authored-By` trailer.

### Task 1: `pkg/claudeaccount` — account store and environment

**Depends on:** none

**Files:**
- Create: `pkg/claudeaccount/claudeaccount.go`
- Test: `pkg/claudeaccount/claudeaccount_test.go`

**Step 1: Write the failing tests**

```go
package claudeaccount

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// memSecrets swaps the secretstore for a map
func useTemp(t *testing.T) map[string]string {
	t.Helper()
	dir := t.TempDir()
	secrets := map[string]string{}
	oldPath, oldSet, oldGet, oldDel := storePath, setSecret, getSecret, deleteSecret
	storePath = func() string { return filepath.Join(dir, "claude-accounts.json") }
	setSecret = func(n, v string) error { secrets[n] = v; return nil }
	getSecret = func(n string) (string, bool, error) { v, ok := secrets[n]; return v, ok, nil }
	deleteSecret = func(n string) error { delete(secrets, n); return nil }
	t.Cleanup(func() { storePath, setSecret, getSecret, deleteSecret = oldPath, oldSet, oldGet, oldDel })
	return secrets
}

func TestAddListRenameRemove(t *testing.T) {
	secrets := useTemp(t)
	a, err := Add("Công ty", "sk-ant-oat01-abc")
	if err != nil {
		t.Fatal(err)
	}
	if secrets[secretName(a.Id)] != "sk-ant-oat01-abc" {
		t.Fatalf("token not stored under %s", secretName(a.Id))
	}
	if err := Rename(a.Id, "Work"); err != nil {
		t.Fatal(err)
	}
	list, _ := List()
	if len(list) != 1 || list[0].Label != "Work" {
		t.Fatalf("list = %+v", list)
	}
	if err := Remove(a.Id); err != nil {
		t.Fatal(err)
	}
	list, _ = List()
	if len(list) != 0 || len(secrets) != 0 {
		t.Fatalf("after remove: list %+v secrets %v", list, secrets)
	}
}

func TestAddRejectsNonOAuthToken(t *testing.T) {
	useTemp(t)
	if _, err := Add("x", "sk-ant-api03-nope"); err == nil {
		t.Fatal("want an error for a non-setup-token value")
	}
}

func TestApplyEnvSetsAndRestoresInherited(t *testing.T) {
	useTemp(t)
	t.Setenv(tokenVar, "inherited")
	os.Unsetenv(accountVar)
	captureInherited()
	a, _ := Add("B", "sk-ant-oat01-bbb")

	if got := ApplyEnv(a.Id); got != a.Id {
		t.Fatalf("applied %q", got)
	}
	if os.Getenv(tokenVar) != "sk-ant-oat01-bbb" || os.Getenv(accountVar) != a.Id {
		t.Fatal("active account not in env")
	}
	if got := ApplyEnv(""); got != "" {
		t.Fatalf("default applied %q", got)
	}
	if os.Getenv(tokenVar) != "inherited" {
		t.Fatal("inherited token not restored")
	}
	if _, set := os.LookupEnv(accountVar); set {
		t.Fatal("account var should be unset again")
	}
}

// what wavesrv spawns (shellexec, consult, run workers) starts from os.Environ(): a child started after
// ApplyEnv must see the account, and must not after a switch back to Default
func TestApplyEnvReachesChildProcess(t *testing.T) {
	if os.Getenv("CLAUDEACCOUNT_HELPER") == "1" {
		fmt.Print(os.Getenv(accountVar))
		os.Exit(0)
	}
	useTemp(t)
	os.Unsetenv(accountVar)
	captureInherited()
	a, _ := Add("C", "sk-ant-oat01-ccc")
	child := func() string {
		cmd := exec.Command(os.Args[0], "-test.run=^TestApplyEnvReachesChildProcess$")
		cmd.Env = append(os.Environ(), "CLAUDEACCOUNT_HELPER=1")
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	}
	ApplyEnv(a.Id)
	if got := child(); got != a.Id {
		t.Fatalf("child saw %q, want %q", got, a.Id)
	}
	ApplyEnv("")
	if got := child(); got != "" {
		t.Fatalf("child saw %q after Default", got)
	}
}

func TestApplyEnvUnknownAccountFallsBackToDefault(t *testing.T) {
	useTemp(t)
	os.Unsetenv(tokenVar)
	captureInherited()
	if got := ApplyEnv("a00000000"); got != "" {
		t.Fatalf("applied %q for an account with no token", got)
	}
	if _, set := os.LookupEnv(tokenVar); set {
		t.Fatal("token var should stay unset")
	}
}
```

**Step 2: Run to verify they fail**

Run: `go test ./pkg/claudeaccount/...`
Expected: FAIL — package has no non-test files / undefined: Add.

**Step 3: Implement**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package claudeaccount keeps the Claude accounts added with `claude setup-token` and puts the active one
// into wavesrv's environment, so every claude started afterwards (shells, agents, headless runs) inherits
// it. The list lives in a local file; the tokens live in the secretstore and are never returned by an RPC.
// Default ("" ) is whatever `/login` stored: no token in the environment.
package claudeaccount

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	tokenVar    = "CLAUDE_CODE_OAUTH_TOKEN"
	accountVar  = "ARC_CLAUDE_ACCOUNT"
	TokenPrefix = "sk-ant-oat"
)

type Account struct {
	Id        string `json:"id"`
	Label     string `json:"label"`
	CreatedTs int64  `json:"createdts"`
}

// swapped by tests
var (
	storePath    = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "claude-accounts.json") }
	setSecret    = secretstore.SetSecret
	getSecret    = secretstore.GetSecret
	deleteSecret = secretstore.DeleteSecret
)

var (
	mu        sync.Mutex
	active    string
	inherited = map[string]*string{}
)

func secretName(id string) string { return "CLAUDE_ACCOUNT_" + id }

func newId() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "a" + hex.EncodeToString(b)
}

func load() ([]Account, error) {
	raw, err := os.ReadFile(storePath())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var list []Account
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("reading %s: %w", storePath(), err)
	}
	return list, nil
}

func save(list []Account) error {
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := storePath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, storePath())
}

func List() ([]Account, error) {
	mu.Lock()
	defer mu.Unlock()
	return load()
}

func Add(label, token string) (Account, error) {
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, TokenPrefix) {
		return Account{}, fmt.Errorf("not a setup-token (want a value starting with %s)", TokenPrefix)
	}
	mu.Lock()
	defer mu.Unlock()
	list, err := load()
	if err != nil {
		return Account{}, err
	}
	a := Account{Id: newId(), Label: strings.TrimSpace(label), CreatedTs: time.Now().UnixMilli()}
	if a.Label == "" {
		a.Label = fmt.Sprintf("Account %d", len(list)+1)
	}
	if err := setSecret(secretName(a.Id), token); err != nil {
		return Account{}, err
	}
	if err := save(append(list, a)); err != nil {
		_ = deleteSecret(secretName(a.Id))
		return Account{}, err
	}
	return a, nil
}

func Rename(id, label string) error {
	mu.Lock()
	defer mu.Unlock()
	list, err := load()
	if err != nil {
		return err
	}
	for i := range list {
		if list[i].Id == id {
			list[i].Label = strings.TrimSpace(label)
			return save(list)
		}
	}
	return fmt.Errorf("no account %q", id)
}

func Remove(id string) error {
	mu.Lock()
	defer mu.Unlock()
	list, err := load()
	if err != nil {
		return err
	}
	kept := list[:0]
	for _, a := range list {
		if a.Id != id {
			kept = append(kept, a)
		}
	}
	if err := save(kept); err != nil {
		return err
	}
	return deleteSecret(secretName(id))
}

// CaptureInherited records the values wavesrv was started with, so Default can restore them (including
// "unset"). Call once at startup, before the first ApplyEnv.
func CaptureInherited() { captureInherited() }

func captureInherited() {
	mu.Lock()
	defer mu.Unlock()
	for _, k := range []string{tokenVar, accountVar} {
		if v, ok := os.LookupEnv(k); ok {
			inherited[k] = &v
		} else {
			inherited[k] = nil
		}
	}
}

func restore(k string) {
	if v := inherited[k]; v != nil {
		os.Setenv(k, *v)
	} else {
		os.Unsetenv(k)
	}
}

// ApplyEnv puts account id's token into the environment, or restores the inherited values for Default
// or for an account whose token is gone. It returns the account actually applied ("" = Default).
func ApplyEnv(id string) string {
	token := ""
	if id != "" {
		t, ok, err := getSecret(secretName(id))
		if err != nil || !ok || t == "" {
			log.Printf("claude account %q has no token, using Default: %v\n", id, err)
			id = ""
		} else {
			token = t
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if id == "" {
		restore(tokenVar)
		restore(accountVar)
	} else {
		os.Setenv(tokenVar, token)
		os.Setenv(accountVar, id)
	}
	active = id
	return id
}

// Active is the account ApplyEnv last applied ("" = Default).
func Active() string {
	mu.Lock()
	defer mu.Unlock()
	return active
}
```

**Step 4: Run to verify they pass**

Run: `go test ./pkg/claudeaccount/...`
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/claudeaccount
git commit -m "feat(claudeaccount): keep setup-token accounts and apply the active one to the environment"
```

### Task 2: Wire the account into wavesrv, wsh and the RPCs

**Depends on:** Task 1

**Files:**
- Modify: `pkg/wconfig/settingsconfig.go` (`SettingsType`, ~41-98)
- Modify: `pkg/wconfig/vaultlayer.go:34-40` (`machineLocalKeys`)
- Modify: `pkg/baseds/baseds.go:45-53` (`AgentUsage`)
- Modify: `cmd/wsh/cmd/wshcmd-agentstatus.go:156-160` (`publishUsageDelta`)
- Create: `pkg/wshrpc/wshrpctypes_claudeaccount.go`
- Modify: `pkg/wshrpc/wshrpctypes.go:39-47` (compose the new interface)
- Create: `pkg/wshrpc/wshserver/wshserver_claudeaccount.go`
- Modify: `pkg/wshrpc/wshserver/wshserver_agents.go:195` (`GetClaudeQuotaCommand`)
- Modify: `cmd/server/main-server.go` (`grabAndRemoveEnvVars` 170-190, `ConfigHook` 342)
- Create: `pkg/wshrpc/wshserver/wshserver_claudequota_test.go`
- Test: `cmd/wsh/cmd/wshcmd-agentstatus_test.go`, `pkg/wconfig/vaultlayer_test.go:102` (`TestVaultLayerIgnoresMachineLocalKeys`)
- Generated (via `task generate`): `metaconsts.go`, `schema/settings.json`, `gotypes.d.ts`, `wshclientapi.ts`, `wshclient.go`

**Step 1: Setting key.** In `SettingsType` add, next to the other single-namespace keys:

```go
	ClaudeClear         bool   `json:"claude:*,omitempty"`
	ClaudeActiveAccount string `json:"claude:activeaccount,omitempty"`
```

and in `machineLocalKeys`: `ConfigKey_ClaudeActiveAccount: true,` (with a comment: the token it names
lives only in this machine's secretstore). Test first: add `ConfigKey_ClaudeActiveAccount` to the key list
in `TestVaultLayerIgnoresMachineLocalKeys` (`pkg/wconfig/vaultlayer_test.go:102`), so it asserts
`IsMachineLocalKey("claude:activeaccount")`; after `task generate` (Step 6) it fails until the map entry
is added, then passes: `go test ./pkg/wconfig/ -run TestVaultLayerIgnoresMachineLocalKeys`.

**Step 2: Usage field.** In `baseds.AgentUsage` add
`Account string `json:"account,omitempty"` // the Claude account the reporting session runs on (ARC_CLAUDE_ACCOUNT); "" = Default`.
Write a failing test in `wshcmd-agentstatus_test.go` that sets `ARC_CLAUDE_ACCOUNT=a1234abcd` with
`t.Setenv` and asserts the usage `publishUsageDelta` builds carries it (extract the struct literal at
156-160 into `func buildUsageDelta(...) *baseds.AgentUsage` if the test cannot reach it), run it (FAIL),
then add `Account: os.Getenv("ARC_CLAUDE_ACCOUNT"),` and run it again (PASS).

**Step 3: RPCs.** `pkg/wshrpc/wshrpctypes_claudeaccount.go`:

```go
package wshrpc

import "context"

type ClaudeAccountCommands interface {
	ClaudeAccountListCommand(ctx context.Context) (*CommandClaudeAccountListRtnData, error)
	ClaudeAccountAddCommand(ctx context.Context, data CommandClaudeAccountAddData) (*ClaudeAccountData, error) // the token is stored, never returned
	ClaudeAccountRenameCommand(ctx context.Context, data CommandClaudeAccountRenameData) error
	ClaudeAccountRemoveCommand(ctx context.Context, data CommandClaudeAccountRemoveData) error // switches to Default first when it is the active one
}

type ClaudeAccountData struct {
	Id        string `json:"id"`
	Label     string `json:"label"`
	CreatedTs int64  `json:"createdts"`
}

type CommandClaudeAccountListRtnData struct {
	Accounts []ClaudeAccountData `json:"accounts"`
	Active   string              `json:"active"` // the account wavesrv applied; "" = Default
}

type CommandClaudeAccountAddData struct {
	Label string `json:"label"`
	Token string `json:"token"`
}

type CommandClaudeAccountRenameData struct {
	Id    string `json:"id"`
	Label string `json:"label"`
}

type CommandClaudeAccountRemoveData struct {
	Id string `json:"id"`
}
```

Add `ClaudeAccountCommands` to the composed interface in `wshrpctypes.go`. Implement in
`wshserver_claudeaccount.go` by delegating to `claudeaccount`; `Remove` does, when
`claudeaccount.Active() == data.Id` or the config's `ClaudeActiveAccount == data.Id`,
`wconfig.SetBaseConfigValue(waveobj.MetaMapType{wconfig.ConfigKey_ClaudeActiveAccount: ""})` first.

**Step 4: Environment at start and on every switch.** In `grabAndRemoveEnvVars`, after
`CacheAndRemoveEnvVars`, call `claudeaccount.CaptureInherited()`. Replace the `ConfigHook` line with:

```go
	wconfig.ConfigHook = func(fc wconfig.FullConfigType) {
		wshserver.SyncProjectChannels(context.Background(), fc.Projects)
		claudeaccount.ApplyEnv(fc.Settings.ClaudeActiveAccount)
	}
```

The hook runs on the initial config and on every change, before the frontend sees it.

**Step 5: Quota only for Default.** Extract the body of `GetClaudeQuotaCommand` into a pure function
and test it before wiring:

```go
// a setup-token cannot read the usage endpoint (403), and the credentials file and Claude Code's
// cached answer belong to the /login account: say nothing rather than another account's numbers
func claudeQuotaFor(ctx context.Context, active string, get func(context.Context) *claudequota.Quota) *wshrpc.CommandGetClaudeQuotaRtnData {
	if active != "" {
		return &wshrpc.CommandGetClaudeQuotaRtnData{}
	}
	q := get(ctx)
	if q == nil {
		return &wshrpc.CommandGetClaudeQuotaRtnData{}
	}
	return &wshrpc.CommandGetClaudeQuotaRtnData{ /* the existing field mapping */ }
}
```

`GetClaudeQuotaCommand` becomes `return claudeQuotaFor(ctx, claudeaccount.Active(), claudequota.Get), nil`.
`wshserver_claudequota_test.go` (write it first, run it, FAIL: undefined):

```go
func TestClaudeQuotaOnlyForDefault(t *testing.T) {
	called := false
	pct := 42.0
	get := func(context.Context) *claudequota.Quota {
		called = true
		return &claudequota.Quota{FiveHourPct: &pct, CapturedAt: time.UnixMilli(1000)}
	}
	if got := claudeQuotaFor(context.Background(), "a1234abcd", get); called || got.FiveHourPct != nil {
		t.Fatalf("non-Default account: called=%v got=%+v", called, got)
	}
	got := claudeQuotaFor(context.Background(), "", get)
	if !called || got.FiveHourPct == nil || *got.FiveHourPct != 42 {
		t.Fatalf("Default: called=%v got=%+v", called, got)
	}
}
```

Run `go test ./pkg/wshrpc/wshserver/ -run TestClaudeQuotaOnlyForDefault`: PASS.

**Step 6: Generate and check.**

Run: `task generate`, then `go build ./...`, `go test ./pkg/claudeaccount/... ./pkg/wconfig/... ./pkg/wshrpc/... ./pkg/baseds/... ./cmd/wsh/... ./cmd/server/...`
Expected: build OK, tests PASS; `git status` shows the generated files updated.

**Step 7: Commit**

```bash
git add pkg cmd schema frontend/types frontend/app/store
git commit -m "feat(claudeaccount): apply the Settings account to wavesrv and tag usage with it"
```

### Task 3: Rate limits per Claude account in the frontend

**Depends on:** Task 2

**Files:**
- Modify: `frontend/app/view/agents/ratelimitstore.ts` (also exports `windowFromSaved`, now module-private at :91)
- Modify: `frontend/app/view/agents/session-models/agentstatusstore.ts:155-161`
- Modify: `frontend/app/view/agents/claudequota.ts:39`
- Modify: `frontend/app/view/agents/usagemeters.tsx:34-37`, `usagesurface.tsx:515,535`, `frontend/app/view/jarvis/petview.tsx:70-75`
- Test: `frontend/app/view/agents/ratelimitstore.test.ts`

**Step 1: Failing tests** in `ratelimitstore.test.ts`:

```ts
describe("per-account claude snapshots", () => {
    it("keys claude by account", () => {
        expect(rateLimitKey("claude", undefined)).toBe("claude:default");
        expect(rateLimitKey("claude", "a1b2c3d4")).toBe("claude:a1b2c3d4");
        expect(rateLimitKey("codex", "a1b2c3d4")).toBe("codex");
    });
    it("migrates a bare claude snapshot to claude:default", () => {
        const s = { capturedAt: 1, fivehourpct: 10 };
        expect(migrateSaved({ claude: s, codex: s })).toEqual({ "claude:default": s, codex: s });
    });
    it("shows only the active account's snapshot, as claude", () => {
        const a = { capturedAt: 1, fivehourpct: 10 };
        const b = { capturedAt: 2, fivehourpct: 90 };
        const saved = { "claude:default": a, "claude:a1": b, codex: a };
        expect(projectActiveAccount(saved, "a1")).toEqual({ claude: b, codex: a });
        expect(projectActiveAccount(saved, "")).toEqual({ claude: a, codex: a });
    });
    it("planDonuts drops claude agents on another account", () => {
        const agents = [
            { id: "1", state: "working", agent: "claude", usage: { fivehourpct: 97, account: "" } },
            { id: "2", state: "working", agent: "claude", usage: { fivehourpct: 5, account: "a1" } },
        ] as AgentVM[];
        const d = planDonuts(agents, {}, "a1", 0);
        expect(d.find((x) => x.provider === "claude")?.fivehour.pct).toBe(5);
    });
});
```

Run: `npx vitest run frontend/app/view/agents/ratelimitstore.test.ts` — Expected: FAIL (not exported).

**Step 2: Implement** in `ratelimitstore.ts`:

- `export` the existing `windowFromSaved` (Task 4's `rowQuota` reuses it) and the `FIVE_HOUR_MS` / `WEEK_MS` constants.
- `export function rateLimitKey(provider: string, account?: string): string` — `claude` → `claude:${account || "default"}`, others unchanged.
- `export function migrateSaved(saved)` — moves a bare `claude` key to `claude:default` unless that exists; call it inside `readSavedRateLimits()`.
- `export function projectActiveAccount(saved, active: string)` — keeps non-claude keys, maps `claude:${active || "default"}` to `claude`, drops other `claude:*`.
- `export const activeClaudeAccountAtom = atom((get) => (get(getSettingsKeyAtom("claude:activeaccount")) as string) || "")`.
- `export function planDonuts(agents: AgentVM[], saved, active: string, now: number): ProviderDonuts[]` —
  `mergeRateLimitWindows(providerPlanUsage(liveWindowAgents(agents).filter((a) => (a.agent || "claude") !== "claude" || (a.usage?.account || "") === active)), projectActiveAccount(saved, active), now)`.
  `liveWindowAgents` itself stays unchanged: `brieffleet` counts every live session regardless of account.

Writers: in `agentstatusstore.ts` call `recordRateLimit(rateLimitKey(provider, usage.account), usage)`;
in `claudequota.ts` call `recordRateLimit("claude:default", usage, q.capturedat)` (wavesrv only answers
for Default). Readers: replace the three `mergeRateLimitWindows(providerPlanUsage(liveWindowAgents(agents)), saved, now)`
calls with `planDonuts(agents, saved, useAtomValue(activeClaudeAccountAtom), now)`. Update the existing
tests that hardcode `.claude` (165-202) to the new keys.

**Step 3: Run**

Run: `npx vitest run frontend/app/view/agents/ frontend/app/view/jarvis/` then `task check:ts` (5-minute timeout).
Expected: PASS, tsc exit 0.

**Step 4: Commit**

```bash
git add frontend/app/view/agents frontend/app/view/jarvis
git commit -m "feat(agents): Claude plan usage follows the active account"
```

### Task 4: Settings → Claude account, switching and the restart dialog

**Depends on:** Task 3

**Files:**
- Modify: `frontend/app/view/agents/settingsmodel.ts` (add section `{ id: "claudeaccount", name: "Claude account", group: "Agents", blurb: "Which Claude subscription new agents run on.", rows: [] }`; update `settingsmodel.test.ts:134-144` if it lists sections)
- Modify: `frontend/app/view/agents/settingssurface.tsx` (`SectionBody` switch at 663; new `ClaudeAccountSection`)
- Create: `frontend/app/view/agents/claudeaccount.ts` (pure model) + `claudeaccount.test.ts`
- Create: `frontend/app/view/agents/claudeaccountrestart.tsx` (dialog)

**Step 1: Failing tests** for the pure model in `claudeaccount.test.ts`:

```ts
describe("restartCandidates", () => {
    it("lists resumable claude agents not on the new account; idle pre-checked, working and asking not", () => {
        const base = { agent: "claude", task: "", usage: {} };
        const agents = [
            { ...base, id: "t1", name: "loom", state: "idle", blockId: "b1", transcriptPath: "/p/s1.jsonl" },
            { ...base, id: "t2", name: "kite", state: "working", blockId: "b2", transcriptPath: "/p/s2.jsonl" },
            { ...base, id: "t6", name: "fern", state: "asking", blockId: "b6", transcriptPath: "/p/s6.jsonl" },
            { ...base, id: "t3", name: "on-a1", state: "idle", blockId: "b3", transcriptPath: "/p/s3.jsonl", usage: { account: "a1" } },
            { ...base, id: "t4", name: "codex", agent: "codex", state: "idle", blockId: "b4", transcriptPath: "/p/s4.jsonl" },
            { ...base, id: "t5", name: "no-transcript", state: "idle", blockId: "b5" },
            { ...base, id: "t7", name: "no-block", state: "idle", transcriptPath: "/p/s7.jsonl" },
            { ...base, id: "t8", name: "bg", kind: "background", state: "idle", blockId: "b8", transcriptPath: "/p/s8.jsonl" },
            { ...base, id: "t9", name: "shell", kind: "terminal", state: "idle", blockId: "b9", transcriptPath: "/p/s9.jsonl" },
        ] as AgentVM[];
        expect(restartCandidates(agents, "a1")).toEqual([
            { tabId: "t1", blockId: "b1", name: "loom", sessionId: "s1", checked: true, state: "idle" },
            { tabId: "t2", blockId: "b2", name: "kite", sessionId: "s2", checked: false, state: "working" },
            { tabId: "t6", blockId: "b6", name: "fern", sessionId: "s6", checked: false, state: "asking" },
        ]);
    });
    it("treats a missing usage.account as Default", () => {
        const a = { id: "t1", name: "loom", task: "", agent: "claude", state: "idle", blockId: "b1", transcriptPath: "/p/s1.jsonl" } as AgentVM;
        expect(restartCandidates([a], "")).toEqual([]);
        expect(restartCandidates([a], "a1")).toHaveLength(1);
    });
});
describe("rowQuota", () => {
    const now = 10 * 60 * 60 * 1000;
    it("null when the account was never used", () => {
        expect(rowQuota({}, "a1", now)).toBeNull();
    });
    it("reads a current snapshot", () => {
        const saved = { "claude:a1": { capturedAt: now - 60_000, fivehourpct: 97, weekpct: 40 } };
        expect(rowQuota(saved, "a1", now)).toEqual({ fivehourpct: 97, weekpct: 40, capturedAt: now - 60_000 });
    });
    it("a window past its reset reads 0", () => {
        const saved = { "claude:default": { capturedAt: now - 60_000, fivehourpct: 97, fivehourreset: (now - 1000) / 1000, weekpct: 40 } };
        expect(rowQuota(saved, "", now)).toEqual({ fivehourpct: 0, weekpct: 40, capturedAt: now - 60_000 });
    });
});
```

Run: `npx vitest run frontend/app/view/agents/claudeaccount.test.ts` — Expected: FAIL.

**Step 2: Implement `claudeaccount.ts`:**
- `export interface RestartCandidate { tabId: string; blockId: string; name: string; sessionId: string; checked: boolean; state: AgentState }`.
- `restartCandidates(agents, newActive): RestartCandidate[]` keeps input order and lists an agent only
  when `(a.agent || "claude") === "claude"`, `a.kind` is undefined or `"agent"` (background agents have
  no block and keep the old account until they end; terminals are not agents), it has a `blockId` and a
  session id from `sessionIdFromTranscript(a.transcriptPath)` (`launch.ts`), and `(a.usage?.account || "")`
  differs from `newActive`. `checked` is `state === "idle"`; working and asking agents are listed unchecked.
- `rowQuota(saved, id, now)` reads `saved[rateLimitKey("claude", id)]` and returns null when absent, else
  `{ fivehourpct, weekpct, capturedAt }` with each pct passed through the exported `windowFromSaved`
  (`FIVE_HOUR_MS` / `WEEK_MS`) so a rolled-over window reads 0.
- `restartOnAccount(c: RestartCandidate)` (not unit-tested; thin RPC wiring): read the block
  (`WOS.getObjectValue(WOS.makeORef("block", c.blockId))`), `SetMetaCommand` `cmd:args` to
  `resumeArgsForClaude(c.sessionId, meta["agent:baseargs"] ?? [])`, `ControllerDestroyCommand(c.blockId)`, then
  `ControllerResyncCommand({ tabid: c.tabId, blockid: c.blockId, forcerestart: true, rtopts: block.runtimeopts })` —
  the same sequence as `TermViewModel.forceRestartController` (`term-model.ts:488-503`); the respawn reads
  wavesrv's current environment, so it runs on the new account.

**Step 3: `ClaudeAccountSection`** in `settingssurface.tsx`, copying the `HeadlessAISection` radiogroup
markup (1177-1251) and DESIGN.md tokens (no raw colors). The Task 6 scenario drives it through these
attributes, so keep them exactly:
- Loads `RpcApi.ClaudeAccountListCommand` on mount and after every add/rename/remove.
- Radio rows (`role="radio"`, `data-claude-account-row={id || "default"}`): "Default (/login)" then each
  account (label, quota from `rowQuota` as `5h N% · tuần M%` with "đo X trước", or "chưa dùng"). Selecting
  writes `writeConfig({ "claude:activeaccount": id })`, then, if `restartCandidates(agents, id)` is
  non-empty, pushes the restart dialog.
- Each account row: inline rename (`CommitText`, `data-claude-account-rename`), Remove
  (`data-claude-account-remove`, through `ConfirmModal`); removing the active account leaves Default
  selected once the list reloads.
- "Dán token" disclosure (`data-claude-account-paste`): label + `SecretInput` → `ClaudeAccountAddCommand`;
  the RPC error shows inline under the field (`data-claude-account-error`), the field keeps its value.
- A placeholder button "+ Đăng nhập account" (`data-claude-account-signin`) wired in Task 5.

**Step 4: Restart dialog** `claudeaccountrestart.tsx` on `ModalShell` (variant "dialog",
`data-claude-restart-dialog`): one checkbox row per candidate (`data-restart-row={tabId}`, the agent's
`name`, and the note "đang làm việc — restart sau khi xong lượt" for working or "đang hỏi — restart sẽ bỏ
câu hỏi" for asking), a line "Terminal đang mở vẫn dùng account cũ cho tới khi mở lại", buttons
"Restart đã chọn" (runs `restartOnAccount` for checked ones, reporting a failed one inline and keeping the
dialog open) and "Để sau". Register it with the modal stack the way existing custom modals are.

**Step 5: Run**

Run: `npx vitest run frontend/app/view/agents/` and `task check:ts`.
Expected: PASS, exit 0. The rendered section and dialog are checked by the Task 6 scenario; that a
switch reaches what wavesrv spawns is covered by `TestApplyEnvReachesChildProcess` (Task 1) and the
scenario's `claudeaccountlist` active check.

**Step 6: Commit**

```bash
git add frontend/app/view/agents
git commit -m "feat(agents): choose the Claude account in Settings and resume agents on it"
```

### Task 5: Sign in an account from Settings (`claude setup-token` in a dialog)

**Depends on:** Task 4

**Files:**
- Create: `frontend/app/view/agents/setuptokenscan.ts` + `setuptokenscan.test.ts`
- Create: `frontend/app/cockpit/claude-signin-modal.tsx` (shell side: it embeds `CockpitFocusPane`, which `view/agents` must not import — `agentsurface.tsx:17-19`; load it from the section with a lazy `import()`)
- Modify: `frontend/app/view/agents/session-models/sessionsidebarmodel.ts:48,118` (skip tabs with `session:helper`)
- Modify: `pkg/waveobj/wtypemeta.go` (add `SessionHelper bool `json:"session:helper,omitempty"``), then `task generate`

**Step 1: Failing tests** for the scanner and the command choice:

```ts
describe("TokenScanner", () => {
    it("finds a token split across chunks and wrapped with ANSI codes", () => {
        const s = new TokenScanner();
        expect(s.push("Your token: sk-ant-oat01-AbC")).toBeNull();
        expect(s.push("\x1b[0m\r\ndEf_gh-12\r\nStore it safely")).toBe("sk-ant-oat01-AbCdEf_gh-12");
    });
    it("ignores text with no token", () => {
        expect(new TokenScanner().push("Opening browser...")).toBeNull();
    });
});
describe("setupTokenCommand", () => {
    const real = { cmd: "claude", args: ["setup-token"] };
    const fake = JSON.stringify({ cmd: "node", args: ["-e", "setTimeout(()=>{},60000)"] });
    it("runs claude setup-token in a production build, whatever the override", () => {
        expect(setupTokenCommand(false, fake)).toEqual(real);
    });
    it("takes the dev override in a dev build", () => {
        expect(setupTokenCommand(true, fake)).toEqual({ cmd: "node", args: ["-e", "setTimeout(()=>{},60000)"] });
    });
    it("falls back to claude for a missing or malformed override", () => {
        expect(setupTokenCommand(true, null)).toEqual(real);
        expect(setupTokenCommand(true, "{nope")).toEqual(real);
        expect(setupTokenCommand(true, JSON.stringify({ cmd: 3 }))).toEqual(real);
    });
});
```

Run: `npx vitest run frontend/app/view/agents/setuptokenscan.test.ts` — Expected: FAIL.

**Step 2: Implement** in `setuptokenscan.ts`:
- `TokenScanner` keeps a rolling buffer (last 8 KB), strips ANSI escapes (`/\x1b\[[0-9;?]*[A-Za-z]/g`),
  joins a token broken by a terminal wrap (a CR/LF between two token characters), and matches
  `/sk-ant-oat01-[A-Za-z0-9_-]{8,}/`. It only reports a match once a non-token character follows it, so a
  half-printed token is never taken.
- `setupTokenCommand(isDev: boolean, override: string | null): { cmd: string; args: string[] }` — in a dev
  build, a JSON `{ cmd: string, args: string[] }` override replaces `claude setup-token` (so the CDP
  scenario can drive the dialog without opening a browser); a production build always runs
  `claude setup-token`. The modal calls it with `import.meta.env.DEV` and
  `localStorage["arc:dev:setuptoken-cmd"]` (read inside try/catch: `null` when storage throws).

Run the tests: PASS.

**Step 3: The modal.** On open:
1. `WorkspaceService.CreateTab(ws.oid, "Claude sign-in", false)`, set the tab meta
   `{ "session:helper": true }`, and set the block meta to
   `{ view: "term", controller: "cmd", cmd, "cmd:args": args, "cmd:shell": false }` from `setupTokenCommand`
   (do not go through `launchAgent`: that tags it as an agent).
2. Render `CockpitFocusPane({ blockId, tabId })` in a `ModalShell` sized ~720×420
   (`data-claude-signin-modal`; the pane sits under `data-claude-signin-term`), with Cancel
   (`data-claude-signin-cancel`).
3. Subscribe `getFileSubject(blockId, "term")`, decode `Data64`, feed `TokenScanner`.
4. On a token: `ClaudeAccountAddCommand({ label: "", token })`, then switch the modal to a label field
   (`data-claude-signin-label`) prefilled with the returned label → `ClaudeAccountRenameCommand` on save.
   An add error shows inline in the modal.
5. On every exit (token found, Cancel, Escape, unmount): release the file subject and close the helper
   tab (`WorkspaceService.CloseTab(ws.oid, tabId)`), which destroys the block and deletes its `term` file holding the
   token. Use `try/finally` so an RPC error cannot leave the tab behind.

In `sessionsidebarmodel.ts` skip tabs whose meta has `session:helper` at both tab loops.

**Step 4: Run**

Run: `task generate`, `npx vitest run frontend/app/view/agents/`, `task check:ts`.
Expected: PASS, exit 0. The modal's open, cancel and token paths are checked by the Task 6 scenario
through the dev override. Once, with the real `claude setup-token`, check by hand that its output is
caught; a different wrap shape becomes a `TokenScanner` test case first.

**Step 5: Commit**

```bash
git add pkg/waveobj frontend
git commit -m "feat(agents): sign in a Claude account from Settings with claude setup-token"
```

### Task 6: CDP scenario, changelog and docs

**Depends on:** Task 5

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (new `settingsClaudeAccount`, registered in `SCENARIOS`; adjust `usage-charts` seeding at ~1594-1620 to `claude:default`)
- Modify: `CHANGELOG.md` (Unreleased → Added)
- Modify: `docs/agents/usage-reporting.md` (per-account windows; quota endpoint only for Default)

**Step 1: Scenario `settings-claude-account`** (pattern: `harnessUpdate`, ~16652-16790; roster fixture
pattern: `lrWriteRoster` writing `TREE_RAIL_FIXTURE`). Every step asserts before it shoots; account ids
come from `h.rpc("claudeaccountlist")`.
- arrange: save `getfullconfig().settings["claude:activeaccount"]`, `localStorage["wave:ratelimits"]` and
  `localStorage["arc:dev:setuptoken-cmd"]`; add two fixture accounts with
  `h.rpc("claudeaccountadd", { label: "Fixture A", token: "sk-ant-oat01-fixtureA" })` (and B); seed
  `wave:ratelimits` with `claude:<idA>` at 97% (captured a minute ago) and leave B unseeded; write a roster
  fixture with three claude agents on Default, each with a `blockId` and a `transcriptPath` ending
  `<session>.jsonl`: `fx-ca-idle` (idle), `fx-ca-working` (working), `fx-ca-asking` (asking, with an ask);
  reload; `h.goto("settings")`; click `[data-section="claudeaccount"]`.
- step `list`: three `[data-claude-account-row]` radios; `default` checked; row A shows `97%`; row B shows
  "chưa dùng". Shot `settings-claude-account`.
- step `restart-dialog`: click row A → `getfullconfig().settings["claude:activeaccount"]` equals A's id and,
  polled, `claudeaccountlist().active` equals A's id (wavesrv applied it); `[data-claude-restart-dialog]`
  shows three `[data-restart-row]` rows naming the three agents; `fx-ca-idle`'s checkbox is checked,
  `fx-ca-working` and `fx-ca-asking` are not and carry their "đang làm việc" / "đang hỏi" notes. Shot
  `settings-claude-account-restart`. Click "Để sau" → the dialog is gone and the setting is still A.
- step `paste-token`: open `[data-claude-account-paste]`, enter label "Fixture C" and `sk-ant-api03-bad`,
  save → `[data-claude-account-error]` is visible and `claudeaccountlist()` is unchanged; replace the token
  with `sk-ant-oat01-fixtureC`, save → a fourth row "Fixture C" appears, no error.
- step `rename`: rename row C inline to "Fixture C2" → `claudeaccountlist()` has that label.
- step `remove`: click row C's remove → a `ConfirmModal` appears; confirm → row C is gone. Click row B
  (click "Để sau" if the dialog opens), remove B through the ConfirmModal → the `default` row is checked,
  `getfullconfig().settings["claude:activeaccount"]` is empty and `claudeaccountlist().active` is "".
- step `signin-cancel`: delete the roster fixture and reload (so the sidebar shows live tabs), back to the
  section; record the workspace's tab ids; set `localStorage["arc:dev:setuptoken-cmd"]` to
  `{"cmd":"node","args":["-e","setTimeout(()=>{},60000)"]}`; click `[data-claude-account-signin]` →
  `[data-claude-signin-modal]` has a rendered terminal (an `.xterm` element under
  `[data-claude-signin-term]`), and the session sidebar's text has no "Claude sign-in". Shot
  `settings-claude-account-signin`. Click `[data-claude-signin-cancel]` → the modal is gone, the tab ids
  equal the recorded ones, and `claudeaccountlist()` is unchanged.
- step `signin-token`: set the override to a node one-liner that prints
  `Your token: sk-ant-oat01-fixtureSignin0` and `Store it safely`, then waits; open the modal → the label
  field `[data-claude-signin-label]` appears; save it as "Fixture S" → the row appears in the list and the
  tab ids equal the recorded ones.
- teardown: restore the setting and both localStorage keys, remove every account whose label starts with
  "Fixture" (`claudeaccountremove`), and delete the roster fixture if it is still there.

**Step 2: Run it** against the running dev app: `task verify:ui -- settings-claude-account usage-charts`.
Expected: PASS for both.

**Step 3: Docs.** CHANGELOG line under `Added`: "Switch the Claude account in Settings: sign in extra
subscriptions once, pick one, and new agents and the plan usage follow it." In
`docs/agents/usage-reporting.md` add a short "Several Claude accounts" paragraph: windows are kept per
account; the no-session quota is read only for Default, because a setup-token is refused by the usage
endpoint.

**Step 4: Commit**

```bash
git add scripts/cdp/scenarios.mjs CHANGELOG.md docs/agents/usage-reporting.md
git commit -m "test(cdp): Claude account settings scenario; changelog and usage docs"
```
