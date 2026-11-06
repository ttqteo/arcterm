// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure derivations behind the Setup surface's Memory tab: rail meters and statuses, the check line,
// the index cards and their after-totals, the split's groups and switch-over gate, each change's
// status and outcome text, and the card view's queue, card and keys (one memory at a time).
// memorystore.ts feeds these the memhygiene RPC results; setupmemory.tsx and memorycard.tsx render them.

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

// an undecided change: open, or found changed on disk and waiting on a fresh check. an allow-list, as
// memhygiene.Pending in pkg/memhygiene/split.go is, so a decided change (applied, kept) and a Review
// another change replaced (superseded) both read as decided.
export function isPending(c: MemChange): boolean {
    return c.status === "" || c.status === "open" || c.status === "conflict";
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
        case "superseded":
            return { text: "Replaced", tone: "none" };
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

// ---- the card view: one memory at a time ----

export type MemoryView = "cards" | "table";

// a shared folder, or an open split / remove-shared / settings change, needs the table's groups,
// Apply all and switch gate; everything else opens one card at a time.
export function defaultMemoryView(p: MemHygieneProject): MemoryView {
    if (isSplit(p)) {
        return "table";
    }
    const tableOnly = p.changes.some(
        (c) => isPending(c) && (c.group !== "" || c.kind === "remove-shared" || c.kind === "settings")
    );
    return tableOnly ? "table" : "cards";
}

// pkg/memhygiene/check.go's checkTimeout: an ask marker older than this belongs to an ask that died
// (a restart loses its goroutine), so it and the ids waiting behind it read as idle.
export const ASK_TIMEOUT_MS = 30 * 60 * 1000;

export type AskState = "asking" | "waiting" | "idle";

function liveAsk(p: MemHygieneProject, now: number): MemAsk | null {
    const a = p.asking;
    return a && a.changeid && now - a.startedat < ASK_TIMEOUT_MS ? a : null;
}

export function askState(p: MemHygieneProject, changeId: string, now: number): AskState {
    const a = liveAsk(p, now);
    if (a == null) {
        return "idle";
    }
    if (a.changeid === changeId) {
        return "asking";
    }
    return (p.askwaiting ?? []).includes(changeId) ? "waiting" : "idle";
}

// Check now would race the ask's state write, so it waits for the ask queue to drain
export function checkNowBlocked(p: MemHygieneProject, now: number): string | null {
    return liveAsk(p, now) ? "Waiting for Ask an agent" : null;
}

export function judgedByText(p: MemHygieneProject): string {
    return p.judgedby ? `judged by ${p.judgedby}` : "";
}

function isDecided(c: MemChange): boolean {
    return c.status === "applied" || c.status === "kept";
}

function byId(p: MemHygieneProject, id: string): MemChange | undefined {
    return id ? p.changes.find((c) => c.id === id) : undefined;
}

// the queue's changes: every open one in table order, then the ones decided since the last check (a
// superseded Review is left out; its delete or proposal stands in its place)
function queueChanges(p: MemHygieneProject): MemChange[] {
    const order = changeOrder(p);
    return [
        ...order.filter(isPending),
        ...order.filter((c) => isDecided(c) && (c.decidedat ?? 0) >= (p.checkedat ?? 0)),
    ];
}

function capitalize(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function lowerFirst(s: string): string {
    return s ? s[0].toLowerCase() + s.slice(1) : s;
}

// the memory a change acts on, by its title: a delete or agent proposal made from a Review carries
// the Review's memory, whose title the proposal's own (the agent's reason) replaced
function memoryTitle(p: MemHygieneProject, c: MemChange): string {
    const from = byId(p, c.fromreview);
    return from?.title || c.title;
}

const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

// Claude Code names a memory file for its type (feedback_x.md); the file line shows it beside the name
function memoryType(c: MemChange): string {
    const names = c.op.memories ?? [];
    if (names.length !== 1) {
        return "";
    }
    const prefix = names[0].split("_")[0];
    return names[0].includes("_") && MEMORY_TYPES.includes(prefix) ? prefix : "";
}

export type QueueTone = Tone | "accent";

export interface QueueRow {
    id: string;
    title: string;
    status: string;
    tone: QueueTone;
    decided: boolean;
}

function reviewEffect(c: MemChange): StatusText {
    const effect = c.effect || "to review";
    return { text: capitalize(effect), tone: effect.startsWith("untouched") ? "warn" : "none" };
}

function queueStatus(p: MemHygieneProject, c: MemChange, now: number): { text: string; tone: QueueTone } {
    if (c.status === "applied") {
        if (c.kind === "review") {
            return { text: "Still true", tone: "none" };
        }
        return { text: c.kind === "delete" ? "Deleted · Undo" : "Applied · Undo", tone: "none" };
    }
    if (c.status === "kept") {
        return { text: "Kept", tone: "none" };
    }
    const ask = askState(p, c.id, now);
    if (ask === "asking") {
        return { text: `Asking ${liveAsk(p, now)?.runtime || "the agent"}…`, tone: "none" };
    }
    if (ask === "waiting") {
        return { text: "Waiting to ask…", tone: "none" };
    }
    if (c.status === "conflict") {
        return statusOf(c);
    }
    if (c.source === "agent") {
        return { text: `Agent proposes: ${lowerFirst(kindLabel(p, c))}`, tone: "accent" };
    }
    if (c.kind === "review") {
        return reviewEffect(c);
    }
    const label = kindLabel(p, c);
    return { text: c.effect ? `${label} · ${c.effect}` : label, tone: "none" };
}

export function memoryQueue(p: MemHygieneProject, now: number): QueueRow[] {
    return queueChanges(p).map((c) => {
        const { text, tone } = queueStatus(p, c, now);
        return { id: c.id, title: memoryTitle(p, c), status: text, tone, decided: isDecided(c) };
    });
}

// the shown card's change: the chosen one while it is in the queue, else the first open one, else none
// (the done card)
export function pickCard(p: MemHygieneProject, id: string | null): MemChange | null {
    const queue = queueChanges(p);
    return queue.find((c) => c.id === id) ?? queue.find(isPending) ?? null;
}

// j and k: the queue row delta away from the shown card, stopping at either end
export function stepQueue(p: MemHygieneProject, id: string | null, delta: number): string | null {
    const queue = queueChanges(p);
    if (queue.length === 0) {
        return null;
    }
    const shown = pickCard(p, id);
    const i = shown ? queue.findIndex((c) => c.id === shown.id) : -1;
    const next = i < 0 ? 0 : Math.max(0, Math.min(queue.length - 1, i + delta));
    return queue[next].id;
}

// after a verdict, the next open item. the queue lists open items in table order, so this is
// nextPending: the table order still holds a superseded Review at its old place, which is what lets
// a Delete advance from the Review it replaced.
export function nextOpenInQueue(p: MemHygieneProject, id: string): string | null {
    return nextPending(p, id);
}

// after an Undo, the card to show. undone is the change as it was before the Undo (once a Delete made
// from a Review is undone it is gone from p, and its fromreview with it): the Review it reopened, else
// the undone change itself.
export function selectAfterUndo(p: MemHygieneProject, undone: MemChange): string | null {
    if (byId(p, undone.id)) {
        return undone.id;
    }
    const from = byId(p, undone.fromreview);
    return from && isPending(from) ? from.id : undone.id;
}

// after Keep: Back to review (Keep on a change made from a Review) shows the reopened Review; an
// ordinary Keep moves on to the next open item
export function selectAfterKeep(p: MemHygieneProject, keptId: string): string | null {
    const from = byId(p, byId(p, keptId)?.fromreview ?? "");
    return from && isPending(from) ? from.id : nextOpenInQueue(p, keptId);
}

export interface DoneCard {
    title: string;
    next: string;
}

export function doneCard(p: MemHygieneProject, now: number): DoneCard {
    return {
        title: `Nothing to review in ${p.project}`,
        next: p.nextcheckat ? `Next check ${dayName(p.nextcheckat, now)} at ${fmtClock(p.nextcheckat)}.` : "",
    };
}

export type CardKind = "review" | "proposal" | "change";

export type CardAction = "apply" | "ask" | "delete" | "keep" | "talk" | "undo" | "reopen";

export type CardKeyAction = "apply" | "delete" | "keep" | "undo" | "reopen";

export interface CardButton {
    action: CardAction;
    label: string;
    // the key that presses it, "" for none
    key: string;
    primary: boolean;
    danger: boolean;
    disabled: boolean;
}

export type CardBody =
    | { kind: "text"; text: string }
    | { kind: "proposal"; reason: string; diffs: MemDiff[] }
    | { kind: "diff"; diffs: MemDiff[] };

export interface CardReason {
    verdict: string;
    // "Asked claude at 12:58: <the judge's reason>", "" when never asked
    askLine: string;
    doclines: MemDocLine[];
    // the evidence rows, folded under Details
    evidence: MemEvidence[];
}

export interface CardModel {
    id: string;
    kind: CardKind;
    decided: boolean;
    chip: string;
    chipTone: KindTone;
    head: StatusText;
    title: string;
    fileLine: string;
    body: CardBody;
    buttons: CardButton[];
    hint: string;
    // the line under the buttons: the ask running or waiting, a failed ask, a held switch-over, or
    // a decided change's outcome; null for none
    status: StatusText | null;
    reason: CardReason;
}

const REVIEW_HINT =
    "Ask an agent proposes one change for this memory (move into AGENTS.md, trim, delete or still true) " +
    "that you Apply with Undo. Delete keeps a copy you can undo.";

function button(action: CardAction, label: string, key: string, over: Partial<CardButton> = {}): CardButton {
    return { action, label, key, primary: false, danger: false, disabled: false, ...over };
}

// "Untouched 30 days, since Sep 14", from the Review's untouched evidence row (its code is the date)
function reviewHead(c: MemChange): StatusText {
    const head = reviewEffect(c);
    const row = (c.evidence ?? []).find((e) => e.text.startsWith("Untouched for") && e.code);
    const m = row?.code.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (head.tone === "warn" && m) {
        const since = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
        return { ...head, text: `${head.text}, since ${monthDay(since)}` };
    }
    return head;
}

function proposalHead(c: MemChange, now: number): StatusText {
    if (!c.proposedat) {
        return { text: "Proposed by the agent", tone: "none" };
    }
    const day = dayName(c.proposedat, now);
    const when = day === "today" ? fmtClock(c.proposedat) : `${day} at ${fmtClock(c.proposedat)}`;
    return { text: `Proposed by the agent, ${when}`, tone: "none" };
}

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function filesPhrase(n: number): string {
    if (n <= 1) {
        return "the file";
    }
    if (n === 2) {
        return "both files";
    }
    return `all ${NUMBER_WORDS[n] ?? n} files`;
}

function docName(c: MemChange): string {
    return basename(c.op.docpath) || "AGENTS.md";
}

function proposalHint(c: MemChange): string {
    const files = new Set([...(c.files ?? []).map((f) => f.path), ...(c.diffs ?? []).map((d) => d.path)]);
    return (
        `Apply keeps a copy of ${filesPhrase(files.size)}, with Undo. Talk it over opens a Claude agent with this ` +
        `memory, ${docName(c)} and the proposal; it edits the files itself, outside Undo.`
    );
}

function cardButtons(p: MemHygieneProject, c: MemChange, kind: CardKind, now: number): CardButton[] {
    if (c.status === "applied") {
        return [button("undo", "Undo", "u")];
    }
    if (c.status === "kept") {
        return [button("reopen", "Review again", "u")];
    }
    const applyable = canApply(p, c);
    if (kind === "review") {
        const ask = askState(p, c.id, now);
        const asking = ask === "asking";
        const open = c.status === "open" || c.status === "";
        return [
            button("apply", c.applylabel || "Still true", "a", { primary: true, disabled: asking || !applyable }),
            button("ask", "Ask an agent…", "", { disabled: asking || ask === "waiting" || p.checking || !open }),
            button("delete", "Delete", "d", { danger: true, disabled: asking || !open }),
            button("keep", "Keep as is", "x", { disabled: asking }),
        ];
    }
    if (kind === "proposal") {
        return [
            button("apply", "Apply", "a", { primary: true, disabled: !applyable }),
            button("talk", "Talk it over with an agent", ""),
            button("keep", "Back to review", "x"),
        ];
    }
    return [
        button("apply", c.applylabel || kindLabel(p, c), "a", { primary: true, disabled: !applyable }),
        button("keep", "Keep as is", "x"),
    ];
}

function cardStatus(p: MemHygieneProject, c: MemChange, now: number): StatusText | null {
    if (isDecided(c)) {
        return { text: closedText(p, c, now), tone: statusOf(c).tone };
    }
    const ask = askState(p, c.id, now);
    if (ask === "asking") {
        return { text: `Asking ${liveAsk(p, now)?.runtime || "the agent"}…`, tone: "none" };
    }
    if (ask === "waiting") {
        return { text: "Waiting to ask…", tone: "none" };
    }
    if (c.askerror) {
        return { text: c.askerror, tone: "warn" };
    }
    const gate = switchGate(p, c);
    return gate.blocked ? { text: gate.text, tone: "warn" } : null;
}

export function memoryCard(p: MemHygieneProject, change: MemChange, now: number): CardModel {
    const kind: CardKind = change.kind === "review" ? "review" : change.source === "agent" ? "proposal" : "change";
    const type = memoryType(change);
    let head: StatusText;
    let body: CardBody;
    let hint: string;
    if (kind === "review") {
        head = reviewHead(change);
        body = { kind: "text", text: change.body };
        hint = REVIEW_HINT;
    } else if (kind === "proposal") {
        head = proposalHead(change, now);
        body = { kind: "proposal", reason: change.title, diffs: change.diffs ?? [] };
        hint = proposalHint(change);
    } else {
        head = { text: capitalize(change.effect), tone: "none" };
        body = { kind: "diff", diffs: change.diffs ?? [] };
        hint = change.note;
    }
    const decided = isDecided(change);
    return {
        id: change.id,
        kind,
        decided,
        chip: kindLabel(p, change),
        chipTone: kindTone(change.kind),
        head,
        title: memoryTitle(p, change),
        fileLine: type ? `${fileLabel(change)} · ${type}` : fileLabel(change),
        body,
        buttons: cardButtons(p, change, kind, now),
        hint: decided ? "" : hint,
        status: cardStatus(p, change, now),
        reason: {
            verdict: change.verdict,
            askLine: change.askedat
                ? `Asked ${change.askedby || "the agent"} at ${fmtClock(change.askedat)}` +
                  (change.askreason ? `: ${change.askreason}` : "")
                : "",
            // the wire's nil slice arrives as null
            doclines: change.doclines ?? [],
            evidence: change.evidence ?? [],
        },
    };
}

const KEY_ACTIONS: CardAction[] = ["apply", "delete", "keep", "undo", "reopen"];

// a key on the card view: the enabled button it presses, if it has one
export function cardKeyAction(card: CardModel, key: string): CardKeyAction | null {
    const b = card.buttons.find((x) => x.key === key && !x.disabled);
    return b && KEY_ACTIONS.includes(b.action) ? (b.action as CardKeyAction) : null;
}

function joinPath(dir: string, name: string): string {
    if (!dir) {
        return name;
    }
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.replace(/[\\/]+$/, "") + sep + name;
}

// the memory file a change acts on: its Review's file, else the file named for its memory
function memoryPath(p: MemHygieneProject, c: MemChange): string {
    const from = byId(p, c.fromreview);
    if (from?.files?.[0]?.path) {
        return from.files[0].path;
    }
    const name = c.op.memories?.[0] ?? "";
    const file = (c.files ?? []).find((f) => name && basename(f.path) === name);
    return file?.path ?? (name ? joinPath(c.op.folder || p.folder, name) : (c.files?.[0]?.path ?? ""));
}

// the task "Talk it over with an agent" launches a claude agent with: what it needs to talk the
// proposal over, and that its edits are its own (memhygiene's Undo never sees them)
export function talkItOverTask(p: MemHygieneProject, change: MemChange): string {
    const from = byId(p, change.fromreview);
    const text = change.body || from?.body || "";
    const docPath = change.op.docpath || joinPath(p.path, "AGENTS.md");
    const diffs = (change.diffs ?? []).flatMap((d) => [
        `--- ${d.path}${d.note ? ` (${d.note})` : ""}`,
        ...(d.lines ?? []).map((l) => `${l.sign}${l.text}`),
    ]);
    const lines = [
        `Talk over a proposed change to one of my Claude Code memories in ${p.project}, then make the change we agree on.`,
        "",
        `Memory file: ${memoryPath(p, change)}`,
        "Its text:",
        text,
        "",
        `The project's instructions: ${docPath}`,
        "",
        `The proposal (${kindLabel(p, change)}): ${change.title}`,
    ];
    if (change.note) {
        lines.push(change.note);
    }
    if (diffs.length > 0) {
        lines.push("", "Its diffs:", ...diffs);
    }
    lines.push(
        "",
        `Read the memory and ${basename(docPath)}, tell me what you think of the proposal, and ask before changing ` +
            "anything. Once we agree, edit the files yourself (the memory, MEMORY.md, the instructions doc): " +
            "this happens outside Arc's memory Undo, and the next memory check picks up what changed."
    );
    return lines.join("\n");
}
