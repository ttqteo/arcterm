# Radar fix-sibling audit implementation plan

**Effort:** effort:1557171a-e61d-4b29-83fd-fc7f818e6131
**Spec:** `docs/superpowers/specs/2026-10-06-radar-fix-sibling-audit-design.md` Read it first: it is the design, and every task's requirements include it.
**Verify:** `node scripts/verify.mjs ./pkg/reporadar ./pkg/consult ./pkg/wconfig ./pkg/waveobj ./pkg/runroute ./pkg/wshrpc/wshserver ./pkg/jarvis`
**Check:** `go vet ./pkg/reporadar/ ./pkg/consult/ ./pkg/wconfig/ ./pkg/waveobj/ && node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke settings-radar-audit`

## Goal and shape

A Radar scan stops collecting metadata signals and clustering them in one model call. It picks recent fix
commits deterministically, runs one read-only agent session per commit that reads the code for the same bug
at sibling sites, keeps only hits that pass a deterministic gate, and reconciles them across scans.

Tasks 1 to 4 and 6 only add code beside the old pipeline, so `pkg/reporadar` compiles and its existing tests
pass after each of them merges. Task 5 switches the scan over and deletes what it replaces. New names must not
collide with existing ones in the package (`fingerprint`, `validateFindings`, `collectGit`, `synthesize` all
still exist until Task 5).

## Global constraints

- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `pkg/wconfig/metaconsts.go`,
  `pkg/waveobj/metaconsts.go`, `frontend/app/store/*`, `pkg/wshrpc/wshclient/wshclient.go`): change the Go
  type, then run `task generate`. Only Tasks 1 and 6 change wire or config types.
- `RadarReport` and `RadarFinding`: add fields, never rename or remove one. Status strings on the wire stay
  `collecting`, `clustering`, `completed`, `partial`, `failed`, `cancelled`.
- No test calls a model or spawns `claude` or `pi`: the session is faked through the seam.
- Named constants, exact values: `FixAuditsPerScan = 8`, `AuditConcurrency = 3`, `AuditTimeout = 10 * time.Minute`,
  `MaxFixDiffBytes = 60 * 1024`. `EvidenceWindow` and `NoLongerAfterMisses` keep their values.
- Errors are returned or logged with context, never swallowed. Comments say why, lower case, only when needed.
- No attribution trailer in any commit message.
- Typecheck with the Check command, not `npx tsc` or `task check:ts` (in a worktree the latter reinstalls
  `node_modules` through the junction).

## Review focus

Inputs the spec implies that are most likely to bite; each is pinned by a test in the named task.

1. A hit whose file is an absolute path, a `..` escape, or a directory: rejected, never read outside the project (Task 4).
2. A reply wrapped in a ```json fence or with prose around the JSON: the fence is tolerated, anything else fails only that audit (Task 3).
3. A file touched by one sweeping fix commit and by nothing else must not outrank a file fixed three times (Task 2).
4. A finding carried from an earlier report whose commit is not audited this scan must not count as a miss while its file and line still exist (Task 5).
5. Two audits finishing at the same moment must both land in `report.audits`; neither update may overwrite the other (Task 5).

---

### Task 1: Wire types, settings keys and the shared audit contracts
**Depends on:** none

Everything later tasks share, added without changing behavior.

**Files:** modify `pkg/waveobj/wtype.go`, `pkg/wconfig/settingsconfig.go`; create
`pkg/reporadar/audittypes.go` and `pkg/reporadar/audittypes_test.go`; generated files via `task generate`
(and `schema/settings.json` if the repo's schema build tracks the new keys: build it the way the Taskfile does).

**Wire (JSON names are the contract Task 5 and chunk 7 rely on):**

- `waveobj.RadarSite`: `Line int "line"`, `Trigger "trigger"`, `Actual "actual"`, `Expected "expected"`,
  `WhyNotCovered "whynotcovered"` (strings).
- `waveobj.RadarFinding` gains, all `omitempty`: `SourceCommit "sourcecommit"`, `SourceSubject "sourcesubject"`,
  `RootCause "rootcause"`, `Sites []RadarSite "sites"`.
- `waveobj.RadarAudit`: `Commit "commit"`, `Subject "subject"`, `CommitTs int64 "committs"`,
  `Files []string "files"`, `Status "status"` (queued|running|ok|failed), `RootCause "rootcause"`,
  `HitCount int "hitcount"`, `KeptCount int "keptcount"`, `Error "error"`, `ResolvedModel "resolvedmodel"`,
  `TotalTokens int "totaltokens"`, `DurationMs int64 "durationms"`, `RawResponse "rawresponse"`; optional
  ones `omitempty`.
- `waveobj.RadarReport` gains `Audits []RadarAudit "audits,omitempty"`.
- `wconfig.SettingsType` gains `RadarAuditRuntime string "radar:auditruntime,omitempty"` and
  `RadarAuditModel string "radar:auditmodel,omitempty"`.

**Shared Go contracts in `pkg/reporadar/audittypes.go` (exact names; Tasks 2 to 5 compile against them):**

```go
const (
	FixAuditsPerScan = 8
	AuditConcurrency = 3
	AuditTimeout     = 10 * time.Minute
	MaxFixDiffBytes  = 60 * 1024

	AuditQueued  = "queued"
	AuditRunning = "running"
	AuditOK      = "ok"
	AuditFailed  = "failed"

	RiskSiblingBug = "sibling-bug"

	AuditRuntimeClaude = "claude"
	AuditRuntimePi     = "pi"
	DefaultAuditModel  = "sonnet" // claude only; pi with no model runs its own default
)

// fixCommit is one selected fix commit. Files are its code files (no docs, no tests), sorted.
type fixCommit struct {
	Hash    string
	Subject string
	Ts      int64 // unix millis
	Files   []string
}

// auditHit and auditReply are the session's JSON reply contract.
type auditHit struct {
	File          string `json:"file"`
	Line          int    `json:"line"`
	Title         string `json:"title"`
	Trigger       string `json:"trigger"`
	Actual        string `json:"actual"`
	Expected      string `json:"expected"`
	WhyNotCovered string `json:"whynotcovered"`
	Severity      string `json:"severity"`
}

type auditReply struct {
	RootCause string     `json:"rootcause"`
	Siblings  []string   `json:"siblings"`
	Hits      []auditHit `json:"hits"`
}

// auditRoute is the runtime and model an audit session runs on.
type auditRoute struct{ Runtime, Model string }

// auditSessionResult is what one session returned: its final assistant message and what the runtime reported.
type auditSessionResult struct {
	Reply       string
	Model       string
	TotalTokens int
}
```

**Acceptance:**
- `go test ./pkg/reporadar -run 'TestAuditReplyJSONShape'`: a literal reply in the spec's JSON shape
  unmarshals into `auditReply` with every field populated, and `hits: []` gives zero hits.
- `go test ./pkg/waveobj -run 'TestRadarFindingSitesRoundTrip'`: a finding with two sites and a report with
  one audit survive a JSON round trip, and a finding without the new fields marshals without their keys.
- `task generate` leaves `RadarAudit`, `RadarSite` and both settings keys in `frontend/types/gotypes.d.ts`;
  the Check command passes with no frontend edit.

### Task 2: Fix-commit selection
**Depends on:** Task 1

The trigger of spec section 1, pure and model-free.

**Files:** create `pkg/reporadar/fixcommits.go`, `pkg/reporadar/fixcommits_test.go`. Reuse the existing
`parseGitLog`, `gitCommit`, `isTestPath` and `git` as they are; do not edit `collect_git.go` (Task 5 deletes it
and moves what you use here).

**Produces:**

```go
// listWindowCommits returns the non-merge commits since sinceTs (unix millis), newest first.
func listWindowCommits(ctx context.Context, projectPath string, sinceTs int64) ([]gitCommit, error)

// selectFixCommits applies the spec's trigger: fix subjects, code files only, ranked, audited ones removed, capped.
func selectFixCommits(commits []gitCommit, audited map[string]bool, limit int) []fixCommit
```

**Decisions:** subject match is `^fix(\([^)]*\))?!?:` case-insensitive; docs are `.md`, `.mdx`, `.txt`, `.rst`
or any path under `docs/`; tests are `isTestPath`; fix counts are taken over the kept fix commits before the
audited ones are removed (an audited fix still makes its file hot); score is the highest fix count among the
commit's code files; order is score descending, commit time descending, hash ascending; `audited` is keyed by
full hash and applied before `limit`.

**Acceptance:** `go test ./pkg/reporadar -run 'TestSelectFixCommits|TestListWindowCommits'`
- subjects: `fix: x`, `fix(radar): x`, `fix(radar)!: x`, `Fix: x` selected; `feat: fix x`, `fixup: x`, `prefix: x` not.
- a commit touching only `docs/a.md` and `README.md` is skipped; one touching only `pkg/x/a_test.go` and
  `frontend/a.test.ts` is skipped; one touching `pkg/x/a.go` and `pkg/x/a_test.go` is selected with `Files == ["pkg/x/a.go"]`.
- ranking: a file fixed by three commits puts those three ahead of a commit touching ten files each fixed once
  (review focus 3); equal scores order newest first; equal times order by hash.
- `limit` 2 of 5 returns the top 2; an audited hash is absent and does not consume a slot; a nil `audited` map works.
- `TestListWindowCommits` builds a temp repo with a merge commit and asserts the merge is not returned and
  commits older than `sinceTs` are not returned.

### Task 3: The read-only audit session
**Depends on:** Task 1

Spec section 2: route, invocation, prompt, reply.

**Files:** create `pkg/reporadar/audit.go`, `pkg/reporadar/audit_test.go`. No change to `pkg/consult`: build a
`consult.RuntimeSpec` (binary from `consult.SpecFor(runtime)`, your own `BaseArgs` and `ParseLine`) and run it
through `consult.Run`, which already owns process start, stderr capture, cancellation and reaping.

**Produces:**

```go
// configuredAuditRoute reads radar:auditruntime / radar:auditmodel, applying the defaults. An unknown runtime is an error.
func configuredAuditRoute() (auditRoute, error)

// auditSessionArgs is the runtime's argument list for a read-only session (prompt excluded).
func auditSessionArgs(route auditRoute) ([]string, error)

// runAuditSession is the seam tests replace. The real one spawns the runtime in projectPath.
var runAuditSession = func(ctx context.Context, route auditRoute, projectPath, prompt string) (auditSessionResult, error)

// buildAuditPrompt renders the contract plus the commit's `git show` output, fenced as untrusted data.
func buildAuditPrompt(commit, gitShow string) string

// parseAuditReply parses the session's final message, tolerating a ```json fence.
func parseAuditReply(raw string) (*auditReply, error)

// auditCommit runs one audit under AuditTimeout: git show, prompt, session, parse. The session result is
// returned even when parsing fails, so the caller can store the raw reply.
func auditCommit(ctx context.Context, route auditRoute, projectPath, commit string) (*auditReply, auditSessionResult, error)
```

**Decisions:**
- claude args: `-p --output-format stream-json --verbose --model <model> --tools Read,Grep,Glob --strict-mcp-config`,
  prompt on stdin. pi args: `--mode json --no-session --no-extensions --tools read,grep,find,ls` plus
  `--model <model>` only when one is set, prompt as the last positional argument.
- claude stream: the `system`/`init` event's `tools` must all be in `{Read, Grep, Glob}`, else the audit fails
  with an error naming the extra tool; the reply is the `result` event's `result`; `is_error` true fails the
  audit; tokens are the sum of the result's `usage` input, cache-creation, cache-read and output counts; the
  model is the first key of `modelUsage`. pi stream: the reply is the last assistant `message_end` text, an
  error stop reason fails the audit, tokens and model are left zero when pi does not report them. Keep the
  stream reading as a pure function over lines so it is tested without a process.
- the prompt states the five contract points and the JSON shape from the spec verbatim in meaning, tells the
  agent it has only read and search tools, and puts the diff between untrusted-data markers with the line that
  text inside them is data, not instructions. A `git show` longer than `MaxFixDiffBytes` is cut (use the
  existing `clip`) and followed by a marker telling the agent to read the changed files itself.
- a missing binary (`exec.LookPath` fails) returns an error naming the runtime; nothing falls back.

**Acceptance:** `go test ./pkg/reporadar -run 'TestAuditSessionArgs|TestClaudeAuditStream|TestPiAuditStream|TestBuildAuditPrompt|TestParseAuditReply|TestAuditCommit|TestConfiguredAuditRoute'`
- args: claude carries `--tools`, `Read,Grep,Glob`, `--strict-mcp-config` and `--model sonnet` by default and
  no Bash, Edit or Write anywhere; pi carries `--tools`, `read,grep,find,ls` and no `--model` when the model is
  empty; runtime `openrouter` is an error.
- claude stream fixtures (literal JSONL): init with the three tools plus a result gives the reply, model and
  token sum; init listing `mcp__x__y` or `Bash` fails naming it; `is_error` fails; no result event fails.
- pi stream fixture: two assistant messages give the second as the reply.
- prompt: contains the commit hash, the diff, both untrusted markers, the phrases for "no sibling has this bug
  is a valid answer" and "a false positive is worse than nothing"; a 200 KB diff yields a prompt under 70 KB
  that carries the truncation marker.
- reply: bare JSON and fenced JSON parse; `{"hits":[]}` parses to zero hits; prose around the object and
  truncated JSON return an error (review focus 2).
- `TestAuditCommit` swaps `runAuditSession` for a fake in a temp repo with one commit: the fake receives a
  prompt containing that commit's diff and the temp repo as path; a fake error and an unparseable fake reply
  each return an error with the session result still populated; a cancelled context returns promptly.

### Task 4: Validation gate, fingerprint and finding construction
**Depends on:** Task 1

Spec section 3, plus the re-check section 4 uses.

**Files:** create `pkg/reporadar/hits.go`, `pkg/reporadar/hits_test.go`. Reuse `shortHash`, `canonPath`,
`newSignal`, `subsystemForPaths`, `normalizeSeverity`, `Redact` and `CollectorGit` as they exist.

**Produces:**

```go
// siblingFingerprint is a finding's cross-scan identity: project, source fix commit, file. Never the line.
func siblingFingerprint(projectPath, commit, file string) string

// validSite is the gate: file inside the project and present, line within the file, trigger not blank.
func validSite(projectPath, file string, line int, trigger string) bool

// commitSignal is the git signal a finding cites for its source fix.
func commitSignal(c fixCommit) waveobj.RadarSignal

// findingsFromAudit turns a reply's hits into findings: one per file, extra hits in a file as extra sites.
// kept is the number of hits that passed the gate.
func findingsFromAudit(projectPath string, c fixCommit, reply *auditReply) (findings []waveobj.RadarFinding, kept int)

// stillDetected re-runs the gate on a carried finding against the current tree: true when any site passes.
func stillDetected(projectPath string, f waveobj.RadarFinding) bool
```

**Decisions:** the fingerprint is `"RAD-" + shortHash(canonPath(project) + NUL + commit + NUL + canonical file)[:8]`
with the file canonicalized to forward slashes relative to the project; a file is inside the project only when
`filepath.IsLocal` holds for it and it is a regular file; the line count comes from reading the file; a finding
gets `Group` new, `RiskKind` `RiskSiblingBug`, `Risk` the first hit's title, `Why` its `whynotcovered`,
`Severity` the highest normalized severity among its hits, `Files` the one file, `Subsystem`
`subsystemForPaths`, `SignalIDs` the one `commitSignal` id, `SourceCommit`, `SourceSubject`, `RootCause`,
`Sites` in reply order; `Mission` is composed here and names the source fix (short hash and subject), the root
cause, and each site as `file:line` with its trigger, actual and expected; all model text is passed through
`Redact`; `Mode`, `Strength`, `BoundaryLabel` and `ID` are left empty; findings come back in first-hit order.

**Acceptance:** `go test ./pkg/reporadar -run 'TestSiblingFingerprint|TestValidSite|TestFindingsFromAudit|TestStillDetected|TestCommitSignal'`
- gate, in a temp dir with a 3-line file: line 1 and 3 pass, 0 and 4 fail, a missing file fails, a blank or
  whitespace trigger fails, and an absolute path, `../outside.go`, a backslash escape and a directory all fail
  without reading outside the project (review focus 1).
- fingerprint: equal for the same project, commit and file whatever the line; differs when any of the three
  differs; `a\b.go` and `a/b.go` agree; starts with `RAD-`.
- findings: two hits in two files give two findings; two hits in one file give one finding with two sites and
  `kept == 2`; one valid and one invalid hit give one finding and `kept == 1`; zero hits and a nil reply give
  none; the mission contains the short hash, `file:line` and the trigger; a secret-shaped string in a hit's
  text is redacted in the finding.
- `stillDetected` is true while the file and line exist, false once the file is deleted or shortened below
  every site's line, and false for a finding with no sites.
- `commitSignal` has collector `git`, source ref `commit:<hash>`, the commit time and its files, and the same
  id for the same commit.

### Task 5: Switch the scan to the audit pipeline and retire the old one
**Depends on:** Task 2, Task 3, Task 4
**Chunk:** Spec: fix-commit trigger and read-only audit replace the collectors and the clustering call
**Chunk:** Backend: pick fix commits in the window, run one read-only Sonnet audit session per commit
**Chunk:** Backend: a finding needs file, line and trigger; retire the collectors, no-test signals and clustering

Spec sections 4, 5, 6 and 8: the scan sequence, lifecycle, retry and cancel, and the deletions.

**Files:** modify `pkg/reporadar/scan.go`, `lifecycle.go`, `command.go`, `types.go`, `signal.go`,
`fixcommits.go` (receives `parseGitLog`, `gitCommit`, `isTestPath`, `clip` from the deleted `collect_git.go`),
`docs/deferred.md`, `docs/open-issues.md`, `docs/reference/architecture.md`, and a one-line "superseded by"
note at the top of `docs/superpowers/specs/2026-07-10-repo-radar-design.md` and
`2026-07-21-radar-multi-mode-design.md`. Delete, with their tests: `collect.go`, `collect_config.go`,
`collect_dependency.go`, `collect_git.go`, `collect_runs.go`, `collect_structure.go`, `collect_transcript.go`,
`modes.go`, `prepare.go`, `security.go`, `synth.go`, `validate.go`, and the tests `cluster_test.go`,
`scan_collect_test.go`, `security_scan_test.go`, `security_test.go`, `strength_test.go`,
`synth_prompt_test.go`, `synth_test.go`, `validate_test.go`, `modes_test.go`, `prepare_test.go`,
`fingerprint_test.go`, `types_test.go` where they test only retired code. Rewrite `acceptance_test.go`,
`scan_test.go`, `scan_finalize_test.go`, `retry_test.go`, `lifecycle_test.go` for the new pipeline. Do not touch
`pkg/waveobj`, `pkg/wconfig`, `pkg/consult` or any generated file.

**Decisions:**
- `runScan`: status `collecting`; read the repository HEAD (unreadable is fatal as today) and the route
  (`configuredAuditRoute` error is fatal with its message); `listWindowCommits`; the audited set is every
  commit with an `ok` audit in a completed or partial report of the project plus every `SourceCommit` among the
  baseline's findings; `selectFixCommits(..., FixAuditsPerScan)`; write `Audits` all `queued`, status
  `clustering`, `ClusterStartedTs`; run `auditCommit` with at most `AuditConcurrency` in flight; each audit's
  running and finished state is written with `wstore.UpdateRadarReport` matching the audit by commit inside the
  update function, then published (review focus 5); finished audits get root cause, hit and kept counts,
  model, tokens, duration and the raw reply redacted and clipped to the existing 64 KB bound; then finalize.
- finalize: fresh findings are `findingsFromAudit` of the ok audits; the baseline is the latest completed or
  partial other report's findings; baseline findings with no `SourceCommit` are dropped; a baseline finding not
  among the fresh ones counts as detected when `stillDetected` (review focus 4); `reconcile` then classifies as
  spec section 4 says, without the evidence-timestamp and failed-mode parameters; `assignFindingIDs` and
  `refreshInvestigations` as today; `Signals` are the `commitSignal`s the findings cite, taken from this scan
  and the baseline's signals; `Candidates` are the `commitSignal`s of failed audits; status is failed when
  there were audits and all failed, partial when some failed, else completed; `ClusterError` joins the failed
  audits' errors by short hash; `ConfiguredModel` is `runtime:model`, `ResolvedModel` the first reported one,
  `TotalTokens` the sum; end HEAD, dirty mark and window end as today; `pruneReports` as today.
- `Retry`: allowed on a failed or partial report with at least one failed audit; re-audits only those commits
  in place, appends their findings as New (renumbering ids), updates status, signals and candidates the same
  way; a cancelled retry restores the previous status. `StartClusterOnly` becomes the retry entry point under
  whatever name reads best; the wshrpc command and its name are unchanged.
- cancel during a first pass ends as today (`cancelled`, no findings); running sessions stop through the context.
- `RecoverInterruptedScans`, `pruneReports`, `SetDisposition`, `RecordInvestigation` keep their behavior.
- `types.go` keeps statuses, groups, coverage/audit vocabulary still referenced, severities, `EvidenceWindow`,
  `NoLongerAfterMisses`, `ReportsKeptPerProject`, `InvestigationOrphaned`, and a package comment describing
  the new pipeline; the collector kinds other than git, strengths, taxonomies, modes, mode-run statuses,
  class tags, payload budget and `MaxFindings` go. `go vet` and a grep for each deleted identifier must come
  back clean: nothing retired is left referenced or orphaned.
- `docs/deferred.md` gets a top entry (retired 2026-10-06) listing what was removed, why (the spec's evidence),
  the revive condition (chunk 8's measurement says the audit is not worth keeping and metadata signals are
  wanted back), and the recovery command `git show 78fe087a:pkg/reporadar/<file>` with the deleted file names;
  `docs/open-issues.md` gets its one-line mirror; `architecture.md`'s Radar line describes the fix-sibling audit.

**Acceptance (every test fakes `runAuditSession`; fixtures are temp git repos):**
`go test ./pkg/reporadar -run 'TestScanAuditsSelectedFixCommits|TestScanStreamsAuditProgress|TestScanPartialAndFailed|TestScanNoFixCommits|TestScanCancel|TestRescanSkipsAuditedCommits|TestRetryReauditsFailedOnly|TestRetryCancelRestoresStatus|TestCarriedFindingLifecycle|TestRescanKeepsUserState|TestLegacyFindingsDropped|TestConcurrentAuditUpdates|TestAcceptanceScanIsReadOnly|TestReconcile'`
- a repo with three fix commits and a fake reply holding one valid hit: the report completes with three ok
  audits, one finding carrying `sourcecommit`, one site, a `RAD-` fingerprint, a signal it cites, and a mission
  naming `file:line`; a hit failing the gate leaves `hitcount` 1 and `keptcount` 0 and no finding.
- progress: a fake that blocks until released shows, from the stored report, audits `queued` then `running`
  then `ok`, never more than `AuditConcurrency` running at once, with status `clustering` throughout.
- one failing audit of three gives `partial`, a `clustererror` naming its short hash and a candidate signal for
  it; all failing gives `failed`; an unknown `radar:auditruntime` gives `failed` with a fatal error naming it.
- a repo with no fix commit completes with no audits; a carried finding there still reconciles.
- cancelling mid-audit ends `cancelled` with no findings, and its ok audits are audited again by the next scan.
- a second scan audits none of the first scan's ok commits and does re-audit its failed one.
- retry on a partial report calls the fake only for the failed commit, keeps the other findings and their ids'
  dispositions, adds the new finding as New, and moves the report to `completed`; retry on a report with no
  failed audit is an error; a cancelled retry leaves the status `partial`.
- lifecycle over three scans with no new commits: the finding goes New, then Recurring; after its file is
  deleted it stays open with `misscount` 1, then No longer detected, then is gone; restoring the file before
  the second miss returns it to Recurring.
- a dismissed and a suppressed finding keep group and disposition across two rescans; an investigation
  recorded with `RecordInvestigation` between scans is on the carried finding afterwards.
- a baseline finding with an empty `sourcecommit` is absent after the next scan.
- `TestConcurrentAuditUpdates`: eight audits finishing together through the real update path leave eight ok
  audits in the stored report.
- the acceptance test asserts HEAD and the dirty mark are unchanged by a scan.
- the existing `TestRecordInvestigation*`, disposition, list-reports, manager, recover and redact tests still
  pass, and `go test ./pkg/jarvis -run 'Radar'` still passes.

### Task 6: Settings > Headless AI: the Radar audit route and the mid model cleanup
**Depends on:** Task 1

Spec section 7. Owns every generated file after Task 1; no other task regenerates.

**Files:** modify `pkg/wconfig/settingsconfig.go`, `pkg/consult/openrouter.go`, `pkg/consult/consult.go` and
their tests, generated files via `task generate` (and `schema/settings.json` the way the Taskfile builds it),
`frontend/app/view/agents/settingsmodel.ts`, `settingsmodel.test.ts`, `settingssurface.tsx`,
`routepicker.tsx` (and `route.ts` with its test if the filter lives there), `scripts/cdp/scenarios.mjs`.
Do not touch `pkg/reporadar`.

**Decisions:**
- delete `HeadlessOpenRouterMidModel` (`headless:openroutermidmodel`) and `OpenrouterMidModel`; an OpenRouter
  spec with no model, at any tier, uses `OpenrouterCheapModel()`. The `Tier` constants and `MidModel` stay:
  `runroute.MigrateTierPin` and the claude tier mapping still read them.
- `RoutePicker` gains an optional allowlist of runtimes; unset keeps today's behavior for every other caller.
- the Headless AI section gets a row `headless.radaraudit`, title "Radar audit", with the route picker limited
  to claude and pi, reading and writing `radar:auditruntime` and `radar:auditmodel` through the existing
  config write path; with both keys empty it shows claude and `sonnet`. Its description says each scan runs
  one read-only session per fix commit on this route, and that OpenRouter cannot be used because it has no tools.
- the section blurb and the Cheap model description name the real callers: session classify, continuity, the
  volunteer judge and pi titles. The Mid model row and every mention of gatekeeper, decompose and Radar as a
  consult user are removed. Existing tokens and row components only; no new design token.
- the row carries a `data-setting-row`-style hook consistent with how the section's other rows are addressed,
  so the scenario can scope to it (scope queries to the settings container, never document-wide).

**Acceptance:**
- `go test ./pkg/consult -run 'TestOpenrouter|TestSpecForTier'`: an OpenRouter spec at the mid and capable
  tiers resolves to the cheap model; no test or code references the mid model setting.
- `npx vitest run frontend/app/view/agents/settingsmodel.test.ts` (and `route.test.ts` if touched): the
  headless section lists `headless.runtime`, `headless.apikey`, `headless.cheap`, `headless.radaraudit` and no
  `headless.mid`; the config keys list holds the two radar keys and not the mid model key; the runtime
  allowlist keeps only claude and pi and leaves an unfiltered picker unchanged.
- a new CDP scenario `settings-radar-audit` in `scripts/cdp/scenarios.mjs`, run by the plan's Final line: step
  1 opens Settings and selects the Headless AI section; step 2 asserts the Radar audit row is rendered and
  shows the claude route with `sonnet` when the keys are unset; step 3 opens its picker and asserts claude and
  pi are offered and no other runtime is; step 4 picks a pi route, asserts `getfullconfig` reports
  `radar:auditruntime` as `pi`, and the row shows it; step 5 asserts no Mid model row exists in the section.
  It screenshots the section with the picker closed and open, and its teardown restores both keys to what they
  were. `surface-smoke`, also on the Final line, shows the Radar surface still loads.
- the Check command passes.
