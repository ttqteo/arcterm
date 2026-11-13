// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer of the chat box, as pill chips: the agent's model (a menu of the model families, each with its own icon; a
// pick types `/model <id>`), its effort (a menu of Claude Code's levels drawn as a five-bar meter; a pick types
// `/effort <level>`),
// Claude Code's permission mode (a menu of the modes; a pick presses Shift+Tab until Claude Code's footer names that
// mode) and, at the right, how full the context is as a small ring with its percent. The mode is read off the terminal
// that stays mounted under the chat (tuiscreen.ts). A dialog or a menu covers Claude Code's footer for a while: the
// poll keeps the last mode seen, and until one is read the chip is not drawn. Asleep, the model is a plain label (a
// wake takes no model), the ring is dimmed and there is no mode chip. The parts fold and crossfade in place when the
// agent sleeps or wakes (the one ChatComposer lives through both), so the caller wraps this in a MotionConfig.

import { pushToast } from "@/app/cockpit/notificationstore";
import { easeFluidCss, foldX, microFade, MOTION } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { readTermLines } from "@/app/view/term/termpaste";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { Check, ChevronUp, Feather, Gem, Leaf, Lock, Sparkles, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { submitToAgent } from "./agentsubmit";
import type { AgentVM } from "./agentsviewmodel";
import {
    contextWarn,
    currentModelAlias,
    EFFORT_CHOICES,
    effortChoice,
    effortCommand,
    MODE_CHOICES,
    MODEL_CHOICES,
    modeLabel,
    modelCommand,
    modeStep,
    ringDash,
    type ModelFamily,
} from "./chatfootermodel";
import { tuiEffort, tuiMode, type ClaudeMode, type EffortLevel } from "./tuiscreen";

// the bottom rows of the screen hold the footer, even under a notice or the effort line
const SCREEN_ROWS = 12;
const POLL_MS = 1000;
// between a Shift+Tab and the read that looks for the redraw
const AFTER_PRESS_MS = 250;
const SHIFT_TAB = "\x1b[Z";

// the ring's circle: r 14 in a 36 box, so its circumference is 2π·14
const RING_CIRC = 88;

// The Framer props of one composer part entering or leaving a row. Reduced motion snaps it: opacity animations still
// play under MotionConfig's "user" setting, so the part skips its variants instead (no initial, no exit).
export function usePartMotion(variants: Variants) {
    const reduce = useReducedMotion();
    return reduce
        ? ({ variants, initial: false, animate: "animate" } as const)
        : ({ variants, initial: "initial", animate: "animate", exit: "exit" } as const);
}

/**
 * A composer part folding in or out of a row of siblings (foldX): the attach button, the mode chip, the "Asleep" word.
 * It clips only while it moves, so a menu opening from the part is not cut off by its box. Render it inside an
 * AnimatePresence, under a MotionConfig.
 */
export function Fold({ children, className }: { children: ReactNode; className?: string }) {
    const [moving, setMoving] = useState(false);
    const part = usePartMotion(foldX);
    return (
        <motion.span
            {...part}
            onAnimationStart={() => setMoving(true)}
            onAnimationComplete={() => setMoving(false)}
            className={cn("flex flex-none", moving && "overflow-hidden", className)}
        >
            {children}
        </motion.span>
    );
}

// The last mode Claude Code's footer named and the last effort its effort line named, read on mount and each second
// while the page is visible; `read` reads now and answers the mode that read found (null when no footer shows). A read
// that finds no footer leaves the mode as it was, and one with no effort line the effort (the line shows only for a
// while after a change, so a pick sets the effort at once with `setEffort`).
function useTuiMode(blockId: string | undefined): {
    mode: ClaudeMode | null;
    effort: EffortLevel | null;
    setEffort: (e: EffortLevel | null) => void;
    read: () => ClaudeMode | null;
} {
    const [mode, setMode] = useState<ClaudeMode | null>(null);
    const [effort, setEffort] = useState<EffortLevel | null>(null);
    const read = useCallback((): ClaudeMode | null => {
        if (blockId == null) {
            return null;
        }
        const lines = readTermLines(blockId, SCREEN_ROWS);
        const next = lines == null ? null : tuiMode(lines);
        if (next != null) {
            setMode(next);
        }
        const seenEffort = lines == null ? null : tuiEffort(lines);
        if (seenEffort != null) {
            setEffort(seenEffort);
        }
        return next;
    }, [blockId]);
    useEffect(() => {
        setMode(null);
        setEffort(null);
        read();
        const poll = setInterval(() => {
            if (document.visibilityState === "visible") {
                read();
            }
        }, POLL_MS);
        return () => clearInterval(poll);
    }, [read]);
    return { mode, effort, setEffort, read };
}

// One chip's menu: its open state, the closes (a press outside, Escape, Tab out) and ↑ / ↓ between its rows. The
// wrapper the caller renders takes `root`, `onKeyDown` and `onBlur`.
function useChipMenu() {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const rows = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        // the keyboard lands on the row in use, so ↑ / ↓ and Enter work at once
        const all = rows();
        (all.find((r) => r.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [open]);
    // the menu's rows unmount with it, and focus would fall to the body: it goes back to the chip
    const close = (refocus: boolean) => {
        setOpen(false);
        if (refocus) {
            root.current?.querySelector<HTMLElement>("[data-chip-trigger]")?.focus();
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (!open) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close(true);
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const all = rows();
            if (all.length === 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const at = all.indexOf(document.activeElement as HTMLElement);
            const step = e.key === "ArrowDown" ? 1 : -1;
            all[at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length].focus();
        }
    };
    const onBlur = (e: FocusEvent<HTMLElement>) => {
        // Tab out of the menu closes it; a move between the chip and its rows does not
        if (open && e.relatedTarget != null && !root.current?.contains(e.relatedTarget as Node)) {
            setOpen(false);
        }
    };
    return { open, setOpen, close, root, onKeyDown, onBlur };
}
type ChipMenuState = ReturnType<typeof useChipMenu>;

// the board's pills: round, on the surface tone, a hairline edge that strengthens on hover and while the menu is open
const CHIP =
    "flex h-[28px] max-w-[200px] cursor-pointer items-center gap-1.5 rounded-full border px-[10px] text-[12.5px] text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none";
const chipTone = (open: boolean) =>
    open ? "border-edge-strong bg-surface-hover text-primary" : "border-edge-mid bg-surface hover:border-edge-strong";
const MENU =
    "absolute bottom-[calc(100%+8px)] left-0 z-10 rounded-[10px] border border-edge-mid bg-surface-raised p-[6px] shadow-popover";
const MENU_CAPTION = "px-2 pb-[6px] pt-1 text-[11.5px] text-muted";
const MENU_FOOT = "px-2 pb-0.5 pt-1.5 text-[11.5px] text-ink-faint";
const row = (on: boolean) =>
    cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-[6px] text-[13px] text-primary transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none motion-reduce:transition-none",
        on && "bg-surface-selected"
    );

// a chip with a menu opening upward from it
function ChipMenu({
    menuLabel,
    width,
    chip,
    menu,
}: {
    menuLabel: string;
    width: string;
    chip: (m: ChipMenuState) => ReactNode;
    menu: (m: ChipMenuState) => ReactNode;
}) {
    const m = useChipMenu();
    return (
        // data-owns-keys while open: Escape closes the menu (useChipMenu) and nothing else. The key dispatcher runs on window
        // capture, ahead of this handler, so without it the Agent surface's own Escape (agent:back) also fires and leaves
        // for the Cockpit (dispatcher.ts ownsKeys). Closed, focus on the chip keeps that Escape.
        <div
            ref={m.root}
            data-owns-keys={m.open ? "" : undefined}
            onKeyDown={m.onKeyDown}
            onBlur={m.onBlur}
            className="relative flex-none"
        >
            {chip(m)}
            <PopoverReveal open={m.open} origin="bottom left" className={cn(MENU, width)}>
                <div role="menu" aria-label={menuLabel}>
                    {menu(m)}
                </div>
            </PopoverReveal>
        </div>
    );
}

// Each model family's icon and tint (categorical lane colours, so every theme recolours them)
const MODEL_LOOK: Record<ModelFamily, { icon: LucideIcon; tint: string; wash: string }> = {
    fable: { icon: Sparkles, tint: "text-graphlane-4", wash: "bg-graphlane-4/15" },
    opus: { icon: Gem, tint: "text-graphlane-1", wash: "bg-graphlane-1/15" },
    sonnet: { icon: Feather, tint: "text-graphlane-6", wash: "bg-graphlane-6/15" },
    haiku: { icon: Leaf, tint: "text-graphlane-2", wash: "bg-graphlane-2/15" },
};

function ModelBadge({ family, size }: { family: ModelFamily; size: "chip" | "row" }) {
    const look = MODEL_LOOK[family];
    const Icon = look.icon;
    return (
        <span
            aria-hidden
            className={cn(
                "flex flex-none items-center justify-center",
                look.wash,
                look.tint,
                size === "chip" ? "-ml-1 h-[18px] w-[18px] rounded-full" : "h-[26px] w-[26px] rounded-[7px]"
            )}
        >
            <Icon size={size === "chip" ? 11 : 14} strokeWidth={2} />
        </span>
    );
}

function ModelChip({ agent }: { agent: AgentVM }) {
    const current = currentModelAlias(agent.model);
    const pick = (id: string, m: ChipMenuState) => {
        const blockid = agent.blockId;
        m.close(true);
        if (blockid == null) {
            return;
        }
        fireAndForget(() => submitToAgent(blockid, modelCommand(id)));
    };
    return (
        <ChipMenu
            menuLabel="Model"
            width="w-[260px]"
            chip={(m) => (
                <button
                    type="button"
                    data-chip-trigger
                    data-chat-model
                    aria-haspopup="menu"
                    aria-expanded={m.open}
                    title="Model (sends /model)"
                    onClick={() => m.setOpen(!m.open)}
                    className={cn(CHIP, chipTone(m.open))}
                >
                    {current != null ? (
                        <ModelBadge family={current} size="chip" />
                    ) : (
                        <span aria-hidden className="h-[8px] w-[8px] flex-none rounded-full bg-accent" />
                    )}
                    <span className="min-w-0 truncate">{agent.model || "Model"}</span>
                    <ChevronUp size={11} strokeWidth={2.2} aria-hidden className="flex-none" />
                </button>
            )}
            menu={(m) => (
                <>
                    <div className={MENU_CAPTION}>Model</div>
                    {MODEL_CHOICES.map((c) => (
                        <button
                            key={c.alias}
                            type="button"
                            role="menuitemradio"
                            aria-checked={c.alias === current}
                            tabIndex={-1}
                            data-chat-model-choice={c.alias}
                            onClick={() => pick(c.id, m)}
                            className={row(c.alias === current)}
                        >
                            <ModelBadge family={c.alias} size="row" />
                            <span className="flex min-w-0 flex-1 flex-col text-left">
                                <span className="truncate">{c.label}</span>
                                <span className="truncate text-[11.5px] text-muted">{c.note}</span>
                            </span>
                            <span className="flex w-[14px] flex-none justify-center">
                                {c.alias === current ? <Check size={13} aria-hidden /> : null}
                            </span>
                        </button>
                    ))}
                    <div className={MENU_FOOT}>Sends /model to Claude Code</div>
                </>
            )}
        />
    );
}

// Five bars rising left to right, the first `filled` in the accent: the effort level at a glance (0 = not known)
function EffortMeter({ filled, size }: { filled: number; size: "chip" | "row" }) {
    return (
        <svg
            width={size === "chip" ? 14 : 17}
            height={size === "chip" ? 11 : 13}
            viewBox="0 0 17 13"
            aria-hidden
            className="flex-none"
        >
            {[0, 1, 2, 3, 4].map((i) => {
                const bar = 4 + i * 2.25;
                return (
                    <rect
                        key={i}
                        x={i * 3.5}
                        y={13 - bar}
                        width={2.4}
                        height={bar}
                        rx={0.8}
                        className={i < filled ? "fill-accent" : "fill-edge-strong"}
                    />
                );
            })}
        </svg>
    );
}

function EffortChip({
    effort,
    onPick,
}: {
    effort: EffortLevel | null;
    onPick: (level: EffortLevel | "auto", m: ChipMenuState) => void;
}) {
    const filled = effort == null ? 0 : EFFORT_CHOICES.findIndex((c) => c.level === effort) + 1;
    return (
        <ChipMenu
            menuLabel="Effort"
            width="w-[260px]"
            chip={(m) => (
                <button
                    type="button"
                    data-chip-trigger
                    data-chat-effort={effort ?? ""}
                    aria-haspopup="menu"
                    aria-expanded={m.open}
                    title="Effort (sends /effort)"
                    onClick={() => m.setOpen(!m.open)}
                    className={cn(CHIP, "whitespace-nowrap", chipTone(m.open))}
                >
                    <EffortMeter filled={filled} size="chip" />
                    <span>{effort == null ? "Effort" : effortChoice(effort).label}</span>
                    <ChevronUp size={11} strokeWidth={2.2} aria-hidden className="flex-none" />
                </button>
            )}
            menu={(m) => (
                <>
                    <div className={MENU_CAPTION}>Effort</div>
                    {EFFORT_CHOICES.map((c, i) => (
                        <button
                            key={c.level}
                            type="button"
                            role="menuitemradio"
                            aria-checked={c.level === effort}
                            tabIndex={-1}
                            data-chat-effort-choice={c.level}
                            onClick={() => onPick(c.level, m)}
                            className={row(c.level === effort)}
                        >
                            <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-accent/10">
                                <EffortMeter filled={i + 1} size="row" />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col text-left">
                                <span className="truncate">{c.label}</span>
                                <span className="truncate text-[11.5px] text-muted">{c.note}</span>
                            </span>
                            <span className="flex w-[14px] flex-none justify-center">
                                {c.level === effort ? <Check size={13} aria-hidden /> : null}
                            </span>
                        </button>
                    ))}
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={false}
                        tabIndex={-1}
                        data-chat-effort-choice="auto"
                        onClick={() => onPick("auto", m)}
                        className={row(false)}
                    >
                        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-surface-hover">
                            <EffortMeter filled={0} size="row" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col text-left">
                            <span className="truncate">Auto</span>
                            <span className="truncate text-[11.5px] text-muted">The model's own default</span>
                        </span>
                        <span className="w-[14px] flex-none" />
                    </button>
                    <div className={MENU_FOOT}>Sends /effort to Claude Code</div>
                </>
            )}
        />
    );
}

function ModeChip({ mode, onPick }: { mode: ClaudeMode; onPick: (target: ClaudeMode, m: ChipMenuState) => void }) {
    return (
        <ChipMenu
            menuLabel="Permission mode"
            width="w-[280px]"
            chip={(m) => (
                <button
                    type="button"
                    data-chip-trigger
                    data-chat-mode={mode}
                    aria-haspopup="menu"
                    aria-expanded={m.open}
                    title="Permission mode (Shift+Tab cycles it)"
                    onClick={() => m.setOpen(!m.open)}
                    className={cn(CHIP, "whitespace-nowrap", chipTone(m.open))}
                >
                    <Lock size={12} strokeWidth={2} aria-hidden className="flex-none" />
                    <span>{modeLabel(mode)}</span>
                    <ChevronUp size={11} strokeWidth={2.2} aria-hidden className="flex-none" />
                </button>
            )}
            menu={(m) => (
                <>
                    <div className={MENU_CAPTION}>Permission mode</div>
                    {MODE_CHOICES.map((c) => (
                        <button
                            key={c.mode}
                            type="button"
                            role="menuitemradio"
                            aria-checked={c.mode === mode}
                            tabIndex={-1}
                            data-chat-mode-choice={c.mode}
                            onClick={() => onPick(c.mode, m)}
                            className={row(c.mode === mode)}
                        >
                            <span className="flex min-w-0 flex-1 flex-col items-start gap-px">
                                <span>{modeLabel(c.mode)}</span>
                                <span className="text-[11.5px] text-muted">{c.note}</span>
                            </span>
                            <span className="flex w-[14px] flex-none justify-center">
                                {c.mode === mode ? <Check size={13} aria-hidden /> : null}
                            </span>
                        </button>
                    ))}
                    <div className={MENU_FOOT}>Shift+Tab in the terminal cycles them too</div>
                </>
            )}
        />
    );
}

// The context as a ring with its percent. Asleep (`dim`) the value is drawn in the muted tone, turning over on the
// macro duration as the board's context colour does.
function ContextRing({ pct, dim }: { pct: number; dim: boolean }) {
    const dash = ringDash(pct, RING_CIRC);
    if (dash == null) {
        return null;
    }
    const rounded = Math.round(pct);
    return (
        <div
            data-chat-context={rounded}
            title={`Context ${rounded}%`}
            className="flex flex-none items-center gap-[5px] text-[11.5px] tabular-nums text-muted"
        >
            <svg width="14" height="14" viewBox="0 0 36 36" aria-hidden>
                <circle cx="18" cy="18" r="14" fill="none" strokeWidth="5" className="stroke-edge-strong" />
                <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    strokeWidth="5"
                    strokeDasharray={`${dash} ${RING_CIRC}`}
                    transform="rotate(-90 18 18)"
                    style={{ transitionDuration: `${MOTION.durMacro}s`, transitionTimingFunction: easeFluidCss }}
                    className={cn(
                        "transition-[stroke] motion-reduce:transition-none",
                        dim ? "stroke-muted" : contextWarn(pct) ? "stroke-warning" : "stroke-secondary"
                    )}
                />
            </svg>
            <span>{rounded}%</span>
        </div>
    );
}

export function ChatFooter({ agent }: { agent: AgentVM }) {
    const asleep = agent.sleeping != null;
    const { mode, effort, setEffort, read } = useTuiMode(asleep ? undefined : agent.blockId);
    const pickEffort = (level: EffortLevel | "auto", m: ChipMenuState) => {
        m.close(true);
        const blockid = agent.blockId;
        if (blockid == null || asleep) {
            return;
        }
        setEffort(level === "auto" ? null : level);
        fireAndForget(() => submitToAgent(blockid, effortCommand(level)));
    };
    const swap = usePartMotion(microFade);
    // a mode pick's loop: a newer pick, a sleep, another block and an unmount each end the one running
    const run = useRef(0);
    useEffect(
        () => () => {
            run.current++;
        },
        [asleep, agent.blockId]
    );
    const pickMode = (target: ClaudeMode, m: ChipMenuState) => {
        m.close(true);
        const blockid = agent.blockId;
        if (blockid == null || asleep) {
            return;
        }
        const mine = ++run.current;
        fireAndForget(async () => {
            const seen: (ClaudeMode | null)[] = [];
            let presses = 0;
            let reads = 0;
            const look = () => {
                reads++;
                seen.push(read());
            };
            look();
            for (;;) {
                if (mine !== run.current) {
                    return;
                }
                const step = modeStep(seen, target, presses, reads);
                if (step === "done") {
                    return;
                }
                if (step === "no-footer") {
                    // a dialog or a menu covers the mode line, and a Shift+Tab into it would answer the dialog
                    pushToast({
                        title: "Claude Code's mode line is covered: answer what it shows, then pick again",
                        message: "",
                        level: "warn",
                    });
                    return;
                }
                if (step === "give-up") {
                    pushToast({
                        title: `Claude Code did not offer ${modeLabel(target)} in this session`,
                        message: "",
                        level: "warn",
                    });
                    return;
                }
                if (step === "press") {
                    await RpcApi.ControllerInputCommand(TabRpcClient, {
                        blockid,
                        inputdata64: stringToBase64(SHIFT_TAB),
                    });
                    presses++;
                }
                await new Promise((resolve) => setTimeout(resolve, AFTER_PRESS_MS));
                if (mine !== run.current) {
                    return;
                }
                look();
            }
        });
    };
    const pct = agent.usage?.contextpct;
    const hasModel = agent.model != null && agent.model !== "";
    return (
        // the footer takes the row's free width, so Stop and Send stay at its far right
        <div data-chat-footer className="flex min-w-0 flex-1 items-center gap-1.5">
            {/* the model chip and the label trade places in one grid cell, so the crossfade stays in place */}
            <div className="grid flex-none items-center">
                <AnimatePresence initial={false}>
                    {asleep ? (
                        hasModel ? (
                            <motion.span
                                key="label"
                                {...swap}
                                data-chat-model-label
                                title="The model it ran on"
                                className="col-start-1 row-start-1 flex h-[28px] max-w-[200px] items-center rounded-full border border-border px-[10px] text-[12.5px] text-muted"
                            >
                                <span className="truncate">{agent.model}</span>
                            </motion.span>
                        ) : null
                    ) : (
                        <motion.div key="chip" {...swap} className="col-start-1 row-start-1">
                            <ModelChip agent={agent} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            <AnimatePresence initial={false}>
                {!asleep ? (
                    <Fold key="effort">
                        <EffortChip effort={effort} onPick={pickEffort} />
                    </Fold>
                ) : null}
            </AnimatePresence>
            <AnimatePresence initial={false}>
                {!asleep && mode != null ? (
                    <Fold key="mode">
                        <ModeChip mode={mode} onPick={pickMode} />
                    </Fold>
                ) : null}
            </AnimatePresence>
            <div className="flex-1" />
            {pct != null ? <ContextRing pct={pct} dim={asleep} /> : null}
        </div>
    );
}
