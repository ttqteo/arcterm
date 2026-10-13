// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { Check } from "lucide-react";
import type { MouseEvent } from "react";
import type { TickState } from "./commitselection";

// A checkbox is a button so a disabled one carries its title and every one can be clicked or read by role. It takes no
// focus from a click (the list keeps it, so Space and the arrows go on working) and none from Tab.
export function TickBox({
    state,
    label,
    disabled = false,
    title,
    onToggle,
    attrs,
}: {
    state: TickState;
    label: string;
    disabled?: boolean;
    title?: string;
    onToggle: () => void;
    attrs: Record<string, string>;
}) {
    return (
        <button
            {...attrs}
            type="button"
            role="checkbox"
            aria-checked={state === "some" ? "mixed" : state === "all"}
            aria-label={label}
            disabled={disabled}
            title={title}
            tabIndex={-1}
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={(e) => {
                e.stopPropagation();
                onToggle();
            }}
            className={cn(
                "flex h-[14px] w-[14px] flex-none items-center justify-center rounded-[4px] border",
                state === "none" ? "border-edge-strong" : "border-ink-mid bg-ink-mid",
                disabled ? "cursor-default opacity-40" : "cursor-pointer"
            )}
        >
            {state === "all" ? <Check size={10} strokeWidth={4} className="text-background" /> : null}
            {state === "some" ? <span className="h-[2px] w-[7px] rounded-[1px] bg-background" /> : null}
        </button>
    );
}
