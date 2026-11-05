// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A ```mermaid block drawn as its diagram. mermaid (~3 MB) is imported the first time a diagram shows, never before.
// The diagram keeps its height from the first paint (mermaidcache.ts): a drawing made this session goes in at once, and
// the first one of a session holds the room it took last time while mermaid works, so the lines around it never move
// when it lands (a council's chat lost the reader's place to that).

import { useLayoutEffect, useRef } from "react";
import { keepDrawing, keepSize, keptDrawing, keptSize, normalizeChart, reservedHeight } from "./mermaidcache";

let mermaidInitialized = false;
let mermaidInstance: any = null;

const initializeMermaid = async () => {
    if (!mermaidInitialized) {
        const mermaid = await import("mermaid");
        mermaidInstance = mermaid.default;
        mermaidInstance.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        mermaidInitialized = true;
    }
};

export const Mermaid = ({ chart }: { chart: string }) => {
    const ref = useRef<HTMLDivElement>(null);
    const source = normalizeChart(chart);

    // before the first paint: the kept drawing, or the room the diagram took last time with its loading line in it
    useLayoutEffect(() => {
        const el = ref.current;
        if (el == null) {
            return;
        }
        el.className = "mermaid";
        const kept = keptDrawing(source);
        if (kept != null) {
            el.style.minHeight = "";
            el.innerHTML = kept;
            el.setAttribute("data-processed", "true");
            return;
        }
        const size = keptSize(source);
        const room = size == null ? null : reservedHeight(size, el.clientWidth);
        el.style.minHeight = room == null ? "" : `${room}px`;
        el.textContent = "Loading diagram...";
        let live = true;
        void (async () => {
            try {
                await initializeMermaid();
                if (!live || mermaidInstance == null) {
                    return;
                }
                el.removeAttribute("data-processed");
                el.textContent = source;
                await mermaidInstance.run({ nodes: [el] });
                if (!live) {
                    return;
                }
                const svg = el.querySelector("svg");
                if (svg != null) {
                    keepDrawing(source, el.innerHTML, svg.id);
                    const box = svg.getBoundingClientRect();
                    // mermaid caps the svg at its natural width and scales it down in a narrower box
                    const natural = parseFloat(svg.style.maxWidth) || box.width;
                    if (box.width > 0 && box.height > 0) {
                        keepSize(source, { w: natural, r: box.height / box.width });
                    }
                }
                el.style.minHeight = "";
            } catch (err) {
                if (!live) {
                    return;
                }
                console.error("Error rendering mermaid diagram:", err);
                el.style.minHeight = "";
                el.textContent = `Error: Failed to render diagram: ${err?.message || err}`;
                el.className = "mermaid error";
            }
        })();
        return () => {
            live = false;
        };
    }, [source]);

    return <div className="mermaid" ref={ref} />;
};
