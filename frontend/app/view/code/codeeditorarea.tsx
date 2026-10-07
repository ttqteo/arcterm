// frontend/app/view/code/codeeditorarea.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Code surface's editor area: the main column, and beside it the read-only side column when one is open
// (codeside.ts), with a resize handle between them. It is also the drop target for a file dragged from the tree:
// the left half opens it in the main column, the right half to the side. The main column is always the first child
// with the same key, so opening or closing the side column never remounts its editor.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { cn, fireAndForget } from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import { useAtomValue } from "jotai";
import { useRef, useState, type DragEvent, type PointerEvent } from "react";
import { CodePathBar } from "./codepathbar";
import {
    clampSideRatio,
    CODE_PATH_MIME,
    codeSideAtom,
    codeTreeDragAtom,
    openSide,
    readSideRatio,
    sideFits,
    writeSideRatio,
} from "./codeside";
import { CodeSidePane } from "./codesidepane";
import { CodeStaleBar } from "./codestalebar";
import { codeProjectAtom, openPath } from "./codestore";
import { CodeViewer } from "./codeviewer";

type Half = "main" | "side";

function isCodePathDrag(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes(CODE_PATH_MIME);
}

export function CodeEditorArea({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(codeProjectAtom);
    const side = useAtomValue(codeSideAtom);
    const treeDrag = useAtomValue(codeTreeDragAtom);
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useResizeObserver(hostRef, (e) => setWidth(e.contentRect.width));
    const [ratio, setRatio] = useState(readSideRatio);
    const [hover, setHover] = useState<Half | null>(null);
    const gripRef = useRef<{ pointerId: number; startX: number; startRatio: number } | null>(null);

    const fits = sideFits(width);
    const showSide = side != null && project != null && fits;
    const mainShare = clampSideRatio(ratio, width);

    const halfAt = (clientX: number): Half => {
        const rect = hostRef.current?.getBoundingClientRect();
        return rect != null && clientX - rect.left > rect.width / 2 ? "side" : "main";
    };
    const endDrag = () => {
        setHover(null);
        globalStore.set(codeTreeDragAtom, false);
    };
    const onDragOver = (e: DragEvent<HTMLDivElement>) => {
        if (!isCodePathDrag(e)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setHover(halfAt(e.clientX));
    };
    const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
        if (!hostRef.current?.contains(e.relatedTarget as Node | null)) {
            setHover(null);
        }
    };
    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        if (!isCodePathDrag(e)) {
            return;
        }
        e.preventDefault();
        const rel = e.dataTransfer.getData(CODE_PATH_MIME);
        const half = halfAt(e.clientX);
        endDrag();
        if (rel === "") {
            return;
        }
        if (half === "side") {
            openSide(rel);
        } else {
            fireAndForget(() => openPath(rel));
        }
    };

    const onGripDown = (e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        gripRef.current = { pointerId: e.pointerId, startX: e.clientX, startRatio: mainShare };
    };
    const onGripMove = (e: PointerEvent<HTMLDivElement>) => {
        const g = gripRef.current;
        if (g == null || g.pointerId !== e.pointerId || width <= 0) {
            return;
        }
        setRatio(clampSideRatio(g.startRatio + (e.clientX - g.startX) / width, width));
    };
    const onGripUp = () => {
        if (gripRef.current != null) {
            gripRef.current = null;
            writeSideRatio(mainShare);
        }
    };

    const overlay = treeDrag || hover != null;
    return (
        <div
            ref={hostRef}
            data-code-editor-area
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className="relative flex min-h-0 min-w-0 flex-1"
        >
            <div
                key="main"
                className={cn("flex min-w-0 flex-col", showSide ? "flex-none" : "flex-1")}
                style={showSide ? { width: `${mainShare * 100}%` } : undefined}
            >
                <CodePathBar sideHidden={side != null && project != null && !fits ? side.rel : null} />
                <CodeStaleBar />
                <div className="min-h-0 flex-1">
                    <CodeViewer model={model} />
                </div>
            </div>
            {showSide ? (
                <>
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize the side column"
                        onPointerDown={onGripDown}
                        onPointerMove={onGripMove}
                        onPointerUp={onGripUp}
                        onPointerCancel={onGripUp}
                        className="group relative z-10 flex w-2 flex-none cursor-col-resize items-center justify-center"
                    >
                        <span className="h-full w-px bg-edge-mid group-hover:bg-accent" />
                    </div>
                    <CodeSidePane project={project} side={side} />
                </>
            ) : null}
            {overlay ? (
                // over the editor and any PDF frame, which would otherwise take the drag events
                <div data-code-drop className="absolute inset-0 z-20 grid grid-cols-2 gap-2 bg-background/40 p-2">
                    {(["main", "side"] as const).map((h) => (
                        <div
                            key={h}
                            data-code-drop-half={h}
                            className={cn(
                                "flex items-center justify-center rounded-[8px] border-2 border-dashed text-[12px] font-medium",
                                hover === h
                                    ? "border-accent bg-accent/10 text-accent-soft"
                                    : "border-edge-mid text-muted"
                            )}
                        >
                            {h === "main" ? "Open" : "Open to the side"}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
