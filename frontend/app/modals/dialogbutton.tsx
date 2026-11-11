// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Shared modal footer button (Canvas-13 dialog style). One styling for both the ConfirmDialog
// alert family and the migrated form footers, so every modal's actions look the same.
//   secondary — cancel / dismiss (neutral raised surface)
//   primary   — the accent CTA (solid blue), used for confirm/save on non-destructive dialogs
//   danger    — the tinted-red CTA for destructive confirms

import { cn } from "@/util/util";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type DialogButtonVariant = "secondary" | "primary" | "danger";

const VARIANTS: Record<DialogButtonVariant, string> = {
    secondary:
        "border-edge-strong bg-surface-hover text-secondary font-semibold hover:bg-surface-selected hover:text-primary",
    primary: "border-accent bg-accent text-background font-bold hover:bg-accent-300 hover:border-accent-300",
    danger: "border-error/40 bg-error/15 text-error-soft font-bold hover:bg-error/25 hover:border-error",
};

interface DialogButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: DialogButtonVariant;
    hint?: string; // small key-hint chip, from formatChordString: "Enter", "Esc"
    children: ReactNode;
}

export function DialogButton({
    variant = "secondary",
    hint,
    className,
    children,
    type = "button",
    ...rest
}: DialogButtonProps) {
    return (
        <button
            type={type}
            className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border px-[15px] py-2 text-[13px] leading-none transition-[background-color,border-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-45",
                VARIANTS[variant],
                className
            )}
            {...rest}
        >
            {children}
            {hint && <kbd className="ml-0.5 font-mono text-[10px] font-normal opacity-55">{hint}</kbd>}
        </button>
    );
}
