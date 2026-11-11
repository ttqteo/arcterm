// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Workflow lens, as a pure model: the newest scan run in, the state the lens draws out. Every
// number and quote on a card is the recount's (Survivors), never the agent's; the agent's verdict adds only the fix.
// Ours differs from the fork's lens in one place: the scan's agent asks the owner which fixes to apply itself (the
// run's AskUserQuestion, as the workflowscan: address lands on it), so the record holds no picks and the lens has no
// picks bar or applying state. Its cards are the findings, read-only; answering is the agent's.

import { palettePickChannel } from "@/app/cockpit/palette-data";
import { rowsWithChannel, type ProjectRow } from "./projectsstore";

export const SCAN_WINDOW_DAYS = 14;
export const RUN_FLOOR = 3;
const SHOWN_QUOTES = 2;

export type StagePhase = "done" | "now" | "todo";
export interface StageRow {
    label: string;
    fact: string;
    phase: StagePhase;
}

export interface EditLine {
    sign: "+" | "-";
    text: string;
}

export interface WorkflowCard {
    id: string;
    title: string;
    runs: number;
    days: number;
    projects: WorkflowScanProject[];
    quotes: WorkflowScanQuote[];
    more: WorkflowScanQuote[];
    file: string;
    where: string;
    edit: EditLine[];
    raisedAgain?: { declinedAt: number; now: number };
    // the fix's project when it is not the scan's: the agent cannot apply it here, so the card offers Copy for #project
    elsewhere?: string;
}

export interface FiledRow {
    tag: "covered" | "declined" | "under";
    title: string;
    fact: string;
}

// a fix the scan drafted; what the owner applied is the agent's to say (the run's commit), not the record's
export interface DoneRow {
    tag: "suggested";
    title: string;
    file: string;
}

export interface KeptRow {
    id: string;
    title: string;
    runs: number;
    days: number;
    where: string;
}

// what the scan is doing at its current stage; from and to are mmdd
export type StageDetail =
    | { stage: "read"; from: string; to: string }
    | { stage: "patterns"; runs: number; projects: number }
    | { stage: "recount"; candidates: number }
    | { stage: "checking"; kept: KeptRow[]; underFloor: number };

export type WorkflowView =
    | { kind: "idle"; last?: { date: string; outcome: "cancelled" | "failed"; error?: string } }
    | { kind: "scanning"; stages: StageRow[]; detail: StageDetail; startedTs: number }
    | { kind: "picking"; cards: WorkflowCard[]; covered: FiledRow[]; declined: FiledRow[]; underFloor: FiledRow[] }
    | { kind: "done"; commit?: string; rows: DoneRow[]; stages: StageRow[] }
    | {
          kind: "nothing";
          covered: FiledRow[];
          declined: FiledRow[];
          underFloor: FiledRow[];
          stages: StageRow[];
      };

const STAGES: { stage: StageDetail["stage"]; label: string }[] = [
    { stage: "read", label: "Read runs" },
    { stage: "patterns", label: "Sonnet patterns" },
    { stage: "recount", label: "Recount" },
    { stage: "checking", label: "Opus checks files" },
];

export function mmdd(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function count(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

// "3 suggested · 2 covered": the nonzero counts only
function tally(parts: [number, string][]): string {
    return parts
        .filter(([n]) => n > 0)
        .map(([n, label]) => `${n} ${label}`)
        .join(" · ");
}

// the stage the scan is at, as an index into STAGES; a stage not yet set reads as the first
function stageIndex(scan: WorkflowScan): number {
    return Math.max(
        0,
        STAGES.findIndex((s) => s.stage === scan.stage)
    );
}

// `now` is the index of the row in progress; past the last row, every row is done
function stageRows(scan: WorkflowScan, now: number): StageRow[] {
    const cut = scan.dropped > 0 ? ` · ${scan.dropped} cut for size` : "";
    const under = scan.underfloor?.length ? ` · ${scan.underfloor.length} under ${RUN_FLOOR} runs` : "";
    const facts = [
        `${count(scan.runs, "run", "runs")} · ${count(scan.projects, "project", "projects")}${cut}`,
        `${scan.candidates} named`,
        `${scan.kept} kept${under}`,
        tally([
            [verdictsOf(scan, "suggest").length, "suggested"],
            [verdictsOf(scan, "covered").length, "covered"],
            [verdictsOf(scan, "declined").length, "declined"],
        ]),
    ];
    return STAGES.map((s, i) => {
        const phase: StagePhase = i < now ? "done" : i === now ? "now" : "todo";
        return { label: s.label, phase, fact: phase === "done" ? facts[i] : "" };
    });
}

export function editLines(edit: string | undefined): EditLine[] {
    return (edit ?? "")
        .split("\n")
        .map((l) => l.replace(/\r$/, ""))
        .filter((l) => l.trim() !== "")
        .map((l) => {
            const sign = l.startsWith("-") ? "-" : "+";
            const body = l.startsWith("-") || l.startsWith("+") ? l.slice(1) : l;
            return { sign, text: body.replace(/^ /, "") };
        });
}

function verdictsOf(scan: WorkflowScan, verdict: string): { pattern: WorkflowScanPattern; v: WorkflowScanVerdict }[] {
    const byId = new Map((scan.survivors ?? []).map((p) => [p.id, p]));
    return (scan.verdicts ?? [])
        .filter((v) => v.verdict === verdict && byId.has(v.id))
        .map((v) => ({ pattern: byId.get(v.id)!, v }));
}

// as the server compares projects, so the lens never offers a fix as applicable here that the agent would send elsewhere
function sameProject(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function buildCards(scan: WorkflowScan): WorkflowCard[] {
    return verdictsOf(scan, "suggest").map(({ pattern, v }) => {
        const quotes = pattern.quotes ?? [];
        return {
            id: pattern.id,
            title: pattern.title,
            runs: pattern.runs,
            days: pattern.days,
            projects: pattern.projects ?? [],
            quotes: quotes.slice(0, SHOWN_QUOTES),
            more: quotes.slice(SHOWN_QUOTES),
            file: v.file ?? "",
            where: v.where ?? "",
            edit: editLines(v.edit),
            raisedAgain: v.declinedat ? { declinedAt: v.declinedat, now: pattern.runs } : undefined,
            elsewhere: v.fixproject && !sameProject(v.fixproject, scan.project) ? v.fixproject : undefined,
        };
    });
}

function filed(scan: WorkflowScan): { covered: FiledRow[]; declined: FiledRow[]; underFloor: FiledRow[] } {
    const runs = (p: WorkflowScanPattern) => count(p.runs, "run", "runs");
    return {
        covered: verdictsOf(scan, "covered").map(({ pattern, v }) => ({
            tag: "covered",
            title: pattern.title,
            fact: v.note ? `${runs(pattern)} · ${v.note}` : runs(pattern),
        })),
        declined: verdictsOf(scan, "declined").map(({ pattern, v }) => ({
            tag: "declined",
            title: pattern.title,
            fact: `${runs(pattern)} · not past ${v.declinedat ?? 0}`,
        })),
        underFloor: (scan.underfloor ?? []).map((p) => ({
            tag: "under",
            title: p.title,
            fact: `${runs(p)} · ${count(p.days, "day", "days")}`,
        })),
    };
}

function where(projects: WorkflowScanProject[]): string {
    if (projects.length === 1) {
        return `#${projects[0].name}`;
    }
    return projects.length > 1 ? `${projects.length} projects` : "";
}

function scanWindow(run: Run, scan: WorkflowScan): { from: string; to: string } {
    return { from: scan.fromts ? mmdd(scan.fromts) : "", to: mmdd(scan.tots || run.createdts) };
}

function stageDetail(run: Run, scan: WorkflowScan): StageDetail {
    switch (STAGES[stageIndex(scan)].stage) {
        case "read":
            return { stage: "read", ...scanWindow(run, scan) };
        case "patterns":
            return { stage: "patterns", runs: scan.runs, projects: scan.projects };
        case "recount":
            return { stage: "recount", candidates: scan.candidates };
        case "checking":
            return {
                stage: "checking",
                kept: (scan.survivors ?? []).map((p) => ({
                    id: p.id,
                    title: p.title,
                    runs: p.runs,
                    days: p.days,
                    where: where(p.projects ?? []),
                })),
                underFloor: scan.underfloor?.length ?? 0,
            };
    }
}

function doneRows(scan: WorkflowScan): DoneRow[] {
    return verdictsOf(scan, "suggest").map(({ pattern, v }) => ({
        tag: "suggested",
        title: pattern.title,
        file: v.file ?? "",
    }));
}

// done and cancelled are the run's own status, so they win over whatever state the record was left in: a
// scan whose run died mid-scan must not read as still scanning
export function workflowView(run: Run | null): WorkflowView {
    const scan = run?.workflowscan;
    if (run == null || scan == null) {
        return { kind: "idle" };
    }
    const date = mmdd(run.completedts || run.createdts);
    if (run.status === "cancelled") {
        return { kind: "idle", last: { date, outcome: "cancelled" } };
    }
    if (scan.state === "failed" || run.status === "failed") {
        return {
            kind: "idle",
            last: scan.error ? { date, outcome: "failed", error: scan.error } : { date, outcome: "failed" },
        };
    }
    if (run.status === "done") {
        const stages = stageRows(scan, STAGES.length);
        return verdictsOf(scan, "suggest").length > 0
            ? { kind: "done", commit: run.endcommit || undefined, rows: doneRows(scan), stages }
            : { kind: "nothing", ...filed(scan), stages };
    }
    switch (scan.state) {
        case "scanning":
            return {
                kind: "scanning",
                stages: stageRows(scan, stageIndex(scan)),
                detail: stageDetail(run, scan),
                startedTs: run.createdts,
            };
        case "picking":
            return { kind: "picking", cards: buildCards(scan), ...filed(scan) };
        default:
            return { kind: "idle" };
    }
}

export function scanHead(run: Run): { title: string; span: string } | null {
    const scan = run.workflowscan;
    if (scan == null) {
        return null;
    }
    const { from, to } = scanWindow(run, scan);
    // the read stage has not counted anything yet
    const reading = scan.state === "scanning" && stageIndex(scan) === 0;
    const counts = reading ? "" : `${count(scan.runs, "run", "runs")} · ${count(scan.projects, "project", "projects")}`;
    return {
        title: `Scan of ${to}`,
        span: [from ? `${from} → ${to}` : "", counts].filter(Boolean).join(" · "),
    };
}

export function copyText(card: WorkflowCard): string {
    const target = card.where ? `${card.file} · ${card.where}` : card.file;
    return [target, ...card.edit.map((l) => `${l.sign} ${l.text}`)].join("\n");
}

// The scan the lens follows when nothing has set one (a fresh start of the app): the newest scan run among the runs
// the palette already loads for every project. Our wavesrv has no "newest scan" command, and a scan stays live while
// its agent asks, so without this the lens would read idle over a scan that is waiting for its owner.
export function newestScanRun(runs: ReadonlyArray<{ run: Run }>): Run | null {
    let newest: Run | null = null;
    for (const { run } of runs) {
        if (run.workflowscan != null && (newest == null || run.createdts > newest.createdts)) {
            newest = run;
        }
    }
    return newest;
}

// the project a scan starts from: the owner's pick, else where the newest scan ran, else the launch rows' own rule.
// A pick or scan channel that cannot be used (no channel yet, project removed) is skipped, never an empty home.
export function scanHomeChannel(
    picked: string | null,
    newestScanChannelId: string | undefined,
    channels: Channel[] | null,
    active: Channel | null,
    rows: ProjectRow[],
    recent: string[]
): Channel | null {
    const pickedRow = rowsWithChannel(rows).find((r) => r.name === picked);
    if (pickedRow != null) {
        return pickedRow.channel;
    }
    const scanned = newestScanChannelId ? channels?.find((c) => c.oid === newestScanChannelId) : undefined;
    return scanned ?? palettePickChannel(active, rows, recent[0] ?? null);
}

const BUSY_TITLE: Partial<Record<WorkflowView["kind"], string>> = {
    scanning: "A scan is running",
    picking: "The last scan is waiting on your answers in its agent",
};

export function scanButton(
    view: WorkflowView,
    home: Channel | null
): { enabled: boolean; channelId?: string; title: string } {
    const busy = BUSY_TITLE[view.kind];
    if (busy != null) {
        return { enabled: false, title: busy };
    }
    if (home == null) {
        return { enabled: false, title: "Open a project to scan from" };
    }
    return {
        enabled: true,
        channelId: home.oid,
        title: `Scan the last ${SCAN_WINDOW_DAYS} days of every project, from #${home.name}`,
    };
}
