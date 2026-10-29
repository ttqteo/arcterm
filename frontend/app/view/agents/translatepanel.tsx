// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Quick translate's panel (docs/superpowers/specs/2026-10-29-rail-translate-design.md): one narrow column like Google
// Translate's, the language row, the input, the word details and the translation. TranslateBody is that column on its
// own, so Float can show it too; TranslateRailPanel is its floating frame beside the nav rail (cockpitshell.tsx) and
// TranslateFloatPanel its frame over Float's terminal area (cockpit-root.tsx). The state is translatestore.ts, the pure
// parts translatemodel.ts.

import { MOTION } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowLeftRight, Check, CircleAlert, Copy, X } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { DETECT, LANGUAGES, swap, wordDetails, type SwapState } from "./translatemodel";
import {
    clearTranslate,
    closeTranslate,
    setPair,
    setTranslateText,
    swapTranslate,
    translateErrorAtom,
    translateOpenAtom,
    translatePairAtom,
    translateResultAtom,
    translateTextAtom,
} from "./translatestore";

const COPIED_MS = 1200;

const SELECT =
    "min-w-0 flex-1 cursor-pointer rounded-[7px] border border-edge-mid bg-surface-raised px-2 py-1 text-[12px] text-secondary hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const ICON_BTN =
    "flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted";

/** The column: language row, input, word details, translation (or the error line in its place). `onClose` runs on Esc. */
export function TranslateBody({ onClose }: { onClose: () => void }) {
    const pair = useAtomValue(translatePairAtom);
    const text = useAtomValue(translateTextAtom);
    const result = useAtomValue(translateResultAtom);
    const error = useAtomValue(translateErrorAtom);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    // opening puts the caret in the box, at the end of the text kept from last time
    useEffect(() => {
        const input = inputRef.current;
        if (input != null) {
            input.focus({ preventScroll: true });
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }, []);
    const [copied, setCopied] = useState(false);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (copiedTimer.current != null) {
                clearTimeout(copiedTimer.current);
            }
        },
        []
    );
    const translation = result?.translation ?? "";
    const copy = () => {
        navigator.clipboard.writeText(translation).then(
            () => {
                setCopied(true);
                if (copiedTimer.current != null) {
                    clearTimeout(copiedTimer.current);
                }
                copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
            },
            (err) => console.warn("copying the translation failed", err)
        );
    };
    // ⇄ is off while the swap would do nothing (Detect language with no language detected yet)
    const state: SwapState = { pair, input: text, result };
    const canSwap = swap(state) !== state;
    const details = wordDetails(text, result);
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        }
    };
    return (
        // data-owns-keys: a letter typed in the box, or Escape on the copy button, is the panel's, not a surface's
        <div data-translate-panel data-owns-keys onKeyDown={onKeyDown} className="flex min-h-0 flex-col gap-2 p-3">
            <div className="flex flex-none items-center gap-1.5">
                <select
                    data-translate-source
                    aria-label="Translate from"
                    value={pair.source}
                    onChange={(e) => setPair({ ...pair, source: e.target.value })}
                    className={SELECT}
                >
                    <option value={DETECT}>Detect language</option>
                    {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                            {l.name}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    data-translate-swap
                    aria-label="Swap languages"
                    title={canSwap ? "Swap languages" : "Swap languages (no language detected yet)"}
                    disabled={!canSwap}
                    onClick={swapTranslate}
                    className={ICON_BTN}
                >
                    <ArrowLeftRight size={14} strokeWidth={1.8} />
                </button>
                <select
                    data-translate-target
                    aria-label="Translate to"
                    value={pair.target}
                    onChange={(e) => setPair({ ...pair, target: e.target.value })}
                    className={SELECT}
                >
                    {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                            {l.name}
                        </option>
                    ))}
                </select>
            </div>
            <div className="relative flex-none">
                <textarea
                    ref={inputRef}
                    data-translate-input
                    aria-label="Text to translate"
                    spellCheck={false}
                    value={text}
                    placeholder="Type or paste text"
                    onChange={(e) => setTranslateText(e.target.value)}
                    className="field-sizing-content max-h-[200px] min-h-[84px] w-full resize-none rounded-[8px] border border-edge-mid bg-transparent py-2 pl-3 pr-8 text-[14px] leading-[20px] text-primary caret-primary outline-none placeholder:text-muted focus:border-edge-strong"
                />
                {text !== "" ? (
                    <button
                        type="button"
                        data-translate-clear
                        aria-label="Clear"
                        title="Clear"
                        onClick={() => {
                            clearTranslate();
                            inputRef.current?.focus({ preventScroll: true });
                        }}
                        className={cn(ICON_BTN, "absolute right-1.5 top-1.5")}
                    >
                        <X size={14} strokeWidth={1.8} />
                    </button>
                ) : null}
            </div>
            {details != null ? (
                <div
                    data-translate-details
                    className="flex flex-none flex-wrap items-center gap-x-1.5 px-1 text-[12px] text-muted"
                >
                    {details.map((d, i) => (
                        <Fragment key={i}>
                            {i > 0 ? <span aria-hidden="true">·</span> : null}
                            <span className={i === 0 ? "text-secondary" : undefined}>{d}</span>
                        </Fragment>
                    ))}
                </div>
            ) : null}
            {error != null ? (
                <div
                    role="status"
                    data-translate-error
                    className="flex flex-none items-start gap-2 rounded-[8px] bg-background px-3 py-2.5 text-[12px] leading-[18px] text-error-soft"
                >
                    <CircleAlert size={14} strokeWidth={2} className="mt-[2px] flex-none text-error" />
                    <span>{error}</span>
                </div>
            ) : (
                <div className="relative flex-none rounded-[8px] bg-background">
                    <div
                        data-translate-output
                        aria-live="polite"
                        className="max-h-[240px] min-h-[84px] overflow-y-auto whitespace-pre-wrap break-words py-2.5 pl-3 pr-8 text-[14px] leading-[20px] text-ink-hi"
                    >
                        {translation}
                    </div>
                    {translation !== "" ? (
                        <button
                            type="button"
                            data-translate-copy
                            data-copied={copied || undefined}
                            aria-label="Copy the translation"
                            title={copied ? "Copied" : "Copy the translation"}
                            onClick={copy}
                            className={cn(ICON_BTN, "absolute right-1.5 top-1.5")}
                        >
                            {copied ? (
                                <Check size={14} strokeWidth={2} className="text-success" />
                            ) : (
                                <Copy size={14} strokeWidth={1.8} />
                            )}
                        </button>
                    ) : null}
                </div>
            )}
        </div>
    );
}

// The panel slides out from the rail's edge. Opacity + x on the macro duration: motiontokens.ts' sheetPanel is this
// move for a drawer on the right edge; this one is pinned to the left. Entrance only, so closing is instant and an Esc
// or a click outside never leaves a fading panel over the surface.
const slideOut: Variants = {
    initial: { opacity: 0, x: -16 },
    animate: { opacity: 1, x: 0, transition: { duration: MOTION.durMacro, ease: MOTION.easeFluid } },
};

function RailFrame() {
    const frameRef = useRef<HTMLDivElement>(null);
    // whatever had the keyboard when the panel opened (a terminal, from the chord): Esc gives it back. Read while
    // rendering, since the body's own effect puts the caret in the box before any effect of this frame runs
    const [opener] = useState(() => document.activeElement as HTMLElement | null);
    useEffect(() => {
        // the rail's Translate button is outside the frame but toggles the panel itself: closing here first would
        // have its click open the panel again
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Element | null;
            if (target == null || frameRef.current?.contains(target) || target.closest("[data-nav-translate]")) {
                return;
            }
            closeTranslate();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            requestAnimationFrame(() => {
                const active = document.activeElement;
                if ((active == null || active === document.body) && opener?.isConnected && opener !== document.body) {
                    opener.focus({ preventScroll: true });
                }
            });
        };
    }, [opener]);
    return (
        <motion.div
            ref={frameRef}
            data-translate-rail
            variants={slideOut}
            initial="initial"
            animate="animate"
            className="absolute bottom-3 left-3 z-40 flex max-h-[calc(100%-24px)] w-[340px] max-w-[calc(100%-24px)] flex-col overflow-y-auto rounded-lg border border-edge-mid bg-surface shadow-popover"
        >
            <TranslateBody onClose={closeTranslate} />
        </motion.div>
    );
}

/** The rail's Translate panel: floats over the content area's left edge, beside the rail, while it is open. */
export function TranslateRailPanel() {
    const open = useAtomValue(translateOpenAtom);
    return open ? <RailFrame /> : null;
}

/** Float's Translate panel: the column over the terminal area, as the Note tab's body covers it (float-note.tsx), while
 *  it is open in Float (cockpit-root.tsx). The terminal stack stays mounted under it, so the terminal never refits or
 *  replays. Esc, the Translate tab, Ctrl+Shift+D and any change of focus close it. */
export function TranslateFloatPanel({ model }: { model: AgentsViewModel }) {
    const focusId = useAtomValue(model.focusIdAtom);
    // any change of focus closes the panel (a ledge tab, Ctrl+Tab, j/k…); compared with the focus it opened on
    const openedOn = useRef(focusId);
    useEffect(() => {
        if (focusId !== openedOn.current) {
            closeTranslate();
        }
    }, [focusId]);
    // the panel leaving gives the keyboard back to the terminal, unless a route (a ledge tab, the switcher) already
    // moved it
    const focusIdRef = useRef(focusId);
    focusIdRef.current = focusId;
    useEffect(
        () => () => {
            requestAnimationFrame(() => {
                const active = document.activeElement;
                if (active != null && active !== document.body) {
                    return;
                }
                const term = document.querySelector<HTMLElement>(
                    `[data-agent-terminal="${focusIdRef.current}"] .xterm-helper-textarea`
                );
                if (term?.checkVisibility()) {
                    term.focus({ preventScroll: true });
                }
            });
        },
        []
    );
    return (
        <div data-translate-float className="absolute inset-0 overflow-y-auto bg-surface">
            <div className="mx-auto w-full max-w-[640px]">
                <TranslateBody onClose={closeTranslate} />
            </div>
        </div>
    );
}
