// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window folded into Sprout (floatstore.ts foldToSprout): the see-through window holds only this. Sprout, the same
// 48px as on the footer and the float's ledge, sits in the window's corner away from where things open (floatwindow.ts
// miniSides), bobs, wears what waits on you (petmini.ts), and is dragged by a press that moves. Hovered, it lists the
// agents (a click floats on one) and Restore; a click opens the Jarvis chat (the pet peek); a double-click restores the
// size it was folded from. What Sprout says (petBubbleAtom), and a reply that landed while the chat was folded, show in
// a bubble beside it.
// Every element the cursor may use carries data-mini-hit, or the click-through poll lets clicks fall through it. Nothing
// here carries a title or a drop shadow, and Sprout has no ground shadow: over a light app behind the see-through
// window, they read as dark smears. A border keeps each one apart from what is behind it.

import { globalStore } from "@/app/store/jotaiStore";
import { STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import {
    foldOriginAtom,
    miniResizingAtom,
    miniSidesAtom,
    resizeMini,
    restoreFromSprout,
} from "@/app/view/agents/floatstore";
import type { MiniSides } from "@/app/view/agents/floatwindow";
import { miniHoverAtom } from "@/app/view/agents/miniclickthrough";
import { foldedList } from "@/app/view/agents/sproutroster";
import { StatusDot } from "@/app/view/agents/statusdot";
import { closePeek, openPetPeek } from "@/app/view/jarvis/peekstore";
import { PetBubble } from "@/app/view/jarvis/petbubble";
import { petCharacter } from "@/app/view/jarvis/petcharacter";
import { postureFor } from "@/app/view/jarvis/petcondition";
import { miniLook, nextUnread } from "@/app/view/jarvis/petmini";
import { petOutfit, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { PetPeek } from "@/app/view/jarvis/petpeek";
import { PET_CELL_PX, spriteFor } from "@/app/view/jarvis/petsprite";
import {
    petBubbleAtom,
    petCharacterAtom,
    petErrandAtom,
    petOutfitChoiceAtom,
    petPeekOpenAtom,
} from "@/app/view/jarvis/petstore";
import { dismissPetBubble, openPetBubble, usePetSignals, useWaitingCount } from "@/app/view/jarvis/petview";
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

// Sprout's 64px box: the window's corner away from where the list, the bubble and the chat open
function boxCorner(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-0" : "left-0", sides.v === "up" ? "bottom-0" : "top-0");
}

// the list and the reply bubble: beside Sprout toward the middle of the screen, level with its feet or its head
export function besideSprout(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-[72px]" : "left-[72px]", sides.v === "up" ? "bottom-2" : "top-2");
}

// the chat and what Sprout says: above or below it, toward the middle of the screen
function openPlacement(sides: MiniSides): Placement {
    return `${sides.v === "up" ? "top" : "bottom"}-${sides.h === "left" ? "end" : "start"}`;
}

const ROW =
    "flex cursor-pointer items-center gap-2 rounded-[7px] px-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function SproutMini({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const sides = useAtomValue(miniSidesAtom);
    const resizing = useAtomValue(miniResizingAtom);
    const hovered = useAtomValue(miniHoverAtom);
    const chatOpen = useAtomValue(petPeekOpenAtom);
    const errand = useAtomValue(petErrandAtom);
    const unread = useAtomValue(miniUnreadAtom);
    const bubble = useAtomValue(petBubbleAtom);
    const origin = useAtomValue(foldOriginAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const outfitChoice = useAtomValue(petOutfitChoiceAtom);
    const character = petCharacter(useAtomValue(petCharacterAtom));
    const frame = useBobFrame();
    const waiting = useWaitingCount(model);
    const look = miniLook({ posture: postureFor(signals), waiting, errand, unread, chatOpen, frame });
    const sprite = spriteFor(look.pose, look.marks, petOutfit(petOutfitChoice(outfitChoice), new Date()), character);
    const list = useMemo(() => foldedList(agents, terminals, focusId ?? null), [agents, terminals, focusId]);
    // state, not a ref: the chat and the bubble position themselves once this lands
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const dragged = useRef(false);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // the reply's unread mark follows the errand and the chat; the chat's opening and closing size the window
    useEffect(() => {
        // a fold starts with nothing unread: a reply read before it is not news again
        globalStore.set(miniUnreadAtom, false);
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
    // to the size it was folded from, or to Float on an agent picked in the list
    const restore = (agentId?: string) => {
        clearTimeout(clickTimer.current);
        fireAndForget(() => restoreFromSprout(model, agentId));
    };
    const speaking = bubble != null && !chatOpen;
    const told = unread && !chatOpen && errand != null && !speaking;
    const fromFloat = origin !== "full";

    return (
        <div data-sprout-mini className={cn("fixed inset-0", resizing && "opacity-0")}>
            <div
                data-mini-hit="sprout"
                className={cn(
                    "absolute h-16 w-16",
                    boxCorner(sides),
                    MINI_TILE && "rounded-[18px] border border-edge-strong bg-surface"
                )}
            >
                <button
                    ref={setAnchor}
                    type="button"
                    aria-label={look.label}
                    aria-expanded={chatOpen}
                    onPointerDown={onPointerDown}
                    onClick={onClick}
                    onDoubleClick={() => restore()}
                    className={cn(
                        "absolute left-2 top-2 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        chatOpen && "bg-accentbg",
                        look.bob && "-translate-y-1"
                    )}
                >
                    <SproutSvg sprite={sprite} cellPx={PET_CELL_PX} />
                </button>
                {look.chip != null ? (
                    <span className="pointer-events-none absolute left-1 top-3 min-w-4 rounded-full bg-warning px-1 text-center text-[10px] font-bold leading-4 text-on-warning tabular-nums">
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

            {hovered && !chatOpen && !told && !speaking ? (
                <div
                    data-mini-hit="agents"
                    className={cn(
                        "absolute flex w-[236px] flex-col rounded-[12px] border border-edge-mid bg-surface-raised p-1.5",
                        besideSprout(sides)
                    )}
                >
                    {list.shown.map((a) => (
                        <button
                            key={a.id}
                            type="button"
                            data-mini-agent={a.id}
                            aria-label={`Float on ${a.name}`}
                            onClick={() => restore(a.id)}
                            className={cn(ROW, "h-[30px] text-[12px] text-primary")}
                        >
                            <StatusDot state={a.state} />
                            <span className="min-w-0 flex-1 truncate">{a.name}</span>
                            {a.kind !== "terminal" ? (
                                <span className="text-[11px]" style={{ color: STATE_COLOR[a.state] }}>
                                    {a.state === "asking" ? askingLabel(a) : STATE_LABEL[a.state]}
                                </span>
                            ) : null}
                        </button>
                    ))}
                    {list.more > 0 ? (
                        <span className="flex h-[26px] items-center px-2 text-[11px] text-muted tabular-nums">
                            +{list.more} more
                        </span>
                    ) : null}
                    {list.shown.length > 0 ? <span aria-hidden className="mx-1 my-1 h-px bg-border" /> : null}
                    <button
                        type="button"
                        data-mini-restore
                        aria-label={fromFloat ? "Restore the float window" : "Restore the window"}
                        onClick={() => restore()}
                        className={cn(ROW, "h-7 gap-1.5 text-[11.5px] font-semibold text-secondary hover:text-primary")}
                    >
                        <PictureInPicture2 size={12} strokeWidth={2} aria-hidden />
                        {fromFloat ? "Restore float" : "Restore window"}
                        <span className="ml-auto text-[10.5px] font-medium text-muted">double-click</span>
                    </button>
                </div>
            ) : null}

            <PetBubble
                event={chatOpen ? null : bubble}
                anchor={anchor}
                corner="bottom-right"
                placement={openPlacement(sides)}
                flat
                onOpen={openPetBubble}
                onDismiss={dismissPetBubble}
            />

            <PetPeek
                model={model}
                anchor={anchor}
                corner="mini"
                placement={openPlacement(sides)}
                signals={signals}
                onRestore={() => restore()}
            />
        </div>
    );
}
