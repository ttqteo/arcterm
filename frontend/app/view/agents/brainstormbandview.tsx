// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The board dialog of the brainstorm attached to an agent (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md;
// the Chat band that held the brainstorm's line and body is gone, the rail's Brainstorm tab has them, railbrainstormpane.tsx).
// A click on a board opens that board large in a dialog over the agent's cell (ChatBoardDialog, BoardPreview), whose page
// loads only while it is open (no thumbnail, so it costs no RAM in any number of cells), and takes that one board as seen;
// the Brainstorm view takes them all as seen. The dialog is the cell's (agentsurface.tsx), so it opens over Chat and over the
// terminal alike, from the Brainstorm tab of the rail or the question card, and owns its keys.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { PanelsTopLeft, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import { BoardDialog } from "./brainstormrail";
import {
    brainstormAtom,
    brainstormBandAtom,
    chatBoardPreviewAtom,
    getBrainstorm,
    markBoardSeen,
} from "./brainstormstore";
import {
    boardUrl,
    canvasLayout,
    DEFAULT_BOARD_H,
    DEFAULT_BOARD_W,
    withContentHeights,
    type CanvasBoard,
} from "./canvasmodel";
import { BoardFrameView, CANVAS_TOP_PAD, useContentHeights, useSteadyFitWidth } from "./canvaspane";
import { focusChatBox } from "./chatinsert";
import { railBrainstormRows } from "./railbrainstorm";
import { SWAP_BTN } from "./swapbar";

// a mouse press must not take focus off whatever has it: the dialog's keys live on its root
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Opens the agent's Brainstorm tab: the tab is what the user looks at, so it takes the board names as seen. */
export function openBrainstorm(agentId: string): void {
    setAgentView(agentId, "brainstorm", Date.now());
}

/** Whether a board of the agent's brainstorm can open over Chat now: wavesrv serves the design folder (the poller asks it
 *  to once the file lists a board) and the file names its canvas. When not, a board's click opens the Brainstorm tab.
 *  Takes the board as seen when it can. */
export function startBoardPreview(agentId: string, name: string): boolean {
    const s = getBrainstorm(agentId);
    if (s?.base == null || s.file?.canvas == null) {
        return false;
    }
    markBoardSeen(s.path, name, Date.now());
    return true;
}

/** Opens `name` large in the dialog over the agent's Chat, or the Brainstorm tab when the board cannot open there yet. */
export function openChatBoard(agentId: string, name: string): void {
    if (!startBoardPreview(agentId, name)) {
        openBrainstorm(agentId);
        return;
    }
    globalStore.set(chatBoardPreviewAtom(agentId), name);
}

/** One board of the brainstorm, large, in the board dialog over the agent's cell: a head (the board's name and the part it
 *  illustrates, Open in Brainstorm, Close) over the board at the dialog's width. Its page loads when the dialog opens and
 *  goes when it closes. A click on the board, Esc or the scrim closes it, and ← / → step to the previous / next board
 *  (ChatBoardDialog owns the keys); it has no marking (the Brainstorm tab's open board has). The board's size is canvas.json's, which the poller reads with the file. */
export function BoardPreview({
    agent,
    name,
    part,
    onClose,
    onOpenBrainstorm,
}: {
    agent: AgentVM;
    name: string;
    part: string | null;
    onClose: () => void;
    onOpenBrainstorm: () => void;
}) {
    const s = useAtomValue(brainstormAtom(agent.id));
    const [measureRef, , rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const fitWidth = useSteadyFitWidth(rect?.width ?? 0);
    const [heights, reportHeight] = useContentHeights(name);
    const board: CanvasBoard = s?.boards.find((b) => b.name === name) ?? {
        name,
        x: 0,
        y: 0,
        w: DEFAULT_BOARD_W,
        h: DEFAULT_BOARD_H,
    };
    const frame = canvasLayout(withContentHeights([board], heights), fitWidth).frames[0];
    const canvas = s?.file?.canvas;
    const src = s?.base != null && canvas != null ? boardUrl(s.base, canvas, name) : null;
    return (
        <div data-bsband-preview={name} className="flex h-full min-h-0 flex-col">
            <div className="flex flex-none items-center gap-[10px] border-b border-border px-[16px] py-[8px]">
                <PanelsTopLeft size={16} strokeWidth={1.5} aria-hidden className="flex-none text-muted" />
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[12.5px] font-semibold text-ink-hi">{name}</span>
                    {part != null ? <span className="truncate text-[11px] text-muted">{part}</span> : null}
                </div>
                <button
                    type="button"
                    data-bsband-preview-open
                    onMouseDown={keepFocus}
                    onClick={onOpenBrainstorm}
                    title={`Open in Brainstorm (${formatChordString("b")})`}
                    className={SWAP_BTN}
                >
                    Open in Brainstorm
                </button>
                <button
                    type="button"
                    data-bsband-preview-close
                    aria-label="Close the board"
                    title="Close the board (Esc)"
                    onMouseDown={keepFocus}
                    onClick={onClose}
                    className={cn(SWAP_BTN, "px-[6px]")}
                >
                    <X size={14} strokeWidth={1.9} aria-hidden />
                </button>
            </div>
            {/* the gutter is reserved so the scrollbar appearing cannot narrow the pane, change the fit and make itself
                disappear again (CanvasPane's reason too) */}
            <div
                ref={measureRef}
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[16px] pb-[16px] [scrollbar-gutter:stable]"
                style={{ paddingTop: CANVAS_TOP_PAD }}
            >
                <div className="relative mx-auto" style={{ width: frame.width, height: frame.height }}>
                    <BoardFrameView
                        frame={frame}
                        selected
                        tile={false}
                        src={src}
                        reloadKey={0}
                        onOpen={onClose}
                        onContentHeight={(h) => reportHeight(name, h)}
                    >
                        <button
                            type="button"
                            aria-label="Close the board"
                            title="Close the board (Esc)"
                            onMouseDown={keepFocus}
                            onClick={onClose}
                            className="absolute inset-0 cursor-zoom-out border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                        />
                    </BoardFrameView>
                </div>
            </div>
        </div>
    );
}

/** The board dialog of one agent's cell (agentsurface.tsx draws it beside the Chat layer): the board named by
 *  `chatBoardPreviewAtom` large over the whole cell, whether the agent shows Chat or its terminal. A chip of the rail's
 *  Brainstorm tab or a row of the question card opens it (`openChatBoard`).
 *
 *  Its root is `data-owns-keys`, so the dispatcher counts focus in it as editable and every single-key binding stands down;
 *  its handler answers instead: Esc closes it (and the keyboard goes back to where it was), `b` closes it and opens the
 *  Brainstorm tab, ← / → open the previous / next board in the order the Brainstorm tab draws them and stop at the first
 *  and the last. Opening takes the focus, so those keys answer at once. A board that leaves the brainstorm (or the
 *  brainstorm itself) closes it, and so does the cell leaving the screen. The layer takes no pointer events but the
 *  dialog's own, so a closed one never covers the terminal under it. */
export function ChatBoardDialog({ agent, barred }: { agent: AgentVM; barred: boolean }) {
    const bs = useAtomValue(brainstormBandAtom(agent.id));
    const previewAtom = chatBoardPreviewAtom(agent.id);
    const preview = useAtomValue(previewAtom);
    const setPreview = (name: string | null) => globalStore.set(previewAtom, name);
    const rootRef = useRef<HTMLDivElement>(null);
    // what had the focus when the dialog opened, to give it back on close
    const returnTo = useRef<HTMLElement | null>(null);
    const wasOpen = useRef(false);
    // the dialog keeps the last board drawn while it fades out
    const lastPreview = useRef<string | null>(null);
    if (preview != null) {
        lastPreview.current = preview;
    }
    const previewBoard = bs?.boards.find((b) => b.name === lastPreview.current) ?? null;

    useEffect(() => () => globalStore.set(previewAtom, null), [previewAtom]);
    useEffect(() => {
        if (preview != null && !bs?.boards.some((b) => b.name === preview)) {
            setPreview(null);
        }
    }, [preview, bs]);
    useEffect(() => {
        const open = preview != null;
        const root = rootRef.current;
        if (open && !wasOpen.current) {
            const active = document.activeElement;
            returnTo.current = active instanceof HTMLElement && !root?.contains(active) ? active : null;
            root?.focus({ preventScroll: true });
        } else if (!open && wasOpen.current) {
            const back = returnTo.current;
            returnTo.current = null;
            // only while the focus is still the dialog's (or lost with it): a click elsewhere meanwhile keeps it there
            const held =
                root != null && (root.contains(document.activeElement) || document.activeElement === document.body);
            if (held) {
                if (back?.isConnected) {
                    back.focus({ preventScroll: true });
                } else if (!focusChatBox(agent.id)) {
                    (document.activeElement as HTMLElement | null)?.blur();
                }
            }
        }
        wasOpen.current = open;
    }, [preview]);

    const toBrainstorm = () => {
        setPreview(null);
        openBrainstorm(agent.id);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (preview == null || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        const handled = () => {
            e.preventDefault();
            e.stopPropagation();
        };
        if (e.key === "Escape") {
            handled();
            setPreview(null);
        } else if (e.key === "b") {
            handled();
            toBrainstorm();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            handled();
            const order = bs != null ? railBrainstormRows(bs).boardOrder : [];
            const at = order.indexOf(preview);
            const next = order[at + (e.key === "ArrowLeft" ? -1 : 1)];
            if (at >= 0 && next != null && startBoardPreview(agent.id, next)) {
                setPreview(next);
            }
        }
        // Tab still moves between the dialog's buttons; no other key acts behind the dialog
    };

    return (
        <div
            ref={rootRef}
            data-chat-board-dialog={agent.id}
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            // against the cell, under its grid bar when it has one (the board split's layer sits the same way)
            className={cn(
                "pointer-events-none absolute bottom-0 left-0 right-0 z-30 outline-none [&>*]:pointer-events-auto",
                barred ? "top-[26px]" : "top-0"
            )}
        >
            <BoardDialog open={preview != null} onClose={() => setPreview(null)}>
                {lastPreview.current != null ? (
                    <BoardPreview
                        agent={agent}
                        name={lastPreview.current}
                        part={previewBoard?.part ?? null}
                        onClose={() => setPreview(null)}
                        onOpenBrainstorm={toBrainstorm}
                    />
                ) : null}
            </BoardDialog>
        </div>
    );
}
