// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Rendered Markdown paints its own text selection. WebKit (the Mac app's WKWebView) fills the space a selection passes
// over: a band from each line's end to the column's right edge, the margins between blocks, a box around each list
// number and bullet, and, for a block picked on its own, a strip of background between its lines. Chromium paints only
// the lines' text. So while the selection takes in any rendered Markdown, the native paint is switched off
// (html[data-md-selection], tailwindsetup.css) and each MarkdownMessage draws one band per line of selected text into a
// layer over its text, a line's full height so wrapped lines meet, in both engines alike.

export interface LineRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
    // the line-height of the text's element: the band takes the line's full height, centred on the glyph box
    lineHeight: number;
}

export interface Band {
    left: number;
    top: number;
    width: number;
    height: number;
}

// One band per run of selected text on a line: each glyph box grows to its line's height around its centre, and boxes
// on the same line that touch or nearly touch (a word, the bold run after it, a code span in its padding) join into one.
export function lineBands(rects: LineRect[]): Band[] {
    const boxes = rects
        .filter((r) => r.right - r.left > 0.5 && r.bottom > r.top)
        .map((r) => {
            const mid = (r.top + r.bottom) / 2;
            const h = Math.max(r.lineHeight, r.bottom - r.top);
            return { left: r.left, right: r.right, top: mid - h / 2, bottom: mid + h / 2, mid };
        })
        .sort((a, b) => a.mid - b.mid);
    // the lines: a box whose centre sits within half a line of the line's first box is on it
    const lines: (typeof boxes)[] = [];
    for (const b of boxes) {
        const line = lines[lines.length - 1];
        if (line != null && Math.abs(line[0].mid - b.mid) < (line[0].bottom - line[0].top) / 2) {
            line.push(b);
        } else {
            lines.push([b]);
        }
    }
    const out: Band[] = [];
    for (const line of lines) {
        line.sort((a, b) => a.left - b.left);
        let cur = { ...line[0] };
        const flush = () =>
            out.push({ left: cur.left, top: cur.top, width: cur.right - cur.left, height: cur.bottom - cur.top });
        for (const b of line.slice(1)) {
            // a code span's padding or a pill's margin leaves a few pixels of no text between two runs
            if (b.left <= cur.right + (cur.bottom - cur.top) * 0.4) {
                cur.right = Math.max(cur.right, b.right);
                cur.top = Math.min(cur.top, b.top);
                cur.bottom = Math.max(cur.bottom, b.bottom);
            } else {
                flush();
                cur = { ...b };
            }
        }
        flush();
    }
    return out;
}

// set on <html> while the selection takes in rendered Markdown; tailwindsetup.css hides the native paint under it
const MD_SELECTION = "data-md-selection";

interface Painted {
    root: HTMLElement;
    layer: HTMLElement;
}

const painted = new Set<Painted>();
let frame = 0;
let listening = false;

function lineHeightOf(el: Element, cache: Map<Element, number>): number {
    let lh = cache.get(el);
    if (lh == null) {
        const style = getComputedStyle(el);
        lh = parseFloat(style.lineHeight);
        if (!Number.isFinite(lh)) {
            lh = parseFloat(style.fontSize) * 1.2;
        }
        cache.set(el, lh);
    }
    return lh;
}

// the box a scrolled region (a wide table, a code block) shows of its content, or null when nothing between the
// element and the message's root scrolls
function clipOf(el: Element, root: HTMLElement, cache: Map<Element, DOMRect | null>): DOMRect | null {
    if (cache.has(el)) {
        return cache.get(el);
    }
    let clip: DOMRect | null = null;
    for (let cur: Element | null = el; cur != null && cur !== root; cur = cur.parentElement) {
        const style = getComputedStyle(cur);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            clip = cur.getBoundingClientRect();
            break;
        }
    }
    cache.set(el, clip);
    return clip;
}

// the selected text's line boxes inside one message, in its own coordinates
function rectsIn(p: Painted, range: Range): LineRect[] {
    const origin = p.root.getBoundingClientRect();
    const heights = new Map<Element, number>();
    const clips = new Map<Element, DOMRect | null>();
    const out: LineRect[] = [];
    const walker = document.createTreeWalker(p.root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n != null; n = walker.nextNode() as Text | null) {
        const parent = n.parentElement;
        if (parent == null || n.data.trim() === "" || !range.intersectsNode(n)) {
            continue;
        }
        const sub = document.createRange();
        sub.selectNodeContents(n);
        if (n === range.startContainer) {
            sub.setStart(n, range.startOffset);
        }
        if (n === range.endContainer) {
            sub.setEnd(n, range.endOffset);
        }
        if (sub.collapsed) {
            continue;
        }
        const lineHeight = lineHeightOf(parent, heights);
        const clip = clipOf(parent, p.root, clips);
        for (const r of Array.from(sub.getClientRects())) {
            const left = clip ? Math.max(r.left, clip.left) : r.left;
            const right = clip ? Math.min(r.right, clip.right) : r.right;
            const top = clip ? Math.max(r.top, clip.top) : r.top;
            const bottom = clip ? Math.min(r.bottom, clip.bottom) : r.bottom;
            if (right <= left || bottom <= top) {
                continue;
            }
            out.push({
                left: left - origin.left,
                right: right - origin.left,
                top: top - origin.top,
                bottom: bottom - origin.top,
                lineHeight,
            });
        }
    }
    return out;
}

function draw(layer: HTMLElement, bands: Band[]) {
    if (bands.length === 0 && layer.childElementCount === 0) {
        return;
    }
    layer.replaceChildren(
        ...bands.map((b) => {
            const el = document.createElement("div");
            el.className = "md-selection-band";
            el.style.left = `${b.left}px`;
            el.style.top = `${b.top}px`;
            el.style.width = `${b.width}px`;
            el.style.height = `${b.height}px`;
            return el;
        })
    );
}

function paint() {
    frame = 0;
    const sel = window.getSelection();
    const range = sel != null && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    let any = false;
    for (const p of painted) {
        const bands = range != null && range.intersectsNode(p.root) ? lineBands(rectsIn(p, range)) : [];
        any ||= bands.length > 0;
        draw(p.layer, bands);
    }
    document.documentElement.toggleAttribute(MD_SELECTION, any);
}

// repaint on the next frame: the selection moved, or a message holding it changed size (a reply still streaming, a
// fold opened, the window resized)
export function schedulePaint() {
    if (frame === 0) {
        frame = requestAnimationFrame(paint);
    }
}

// A MarkdownMessage's root and its band layer: painted while mounted.
export function paintSelectionIn(root: HTMLElement, layer: HTMLElement): () => void {
    const p: Painted = { root, layer };
    painted.add(p);
    if (!listening) {
        listening = true;
        document.addEventListener("selectionchange", schedulePaint);
    }
    const resize = new ResizeObserver(() => {
        if (layer.childElementCount > 0) {
            schedulePaint();
        }
    });
    resize.observe(root);
    if (window.getSelection()?.isCollapsed === false) {
        schedulePaint();
    }
    return () => {
        resize.disconnect();
        painted.delete(p);
        layer.replaceChildren();
        if (painted.size === 0) {
            document.removeEventListener("selectionchange", schedulePaint);
            listening = false;
            document.documentElement.removeAttribute(MD_SELECTION);
        }
    };
}
