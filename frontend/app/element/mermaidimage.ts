// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy image: a drawn diagram put on the clipboard as a PNG. It is drawn from the SVG itself, not a screenshot, so the
// whole diagram is copied at twice its size however it is zoomed or scrolled. mermaid's dark theme draws light ink on
// nothing, which pastes unreadable on a white page, so the picture sits on the app's background colour.

import { copyPixelScale, type Size } from "./mermaidzoom";

// the size the diagram is drawn at, from its viewBox (mermaid sets width 100% and a max-width instead of a size)
export function svgNaturalSize(svg: SVGSVGElement): Size {
    const vb = svg.viewBox?.baseVal;
    if (vb != null && vb.width > 0 && vb.height > 0) {
        return { w: vb.width, h: vb.height };
    }
    const box = svg.getBoundingClientRect();
    return { w: box.width, h: box.height };
}

function background(): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim();
    return v !== "" ? v : "#111";
}

export async function svgToPng(svg: SVGSVGElement): Promise<Blob> {
    const size = svgNaturalSize(svg);
    if (size.w <= 0 || size.h <= 0) {
        throw new Error("the diagram has no size");
    }
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(size.w));
    clone.setAttribute("height", String(size.h));
    clone.style.removeProperty("max-width");
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.decoding = "async";
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    await img.decode();
    const k = copyPixelScale(size);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(size.w * k);
    canvas.height = Math.round(size.h * k);
    const ctx = canvas.getContext("2d");
    if (ctx == null) {
        throw new Error("no canvas");
    }
    ctx.fillStyle = background();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b != null ? resolve(b) : reject(new Error("the picture came out empty"))), "image/png")
    );
}

export async function copyDiagramImage(svg: SVGSVGElement): Promise<void> {
    if (typeof ClipboardItem === "undefined" || navigator.clipboard?.write == null) {
        throw new Error("this webview can't copy images");
    }
    // the item takes the promise, so the write starts inside the click's user activation
    await navigator.clipboard.write([new ClipboardItem({ "image/png": svgToPng(svg) })]);
}
