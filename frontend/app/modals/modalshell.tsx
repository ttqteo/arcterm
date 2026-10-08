// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Shared shell for the cockpit overlays (New Agent, New Project, Command Palette, Keyboard shortcuts).
// Owns the backdrop scrim, the panel, open/close motion (AnimatePresence + motiontokens), the Esc
// listener, focus (modalfocus.ts), and the optional backdrop-click dismiss. Reduced-motion drops the
// scale, keeps the fade.

import { modalBackdrop, modalPanel, sheetPanel } from "@/app/element/motiontokens";
import { shellOwnsEscape, takeModalFocus } from "@/app/modals/modalfocus";
import { isTopModal, registerModal } from "@/app/modals/modalstack";
import { cn } from "@/util/util";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export type ModalVariant = "dialog" | "sheet";

// One named composition per shape rather than four independent override props whose combinations
// nobody would test. Two of these differences are behavior, not styling: a sheet is `absolute` at
// z-20 so it stays scoped to the surface that owns it, leaving the app bar reachable and surfaces
// switchable while it is open. A fixed z-70 detail sheet would cover the cockpit chrome.
const BACKDROP: Record<ModalVariant, string> = {
    dialog: "fixed inset-0 z-[70] flex justify-center bg-black/60 backdrop-blur-sm",
    sheet: "absolute inset-0 z-20 flex items-stretch justify-end bg-background/40",
};

const PANEL: Record<ModalVariant, string> = {
    dialog: "overflow-hidden rounded-[14px] border border-edge-strong bg-modalbg shadow-popover outline-none",
    sheet: "overflow-hidden rounded-none border-l border-edge-faint bg-surface shadow-popover outline-none",
};

interface ModalShellProps {
    open: boolean;
    onClose: () => void; // Esc + (optional) backdrop click
    onSubmit?: () => void; // Cmd/Ctrl+Enter primary action; no-op when unset
    className?: string; // panel width / max-height, per modal
    align?: "top" | "center"; // vertical placement; default "top" (topClass offset). "center" for alerts.
    topClass?: string; // backdrop top offset when align="top"; default pt-[11vh]
    dismissOnBackdrop?: boolean; // default true
    variant?: ModalVariant; // "dialog" (centered, default) or "sheet" (right-pinned, surface-scoped)
    children: ReactNode;
}

export function ModalShell({
    open,
    onClose,
    onSubmit,
    className,
    align = "top",
    topClass = "pt-[11vh]",
    dismissOnBackdrop = true,
    variant = "dialog",
    children,
}: ModalShellProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const shellId = useId();
    // Registration and focus-taking are one effect, not two: closing must check "am I still the top
    // modal" before popping this shell off the stack, and only the shell's own cleanup pops it. Splitting
    // that check into a second effect would make the answer depend on which effect's cleanup React
    // happens to run first (React runs a component's own effect cleanups in declaration order, so a
    // second effect can't reliably observe pre-pop state) — one effect makes the ordering unambiguous.
    // This also registers before the key listener below runs, so a shell that opens in the same commit as
    // another is already in the stack when that listener first fires.
    //
    // Focus is only taken when this shell is topmost at open (Escape has the analogous isTopModal guard
    // in the key listener below) — runs after the children's own effects and after React has applied any
    // child autoFocus, so a modal with a text field keeps it.
    useEffect(() => {
        if (!open) {
            return;
        }
        const unregister = registerModal(shellId);
        const restore = isTopModal(shellId)
            ? takeModalFocus(panelRef.current, document.activeElement as HTMLElement | null)
            : null;
        return () => {
            const wasTop = isTopModal(shellId);
            unregister();
            if (wasTop) {
                restore?.();
            }
        };
    }, [open, shellId]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            // only the topmost open shell owns the keyboard. Without this, every mounted shell's
            // listener fires and Escape over a stacked pair dismisses both at once.
            if (!isTopModal(shellId)) {
                return;
            }
            if (e.key === "Escape") {
                // a popover portaled out of the panel closes itself; the dialog under it stays
                if (!shellOwnsEscape(panelRef.current, e.target, document.body)) {
                    return;
                }
                onClose();
            } else if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSubmit();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose, onSubmit, shellId]);

    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence>
                {open && (
                    <motion.div
                        key="backdrop"
                        variants={modalBackdrop}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={cn(
                            BACKDROP[variant],
                            // align/topClass position a centered dialog; a sheet is pinned by the map above
                            variant === "dialog" &&
                                (align === "center" ? "items-center p-10" : cn("items-start", topClass))
                        )}
                        onMouseDown={
                            dismissOnBackdrop
                                ? (e) => {
                                      if (e.target === e.currentTarget) {
                                          onClose();
                                      }
                                  }
                                : undefined
                        }
                    >
                        <motion.div
                            ref={panelRef}
                            variants={variant === "sheet" ? sheetPanel : modalPanel}
                            role="dialog"
                            aria-modal="true"
                            tabIndex={-1} // focus target for a dialog with no field of its own (alerts, the cheatsheet)
                            onMouseDown={(e) => e.stopPropagation()}
                            className={cn(PANEL[variant], className)}
                        >
                            {children}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </MotionConfig>
    );
}
