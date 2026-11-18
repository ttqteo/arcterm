// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The quick pick card's board modal: the option boards the card lists, and only those, over Chat, so you can look at
// them without leaving it. All draws them side by side; a tile, a tab or ← → shows one whole, and its Pick button sends
// the row as the card's row does. Open in Canvas is still there for the whole canvas. What shows is chatcanvaspick.ts's
// (pickTabs, pickShown, pickRowAt); the frames are the canvas pane's. The Canvas card at a turn's end
// (chatcanvaspeekcard.tsx) opens it too, on the boards the turn drew: rows with no letter and no `onPick`, so there is
// nothing to pick and the head names the canvas.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ModalShell } from "@/app/modals/modalshell";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { PanelsTopLeft, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { AgentVM } from "./agentsviewmodel";
import { ALL_TAB, boardUrl, canvasLayout, paneState, stepTab, withContentHeights } from "./canvasmodel";
import {
    BoardFrameView,
    CANVAS_TOP_PAD,
    EdgeState,
    ServerDown,
    StepButton,
    useContentHeights,
    useSteadyFitWidth,
} from "./canvaspane";
import { canvasStateAtom } from "./canvasstore";
import { pickRowAt, pickShown, pickTabs, type CanvasPick } from "./chatcanvaspick";
import { SWAP_BTN, SWAP_PRIMARY_BTN, SwapTabs } from "./swapbar";

function editable(t: EventTarget | null): boolean {
    return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function CanvasPickModal({
    agent,
    pick,
    tab,
    busy,
    onTab,
    onPick,
    onOpenInCanvas,
    onClose,
}: {
    agent: AgentVM;
    pick: CanvasPick;
    tab: string;
    busy: boolean;
    onTab: (tab: string) => void;
    // left out where nothing is to be picked (the Canvas card's look at a turn's boards)
    onPick?: (row: number) => void;
    onOpenInCanvas: () => void;
    onClose: () => void;
}) {
    const s = useAtomValue(canvasStateAtom(agent.id));
    const [measureRef, scrollRef, rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const fitWidth = useSteadyFitWidth(rect?.width ?? 0);
    const [heights, reportHeight] = useContentHeights(`${s?.topic}:${s?.reloadKey}`);
    const tabs = pickTabs(pick);
    const step = (delta: number) => onTab(stepTab(tabs, tab, delta) ?? ALL_TAB);
    const row = pickRowAt(pick, tab);
    const shown = s != null ? pickShown(s.boards, pick, tab) : [];
    const layout = canvasLayout(withContentHeights(shown, heights), fitWidth);
    const pane = s == null ? "probing" : paneState(s);

    // ← and → step through the tabs; the cockpit's own bindings stand down while a modal is open
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || editable(e.target)) {
                return;
            }
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                onTab(stepTab(tabs, tab, e.key === "ArrowLeft" ? -1 : 1) ?? ALL_TAB);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [tabs.join("\n"), tab, onTab]);
    useEffect(() => {
        if (scrollRef.current != null) {
            scrollRef.current.scrollTop = 0;
        }
    }, [tab]);

    // portaled: the card sits in Chat's scroll and springs in, and a transformed ancestor would pin the shell's `fixed`
    // scrim to the card instead of the window
    return createPortal(
        <ModalShell open onClose={onClose} topClass="pt-[4vh]" className="flex h-[90vh] w-[94vw] flex-col">
            <div
                data-chat-canvaspick-modal={agent.id}
                className="flex min-h-0 flex-1 flex-col"
                aria-label={`Boards for: ${pick.question}`}
            >
                <div className="flex flex-none items-center gap-[10px] border-b border-border px-[18px] py-[10px]">
                    <PanelsTopLeft size={14} strokeWidth={2} className="flex-none text-muted" aria-hidden />
                    <span className="min-w-0 flex-initial truncate text-[14px] font-semibold text-primary">
                        {pick.question}
                    </span>
                    <div className="flex-1" />
                    <StepButton dir="prev" keysHint="arrows" onStep={step} />
                    <SwapTabs
                        ariaLabel="Boards"
                        value={tab}
                        options={tabs.map((t) => {
                            const r = pick.rows[pickRowAt(pick, t) ?? -1];
                            return {
                                key: t,
                                label: (
                                    <span data-chat-canvaspick-modal-tab={t} className="max-w-[220px] truncate">
                                        {r == null
                                            ? `All ${pick.rows.length}`
                                            : r.letter !== ""
                                              ? `${r.letter} · ${r.title}`
                                              : r.title}
                                    </span>
                                ),
                            };
                        })}
                        onChange={onTab}
                        className="min-w-0 flex-initial"
                    />
                    <StepButton dir="next" keysHint="arrows" onStep={step} />
                    <button type="button" onClick={onOpenInCanvas} className={cn(SWAP_BTN, "ml-[6px]")}>
                        Open in Canvas
                    </button>
                    <button
                        type="button"
                        aria-label="Close (Esc)"
                        title="Close (Esc)"
                        onClick={onClose}
                        className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-primary"
                    >
                        <X size={15} strokeWidth={1.9} aria-hidden />
                    </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col bg-surface-code">
                    {pane === "server-down" ? (
                        <ServerDown />
                    ) : pane === "removed" || shown.length === 0 ? (
                        <EdgeState>
                            <span className="text-[14px] font-semibold text-primary">
                                {pane === "removed" ? `${s?.topic} was removed` : "These boards are gone"}
                            </span>
                        </EdgeState>
                    ) : (
                        // the boards at their full size, scaled to the modal's width, as the canvas pane draws them; under
                        // All a tile wears a cover, and a click on it shows that board alone
                        <div
                            ref={measureRef}
                            data-chat-canvaspick-modal-scroll
                            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[24px] pb-[24px] [scrollbar-gutter:stable]"
                            style={{ paddingTop: CANVAS_TOP_PAD }}
                        >
                            <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
                                {layout.frames.map((f) => (
                                    <BoardFrameView
                                        key={f.board.name}
                                        frame={f}
                                        selected={f.board.name === tab}
                                        tile={tab === ALL_TAB}
                                        src={
                                            pane === "board" && s?.base != null
                                                ? boardUrl(s.base, s.topic, f.board.name)
                                                : null
                                        }
                                        reloadKey={s?.reloadKey ?? 0}
                                        onOpen={() => onTab(f.board.name)}
                                        onContentHeight={(h) => reportHeight(f.board.name, h)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex flex-none items-center gap-[12px] border-t border-border px-[18px] py-[10px] text-[12px] text-muted">
                    {row != null ? (
                        <>
                            <span className="min-w-0 truncate text-secondary">
                                {pick.rows[row].letter !== "" ? (
                                    <>
                                        <span className="font-semibold text-primary">{pick.rows[row].letter}</span>
                                        {` · ${pick.rows[row].title}`}
                                    </>
                                ) : (
                                    pick.rows[row].title
                                )}
                            </span>
                            <div className="flex-1" />
                            <span className="flex-none">← → boards · Esc closes</span>
                            {onPick != null ? (
                                <button
                                    type="button"
                                    data-chat-canvaspick-modal-pick={pick.rows[row].letter}
                                    disabled={busy}
                                    onClick={() => onPick(row)}
                                    className={SWAP_PRIMARY_BTN}
                                >
                                    {`Pick ${pick.rows[row].letter}`}
                                </button>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <span className="min-w-0 truncate">
                                {onPick != null
                                    ? "Click a board to look at it alone, then pick it"
                                    : "Click a board to look at it alone"}
                            </span>
                            <div className="flex-1" />
                            <span className="flex-none">← → boards · Esc closes</span>
                        </>
                    )}
                </div>
            </div>
        </ModalShell>,
        document.body
    );
}
