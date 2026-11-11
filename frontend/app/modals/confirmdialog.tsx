// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The canonical alert/confirm dialog (Canvas-13 design). Renders inside ModalShell so it shares the
// one cockpit chrome (scrim, blur, entrance motion, Esc). Layout: a tone-tinted icon square + title
// + muted body, and a right-aligned Cancel + tone CTA footer.
//
// Keyboard: Enter confirms, Esc cancels (Esc is owned by ModalShell). There is no text input in this
// layout, so plain Enter is unambiguous. Omit cancelLabel for a single-button acknowledgement.
// Both listeners are window/bubble, which only reaches them because ModalShell pulls focus into the
// panel — with focus left in an xterm, xterm's handler stops the keydown before it ever bubbles.

import type { ConfirmHow } from "@/app/view/agents/closelog";
import { formatChordString } from "@/util/keysym";
import { cn, makeIconClass } from "@/util/util";
import { useEffect, useRef, type ReactNode } from "react";
import { DialogButton } from "./dialogbutton";
import { ModalShell } from "./modalshell";

type ConfirmTone = "danger" | "warning" | "info";

const TONE: Record<ConfirmTone, { icon: string; square: string }> = {
    danger: { icon: "triangle-exclamation", square: "bg-error/12 border-error/30 text-error" },
    warning: { icon: "triangle-exclamation", square: "bg-warning/12 border-warning/30 text-warning" },
    info: { icon: "circle-info", square: "bg-accent/12 border-accent/30 text-accent" },
};

interface ConfirmDialogProps {
    open?: boolean; // default true; forward to ModalShell so a caller can animate exit
    tone?: ConfirmTone; // default "info"
    icon?: ReactNode; // overrides the tone default
    title?: string;
    body: ReactNode;
    confirmLabel?: string; // default "OK"
    cancelLabel?: string; // omit for a single-button dialog
    confirmDisabled?: boolean;
    altLabel?: string; // a lesser second action beside the CTA; mouse only, Enter stays the CTA's
    onAlt?: () => void;
    // how: Enter or a click, and the ms since the dialog opened (a destructive caller logs it)
    onConfirm: (how: ConfirmHow) => void;
    onClose: () => void;
}

export function ConfirmDialog({
    open = true,
    tone = "info",
    icon,
    title,
    body,
    confirmLabel = "OK",
    cancelLabel,
    confirmDisabled,
    altLabel,
    onAlt,
    onConfirm,
    onClose,
}: ConfirmDialogProps) {
    const openedAt = useRef(Date.now());
    useEffect(() => {
        if (open) {
            openedAt.current = Date.now();
        }
    }, [open]);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !confirmDisabled) {
                e.preventDefault();
                onConfirm({ via: "enter", afterMs: Date.now() - openedAt.current });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onConfirm, confirmDisabled]);

    const t = TONE[tone];
    return (
        <ModalShell open={open} onClose={onClose} align="center" className="w-full max-w-[440px]">
            <div className="px-[22px] pt-[22px] pb-[18px]">
                <div className="flex items-start gap-3.5">
                    <div
                        className={cn(
                            "mt-px flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border",
                            t.square
                        )}
                    >
                        {icon ?? <i className={makeIconClass(t.icon, true) + " text-[15px]"} />}
                    </div>
                    <div className="min-w-0 flex-1">
                        {title && (
                            <h2 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] text-primary">
                                {title}
                            </h2>
                        )}
                        <div
                            className={cn("text-[13.5px] leading-[1.55] text-ink-mid text-pretty", title && "mt-[7px]")}
                        >
                            {body}
                        </div>
                    </div>
                </div>
                <div className="mt-[22px] flex justify-end gap-2.5">
                    {cancelLabel && (
                        <DialogButton variant="secondary" hint={formatChordString("Escape")} onClick={onClose}>
                            {cancelLabel}
                        </DialogButton>
                    )}
                    {altLabel && onAlt && (
                        <DialogButton variant="secondary" onClick={onAlt}>
                            {altLabel}
                        </DialogButton>
                    )}
                    <DialogButton
                        variant={tone === "danger" ? "danger" : "primary"}
                        hint={formatChordString("Enter")}
                        disabled={confirmDisabled}
                        onClick={() => onConfirm({ via: "click", afterMs: Date.now() - openedAt.current })}
                    >
                        {confirmLabel}
                    </DialogButton>
                </div>
            </div>
        </ModalShell>
    );
}
