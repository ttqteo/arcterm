// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Mono segmented control: a small set of mutually-exclusive options in a bordered pill. Lifted out of
// usagesurface.tsx so the Usage surface and the Daily chart can share one control without the chart
// importing the surface. settingssurface.tsx keeps its own UI-font variant — a different look, not a
// duplicate of this one.

import { cn } from "@/util/util";
import type { ReactNode } from "react";

export function Segmented<T extends string>({
    value,
    options,
    onChange,
    role,
    ariaLabel,
    title,
}: {
    value: T;
    options: { key: T; label: ReactNode; title?: string }[];
    onChange: (v: T) => void;
    // "tablist" makes each option a tab (aria-selected); otherwise each is a toggle button (aria-pressed)
    role?: "group" | "tablist";
    ariaLabel?: string;
    title?: string;
}) {
    const tabs = role === "tablist";
    return (
        <div
            role={role}
            aria-label={ariaLabel}
            title={title}
            className="flex flex-none rounded border border-border bg-surface-raised p-[3px]"
        >
            {options.map((o) => (
                <button
                    key={o.key}
                    type="button"
                    role={tabs ? "tab" : undefined}
                    aria-selected={tabs ? value === o.key : undefined}
                    aria-pressed={tabs ? undefined : value === o.key}
                    title={o.title}
                    onClick={() => onChange(o.key)}
                    className={cn(
                        "cursor-pointer rounded-sm border-0 px-[12px] py-[5px] text-[11px] font-semibold",
                        typeof o.label !== "string" && "flex items-center gap-[6px]",
                        value === o.key ? "bg-accentbg text-primary" : "bg-transparent text-muted"
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
