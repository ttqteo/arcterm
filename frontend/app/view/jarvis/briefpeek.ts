// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the record peek says. The peek is deliberately the smaller half of a line the meta spec draws: what
// is running against a record and what you set it to are Brief business, so they are here; its full
// history, its decision log and every past correction belong to the record as a Brief subject. So this
// module derives exactly those two things, and nothing else the record carries.
//
// Pure: DossierDetail + the runs attributed to it + the fleet rollup in, strings and rows out. Every
// number here is derived from the rows beneath it (invariant 5), and nothing claims a reading the record
// does not carry (invariant 7) — see updatedLabel.

import { runStatusView, type RunStatusTone } from "@/app/view/agents/runmodel";
import { headline, kilo } from "./effortfeed";
import { fleetCountsLine, type RecordFleet } from "./fleetscope";
import { ageLabel } from "./recallderive";
import { runRow } from "./recordrunrow";
import { allowedTransitions, isTerminalTransition } from "./tasksderive";

export interface PeekStatusRow {
    status: string;
    label: string;
    note: string;
    // the row naming the status the record is already in: marked, and inert. A control that does nothing
    // dressed as one that does is the same lie as a label dressed as a control (invariant 4).
    current: boolean;
    terminal: boolean;
}

export interface PeekRunRow {
    runId: string;
    shortId: string;
    headline: string;
    meta: string;
    state: string;
    tone: RunStatusTone;
}

export interface RecordPeek {
    title: string;
    // the record has no objective, so the title is its id: drawn in mono, as an id rather than a sentence
    titleIsId: boolean;
    // NOT the mockup's freshness word. A DossierDetail carries no freshness reading of any kind — no
    // gardener flag, no verification timestamp — so printing one would assert a check nobody ran, which is
    // the fabrication the Drew band's `unverified` exists to prevent. The record's own updated stamp is
    // what this slot can honestly say.
    updatedLabel: string;
    statusLabel: string;
    statusRows: PeekStatusRow[];
    // null when the objective is one sentence: the title already says all of it
    body: string | null;
    // the body is the stated absence, not content: drawn muted
    bodyIsAbsence: boolean;
    // the link that opens a clamped body, or null when the body is short enough to show whole
    bodyMore: string | null;
    fleetMeta: string;
    runs: PeekRunRow[];
    // absence is a written sentence, never an empty frame (invariant 3)
    runsAbsent: string;
    logLine: string;
}

// What each status changes about where the record turns up. Deliberately about listing and focus rather
// than about the queue: status does not filter what reaches you — `listDossiers` (the focus-target list) is
// active|paused only, and the palette sorts archived last, and that is the whole of its effect.
const STATUS_NOTE: Record<string, string> = {
    active: "The default. Offered as a focus target, listed under Active.",
    paused: "Still live, just not now. Still offered as a focus target, listed under Paused.",
    completed: "The work is done. Listed under Done, no longer offered as a focus target.",
    archived: "Out of the way. Reachable only through the palette, sorted last.",
};

const STATUS_ORDER = ["active", "paused", "completed", "archived"];

// past this many characters the body is clamped behind a link to the rest; 20 of the user's records cross it
const BODY_CLAMP_CHARS = 400;

const BODY_ABSENT = "This record states no objective yet.";

const RUNS_ABSENT = "No session has ever been attributed to this record.";

// statusPickerRows is the current status as a marked inert row, plus one control per legal transition. The
// mockup draws four fixed rows; allowedTransitions forbids paused-from-completed, so a fixed four would
// render a button that cannot do anything. An unknown stored status yields transitions but no current row,
// which is the honest reading of a value this build does not have a note for.
export function statusPickerRows(status: string): PeekStatusRow[] {
    const legal = new Set(allowedTransitions(status));
    const rows: PeekStatusRow[] = [];
    for (const s of STATUS_ORDER) {
        const current = s === status;
        if (!current && !legal.has(s)) {
            continue;
        }
        rows.push({
            status: s,
            label: s.charAt(0).toUpperCase() + s.slice(1),
            note: STATUS_NOTE[s] ?? "",
            current,
            terminal: isTerminalTransition(s),
        });
    }
    return rows;
}

function peekBody(detail: DossierDetail): { body: string | null; bodyIsAbsence: boolean; bodyMore: string | null } {
    const objective = detail.objective?.trim() ?? "";
    if (objective === "") {
        const notes = detail.notes?.trim() ?? "";
        if (notes === "") {
            return { body: BODY_ABSENT, bodyIsAbsence: true, bodyMore: null };
        }
        return { body: notes, bodyIsAbsence: false, bodyMore: null };
    }
    if (headline(objective) === objective) {
        return { body: null, bodyIsAbsence: false, bodyMore: null };
    }
    const bodyMore = objective.length > BODY_CLAMP_CHARS ? `Show the full objective · ${kilo(objective.length)}` : null;
    return { body: objective, bodyIsAbsence: false, bodyMore };
}

function logLine(n: number): string {
    if (n === 0) {
        return "no decisions yet";
    }
    return `${n} decision${n === 1 ? "" : "s"} · on the Brief`;
}

export interface RecordPeekInput {
    detail: DossierDetail;
    runs: Run[];
    fleet: RecordFleet;
    // the worker counts the fleet rollup produced; passed in rather than recomputed so the meta line and
    // the roster it describes can never disagree
    counts: { working: number; waiting: number };
    harnesses: HarnessInfo[];
    now: number;
}

export function buildRecordPeek(input: RecordPeekInput): RecordPeek {
    const { detail, runs, fleet, counts, harnesses, now } = input;
    const objective = detail.objective?.trim() ?? "";
    return {
        title: objective !== "" ? headline(objective) : detail.id,
        titleIsId: objective === "",
        updatedLabel: detail.updated > 0 ? `updated ${ageLabel(Math.max(0, now - detail.updated))}` : "never updated",
        statusLabel: detail.status ?? "",
        statusRows: statusPickerRows(detail.status ?? ""),
        ...peekBody(detail),
        // the record variant of the shared line, so the peek counts workers across channels rather than
        // counting the rows below it — a record's fleet crosses channels by construction (spec §4a fidelity
        // note), and the rows are runs, which is a different number on purpose.
        fleetMeta: fleetCountsLine(counts, 0, fleet),
        runs: (runs ?? []).map((r) => {
            const row = runRow(r, objective, now, harnesses);
            const view = runStatusView(r.status);
            return {
                runId: r.id,
                shortId: row.shortId,
                // runRow returns a null headline when the run's goal merely echoes the record's objective —
                // it suppresses N identical lines. A row still needs something to read, so it falls back to
                // naming the run rather than rendering blank.
                headline: row.headline ?? `run ${row.shortId}`,
                meta: row.meta.join(" · "),
                state: view.label,
                tone: view.tone,
            };
        }),
        runsAbsent: RUNS_ABSENT,
        logLine: logLine(detail.decisions?.length ?? 0),
    };
}
