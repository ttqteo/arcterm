# Design — Radar multi-mode (correctness + security + tech-debt)

> Superseded by `2026-10-06-radar-fix-sibling-audit-design.md`: the per-mode lenses described here are retired.

**One line:** Generalize Repo Radar from a single correctness lens into three evidence-grounded lenses over one shared doctrine, surfaced in one unified scan.

**Status:** Design approved in conversation 2026-07-21 (brainstorming). Implementation not started. Hands off to writing-plans.

**Related:**
- `docs/superpowers/specs/2026-07-10-repo-radar-design.md` — Repo Radar v1 (the foundation this extends).
- `docs/superpowers/specs/2026-07-16-radar-outcome-loop-design.md` — the finding → Run → outcome loop (mode-agnostic; unchanged by this work).
- `git show a4b5bd4f:docs/superpowers/briefs/2026-07-21-open-ended-improvement-scan-brief.md` — finding D3 (surfaces coerce failure to empty); this spec closes D3 for Radar via per-mode degradation.

---

## Problem

Radar answers "what correctness risk deserves attention next, and why?" for one registered repo, one lens, one manual scan. It is trusted because of one discipline: **every finding references canonical deterministic evidence; the model only clusters, it never judges from vibes.**

The user wants Radar to look through more than the correctness lens — specifically **security-risk** and **technical-debt** — without weakening the trust that makes the correctness lens useful. The founding spec's non-goals explicitly excluded "general style, code-quality, or architecture recommendations *without correctness evidence*," so a naive "add a debt tab" would violate the rule Radar was built on.

## The core constraint: one doctrine, three lenses

Every finding, in any mode, obeys one admissibility bar: **it must cite canonical deterministic evidence and articulate a correctness consequence.** The three lenses differ only in the question they ask and the evidence they weight:

- **Correctness** — "what is likely broken?" (test gaps, migration safety, config drift, failed-run boundaries, runtime-only behavior, cross-layer mismatch). Unchanged from v1.
- **Security** — "what is exploitable?" A security bug *is* a correctness bug. Scoped to **evidence Radar uniquely has** (churn / failure / transcript / run signals at classified security boundaries, plus deterministic dependency-manifest and config-security facts) — **not** semantic vulnerability detection.
- **Tech-debt** — "what accumulated fragility is now *causing* correctness risk?" A debt finding is admissible only when its evidence ties to a correctness consequence (locked decision below). Pure size/churn with no correctness link is withheld.

This single bar is the spine of the design and the reason the two new lenses cannot dilute the one already trusted.

## Decisions (locked via brainstorming, 2026-07-21)

- **Three lenses: correctness (existing) + security + tech-debt.** Architecture/product mode was considered and declined this round (fuzziest evidence, highest false-positive risk).
- **Debt must imply correctness risk.** Debt evidence (churn, size, duplication, no-test-adjacency) is a risk lens, never a finding on its own; a debt finding requires ≥1 correctness-linking signal. This keeps Radar's trust model intact rather than loosening the founding rule.
- **Security is not a scanner.** Security v1 surfaces boundary fragility from Radar's unique evidence; it deliberately will not catch a classic injection that leaves no churn/failure/transcript/run signal. Radar is not, and does not replace, semgrep / a CVE scanner (founding non-goal preserved).
- **One scan, all modes, unified filterable list.** A single "Scan repository" runs every mode; findings merge into one list with mode filter-chips.
- **One bounded model call per mode.** Each lens keeps its own 40k payload budget, its own 10-finding cap, and its own taxonomy in the prompt. A scan is up to three sequential Sonnet calls.
- **All modes run every scan in v1; no per-mode enable toggle** (YAGNI — the user asked for all modes). A per-project mode toggle is a deferred extension if cost proves painful.
- **Fingerprint hash input is unchanged.** Risk-kind names are globally unique across modes, so fingerprints never collide across modes and `reconcile` segregates modes with zero changes. Adding mode to the hash would re-key every existing correctness finding — explicitly avoided.

## Non-goals

- Security-as-vulnerability-scanner / CVE matching / semgrep replacement (founding non-goal).
- A debt lens that surfaces maintainability without a correctness consequence.
- Cross-mode finding merge — a subsystem that is both a debt hotspot and a security boundary surfaces as two findings (one per lens); no merge in v1.
- Parallel per-mode model calls (sequential in v1; parallelization is a measure-first optimization).
- Per-project mode enable/disable configuration.
- Architecture / product mode.
- Any change to the scan trigger (still manual), remote/SSH repos, or the model (still fixed `sonnet`) — all inherited from v1.

---

## Architecture

### Mode as a first-class dimension

Add a `Mode` dimension the whole pipeline is parameterized by:

```go
// pkg/reporadar/types.go
const (
    ModeCorrectness = "correctness"
    ModeSecurity    = "security"
    ModeDebt        = "debt"
)
var V1Modes = []string{ModeCorrectness, ModeSecurity, ModeDebt}
```

Risk-kind constants stay globally unique per mode. `ValidRiskKind(kind)` becomes `ValidRiskKind(mode, kind)`, backed by a per-mode kind list:

```go
var RiskKindsByMode = map[string][]string{
    ModeCorrectness: {RiskTestCoverageGap, RiskMigrationSafety, RiskConfigContractDrift,
                      RiskRepeatedFailure, RiskRuntimeOnlyBehavior, RiskCrossLayerMismatch},
    ModeSecurity:    {RiskAuthBoundaryFragility, RiskSecretHandlingBoundaryRisk,
                      RiskInputValidationGap, RiskDependencyExposure},
    ModeDebt:        {RiskFragileHotspot, RiskUntestedChurnMagnet, RiskDuplicationDrift},
}
```

`V1RiskKinds` (existing) becomes the correctness slice, kept for back-compat call sites; `ValidRiskKind(mode, kind)` is the new gate `validateFindings` uses.

### Scan orchestration — collect once, synthesize per-mode

`scan.go` today is: collect → prepare → one model call → validate → reconcile → persist. New shape:

1. **Collect once** into a shared signal pool. Every collector runs a single time; churn/structure/runs/transcript/memory/config signals serve multiple lenses (git churn feeds correctness *and* debt *and* security-boundary churn). No collector runs per mode.
2. **Per mode** (`for _, mode := range V1Modes`):
   - **Prepare candidates** — select and weight the signals relevant to that lens and pack them into that lens's own `DefaultRadarPayloadBudget` (40k). Preparation is deterministic and mode-specific; it is the only place the shared pool is filtered down to a lens.
   - **Synthesize** — one bounded Sonnet call scoped to that lens's taxonomy (the prompt lists only that mode's kinds and that mode's candidates). Reuses the existing `synth.go` invocation, JSONL parse, model resolution, and token accounting verbatim; only the payload/prompt content is mode-parameterized.
   - **Validate** — `validateFindings` with that lens's admissibility predicate and its own 10-finding cap (the cap is per-mode because `validateFindings` runs once per mode).
3. **Merge** every mode's validated findings into one `[]RadarFinding`, each tagged with its `Mode`.
4. **Reconcile — unchanged.** Fingerprints never collide across modes (globally-unique kinds), so `reconcile(projectPath, merged, prev, evidenceTs)` classifies each mode's findings against only its own history automatically.
5. **Persist** the report with per-mode run metadata (below).

Calls run **sequentially** — a three-mode scan is ~3× the wall-clock of a v1 scan and up to 120k total payload. Acceptable for a manual, user-triggered scan; parallelization is deferred.

### Per-mode graceful degradation (closes D3 for Radar)

Each mode's model call can succeed, fail to cluster, or be skipped independently. The report records this per lens so a single lens failing never blanks the surface:

```go
// pkg/waveobj/wtype.go
type RadarModeRun struct {
    Mode          string `json:"mode"`
    Status        string `json:"status"` // completed|clustering-failed|skipped
    ClusterError  string `json:"clustererror,omitempty"`
    PayloadTokens int    `json:"payloadtokens,omitempty"`
    TotalTokens   int    `json:"totaltokens,omitempty"`
    ResolvedModel string `json:"resolvedmodel,omitempty"`
    FindingCount  int    `json:"findingcount,omitempty"`
}
```

Top-level `RadarReport.Status` becomes an aggregate:
- `completed` — every enabled mode completed clustering.
- `partial` — at least one mode failed clustering, **or** a collector was partial (existing partial semantics), while at least one mode delivered findings.
- `failed` — every mode failed clustering, or collection itself was fatal.

So **security clustering can fail and correctness + debt still deliver**, and that failure renders as a *visible per-lens error* rather than an empty list — the exact D3 "failure masquerades as empty" gap, closed for this surface. `RetryRadarClusteringCommand` becomes mode-scoped: retry only the failed lens(es) from their retained candidates, no re-collection.

### Data model (`pkg/waveobj/wtype.go`) — additive, no migration

- `RadarFinding` gains `Mode string` (`correctness|security|debt`; **empty reads as `correctness`** for back-compat with existing reports).
- `RadarReport` gains `ModeRuns []RadarModeRun`. Existing flat `PayloadTokens` / `TotalTokens` / `ClusterError` remain as scan-wide aggregates (sum / concatenation) for callers that don't care about per-lens detail.
- New `RadarModeRun` struct (above).
- `fingerprint(projectPath, riskKind, subsystem)` signature **unchanged**; `Mode` is explicit metadata only.

All changes are fields on existing waveobj types — **no new DB table, so no migration** (per the "new waveobj type needs migration" gotcha, which applies only to new types). `task generate` regenerates the TS bindings.

### Taxonomies and the trust gate (`types.go`, `validate.go`)

The real trust mechanism is a **per-mode admissibility predicate** layered on top of today's shared checks (referenced signals exist, files covered by signals, kind valid, dedup, cap). Structure it as a small `func(mode string, supporting []RadarSignal) bool` consulted inside `validateFindings` after the shared checks pass.

**Correctness** (`ModeCorrectness`) — existing rule, kinds unchanged:
`test-coverage-gap`, `migration-safety`, `configuration-contract-drift`, `repeated-failure-boundary`, `runtime-only-behavior`, `cross-layer-contract-mismatch`. Predicate: withhold a single weak signal with no explicit failure (today's behavior).

**Tech-debt** (`ModeDebt`) — every finding **must include ≥1 correctness-linking signal**, i.e. one of:
- a `runs` signal (failed/blocked phase) whose paths intersect the hotspot;
- a `structure` prod-without-adjacent-test signal for the hotspot;
- a `git` co-change-without-paired-test-change relationship;
- a duplication signal where the duplicated copies co-changed **divergently** (a real defect class, not mere duplication).

Proposed kinds:
- `fragile-hotspot` — high churn + large/complex + no adjacent tests, with a correctness link.
- `untested-churn-magnet` — frequently-changed prod file, no test adjacency, linked to a failure/defect signal.
- `duplication-drift` — a duplicated boundary whose copies diverged under co-change.

This predicate is what enforces the "debt must imply correctness risk" decision **deterministically** — the model cannot talk its way past it.

**Security** (`ModeSecurity`) — every finding **must include a security-boundary classification signal AND a consequence signal**:
- boundary signal: a `structure` signal tagging the subsystem security-relevant (auth / session / permission / crypto / secret-handling / input-validation / deserialization boundary);
- consequence signal: a churn / failure / transcript / run signal at that boundary, or a deterministic dependency/config-security fact.

Proposed kinds:
- `auth-boundary-fragility` — an auth/session/permission boundary that is a repeated-failure or churn hotspot without test adjacency.
- `secret-handling-boundary-risk` — a secret/credential-handling boundary with churn + no test adjacency or a failed run there. (Secrets themselves stay redacted per v1; the *boundary* is the signal, never the secret.)
- `input-validation-gap` — an input/deserialization boundary changed without adjacent validation/test.
- `dependency-exposure` — a deterministic manifest fact (floating or very-stale pin) on a security-relevant dependency. Fact only; no CVE matching.

Evidence strength (`evidenceStrength`) is orthogonal and unchanged — a finding can be admissible (has the required correctness link) yet still `limited` strength.

### New collectors

Collection stays read-only, argument-array Git, secret-redacting, and bounded — all v1 safety rules apply unchanged.

- **Tech-debt:**
  - file size / complexity — extend the `structure` collector to emit size and a cheap complexity proxy per tracked source file;
  - duplication — new detector emitting duplicated-boundary signals (with co-change divergence facts where the `git` window supports it);
  - churn ↔ test-adjacency — largely derivable from existing `git` + `structure` signals; formalize the prod-without-test and co-change-without-test facts.
- **Security:**
  - boundary classification — extend `structure` to tag security-relevant paths (deterministic path/name heuristics, documented and testable);
  - dependency-manifest facts — new parser for `package.json` / `go.mod` / `Cargo.toml` emitting **version/pin facts only** (floating, very-stale), never CVE lookups;
  - config-security facts — extend the `config` collector (e.g. permissive CORS, disabled auth flags) as facts, not judgments.

### Synthesis (`synth.go`)

The invocation is mode-agnostic and reused verbatim: `claude -p --model sonnet --output-format stream-json --verbose`, tools disabled, run outside the repo, payload via stdin, JSONL parse for resolved model + token usage. The only change is the **prompt/payload builder** becomes mode-parameterized — it lists the current mode's allowed kinds (from `RiskKindsByMode[mode]`, replacing the hardcoded `V1RiskKinds` at the current `synth.go:194` allowed-kinds line) and packs the current mode's prepared candidates. The untrusted-data delimiters, structured-output contract, and no-auto-retry rule are unchanged.

## Commands (`pkg/wshrpc/wshserver/wshserver_radar.go`, `wshrpctypes_radar.go`)

- `StartRadarScanCommand(projectpath)` — unchanged surface; internally now runs all modes.
- `RetryRadarClusteringCommand(reportid, mode?)` — gains an optional `mode` to retry a single failed lens; omitted retries all failed lenses. Reuses retained per-mode candidates.
- `CancelRadarScanCommand`, `SetRadarFindingDispositionCommand`, `ListRadarReportsCommand` — unchanged. Disposition operates per-finding and is mode-agnostic.

Full report content still loads via normal wave-object access.

## Frontend integration

Files: `radarsurface.tsx`, `radarmodel.ts`, `radarstore.ts`, `radarfindingslist.tsx`, `radarfindingdetail.tsx`, `radarstyles.ts`, `radardevmock.ts`. Types arrive via `task generate` (`RadarFinding.mode`, `RadarReport.modeRuns`, `RadarModeRun`).

- **Mode filter chips** — All / Correctness / Security / Debt in the summary bar. The list filters by the active chip (pure derivation in `radarmodel.ts`, unit-tested). Summary count chips group by mode × lifecycle.
- **Mode badge** — on each finding row and the detail header, color-coded via `@theme` tokens in `tailwindsetup.css` (never raw hex/rgba — standing rule). Add `--color-*` tokens for the two new lenses if needed.
- **Per-lens status** — render `ModeRuns` so a `clustering-failed` lens shows a real error banner + a per-lens retry button, while succeeded lenses show findings. This is the D3 fix on the surface.
- **Unchanged** — outcome-loop investigation block, disposition actions (dismiss / suppress / dismiss-addressed-by-run), scan-state panel, scope selector, and Enter-to-activate all work per-finding, mode-agnostic.

Implementation reuses v1 conventions: existing diff rendering, project-registry state and path validation, canonical signal/source counts, and the handoff's scan-state set.

## Safety and privacy

Inherited from v1, unchanged: registered local repos only after canonical-path validation; read tracked text files; exclude `.git`, ignored files, deps, build output, `.env`, credential stores, binaries; never execute repo scripts/tests/hooks/package managers; Git via argument arrays; treat source/commits/transcripts/memory as untrusted; redact secret formats before synthesis and persistence; bounded snippets not whole files; synthesis outside the repo with tools disabled; structured output only; no automatic model retry; no background work; no silent history mutation. The new dependency-manifest and config-security collectors read files already inside the tracked-text scope and emit facts only — no network, no registry lookups.

## Testing

**Pure Go (`pkg/reporadar`):**
- `ValidRiskKind(mode, kind)` accepts only that mode's kinds; a security kind returned under the correctness call is rejected, and vice-versa.
- Debt admissibility: a finding with only size/churn signals and **no** correctness-linking signal is withheld; adding a failed-run / prod-without-test / divergent-duplication signal admits it.
- Security admissibility: a finding missing the boundary classification signal is withheld; missing the consequence signal is withheld; with both, admitted.
- Fingerprint stability: correctness fingerprints are **byte-identical** to v1 for the same (project, kind, subsystem) — no re-key. A debt finding and a correctness finding on the **same subsystem** get **distinct** fingerprints (distinct kinds) and reconcile independently.
- Per-mode cap: 11 valid findings in one mode keep the top 10; other modes unaffected.
- Per-mode budget packing: each mode's prepared candidates fit its own 40k budget.
- Per-mode degradation: one mode's synth fails → report `Status == partial`, that `ModeRun.Status == clustering-failed` with `ClusterError` set, other modes' findings intact; all modes fail → `failed`.
- `reconcile` unchanged: existing lifecycle tests still pass verbatim (no signature or behavior change).

**New collector tests** (temporary Git repos / fixtures): file-size/complexity emission; duplication + divergent co-change; boundary classification tagging; dependency-manifest version/pin facts (no network); config-security facts. Assert observable signals, not Git command details.

**FE unit (vitest):** mode filter derivation (chip → filtered list); mode-badge state; per-lens error rendering vs empty; summary grouping by mode × lifecycle.

**CDP (best-effort, via the dev-mock scenario driver):** unified results with all three lenses + filter chips; per-lens partial banner + retry; theme switching; long findings without clipping. Never `Page.reload`.

**End-to-end acceptance fixture** (extend the v1 fixture): add a security boundary that is a churn/failure hotspot, a floating dependency pin, a debt hotspot **with** a correctness link and one **without** (the latter must be withheld), and confirm: (1) no repo writes/commands beyond read-only Git; (2) every evidence reference resolves to a collected signal; (3) no planted secret reaches payload or finding in any lens; (4) each mode's New+Recurring ≤ 10; (5) a second scan classifies Recurring/No-longer-detected per mode correctly; (6) a lens failure degrades to partial with the other lenses intact.

## Consequences and trade-offs

- **3× model cost and latency per scan.** Bounded (each lens capped at 40k payload + one turn), sequential, and manual-triggered, so it never runs in the background. Per-mode enable toggles and parallel calls are the two deferred levers if this proves painful.
- **Security will miss vulnerabilities with no churn/failure/transcript/run signal.** This is deliberate — staying inside the "not a scanner" rule. Radar surfaces boundary *fragility*; it does not replace security tooling, and the empty-security-lens state must say so (a snapshot, not a security guarantee), mirroring v1's correctness disclaimer.
- **The debt lens is intentionally narrow** — gated on a correctness link, it will not surface "pure" debt (a big untested file that never fails). That keeps debt findings few and high-trust; broadening is a future decision, not a v1 gap.
- **Risk-kind names must stay globally unique across modes** — this is the load-bearing invariant that lets the fingerprint and `reconcile` stay unchanged. Documented as a naming discipline; a per-mode test guards it.
- **More collectors = more code**, but shared single-pass collection amortizes it, and each new collector is independently testable against fixtures.
- **Report size grows** with up to 30 findings + per-mode metadata; still bounded (pruning of unreferenced candidates after synthesis is inherited from v1).

## Deferred extensions

- Per-project mode enable/disable configuration (cost control).
- Parallel per-mode model calls (measure-first).
- Cross-mode finding merge for a subsystem flagged by multiple lenses.
- Broadening the debt lens beyond the correctness-link gate, once signal quality is proven.
- Architecture / product mode.
- Everything already deferred by Radar v1 (scheduled scans, configurable model, cross-project, remote repos, read-only validation commands).
