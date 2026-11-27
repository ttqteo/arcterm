// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Links between a board's shapes and drawings. A shape's link is Excalidraw's element link, "?element=<id>"; the drawer
// writes the bare id, or "@new" for the drawing its answer adds, and resolveLinks turns those into links once the answer
// has landed. A press on a linked shape (in view mode) or on its link icon goes to the drawing the target is in, and the
// drawing left goes on the board's Back stack. Pure: no React, no Excalidraw runtime.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

// the drawer's link to the drawing its answer adds (pkg/boarddrawer NewDrawingLink)
export const NEW_DRAWING_LINK = "@new";

// how many drawings Back remembers per board
export const MAX_BACK = 20;

export function linkTo(id: string): string {
    return `?element=${encodeURIComponent(id)}`;
}

// the id a link goes to on the board, null for no link or a link elsewhere (a web page)
export function linkTarget(link: string | null | undefined): string | null {
    if (!link) {
        return null;
    }
    const q = link.indexOf("?");
    if (q < 0) {
        return null;
    }
    const id = new URLSearchParams(link.slice(q + 1)).get("element");
    return id ? id : null;
}

// The named elements with the drawer's raw links made links: "@new" to the drawing the answer added (none when it added
// no drawing: the link is dropped), a bare id to that id. A link already a link, or a web address, stays.
export function resolveLinks(
    elements: readonly ExcalidrawElement[],
    ids: ReadonlySet<string>,
    newDrawingId: string | null
): ExcalidrawElement[] {
    return elements.map((el) => {
        const raw = el.link?.trim();
        if (!ids.has(el.id) || !raw || raw.includes("?") || raw.includes("://")) {
            return el;
        }
        const target = raw === NEW_DRAWING_LINK ? newDrawingId : raw;
        return { ...el, link: target ? linkTo(target) : null } as ExcalidrawElement;
    });
}

// the drawing a link's target is: a frame is its own drawing, a shape the drawing it is in; null when the target is
// gone or loose (in no drawing)
export function linkDrawing(elements: readonly ExcalidrawElement[], target: string): string | null {
    const el = elements.find((e) => e.id === target && !e.isDeleted);
    if (el == null) {
        return null;
    }
    if (el.type === "frame") {
        return el.id;
    }
    const frame = el.frameId ? elements.find((e) => e.id === el.frameId && !e.isDeleted) : undefined;
    return frame != null ? frame.id : null;
}

// the link target of the topmost linked shape at scene point (x, y): a label counts as its box. Rotation is ignored, as
// the drawer draws nothing rotated.
export function linkAt(elements: readonly ExcalidrawElement[], x: number, y: number): string | null {
    const byId = new Map(elements.map((el) => [el.id, el]));
    for (let i = elements.length - 1; i >= 0; i--) {
        let el = elements[i];
        if (el.isDeleted || el.type === "frame") {
            continue;
        }
        if (x < el.x || x > el.x + el.width || y < el.y || y > el.y + el.height) {
            continue;
        }
        if (el.type === "text" && el.containerId) {
            el = byId.get(el.containerId) ?? el;
        }
        const target = linkTarget(el.link);
        if (target != null) {
            return target;
        }
    }
    return null;
}

// a viewport point (relative to the page) as a scene point, as Excalidraw maps it
export function sceneAt(
    clientX: number,
    clientY: number,
    st: { offsetLeft: number; offsetTop: number; scrollX: number; scrollY: number; zoom: { value: number } }
): { x: number; y: number } {
    return {
        x: (clientX - st.offsetLeft) / st.zoom.value - st.scrollX,
        y: (clientY - st.offsetTop) / st.zoom.value - st.scrollY,
    };
}

// The Back stack after following a link from the drawing `from`: it goes on top (once in a row), the oldest dropped past
// MAX_BACK. Following from no drawing, or within the drawing in view, leaves it as it was.
export function pushBack(stack: readonly string[], from: string | null, to: string): string[] {
    if (from == null || from === to || stack[stack.length - 1] === from) {
        return [...stack];
    }
    return [...stack, from].slice(-MAX_BACK);
}

// Back: the drawing to return to, the newest still on the board, and the stack without it and without gone ones
export function popBack(stack: readonly string[], live: ReadonlySet<string>): { to: string | null; stack: string[] } {
    const rest = [...stack];
    while (rest.length > 0) {
        const to = rest.pop()!;
        if (live.has(to)) {
            return { to, stack: rest };
        }
    }
    return { to: null, stack: [] };
}
