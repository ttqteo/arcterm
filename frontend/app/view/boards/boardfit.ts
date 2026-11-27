// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A box grows to the label it holds. Excalidraw re-wraps a measured label inside its box's width but never grows the
// box, so a label that wraps to more lines than the drawer planned for ran out of it (three 25px lines in a 70px box,
// seen on a real board 2026-11-27). Pure: runs on the measured elements, before a drawing's frame is fitted to them.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

// Excalidraw's padding between a box and its label (BOUND_TEXT_PADDING)
export const BOUND_TEXT_PADDING = 5;

// the box height a label of textHeight needs, as Excalidraw computes it (computeContainerDimensionForBoundText): an
// ellipse's and a diamond's text area is a smaller part of the shape
export function neededHeight(type: string, textHeight: number): number {
    const padded = textHeight + 2 * BOUND_TEXT_PADDING;
    switch (type) {
        case "ellipse":
            return Math.round((padded / Math.sqrt(2)) * 2);
        case "diamond":
            return padded * 2;
        default:
            return padded;
    }
}

// The elements with every named label's box grown in height to hold it (growing down, its top kept) and the label
// centered in it again; a box that holds its label, an arrow's label and a label with no box are left as they are. A
// grown box gets a new version so a canvas that reconciles by version takes it.
export function fitContainers(elements: readonly ExcalidrawElement[], textIds: readonly string[]): ExcalidrawElement[] {
    const wanted = new Set(textIds);
    const index = new Map(elements.map((el, i) => [el.id, i]));
    const out = [...elements];
    for (const text of elements) {
        if (!wanted.has(text.id) || text.type !== "text" || text.isDeleted || text.containerId == null) {
            continue;
        }
        const at = index.get(text.containerId);
        const box = at == null ? undefined : out[at];
        if (box == null || box.isDeleted || "points" in box) {
            continue;
        }
        const need = neededHeight(box.type, text.height);
        if (box.height >= need) {
            continue;
        }
        const grown = {
            ...box,
            height: need,
            version: box.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
        } as ExcalidrawElement;
        out[at!] = grown;
        const t = index.get(text.id)!;
        out[t] = {
            ...out[t],
            x: grown.x + (grown.width - text.width) / 2,
            y: grown.y + (grown.height - text.height) / 2,
        } as ExcalidrawElement;
    }
    return out;
}
