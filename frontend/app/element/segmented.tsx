// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Mono segmented control: a small set of mutually-exclusive options in a bordered pill. Lifted out of
// usagesurface.tsx so the Usage surface and the Daily chart can share one control without the chart
// importing the surface. settingssurface.tsx keeps its own UI-font variant — a different look, not a
// duplicate of this one.

import { indicatorSlide } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { MotionConfig, motion } from "motion/react";
import { useId, type ReactNode } from "react";

export function Segmented<T extends string>({
    value,
    options,
    onChange,
    role,
    ariaLabel,
    title,
    slide,
}: {
    value: T;
    // `disabled`: this option is drawn dimmed and takes no press (its `title` says why); the others draw as ever.
    // `dataAttrs`: extra data attributes on the option's button, for a caller that has to find it
    options: {
        key: T;
        label: ReactNode;
        title?: string;
        disabled?: boolean;
        dataAttrs?: Record<`data-${string}`, string>;
    }[];
    onChange: (v: T) => void;
    // "tablist" makes each option a tab (aria-selected); otherwise each is a toggle button (aria-pressed)
    role?: "group" | "tablist";
    ariaLabel?: string;
    title?: string;
    // The selected option's fill slides to the next one picked (a shared-layout span, indicatorSlide) instead of
    // jumping. Opt-in, so no other control in the app changes; reduced motion snaps it.
    slide?: boolean;
}) {
    const tabs = role === "tablist";
    // unique per control, so two sliding controls on one screen never share a fill
    const fillId = useId();
    const buttons = options.map((o) => (
        <button
            key={o.key}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? value === o.key : undefined}
            aria-pressed={tabs ? undefined : value === o.key}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.key)}
            {...o.dataAttrs}
            className={cn(
                "rounded-sm border-0 px-[12px] py-[5px] text-[11px] font-semibold",
                o.disabled ? "cursor-default opacity-40" : "cursor-pointer",
                slide && "relative",
                typeof o.label !== "string" && "flex items-center gap-[6px]",
                value === o.key ? (slide ? "text-primary" : "bg-accentbg text-primary") : "bg-transparent text-muted"
            )}
        >
            {slide ? (
                <>
                    {value === o.key ? (
                        <motion.span
                            layoutId={fillId}
                            data-slide-fill
                            aria-hidden
                            transition={indicatorSlide}
                            className="absolute inset-0 rounded-[inherit] bg-accentbg"
                        />
                    ) : null}
                    <span className={cn("relative", typeof o.label !== "string" && "flex items-center gap-[6px]")}>
                        {o.label}
                    </span>
                </>
            ) : (
                o.label
            )}
        </button>
    ));
    return (
        <div
            role={role}
            aria-label={ariaLabel}
            title={title}
            className="flex flex-none rounded border border-border bg-surface-raised p-[3px]"
        >
            {slide ? <MotionConfig reducedMotion="user">{buttons}</MotionConfig> : buttons}
        </div>
    );
}
