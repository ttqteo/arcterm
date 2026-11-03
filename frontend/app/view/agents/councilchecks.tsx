// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How a check label looks (Ran, Disproved, Read code, Guess, and the Wrong cite mark on a chip): its icon and its colours,
// in one table, so the Map's legend, cards and badges (councilmap.tsx) and the evidence chips of the Discussion and the
// Report draw the same mark. Status is never colour alone: the mark is an icon, and the word always sits beside it. The
// words are councilmodel.ts's (`checkWord`, `wrongCiteWord`), in the council's language. A leaf module on purpose: it
// imports no council view, so any of them may import it.

import { cn } from "@/util/util";
import { Check, CircleHelp, FileText, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { CheckLabel } from "./councilmodel";
import type { ClaimBadge, WrongCite } from "./councilsources";

/** The icon of each label: a tick for Ran, a cross for Disproved, a page for Read code, a question mark for Guess. */
export const CHECK_ICON: Record<CheckLabel, LucideIcon> = {
    ran: Check,
    disproved: X,
    read: FileText,
    guess: CircleHelp,
};

/** The classes of each label: `badge` the tinted fill with its text (a badge, a chip), `bar` the solid fill of its segment
 *  on the evidence bar, `text` the text colour alone (a count, a legend icon). The tokens are the status ones, so a theme
 *  recolours them. */
export const CHECK_TONE: Record<CheckLabel, { badge: string; bar: string; text: string }> = {
    ran: { badge: "bg-success/12 text-success-soft", bar: "bg-success", text: "text-success-soft" },
    disproved: { badge: "bg-error/12 text-error-soft", bar: "bg-error", text: "text-error-soft" },
    read: { badge: "bg-pill text-secondary", bar: "bg-secondary", text: "text-secondary" },
    guess: { badge: "bg-warning/12 text-warning-soft", bar: "bg-warning", text: "text-warning-soft" },
};

/** The mark of a cite Go found wrong: a warning triangle in the error colours. */
export const WRONG_CITE_ICON = TriangleAlert;
export const WRONG_CITE_TONE = { badge: "bg-error/12 text-error-soft", text: "text-error-soft" };

/** A label's icon, decorative (the word beside it says it). */
export function CheckIcon({ label, size = 12, className }: { label: CheckLabel; size?: number; className?: string }) {
    const Icon = CHECK_ICON[label];
    return (
        <Icon size={size} strokeWidth={label === "ran" ? 2.4 : 2} aria-hidden className={cn("flex-none", className)} />
    );
}

/** The badge of a claim in an evidence row (the Discussion's chips, the Report's positions): the label's icon and word on
 *  its tint, what the word means on hover. `className` sets the size to the row it sits in. */
export function ClaimBadgeChip({ badge, className }: { badge: ClaimBadge; className?: string }) {
    return (
        <span
            data-council-evidence="badge"
            data-check={badge.label}
            title={badge.meaning}
            className={cn(
                "inline-flex h-[24px] flex-none items-center gap-[5px] whitespace-nowrap rounded-[6px] px-[8px] text-[12.5px] font-semibold",
                CHECK_TONE[badge.label].badge,
                className
            )}
        >
            <CheckIcon label={badge.label} />
            {badge.word}
        </span>
    );
}

/** A cite Go found wrong, as a chip: the warning icon, `Wrong cite`, the file and lines, and Go's note on why. It wraps
 *  like the weak chip, since the note is a sentence. */
export function WrongCiteChip({ cite, className }: { cite: WrongCite; className?: string }) {
    return (
        <span
            data-council-evidence="wrong"
            data-wrong-ref={cite.ref}
            title={cite.note === "" ? cite.ref : `${cite.ref}\n${cite.note}`}
            className={cn(
                "inline-flex h-auto min-h-[24px] min-w-0 max-w-[520px] items-center gap-[5px] rounded-[6px] border border-error/40 px-[7px] py-[3px] text-[12.5px] leading-[1.4]",
                WRONG_CITE_TONE.badge,
                className
            )}
        >
            <WRONG_CITE_ICON size={12} aria-hidden className="flex-none" />
            <span className="flex-none font-semibold">{cite.word}</span>
            <span data-wrong-name className="min-w-0 break-all tabular-nums">
                {cite.name}
                {cite.label}
            </span>
            {cite.note !== "" && <span data-wrong-note className="min-w-0">{`· ${cite.note}`}</span>}
        </span>
    );
}
