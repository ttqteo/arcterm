// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { ChevronDown } from "lucide-react";
import { isSafeguardFlag, retryModelChoices, retryModelLabel } from "./councilretry";

/** "Retry with…" beside a Retry button: a menu of the other models the failed call can run on once (the seat keeps its
 *  own). A call the safeguards flagged offers Opus 4.8 first, as Claude Code falls back to it. Nothing for a live
 *  agent's seat, which answers with its own session. */
export function RetryWithButton({
    expert,
    error,
    onPick,
    disabled,
    className,
}: {
    expert: CouncilExpert | null | undefined;
    error?: string; // the failed call's error, which says whether the safeguards flagged it
    onPick: (model: string) => void;
    disabled?: boolean;
    className?: string;
}) {
    const choices = retryModelChoices(expert, error);
    if (expert == null || choices.length === 0) {
        return null;
    }
    const open = (e: React.MouseEvent) => {
        ContextMenuModel.getInstance().showContextMenu(
            [
                {
                    type: "header",
                    label: isSafeguardFlag(error)
                        ? `Safeguards flagged ${expert.name} on ${expert.model || "its default"}`
                        : `${expert.name} runs on ${expert.model || "its default"}`,
                },
                ...choices.map((m) => ({ label: retryModelLabel(m), click: () => onPick(m) })),
            ],
            e
        );
    };
    return (
        <button
            type="button"
            data-council-retry-with={expert.id}
            aria-haspopup="menu"
            aria-label={`Retry ${expert.name} on another model`}
            title="Run this call once on another model; the seat keeps its own"
            disabled={disabled}
            onClick={open}
            className={cn("inline-flex items-center gap-[3px]", className)}
        >
            Retry with…
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </button>
    );
}
