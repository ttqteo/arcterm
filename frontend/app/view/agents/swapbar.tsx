// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The toolbar under the agent header while a canvas or a Doc review stands in the terminal's place. It reads as the
// header's second line: the header's background and side padding, buttons at the header's size, and tabs underlined
// as the details rail's are, so the header's Terminal | Canvas | Review stays the one segmented control on screen.

import { cn } from "@/util/util";
import type { ReactNode } from "react";

export const SWAP_BAR =
    "flex flex-none items-center gap-[10px] border-b border-border bg-background px-[18px] py-[6px]";

// the bar's own label: the canvas topic, the reviewed file
export const SWAP_LABEL = "min-w-0 truncate text-[12px] font-medium text-ink-mid";

export const SWAP_BTN =
    "flex flex-none cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] py-[5px] text-[11.5px] font-semibold text-secondary hover:border-edge-strong hover:text-primary disabled:cursor-default disabled:opacity-50";
// a toggle button that is on (Mark, Whole file)
export const SWAP_BTN_ON = "border-accent bg-accentbg text-accent hover:border-accent hover:text-accent";
export const SWAP_PRIMARY_BTN =
    "flex flex-none cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-accent bg-accent px-[10px] py-[5px] text-[11.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";

// Underlined tabs that run the bar's full height, so the selected one's underline sits on the bar's bottom border
export function SwapTabs<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
    title,
    className,
}: {
    value: T;
    options: { key: T; label: ReactNode }[];
    onChange: (v: T) => void;
    ariaLabel: string;
    title?: string;
    className?: string;
}) {
    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            title={title}
            className={cn("-mb-[7px] -mt-[6px] flex flex-none items-stretch self-stretch", className)}
        >
            {options.map((o) => (
                <button
                    key={o.key}
                    type="button"
                    role="tab"
                    aria-selected={value === o.key}
                    onClick={() => onChange(o.key)}
                    className={cn(
                        "flex cursor-pointer items-center border-0 border-b-2 bg-transparent px-[9px] text-[11.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                        value === o.key
                            ? "border-primary text-primary"
                            : "border-transparent text-muted hover:text-secondary"
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
