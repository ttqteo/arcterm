// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The one place a skeleton becomes Excalidraw elements and changed text is measured. Its own module so the
// applier's tests and the app's boot do not load the Excalidraw runtime: the applier and the canvas import it
// dynamically, the first time an answer arrives or a board shows.

import { convertToExcalidrawElements, exportToSvg, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { applyAnswer, type AnswerResult, type BoardScene } from "./boardmodel";

// new ids on every conversion, so a redraw never collides with the group it replaces
export function convertSkeleton(skeleton: string): ExcalidrawElement[] {
    const parsed: unknown = JSON.parse(skeleton);
    if (!Array.isArray(parsed)) {
        throw new Error("the skeleton is not a list of elements");
    }
    return convertToExcalidrawElements(parsed as ExcalidrawElementSkeleton[], { regenerateIds: true });
}

// a box's label sits in its middle, as Excalidraw lays it out; an arrow's stays where it was measured
function centered(text: ExcalidrawElement, container: ExcalidrawElement | undefined): Partial<ExcalidrawElement> {
    if (container == null || "points" in container) {
        return {};
    }
    return {
        x: container.x + (container.width - text.width) / 2,
        y: container.y + (container.height - text.height) / 2,
    };
}

// re-wraps and re-measures the answer's changed text against its container, through Excalidraw's own restore;
// only the text's words and box are taken from it, so versions and everything else stay as applyAnswer set them.
function measure(elements: readonly ExcalidrawElement[], textIds: readonly string[]): ExcalidrawElement[] {
    if (textIds.length === 0) {
        return [...elements];
    }
    const restored = new Map(
        restoreElements(elements, null, { refreshDimensions: true, repairBindings: true }).map((el) => [el.id, el])
    );
    const byId = new Map(elements.map((el) => [el.id, el]));
    const wanted = new Set(textIds);
    return elements.map((el) => {
        const r = restored.get(el.id);
        if (!wanted.has(el.id) || r == null || r.type !== "text") {
            return el;
        }
        const sized = { ...el, text: r.text, x: r.x, y: r.y, width: r.width, height: r.height } as ExcalidrawElement;
        return { ...sized, ...centered(sized, byId.get(r.containerId ?? "")) } as ExcalidrawElement;
    });
}

// A board's drawing as an SVG data URL, for the thumbnail in Library → Boards' list: light strokes on nothing (the row is
// dark), a small margin, and no font data inlined (a few dozen pixels never show the face, and an inlined font would make
// every thumbnail megabytes). An <img> shows it, so nothing in the board's text can run.
export async function sceneThumbnail(scene: BoardScene): Promise<string> {
    const svg = await exportToSvg({
        elements: scene.elements.filter((el) => !el.isDeleted),
        appState: {
            exportBackground: false,
            exportWithDarkMode: true,
            viewBackgroundColor: "transparent",
        } as Partial<AppState>,
        files: scene.files as BinaryFiles,
        exportPadding: 8,
        skipInliningFonts: true,
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
}

// the answer on the scene, converted and measured: a malformed answer throws, and the applier fails its turn
export function landAnswer(scene: BoardScene, answer: BoardAnswer, now: number): AnswerResult {
    const added = answer.add ? convertSkeleton(answer.add) : [];
    const result = applyAnswer(scene, answer, added, now);
    return { ...result, scene: { ...result.scene, elements: measure(result.scene.elements, result.textIds) } };
}
