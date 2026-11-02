// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { ChevronDown } from "lucide-react";
import { isSafeguardFlag, modelName, retryModelChoices, retryModelLabel } from "./councilretry";

/** A failed seat's model for Retry all, when several seats failed: it only picks, and Retry all runs them together (one
 *  Retry each would be refused while the first runs). Its own model is first and the default. Nothing for a live
 *  agent's seat, which answers with its own session. */
export function RetryModelPick({
    expert,
    error,
    picked,
    onPick,
    disabled,
    className,
}: {
    expert: CouncilExpert | null | undefined;
    error?: string;
    picked: string | undefined; // the model Retry all runs this seat on; unset is its own
    onPick: (model: string | undefined) => void;
    disabled?: boolean;
    className?: string;
}) {
    const choices = retryModelChoices(expert, error);
    if (expert == null || choices.length === 0) {
        return null;
    }
    const own = expert.model || "its default";
    const current = picked != null && choices.includes(picked) ? picked : undefined;
    const open = (e: React.MouseEvent) => {
        ContextMenuModel.getInstance().showContextMenu(
            [
                {
                    type: "header",
                    label: isSafeguardFlag(error)
                        ? `Safeguards flagged ${expert.name} on ${own}`
                        : `Retry all runs ${expert.name} on`,
                },
                { label: `Its own (${own})`, type: "radio", checked: current == null, click: () => onPick(undefined) },
                ...choices.map((m) => ({
                    label: modelName(m),
                    type: "radio" as const,
                    checked: current === m,
                    click: () => onPick(m),
                })),
            ],
            e
        );
    };
    return (
        <button
            type="button"
            data-council-retry-pick={expert.id}
            data-picked={current ?? ""}
            aria-haspopup="menu"
            aria-label={`The model Retry all runs ${expert.name} on`}
            title="The model Retry all runs this seat on, this once; the seat keeps its own"
            disabled={disabled}
            onClick={open}
            className={cn("inline-flex items-center gap-[3px]", className)}
        >
            {current == null ? "Own model" : `On ${modelName(current)}`}
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </button>
    );
}

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
