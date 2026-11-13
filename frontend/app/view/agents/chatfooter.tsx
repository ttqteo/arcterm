// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer of the chat box, as pill chips: the agent's model and effort in one chip, as Claude Desktop has them
// ("Opus 5.5 High"; its menu lists the current models, a pick types `/model <id>`, then Effort, Claude Code's levels
// drawn as a five-bar meter, a pick typing `/effort <level>`, and More models, the earlier ones, as submenus),
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
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { Check, ChevronRight, ChevronUp, Lock } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { submitToAgent } from "./agentsubmit";
import type { AgentVM } from "./agentsviewmodel";
import {
    contextWarn,
    currentModelId,
    EFFORT_CHOICES,
    effortChoice,
    effortCommand,
    MODE_CHOICES,
    MODEL_CHOICES,
    modeLabel,
    modelChipLabel,
    modelCommand,
    modeStep,
    MORE_MODEL_CHOICES,
    ringDash,
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

// One chip's menu: its open state, the closes (a press outside, Escape, Tab out) and ↑ / ↓ between its rows. A menu
// can hold submenus: a row with `data-opens-sub="<name>"` opens the panel marked `data-submenu="<name>"` (on hover, a
// press, Enter or →), one at a time; ← or Escape folds it back to its row. ↑ / ↓ move within the panel in use. The
// wrapper the caller renders takes `root`, `onKeyDown` and `onBlur`.
function useChipMenu() {
    const [open, setOpenState] = useState(false);
    const [sub, setSub] = useState<string | null>(null);
    // a submenu opened from the keyboard takes focus; one opened by hover leaves it where the pointer left it
    const focusSub = useRef(false);
    const root = useRef<HTMLDivElement>(null);
    const setOpen = (next: boolean) => {
        setOpenState(next);
        if (!next) {
            setSub(null);
        }
    };
    const rows = (level: string | null) =>
        Array.from(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter(
            (r) => (r.closest("[data-submenu]")?.getAttribute("data-submenu") ?? null) === level
        );
    const landOn = (level: string | null) => {
        const all = rows(level);
        (all.find((r) => r.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
    };
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
        landOn(null);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [open]);
    useEffect(() => {
        if (sub != null && focusSub.current) {
            focusSub.current = false;
            landOn(sub);
        }
    }, [sub]);
    const openSub = (name: string | null, focus: boolean) => {
        // focus inside the panel that is leaving would fall to the body and take the menu's keys with it
        const from = (document.activeElement as HTMLElement | null)
            ?.closest("[data-submenu]")
            ?.getAttribute("data-submenu");
        if (from != null && from !== name) {
            root.current?.querySelector<HTMLElement>(`[data-opens-sub="${from}"]`)?.focus();
        }
        focusSub.current = focus && name != null;
        setSub(name);
    };
    const foldSub = () => {
        const from = sub;
        setSub(null);
        root.current?.querySelector<HTMLElement>(`[data-opens-sub="${from}"]`)?.focus();
    };
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
        if (e.key === "Escape" || (e.key === "ArrowLeft" && sub != null)) {
            e.preventDefault();
            e.stopPropagation();
            if (sub != null) {
                foldSub();
            } else {
                close(true);
            }
            return;
        }
        if (e.key === "ArrowRight") {
            const opens = (document.activeElement as HTMLElement | null)?.getAttribute("data-opens-sub");
            if (opens != null) {
                e.preventDefault();
                e.stopPropagation();
                openSub(opens, true);
            }
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const all = rows(sub);
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
    return { open, setOpen, sub, openSub, close, root, onKeyDown, onBlur };
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

// a submenu's panel, beside its menu's right edge with their bottoms level
const SUBMENU =
    "absolute bottom-[-7px] left-[calc(100%+6px)] z-10 rounded-[10px] border border-edge-mid bg-surface-raised p-[6px] shadow-popover";

// a chip with a menu opening upward from it; `onKey` sees a key first while the menu is open and answers whether it used it
function ChipMenu({
    menuLabel,
    width,
    chip,
    menu,
    onKey,
}: {
    menuLabel: string;
    width: string;
    chip: (m: ChipMenuState) => ReactNode;
    menu: (m: ChipMenuState) => ReactNode;
    onKey?: (e: KeyboardEvent<HTMLElement>, m: ChipMenuState) => boolean;
}) {
    const m = useChipMenu();
    return (
        // data-owns-keys while open: Escape closes the menu (useChipMenu) and nothing else. The key dispatcher runs on window
        // capture, ahead of this handler, so without it the Agent surface's own Escape (agent:back) also fires and leaves
        // for the Cockpit (dispatcher.ts ownsKeys). Closed, focus on the chip keeps that Escape.
        <div
            ref={m.root}
            data-owns-keys={m.open ? "" : undefined}
            onKeyDown={(e) => {
                if (m.open && onKey?.(e, m)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                m.onKeyDown(e);
            }}
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

// A main-menu row that opens a submenu: its name, the value in use at the right, and a chevron. Hovering it, pressing it,
// Enter or → opens the panel; a press from the keyboard (detail 0) also moves focus into it.
function SubmenuRow({ name, label, value, m }: { name: string; label: string; value: string; m: ChipMenuState }) {
    const on = m.sub === name;
    return (
        <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={on}
            tabIndex={-1}
            data-opens-sub={name}
            onPointerEnter={() => m.openSub(name, false)}
            onClick={(e) => m.openSub(name, e.detail === 0)}
            className={row(on)}
        >
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            {value !== "" ? <span className="flex-none text-[12px] text-muted">{value}</span> : null}
            <ChevronRight size={13} aria-hidden className="flex-none text-muted" />
        </button>
    );
}

// one model row: its name, and at the right the check when it is in use, else its number key (main list only)
function ModelRow({
    id,
    label,
    choice,
    on,
    digit,
    onPick,
    m,
}: {
    id: string;
    label: string;
    choice: string;
    on: boolean;
    digit?: number;
    onPick: (id: string) => void;
    m: ChipMenuState;
}) {
    return (
        <button
            type="button"
            role="menuitemradio"
            aria-checked={on}
            tabIndex={-1}
            data-chat-model-choice={choice}
            // the pointer back on a plain row folds an open submenu, as a native menu does
            onPointerEnter={m.sub != null && digit != null ? () => m.openSub(null, false) : undefined}
            onClick={() => onPick(id)}
            className={row(on)}
        >
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            <span className="flex w-[14px] flex-none justify-center text-[12px] tabular-nums text-ink-faint">
                {on ? <Check size={13} aria-hidden className="text-primary" /> : digit}
            </span>
        </button>
    );
}

// The model chip, with the effort folded into it as Claude Desktop has them: the chip reads "Opus 5.5 High", and its
// menu lists the four current models (1–4 pick one while it is open), then Effort and More models as submenus.
function ModelChip({
    agent,
    effort,
    onPickEffort,
}: {
    agent: AgentVM;
    effort: EffortLevel | null;
    onPickEffort: (level: EffortLevel | "auto", m: ChipMenuState) => void;
}) {
    const current = currentModelId(agent.model);
    const olderLabel = MORE_MODEL_CHOICES.find((c) => c.id === current)?.label ?? "";
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
            width="w-[232px]"
            onKey={(e, m) => {
                const n = Number(e.key);
                if (m.sub != null || e.ctrlKey || e.metaKey || e.altKey || !Number.isInteger(n)) {
                    return false;
                }
                const c = MODEL_CHOICES[n - 1];
                if (c == null) {
                    return false;
                }
                pick(c.id, m);
                return true;
            }}
            chip={(m) => (
                <button
                    type="button"
                    data-chip-trigger
                    data-chat-model
                    data-chat-effort={effort ?? ""}
                    aria-haspopup="menu"
                    aria-expanded={m.open}
                    title="Model and effort (sends /model, /effort)"
                    onClick={() => m.setOpen(!m.open)}
                    className={cn(CHIP, "max-w-[240px]", chipTone(m.open))}
                >
                    <span className="min-w-0 truncate">{modelChipLabel(agent.model)}</span>
                    {effort != null ? (
                        <span className="flex-none whitespace-nowrap text-muted">{effortChoice(effort).label}</span>
                    ) : null}
                    <ChevronUp size={11} strokeWidth={2.2} aria-hidden className="flex-none" />
                </button>
            )}
            menu={(m) => (
                <>
                    <div className={MENU_CAPTION}>Model</div>
                    {MODEL_CHOICES.map((c, i) => (
                        <ModelRow
                            key={c.id}
                            id={c.id}
                            label={c.label}
                            choice={c.alias}
                            on={c.id === current}
                            digit={i + 1}
                            onPick={(id) => pick(id, m)}
                            m={m}
                        />
                    ))}
                    <div className="mx-2 my-[5px] h-px bg-edge-mid" />
                    <SubmenuRow
                        name="effort"
                        label="Effort"
                        value={effort == null ? "" : effortChoice(effort).label}
                        m={m}
                    />
                    <SubmenuRow name="more" label="More models" value={olderLabel} m={m} />
                    <PopoverReveal open={m.sub === "effort"} origin="bottom left" className={cn(SUBMENU, "w-[260px]")}>
                        <div role="menu" aria-label="Effort" data-submenu="effort">
                            <EffortRows effort={effort} onPick={(level) => onPickEffort(level, m)} />
                        </div>
                    </PopoverReveal>
                    <PopoverReveal open={m.sub === "more"} origin="bottom left" className={cn(SUBMENU, "w-[200px]")}>
                        <div role="menu" aria-label="More models" data-submenu="more">
                            <div className={MENU_CAPTION}>More models</div>
                            {MORE_MODEL_CHOICES.map((c) => (
                                <ModelRow
                                    key={c.id}
                                    id={c.id}
                                    label={c.label}
                                    choice={c.id}
                                    on={c.id === current}
                                    onPick={(id) => pick(id, m)}
                                    m={m}
                                />
                            ))}
                        </div>
                    </PopoverReveal>
                </>
            )}
        />
    );
}

// Five bars rising left to right, the first `filled` in the accent: an effort level at a glance (0 = none)
function EffortMeter({ filled }: { filled: number }) {
    return (
        <svg width={17} height={13} viewBox="0 0 17 13" aria-hidden className="flex-none">
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

// the Effort submenu's rows: Claude Code's five levels, each with its meter and a note, then Auto
function EffortRows({ effort, onPick }: { effort: EffortLevel | null; onPick: (level: EffortLevel | "auto") => void }) {
    return (
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
                    onClick={() => onPick(c.level)}
                    className={row(c.level === effort)}
                >
                    <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-accent/10">
                        <EffortMeter filled={i + 1} />
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
                onClick={() => onPick("auto")}
                className={row(false)}
            >
                <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-surface-hover">
                    <EffortMeter filled={0} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="truncate">Auto</span>
                    <span className="truncate text-[11.5px] text-muted">The model's own default</span>
                </span>
                <span className="w-[14px] flex-none" />
            </button>
            <div className={MENU_FOOT}>Sends /effort to Claude Code</div>
        </>
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
                    title={`Permission mode (${formatChordString("Shift:Tab")} cycles it)`}
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
                            <ModelChip agent={agent} effort={effort} onPickEffort={pickEffort} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
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
