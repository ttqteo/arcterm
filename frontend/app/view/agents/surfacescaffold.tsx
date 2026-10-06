// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Shared surface chrome — the single source of truth for cockpit surface headers, empty states, and
// load-error banners. Modeled on the original cockpit header + CockpitEmptyState.
// See docs/superpowers/specs/2026-07-14-cross-surface-consistency-scaffold-design.md.

import { cardVariants } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { motion } from "motion/react";
import type { ReactNode } from "react";

// the Cockpit draws its title on its own row beside the status tabs, so the type is shared, not the header
export const SURFACE_TITLE_CLASS = "text-[25px] font-bold tracking-[-0.02em] text-primary";

export function SurfaceHeader({
    title,
    badge,
    subtitle,
    actions,
    border = true,
    compact = false,
}: {
    title: string;
    badge?: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
    border?: boolean;
    // one tight row, the subtitle inline after the title: for a surface whose body needs the height
    // (Code, an editor under its own sidebar)
    compact?: boolean;
}) {
    if (compact) {
        return (
            <div
                className={cn(
                    "flex h-[42px] flex-none items-center justify-between gap-4 bg-background pl-4 pr-3",
                    border && "border-b border-border"
                )}
            >
                <div className="flex min-w-0 items-baseline gap-2.5">
                    <h1 className="flex-none text-[15px] font-semibold tracking-[-0.01em] text-primary">{title}</h1>
                    {badge}
                    {subtitle != null ? (
                        <div className="min-w-0 truncate text-[12px] text-muted">{subtitle}</div>
                    ) : null}
                </div>
                {actions != null ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
            </div>
        );
    }
    return (
        <div
            className={cn(
                "flex flex-none items-start justify-between gap-5 bg-background px-[28px] pb-4 pt-5",
                border && "border-b border-border"
            )}
        >
            <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                    <h1 className={SURFACE_TITLE_CLASS}>{title}</h1>
                    {badge}
                </div>
                {subtitle != null ? <div className="mt-1 text-[13px] text-secondary">{subtitle}</div> : null}
            </div>
            {actions != null ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
        </div>
    );
}

// className exists for one reason: the Jarvis Stage stacks this directly above and below bands that all
// share one gutter (jarvis/stagemeasure.ts), and px-[30px] put it 6px right of every one of them. A
// surface that owns its own horizontal measure passes it in; everyone else keeps the default.
// children sit between the body and the buttons, for a state that has to show what it is working on
// (Radar's collector list). secondaryAction sits beside the primary, or alone when a state has no
// accent action to offer.
export function SurfaceEmptyState({
    glyph,
    title,
    body,
    action,
    secondaryAction,
    children,
    className,
}: {
    glyph?: ReactNode;
    title: string;
    body?: ReactNode;
    action?: { label: ReactNode; onClick: () => void; hint?: ReactNode; disabled?: boolean };
    secondaryAction?: { label: ReactNode; onClick: () => void };
    children?: ReactNode;
    className?: string;
}) {
    return (
        <motion.div
            key="empty"
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn(
                "flex h-full w-full flex-col items-center justify-center px-[30px] py-12 text-center",
                className
            )}
        >
            <div className="flex w-full max-w-[600px] flex-col items-center">
                {glyph}
                <h2 className="mb-2.5 text-[25px] font-bold tracking-[-0.02em] text-primary">{title}</h2>
                {body != null ? (
                    <div className="mb-[30px] max-w-[400px] text-[14px] leading-[1.6] text-muted">{body}</div>
                ) : null}
                {children != null ? <div className="mb-[26px] w-full">{children}</div> : null}
                {action != null || secondaryAction != null ? (
                    <div className="flex items-center gap-2.5">
                        {action != null ? (
                            <motion.button
                                type="button"
                                onClick={action.onClick}
                                disabled={action.disabled}
                                whileHover={{ y: -1 }}
                                whileTap={{ y: 0 }}
                                style={{
                                    boxShadow:
                                        "0 14px 34px color-mix(in srgb, var(--color-accent) 34%, transparent), var(--shadow-inset-highlight)",
                                }}
                                className="flex cursor-pointer items-center gap-[11px] rounded-lg bg-accent px-[26px] py-3.5 text-[15px] font-bold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50"
                            >
                                {action.label}
                            </motion.button>
                        ) : null}
                        {secondaryAction != null ? (
                            <button
                                type="button"
                                onClick={secondaryAction.onClick}
                                className="cursor-pointer rounded-lg border border-edge-mid bg-surface-raised px-4 py-2.5 text-[13px] font-semibold text-secondary hover:border-edge-strong"
                            >
                                {secondaryAction.label}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {action?.hint != null ? <div className="mt-[18px] text-[12.5px] text-muted">{action.hint}</div> : null}
            </div>
        </motion.div>
    );
}

// actionLabel exists because not every recoverable state is a retry: the Code surface refuses a save
// when the file changed underneath, and there the button reloads rather than re-attempts.
export function SurfaceError({
    message,
    onRetry,
    actionLabel = "Retry",
}: {
    message: string;
    onRetry?: () => void;
    actionLabel?: string;
}) {
    return (
        <div className="mx-[28px] mt-3 flex items-center gap-3 rounded-[10px] border border-error/40 bg-error/10 px-3.5 py-2.5 text-[12.5px] text-error">
            <span className="flex-1">{message}</span>
            {onRetry != null ? (
                <button
                    type="button"
                    onClick={onRetry}
                    className="flex-none cursor-pointer rounded border border-error/40 px-2 py-0.5 font-semibold hover:bg-error/15"
                >
                    {actionLabel}
                </button>
            ) : null}
        </div>
    );
}
