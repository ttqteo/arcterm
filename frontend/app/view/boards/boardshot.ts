// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy view: the board as the canvas shows it now, at its zoom and scroll, as a PNG. It is read off Excalidraw's static
// canvas (the shapes, without the selection or a shape being drawn), at the screen's pixel ratio. The canvas is
// transparent and the dark theme inverts it with a CSS filter, so the picture gets the board's ground behind it and the
// same filter over it: it pastes as the board looked.

function background(root: HTMLElement): string {
    const board = root.querySelector<HTMLElement>(".excalidraw") ?? root;
    const bg = getComputedStyle(board).backgroundColor;
    if (bg !== "" && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
        return bg;
    }
    const app = getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim();
    return app !== "" ? app : "#121212";
}

export async function boardViewPng(root: HTMLElement): Promise<Blob> {
    const shapes = root.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.static");
    if (shapes == null || shapes.width === 0 || shapes.height === 0) {
        throw new Error("the board isn't drawn yet");
    }
    const out = document.createElement("canvas");
    out.width = shapes.width;
    out.height = shapes.height;
    const ctx = out.getContext("2d");
    if (ctx == null) {
        throw new Error("no canvas");
    }
    ctx.fillStyle = background(root);
    ctx.fillRect(0, 0, out.width, out.height);
    const filter = getComputedStyle(shapes).filter;
    // a webview without canvas filters copies the light board on the dark ground: readable, if not as shown
    if (filter !== "" && filter !== "none" && "filter" in ctx) {
        ctx.filter = filter;
    }
    ctx.drawImage(shapes, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
        out.toBlob((b) => (b != null ? resolve(b) : reject(new Error("the picture came out empty"))), "image/png")
    );
}

// The item takes the promise, so the write starts inside the press's user activation (WebKit refuses one after it).
export function copyBoardView(root: HTMLElement): Promise<void> {
    if (typeof ClipboardItem === "undefined" || navigator.clipboard?.write == null) {
        return Promise.reject(new Error("this webview can't copy images"));
    }
    return navigator.clipboard.write([new ClipboardItem({ "image/png": boardViewPng(root) })]);
}
