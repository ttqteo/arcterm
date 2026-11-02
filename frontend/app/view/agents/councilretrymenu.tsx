// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { ChevronDown } from "lucide-react";
import { retryModelChoices, retryModelLabel } from "./councilretry";

/** "Retry with…" beside a Retry button: a menu of the other models the failed call can run on once (the seat keeps its
 *  own). Nothing for a live agent's seat, which answers with its own session. */
export function RetryWithButton({
    expert,
    onPick,
    disabled,
    className,
}: {
    expert: CouncilExpert | null | undefined;
    onPick: (model: string) => void;
    disabled?: boolean;
    className?: string;
}) {
    const choices = retryModelChoices(expert);
    if (expert == null || choices.length === 0) {
        return null;
    }
    const open = (e: React.MouseEvent) => {
        ContextMenuModel.getInstance().showContextMenu(
            [
                { type: "header", label: `${expert.name} runs on ${expert.model || "its default"}` },
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
