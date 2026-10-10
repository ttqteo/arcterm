// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float folded into Sprout (floatstore.ts enterMini): the see-through window holds only this. Sprout sits in the
// window's corner away from where things open (floatwindow.ts miniSides), bobs, wears what waits on you (petmini.ts),
// and is dragged by a press that moves; a double-click, or Terminal on the hover chip, gives the float window back.
// Every element the cursor may use carries data-mini-hit, or the click-through poll lets clicks fall through it.

import { STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import { attentionAtom } from "@/app/view/agents/attentionstore";
import { channelMessagesAtom } from "@/app/view/agents/channelsstore";
import { exitMini, miniResizingAtom, miniSidesAtom } from "@/app/view/agents/floatstore";
import type { MiniSides } from "@/app/view/agents/floatwindow";
import { miniHoverAtom } from "@/app/view/agents/miniclickthrough";
import { StatusDot } from "@/app/view/agents/statusdot";
import { postureFor } from "@/app/view/jarvis/petcondition";
import { miniLook } from "@/app/view/jarvis/petmini";
import { petOutfit, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { queueRows } from "@/app/view/jarvis/petpeekmodel";
import { spriteFor } from "@/app/view/jarvis/petsprite";
import { petErrandAtom, petOutfitChoiceAtom, petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { usePetSignals } from "@/app/view/jarvis/petview";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { cn, fireAndForget } from "@/util/util";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { PictureInPicture2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const BOB_MS = 700;
const DRAG_PX = 4;
// 4px a cell: the 16-cell sprite is 64px
const CELL_PX = 4;
// Spike result 1 or 2 failed on a platform: draw Sprout on a tile there (make this `isWindows()` or `isMacOS()`)
const MINI_TILE = false;

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

export function SproutMini({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const sides = useAtomValue(miniSidesAtom);
    const resizing = useAtomValue(miniResizingAtom);
    const hovered = useAtomValue(miniHoverAtom);
    const chatOpen = useAtomValue(petPeekOpenAtom);
    const errand = useAtomValue(petErrandAtom);
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const messages = useAtomValue(channelMessagesAtom);
    const outfitChoice = useAtomValue(petOutfitChoiceAtom);
    const frame = useBobFrame();
    const waiting = useMemo(() => queueRows(items, agents, messages).length, [items, agents, messages]);
    const look = miniLook({ posture: postureFor(signals), waiting, errand, unread: false, chatOpen, frame });
    const sprite = spriteFor(look.pose, look.marks, petOutfit(petOutfitChoice(outfitChoice), new Date()));
    const agent = agents.find((a) => a.id === focusId) ?? terminals.find((a) => a.id === focusId);
    const dragged = useRef(false);

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
    const restore = () => fireAndForget(exitMini);

    return (
        <div data-sprout-mini className={cn("fixed inset-0", resizing && "opacity-0")}>
            <div
                data-mini-hit="sprout"
                className={cn(
                    "absolute h-20 w-20",
                    boxCorner(sides),
                    MINI_TILE && "rounded-[18px] border border-edge-strong bg-surface shadow-popover-sm"
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
                    type="button"
                    aria-label={look.label}
                    title={look.label}
                    onPointerDown={onPointerDown}
                    onDoubleClick={restore}
                    className={cn(
                        "absolute left-2 top-2 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
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
            {hovered && !chatOpen && agent != null ? (
                <div
                    data-mini-hit="chip"
                    className={cn(
                        "absolute flex h-[30px] items-center gap-2 whitespace-nowrap rounded-full border border-edge-mid bg-surface-raised pl-2.5 pr-1 shadow-popover-sm",
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
                        title="Restore the float window"
                        onClick={restore}
                        className="flex h-[22px] cursor-pointer items-center gap-1 rounded-full bg-surface-hover px-2 text-[11px] font-semibold text-ink-mid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <PictureInPicture2 size={12} strokeWidth={2} aria-hidden />
                        Terminal
                    </button>
                </div>
            ) : null}
        </div>
    );
}
