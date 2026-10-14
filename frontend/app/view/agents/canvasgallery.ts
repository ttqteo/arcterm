// Pure model for Agent → Canvases (spec 2026-10-14-canvas-gallery-design.md): grouping, search, the clean-up
// suggestion, the selection's totals, and when a preview is stale. No React, no Wave runtime imports.

// the fields match the StorageCanvas rows ListCanvasesCommand returns; own type so the model needs no generated types
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

export function initialSelection(items: GalleryCanvas[], now: number): Set<string> {
    return new Set(items.filter((c) => isSuggested(c, now)).map((c) => c.dir));
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

// a card's preview is taken when there is none, or the board changed after it
export function previewStale(c: Pick<GalleryCanvas, "modts" | "thumbts">): boolean {
    return c.thumbts === 0 || c.thumbts < c.modts;
}

export function cardMeta(c: GalleryCanvas, now: number): string {
    const at = new Date(c.modts);
    if (c.modts >= startOfDay(now)) {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${c.projectname} · ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    }
    return `${c.projectname} · ${at.getDate()} ${MONTHS[at.getMonth()]}`;
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
