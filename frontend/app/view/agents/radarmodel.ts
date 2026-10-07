// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure model for the Repo Radar sibling-audit surface: the body view, audit rows and tally, finding list
// groups and sites, investigation and dismiss state, selection fallback, and Run-draft construction.
// No jotai / RPC / React here.

import { formatAgo } from "./agentsviewmodel";
import type { LoadPhase } from "./loadphase";
import { fmtDuration } from "./runcompletion";

// the backend names a finding whose files share no directory "." (and one with no paths "unknown");
// neither says where to look, and the affected-files list already does, so they render as nothing
export function subsystemLabel(subsystem: string): string {
    return subsystem === "." || subsystem === "unknown" ? "" : subsystem;
}

// Whether radarView may speak yet. radarView(null) is "never-scanned", which is only true once the list has
// actually been read; before that it is loading. "ready" hands over to radarView — Radar's empty is its
// never-scanned panel, so there is no "empty" here.
export function radarLoadPhase(p: {
    reports: RadarReport[] | null;
    currentReportId: string | undefined;
    report: RadarReport | null;
    loadError: string | null;
    scopeBlocked: boolean;
}): LoadPhase {
    if (p.loadError != null && p.reports == null) {
        return "error";
    }
    // a persisted project the registry no longer has never resolves; waiting on it would be a skeleton forever
    if (p.scopeBlocked) {
        return "ready";
    }
    if (p.reports == null || (p.currentReportId != null && p.report == null)) {
        return "loading";
    }
    return "ready";
}

// findings ordered by list group, used for selection fallback (first open finding wins).
function orderedFindings(findings: RadarFinding[]): RadarFinding[] {
    const grouped = groupForList(findings);
    return LIST_GROUP_ORDER.flatMap((g) => grouped[g]);
}

export function resolveSelection(findings: RadarFinding[], currentId: string | undefined): string | undefined {
    if (currentId && findings.some((f) => f.id === currentId)) {
        return currentId;
    }
    return orderedFindings(findings)[0]?.id;
}

// The finding->Run handoff payload. Consumed by the (deferred) Channels pending-Run composer.
export interface RadarRunDraft {
    reportId: string;
    findingId: string;
    fingerprint: string;
    mission: string;
    files: string[];
    origin: "radar";
}

export function buildRunDraft(report: RadarReport, finding: RadarFinding): RadarRunDraft {
    return {
        reportId: report.oid,
        findingId: finding.id,
        fingerprint: finding.fingerprint,
        mission: finding.mission,
        files: [...(finding.files ?? [])],
        origin: "radar",
    };
}

// The composer draft handed from a Radar finding to the Channels Run composer. Origin-agnostic on
// purpose: the composer never imports Radar concepts, it just renders goal + optional context + origin.
export interface PendingRunDraft {
    goal: string; // prefilled, editable
    files: string[]; // context, read-only in the composer
    radarOrigin?: { reportid: string; findingid: string; fingerprint: string };
    projectPath?: string; // resolves the target channel on landing
    projectName?: string; // names the channel when the project has none yet
    landed?: boolean; // one-shot guard: set once Channels has navigated to this draft (survives surface remount)
}

// the mission already names the source fix and each site with its trigger, actual and expected
// (pkg/reporadar/hits.go), so the goal adds nothing to it
export function composeRunGoal(finding: RadarFinding): string {
    return finding.mission;
}

export function toPendingRunDraft(report: RadarReport, finding: RadarFinding): PendingRunDraft {
    const d = buildRunDraft(report, finding);
    return {
        goal: composeRunGoal(finding),
        files: d.files,
        radarOrigin: { reportid: d.reportId, findingid: d.findingId, fingerprint: d.fingerprint },
        projectPath: report.projectpath,
        projectName: report.projectname,
    };
}

export type InvestigationTone = "live" | "success" | "warning" | "muted";

// InvestigationView is how a finding's latest investigation reads in the list and the detail. live: the
// run is still going, so the primary button opens it. openable: a run exists to look at separately.
export interface InvestigationView {
    label: string;
    rowLabel: string;
    tone: InvestigationTone;
    live: boolean;
    openable: boolean;
    done: boolean;
}

function invView(
    label: string,
    rowLabel: string,
    tone: InvestigationTone,
    flags: { live?: boolean; openable?: boolean; done?: boolean }
): InvestigationView {
    return { label, rowLabel, tone, live: !!flags.live, openable: !!flags.openable, done: !!flags.done };
}

// an open finding the latest scan did not detect (misscount > 0) is not "still detected"
function stillDetected(f: RadarFinding): boolean {
    return (f.group === "new" || f.group === "recurring") && (f.misscount ?? 0) === 0;
}

export function investigationView(f: RadarFinding): InvestigationView | null {
    const inv = f.investigation;
    if (!inv) {
        return null;
    }
    switch (inv.status) {
        case "executing":
            return invView("Investigating", "investigating", "live", { live: true });
        case "done":
            return stillDetected(f)
                ? invView("Investigated — still detected", "still detected", "warning", { openable: true, done: true })
                : invView("Investigated", "investigated", "success", { openable: true, done: true });
        case "orphaned":
            return invView("Run no longer exists", "run gone", "muted", {});
        case "cancelled":
            return invView("Investigation cancelled", "cancelled", "muted", { openable: true });
        default:
            return invView("Investigation failed", "failed", "muted", { openable: true });
    }
}

// primaryAction is the finding's one accent button, and what list-nav Enter fires. While a run is live
// the useful next step is to watch it, not to start a second one.
export interface PrimaryAction {
    kind: "start" | "open-run";
    label: string;
}

export function primaryAction(f: RadarFinding): PrimaryAction {
    const inv = f.investigation;
    if (inv?.status === "executing") {
        return { kind: "open-run", label: `Open run ${inv.runid}` };
    }
    return { kind: "start", label: inv ? "Investigate again" : "Start investigation" };
}

// the one reason that suppresses: the finding stays closed as a decision, not as a triage call
const INTENTIONAL = "Intentional";

const DISMISS_REASONS = ["False positive", "Low priority", "Resolved elsewhere", INTENTIONAL];

export interface DismissReason {
    label: string;
    run?: string;
    action: "dismiss" | "suppress";
    reason: string;
    note?: string;
}

// A finished investigation is the likeliest reason to close a finding, so it leads the list.
export function dismissReasons(f: RadarFinding): DismissReason[] {
    const generic = DISMISS_REASONS.map(
        (reason): DismissReason => ({ label: reason, action: reason === INTENTIONAL ? "suppress" : "dismiss", reason })
    );
    const inv = f.investigation;
    if (inv?.status !== "done") {
        return generic;
    }
    const byRun: DismissReason = {
        label: "Addressed by",
        run: inv.runid,
        action: "dismiss",
        reason: "Resolved by investigation",
        note: `addressed by run ${inv.runid}`,
    };
    return [byRun, ...generic];
}

export function joinAnd(items: string[]): string {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function plural(n: number, word: string, many = `${word}s`): string {
    return `${n} ${n === 1 ? word : many}`;
}

export type RadarListGroup = "open" | "dismissed";

export const LIST_GROUP_ORDER: RadarListGroup[] = ["open", "dismissed"];

export const DEFAULT_OPEN_LIST_GROUPS: Set<RadarListGroup> = new Set<RadarListGroup>(LIST_GROUP_ORDER);

// a suppressed finding is a dismissal with the reason Intentional, so the two share a list group
export function listGroupOf(f: RadarFinding): RadarListGroup {
    return f.group === "dismissed" || f.group === "suppressed" ? "dismissed" : "open";
}

export function groupForList(findings: RadarFinding[]): Record<RadarListGroup, RadarFinding[]> {
    const out: Record<RadarListGroup, RadarFinding[]> = { open: [], dismissed: [] };
    for (const f of findings ?? []) {
        out[listGroupOf(f)].push(f);
    }
    return out;
}

export function isNewFinding(f: RadarFinding): boolean {
    return f.group === "new";
}

export interface ListGroupMeta {
    label: string;
    hint: string;
    tone: "open" | "muted";
}

export function listGroupMeta(group: RadarListGroup, items: RadarFinding[]): ListGroupMeta {
    if (group === "dismissed") {
        return { label: "Dismissed", hint: "closed with a reason", tone: "muted" };
    }
    const fresh = items.filter(isNewFinding).length;
    return { label: "Open", hint: fresh > 0 ? `${fresh} new in the latest scan` : "", tone: "open" };
}

export interface FindingSite {
    dir: string;
    file: string;
    line: number;
    path: string;
    more: number;
}

// findingSite is the first site of the finding's one file, which is what the row and the site link name.
export function findingSite(f: RadarFinding): FindingSite | null {
    const path = f.files?.[0];
    const sites = f.sites ?? [];
    if (!path || sites.length === 0) {
        return null;
    }
    const cut = path.lastIndexOf("/") + 1;
    return { dir: path.slice(0, cut), file: path.slice(cut), line: sites[0].line, path, more: sites.length - 1 };
}

const SHORT_SHA_LEN = 8;

export function shortSha(commit: string): string {
    return (commit ?? "").slice(0, SHORT_SHA_LEN);
}

export interface SourceFix {
    sha: string;
    subject: string;
    ts?: number;
}

// sourceFix is the fix commit whose audit found this finding. The backend keeps one git signal per source
// commit, so the commit's date is that signal's observedts.
export function sourceFix(f: RadarFinding, report: RadarReport): SourceFix | null {
    if (!f.sourcecommit) {
        return null;
    }
    const ids = new Set(f.signalids ?? []);
    const cited = (report.signals ?? []).find((s) => ids.has(s.id));
    return { sha: shortSha(f.sourcecommit), subject: f.sourcesubject ?? "", ts: cited?.observedts };
}

export type AuditState = "queued" | "running" | "clean" | "hits" | "failed";

export interface AuditRow {
    commit: string;
    sha: string;
    subject: string;
    state: AuditState;
    hits: number;
    detail: string;
}

// only hits that passed the gate count (keptcount), so an audit whose every hit was dropped reads as clean
function auditState(a: RadarAudit): AuditState {
    switch (a.status) {
        case "ok":
            return (a.keptcount ?? 0) > 0 ? "hits" : "clean";
        case "failed":
            return "failed";
        case "running":
            return "running";
        default:
            return "queued";
    }
}

export function auditRows(report: RadarReport | null): AuditRow[] {
    return (report?.audits ?? []).map((a) => {
        const state = auditState(a);
        return {
            commit: a.commit,
            sha: shortSha(a.commit),
            subject: a.subject,
            state,
            hits: a.keptcount ?? 0,
            detail: (state === "failed" ? a.error : a.rootcause) ?? "",
        };
    });
}

export interface AuditTally {
    total: number;
    audited: number;
    clean: number;
    withHits: number;
    failed: number;
    hits: number;
}

export function auditTally(rows: AuditRow[]): AuditTally {
    const count = (state: AuditState) => rows.filter((r) => r.state === state).length;
    const clean = count("clean");
    const withHits = count("hits");
    const failed = count("failed");
    return {
        total: rows.length,
        audited: clean + withHits + failed,
        clean,
        withHits,
        failed,
        hits: rows.reduce((n, r) => n + r.hits, 0),
    };
}

export function auditSummary(t: AuditTally): string {
    if (t.total === 0) {
        return "no new fix commits";
    }
    const failed = t.failed > 0 ? `, ${t.failed} failed` : "";
    return `${plural(t.total, "fix commit")} audited, ${t.clean} clean${failed}`;
}

export function auditTallyText(t: AuditTally): string {
    const parts = [`${t.clean} clean`, `${t.withHits} with hits`];
    if (t.failed > 0) {
        parts.push(`${t.failed} failed`);
    }
    return parts.join(" · ");
}

export function failedAuditShas(report: RadarReport): string[] {
    return auditRows(report)
        .filter((r) => r.state === "failed")
        .map((r) => r.sha);
}

export function auditStateText(r: AuditRow): string {
    switch (r.state) {
        case "hits":
            return plural(r.hits, "hit");
        case "running":
            return "auditing";
        default:
            return r.state;
    }
}

export interface SentencePart {
    text: string;
    sha?: boolean;
}

// failedAuditsSentence is the warning strip's text, in parts so the component can set each sha in mono.
export function failedAuditsSentence(shas: string[]): SentencePart[] {
    const n = shas.length;
    const fixes = n === 1 ? "that fix" : n === 2 ? "those two fixes" : `those ${n} fixes`;
    const parts: SentencePart[] = [{ text: n === 1 ? "The audit of " : "The audits of " }];
    shas.forEach((sha, i) => {
        if (i > 0) {
            parts.push({ text: i === n - 1 ? " and " : ", " });
        }
        parts.push({ text: sha, sha: true });
    });
    parts.push({ text: ` failed. Sibling bugs of ${fixes} may be missing.` });
    return parts;
}

export interface AuditsPanel {
    kind: "empty" | "clean" | "failed";
    title: string;
    tally: string;
}

// auditsPanel is the finished scan with no findings: nothing new to audit, every audit clean, or some
// failed, in which case "no sibling bugs" holds only for the commits that were read.
export function auditsPanel(t: AuditTally, duration: string): AuditsPanel {
    if (t.total === 0) {
        return { kind: "empty", title: "No new fix commits to audit", tally: "" };
    }
    if (t.failed > 0) {
        return { kind: "failed", title: "No sibling bugs found", tally: auditTallyText(t) };
    }
    return {
        kind: "clean",
        title: `No sibling bugs in ${plural(t.total, "fix commit")}`,
        tally: [`${t.clean} of ${t.total} clean`, duration].filter(Boolean).join(" · "),
    };
}

export type RadarView = "never-scanned" | "scanning" | "old-format" | "cancelled" | "fatal" | "report" | "audits";

// a finding with no source commit was written by the lens pipeline, which nothing here can draw
export function isOldFormatReport(report: RadarReport): boolean {
    return (report.findings ?? []).some((f) => !f.sourcecommit);
}

// radarView picks the body for the scoped project's newest report. The order is the contract: an
// old-format report is never drawn as a report, whatever its status.
export function radarView(report: RadarReport | null): RadarView {
    if (!report) {
        return "never-scanned";
    }
    if (report.status === "collecting" || report.status === "clustering") {
        return "scanning";
    }
    if (isOldFormatReport(report)) {
        return "old-format";
    }
    if (report.status === "cancelled") {
        return "cancelled";
    }
    if (report.status === "failed" && report.fatalerror && (report.audits?.length ?? 0) === 0) {
        return "fatal";
    }
    return (report.findings?.length ?? 0) > 0 ? "report" : "audits";
}

export function reportMetaAge(report: RadarReport, now: number): string {
    return `last scan ${formatAgo(now - (report.completedts || report.startedts))}`;
}

export function auditDuration(report: RadarReport): string {
    if (!report.clusterstartedts || !report.completedts) {
        return "";
    }
    return fmtDuration(report.completedts - report.clusterstartedts);
}

export function dispositionLabel(d: RadarDisposition): string {
    if (d.action === "suppress") {
        return "Dismissed: intentional";
    }
    return `Dismissed: ${(d.reason ?? "").trim().toLowerCase() || "no reason"}`;
}
