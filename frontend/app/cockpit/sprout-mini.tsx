// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float folded into Sprout (floatstore.ts enterMini): the see-through window holds only this. Sprout sits in the
// window's corner away from where things open (floatwindow.ts miniSides), bobs, wears what waits on you (petmini.ts),
// and is dragged by a press that moves. A click opens the Jarvis chat (the pet peek) from it; a double-click, or
// Terminal, gives the float window back. A reply that lands while the chat is folded shows in a bubble beside it.
// Every element the cursor may use carries data-mini-hit, or the click-through poll lets clicks fall through it. Nothing
// here carries a title or a drop shadow: over a light app behind the see-through window, a popover shadow (the tooltip
// chip's, or the hover chip's own) reads as a dark smear. A border keeps each one apart from what is behind it.

import { globalStore } from "@/app/store/jotaiStore";
import { STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { exitMini, miniResizingAtom, miniSidesAtom, resizeMini } from "@/app/view/agents/floatstore";
import type { MiniSides } from "@/app/view/agents/floatwindow";
import { miniHoverAtom } from "@/app/view/agents/miniclickthrough";
import { StatusDot } from "@/app/view/agents/statusdot";
import { closePeek, openPetPeek } from "@/app/view/jarvis/peekstore";
import { postureFor } from "@/app/view/jarvis/petcondition";
import { miniLook, nextUnread } from "@/app/view/jarvis/petmini";
import { petOutfit, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { PetPeek } from "@/app/view/jarvis/petpeek";
import { queueRows } from "@/app/view/jarvis/petpeekmodel";
import { spriteFor } from "@/app/view/jarvis/petsprite";
import { petErrandAtom, petOutfitChoiceAtom, petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { usePetSignals } from "@/app/view/jarvis/petview";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { cn, fireAndForget } from "@/util/util";
import type { Placement } from "@floating-ui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { PictureInPicture2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const BOB_MS = 700;
const DRAG_PX = 4;
// a second click inside this is a double-click, which restores rather than opens
const CLICK_MS = 220;
// 4px a cell: the 16-cell sprite is 64px
const CELL_PX = 4;
// Spike result 1 or 2 failed on a platform: draw Sprout on a tile there (make this `isWindows()` or `isMacOS()`)
const MINI_TILE = false;

// a reply that landed while the chat was folded (petmini.ts nextUnread)
const miniUnreadAtom = atom(false) as PrimitiveAtom<boolean>;

function useBobFrame(): 0 | 1 {
    const [frame, setFrame] = useState<0 | 1>(0);
    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), BOB_MS);
        return () => clearInterval(t);
    }, []);
    return frame;
}

// Sprout's 80px box: the window's corner away from where the chip, the bubble and the chat open
function boxCorner(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-0" : "left-0", sides.v === "up" ? "bottom-0" : "top-0");
}

// the chip and the bubble: beside Sprout toward the middle of the screen, level with its feet or its head
export function besideSprout(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-[88px]" : "left-[88px]", sides.v === "up" ? "bottom-3" : "top-3");
}

function chatPlacement(sides: MiniSides): Placement {
    return `${sides.v === "up" ? "top" : "bottom"}-${sides.h === "left" ? "end" : "start"}`;
}

export function SproutMini({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const sides = useAtomValue(miniSidesAtom);
    const resizing = useAtomValue(miniResizingAtom);
    const hovered = useAtomValue(miniHoverAtom);
    const chatOpen = useAtomValue(petPeekOpenAtom);
    const errand = useAtomValue(petErrandAtom);
    const unread = useAtomValue(miniUnreadAtom);
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const messages = useAtomValue(channelMessagesAtom);
    const outfitChoice = useAtomValue(petOutfitChoiceAtom);
    const frame = useBobFrame();
    const waiting = useMemo(() => queueRows(items, agents, messages).length, [items, agents, messages]);
    const look = miniLook({ posture: postureFor(signals), waiting, errand, unread, chatOpen, frame });
    const sprite = spriteFor(look.pose, look.marks, petOutfit(petOutfitChoice(outfitChoice), new Date()));
    const agent = agents.find((a) => a.id === focusId) ?? terminals.find((a) => a.id === focusId);
    // state, not a ref: the chat positions itself once this lands
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const dragged = useRef(false);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // the reply's unread mark follows the errand and the chat; the chat's opening and closing size the window
    useEffect(() => {
        let prev = globalStore.get(petErrandAtom);
        const step = () => {
            const next = globalStore.get(petErrandAtom);
            globalStore.set(
                miniUnreadAtom,
                nextUnread(prev, next, globalStore.get(petPeekOpenAtom), globalStore.get(miniUnreadAtom))
            );
            prev = next;
        };
        const unErrand = globalStore.sub(petErrandAtom, step);
        const unOpen = globalStore.sub(petPeekOpenAtom, () => {
            step();
            void resizeMini(globalStore.get(petPeekOpenAtom)).catch((e) => console.error("sizing the chat failed", e));
        });
        return () => {
            unErrand();
            unOpen();
            clearTimeout(clickTimer.current);
        };
    }, []);

    const onPointerDown = (e: ReactPointerEvent) => {
        if (e.button !== 0) {
            return;
        }
        dragged.current = false;
        const start = { x: e.screenX, y: e.screenY };
        const move = (ev: PointerEvent) => {
            if (Math.hypot(ev.screenX - start.x, ev.screenY - start.y) < DRAG_PX) {
                return;
            }
            stop();
            dragged.current = true;
            fireAndForget(() => getCurrentWindow().startDragging());
        };
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    };
    const onClick = () => {
        if (dragged.current) {
            dragged.current = false;
            return;
        }
        clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(
            () => (globalStore.get(petPeekOpenAtom) ? closePeek() : openPetPeek()),
            CLICK_MS
        );
    };
    const restore = () => {
        clearTimeout(clickTimer.current);
        fireAndForget(exitMini);
    };
    const told = unread && !chatOpen && errand != null;

    return (
        <div data-sprout-mini className={cn("fixed inset-0", resizing && "opacity-0")}>
            <div
                data-mini-hit="sprout"
                className={cn(
                    "absolute h-20 w-20",
                    boxCorner(sides),
                    MINI_TILE && "rounded-[18px] border border-edge-strong bg-surface"
                )}
            >
                <span
                    aria-hidden
                    className={cn(
                        "absolute bottom-1.5 left-1/2 h-[7px] w-[50px] -translate-x-1/2 rounded-full bg-background/50",
                        look.bob && "scale-x-[0.78] opacity-60"
                    )}
                />
                <button
                    ref={setAnchor}
                    type="button"
                    aria-label={look.label}
                    aria-expanded={chatOpen}
                    onPointerDown={onPointerDown}
                    onClick={onClick}
                    onDoubleClick={restore}
                    className={cn(
                        "absolute left-2 top-2 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        chatOpen && "bg-accentbg",
                        look.bob && "-translate-y-1"
                    )}
                >
                    <SproutSvg sprite={sprite} cellPx={CELL_PX} />
                </button>
                {look.chip != null ? (
                    <span className="pointer-events-none absolute left-1 top-3 min-w-[18px] rounded-full bg-warning px-[5px] text-center text-[11px] font-bold leading-[18px] text-on-warning tabular-nums">
                        {look.chip}
                    </span>
                ) : null}
            </div>

            {told ? (
                <div
                    data-mini-hit="bubble"
                    role="button"
                    tabIndex={0}
                    aria-label="Open the reply"
                    onClick={openPetPeek}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openPetPeek();
                        }
                    }}
                    className={cn(
                        "absolute flex w-[240px] cursor-pointer flex-col gap-1 rounded-[12px] border border-edge-mid bg-surface-raised px-2.5 pb-[9px] pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        besideSprout(sides)
                    )}
                >
                    <div className="flex items-center gap-1.5 text-[9.5px] text-muted">
                        <span
                            className={cn(
                                "h-[5px] w-[5px] rounded-full",
                                errand.status === "error" ? "bg-error" : "bg-success"
                            )}
                        />
                        <span className="flex-1">
                            {errand.runtime} · {errand.status === "error" ? "failed" : "replied"}
                        </span>
                        <button
                            type="button"
                            aria-label="Dismiss the reply"
                            onClick={(e) => {
                                e.stopPropagation();
                                globalStore.set(miniUnreadAtom, false);
                            }}
                            className="flex cursor-pointer rounded-[5px] p-0.5 text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <X size={11} strokeWidth={2.2} aria-hidden />
                        </button>
                    </div>
                    <div className="line-clamp-3 text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">
                        {errand.text}
                    </div>
                </div>
            ) : null}

            {hovered && !chatOpen && !told && agent != null ? (
                <div
                    data-mini-hit="chip"
                    className={cn(
                        "absolute flex h-[30px] items-center gap-2 whitespace-nowrap rounded-full border border-edge-mid bg-surface-raised pl-2.5 pr-1",
                        besideSprout(sides)
                    )}
                >
                    <StatusDot state={agent.state} />
                    <span className="max-w-[110px] truncate text-[12px] font-semibold text-primary">{agent.name}</span>
                    {agent.kind !== "terminal" ? (
                        <span className="text-[11px] font-medium" style={{ color: STATE_COLOR[agent.state] }}>
                            {agent.state === "asking" ? askingLabel(agent) : STATE_LABEL[agent.state]}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        data-mini-restore
                        aria-label="Restore the float window"
                        onClick={restore}
                        className="flex h-[22px] cursor-pointer items-center gap-1 rounded-full bg-surface-hover px-2 text-[11px] font-semibold text-ink-mid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <PictureInPicture2 size={12} strokeWidth={2} aria-hidden />
                        Terminal
                    </button>
                </div>
            ) : null}

            <PetPeek
                model={model}
                anchor={anchor}
                corner="mini"
                placement={chatPlacement(sides)}
                signals={signals}
                onRestore={restore}
            />
        </div>
    );
}
