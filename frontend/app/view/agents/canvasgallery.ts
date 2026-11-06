// Pure model for Agent → Canvas gallery (spec 2026-10-14-canvas-gallery-design.md): grouping, search, the clean-up
// suggestion, the selection's totals, and when a preview is stale. Versions (spec 2026-11-05-canvas-related-design.md):
// which canvas replaces which, the scan's suggestions, the link picker's list, and the writes the link command takes.
// No React, no Wave runtime imports.

import { formatSize } from "./storagemodel";

// the fields match the StorageCanvas rows ListCanvasesCommand returns; own type so the model needs no generated types.
// title is canvas.json's, createdts the creation time (modts when canvas.json has none), replaces the topic this canvas
// replaces, and notreplaces the topics the person said it is not a version of
export type GalleryCanvas = {
    topic: string;
    project: string;
    projectname: string;
    designdir: string;
    dir: string;
    boards: string[];
    modts: number;
    thumbts: number;
    bytes: number;
    title?: string;
    createdts: number;
    replaces?: string;
    notreplaces?: string[];
};
export type GalleryGroup = { key: "today" | "yesterday" | "earlier"; label: string; items: GalleryCanvas[] };

export const SUGGEST_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function newestFirst(items: GalleryCanvas[]): GalleryCanvas[] {
    return [...items].sort((a, b) => b.modts - a.modts);
}

function startOfDay(ts: number): number {
    return new Date(ts).setHours(0, 0, 0, 0);
}

export function groupByDay(items: GalleryCanvas[], now: number): GalleryGroup[] {
    const today = startOfDay(now);
    // setDate, not minus 24 h: a day with a clock change is not 24 h long
    const yesterday = new Date(today).setDate(new Date(today).getDate() - 1);
    const groups: GalleryGroup[] = [
        { key: "today", label: "Today", items: [] },
        { key: "yesterday", label: "Yesterday", items: [] },
        { key: "earlier", label: "Earlier", items: [] },
    ];
    for (const c of newestFirst(items)) {
        const at = c.modts >= today ? 0 : c.modts >= yesterday ? 1 : 2;
        groups[at].items.push(c);
    }
    return groups.filter((g) => g.items.length > 0);
}

export function searchCanvases(items: GalleryCanvas[], query: string): GalleryCanvas[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return items;
    }
    return items.filter((c) => [c.topic, c.projectname, ...c.boards].some((s) => s.toLowerCase().includes(q)));
}

export function isSuggested(c: GalleryCanvas, now: number): boolean {
    return now - c.modts > SUGGEST_AFTER_DAYS * DAY_MS;
}

export function cleanupGroups(
    items: GalleryCanvas[],
    now: number
): { suggested: GalleryCanvas[]; newer: GalleryCanvas[] } {
    const sorted = newestFirst(items);
    return {
        suggested: sorted.filter((c) => isSuggested(c, now)),
        newer: sorted.filter((c) => !isSuggested(c, now)),
    };
}

// the clean-up cards in the order they are drawn, which is the order its cursor walks
export function cleanupOrder(items: GalleryCanvas[], now: number): GalleryCanvas[] {
    const g = cleanupGroups(items, now);
    return [...g.suggested, ...g.newer];
}

export function initialSelection(items: GalleryCanvas[], now: number): Set<string> {
    return new Set(items.filter((c) => isSuggested(c, now)).map((c) => c.dir));
}

export function toggled(sel: Set<string>, dir: string): Set<string> {
    const next = new Set(sel);
    if (!next.delete(dir)) {
        next.add(dir);
    }
    return next;
}

// what a clean leaves ticked: the canvases still in the list, minus those it moved. A skipped one is still in the list
// (unless it was already gone), so it keeps its tick and the reason
export function selectionAfterClean(sel: Set<string>, items: GalleryCanvas[], cleaned: string[]): Set<string> {
    const moved = new Set(cleaned);
    const here = new Set(items.map((c) => c.dir));
    return new Set([...sel].filter((dir) => here.has(dir) && !moved.has(dir)));
}

export function selectionTotal(items: GalleryCanvas[], sel: Set<string>): { count: number; bytes: number } {
    let count = 0;
    let bytes = 0;
    for (const c of items) {
        if (sel.has(c.dir)) {
            count++;
            bytes += c.bytes;
        }
    }
    return { count, bytes };
}

export function selectionLabel(total: { count: number; bytes: number }): string {
    return total.count === 0 ? "Nothing selected" : `${total.count} selected · ${formatSize(total.bytes)}`;
}

// the toast after Move to trash: what moved, and what a skip left behind
export function trashMessage(moved: number, skipped: number): string {
    const noun = moved === 1 ? "canvas" : "canvases";
    return `Moved ${moved} ${noun} to the trash${skipped > 0 ? `, ${skipped} skipped` : ""}`;
}

// a card's preview is taken when there is none, or the board changed after it
export function previewStale(c: Pick<GalleryCanvas, "modts" | "thumbts">): boolean {
    return c.thumbts === 0 || c.thumbts < c.modts;
}

// the time of day when the canvas changed today, else the date
function cardWhen(c: GalleryCanvas, now: number): string {
    const at = new Date(c.modts);
    if (c.modts >= startOfDay(now)) {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    }
    return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

export function cardMeta(c: GalleryCanvas, now: number): string {
    return `${c.projectname} · ${cardWhen(c, now)}`;
}

// a clean-up card's line: the project is the group's business there, the size is what the move frees
export function cleanupMeta(c: GalleryCanvas, now: number): string {
    return `${boardCountLabel(c.boards.length)} · ${cardWhen(c, now)} · ${formatSize(c.bytes)}`;
}

export function boardCountLabel(n: number): string {
    return n === 1 ? "1 board" : `${n} boards`;
}

export function stepIndex(len: number, i: number, delta: number): number {
    if (len <= 0) {
        return 0;
    }
    return (((i + delta) % len) + len) % len;
}

// the card cursor over a grid `cols` wide: clamps at the edges, and down from a column a short last row lacks lands on
// that row's last card
export function moveCursor(
    len: number,
    cols: number,
    i: number,
    key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
): number {
    if (len <= 0) {
        return 0;
    }
    const last = len - 1;
    const at = Math.min(Math.max(0, i), last);
    const width = Math.max(1, cols);
    switch (key) {
        case "ArrowLeft":
            return Math.max(0, at - 1);
        case "ArrowRight":
            return Math.min(last, at + 1);
        case "ArrowUp":
            return at - width >= 0 ? at - width : at;
        case "ArrowDown":
            if (at + width <= last) {
                return at + width;
            }
            return Math.floor(at / width) < Math.floor(last / width) ? last : at;
    }
}

// ---- versions: a newer canvas outdates the one it replaces (spec 2026-11-05-canvas-related-design.md) ----

// oldest first: by creation time, a tie by topic (the topic that sorts first is the older one), then by dir so the
// order is total and a result never depends on the order the list came in
function compareAge(a: GalleryCanvas, b: GalleryCanvas): number {
    if (a.createdts !== b.createdts) {
        return a.createdts - b.createdts;
    }
    if (a.topic !== b.topic) {
        return a.topic < b.topic ? -1 : 1;
    }
    return a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0;
}

function topicKey(project: string, topic: string): string {
    return `${project}\n${topic}`;
}

// replaces: the canvas this one validly replaces. newest: for an outdated canvas, the newest canvas of its chain (v1 and
// v2 both point at v3); null for a canvas nothing replaces
export type VersionInfo = { replaces: GalleryCanvas | null; newest: GalleryCanvas | null };

// What each canvas (by dir) replaces and is replaced by. A `replaces` counts when it names another canvas of the same
// project that exists; otherwise it is ignored (a trashed or renamed target dims nothing). Hand-edited files can still
// conflict, so: when two canvases name the same one, the one created last keeps the link and the other's is ignored; in
// a cycle, the link pointing at the canvas created last is dropped, so that canvas is never outdated.
export function versionInfo(items: GalleryCanvas[]): Map<string, VersionInfo> {
    const byTopic = new Map(items.map((c) => [topicKey(c.project, c.topic), c]));
    // target dir → the link onto it. One link per target (no forks), and each canvas names one target, so every canvas
    // has at most one link out and one in: the links form separate lines and cycles
    const into = new Map<string, { from: GalleryCanvas; to: GalleryCanvas }>();
    for (const c of items) {
        const to = c.replaces ? byTopic.get(topicKey(c.project, c.replaces)) : undefined;
        if (to == null || to.dir === c.dir) {
            continue;
        }
        const held = into.get(to.dir);
        if (held == null || compareAge(held.from, c) < 0) {
            into.set(to.dir, { from: c, to });
        }
    }
    const out = new Map<string, GalleryCanvas>(); // replacer dir → what it replaces
    for (const link of into.values()) {
        out.set(link.from.dir, link.to);
    }
    // walk each line out from where it starts; a walk that meets its own path has found a cycle
    const seen = new Map<string, "path" | "done">();
    for (const start of items) {
        if (seen.has(start.dir)) {
            continue;
        }
        const path: GalleryCanvas[] = [];
        let at: GalleryCanvas | undefined = start;
        while (at != null && !seen.has(at.dir)) {
            seen.set(at.dir, "path");
            path.push(at);
            at = out.get(at.dir);
        }
        if (at != null && seen.get(at.dir) === "path") {
            const hit = at.dir;
            const cycle = path.slice(path.findIndex((p) => p.dir === hit));
            const last = cycle.reduce((x, y) => (compareAge(x, y) >= 0 ? x : y));
            const cut = into.get(last.dir);
            into.delete(last.dir);
            if (cut != null) {
                out.delete(cut.from.dir);
            }
        }
        for (const p of path) {
            seen.set(p.dir, "done");
        }
    }
    const info = new Map<string, VersionInfo>();
    for (const c of items) {
        let newest: GalleryCanvas | null = null;
        // no cycle is left, so this ends at the canvas nothing replaces
        for (let up = into.get(c.dir); up != null; up = into.get(up.from.dir)) {
            newest = up.from;
        }
        info.set(c.dir, { replaces: out.get(c.dir) ?? null, newest });
    }
    return info;
}

export type VersionSuggestion = { newer: GalleryCanvas; older: GalleryCanvas };

// Title words that count toward a match: lowercase letters and digits, at least three of them, and not a word every
// title has. "new" and "old" are in the list because a redraw's title often says so.
const TITLE_STOPWORDS = new Set(
    "the and for with from into that this are was not but you your all can its our out how what when who why new old".split(
        " "
    )
);

// Two titles match when they share at least TITLE_MIN_SHARED words and the shared words are at least TITLE_MIN_OVERLAP
// of all the distinct words the two titles have (shared ÷ union). One shared word is never enough: canvases of one
// project often start alike ("Council UX" / "Council, stronger" share only "council") and are not versions. Half the
// union is the line: "Agent sidebar tree" / "Agent sidebar tree, redrawn" is 3 of 4, "Agent sidebar" /
// "Agent sidebar tree dock rooms floors" is 2 of 6 and stays apart.
const TITLE_MIN_SHARED = 2;
const TITLE_MIN_OVERLAP = 0.5;

function titleWords(c: GalleryCanvas): Set<string> {
    const words = (c.title ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u);
    return new Set(words.filter((w) => w.length >= 3 && !TITLE_STOPWORDS.has(w)));
}

// 0 for no match. A topic that continues the older one at a dash always beats a title match, and the longer the older
// topic the closer the match: between 1 and 2 for a prefix, TITLE_MIN_OVERLAP to 1 for titles
function matchScore(older: GalleryCanvas, newer: GalleryCanvas, wordsOf: (c: GalleryCanvas) => Set<string>): number {
    const from = older.topic.toLowerCase();
    const to = newer.topic.toLowerCase();
    if (to.startsWith(from + "-")) {
        return 1 + from.length / to.length;
    }
    const a = wordsOf(older);
    const b = wordsOf(newer);
    let shared = 0;
    for (const w of a) {
        if (b.has(w)) {
            shared++;
        }
    }
    const overlap = shared / (a.size + b.size - shared || 1);
    return shared >= TITLE_MIN_SHARED && overlap >= TITLE_MIN_OVERLAP ? overlap : 0;
}

// The pairs the scan and the cards' dashed row offer: `newer` looks like it replaces `older`. Both are in one project;
// `older` is the earlier by creation time and no canvas replaces it yet (it may replace one itself: a forgotten v3 goes
// onto the chain's head, not its tail); `newer` replaces nothing and does not name `older` in notreplaces; and they
// match by topic prefix at a dash or by title words. Each newer canvas gets its best match and each older canvas one
// replacer (no forks): the best score wins, then the newer canvas created last. Newest first.
export function suggestVersions(items: GalleryCanvas[]): VersionSuggestion[] {
    const info = versionInfo(items);
    const words = new Map<string, Set<string>>();
    const wordsOf = (c: GalleryCanvas): Set<string> => {
        let w = words.get(c.dir);
        if (w == null) {
            w = titleWords(c);
            words.set(c.dir, w);
        }
        return w;
    };
    const pairs: { newer: GalleryCanvas; older: GalleryCanvas; score: number }[] = [];
    for (const older of items) {
        if (info.get(older.dir)?.newest != null) {
            continue;
        }
        for (const newer of items) {
            if (newer.dir === older.dir || newer.project !== older.project || compareAge(older, newer) >= 0) {
                continue;
            }
            if (info.get(newer.dir)?.replaces != null || newer.notreplaces?.includes(older.topic)) {
                continue;
            }
            const score = matchScore(older, newer, wordsOf);
            if (score > 0) {
                pairs.push({ newer, older, score });
            }
        }
    }
    pairs.sort((a, b) => b.score - a.score || compareAge(b.newer, a.newer) || compareAge(b.older, a.older));
    const newerTaken = new Set<string>();
    const olderTaken = new Set<string>();
    const picked: VersionSuggestion[] = [];
    for (const { newer, older } of pairs) {
        if (newerTaken.has(newer.dir) || olderTaken.has(older.dir)) {
            continue;
        }
        newerTaken.add(newer.dir);
        olderTaken.add(older.dir);
        picked.push({ newer, older });
    }
    return picked.sort((a, b) => compareAge(b.newer, a.newer));
}

// The viewer's picker list for `c`: canvases of its project that are older than it and that no other canvas replaces,
// plus the one it replaces now (marked current, whatever its age), filtered by topic and title, newest first.
export function linkCandidates(
    items: GalleryCanvas[],
    c: GalleryCanvas,
    query: string
): { canvas: GalleryCanvas; current: boolean }[] {
    const info = versionInfo(items);
    const currentDir = info.get(c.dir)?.replaces?.dir;
    const taken = new Set<string>();
    for (const other of items) {
        const target = other.dir === c.dir ? null : info.get(other.dir)?.replaces;
        if (target != null) {
            taken.add(target.dir);
        }
    }
    const q = query.trim().toLowerCase();
    return items
        .filter((x) => x.dir !== c.dir && x.project === c.project && !taken.has(x.dir))
        .filter((x) => x.dir === currentDir || compareAge(x, c) < 0)
        .filter((x) => q === "" || [x.topic, x.title ?? ""].some((s) => s.toLowerCase().includes(q)))
        .sort((a, b) => compareAge(b, a))
        .map((x) => ({ canvas: x, current: x.dir === currentDir }));
}

// what SetCanvasLinkCommand takes: both fields whole, so the model owns the rules and the server only writes
export type CanvasLinkWrite = { dir: string; replaces: string; notreplaces: string[] };

// the list with `add` in it and `drop` out, sorted and without repeats (the server stores it the same way)
function topicList(list: string[] | undefined, add?: string, drop?: string): string[] {
    const set = new Set(list ?? []);
    if (add) {
        set.add(add);
    }
    if (drop) {
        set.delete(drop);
    }
    return [...set].sort();
}

// a link removes the topic from notreplaces: you said yes after all
export function linkWrite(c: GalleryCanvas, oldTopic: string): CanvasLinkWrite {
    return { dir: c.dir, replaces: oldTopic, notreplaces: topicList(c.notreplaces, undefined, oldTopic) };
}

// × counts as "not a version": the topic it replaced is remembered so the pair is not suggested again
export function unlinkWrite(c: GalleryCanvas): CanvasLinkWrite {
    return { dir: c.dir, replaces: "", notreplaces: topicList(c.notreplaces, c.replaces) };
}

// No on a suggestion: remembered, and a link the canvas has already stays
export function declineWrite(c: GalleryCanvas, oldTopic: string): CanvasLinkWrite {
    return { dir: c.dir, replaces: c.replaces ?? "", notreplaces: topicList(c.notreplaces, oldTopic) };
}

// the scan review's writes, in the suggestions' order: `ticked` holds the newer canvases' dirs
export function scanWrites(suggestions: VersionSuggestion[], ticked: Set<string>): CanvasLinkWrite[] {
    return suggestions.map(({ newer, older }) =>
        ticked.has(newer.dir) ? linkWrite(newer, older.topic) : declineWrite(newer, older.topic)
    );
}

export function scanLinkLabel(n: number): string {
    return n === 1 ? "Link 1 pair" : `Link ${n} pairs`;
}
