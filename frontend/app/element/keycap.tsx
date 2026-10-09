// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one keyboard-shortcut chip. `chord` is binding notation ("Ctrl:p", "g p", "Cmd:Enter");
// glyphs come from the platform-aware keysym formatter. "chips" = one bordered box per key;
// "inline" = a single terse box (for dense footers / menu shortcut columns).

import { formatChord, formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";

const BOX = "rounded-[5px] border border-edge-mid px-[6px] py-0.5 font-mono text-[10.5px]";

export function KeyCap({
    chord,
    variant = "chips",
    className,
    title,
}: {
    chord: string;
    variant?: "chips" | "inline";
    className?: string;
    title?: string;
}) {
    const parts = formatChord(chord);
    if (variant === "inline") {
        return (
            <span title={title} className={cn(BOX, "text-muted", className)}>
                {formatChordString(chord)}
            </span>
        );
    }
    return (
        <span title={title} className={cn("inline-flex items-center gap-1", className)}>
            {parts.map((p, i) => (
                <span key={i} className={cn(BOX, "text-primary")}>
                    {p}
                </span>
            ))}
        </span>
    );
}
