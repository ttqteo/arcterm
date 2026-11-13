// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The peek header's Hide (a click on Jarvis opens the peek, and this is where Jarvis is put away): hide it for an hour,
// till the next 8:00, or for a typed time, read the way the folded Sprout's "Don't fold for" reads one (foldpause.ts
// parsePauseText), with the end the hide would have said as you type. Picking one closes the peek, so you watch Jarvis
// go (petview.tsx draws the exit).
//
// Built as the stay pin beside it is (petpeek.tsx PetStayPin): a portaled menu with its own transparent backdrop, and
// Escape stopped here so the peek's own Escape does not close the peek over an open menu.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { cn } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { Clock, EyeOff, Moon, Timer } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { HIDE_FOR_LABEL, hideChoices, typedHide, type HideChoice } from "./pethide";
import { hideJarvis } from "./pethidestore";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const ROW =
    "flex h-7 w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 text-left text-[12px] text-primary outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent";

const CHOICE_ICON: Record<HideChoice["key"], typeof Clock> = { hour: Timer, morning: Moon };

/** The Hide button in the peek's header. `onHidden` closes the peek once a hide is written. */
export function PetHideButton({ onHidden }: { onHidden: () => void }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const menuRef = useRef<HTMLDivElement | null>(null);
    const triggerId = useId();
    const { refs, floatingStyles } = useFloating({
        open,
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    const now = Date.now();
    const typed = typedHide(text, now);
    const close = () => {
        setOpen(false);
        setText("");
        // the menu unmounts with its focus in it: put it back in the dialog, or it falls to the body
        (refs.domReference.current as HTMLElement | null)?.focus();
    };
    const hide = (until: number) => {
        setOpen(false);
        setText("");
        hideJarvis(until);
        onHidden();
    };

    useEffect(() => {
        if (open) {
            menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
        }
    }, [open]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!open) {
            return;
        }
        if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-pet-hide-row]") ?? []);
            if (rows.length === 0) {
                return;
            }
            const at = rows.indexOf(document.activeElement as HTMLElement);
            rows[(at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length].focus();
            return;
        }
        // the peek reads letters as its own keys (j, k, Enter…): what is typed in the box stays in the box
        event.stopPropagation();
    };

    return (
        <div className="flex flex-none" onKeyDown={onKeyDown}>
            <button
                ref={refs.setReference}
                id={triggerId}
                type="button"
                data-pet-hide-button
                aria-label="Hide Jarvis for a while"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => (open ? close() : setOpen(true))}
                className={cn(
                    "flex h-7 w-7 flex-none items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary",
                    open && "bg-surface-hover text-primary",
                    FOCUS_RING
                )}
            >
                <EyeOff aria-hidden="true" size={14} strokeWidth={2} />
            </button>
            <FloatingPortal>
                {open ? <div data-pet-hide-backdrop className="fixed inset-0 z-[80]" onClick={() => close()} /> : null}
                {/* above the peek's z-[65]; rendered always and driven by `open` so PopoverReveal's exit plays */}
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    data-mini-hit={open ? "chat" : undefined}
                    className="z-[81]"
                >
                    <PopoverReveal
                        open={open}
                        origin="top right"
                        className="w-[232px] rounded-[10px] border border-edge-mid bg-surface-raised p-[4px] shadow-popover-md"
                    >
                        <div ref={menuRef} role="menu" aria-labelledby={triggerId} data-pet-hide-menu>
                            {hideChoices(now).map((c) => {
                                const Icon = CHOICE_ICON[c.key];
                                return (
                                    <button
                                        key={c.key}
                                        type="button"
                                        role="menuitem"
                                        data-pet-hide={c.key}
                                        data-pet-hide-row
                                        // the time is read at the click, not when the menu opened
                                        onClick={() =>
                                            hide(hideChoices(Date.now()).find((n) => n.key === c.key)!.until)
                                        }
                                        className={ROW}
                                    >
                                        <Icon
                                            aria-hidden="true"
                                            size={12}
                                            strokeWidth={2}
                                            className="flex-none text-muted"
                                        />
                                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                    </button>
                                );
                            })}
                            <div className="mx-1 my-[4px] h-px bg-edge-mid" aria-hidden />
                            <form
                                data-pet-hide-box
                                className="flex flex-col gap-1 px-1 pb-1 pt-0.5"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    const t = typedHide(text, Date.now());
                                    if (t != null) {
                                        hide(t.until);
                                    }
                                }}
                            >
                                <div className="flex h-7 items-center gap-1.5 rounded-[6px] border border-edge-mid bg-surface px-1.5 focus-within:border-accent">
                                    <Clock size={12} strokeWidth={2} className="flex-none text-muted" aria-hidden />
                                    <input
                                        data-pet-hide-input
                                        data-pet-hide-row
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        placeholder={`${HIDE_FOR_LABEL} 2h, 30m, 14:30`}
                                        aria-label="Hide Jarvis for a while, or until a time"
                                        className="min-w-0 flex-1 bg-transparent text-[12px] text-primary outline-none placeholder:text-muted"
                                    />
                                </div>
                                <span data-pet-hide-until className="px-0.5 text-[11px] text-muted">
                                    {typed != null
                                        ? `Hidden until ${typed.label} · Enter`
                                        : text.trim() === ""
                                          ? "A length or a time, up to 7 days"
                                          : "Not a length or a time"}
                                </span>
                            </form>
                        </div>
                    </PopoverReveal>
                </div>
            </FloatingPortal>
        </div>
    );
}
