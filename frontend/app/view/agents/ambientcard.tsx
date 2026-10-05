// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Shared chrome for the ambient cards. Three surfaces render "here is something related, but it is
// not a confirmed edge": S3's proactive suggestion, E's continuity resume, and D's relevant past
// decisions. The first two are the same object — a single dismissible card — and share AmbientCard
// whole. The decisions block is a list with no dismiss affordance, so it borrows only the box and
// eyebrow tokens rather than being bent into the shell; over-configuring one component to cover both
// shapes would cost more than the duplication it removes.

import { cn } from "@/util/util";

// The ambient surface treatment: recessed panel, never the emphasis of the row it sits in.
export const AMBIENT_BOX = "rounded-[9px] border border-border bg-surface px-3 py-2";
export const AMBIENT_EYEBROW = "text-[9px] font-semibold uppercase tracking-[.08em] text-muted";

type AmbientCardProps = {
    eyebrow: React.ReactNode;
    dismissLabel: string;
    onDismiss: () => void;
    children: React.ReactNode;
    // when set, the card body becomes a real button (S3 deep-link); the dismiss × stays a
    // sibling so the two never nest.
    onClick?: () => void;
};

export function AmbientCard({ eyebrow, dismissLabel, onDismiss, children, onClick }: AmbientCardProps) {
    const body = (
        <>
            <div className={cn("mb-0.5", AMBIENT_EYEBROW)}>{eyebrow}</div>
            {children}
        </>
    );
    return (
        <div className={cn("mb-3 flex items-start gap-2", AMBIENT_BOX)}>
            {onClick != null ? (
                <button type="button" onClick={onClick} className="min-w-0 flex-1 cursor-pointer text-left">
                    {body}
                </button>
            ) : (
                <div className="min-w-0 flex-1">{body}</div>
            )}
            <button
                type="button"
                aria-label={dismissLabel}
                onClick={onDismiss}
                className="flex-none rounded-[4px] px-1.5 py-px text-[13px] leading-none text-muted hover:text-secondary"
            >
                ×
            </button>
        </div>
    );
}
