// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window folded into Sprout (floatstore.ts foldToSprout): the see-through window holds only this. Sprout, the same
// 48px as on the footer and the float's ledge, sits in the window's corner away from where things open (floatwindow.ts
// miniSides), bobs, wears what waits on you (petmini.ts), and is dragged by a press that moves. A click opens or closes
// the Jarvis chat (the pet peek); a double-click gives back the size it was folded from. A cursor resting on it opens the
// hover card: the agents (a click floats on one), the row that opens the chat, and Restore. What Sprout says
// (petBubbleAtom), and a reply that landed while the chat was folded, show in a bubble beside it, and give way to the
// card. Spider-Man folds into a rooftop scene instead (petmini.ts spideyFoldLook): windows lit for the
// agents working, spider-sense for what waits, and his web with the count beside it, since the windows stop at four.
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
import { foldedList, workingCount } from "@/app/view/agents/sproutroster";
import { StatusDot } from "@/app/view/agents/statusdot";
import { closePeek, openPetPeek } from "@/app/view/jarvis/peekstore";
import { PetBubble } from "@/app/view/jarvis/petbubble";
import { petCharacter } from "@/app/view/jarvis/petcharacter";
import { postureFor, type PetPosture } from "@/app/view/jarvis/petcondition";
import { miniChatLabel, miniLook, nextUnread, spideyFoldLook, type SpideyFoldLook } from "@/app/view/jarvis/petmini";
import { petOutfit, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { PetPeek } from "@/app/view/jarvis/petpeek";
import {
    PET_CELL_PX,
    SPIDEY_SENSE,
    spideyFold,
    spriteFor,
    spriteOfRows,
    type PetCell,
} from "@/app/view/jarvis/petsprite";
import {
    petBubbleAtom,
    petCharacterAtom,
    petErrandAtom,
    petOutfitChoiceAtom,
    petPeekOpenAtom,
} from "@/app/view/jarvis/petstore";
import { PetTeleportSvg } from "@/app/view/jarvis/petteleportsvg";
import { dismissPetBubble, openPetBubble, usePetSignals, useWaitingCount } from "@/app/view/jarvis/petview";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { petTeleportAtom } from "@/app/view/jarvis/teleportstore";
import { WorkingDots } from "@/app/view/jarvis/workingdots";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import type { Placement } from "@floating-ui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { MessageCircle, PictureInPicture2, X } from "lucide-react";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";

const BOB_MS = 700;
const DRAG_PX = 4;
// how long a click waits for a second one: a single click opens the chat, a double-click restores
const DOUBLE_CLICK_MS = 250;
// the key that folds and gives the window back (floatstore.ts minimizeRequested), as the card names it
const FOLD_KEY = isMacOS() ? "⌘M" : "Ctrl+M";
// Spike result 1 or 2 failed on a platform: draw Sprout on a tile there (make this `isWindows()` or `isMacOS()`)
const MINI_TILE = false;

// a reply that landed while the chat was folded (petmini.ts nextUnread)
const miniUnreadAtom = atom(false) as PrimitiveAtom<boolean>;

// the DEV contract's override: replaces those fold-look inputs until force(null), so a CDP step can light windows and
// raise spider-sense without arranging working agents or an attention item, or hold the hover card open, which the
// cursor poll opens only for the OS cursor
type MiniForce = {
    working?: number | null;
    waiting?: number;
    posture?: PetPosture;
    thinking?: boolean;
    hover?: boolean;
};

// Spider-Man folded: the rooftop scene, 20x20 cells, in the same box as Sprout's 16x16
function SpideyRoof({ f }: { f: SpideyFoldLook }) {
    const px = 20 * PET_CELL_PX;
    const cells = spriteOfRows(spideyFold(f.lit, f.swing), f.unread ? ["unread"] : []);
    const cell = (c: PetCell, i: number) => (
        <rect
            key={i}
            x={c.x * PET_CELL_PX}
            y={c.y * PET_CELL_PX}
            width={PET_CELL_PX}
            height={PET_CELL_PX}
            fill={`var(${c.token})`}
        />
    );
    return (
        <svg
            data-spidey-roof
            width={px}
            height={px}
            viewBox={`0 0 ${px} ${px}`}
            shapeRendering="crispEdges"
            aria-hidden
            className="block"
        >
            {cells.body.map(cell)}
            {cells.overlay.map(cell)}
            {f.sense ? SPIDEY_SENSE.map(({ x, y }, i) => cell({ x, y, token: "--color-asking" }, 1000 + i)) : null}
        </svg>
    );
}

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
    const liveWaiting = useWaitingCount(model);
    const liveWorking = useMemo(() => workingCount(agents), [agents]);
    const [forced, setForced] = useState<MiniForce | null>(null);
    const look = miniLook({
        posture: forced?.posture ?? postureFor(signals),
        waiting: forced?.waiting ?? liveWaiting,
        working: forced?.working !== undefined ? (forced.working ?? 0) : liveWorking,
        errand,
        unread,
        chatOpen,
        frame,
    });
    const sprite = spriteFor(look.pose, look.marks, petOutfit(petOutfitChoice(outfitChoice), new Date()), character);
    // Spider-Man's rooftop: what it draws (lit windows, spider-sense, swinging legs, the unread mark) and the working web
    const spidey = character === "spidey";
    const roofLook = spideyFoldLook(look, frame);
    const roof: SpideyFoldLook | null = spidey
        ? { ...roofLook, thinking: forced?.thinking ?? roofLook.thinking }
        : null;
    // the fold lands it in the corner with a teleport, and a restore takes it away with one (floatstore.ts)
    const teleport = useAtomValue(petTeleportAtom).mini;
    const roofed = roof != null && teleport == null;
    const lineage = useAtomValue(model.lineageAtom);
    const list = useMemo(
        () => foldedList(agents, terminals, focusId ?? null, lineage),
        [agents, terminals, focusId, lineage]
    );
    // state, not a ref: the chat and the bubble position themselves once this lands
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const dragged = useRef(false);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(clickTimer.current), []);

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
        };
    }, []);

    // Dev-only: the CDP harness reads the rooftop's look and forces its inputs through this, like petview.tsx's
    // __jarvisPet. Folded out of production builds — import.meta.env.DEV is statically false there.
    useEffect(() => {
        if (!import.meta.env.DEV) {
            return;
        }
        (window as unknown as { __jarvisMini?: unknown }).__jarvisMini = {
            character,
            chip: look.chip,
            roof,
            force: setForced,
        };
    });
    useEffect(
        () => () => {
            if (import.meta.env.DEV) {
                delete (window as unknown as { __jarvisMini?: unknown }).__jarvisMini;
            }
        },
        []
    );

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
    // to the size it was folded from, or to Float on an agent picked in the list
    const restore = (agentId?: string) => fireAndForget(() => restoreFromSprout(model, agentId));
    // one click opens or closes the chat, once it is no double-click's first; a double-click restores
    const onClick = (e: ReactMouseEvent) => {
        if (dragged.current) {
            dragged.current = false;
            return;
        }
        clearTimeout(clickTimer.current);
        if (e.detail >= 2) {
            restore();
            return;
        }
        clickTimer.current = setTimeout(
            () => (globalStore.get(petPeekOpenAtom) ? closePeek() : openPetPeek()),
            e.detail === 0 ? 0 : DOUBLE_CLICK_MS
        );
    };
    // the card takes the place of the bubbles while it shows: they come back when it closes
    // "…" and how many work, or Spider-Man's web: for him also while Jarvis thinks, with nothing to count
    const dots = teleport == null && (look.working != null || roof?.thinking === true);
    const card = (forced?.hover ?? hovered) && !chatOpen;
    const speaking = bubble != null && !chatOpen && !card;
    const told = unread && !chatOpen && errand != null && bubble == null && !card;
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
                    onPointerDown={onPointerDown}
                    onClick={onClick}
                    className={cn(
                        "absolute cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        // the rooftop's 60px sits centred in the 64px box; Sprout's 48px, 8px in
                        roofed ? "left-0.5 top-0.5" : "left-2 top-2",
                        chatOpen && "bg-accentbg",
                        // his legs swing on the bob's beat instead
                        look.bob && !spidey && "-translate-y-1"
                    )}
                >
                    {teleport != null ? (
                        <PetTeleportSvg run={teleport} sprite={sprite} cellPx={PET_CELL_PX} character={character} />
                    ) : roof != null ? (
                        <SpideyRoof f={roof} />
                    ) : (
                        <SproutSvg sprite={sprite} cellPx={PET_CELL_PX} />
                    )}
                </button>
                {look.chip != null && teleport == null ? (
                    <span
                        data-mini-chip
                        className={cn(
                            "pointer-events-none absolute min-w-4 rounded-full bg-warning px-1 text-center text-[10px] font-bold leading-4 text-on-warning tabular-nums",
                            // Spider-Man's sits at the right, under the working web while that shows
                            spidey ? (dots ? "right-0 top-5" : "right-0 top-3") : "left-1 top-3"
                        )}
                    >
                        {look.chip}
                    </span>
                ) : null}
                {dots ? (
                    <WorkingDots count={look.working ?? 0} character={character} className="absolute right-0 top-0" />
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

            {card ? (
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
                            <StatusDot state={a.state} pulse={a.state !== "idle"} />
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
                        data-mini-chat
                        aria-label="Open the Jarvis chat"
                        onClick={openPetPeek}
                        className={cn(
                            ROW,
                            "h-7 gap-1.5 text-[11.5px] font-semibold",
                            look.chip != null ? "text-warning" : "text-secondary hover:text-primary"
                        )}
                    >
                        <MessageCircle size={12} strokeWidth={2} aria-hidden />
                        {miniChatLabel(look.chip ?? 0, unread)}
                    </button>
                    <button
                        type="button"
                        data-mini-restore
                        aria-label={fromFloat ? "Restore the float window" : "Restore the window"}
                        onClick={() => restore()}
                        className={cn(ROW, "h-7 gap-1.5 text-[11.5px] font-semibold text-secondary hover:text-primary")}
                    >
                        <PictureInPicture2 size={12} strokeWidth={2} aria-hidden />
                        {fromFloat ? "Restore float" : "Restore window"}
                        <span className="ml-auto text-[10.5px] font-medium text-muted">double-click · {FOLD_KEY}</span>
                    </button>
                </div>
            ) : null}

            <PetBubble
                event={speaking ? bubble : null}
                agents={agents}
                anchor={anchor}
                corner="bottom-right"
                placement={openPlacement(sides)}
                flat
                onOpen={() => openPetBubble(model)}
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
