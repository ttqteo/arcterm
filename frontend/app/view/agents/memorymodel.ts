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
    return bytes === 0 ? "0" : (bytes / 1000).toFixed(1);
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

// an undecided change: open, or found changed on disk and waiting on a fresh check. memhygiene.Pending
// in pkg/memhygiene/split.go mirrors it.
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

function hasPending(p: MemHygieneProject): boolean {
    return p.changes.some(isPending);
}

// the note beside Check now once a check the user started has ended. a check with nothing new to judge
// ends in well under a second, so without it the click reads as dead. a failure's reason is on the check line.
export function checkResult(p: MemHygieneProject): StatusText {
    if (p.lasterror) {
        return { text: "Check failed", tone: "warn" };
    }
    const n = p.changes.filter(isPending).length;
    return n > 0
        ? { text: `Checked · ${n} to review`, tone: "warn" }
        : { text: "Checked · nothing to review", tone: "ok" };
}

export function projectsToReview(projects: MemHygieneProject[]): number {
    return projects.filter(hasPending).length;
}

// the nav rail's Setup item, which counts the projects to review: its title says what the badge counts
export function setupRailTitle(toReview: number): string {
    return toReview > 0 ? `Setup — memory to review in ${count(toReview, "project")}` : "Setup";
}

// projects with something to review lead the rail, each half in the backend's order
export function railOrder(projects: MemHygieneProject[]): MemHygieneProject[] {
    return [...projects.filter(hasPending), ...projects.filter((p) => !hasPending(p))];
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
    // checked, with an empty index and nothing to review: the rail draws it on one line
    empty: boolean;
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
    const empty = tone === "ok" && !isSplit(p) && p.index.lines === 0;
    const row = { name: p.project, status, tone, empty };
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
    p: MemHygieneProject,
    label: string,
    role: string,
    ix: MemIndexStats,
    delta: "indexdelta" | "ownindexdelta"
): IndexCard {
    const has = ix.exists || ix.lines > 0;
    const rest = p.changes
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
        after: !p.checkedat
            ? "Not checked yet."
            : rest.length > 0
              ? `After the changes still to review: ${count(lines, "line")} · ${kb(bytes)} KB`
              : "Nothing left to review here.",
    };
}

export function indexCards(p: MemHygieneProject): IndexCard[] {
    if (!isSplit(p)) {
        return [indexCard(p, "MEMORY.md", `Loaded by ${p.project}`, p.index, "indexdelta")];
    }
    const done = switched(p);
    return [
        indexCard(
            p,
            `${sharedRepo(p)}’s MEMORY.md`,
            done ? "No longer loaded here" : `Loaded by ${p.project} today`,
            p.index,
            "indexdelta"
        ),
        indexCard(
            p,
            `${p.project}’s MEMORY.md`,
            done ? `Loaded by ${p.project}` : "Loaded once you switch over",
            p.ownindex ?? NO_INDEX,
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

// the changes in the order the table lists them
function changeOrder(p: MemHygieneProject): MemChange[] {
    return changeGroups(p).flatMap((g) => g.changes);
}

// with nothing chosen yet, or the chosen one gone, open the first change still to review
export function pickChange(p: MemHygieneProject, id: string | null): MemChange | null {
    const order = changeOrder(p);
    return order.find((c) => c.id === id) ?? order.find(isPending) ?? order[0] ?? null;
}

export interface MemorySelection {
    project: MemHygieneProject | null;
    change: MemChange | null;
}

// the rail opens on its first project, so with nothing chosen that is one with changes to review
export function resolveSelection(
    projects: MemHygieneProject[] | null,
    projectName: string | null,
    changeId: string | null
): MemorySelection {
    const project = projects?.find((x) => x.project === projectName) ?? railOrder(projects ?? [])[0] ?? null;
    return { project, change: project == null ? null : pickChange(project, changeId) };
}

// j and k: the change delta rows away in table order, stopping at either end
export function stepChange(p: MemHygieneProject, id: string | null, delta: number): string | null {
    const order = changeOrder(p);
    if (order.length === 0) {
        return null;
    }
    const i = order.findIndex((c) => c.id === id);
    const next = i < 0 ? 0 : Math.max(0, Math.min(order.length - 1, i + delta));
    return order[next].id;
}

// after a verdict, the next change still to review below the decided one, else the first above it
export function nextPending(p: MemHygieneProject, id: string): string | null {
    const order = changeOrder(p);
    const i = order.findIndex((c) => c.id === id);
    const rotated = [...order.slice(i + 1), ...order.slice(0, Math.max(i, 0))];
    return rotated.find(isPending)?.id ?? null;
}

// a conflict needs a fresh check, and the switch-over waits on the shared changes
export function canApply(p: MemHygieneProject, change: MemChange): boolean {
    return isPending(change) && change.status !== "conflict" && !switchGate(p, change).blocked;
}

// a labelled group short of the switch-over can be applied as a whole: the split's moves and copies run to
// dozens, each already sorted by the check. conflicts are left for their own review.
export function applyAllIds(g: ChangeGroup): string[] {
    if (g.key === "" || g.key === "switch") {
        return [];
    }
    const ids = g.changes.filter((c) => c.status === "open").map((c) => c.id);
    return ids.length > 1 ? ids : [];
}

export type KindTone = "remove" | "add" | "edit";

// what a change does to the memory, for the kind chip's tint
export function kindTone(kind: string): KindTone {
    switch (kind) {
        case "delete":
        case "remove-shared":
            return "remove";
        case "move-here":
        case "copy-here":
        case "add-to-index":
        case "move-to-doc":
            return "add";
        default:
            return "edit";
    }
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
    if (change.kind === "review") {
        // Still true rewrites the memory as it was, so the backup holds nothing worth naming
        return `Marked still true${when}. It comes back for review if it goes untouched another 30 days.`;
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
        case "review":
            return "Review";
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
