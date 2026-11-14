// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A triple-click selects a paragraph or list item together with the line break after it, so its copy ended in a stray
// newline. Pulling the selection's end back to its last character keeps the copy to the text picked. (How the pick is
// painted is selectionpaint.ts's job: it draws only the selected text, never the break.)

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

// onMouseUp of a block of rendered Markdown: after a triple-click, the selection ends at its last character instead of
// after the break that follows it. The end is set rather than stepped back with Selection.modify: WebKit holds a
// triple-click's selection without a direction, and extending one backward moves its start.
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
    sel.setBaseAndExtent(range.startContainer, range.startOffset, end.node, end.offset);
}
