// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Keeps a ```mermaid diagram from changing height after its message is drawn. mermaid draws asynchronously, so a diagram
// first shows one line and lands a moment later a few hundred px taller: in a scroller (a council's chat) everything
// under it moves, and the reader's place jumps when WebKit does not hold the view through it. Two caches stop that:
// the drawing itself, in memory, so a diagram drawn again (its message shown again after another tab) goes in at once at
// its full height; and its size, in localStorage, so the first drawing of a session holds its room while mermaid works.
// The pure parts are tested in mermaidcache.test.ts; the reads and writes of the stores are wrapped, as storage can be
// missing or throw.

/** A drawn diagram's size: its natural width (mermaid's max-width on the svg) and its height over its width. */
export interface DiagramSize {
    w: number;
    r: number;
}

/** Pure: the chart text as mermaid reads it: `<br>` as a newline, CRLF as LF, no newline at its end. */
export function normalizeChart(chart: string): string {
    return chart
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\r\n?/g, "\n")
        .replace(/\n+$/, "");
}

/** Pure: a short key for a chart (its FNV-1a hash and its length), the key its size is stored under. */
export function chartKey(chart: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < chart.length; i++) {
        h ^= chart.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return `${(h >>> 0).toString(16).padStart(8, "0")}:${chart.length}`;
}

/** Pure: the height a diagram of `size` takes in a box `boxWidth` wide (an svg as wide as it can be, up to its natural
 *  width, at its ratio); null with no width to read yet, or a size that cannot be right. */
export function reservedHeight(size: DiagramSize, boxWidth: number): number | null {
    if (!(boxWidth > 0) || !(size.w > 0) || !(size.r > 0)) {
        return null;
    }
    return Math.round(Math.min(size.w, boxWidth) * size.r);
}

/** Pure: a kept drawing with its id `from` renamed `to` everywhere it is used (the svg, its scoped styles, its
 *  arrowheads), so two copies on the page never share an id. */
export function freshIds(html: string, from: string, to: string): string {
    return from === "" ? html : html.split(from).join(to);
}

/** Pure: `sizes` with `key` set to `size` as the newest entry, the oldest dropped past `cap`. */
export function withSize(
    sizes: Record<string, DiagramSize>,
    key: string,
    size: DiagramSize,
    cap: number
): Record<string, DiagramSize> {
    const out: Record<string, DiagramSize> = { ...sizes };
    delete out[key];
    out[key] = size;
    const keys = Object.keys(out);
    for (const k of keys.slice(0, Math.max(0, keys.length - cap))) {
        delete out[k];
    }
    return out;
}

/** Pure: the sizes stored as `text`, each entry two numbers; anything else reads as none. */
export function keptSizes(text: string | null): Record<string, DiagramSize> {
    if (text == null) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {};
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    const out: Record<string, DiagramSize> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const s = v as Partial<DiagramSize> | null;
        if (s != null && typeof s === "object" && typeof s.w === "number" && typeof s.r === "number") {
            out[k] = { w: s.w, r: s.r };
        }
    }
    return out;
}

// ---- the stores ----

const DRAWINGS_CAP = 60;
const SIZES_CAP = 200;
const SIZES_KEY = "mermaid.sizes";

// the drawings of this session, by chart text: the svg's markup and the id it was drawn with
const drawings = new Map<string, { html: string; id: string }>();
let copies = 0;

/** The drawing kept for `chart`, its ids made fresh for this copy; null when it was not drawn this session. */
export function keptDrawing(chart: string): string | null {
    const kept = drawings.get(chart);
    if (kept == null) {
        return null;
    }
    copies++;
    return freshIds(kept.html, kept.id, `${kept.id}-c${copies}`);
}

/** Keeps the drawing mermaid made for `chart`, the newest last, the oldest dropped past the cap. */
export function keepDrawing(chart: string, html: string, id: string): void {
    drawings.delete(chart);
    drawings.set(chart, { html, id });
    for (const k of drawings.keys()) {
        if (drawings.size <= DRAWINGS_CAP) {
            break;
        }
        drawings.delete(k);
    }
}

function readSizes(): Record<string, DiagramSize> {
    try {
        return keptSizes(localStorage.getItem(SIZES_KEY));
    } catch {
        return {};
    }
}

/** The size `chart` was drawn at before, in this session or an earlier one; null for one never drawn. */
export function keptSize(chart: string): DiagramSize | null {
    return readSizes()[chartKey(chart)] ?? null;
}

/** Keeps the size `chart` was drawn at, for the first drawing of the next session. */
export function keepSize(chart: string, size: DiagramSize): void {
    try {
        localStorage.setItem(SIZES_KEY, JSON.stringify(withSize(readSizes(), chartKey(chart), size, SIZES_CAP)));
    } catch {
        // no storage: the next session's first drawing lands without its room held
    }
}
