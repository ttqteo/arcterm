// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail's Verify tile as a pure model (spec 2026-11-20-rail-verify-design.md): wavesrv's VerifyStateData in, the
// tile's rows, head verdict, warning line, header chip, strip count and the rerun line out. Every sentence the person
// reads is worded here, so railverify.tsx only draws. The verdict is read from the rows and the not-run flags, not from
// `VerifyStateData.verdict`: the tile, the chip and the strip then agree by construction.

import { formatAgeShort, formatAgo } from "./agentsviewmodel";

export type VerifyTone = "red" | "amber" | "green" | "muted";

export interface VerifyRowVM {
    key: string; // the scenario
    name: string;
    state: string; // running | passed | failed | noresult | outofdate | skipped, for data-verify-state
    tone: VerifyTone; // the dot
    resultTone: VerifyTone; // the result text: red for a failed row, amber for no result, else muted
    pulsing: boolean; // a running row's dot pulses
    result: string; // "6/9", "No result", "2 of 3", "12/12", "Skipped"
    age: string; // "25m"
    startsOpen: boolean; // a failed row
    note: string | null; // no result: why; out of date: when it passed and what changed
    failed: string[]; // a failed row's failed steps
    passedMore: number; // a failed row's "+ N passed"
    command: string; // the one the run reported
    shots: string | null; // "Open the 9 screenshots"; null when the run took none
    shotsDir: string;
    canRerun: boolean;
    canSkip: boolean;
    skipped: boolean; // reads "Skipped" with Undo
}

export interface VerifyWarningVM {
    kind: "outofdate" | "notrun";
    text: string;
    skippable: boolean; // the not-run line carries Ask the agent to rerun and Skip; the out-of-date line is only a note
    skipped: boolean; // the not-run line was skipped: it reads Skipped with Undo and counts toward nothing
}

export interface VerifyTileVM {
    shown: boolean;
    folded: boolean; // everything passed or skipped, and no warning stands
    head: { parts: { text: string; tone: VerifyTone }[]; count: string }; // "1 failed", "1 no result"…; "3 scenarios"
    warning: VerifyWarningVM | null;
    rows: VerifyRowVM[];
    chip: { text: string; tone: "red" | "amber"; title: string } | null;
    strip: { tone: VerifyTone; label: string; struck: boolean; pulsing: boolean } | null; // "2", "!", "3"
}

// worst first; an unknown state sorts last
const RANK: Record<string, number> = { failed: 0, noresult: 1, running: 2, outofdate: 3, passed: 4, skipped: 5 };

function rankOf(state: string): number {
    return RANK[state] ?? 6;
}

function stamp(r: VerifyRowData): number {
    return r.ended || r.started;
}

function sortRows(rows: VerifyRowData[]): VerifyRowData[] {
    return [...rows].sort(
        (a, b) => rankOf(a.state) - rankOf(b.state) || stamp(b) - stamp(a) || a.scenario.localeCompare(b.scenario)
    );
}

function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

// "councilrail.tsx", "councilrail.tsx and 1 more UI file", "councilrail.tsx and 2 more UI files"; "UI files" when no file is known
function fileLabel(lead: string | undefined, changed: string[]): string {
    const first = lead || changed[0];
    if (!first) {
        return "UI files";
    }
    const others = changed.filter((p) => p !== first).length;
    const name = baseName(first);
    return others === 0 ? name : `${name} and ${others} more UI file${others === 1 ? "" : "s"}`;
}

// the leading "7." of each failed step text; null unless every step has one
function stepNumbers(failed: string[]): string[] | null {
    const nums = failed.map((s) => /^\s*(\d+)\s*[.)]/.exec(s)?.[1]);
    return nums.length > 0 && nums.every((n): n is string => n != null) ? nums : null;
}

function rowTone(state: string): VerifyTone {
    switch (state) {
        case "failed":
            return "red";
        case "noresult":
            return "amber";
        case "running":
        case "passed":
        case "outofdate":
            return "green";
        default:
            return "muted";
    }
}

function rowResult(r: VerifyRowData): string {
    switch (r.state) {
        case "noresult":
            return "No result";
        case "skipped":
            return "Skipped";
        case "running":
            return r.of > 0 ? `${r.done} of ${r.of}` : "Running";
        default:
            if (r.total > 0) {
                return `${r.passed}/${r.total}`;
            }
            return r.state === "failed" ? "Failed" : "Passed";
    }
}

function rowNote(r: VerifyRowData, now: number): string | null {
    if (r.state === "noresult") {
        return (
            r.reason || `Stopped during ${r.scenario}: the run ended without a result, so its steps were not checked.`
        );
    }
    if (r.state === "outofdate") {
        const file = r.changedfile ? baseName(r.changedfile) : "a UI file";
        return `Passed ${formatAgo(Math.max(0, now - stamp(r)))}, before ${file} changed.`;
    }
    return null;
}

function rowVM(r: VerifyRowData, now: number): VerifyRowVM {
    const actionable = r.state === "failed" || r.state === "noresult" || r.state === "outofdate";
    const dir = r.shotsdir ?? "";
    const failed = r.state === "failed" ? [...(r.failed ?? [])] : [];
    return {
        key: r.scenario,
        name: r.scenario,
        state: r.state,
        tone: rowTone(r.state),
        resultTone: r.state === "failed" ? "red" : r.state === "noresult" ? "amber" : "muted",
        pulsing: r.state === "running",
        result: rowResult(r),
        age: stamp(r) ? formatAgeShort(Math.max(0, now - stamp(r))) : "",
        startsOpen: r.state === "failed",
        note: rowNote(r, now),
        failed,
        passedMore: r.state === "failed" ? r.passed : 0,
        command: r.command || `task verify:ui -- ${r.scenario}`,
        shots:
            r.shots > 0 && dir !== ""
                ? `Open the ${r.shots === 1 ? "" : `${r.shots} `}screenshot${r.shots === 1 ? "" : "s"}`
                : null,
        shotsDir: dir,
        canRerun: actionable,
        canSkip: actionable,
        skipped: r.state === "skipped",
    };
}

function failedPhrase(r: VerifyRowData): string {
    const nums = stepNumbers(r.failed ?? []);
    return nums ? `failed step${nums.length === 1 ? "" : "s"} ${nums.join(", ")}` : "failed";
}

const EMPTY_TILE: VerifyTileVM = {
    shown: false,
    folded: false,
    head: { parts: [], count: "" },
    warning: null,
    rows: [],
    chip: null,
    strip: null,
};

export function verifyTile(st: VerifyStateData | null, now: number): VerifyTileVM {
    if (st == null) {
        return EMPTY_TILE;
    }
    const raw = sortRows(st.rows);
    const changed = st.changed ?? [];
    // "no scenario has run in this session" is true only when the agent has no row at all; with rows, a change after
    // them already shows as an out-of-date row (or the row is red or amber of its own)
    const notRun = st.notrun && raw.length === 0;
    const notRunActive = notRun && !st.notrunskipped;
    if (raw.length === 0 && !notRun) {
        return EMPTY_TILE;
    }

    const failedRows = raw.filter((r) => r.state === "failed");
    const noResultRows = raw.filter((r) => r.state === "noresult");
    const outOfDateRows = raw.filter((r) => r.state === "outofdate");
    const runningRows = raw.filter((r) => r.state === "running");
    const settled = raw.filter((r) => r.state === "passed" || r.state === "skipped").length;

    const parts: { text: string; tone: VerifyTone }[] = [];
    if (failedRows.length > 0) {
        parts.push({ text: `${failedRows.length} failed`, tone: "red" });
    }
    if (noResultRows.length > 0) {
        parts.push({ text: `${noResultRows.length} no result`, tone: "amber" });
    }
    if (outOfDateRows.length > 0) {
        parts.push({ text: `${outOfDateRows.length} out of date`, tone: "amber" });
    }
    if (notRunActive) {
        parts.push({ text: "not run", tone: "amber" });
    }
    if (parts.length === 0) {
        if (runningRows.length > 0) {
            parts.push({ text: "running", tone: "green" });
        } else if (settled > 0) {
            parts.push({ text: `${settled} passed`, tone: "green" });
        } else if (notRun) {
            parts.push({ text: "skipped", tone: "muted" });
        }
    }

    let warning: VerifyWarningVM | null = null;
    if (outOfDateRows.length > 0) {
        const lead = outOfDateRows[0];
        warning = {
            kind: "outofdate",
            text: `${fileLabel(lead.changedfile, changed)} changed after ${lead.scenario} last ran.`,
            skippable: false,
            skipped: false,
        };
    } else if (notRun) {
        warning = {
            kind: "notrun",
            text: `${fileLabel(undefined, changed)} changed, and no scenario has run in this session.`,
            skippable: !st.notrunskipped,
            skipped: st.notrunskipped,
        };
    }

    const titles: string[] = [
        ...failedRows.map((r) => `${r.scenario} ${failedPhrase(r)}`),
        ...noResultRows.map((r) => `${r.scenario} has no result`),
        ...outOfDateRows.map(
            (r) => `${r.scenario} passed before ${r.changedfile ? baseName(r.changedfile) : "a UI file"} changed`
        ),
    ];
    if (notRunActive) {
        titles.push(`${fileLabel(undefined, changed)} changed and no scenario has run`);
    }
    const title = titles.join("; ");

    let chip: VerifyTileVM["chip"] = null;
    let strip: VerifyTileVM["strip"];
    if (failedRows.length > 0) {
        chip = { text: `Verify: ${failedRows.length} failed`, tone: "red", title };
        strip = { tone: "red", label: String(failedRows.length), struck: true, pulsing: false };
    } else if (noResultRows.length > 0) {
        chip = { text: "Verify: no result", tone: "amber", title };
        strip = { tone: "amber", label: String(noResultRows.length), struck: false, pulsing: false };
    } else if (outOfDateRows.length > 0) {
        chip = { text: "Verify: out of date", tone: "amber", title };
        strip = { tone: "amber", label: "!", struck: false, pulsing: false };
    } else if (notRunActive) {
        chip = { text: "Verify: not run", tone: "amber", title };
        strip = { tone: "amber", label: "!", struck: false, pulsing: false };
    } else if (runningRows.length > 0) {
        strip = { tone: "green", label: "", struck: false, pulsing: true };
    } else {
        strip = { tone: "muted", label: settled > 0 ? String(settled) : "", struck: false, pulsing: false };
    }

    return {
        shown: true,
        folded:
            raw.every((r) => r.state === "passed" || r.state === "skipped") && !(warning != null && !warning.skipped),
        head: { parts, count: raw.length === 0 ? "" : `${raw.length} scenario${raw.length === 1 ? "" : "s"}` },
        warning,
        rows: raw.map((r) => rowVM(r, now)),
        chip,
        strip,
    };
}

/** The one line Ask the agent to rerun sends: the row's command and why it wants running again, or, for "notrun", the
 * changed files and the project's own rerun command. */
export function rerunLine(row: VerifyRowVM | "notrun", st: VerifyStateData): string {
    if (row === "notrun") {
        const changed = st.changed ?? [];
        const cover = changed.length === 1 ? "it" : "them";
        const command = st.rerun || "task verify:ui -- <name>";
        return `You changed ${fileLabel(undefined, changed)} without running a scenario. Run the scenarios that cover ${cover} (\`${command}\`), and add a step where none does.`;
    }
    const raw = st.rows.find((r) => r.scenario === row.key);
    const run = `Run \`${row.command}\` again`;
    switch (row.state) {
        case "failed": {
            const nums = stepNumbers(row.failed);
            return `${run} and fix the steps that fail${nums ? `: ${nums.join(", ")}` : ""}.`;
        }
        case "noresult":
            return raw && raw.total > 0
                ? `${run}: the last run stopped after step ${raw.total} without a result.`
                : `${run}: the last run stopped without a result.`;
        case "outofdate":
            return `${run}: ${raw?.changedfile ? baseName(raw.changedfile) : "a UI file"} changed after it passed.`;
        default:
            return `${run}.`;
    }
}
