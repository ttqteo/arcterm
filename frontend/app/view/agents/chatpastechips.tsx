// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The long pastes folded out of Chat's box (chatpastes.ts), drawn as chips over the text the way an attachment is
// (attachmenttray.tsx's chip). A click opens the paste over the box in the frosted panel the `/` list uses, to read it
// whole, put it back in the text (Edit in box) or close it; × drops it. They go after the message, written out.

import { springPop } from "@/app/element/motiontokens";
import {
    autoUpdate,
    FloatingPortal,
    offset,
    shift,
    size,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { Clipboard, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { pasteSize } from "./chatpastes";

export function PasteChips({
    pastes,
    frame,
    onRemove,
    onUnfold,
}: {
    pastes: string[];
    /** the message box: the open paste stands over it, as wide as it is */
    frame: RefObject<HTMLElement | null>;
    onRemove: (i: number) => void;
    /** puts the paste back in the text */
    onUnfold: (i: number) => void;
}) {
    const [open, setOpen] = useState<number | null>(null);
    // a paste gone (sent, removed, unfolded) closes its panel
    useEffect(() => {
        if (open != null && open >= pastes.length) {
            setOpen(null);
        }
    }, [open, pastes.length]);
    if (pastes.length === 0) {
        return null;
    }
    const shown = open != null ? pastes[open] : null;
    return (
        <div data-chat-pastes="" className="flex min-w-0 flex-wrap gap-1.5">
            {pastes.map((p, i) => (
                <div
                    key={i}
                    data-chat-paste-chip=""
                    className="flex items-center gap-1.5 rounded-[6px] border border-edge-mid bg-background px-2 py-1 text-[11px] text-secondary"
                >
                    <button
                        type="button"
                        onClick={() => setOpen(open === i ? null : i)}
                        title="Show the pasted text"
                        aria-expanded={open === i}
                        className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <Clipboard size={12} aria-hidden className="flex-none" />
                        <span className="text-primary">Pasted text</span>
                        <span className="tabular-nums text-muted">{pasteSize(p)}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onRemove(i)}
                        title="Remove pasted text"
                        aria-label="Remove pasted text"
                        className="flex-none cursor-pointer text-muted hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <X size={12} />
                    </button>
                </div>
            ))}
            <AnimatePresence>
                {shown != null && open != null ? (
                    <PastePanel
                        key="paste-panel"
                        paste={shown}
                        frame={frame}
                        onClose={() => setOpen(null)}
                        onUnfold={() => {
                            setOpen(null);
                            onUnfold(open);
                        }}
                    />
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function PastePanel({
    paste,
    frame,
    onClose,
    onUnfold,
}: {
    paste: string;
    frame: RefObject<HTMLElement | null>;
    onClose: () => void;
    onUnfold: () => void;
}) {
    const { refs, floatingStyles, context } = useFloating({
        open: true,
        onOpenChange: (o) => !o && onClose(),
        placement: "top-start",
        strategy: "fixed",
        middleware: [
            offset(8),
            shift({ padding: 8 }),
            size({
                padding: 8,
                apply({ rects, availableHeight, elements }) {
                    elements.floating.style.width = `${rects.reference.width}px`;
                    elements.floating.style.setProperty("--paste-max-h", `${Math.min(420, availableHeight)}px`);
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    useEffect(() => {
        refs.setReference(frame.current);
    }, [refs, frame]);
    // the panel takes the focus as it opens, so its Esc is its own
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        panelRef.current?.focus({ preventScroll: true });
    }, []);
    // Esc is the panel's own (below), so the box's Esc (stop the turn) is not pressed with it
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        }
    };
    return (
        <FloatingPortal>
            <div ref={refs.setFloating} style={floatingStyles} className="z-[80]" {...getFloatingProps()}>
                <motion.div
                    role="dialog"
                    aria-label="Pasted text"
                    tabIndex={-1}
                    data-owns-keys
                    data-chat-paste-panel=""
                    onKeyDown={onKeyDown}
                    ref={panelRef}
                    variants={springPop}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    style={{ originX: 0, originY: 1 }}
                    className="flex max-h-[var(--paste-max-h,420px)] flex-col overflow-hidden rounded-[16px] border border-edge-mid frost shadow-popover-soft focus:outline-none"
                >
                    <div className="flex flex-none items-center gap-2.5 border-b border-edge-mid px-3 py-2 text-[12px]">
                        <span className="font-medium text-primary">Pasted text</span>
                        <span className="min-w-0 truncate tabular-nums text-muted">
                            {pasteSize(paste)} · goes after your message
                        </span>
                        <span className="flex-1" />
                        <button
                            type="button"
                            onClick={onUnfold}
                            className="flex-none cursor-pointer rounded-[6px] border border-edge-mid px-2 py-0.5 text-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            Edit in box
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            title="Close (Esc)"
                            aria-label="Close"
                            className="flex flex-none cursor-pointer p-0.5 text-muted hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[12px] leading-[1.55] text-secondary [overflow-wrap:anywhere]">
                        {paste}
                    </pre>
                </motion.div>
            </div>
        </FloatingPortal>
    );
}
