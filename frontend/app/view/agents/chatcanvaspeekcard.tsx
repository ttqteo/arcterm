// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Canvas card at the end of a finished turn that wrote design boards
// (.superpowers/design/chat-canvas-peek/project/A-canvas-card.dc.html): the canvas's name over a small picture of each
// board the turn drew, so you see the design where the agent says it is ready instead of switching to the Canvas tab. A
// picture opens that board in the board modal over Chat (chatcanvaspickmodal.tsx, with nothing to pick), Look at all
// opens them side by side, and Open in Canvas goes on to the Canvas. Which boards, and their names, are
// chatcanvaspeek.ts's.
//
// The pictures are the boards' own pages, live, shrunk to the tile: only while the card is near the view, since each is
// a page of its own and a long conversation can hold many such turns. They need the canvas attached to the agent (an
// agent's `wsh ui reveal` does it); a turn that drew on another canvas shows the names alone, and a click attaches it.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowUpRight, PanelsTopLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import {
    ALL_TAB,
    boardUrl,
    canvasDir,
    DEFAULT_BOARD_H,
    DEFAULT_BOARD_W,
    paneState,
    type CanvasBoard,
} from "./canvasmodel";
import { attachCanvas, canvasStateAtom, selectCanvasTab } from "./canvasstore";
import { peekBoards, peekPick, peekTitle, type TurnCanvas } from "./chatcanvaspeek";
import { CanvasPickModal } from "./chatcanvaspickmodal";

// a tile is cut to this height-to-width: a board's top is what tells one from another
const TILE_ASPECT = 10 / 16;
// two rows at most: a turn that wrote more shows the rest under Look at all, so the card never outgrows the reply
const MAX_TILES = 6;
// how near the view the card mounts its pages, and how far past it they go again
const NEAR_MARGIN = "600px 0px";

const FOCUS_RING =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// the nearest ancestor that scrolls, to measure "near the view" against; null (the window) when there is none
function scrollParentOf(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p != null; p = p.parentElement) {
        const overflowY = getComputedStyle(p).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
            return p;
        }
    }
    return null;
}

// true while the element is within NEAR_MARGIN of its scroller's view; unlike a visual's frame, the pages go again
// once it leaves, so a conversation of many design turns holds only the few on screen
function useNear(el: HTMLElement | null): boolean {
    const [near, setNear] = useState(false);
    useEffect(() => {
        if (el == null) {
            return;
        }
        if (typeof IntersectionObserver === "undefined") {
            setNear(true);
            return;
        }
        const observer = new IntersectionObserver((seen) => setNear(seen.some((s) => s.isIntersecting)), {
            root: scrollParentOf(el),
            rootMargin: NEAR_MARGIN,
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [el]);
    return near;
}

function Tile({
    board,
    src,
    reloadKey,
    onOpen,
}: {
    board: CanvasBoard;
    src: string | null;
    reloadKey: number;
    onOpen: () => void;
}) {
    const [measureRef, , rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const width = rect?.width ?? 0;
    const scale = width > 0 ? width / board.w : 0;
    const title = peekTitle(board);
    return (
        <button
            type="button"
            data-chat-canvaspeek-tile={board.name}
            onClick={onOpen}
            title={`Look at ${title}`}
            className={cn(
                "group flex min-w-0 cursor-pointer flex-col gap-[8px] rounded-[8px] border-0 bg-transparent p-0 text-left",
                FOCUS_RING
            )}
        >
            <div
                ref={measureRef}
                className="relative w-full overflow-hidden rounded-[8px] border border-edge-mid bg-surface-code group-hover:border-edge-strong"
                style={{ aspectRatio: `${1 / TILE_ASPECT}` }}
            >
                {src != null && scale > 0 ? (
                    <iframe
                        key={`${reloadKey}:${board.name}`}
                        src={src}
                        title={board.name}
                        tabIndex={-1}
                        aria-hidden
                        loading="lazy"
                        sandbox="allow-scripts allow-same-origin"
                        className="pointer-events-none absolute left-0 top-0 border-0 bg-background"
                        style={{
                            width: board.w,
                            height: board.h,
                            transform: `scale(${scale})`,
                            transformOrigin: "0 0",
                        }}
                    />
                ) : (
                    <PanelsTopLeft
                        size={20}
                        strokeWidth={1.6}
                        aria-hidden
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink-faint"
                    />
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-[1px] px-[2px]">
                <span className="truncate text-[13px] text-primary">{title}</span>
                <span className="truncate text-[12px] text-muted">{board.name}</span>
            </div>
        </button>
    );
}

export function ChatCanvasPeekCard({ agent, canvas }: { agent: AgentVM; canvas: TurnCanvas }) {
    const s = useAtomValue(canvasStateAtom(agent.id));
    const [cardEl, setCardEl] = useState<HTMLElement | null>(null);
    const near = useNear(cardEl);
    // the modal's tab (All or a board), null while it is closed
    const [look, setLook] = useState<string | null>(null);
    const lookRef = useRef(look);
    lookRef.current = look;

    // the pictures need the canvas the turn drew on to be the one attached to the agent, read by the poller
    const live = s != null && s.topic === canvas.topic && s.status !== "removed";
    const polled = live && s.boards.length > 0;
    const boards: CanvasBoard[] = polled
        ? peekBoards(s.boards, canvas.boards)
        : canvas.boards.map((name) => ({ name, x: 0, y: 0, w: DEFAULT_BOARD_W, h: DEFAULT_BOARD_H }));
    if (boards.length === 0) {
        // every board the turn wrote has left canvas.json (the options not chosen, moved aside)
        return null;
    }
    const pick = peekPick(canvas.topic, boards);
    const src = (name: string) =>
        near && polled && s.base != null && paneState(s) === "board" ? boardUrl(s.base, s.topic, name) : null;

    // a canvas that is not the agent's attached one is attached first, as opening it from the brainstorm rail does
    const openInCanvas = (tab: string) => {
        if (live) {
            selectCanvasTab(agent.id, tab);
        } else {
            attachCanvas(agent.id, {
                topic: canvas.topic,
                dir: canvasDir(canvas.cwd, canvas.topic),
                projectDir: canvas.cwd,
                board: tab === ALL_TAB ? undefined : tab,
            });
            if (tab === ALL_TAB) {
                selectCanvasTab(agent.id, ALL_TAB);
            }
        }
        setAgentView(agent.id, "canvas", Date.now());
    };
    const lookAt = (tab: string) => (live ? setLook(tab) : openInCanvas(tab));
    const many = boards.length > 1;

    return (
        <section
            ref={setCardEl}
            data-chat-canvaspeek={canvas.topic}
            aria-label={`Canvas ${canvas.topic}`}
            className="flex flex-col gap-[12px] rounded-[12px] border border-edge-strong bg-surface-raised px-[16px] py-[14px]"
        >
            <div className="flex min-w-0 items-center gap-[8px] text-[12px] text-muted">
                <PanelsTopLeft size={14} strokeWidth={2} className="flex-none" aria-hidden />
                <span className="flex-none">Canvas</span>
                <span className="min-w-0 truncate text-secondary">{canvas.topic}</span>
                <span className="flex-none">· {many ? `${boards.length} boards` : "1 board"}</span>
            </div>
            <div className="grid grid-cols-3 gap-[12px]">
                {boards.slice(0, MAX_TILES).map((b) => (
                    <Tile
                        key={b.name}
                        board={b}
                        src={src(b.name)}
                        reloadKey={s?.reloadKey ?? 0}
                        onOpen={() => lookAt(b.name)}
                    />
                ))}
            </div>
            <div className="flex items-center gap-[10px] border-t border-edge-mid pt-[10px] text-[12px] text-muted">
                {many ? (
                    <button
                        type="button"
                        data-chat-canvaspeek-all
                        onClick={() => lookAt(ALL_TAB)}
                        className={cn(
                            "flex cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-accent-soft hover:underline",
                            FOCUS_RING
                        )}
                    >
                        <PanelsTopLeft size={13} strokeWidth={2} aria-hidden />
                        {`Look at all ${boards.length}`}
                    </button>
                ) : null}
                <div className="flex-1" />
                {many ? <span className="text-right">Click a board to look at it alone</span> : null}
                <button
                    type="button"
                    data-chat-canvaspeek-open
                    onClick={() => openInCanvas(many ? ALL_TAB : boards[0].name)}
                    className={cn(
                        "flex cursor-pointer items-center gap-[4px] rounded-[4px] border-0 bg-transparent p-0 text-secondary hover:text-primary",
                        FOCUS_RING
                    )}
                >
                    Open in Canvas
                    <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                </button>
            </div>
            {look != null && live ? (
                <CanvasPickModal
                    agent={agent}
                    pick={pick}
                    tab={look}
                    busy={false}
                    onTab={setLook}
                    onOpenInCanvas={() => {
                        const tab = lookRef.current ?? ALL_TAB;
                        setLook(null);
                        openInCanvas(tab);
                    }}
                    onClose={() => setLook(null)}
                />
            ) : null}
        </section>
    );
}
