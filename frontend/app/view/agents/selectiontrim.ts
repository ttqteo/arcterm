// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A triple-click selects a paragraph or list item together with the line break after it. WebKit (the Mac app's
// WKWebView) paints that break as a band running on to the scroller's right edge, so a picked short line in Chat showed
// a bar across the whole column; Chromium paints only the text. Pulling the selection's end back to its last character
// keeps a one-line pick inside its own line in both engines, and the copy no longer ends in a stray newline. CSS cannot
// do it: a block made its own selection root and shrunk to its text stops that band, but WebKit then paints the margin
// between it and the next block as a thin bar across the column.

// where the trailing whitespace of `text` begins: its length when it ends on a character, 0 when it is all whitespace
export function inkEnd(text: string): number {
    return text.search(/\s*$/);
}

// whether a selection's text ends in whitespace (the break a triple-click takes in) and holds something besides it
export function endsInBreak(text: string): boolean {
    const ink = inkEnd(text);
    return ink > 0 && ink < text.length;
}

// the point just after the range's last non-whitespace character, or null when it holds none
function lastInk(range: Range): { node: Text; offset: number } | null {
    const top = range.commonAncestorContainer;
    const texts: Text[] = [];
    if (top.nodeType === Node.TEXT_NODE) {
        texts.push(top as Text);
    } else {
        const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n != null; n = walker.nextNode()) {
            if (range.intersectsNode(n)) {
                texts.push(n as Text);
            }
        }
    }
    for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        const from = t === range.startContainer ? range.startOffset : 0;
        const to = t === range.endContainer ? range.endOffset : t.length;
        const ink = inkEnd(t.data.slice(from, to));
        if (ink > 0) {
            return { node: t, offset: from + ink };
        }
    }
    return null;
}

// how many lines a range's boxes (Range.getClientRects) sit on: boxes on one line overlap from top to bottom, a bold
// run's and a code span's too, and a box that starts below where the line so far ends starts the next one; an empty
// box counts for none
export function lineCount(rects: { top: number; bottom: number }[]): number {
    const boxes = rects.filter((r) => r.bottom > r.top).sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = -Infinity;
    for (const r of boxes) {
        if (r.top >= bottom) {
            lines++;
            bottom = r.bottom;
        } else {
            bottom = Math.max(bottom, r.bottom);
        }
    }
    return lines;
}

// After a triple-click on one line, the selection ends at its last character instead of after the break that follows
// it. A block on several lines keeps WebKit's own pick: trimmed, WebKit paints each line's text alone and leaves a
// strip between the lines, while whole it is one solid box, its last line reaching the column's edge. The end is set
// rather than stepped back with Selection.modify: WebKit holds a triple-click's selection without a direction, and
// extending one backward moves its start.
export function trimTripleClick(e: { detail: number }): void {
    if (e.detail !== 3) {
        return;
    }
    const sel = window.getSelection();
    if (sel == null || sel.rangeCount === 0 || sel.isCollapsed || !endsInBreak(sel.toString())) {
        return;
    }
    const range = sel.getRangeAt(0);
    const end = lastInk(range);
    if (end == null) {
        return;
    }
    const picked = document.createRange();
    picked.setStart(range.startContainer, range.startOffset);
    picked.setEnd(end.node, end.offset);
    if (lineCount(Array.from(picked.getClientRects())) > 1) {
        return;
    }
    sel.setBaseAndExtent(range.startContainer, range.startOffset, end.node, end.offset);
}

// set on <html> while a triple-click's button is down; tailwindsetup.css paints no selection under it
const PICKING = "data-picking-paragraph";

// onMouseDown of a block of rendered Markdown. WebKit picks the paragraph and its break on the third press and paints
// it at once, band and all, so trimming it only on the release showed the whole box first and then shrank it. While the
// button is down nothing is painted; the release trims the pick and shows it. Leaving the window ends the hold too,
// so a release the page never sees cannot leave every selection unpainted.
export function holdTripleClick(e: { detail: number }): void {
    const root = document.documentElement;
    if (e.detail !== 3 || root.hasAttribute(PICKING)) {
        return;
    }
    root.setAttribute(PICKING, "");
    const release = (up: { detail: number } | null) => {
        window.removeEventListener("mouseup", onUp, true);
        window.removeEventListener("blur", onBlur);
        if (up != null) {
            trimTripleClick(up);
        }
        root.removeAttribute(PICKING);
    };
    const onUp = (up: MouseEvent) => release(up);
    const onBlur = () => release(null);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("blur", onBlur);
}
