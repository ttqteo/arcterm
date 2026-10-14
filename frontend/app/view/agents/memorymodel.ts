// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure derivations behind the Setup surface's Memory tab: rail meters and statuses, the check line,
// the index cards and their after-totals, the split's groups and switch-over gate, and each change's
// status and outcome text. memorystore.ts feeds these the memhygiene RPC results; setupmemory.tsx
// renders them.

import { fmtClock } from "./runcompletion";
import type { Tone } from "./setupmodel";

// claude code loads only this much of MEMORY.md; pkg/memhygiene/types.go holds the same two values.
export const LIMIT_LINES = 200;
export const LIMIT_BYTES = 25000;

export interface StatusText {
    text: string;
    tone: Tone;
}

const NO_INDEX: MemIndexStats = { exists: false, lines: 0, bytes: 0 };

function count(n: number, one: string, many = `${one}s`): string {
    return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function kb(bytes: number): string {
    return (bytes / 1000).toFixed(1);
}

function pctOf(n: number, of: number): number {
    return Math.max(0, Math.min(100, Math.round((100 * n) / of)));
}

function basename(path: string): string {
    const parts = path.split(/[\\/]/).filter((s) => s !== "");
    return parts[parts.length - 1] ?? "";
}

function monthDay(ts: number): string {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "today", "yesterday" or "Oct 12", by calendar day in local time.
function dayName(ts: number, now: number): string {
    const day = new Date(ts).toDateString();
    if (day === new Date(now).toDateString()) {
        return "today";
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return day === yesterday.toDateString() ? "yesterday" : monthDay(ts);
}

// the shared folder is named for the git toplevel's slug (every non-alphanumeric char becomes "-",
// agentobserve.SlugifyCwd), so the project path's ancestor with that slug names the repo. a folder set
// by autoMemoryDirectory matches no ancestor and falls back to its own name.
function repoName(path: string, folder: string): string {
    const folderParts = folder.split(/[\\/]/).filter((s) => s !== "");
    const last = folderParts[folderParts.length - 1] ?? "";
    const slugDir = (last.toLowerCase() === "memory" ? folderParts[folderParts.length - 2] : last) ?? "";
    const segs = path.replace(/[\\/]+$/, "").split(/[\\/]/);
    for (let i = segs.length; i > 0; i--) {
        const slug = segs
            .slice(0, i)
            .join("/")
            .replace(/[^A-Za-z0-9]/g, "-");
        if (slug.toLowerCase() === slugDir.toLowerCase()) {
            return segs[i - 1];
        }
    }
    return slugDir;
}

function sharedRepo(p: MemHygieneProject): string {
    return repoName(p.path, p.formershared || p.folder);
}

// an undecided change: open, or found changed on disk and waiting on a fresh check.
export function isPending(c: MemChange): boolean {
    return c.status !== "applied" && c.status !== "kept";
}

// a project sharing a folder with other registered projects gets the split, not ordinary changes.
export function isSplit(p: MemHygieneProject): boolean {
    return (p.sharedwith?.length ?? 0) > 0;
}

function settingsChange(p: MemHygieneProject): MemChange | undefined {
    return p.changes.find((c) => c.kind === "settings");
}

function switched(p: MemHygieneProject): boolean {
    return isSplit(p) && settingsChange(p)?.status === "applied";
}

export function projectsToReview(projects: MemHygieneProject[]): number {
    return projects.filter((p) => p.changes.some(isPending)).length;
}

export function toolbarStatus(projects: MemHygieneProject[]): StatusText {
    const n = projectsToReview(projects);
    if (n === 0) {
        return { text: "Every project checked", tone: "ok" };
    }
    return { text: `${count(n, "project")} to review`, tone: "warn" };
}

export interface RailRow {
    name: string;
    pct: number;
    meter: string;
    status: string;
    tone: Tone;
}

function indexMeter(ix: MemIndexStats): string {
    return `${count(ix.lines, "line")} · ${kb(ix.bytes)} of ${LIMIT_BYTES / 1000} KB`;
}

function railStatus(p: MemHygieneProject): StatusText {
    if (p.checking) {
        return { text: "Checking…", tone: "none" };
    }
    if (!p.checkedat) {
        return { text: "Not checked yet", tone: "none" };
    }
    if (isSplit(p) && settingsChange(p)?.status === "kept") {
        return { text: "Kept sharing", tone: "none" };
    }
    const n = p.changes.filter(isPending).length;
    if (n > 0) {
        return { text: `${n} to review`, tone: "warn" };
    }
    if (p.lasterror) {
        return { text: "Last check failed", tone: "warn" };
    }
    return { text: "Nothing to review", tone: "ok" };
}

export function railRow(p: MemHygieneProject): RailRow {
    const { text: status, tone } = railStatus(p);
    const row = { name: p.project, status, tone };
    if (!p.checkedat) {
        // the status already says "Not checked yet"; repeating it in the meter shows it twice
        return { ...row, pct: 0, meter: "" };
    }
    if (isSplit(p) && !switched(p)) {
        return {
            ...row,
            pct: pctOf(p.index.lines, LIMIT_LINES),
            meter: `Shares ${sharedRepo(p)}’s memory · ${count(p.index.lines, "line")}`,
        };
    }
    const ix = isSplit(p) ? (p.ownindex ?? NO_INDEX) : p.index;
    return {
        ...row,
        pct: Math.max(pctOf(ix.lines, LIMIT_LINES), pctOf(ix.bytes, LIMIT_BYTES)),
        meter: indexMeter(ix),
    };
}

export function checkLine(p: MemHygieneProject, now: number): string {
    if (p.checking) {
        return "Checking…";
    }
    let line = "Not checked yet";
    if (p.checkedat) {
        // during a split the memory count is the shared folder's, which isn't this project's
        const counts = isSplit(p)
            ? count(p.sessions, "session")
            : `${count(p.memories, "memory", "memories")}, ${count(p.sessions, "session")}`;
        const parts = [`Checked ${dayName(p.checkedat, now)} at ${fmtClock(p.checkedat)}`, counts];
        if (p.nextcheckat) {
            parts.push(`next check ${monthDay(p.nextcheckat)}`);
        }
        line = parts.join(" · ");
    }
    if (p.lasterror) {
        line += ` · Last check failed: ${p.lasterror}`;
    }
    return line;
}

export function splitText(p: MemHygieneProject): string {
    if (!isSplit(p) || switched(p)) {
        return "";
    }
    const others = p.sharedwith;
    const names =
        others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
    return (
        `Claude Code gives a git repo one memory, so ${p.project} sessions load ${sharedRepo(p)}’s MEMORY.md, ` +
        `which ${names} ${others.length === 1 ? "shares" : "share"}. These changes give ${p.project} its own.`
    );
}

export interface IndexCard {
    label: string;
    role: string;
    lines: string;
    kb: string;
    linesPct: number;
    kbPct: number;
    after: string;
}

// the stored index is re-measured after every apply and undo, so it already holds applied changes;
// only the changes still to review move the after-total.
function indexCard(
    label: string,
    role: string,
    ix: MemIndexStats,
    changes: MemChange[],
    delta: "indexdelta" | "ownindexdelta"
): IndexCard {
    const has = ix.exists || ix.lines > 0;
    const rest = changes
        .filter(isPending)
        .map((c) => c[delta])
        .filter((d) => d && (d.lines || d.bytes));
    const lines = ix.lines + rest.reduce((a, d) => a + d.lines, 0);
    const bytes = ix.bytes + rest.reduce((a, d) => a + d.bytes, 0);
    return {
        label,
        role,
        lines: has ? `${ix.lines} of ${LIMIT_LINES}` : "none yet",
        kb: has ? `${kb(ix.bytes)} of ${LIMIT_BYTES / 1000} KB` : "none yet",
        linesPct: pctOf(ix.lines, LIMIT_LINES),
        kbPct: pctOf(ix.bytes, LIMIT_BYTES),
        after:
            rest.length > 0
                ? `After the changes still to review: ${count(lines, "line")} · ${kb(bytes)} KB`
                : "Nothing left to review here.",
    };
}

export function indexCards(p: MemHygieneProject): IndexCard[] {
    if (!isSplit(p)) {
        return [indexCard("MEMORY.md", `Loaded by ${p.project}`, p.index, p.changes, "indexdelta")];
    }
    const done = switched(p);
    return [
        indexCard(
            `${sharedRepo(p)}’s MEMORY.md`,
            done ? "No longer loaded here" : `Loaded by ${p.project} today`,
            p.index,
            p.changes,
            "indexdelta"
        ),
        indexCard(
            `${p.project}’s MEMORY.md`,
            done ? `Loaded by ${p.project}` : "Loaded once you switch over",
            p.ownindex ?? NO_INDEX,
            p.changes,
            "ownindexdelta"
        ),
    ];
}

export interface ChangeGroup {
    key: string;
    label: string;
    hint: string;
    changes: MemChange[];
}

// a split lists its groups in review order: what comes over from the shared memory, what's already
// in the own folder, then the switch-over. an empty group is left out.
export function changeGroups(p: MemHygieneProject): ChangeGroup[] {
    if (!isSplit(p)) {
        return [{ key: "", label: "", hint: "", changes: p.changes }];
    }
    const repo = sharedRepo(p);
    const groups: ChangeGroup[] = [
        {
            key: "shared",
            label: `From ${repo}’s memory`,
            hint: p.memories
                ? `Memories about ${p.project}, out of ${repo}’s ${p.memories.toLocaleString("en-US")}`
                : `Memories about ${p.project}`,
            changes: [],
        },
        {
            key: "own",
            label: "Already in its own folder",
            hint: "Files left by the old memory harvester; no session loads them yet",
            changes: [],
        },
        { key: "switch", label: "Switch over", hint: "", changes: [] },
    ];
    for (const g of groups) {
        g.changes = p.changes.filter((c) => c.group === g.key);
    }
    return groups.filter((g) => g.changes.length > 0);
}

export interface Gate {
    blocked: boolean;
    text: string;
}

// switching first would drop the memories still waiting to come over from the shared folder.
export function switchGate(p: MemHygieneProject, change: MemChange): Gate {
    if (change.kind !== "settings" || !isPending(change)) {
        return { blocked: false, text: "" };
    }
    const n = p.changes.filter((c) => c.group === "shared" && isPending(c)).length;
    if (n === 0) {
        return { blocked: false, text: "" };
    }
    return {
        blocked: true,
        text:
            `Review the ${count(n, "change")} from ${sharedRepo(p)}’s memory first. ` +
            `Switching now would drop those memories from ${p.project} sessions.`,
    };
}

export function closedText(p: MemHygieneProject, change: MemChange, now: number): string {
    if (change.status === "kept") {
        return "Kept as is. The next check skips it unless the memory changes.";
    }
    if (change.status !== "applied") {
        return "";
    }
    let when = "";
    if (change.decidedat) {
        const day = dayName(change.decidedat, now);
        when = `${day === "today" ? "" : ` ${day}`} at ${fmtClock(change.decidedat)}`;
    }
    const settings = change.kind === "settings";
    let text = `Applied${when}.`;
    if (settings) {
        text += ` New ${p.project} sessions load its own memory.`;
    }
    if (change.backupuntil) {
        text += ` Arc kept a copy of the old ${settings ? "settings" : "files"} until ${monthDay(change.backupuntil)}.`;
    }
    return text;
}

export function statusOf(change: MemChange): StatusText {
    switch (change.status) {
        case "applied":
            return { text: "Applied", tone: "ok" };
        case "kept":
            return { text: "Kept", tone: "none" };
        case "conflict":
            return { text: "Changed on disk", tone: "warn" };
        default:
            return { text: "To review", tone: "warn" };
    }
}

export function kindLabel(p: MemHygieneProject, change: MemChange): string {
    switch (change.kind) {
        case "delete":
            return "Delete";
        case "trim":
            return "Trim";
        case "merge":
            return "Merge";
        case "move-to-doc":
            return `Move to ${basename(change.op.docpath) || "AGENTS.md"}`;
        case "add-to-index":
            return "Add to index";
        case "move-here":
            return "Move here";
        case "copy-here":
            return "Copy here";
        case "remove-shared":
            return `Remove from ${sharedRepo(p)}`;
        case "settings":
            return "Settings";
        default:
            return change.kind;
    }
}

// the memory files a change acts on, for the table's second line.
export function fileLabel(change: MemChange): string {
    if (change.kind === "settings") {
        return change.op.settingspath;
    }
    const names = change.op.memories?.length ? change.op.memories : change.files.map((f) => basename(f.path));
    if (names.length <= 2) {
        return names.join(" + ");
    }
    return `${names[0]} + ${names.length - 1} more`;
}
