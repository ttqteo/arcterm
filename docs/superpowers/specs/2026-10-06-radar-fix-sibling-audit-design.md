# Radar: audit each fix commit for the same bug at sibling sites

Date: 2026-10-06. Effort: `effort:1557171a-e61d-4b29-83fd-fc7f818e6131`, chunks 4, 5 and 6.
Supersedes the pipeline in `2026-07-10-repo-radar-design.md` and `2026-07-21-radar-multi-mode-design.md`.

## Why

Radar feeds commit, transcript and "no adjacent test" metadata to one model call that never reads code. Its
last two scans kept 0 findings, and 9 finished investigations found no defect. A hand trial on 2026-10-06
audited 5 fix commits by reading the code around each: 2 had a real sibling bug, 1 a conditional one, 2 were
clean, and Sonnet matched Opus on all five at 51-69k tokens and 26-82 s per commit. The trial commits were
picked as sibling-prone, so the rate over real scans will be lower; chunk 8 measures it.

## Scope

In: the scan backend (`pkg/reporadar`), the report wire types, the audit runtime and model setting with its
row in Settings > Headless AI, and the cleanup of that section.
Out: the Radar surface (chunk 7). The current surface must keep loading reports: fields are added to
`RadarReport` and `RadarFinding`, none is renamed or removed, and the status strings stay as they are.

## Scan sequence

`select -> audit -> validate -> reconcile -> finalize`, one report per scan as today.

| Report status (wire value unchanged) | What runs |
|---|---|
| `collecting` | fix-commit selection, deterministic, no model |
| `clustering` | the audit sessions, one per selected commit |
| `completed` / `partial` / `failed` / `cancelled` | as today: partial when some audits failed, failed when all did or the repository is unreadable |

A scan with no commit left to audit completes with no audits and still reconciles carried findings.

## 1. Trigger: which commits are audited

Deterministic code over `git log --no-merges` inside the existing 30-day `EvidenceWindow`.

- A fix commit has a conventional subject: `fix:`, `fix(scope):`, with an optional `!`.
- A commit's code files are its changed files that are neither docs (`.md`, `.mdx`, `.txt`, `.rst`, or under
  `docs/`) nor tests (the existing `isTestPath`). A commit with no code file is skipped.
- A file's fix count is how many kept fix commits in the window touch it. A commit's score is the highest fix
  count among its code files (the highest, not the sum, so a sweeping commit does not outrank a hot file).
- Order: score descending, then commit time descending, then hash.
- A commit is already audited when an earlier completed or partial report of the project holds an audit of it
  with status `ok`, or a carried finding names it as its source. Those are removed before the cap. A failed
  audit does not count, so the commit is picked again.
- The first `FixAuditsPerScan` (8) are selected.

## 2. Audit: one read-only agent session per commit

The session must read and grep the repository, so it is an agent session in print mode with a tool allowlist,
not the one-shot consult the clustering call used.

**Route.** Two new settings, `radar:auditruntime` (`claude` or `pi`; empty means `claude`) and
`radar:auditmodel` (empty means `sonnet` on claude and pi's own default on pi). OpenRouter is not offered: it
has no tools. An unknown runtime or a missing binary fails the scan with a message that names it; there is no
silent fallback to another runtime.

**Invocation**, cwd the project path, the process run through `pkg/consult`'s existing exec path:

- claude: `-p --output-format stream-json --verbose --model <model> --tools Read,Grep,Glob --strict-mcp-config`
- pi: `--mode json --no-session --no-extensions --tools read,grep,find,ls [--model <model>]`

There is no shell tool, so the session cannot edit files or run builds, tests or the app. Spiked on
2026-10-06 against claude: the session's init event listed exactly `Glob, Grep, Read`, a requested `Write` was
refused, and without `--strict-mcp-config` the account's connector tools were still loaded. The runner
therefore checks claude's init event and fails the audit when it lists any tool outside the allowlist.

**Prompt.** Go runs `git show <commit>` and embeds the output, capped at `MaxFixDiffBytes` (60 KB; past that
it is cut with a marker telling the agent to read the files), fenced as untrusted data. The contract, from
the trial:

1. Work out the root cause the commit fixed.
2. Read the sibling sites in the current tree: other callers of the same function, parallel code paths,
   sister handlers.
3. Report a hit only with file, line, the input or state that triggers it, actual vs expected, and why the
   fix does not cover it.
4. "No sibling has this bug" is a valid and expected answer. A false positive is worse than nothing.
5. Reply with only JSON:

```json
{"rootcause": "", "siblings": ["what was checked"],
 "hits": [{"file": "", "line": 0, "title": "", "trigger": "", "actual": "", "expected": "",
           "whynotcovered": "", "severity": "low|medium|high"}]}
```

**Reply.** The session's final assistant message (claude's `result` event, which also gives the resolved
model and the token total). A reply that does not parse, an error result, or a timeout (`AuditTimeout`, 10
minutes) fails that audit; the others continue.

**Seam.** The session is one package-level function variable taking the route, project path and prompt and
returning the reply, model and tokens. Tests replace it with a fake reply; no test calls a model.

**Concurrency.** `AuditConcurrency` (3) sessions at a time. Each audit's `queued -> running -> ok | failed`
transition is written to the report and published as it happens.

## 3. Validation and identity

A hit is kept only when all three hold, checked against the working tree:

- its file is a path inside the project (relative, no escape) that exists,
- its line is between 1 and the file's line count,
- its trigger is not blank.

One finding per (source fix commit, file): `fingerprint = "RAD-" + hash(project path, commit hash, file)`.
The line is left out so identity survives line drift. Further kept hits in the same file become extra sites
on that finding instead of being dropped.

A finding's existing fields are filled so the current surface and the handoff keep working: `risk` is the
hit's title, `why` is why the fix does not cover it, `files` is the one file, `subsystem` is derived from it,
`riskkind` is `sibling-bug`, `severity` is normalized as today, and `signalids` cites one git signal for the
source commit (kept in `report.signals`). `mission` is composed in Go and names the source fix, each sibling
site as `file:line` and its trigger, actual and expected. `mode`, `strength` and `boundarylabel` are no
longer written.

## 4. Lifecycle across scans

A commit is audited once, so a later scan re-checks carried findings without a model: every finding of the
baseline report goes through the same validation gate against the current tree.

- Passes: detected. New or No longer detected becomes Recurring; Dismissed and Suppressed keep their state.
- Fails (file gone, line out of range): a miss. No longer detected after `NoLongerAfterMisses` (2), then
  dropped on the next miss, as today.
- Findings of this scan's audits that the baseline does not hold are New.
- A dismissal no longer reopens on newer evidence: a commit's time never changes.
- Baseline findings with no source commit came from the retired collectors and are dropped.

Known ceiling: a sibling fixed in place still passes the gate and stays Recurring until it is dismissed or
its investigation finishes. Dispositions and the investigation writeback key on the fingerprint and are
unchanged.

## 5. Retry, cancel, pruning

- **Retry** re-audits the commits whose audit failed in that report, without reselecting, and adds their
  findings as New; the report's other findings and audits stay as they are. `candidates` holds the git
  signals of the failed audits' commits, which is what the current surface's retry gate reads.
- **Cancel** stops the running sessions. A cancelled first pass keeps nothing and its audits do not count as
  audited; a cancelled retry restores the report's previous status.
- Report pruning, interrupted-scan recovery and the concurrent-scan guard are unchanged.

## 6. Wire additions

`RadarReport.audits []RadarAudit`: `commit`, `subject`, `committs`, `files`, `status`, `rootcause`,
`hitcount` (reported), `keptcount` (passed the gate), `error`, `resolvedmodel`, `totaltokens`, `durationms`,
`rawresponse` (clipped and redacted). This is the per-commit checklist and what chunk 8 measures.

`RadarFinding`: `sourcecommit`, `sourcesubject`, `rootcause`, `sites []RadarSite` (`line`, `trigger`,
`actual`, `expected`, `whynotcovered`).

Still written: `starthead`/`endhead`/dirty marks, window, `clusterstartedts` (audit start), `configuredmodel`,
`resolvedmodel`, `totaltokens`, `clustererror` (failed audits joined), `signals`, `candidates`, `findings`.
No longer written, fields kept until chunk 7: `coverage`, `partialsources`, `lensprogress`, `moderuns`,
`payloadtokens`. Until chunk 7 the surface shows its old collector checklist during a scan.

## 7. Settings > Headless AI

- New row "Radar audit": the existing route picker limited to claude and pi, writing the two keys above.
- The blurb and row descriptions name the jobs that really use the headless runtime: session classify,
  continuity, the volunteer judge and pi titles.
- The Mid model row, `headless:openroutermidmodel` and `OpenrouterMidModel` are deleted: Radar was their only
  caller. An OpenRouter consult with no model set uses the cheap model.

## 8. Retired

Deleted with their tests: the structure, transcript, runs, config and dependency collectors, the per-commit
git signal collector, the no-test signal and its admissibility gate, candidate preparation and the payload
budget, the clustering prompt and synthesis call, the per-mode lenses and risk taxonomies, the security gate,
evidence strength, and the finding cap. `docs/deferred.md` records the removal with
`git show 78fe087a:pkg/reporadar/<file>` as the recovery command.

Kept: the report store, manager and cancellation, recovery, pruning, dispositions, investigation writeback,
redaction (applied to stored model text), git exec helpers.

## Tests

- Selection: subject matching, docs-only and tests-only skips, ranking by file fix count with its tie-breaks,
  the cap, already-audited exclusion (ok audit, carried finding, failed audit not excluded).
- Gate: missing file, path escaping the project, line 0 and past the end, blank trigger, a valid hit.
- Fingerprint: stable across line changes, differs by project, commit and file; two hits in one file make one
  finding with two sites.
- Audit, through the seam with fake replies: a hit becomes a finding, an empty `hits` is a clean ok audit, an
  unparseable reply fails only that audit, argument lists per runtime carry the tool allowlist, a claude init
  event listing an extra tool fails the audit.
- Scan: per-commit progress is written, partial and failed statuses, cancel, retry re-audits only failed
  commits, a rescan skips audited commits, carried findings move New -> Recurring -> No longer detected, and
  dismissed, suppressed and investigation state survive a rescan.
- Settings: a CDP scenario step shows the Radar audit row and the absence of the Mid model row.
