// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A ```mermaid block drawn as its diagram. mermaid (~3 MB) is imported the first time a diagram shows, never before.
// The diagram keeps its height from the first paint (mermaidcache.ts): a drawing made this session goes in at once, and
// the first one of a session holds the room it took last time while mermaid works, so the lines around it never move
// when it lands (a council's chat lost the reader's place to that). A drawn diagram opens full size, to zoom and pan,
// and copies as a picture (mermaidviewer.tsx).

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { keepDrawing, keepSize, keptDrawing, keptSize, normalizeChart, reservedHeight } from "./mermaidcache";
import { DiagramToolbar, MermaidViewer } from "./mermaidviewer";

let mermaidInitialized = false;
let mermaidInstance: any = null;

const initializeMermaid = async () => {
    if (!mermaidInitialized) {
        const mermaid = await import("mermaid");
        mermaidInstance = mermaid.default;
        // a label is clipped to the width mermaid measured once; WebKit draws text a few px wider at another scale (the
        // chat's shrink, the viewer's zoom), which cut a label's last letter. The node's shape keeps its padding, so the
        // label may run into it. themeCSS travels in the svg's own <style>: the viewer and Copy image keep it.
        mermaidInstance.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
            themeCSS: "foreignObject { overflow: visible; }",
        });
        mermaidInitialized = true;
    }
};

export const Mermaid = ({ chart }: { chart: string }) => {
    const ref = useRef<HTMLDivElement>(null);
    const source = normalizeChart(chart);
    // the toolbar and the full-size viewer exist only once a diagram is drawn: a loading line or an error has neither
    const [drawn, setDrawn] = useState(false);
    const [viewing, setViewing] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const getSvg = useCallback(() => ref.current?.querySelector("svg") ?? null, []);
    const expand = useCallback(() => {
        const svg = getSvg();
        if (svg == null) {
            return;
        }
        setViewing(svg.outerHTML);
        setOpen(true);
    }, [getSvg]);
    const close = useCallback(() => setOpen(false), []);

    // before the first paint: the kept drawing, or the room the diagram took last time with its loading line in it
    useLayoutEffect(() => {
        const el = ref.current;
        if (el == null) {
            return;
        }
        el.className = "mermaid";
        setDrawn(false);
        const kept = keptDrawing(source);
        if (kept != null) {
            el.style.minHeight = "";
            el.innerHTML = kept;
            el.setAttribute("data-processed", "true");
            setDrawn(true);
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
                    setDrawn(true);
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

    // a click on the diagram opens it full size too; the click that ends a text selection does not
    return (
        <div className="group/diagram relative">
            <div
                className="mermaid"
                ref={ref}
                data-mermaid-drawn={drawn ? "" : undefined}
                onClick={drawn ? () => window.getSelection()?.isCollapsed !== false && expand() : undefined}
                style={drawn ? { cursor: "zoom-in" } : undefined}
            />
            {drawn ? <DiagramToolbar onExpand={expand} getSvg={getSvg} /> : null}
            {viewing != null ? <MermaidViewer html={viewing} open={open} onClose={close} /> : null}
        </div>
    );
};
