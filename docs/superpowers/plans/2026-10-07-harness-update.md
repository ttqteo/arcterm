# Harness update notice and one-click update: implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** arcterm notices when a newer Claude Code is published, says so once through Jarvis, and updates it from
Settings → About with one click.

**Architecture:** A new Go package `pkg/harnessupdate` reads each checkable harness's latest version from the npm
registry (`dist-tags.<channel>` of `https://registry.npmjs.org/<package>`, as the spec says), holds it in memory,
announces each new version once (persisted in the data dir), and runs the harness's own update command on request.
`ListHarnessesCommand` carries the latest version; a new `UpdateHarnessCommand` runs the update. The frontend shows
installed/latest per harness in Settings → About from a pure row-state model.

**Tech Stack:** Go (net/http, os/exec), wshrpc + `task generate`, React 19 + jotai, vitest, CDP scenario.

**Spec:** `docs/superpowers/specs/2026-10-07-harness-update-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/harness/... ./pkg/harnessupdate/... ./pkg/wshrpc/... ./pkg/wconfig/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: harness-update needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs harness-update`

---

### Task 1: Version parsing and comparison

**Depends on:** none

**Files:**
- Create: `pkg/harnessupdate/version.go`
- Test: `pkg/harnessupdate/version_test.go`

**Step 1: Write the failing test**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import "testing"

func TestParseVersion(t *testing.T) {
	cases := map[string][3]int{
		"2.1.292 (Claude Code)": {2, 1, 292},
		"v0.3.10":               {0, 3, 10},
		"  1.0.0\n":             {1, 0, 0},
	}
	for in, want := range cases {
		got, ok := ParseVersion(in)
		if !ok || got != want {
			t.Errorf("ParseVersion(%q) = %v, %v; want %v", in, got, ok, want)
		}
	}
	if _, ok := ParseVersion("claude: command not found"); ok {
		t.Error("a string with no x.y.z parsed")
	}
}

func TestNewer(t *testing.T) {
	if !Newer("2.1.300", "2.1.292 (Claude Code)") {
		t.Error("2.1.300 is newer than 2.1.292")
	}
	if !Newer("2.10.0", "2.9.9") {
		t.Error("compared as strings: 2.10.0 is newer than 2.9.9")
	}
	if Newer("2.1.292", "2.1.292 (Claude Code)") || Newer("2.1.291", "2.1.292") {
		t.Error("an equal or older version is not newer")
	}
	if Newer("", "2.1.292") || Newer("2.1.300", "") {
		t.Error("an unparsed side is never newer")
	}
}
```

**Step 2: Run it to see it fail**

Run: `go test ./pkg/harnessupdate -run 'TestParseVersion|TestNewer'`
Expected: FAIL, `undefined: ParseVersion`.

**Step 3: Implement**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Package harnessupdate notices a newer release of an installed coding-agent harness (the npm registry's dist-tags),
// announces each new version once, and runs the harness's own update command on request.

package harnessupdate

import (
	"regexp"
	"strconv"
)

var versionRe = regexp.MustCompile(`(\d+)\.(\d+)\.(\d+)`)

// ParseVersion reads the first x.y.z in s: "2.1.292 (Claude Code)", "v0.3.10".
func ParseVersion(s string) ([3]int, bool) {
	m := versionRe.FindStringSubmatch(s)
	if m == nil {
		return [3]int{}, false
	}
	var v [3]int
	for i := range v {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return [3]int{}, false
		}
		v[i] = n
	}
	return v, true
}

// Newer reports whether latest is a higher x.y.z than installed; false when either does not parse.
func Newer(latest, installed string) bool {
	l, ok1 := ParseVersion(latest)
	i, ok2 := ParseVersion(installed)
	if !ok1 || !ok2 {
		return false
	}
	for k := range l {
		if l[k] != i[k] {
			return l[k] > i[k]
		}
	}
	return false
}
```

**Step 4: Run it to see it pass**

Run: `go test ./pkg/harnessupdate -run 'TestParseVersion|TestNewer'` → PASS.

**Step 5: Commit**

```bash
git add pkg/harnessupdate/version.go pkg/harnessupdate/version_test.go
git commit -m "feat(harnessupdate): parse and compare harness versions"
```

### Task 2: Latest version from the npm registry, and Claude Code's channel

**Depends on:** none

**Files:**
- Create: `pkg/harnessupdate/registry.go`
- Test: `pkg/harnessupdate/registry_test.go`

**Step 1: Write the failing test**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func serveTags(t *testing.T, status int, body string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/@anthropic-ai%2Fclaude-code" {
			t.Errorf("path = %q", r.URL.EscapedPath())
		}
		if r.Header.Get("Accept") != abbreviatedDoc {
			t.Errorf("Accept = %q, want the abbreviated package document", r.Header.Get("Accept"))
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	orig := registryBase
	registryBase = srv.URL
	t.Cleanup(func() { registryBase = orig })
}

func TestLatestVersion_readsTheChannelTag(t *testing.T) {
	serveTags(t, 200, `{"name":"@anthropic-ai/claude-code","dist-tags":{"latest":"2.1.300","stable":"2.1.280","next":"2.2.0-beta.1"},"versions":{"2.1.300":{}}}`)
	for channel, want := range map[string]string{"latest": "2.1.300", "stable": "2.1.280"} {
		got, err := LatestVersion(context.Background(), "@anthropic-ai/claude-code", channel)
		if err != nil || got != want {
			t.Errorf("%s: got %q, %v; want %q", channel, got, err, want)
		}
	}
}

func TestLatestVersion_failsOnAMissingTagOrABadStatus(t *testing.T) {
	serveTags(t, 200, `{"dist-tags":{"latest":"2.1.300"}}`)
	if _, err := LatestVersion(context.Background(), "@anthropic-ai/claude-code", "stable"); err == nil {
		t.Error("a missing channel tag returned no error")
	}
	serveTags(t, 503, `oops`)
	if _, err := LatestVersion(context.Background(), "@anthropic-ai/claude-code", "latest"); err == nil {
		t.Error("a 503 returned no error")
	}
}

func TestClaudeChannel(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	orig := claudeSettingsPath
	claudeSettingsPath = func() string { return path }
	t.Cleanup(func() { claudeSettingsPath = orig })

	if got := ClaudeChannel(); got != "latest" {
		t.Errorf("no settings file: %q, want latest", got)
	}
	_ = os.WriteFile(path, []byte(`{"autoUpdatesChannel":"stable"}`), 0o644)
	if got := ClaudeChannel(); got != "stable" {
		t.Errorf("stable: %q", got)
	}
	_ = os.WriteFile(path, []byte(`{"autoUpdatesChannel":"weird"}`), 0o644)
	if got := ClaudeChannel(); got != "latest" {
		t.Errorf("an unknown channel: %q, want latest", got)
	}
}
```

**Step 2: Run it to see it fail**

Run: `go test ./pkg/harnessupdate -run 'TestLatestVersion|TestClaudeChannel'` → FAIL (undefined).

**Step 3: Implement**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const (
	fetchTimeout = 10 * time.Second
	// the package document lists every published version: Claude Code's runs to megabytes even abbreviated
	maxDocBytes = 32 << 20
	// npm's abbreviated package document: dist-tags and versions, without the readmes
	abbreviatedDoc = "application/vnd.npm.install-v1+json"
)

// registryBase is a seam for tests.
var registryBase = "https://registry.npmjs.org"

var httpClient = &http.Client{Timeout: fetchTimeout}

// LatestVersion is the version the package's dist-tag for channel points at, read from the package document
// (`https://registry.npmjs.org/<package>`).
func LatestVersion(ctx context.Context, pkg, channel string) (string, error) {
	u := registryBase + "/" + url.PathEscape(pkg)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", abbreviatedDoc)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("registry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry: %s for %s", resp.Status, pkg)
	}
	var doc struct {
		DistTags map[string]string `json:"dist-tags"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxDocBytes)).Decode(&doc); err != nil {
		return "", fmt.Errorf("registry: %w", err)
	}
	v := doc.DistTags[channel]
	if v == "" {
		return "", fmt.Errorf("registry: no %q tag for %s", channel, pkg)
	}
	return v, nil
}

// claudeSettingsPath is a seam for tests.
var claudeSettingsPath = func() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "settings.json")
}

// ClaudeChannel is the release channel Claude Code updates from: autoUpdatesChannel in ~/.claude/settings.json when it
// is "stable", else "latest" (Claude Code's own default).
func ClaudeChannel() string {
	b, err := os.ReadFile(claudeSettingsPath())
	if err != nil {
		return "latest"
	}
	var s struct {
		AutoUpdatesChannel string `json:"autoUpdatesChannel"`
	}
	if json.Unmarshal(b, &s) == nil && s.AutoUpdatesChannel == "stable" {
		return "stable"
	}
	return "latest"
}
```

**Step 4: Run it to see it pass**

Run: `go test ./pkg/harnessupdate` → PASS. `url.PathEscape` leaves `@` and escapes the scope's `/` as `%2F`, the
form the registry takes for a scoped package.

**Step 5: Commit**

```bash
git add pkg/harnessupdate/registry.go pkg/harnessupdate/registry_test.go
git commit -m "feat(harnessupdate): read a harness's latest version from the npm registry"
```

### Task 3: The check loop, the once-per-version notice, the setting, and `latestversion` on the wire

**Depends on:** Task 1, Task 2

**Files:**
- Modify: `pkg/harness/catalog.go` (Spec gains `NpmPackage`, `UpdateArgs`; claude fills both)
- Create: `pkg/harnessupdate/check.go`
- Test: `pkg/harnessupdate/check_test.go`
- Modify: `pkg/wconfig/settingsconfig.go` (after `HarnessPreferredModel`, line ~91)
- Modify: `pkg/wshrpc/wshrpctypes_jarvis.go` (`HarnessInfo`, line ~99)
- Modify: `pkg/wshrpc/wshserver/wshserver_jarvis.go` (`ListHarnessesCommand`, line ~188)
- Modify: `cmd/server/main-server.go` (rename `publishVaultNotice` → `publishNotice`; start the loop after
  `wavevault.StartSyncLoop`, line ~341)
- Regenerate: `task generate`

**Step 1: Catalog fields**

In `pkg/harness/catalog.go` add to `Spec`:

```go
	// NpmPackage is the package whose dist-tags say what the latest release is; "" when arcterm does not check it.
	NpmPackage string
	// UpdateArgs runs the harness's own updater (`<Bin> <UpdateArgs...>`); nil when arcterm cannot update it.
	UpdateArgs []string
```

and on the claude entry: `NpmPackage: "@anthropic-ai/claude-code", UpdateArgs: []string{"update"},`.

**Step 2: Write the failing test**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

type notice struct{ title, message, level string }

func stubCheck(t *testing.T, installed, latest string) *[]notice {
	t.Helper()
	origProbe, origLatest, origState := probeAll, latestVersion, statePath
	t.Cleanup(func() { probeAll, latestVersion, statePath = origProbe, origLatest, origState })
	spec, _ := harness.Lookup("claude")
	probeAll = func(context.Context) []harness.ProbeResult {
		return []harness.ProbeResult{{Spec: spec, Installed: installed != "", Version: installed}}
	}
	latestVersion = func(context.Context, string, string) (string, error) { return latest, nil }
	dir := t.TempDir()
	statePath = func() string { return filepath.Join(dir, "harness-updates.json") }
	resetLatest()
	var got []notice
	return &got
}

func TestCheck_announcesANewVersionOnce(t *testing.T) {
	got := stubCheck(t, "2.1.292 (Claude Code)", "2.1.300")
	notify := func(title, message, level string) { *got = append(*got, notice{title, message, level}) }
	Check(context.Background(), notify)
	Check(context.Background(), notify)
	if len(*got) != 1 {
		t.Fatalf("notices = %d, want 1: %+v", len(*got), *got)
	}
	// the spec's notice: "Claude Code 2.1.300 is out · Settings → About to update"
	if (*got)[0].title != "Claude Code 2.1.300 is out" || (*got)[0].message != "Settings → About to update" {
		t.Errorf("notice = %+v", (*got)[0])
	}
	if Latest("claude") != "2.1.300" {
		t.Errorf("Latest = %q", Latest("claude"))
	}
	// a restart (fresh memory, same state file) does not announce it again
	resetLatest()
	Check(context.Background(), notify)
	if len(*got) != 1 {
		t.Errorf("announced again after a restart: %+v", *got)
	}
}

func TestCheck_saysNothingWhenCurrentOrNotInstalled(t *testing.T) {
	for _, installed := range []string{"2.1.300 (Claude Code)", ""} {
		got := stubCheck(t, installed, "2.1.300")
		Check(context.Background(), func(title, message, level string) { *got = append(*got, notice{title, message, level}) })
		if len(*got) != 0 {
			t.Errorf("installed %q: notices %+v", installed, *got)
		}
	}
}
```

**Step 3: Run it to see it fail**

Run: `go test ./pkg/harnessupdate -run TestCheck` → FAIL (undefined).

**Step 4: Implement `pkg/harnessupdate/check.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	checkInterval = 6 * time.Hour
	// off the launch path: the first check waits for the app to settle
	firstCheckDelay = 30 * time.Second
)

// seams for tests
var (
	probeAll      = harness.ProbeAll
	latestVersion = LatestVersion
	statePath     = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "harness-updates.json") }
)

var (
	mu     sync.Mutex
	latest = map[string]string{} // runtime -> latest version, from the last check
)

func resetLatest() {
	mu.Lock()
	defer mu.Unlock()
	latest = map[string]string{}
}

// Latest is the newest version the last check saw for runtime, "" before one has.
func Latest(runtime string) string {
	mu.Lock()
	defer mu.Unlock()
	return latest[runtime]
}

func channelFor(runtime string) string {
	if runtime == "claude" {
		return ClaudeChannel()
	}
	return "latest"
}

// announced is the version each harness was last announced at, kept in the data dir so a restart does not repeat it.
func loadAnnounced() map[string]string {
	out := map[string]string{}
	if b, err := os.ReadFile(statePath()); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

func saveAnnounced(a map[string]string) {
	b, _ := json.Marshal(a)
	if err := os.WriteFile(statePath(), b, 0o644); err != nil {
		log.Printf("harnessupdate: saving announced versions: %v", err)
	}
}

// Check runs one pass: each installed harness with an NpmPackage gets its latest version read, and one newer than the
// installed version is announced through notify, once per version.
func Check(ctx context.Context, notify func(title, message, level string)) {
	announced := loadAnnounced()
	changed := false
	for _, r := range probeAll(ctx) {
		if !r.Installed || r.Spec.NpmPackage == "" {
			continue
		}
		v, err := latestVersion(ctx, r.Spec.NpmPackage, channelFor(r.Spec.Runtime))
		if err != nil {
			log.Printf("harnessupdate: %s: %v", r.Spec.Runtime, err)
			continue
		}
		mu.Lock()
		latest[r.Spec.Runtime] = v
		mu.Unlock()
		if Newer(v, r.Version) && announced[r.Spec.Runtime] != v {
			notify(fmt.Sprintf("%s %s is out", r.Spec.Label, v), "Settings → About to update", "info")
			announced[r.Spec.Runtime] = v
			changed = true
		}
	}
	if changed {
		saveAnnounced(announced)
	}
}

func shortVersion(s string) string {
	if v, ok := ParseVersion(s); ok {
		return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2])
	}
	return s
}

// StartLoop checks shortly after startup and then every checkInterval, while enabled says so.
func StartLoop(ctx context.Context, enabled func() bool, notify func(title, message, level string)) {
	go func() {
		defer func() { panichandler.PanicHandler("harnessupdate:loop", recover()) }()
		timer := time.NewTimer(firstCheckDelay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			if enabled() {
				cctx, cancel := context.WithTimeout(ctx, time.Minute)
				Check(cctx, notify)
				cancel()
			}
			timer.Reset(checkInterval)
		}
	}()
}
```

Check `panichandler.PanicHandler`'s signature in `pkg/panichandler` and match it (the vault loop in
`pkg/wavevault/syncloop.go` uses it).

**Step 5: Run it to see it pass**

Run: `go test ./pkg/harnessupdate ./pkg/harness` → PASS.

**Step 6: The setting**

In `pkg/wconfig/settingsconfig.go`, after `HarnessPreferredModel`:

```go
	HarnessUpdateCheck      *bool  `json:"harness:updatecheck,omitempty"`
```

and in `pkg/wconfig/defaultconfig/settings.json` add `"harness:updatecheck": true`.

**Step 7: On the wire**

In `HarnessInfo` (`pkg/wshrpc/wshrpctypes_jarvis.go`) add after `Version`:

```go
	LatestVersion     string                `json:"latestversion,omitempty"` // newest release the update check saw; "" before one, or for a harness it does not check
```

In `ListHarnessesCommand` set `LatestVersion: harnessupdate.Latest(r.Spec.Runtime),`.

**Step 8: Start the loop**

In `cmd/server/main-server.go` rename `publishVaultNotice` to `publishNotice` (definition and its use) and, after
`wavevault.StartSyncLoop(...)`:

```go
	harnessupdate.StartLoop(context.Background(), harnessUpdateCheckEnabled, publishNotice)
```

with, beside `publishNotice`:

```go
// harnessUpdateCheckEnabled reads harness:updatecheck at each check, so turning it off in Settings takes effect without
// a restart; unset is on.
func harnessUpdateCheckEnabled() bool {
	v := wconfig.GetWatcher().GetFullConfig().Settings.HarnessUpdateCheck
	return v == nil || *v
}
```

**Step 9: Regenerate and check**

Run: `task generate`, then `go build ./...` and `go test ./pkg/harnessupdate ./pkg/harness ./pkg/wconfig/...`.
Expected: build OK, tests PASS (`settingskeysync_test.go` passes once generate has run).

**Step 10: Commit**

```bash
git add pkg/harness/catalog.go pkg/harnessupdate/check.go pkg/harnessupdate/check_test.go pkg/wconfig cmd/server/main-server.go pkg/wshrpc frontend/types frontend/app/store schema
git commit -m "feat(harnessupdate): check for a newer Claude Code and announce it once"
```

### Task 4: `UpdateHarnessCommand`

**Depends on:** Task 3

**Files:**
- Create: `pkg/harnessupdate/update.go`
- Test: `pkg/harnessupdate/update_test.go`
- Modify: `pkg/wshrpc/wshrpctypes_jarvis.go` (interface near `ListHarnessesCommand`, line ~30; types near
  `CommandListHarnessesRtnData`)
- Modify: `pkg/wshrpc/wshserver/wshserver_jarvis.go`
- Regenerate: `task generate`

**Step 1: Write the failing test**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

func stubUpdate(t *testing.T, out string, err error, after string) *[]string {
	t.Helper()
	origRun, origProbe := runUpdate, probeAll
	t.Cleanup(func() { runUpdate, probeAll = origRun, origProbe })
	var argv []string
	runUpdate = func(_ context.Context, bin string, args []string) ([]byte, error) {
		argv = append([]string{bin}, args...)
		return []byte(out), err
	}
	spec, _ := harness.Lookup("claude")
	probeAll = func(context.Context) []harness.ProbeResult {
		return []harness.ProbeResult{{Spec: spec, Installed: true, Version: after}}
	}
	return &argv
}

func TestUpdate_runsTheHarnessUpdaterAndReadsTheNewVersion(t *testing.T) {
	argv := stubUpdate(t, "Successfully updated from 2.1.292 to 2.1.300\n", nil, "2.1.300 (Claude Code)")
	res, err := Update(context.Background(), "claude")
	if err != nil {
		t.Fatal(err)
	}
	if len(*argv) != 2 || (*argv)[0] != "claude" || (*argv)[1] != "update" {
		t.Errorf("ran %v", *argv)
	}
	if res.Version != "2.1.300" {
		t.Errorf("version = %q", res.Version)
	}
}

func TestUpdate_failsWithTheUpdatersLastLine(t *testing.T) {
	stubUpdate(t, "Checking for updates...\nError: EACCES permission denied\n", errors.New("exit status 1"), "2.1.292")
	_, err := Update(context.Background(), "claude")
	if err == nil || err.Error() != "Error: EACCES permission denied" {
		t.Errorf("err = %v", err)
	}
}

func TestUpdate_saysItTimedOut(t *testing.T) {
	stubUpdate(t, "", context.DeadlineExceeded, "2.1.292")
	_, err := Update(context.Background(), "claude")
	if !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "timed out after 5m0s") {
		t.Errorf("err = %v", err)
	}
}

func TestUpdate_refusesAHarnessWithNoUpdater(t *testing.T) {
	stubUpdate(t, "", nil, "")
	if _, err := Update(context.Background(), "codex"); err == nil {
		t.Error("codex has no update command and returned no error")
	}
}
```

**Step 2: Run it to see it fail**

Run: `go test ./pkg/harnessupdate -run TestUpdate` → FAIL (undefined).

**Step 3: Implement `pkg/harnessupdate/update.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

const updateTimeout = 5 * time.Minute

// runUpdate is a seam for tests.
var runUpdate = func(ctx context.Context, bin string, args []string) ([]byte, error) {
	return exec.CommandContext(ctx, bin, args...).CombinedOutput()
}

type UpdateResult struct {
	Version string // x.y.z after the update
}

// Update runs runtime's own updater and reads back the version it left installed. Running sessions keep the binary
// they started with: Claude Code's native updater moves the running executable aside rather than overwriting it.
func Update(ctx context.Context, runtime string) (UpdateResult, error) {
	spec, ok := harness.Lookup(runtime)
	if !ok || len(spec.UpdateArgs) == 0 {
		return UpdateResult{}, fmt.Errorf("arcterm cannot update %s", runtime)
	}
	ctx, cancel := context.WithTimeout(ctx, updateTimeout)
	defer cancel()
	out, err := runUpdate(ctx, spec.Bin, spec.UpdateArgs)
	if err != nil {
		// a killed updater's last line is whatever it was printing, not why it stopped; exec reports the kill as
		// "signal: killed", so the context says it was the timeout
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return UpdateResult{}, fmt.Errorf("%s update timed out after %s: %w", spec.Label, updateTimeout, context.DeadlineExceeded)
		}
		if line := lastLine(string(out)); line != "" {
			return UpdateResult{}, errors.New(line)
		}
		return UpdateResult{}, fmt.Errorf("%s update: %w", spec.Label, err)
	}
	for _, r := range probeAll(ctx) {
		if r.Spec.Runtime == runtime {
			return UpdateResult{Version: shortVersion(r.Version)}, nil
		}
	}
	return UpdateResult{}, nil
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}
```

**Step 4: Run it to see it pass**

Run: `go test ./pkg/harnessupdate` → PASS.

**Step 5: The RPC**

In `pkg/wshrpc/wshrpctypes_jarvis.go`, in the interface after `ListHarnessesCommand`:

```go
	UpdateHarnessCommand(ctx context.Context, data CommandUpdateHarnessData) (*CommandUpdateHarnessRtnData, error) // runs the harness's own updater (Settings → About)
```

and after `CommandListHarnessesRtnData`:

```go
type CommandUpdateHarnessData struct {
	Runtime string `json:"runtime"`
}

type CommandUpdateHarnessRtnData struct {
	Version string `json:"version"`
}
```

In `pkg/wshrpc/wshserver/wshserver_jarvis.go`:

```go
func (ws *WshServer) UpdateHarnessCommand(ctx context.Context, data wshrpc.CommandUpdateHarnessData) (*wshrpc.CommandUpdateHarnessRtnData, error) {
	res, err := harnessupdate.Update(ctx, data.Runtime)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandUpdateHarnessRtnData{Version: res.Version}, nil
}
```

**Step 6: Regenerate and check**

Run: `task generate`, `go build ./...`, `go test ./pkg/harnessupdate ./pkg/wshrpc/...` → OK.

**Step 7: Commit**

```bash
git add pkg/harnessupdate/update.go pkg/harnessupdate/update_test.go pkg/wshrpc frontend/app/store frontend/types
git commit -m "feat(harnessupdate): UpdateHarnessCommand runs the harness's own updater"
```

### Task 5: Settings → About shows each harness's version and updates it

**Depends on:** Task 4

**Files:**
- Create: `frontend/app/view/agents/harnessupdatemodel.ts`
- Test: `frontend/app/view/agents/harnessupdatemodel.test.ts`
- Create: `frontend/app/view/agents/harnessupdatestore.ts`
- Modify: `frontend/app/view/agents/settingsmodel.ts` (the `about` section's rows, line ~311)
- Test: `frontend/app/view/agents/settingsmodel.test.ts` (two tests the new About rows change, Step 6)
- Modify: `frontend/app/view/agents/settingssurface.tsx` (`AboutSection`, line ~1256)
- Modify: `CHANGELOG.md`

This task builds a view and its states. Task 6's `harness-update` scenario shows each, through the dev hooks Step 5
adds: step 1 the Claude Code row with its version, step 2 "999.0.0 available" with Update, step 3 "Updating…", step 4
"Updated to 999.0.0 · new sessions use it", step 5 a failed update's error with Update, step 6 "No harness installed.",
step 7 the "Check for harness updates" toggle writing `harness:updatecheck` and restoring it.

**Acceptance:** vitest passes for `harnessupdatemodel.test.ts` and `settingsmodel.test.ts`, `task check:ts` is clean,
and a dev build has the hooks `__setHarnessLatest`, `__setHarnessUpdateRun`, `__getHarnesses` and `__setHarnesses`
and the `data-harness-row`, `data-harness-update` and `data-harness-none` attributes, which Task 6's steps 1–7 use to
reach every state above.

**Step 1: Write the failing test**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { harnessRowState, rowLabel, shortVersion } from "./harnessupdatemodel";

const claude = (over: Partial<HarnessInfo> = {}): HarnessInfo =>
    ({ runtime: "claude", label: "Claude Code", installed: true, version: "2.1.292 (Claude Code)", ...over }) as HarnessInfo;

describe("shortVersion", () => {
    it("keeps the x.y.z", () => {
        expect(shortVersion("2.1.292 (Claude Code)")).toBe("2.1.292");
        expect(shortVersion("weird")).toBe("weird");
    });
});

describe("harnessRowState", () => {
    it("is null for a harness that is not installed", () => {
        expect(harnessRowState(claude({ installed: false }), undefined)).toBeNull();
    });
    it("is current with no newer release, available with one", () => {
        expect(harnessRowState(claude(), undefined)).toEqual({ kind: "current", version: "2.1.292" });
        expect(harnessRowState(claude({ latestversion: "2.1.292" }), undefined)).toEqual({ kind: "current", version: "2.1.292" });
        expect(harnessRowState(claude({ latestversion: "2.1.300" }), undefined)).toEqual({
            kind: "available",
            version: "2.1.292",
            latest: "2.1.300",
        });
    });
    it("follows a run: updating, then updated or failed", () => {
        const h = claude({ latestversion: "2.1.300" });
        expect(harnessRowState(h, { status: "running" }).kind).toBe("updating");
        expect(harnessRowState(h, { status: "done", version: "2.1.300" })).toEqual({ kind: "updated", version: "2.1.300" });
        expect(harnessRowState(h, { status: "failed", error: "EACCES" })).toEqual({
            kind: "failed",
            version: "2.1.292",
            latest: "2.1.300",
            error: "EACCES",
        });
    });
});

describe("rowLabel", () => {
    it("says what the row is doing", () => {
        expect(rowLabel({ kind: "available", version: "2.1.292", latest: "2.1.300" })).toBe("2.1.300 available");
        expect(rowLabel({ kind: "updating", version: "2.1.292", latest: "2.1.300" })).toBe("Updating…");
        expect(rowLabel({ kind: "updated", version: "2.1.300" })).toBe("Updated to 2.1.300 · new sessions use it");
    });
});
```

**Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/agents/harnessupdatemodel.test.ts` → FAIL (module not found).

**Step 3: Implement the model**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: a harness's row in Settings → About, from what ListHarnesses says (installed version, the latest release the
// update check saw) and the update the user started, if any. No React.

export interface UpdateRun {
    status: "running" | "done" | "failed";
    version?: string; // done: the version it left installed
    error?: string; // failed: the updater's last line
}

export type HarnessRowState =
    | { kind: "current"; version: string }
    | { kind: "available"; version: string; latest: string }
    | { kind: "updating"; version: string; latest?: string }
    | { kind: "updated"; version: string }
    | { kind: "failed"; version: string; latest?: string; error: string };

const X_Y_Z = /(\d+)\.(\d+)\.(\d+)/;

export function shortVersion(v: string | undefined): string {
    return X_Y_Z.exec(v ?? "")?.[0] ?? v ?? "";
}

function newer(latest: string, installed: string): boolean {
    const l = X_Y_Z.exec(latest);
    const i = X_Y_Z.exec(installed);
    if (l == null || i == null) {
        return false;
    }
    for (let k = 1; k <= 3; k++) {
        if (Number(l[k]) !== Number(i[k])) {
            return Number(l[k]) > Number(i[k]);
        }
    }
    return false;
}

export function harnessRowState(h: HarnessInfo, run: UpdateRun | undefined): HarnessRowState | null {
    if (!h.installed) {
        return null;
    }
    const version = shortVersion(h.version);
    const latest = h.latestversion && newer(h.latestversion, version) ? h.latestversion : undefined;
    if (run?.status === "running") {
        return { kind: "updating", version, latest };
    }
    if (run?.status === "done") {
        return { kind: "updated", version: run.version || version };
    }
    if (run?.status === "failed") {
        return { kind: "failed", version, latest, error: run.error ?? "Update failed" };
    }
    return latest ? { kind: "available", version, latest } : { kind: "current", version };
}

export function rowLabel(s: HarnessRowState): string {
    switch (s.kind) {
        case "current":
            return s.version;
        case "available":
            return `${s.latest} available`;
        case "updating":
            return "Updating…";
        case "updated":
            return `Updated to ${s.version} · new sessions use it`;
        case "failed":
            return s.error;
    }
}
```

**Step 4: Run it to see it pass**

Run: `npx vitest run frontend/app/view/agents/harnessupdatemodel.test.ts` → PASS.

**Step 5: The store**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The updates started from Settings → About, by runtime (harnessupdatemodel.ts reads them), and the dev hooks the
// harness-update scenario uses to stand in a newer release, each update state, and an empty install list.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { UpdateRun } from "./harnessupdatemodel";
import { harnessesAtom, loadHarnesses } from "./harnessstore";

// the updater downloads a release: the server allows it 5 minutes, the wire a little more
const UPDATE_RPC_TIMEOUT_MS = 330_000;

export const updateRunsAtom = atom<Record<string, UpdateRun>>({}) as PrimitiveAtom<Record<string, UpdateRun>>;

function setRun(runtime: string, run: UpdateRun) {
    globalStore.set(updateRunsAtom, (prev) => ({ ...prev, [runtime]: run }));
}

export async function updateHarness(runtime: string): Promise<void> {
    setRun(runtime, { status: "running" });
    try {
        const rtn = await RpcApi.UpdateHarnessCommand(TabRpcClient, { runtime }, { timeout: UPDATE_RPC_TIMEOUT_MS });
        setRun(runtime, { status: "done", version: rtn?.version });
        await loadHarnesses();
    } catch (e) {
        setRun(runtime, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
}

if (import.meta.env.DEV) {
    const w = window as any;
    w.__setHarnessLatest = (runtime: string, latest: string) =>
        globalStore.set(harnessesAtom, (prev) =>
            prev.map((h) => (h.runtime === runtime ? { ...h, latestversion: latest } : h))
        );
    // a row state without running the real updater; null clears it
    w.__setHarnessUpdateRun = (runtime: string, run: UpdateRun | null) =>
        globalStore.set(updateRunsAtom, (prev) => {
            const next = { ...prev };
            if (run == null) {
                delete next[runtime];
            } else {
                next[runtime] = run;
            }
            return next;
        });
    // snapshot and restore the install list, so a scenario can show "No harness installed." and put it back
    w.__getHarnesses = () => globalStore.get(harnessesAtom);
    w.__setHarnesses = (list: HarnessInfo[]) => globalStore.set(harnessesAtom, list);
}
```

`harnessesAtom` is a plain writable `atom<HarnessInfo[]>([])` in `harnessstore.ts` (line 27).

**Step 6: The About rows**

In `settingsmodel.ts`, in the `about` section's `rows` after `about.platform`:

```ts
                {
                    id: "about.harnesses",
                    title: "Coding agents",
                    desc: "Installed harnesses, their versions, and the latest release when one is newer.",
                    key: "harness:*",
                },
                {
                    id: "about.updatecheck",
                    title: "Check for harness updates",
                    desc: "Asks the npm registry every 6 hours and says once when a newer release is out.",
                    key: "harness:updatecheck",
                    scope: "synced",
                    config: true,
                },
```

(`terminal.copyonselect` is the model: a synced config row with a Toggle.)

The two rows change two tests in `settingsmodel.test.ts`; update them, don't delete them:

- "leaves read-only build info without a provenance scope" (line ~120): About now holds one setting. Keep the claim
  for the build-info rows and pin the setting's scope:

```ts
    it("leaves read-only build info without a provenance scope", () => {
        const about = sections().find((s) => s.id === "about")!;
        const info = about.rows.filter((r) => r.id !== "about.updatecheck");
        expect(info.every((r) => r.scope === undefined)).toBe(true);
        expect(about.rows.find((r) => r.id === "about.updatecheck")!.scope).toBe("synced");
    });
```

- "marks exactly the wconfig-backed rows as config rows" (line ~125): append `"harness:updatecheck"` after
  `"headless:openroutermidmodel"` (About is the last section).

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts` → PASS.

In `settingssurface.tsx`, add above `AboutSection`:

```tsx
// one row per installed harness: its version, and when a newer release is out, an Update button (harnessupdatemodel.ts)
function HarnessVersions() {
    const harnesses = useAtomValue(harnessesAtom);
    const runs = useAtomValue(updateRunsAtom);
    useEffect(() => {
        if (harnesses.length === 0) {
            fireAndForget(() => loadHarnesses());
        }
    }, []);
    const rows = harnesses.flatMap((h) => {
        const state = harnessRowState(h, runs[h.runtime]);
        return state == null ? [] : [{ h, state }];
    });
    if (rows.length === 0) {
        return (
            <span data-harness-none className="text-[12.5px] text-muted">
                No harness installed.
            </span>
        );
    }
    return (
        <div className="flex flex-col divide-y divide-border rounded border border-edge-mid bg-surface-raised">
            {rows.map(({ h, state }) => (
                <div key={h.runtime} data-harness-row={h.runtime} className="flex items-center gap-3 px-3 py-[7px]">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-primary">{h.label}</span>
                    <span className="text-[12px] tabular-nums text-muted">{state.version}</span>
                    {state.kind !== "current" ? (
                        <span
                            className={cn(
                                "max-w-[260px] truncate text-[12px]",
                                state.kind === "failed" ? "text-error" : "text-accent-soft"
                            )}
                            title={rowLabel(state)}
                        >
                            {rowLabel(state)}
                        </span>
                    ) : null}
                    {state.kind === "available" || state.kind === "failed" ? (
                        <button
                            type="button"
                            data-harness-update={h.runtime}
                            onClick={() => fireAndForget(() => updateHarness(h.runtime))}
                            className="flex-none cursor-pointer rounded-[6px] border border-edge-strong bg-surface px-[10px] py-[3px] text-[12px] font-semibold text-secondary hover:border-accent hover:text-accent-soft"
                        >
                            Update
                        </button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}
```

and in `AboutSection`, after the `about.platform` row:

```tsx
            <SettingRow id="about.harnesses" stacked>
                <HarnessVersions />
            </SettingRow>
            <SettingRow id="about.updatecheck">
                <Toggle
                    on={updateCheck}
                    onToggle={() => writeConfig({ "harness:updatecheck": !updateCheck })}
                    label="Check for harness updates"
                />
            </SettingRow>
```

with `const updateCheck = (useAtomValue(getSettingsKeyAtom("harness:updatecheck")) as boolean) ?? true;` at the top of
`AboutSection`. Import what is missing (`harnessesAtom`, `loadHarnesses` from `./harnessstore`; `updateRunsAtom`,
`updateHarness` from `./harnessupdatestore`; `harnessRowState`, `rowLabel` from `./harnessupdatemodel`; `useEffect`;
`fireAndForget`). Colors are `@theme` tokens only (DESIGN.md).

**Step 7: Check**

Run: `task check:ts` (allow ~3 minutes),
`npx vitest run frontend/app/view/agents/harnessupdatemodel.test.ts frontend/app/view/agents/settingsmodel.test.ts`,
`npx eslint` and `npx prettier --check` on the files you touched. Expected: clean.

**Step 8: CHANGELOG and commit**

Under `## Unreleased` → `### Added` (open the heading if missing):

```markdown
- **Claude Code updates.** arcterm checks for a newer Claude Code every 6 hours and Jarvis says once when one is out.
  Settings → About lists each installed harness with its version, and Update installs the new one; open sessions keep
  theirs until they restart. Turn the check off with "Check for harness updates".
```

```bash
git add frontend/app/view/agents/harnessupdatemodel.ts frontend/app/view/agents/harnessupdatemodel.test.ts frontend/app/view/agents/harnessupdatestore.ts frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingsmodel.test.ts frontend/app/view/agents/settingssurface.tsx CHANGELOG.md
git commit -m "feat(settings): harness versions and one-click update in About"
```

### Task 6: The `harness-update` CDP scenario

**Depends on:** Task 5

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (a new scenario object, registered in the exported list near
  `terminalTheme,` at line ~16509)

**Step 1: Write the scenario**

Model it on `terminalTheme` (line ~4482) and the Settings navigation at line ~5559:

```js
// --- Settings → About: harness versions and the Update button ------------------------------------
// The update check reads the npm registry and Update runs the real updater, which a scenario must not depend on: the
// dev hooks in harnessupdatestore.ts stand in a newer release for claude, each update state, and an empty install list.
const harnessUpdate = {
    name: "harness-update",
    surface: "settings",
    async arrange(h) {
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        await h.goto("settings");
        await h.ev(`(() => { document.querySelector('[data-section="about"]')?.click(); return true; })()`);
        // HarnessVersions loads ListHarnesses on mount (CATALOG_RPC_TIMEOUT_MS, 30 s); injecting before that load lands
        // would be overwritten by it
        let rowLoaded = false;
        for (let waited = 0; waited < 35_000 && !rowLoaded; waited += 250) {
            rowLoaded = await h.ev(`!!document.querySelector('[data-harness-row="claude"]')`);
            if (!rowLoaded) await settle(250);
        }
        const hooked = await h.ev(
            `["__setHarnessLatest", "__setHarnessUpdateRun", "__getHarnesses", "__setHarnesses"].every((k) => typeof window[k] === "function")`
        );
        if (hooked) {
            await h.ev(`window.__setHarnessLatest("claude", "999.0.0")`);
            await settle(300);
        }
        return { hooked, rowLoaded };
    },
    async assert(h, ctx) {
        const steps = [];
        const settle = (ms) => h.ev(`new Promise((r) => setTimeout(r, ${ms}))`);
        // the harness's goto ran after arrange: select About again
        await h.ev(`(() => { document.querySelector('[data-section="about"]')?.click(); return true; })()`);
        await settle(300);
        const readRow = () =>
            h.ev(`(() => {
                const r = document.querySelector('[data-harness-row="claude"]');
                return r ? { text: r.textContent || "", update: !!r.querySelector('[data-harness-update="claude"]') } : null;
            })()`);
        const showRow = async (shot) => {
            await h.ev(`document.querySelector('[data-harness-row="claude"]')?.scrollIntoView({ block: "center" })`);
            await h.shot(shot);
        };
        const setRun = async (run) => {
            await h.ev(`window.__setHarnessUpdateRun("claude", ${JSON.stringify(run)})`);
            await settle(200);
        };

        const row = await readRow();
        steps.push({
            step: "1. About lists Claude Code with its installed version",
            ok: row != null && /\d+\.\d+\.\d+/.test(row.text),
            detail: JSON.stringify({ rowLoaded: ctx.rowLoaded, row }),
        });
        steps.push({
            step: "2. a newer release shows as available with an Update button",
            ok: ctx.hooked === true && row != null && row.text.includes("999.0.0 available") && row.update === true,
            detail: JSON.stringify({ hooked: ctx.hooked, row }),
        });
        await showRow("cdp-shots/harness-update.png");
        if (!ctx.hooked) {
            return steps;
        }

        await setRun({ status: "running" });
        const updating = await readRow();
        steps.push({
            step: "3. a running update reads Updating… and offers no Update button",
            ok: updating != null && updating.text.includes("Updating…") && updating.update === false,
            detail: JSON.stringify(updating),
        });
        await showRow("cdp-shots/harness-update-updating.png");

        await setRun({ status: "done", version: "999.0.0" });
        const updated = await readRow();
        steps.push({
            step: "4. a finished update reads Updated to 999.0.0 · new sessions use it",
            ok:
                updated != null &&
                updated.text.includes("Updated to 999.0.0 · new sessions use it") &&
                updated.update === false,
            detail: JSON.stringify(updated),
        });
        await showRow("cdp-shots/harness-update-updated.png");

        await setRun({ status: "failed", error: "Error: EACCES permission denied" });
        const failed = await readRow();
        steps.push({
            step: "5. a failed update shows the updater's error and offers Update again",
            ok: failed != null && failed.text.includes("Error: EACCES permission denied") && failed.update === true,
            detail: JSON.stringify(failed),
        });
        await showRow("cdp-shots/harness-update-failed.png");
        await setRun(null);

        await h.ev(`(() => {
            window.__harnessUpdateSnapshot = window.__getHarnesses();
            window.__setHarnesses(window.__harnessUpdateSnapshot.map((x) => ({ ...x, installed: false })));
            return true;
        })()`);
        await settle(200);
        const none = await h.ev(`(() => {
            const text = document.querySelector("[data-harness-none]")?.textContent ?? "";
            return { anyRow: !!document.querySelector("[data-harness-row]"), says: text.includes("No harness installed.") };
        })()`);
        steps.push({
            step: "6. with nothing installed, About says No harness installed.",
            ok: none.anyRow === false && none.says === true,
            detail: JSON.stringify(none),
        });
        await h.shot("cdp-shots/harness-update-none.png");
        await h.ev(`(() => { window.__setHarnesses(window.__harnessUpdateSnapshot); return true; })()`);
        await settle(200);

        // the toggle writes harness:updatecheck through SetConfig; read it back from the backend, then put it back
        const toggleSel = `[role="switch"][aria-label="Check for harness updates"]`;
        const readSetting = async () => {
            const cfg = await h.rpc("getfullconfig", null);
            return cfg?.settings?.["harness:updatecheck"];
        };
        const before = await h.ev(`document.querySelector('${toggleSel}')?.getAttribute("aria-checked") ?? null`);
        await h.ev(`document.querySelector('${toggleSel}')?.click()`);
        await settle(600); // wait for SetConfigCommand to persist
        const flipped = await readSetting();
        await h.ev(`document.querySelector('${toggleSel}')?.click()`);
        await settle(600);
        const restored = await readSetting();
        steps.push({
            step: "7. the Check for harness updates toggle writes harness:updatecheck and restores it",
            ok:
                (before === "true" || before === "false") &&
                flipped === (before !== "true") &&
                restored === (before === "true"),
            detail: JSON.stringify({ before, flipped, restored }),
        });
        return steps;
    },
    async teardown(h) {
        await h.ev(`(() => {
            window.__setHarnessUpdateRun?.("claude", null);
            if (window.__harnessUpdateSnapshot) window.__setHarnesses(window.__harnessUpdateSnapshot);
            delete window.__harnessUpdateSnapshot;
            return true;
        })()`);
        await h.goto("cockpit");
    },
};
```

Do **not** click Update in the scenario: it would run the real updater. Steps 3–5 set the row state through
`__setHarnessUpdateRun` instead.

`scripts/cdp/verify.mjs` calls `h.goto(scenario.surface)` after `arrange`, so the scenario names `surface:
"settings"` and selects About again in `assert`. The Settings nav renders `data-section="<id>"` on each section button
(`route-picker-flat` clicks `[data-section="run"]` the same way). `arrange` waits for the `ListHarnesses` load (up to
its 30 s `CATALOG_RPC_TIMEOUT_MS`) to render the claude row before injecting, or that load would overwrite the injected
`latestversion`. `settle` is defined in each function, as the other scenarios do. If this machine has no `claude` on
PATH, steps 1–5 fail by design; say so in the report rather than weakening the assertion.

**Step 2: Register and run**

Add `harnessUpdate,` to the exported scenario list. With the dev app running: `task verify:ui -- harness-update`.
Expected: steps 1–7 PASS, `cdp-shots/harness-update.png` shows the Claude Code row with "999.0.0 available" and
Update, and `harness-update-updating.png`, `-updated.png`, `-failed.png` and `-none.png` show the other states.

**Step 3: Commit**

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(cdp): harness-update scenario for Settings → About"
```
