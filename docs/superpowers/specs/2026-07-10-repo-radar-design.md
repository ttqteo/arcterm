# Design — Repo Radar

> Superseded by `2026-10-06-radar-fix-sibling-audit-design.md`: the collectors and the clustering call described here are retired.

**One line:** Manually scan one registered repository for evidence-backed correctness-risk hypotheses, then explicitly turn a finding into a normal Arc Run draft.

**Status:** Design approved in conversation; revised 2026-07-10 after spec review (deterministic-boundary fingerprint; consult-reuse, Runs-collector, and Channels-handoff corrections). Implementation not started.

**Visual source of truth:** `wave-handoff/wave/project/Wave-repo-radar.dc.html`, subject to the semantic corrections in this spec.

**Mockup corrections (the spec overrides the handoff where they differ):**

- The "Model budget" label becomes **Radar payload** (see Model selection and execution).
- The model-failed panel's "expires in 24h" caption is wrong: retained signals have no expiry timer (see Evidence window).
- The redundant **Inspect evidence** button is removed; the detail pane already shows evidence (see Frontend integration).
- "Start investigation" targets the **Channels** surface, not a separate "Runs surface" (see Start investigation handoff).

---

## Problem

Arc is effective after the user knows what work to start: it launches agents, coordinates them through Channels and Runs, surfaces asks, shows live output and subagents, reviews diffs, and preserves project memory. It does not answer the earlier question: **what correctness risk deserves attention next, and why?**

The relevant evidence is already spread across the repository and Arc:

- source and test structure;
- recent commits and changed-file relationships;
- Runs and their outcomes;
- agent tool failures, retries, and repeated edits;
- project-scoped corrections and applied learning;
- configuration and migration boundaries.

Each source alone is usually weak. The useful signal appears when several independent facts point at the same boundary. A human operating parallel agents cannot reliably retain and connect all of those facts across weeks.

Repo Radar turns that evidence into a small, ranked set of bounded investigation proposals. It is not a linter, an autonomous repair agent, or proof that a defect exists. Every finding remains an evidence-backed hypothesis until a separate investigation confirms it.

## Goals

- A first-class Radar surface in the Arc shell.
- Manual scans only, scoped to one selected registered local repository.
- Correctness-risk findings only in v1.
- A hybrid pipeline: deterministic collection and validation, one bounded model call for judgment.
- Traceable findings whose claims reference canonical evidence.
- Cross-scan continuity: New, Recurring, No longer detected, Dismissed, and Suppressed.
- A strict Radar-payload budget, one model turn, and a maximum of ten New or Recurring findings per scan.
- An explicit handoff from a finding to a prefilled normal Run draft.
- No repository mutation, tests, commands, agents, or background work during scanning.

## Non-goals

- Scheduled or idle-time background scans.
- Cross-project aggregation.
- General style, code-quality, product-idea, or architecture recommendations without correctness evidence.
- Automatic tests, validation commands, fixes, commits, agents, channels, or Runs.
- Remote, SSH, or WSL repositories in v1.
- A configurable Radar model or per-scan model picker in v1.
- A replacement for linters, security scanners, dependency scanners, or CI.
- Proving that an absent finding means the repository is correct.

## Product behavior

The user selects a registered project and clicks **Scan repository**. Radar examines the current tree plus recent engineering activity, prepares compact factual signals, and spends one bounded model call clustering qualified candidates into findings.

Each finding contains:

- a concrete risk hypothesis;
- an estimated impact if true: low, medium, or high;
- deterministic evidence strength: Limited, Moderate, or Strong;
- why the hypothesis matters;
- exact evidence references;
- affected files and subsystem;
- a suggested, bounded investigation mission;
- actions to start an investigation, dismiss the finding, or suppress its pattern.

The surface uses the handoff's master-list/detail layout. New and Recurring groups are open by default. No longer detected, Dismissed, and Suppressed start collapsed. Diff content is verbatim; Radar interpretation is rendered separately and explicitly labelled.

The complete scan lifecycle is visible:

`never scanned -> collecting -> clustering -> completed | partial | failed | cancelled`

Additional completed states include no findings and reports containing only historical findings. A partial report names every unavailable source. A failed clustering step retains collected signals for retry.

## Evidence window

Every scan reads:

- the current tracked tree; and
- the previous 30 days of commits, project-matching Runs, transcripts, and memory changes.

The window rolls rather than starting at the previous scan, so back-to-back scans see the same evidence and a finding keeps its identity instead of vanishing. Findings carried from earlier reports keep the evidence they cite. The report records both the time boundary and Git HEAD boundary, so the window is auditable.

If clustering fails, collected signals remain until the user retries, discards them, or starts a newer scan. There is no arbitrary expiry timer.

## Architecture

### Backend package

Add `pkg/reporadar`, responsible for:

1. collecting factual signals;
2. canonicalizing, deduplicating, and preparing candidates;
3. invoking bounded synthesis;
4. validating model output;
5. comparing with the previous report;
6. persisting report transitions.

The package may reuse existing Git, transcript, memory, Run, object-store, and headless-process utilities. It must not depend on frontend projection code or Jarvis orchestration behavior.

A small manager owned by `wavesrv` tracks active scan cancellation contexts by report ID. The persistent `RadarReport` remains the source of truth; the in-memory manager owns only live process control.

### Deterministic collectors

Collectors produce canonical `RadarSignal` values and make no risk judgment.

#### Repository structure

- Enumerate tracked text files.
- Classify source, tests, migrations, configuration, and package boundaries.
- Record production/test adjacency and boundary metadata.
- Ignore Git internals, ignored files, dependencies, build output, environment files, credential stores, and binaries.

#### Git history

- Capture commits and changed files within the evidence window.
- Record additions, deletions, co-change relationships, and whether related tests changed.
- Capture repository HEAD and dirty-state fingerprint at scan start and end.

#### Runs

- Read project-matching Runs (`Run.ProjectPath`), embedded on their Channel (`Channel.Runs`).
- Record failed or blocked phases (`RunPhase.State`) and produced artifacts (`RunPhase.Artifacts`).
- Retry and send-back counts are not persisted on `RunPhase`; v1 does not emit them as signals unless a Run event history exists to derive them.
- Reference Run and phase identity rather than copying their full timelines.

#### Agent transcripts

- Read only project-matching recent transcripts.
- Extract explicit tool errors, failed commands, repeated edits to the same boundary, abandoned tool paths, and referenced files.
- Do not deterministically claim that an agent was confused or that a user message was a correction based on keywords alone.

#### Memory

- Read project-scoped correction and applied-learning records.
- Preserve note identity and provenance.
- Treat ordinary free-form memory as context, not proof.

#### Configuration and migration boundaries

- Record migration pairing and consumers of changed configuration keys.
- Emit facts only. For example, "migration X has no paired down file" is factual; "deployment will fail" is a later hypothesis.

### Canonical signal

Each signal contains at least:

- stable signal ID;
- collector kind;
- source kind and source reference;
- observed timestamp;
- affected project-relative paths;
- primary boundary or subsystem when deterministically known;
- factual summary;
- compact structured facts;
- optional redacted snippet;
- content hash used for deduplication.

The stable ID derives from canonical source identity and event identity, not presentation. A commit displayed as a chip, timeline event, affected-file row, and diff remains one signal. UI signal counts come from unique signal IDs, never from rendered sections.

### Deterministic preparation

Before model invocation, code:

- removes duplicate signals;
- groups signals by file and subsystem boundaries;
- compares them with the previous report;
- refreshes existing-finding evidence;
- drops unchanged isolated low-value facts;
- ranks candidate groups using factual criteria;
- packs candidates within the model token budget.

No model usage occurs during collection or preparation.

### Model selection and execution

V1 uses Claude Code with the stable `sonnet` alias. Selection is explicit and does not inherit the user's CLI default, the legacy Wave AI `ai:model` setting, New Agent flags, or Jarvis configuration.

The invocation is equivalent to `claude -p --model sonnet` with tools disabled. It runs outside the scanned repository and receives the prepared payload through stdin. There is no silent fallback to Opus, Haiku, Codex, Antigravity, or the CLI default.

Radar reuses the `pkg/consult` process harness (`consult.Run` with its stdin, cancellation, and output-drain handling) but not its Claude `RuntimeSpec`: that spec streams reply text only, sets no `--model`, and does not disable tools. Radar supplies its own invocation — `claude -p --model sonnet --output-format stream-json --verbose`, tools disabled via the CLI's allowed-tools mechanism (empty `--allowedTools` / `--disallowedTools`) — and its own JSONL parse that additionally reads the `system`/`init` event for the resolved model ID and the final `result` event for token usage (the existing `claudeParseLine` discards both). Tool-disabling is load-bearing for the guarantee that model text cannot trigger commands, so it is a hard invocation requirement to verify at implementation, not a default.

The report records:

- configured alias (`sonnet`);
- actual resolved model ID exposed by the CLI stream;
- exact token usage when available;
- explicitly-labelled estimated usage otherwise.

If Claude or Sonnet is unavailable, collection remains intact and clustering fails clearly. Retry reruns only the lenses that failed to cluster, on a failed or partial report, using the retained signals; the other lenses' findings stand.

The per-scan cap is the named constant `DefaultRadarPayloadBudget = 40_000` estimated tokens supplied by Radar. The prepared payload must fit before invocation. Synthesis is limited to one turn with a bounded structured response and no automatic retry.

This is deliberately not labelled a hard cap on total provider usage: Claude Code adds system/runtime context that Radar cannot measure before invocation. The report and UI show payload usage against the 40,000-token cap during preparation, then record the actual total usage reported by Claude Code after the call. If the CLI does not expose exact total usage, the report labels the total as estimated. The handoff's "Model budget" label should therefore become **Radar payload**.

### Synthesis contract

One model call receives compact candidate groups, the allowed risk taxonomy, and explicit untrusted-data delimiters. It may:

- connect related signals;
- draft a correctness-risk hypothesis;
- explain why it matters;
- estimate impact if true;
- suggest a bounded investigation mission;
- return exact supporting signal IDs and affected file references.

The structured response contains only:

- risk kind (validated against the v1 taxonomy);
- a display boundary label (advisory only; the canonical subsystem used for identity is derived deterministically from the referenced signals' paths, not from this field);
- risk statement;
- severity and rationale;
- supporting signal IDs;
- affected file references;
- suggested investigation.

The model does not control report identity, finding identity, fingerprint, canonical subsystem, evidence strength, lifecycle state, counts, or dispositions.

### Deterministic validation

Code rejects or withholds a model finding when:

- any referenced signal does not exist;
- any referenced file is absent from its signals;
- the risk kind is outside the v1 taxonomy;
- its canonical subsystem does not resolve from the referenced signals' paths;
- it duplicates another finding in the same report;
- it has one weak signal and no explicit failure;
- accepting it would exceed the ten-finding cap;
- the response is malformed or exceeds the model budget.

When more than ten findings survive validation, code keeps the top ten by severity, then evidence strength, then most-recent supporting evidence, dropping the rest deterministically; ties break by fingerprint.

V1 risk kinds are:

- `test-coverage-gap`;
- `migration-safety`;
- `configuration-contract-drift`;
- `repeated-failure-boundary`;
- `runtime-only-behavior`;
- `cross-layer-contract-mismatch`.

Evidence strength is computed from canonical independent sources:

- **Strong:** corroborated across multiple independent source categories.
- **Moderate:** supported by multiple canonical signals with a meaningful gap.
- **Limited:** supported by one source or one explicit failure; normally withheld unless the explicit failure justifies surfacing it.

Severity is separate and means estimated impact if the hypothesis proves true.

## Persistence model

### Radar report

Add one persisted `RadarReport` wave object type. A report represents the running scan and its eventual immutable evidence record. As with every new wave object type, add the corresponding `db_radarreport` migration.

The report stores:

- report ID and wave-object identity;
- project name and canonical path;
- start HEAD, end HEAD, and dirty-state fingerprints;
- previous report ID and previous HEAD;
- evidence-window boundaries;
- status and current phase;
- start and completion timestamps;
- collector progress and source coverage;
- partial-source and fatal errors;
- configured and resolved model identity;
- exact or estimated token usage;
- retained compact candidate signals while collection is retryable;
- canonical evidence signals referenced by completed findings;
- validated findings;
- clustering failure metadata.

A retry after model failure updates the same report. A new collection creates a new report. While clustering is retryable, the report retains the prepared candidate payload. After successful completion, it prunes unreferenced candidates and keeps only signals referenced by findings plus aggregate collector counts and hashes. This keeps the audit trail complete without sending an unbounded evidence dump through WOS.

Completed reports are append-only except for user dispositions on their findings. Full source files and transcripts are never copied into the report.

### Identity

Keep three identities distinct:

- **Report ID:** one manual scan.
- **Finding ID:** one finding revision in one report.
- **Fingerprint:** stable cross-scan identity for the same risk pattern.

Code computes the fingerprint from project identity, risk kind, and the deterministic canonical subsystem (derived by the collectors from file paths). It never hashes the model-written title or the model's advisory boundary label, so cross-scan matching cannot drift when the model rephrases a boundary. The normal Run draft receives report ID, finding ID, and fingerprint as distinct fields.

### Cross-scan lifecycle

- **New:** fingerprint was absent from the previous successful report.
- **Recurring:** fingerprint was in the previous successful report and is detected again.
- **No longer detected:** two consecutive scans did not detect a previously open fingerprint. After a single miss it stays open and is marked not detected in the latest scan, since one miss is usually model variance. Findings of a lens that failed to cluster carry forward unchanged, and Dismissed and Suppressed findings carry forward while undetected.
- **Dismissed:** the user closed one finding revision with a recorded reason.
- **Suppressed:** the user suppressed the stable fingerprint.
- **Open:** internal umbrella state for New and Recurring.

No longer detected never means fixed.

### Dismissal

A dismissal stores:

- reason: false positive, low priority, or resolved elsewhere;
- optional note;
- timestamp;
- local user identity;
- evidence revision at dismissal.

Dismissed findings remain in a collapsed history group so the action is reversible. Any activity signal (commit, Run, transcript, memory) newer than the dismissal reopens the fingerprint as Recurring. Standing facts about the tree (structure, config, dependency) never do: they carry the scan window as their time, so they would reopen every dismissal once the window moved past it.

### Suppression

A suppression stores:

- fingerprint;
- reason and optional note;
- timestamp and local user identity;
- evidence signature at suppression.

The fingerprint remains suppressed until manually unsuppressed. A different risk kind or primary boundary creates a different fingerprint and is evaluated normally. V1 does not add fuzzy model judgment for "material change."

## Commands and execution

Add typed wshrpc commands:

- `StartRadarScanCommand(projectpath)` — validate scope, reject a second active scan for the project, persist a report, and start collection.
- `CancelRadarScanCommand(reportid)` — cancel collectors or synthesis and persist `cancelled`.
- `RetryRadarClusteringCommand(reportid)` — reuse retained signals without recollection.
- `SetRadarFindingDispositionCommand(reportid, findingid, action, reason, note)` — dismiss, suppress, reopen, or unsuppress atomically.
- `ListRadarReportsCommand(projectpath)` — return lightweight report summaries for latest-report loading and history.

Full report content is loaded through normal wave-object access when selected.

The scan sequence is:

1. validate the registered canonical project path;
2. create the RadarReport in `collecting`;
3. capture start HEAD and dirty state;
4. run collectors and persist coverage after each;
5. prepare canonical candidate groups;
6. persist retained signals;
7. transition to `clustering`;
8. run bounded Sonnet synthesis;
9. validate findings;
10. compare with the previous successful report;
11. prune unreferenced candidate signals after successful synthesis;
12. capture end HEAD and dirty state;
13. persist completed, partial, failed, or cancelled state;
14. publish the normal wave-object update.

If HEAD or the dirty-state fingerprint changes during scanning, the report records both boundaries and shows a repository-changed note. Every collector still ran, so it is not a coverage gap and does not make the report partial. Radar never locks the working tree.

An Arc restart does not resume a live scan. On startup, a report stranded in `collecting` or `clustering` becomes failed with `scan-interrupted`. Retained signals remain retryable when collection had completed.

Collector errors are source-local where possible:

- invalid or inaccessible repository: fatal;
- optional source unavailable: partial;
- model unavailable, malformed output, or model error: failed after collection;
- budget exhausted before invocation: failed without spending a model call;
- cancellation: child process terminated and previous completed report unchanged.

## Start investigation handoff

Runs belong to Channels today (`Channel.Runs`, each carrying `Run.ProjectPath`); there is no standalone Runs surface. Radar must not create a hidden channel or immediately start a worker.

**Start investigation** navigates to the **Channels** surface and opens a prefilled Run draft containing:

- report ID;
- finding ID;
- fingerprint;
- suggested mission;
- affected files;
- evidence references;
- Radar origin metadata.

The user selects an existing project channel, reviews or edits the draft, chooses Run mode and plan-gate behavior, and explicitly starts it. If no suitable channel exists, the existing channel-creation flow is offered.

Today `createRun` starts a run immediately; the prefilled-draft-then-review step before an explicit start is new frontend work (a pending Run composer), not an existing affordance.

## Frontend integration

Add `radar` to `SurfaceKey`, `NavRail`, and `CockpitShell`. Preserve every existing surface. The main nav list scrolls when height is insufficient; Settings retains its current bottom placement.

The frontend slice is:

- `radarstore.ts` — selected project, report summaries, current report, and command actions;
- `radarmodel.ts` — pure grouping, filtering, canonical counts, selection fallback, and Run-draft construction;
- `radarsurface.tsx` — handoff implementation;
- small components only where they isolate meaningful units: findings list, finding detail, and scan-state panel.

Radar initializes its scan scope from the cockpit's global project selection, then owns an explicitly labelled repository scope. Changing Radar scope does not silently change other surfaces.

Implementation must:

- use Tailwind and existing `@theme` tokens, never raw colors;
- reuse project-registry state and path validation;
- reuse existing diff parsing/rendering rather than add a second diff parser;
- keep source facts visually separate from Radar interpretation;
- derive signal and source counts from canonical IDs;
- expose Dismissed history and undo;
- remove or define any redundant `Inspect evidence` affordance because the detail pane already displays evidence;
- implement the handoff's never-scanned, collecting, clustering, results, partial, no-findings, model-failed, and cancelled states.

## Safety and privacy

- Scan only registered local repositories after canonical-path validation.
- Read tracked text files by default.
- Exclude `.git`, ignored files, dependencies, build output, `.env`, credential stores, and binaries.
- Never execute repository scripts, tests, hooks, package managers, or discovered commands.
- Invoke Git with argument arrays; never interpolate repository content into shell commands.
- Treat source, commit messages, transcripts, and memory as untrusted input.
- Redact common secret formats and high-entropy credential values before synthesis or persistence.
- Send compact signals and bounded snippets, not entire files or transcripts.
- Run synthesis outside the repository with model tools disabled.
- Accept structured output only; model text cannot trigger commands or routing.
- Never retry a model call automatically.
- Never schedule background work in v1.
- Never mutate finding history silently.
- Keep the redacted synthesis request, validated response, and model metadata inspectable for audit.

## Testing

### Pure backend tests

- Stable signal IDs and deduplication.
- Source independence.
- First-scan and incremental evidence windows.
- Candidate payload budgeting.
- Stable fingerprints despite rewritten finding titles and rephrased model boundary labels.
- New, Recurring, No longer detected, Dismissed, and Suppressed transitions.
- Reopening a dismissed finding on newer canonical evidence.
- Suppression persistence and undo.
- Evidence-strength calculation.
- Ten-finding cap and deterministic ordering.
- Secret redaction.
- Model-output validation rejecting unknown signals, files, and risk kinds.
- Dirty-repository change detection.
- Partial-source behavior.

Collector tests use temporary Git repositories and fixture transcripts, Runs, and memory. They assert observable signals rather than Git command implementation details.

### Command and manager tests

- One active scan per project.
- Report status transitions and object updates.
- Cancellation during collection and synthesis.
- Failed clustering retaining signals.
- Retry without recollection.
- Interrupted scan handling at startup.
- Atomic finding dispositions.
- Unregistered, inaccessible, and non-repository paths rejected.

### Frontend pure tests

- Grouping and default collapse behavior.
- Filtering and selection fallback.
- Canonical signal and source counts.
- Coverage and partial-state derivation.
- Dismissed-history visibility.
- Investigation drafts keep report, finding, and fingerprint IDs distinct.
- Navigation preserves every existing surface.

### CDP verification

Use the existing fixture and CDP tooling to verify:

- every handoff scan state;
- dismissal and undo;
- suppression and unsuppression;
- No longer detected semantics;
- investigation draft handoff;
- small-window NavRail scrolling;
- theme switching;
- long findings, timelines, paths, and diffs without clipping.

### End-to-end acceptance fixture

Use a controlled temporary repository containing:

- production branches with missing tests;
- a paired and unpaired migration;
- a configuration consumer mismatch;
- a failed Run fixture;
- a correction-memory fixture;
- planted secret-like values in several formats plus a generic high-entropy string, all of which must be redacted.

Acceptance requires:

1. The scan performs no repository writes or commands beyond read-only Git.
2. Every displayed evidence reference resolves to a collected canonical signal.
3. No planted secret, in any planted format, reaches the model payload or persisted finding.
4. New and Recurring findings never exceed ten.
5. A second scan correctly classifies Recurring and No longer detected fingerprints.
6. Dismissal and suppression persist with audit metadata and can be undone.
7. A model failure retries using retained signals.
8. Start investigation creates only a draft; no worker starts before confirmation.
9. Radar payload usage remains under 40,000 estimated tokens, and actual or explicitly-estimated total provider usage is recorded separately.
10. An empty result states that it is a snapshot, not a correctness guarantee.

## Consequences and trade-offs

- The hybrid design costs more code than a single autonomous scan prompt, but it makes evidence auditable, usage bounded, and findings comparable across scans. The deterministic pipeline and fingerprint provide that stability; the single model call itself is not reproducible.
- A fixed Sonnet model makes v1 behavior comparable across scans but does not accommodate users without Claude Code; failure is explicit rather than hidden behind a different model.
- A 30-day first window can miss older latent risks. V1 optimizes for recent, actionable evidence; full-history scanning remains a later option.
- Persisting referenced evidence signals increases database size slowly. Retry payloads are pruned after successful synthesis, and no raw transcripts are stored. Each project keeps its newest 20 reports, plus the reconcile baseline and any report with a scan in flight.
- Dismissed and Suppressed history adds state, but without it repeated false positives would make Radar untrustworthy.
- No automatic validation means some findings remain uncertain. That separation is deliberate: Radar discovers; Runs investigate.

## Deferred extensions

- Optional scheduled scanning after manual signal quality is proven.
- Configurable model/provider after fixed-Sonnet results are measured.
- Technical-debt and product-opportunity Radar modes.
- Cross-project findings.
- Remote repository collectors.
- Explicit read-only validation commands before surfacing a finding.
- Finding-linked Run outcomes that can confirm a fix rather than only mark it No longer detected.
