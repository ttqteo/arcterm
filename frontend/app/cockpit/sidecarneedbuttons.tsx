// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A Needs you row's head and its buttons, shared by the small form (sidecarcompact.tsx) and the wall
// (sidecarorbit.tsx): what kind of thing waits, in words, with its age, then what can be done about it from here
// (needButtons: Accept, Approve, Retry, Work on, an ask's options, Open). It runs on the slim page: the types, the pure
// models and React.

import { cn } from "@/util/util";
import type { MouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { needAge, needButtons, needHow } from "./sidecarorbitmodel";
import type { SidecarAct, SidecarNeed } from "./sidecartypes";

// a press on a button is the button's: the row under it selects on a click and opens on a double click, and the
// dashboard hears Enter and 1-9 on the window
const own = (e: MouseEvent | ReactKeyboardEvent) => e.stopPropagation();

/** The row's first line: its kind in words in the row's tone, the source, and how long it has waited (or how late). */
export function NeedHead(props: { need: SidecarNeed; age: string; wall?: boolean }) {
    const { need, wall } = props;
    const failed = need.failed === true;
    return (
        <div className="flex items-baseline gap-1.5">
            <span
                data-need-label
                className={cn(
                    "shrink-0 font-semibold",
                    wall ? "text-[12.5px]" : "text-[11.5px]",
                    failed ? "text-error" : "text-warning"
                )}
            >
                {need.label ?? (failed ? "Failed" : "Waiting")}
            </span>
            <span className="shrink-0 text-hud-muted">·</span>
            <span
                className={cn(
                    "min-w-0 flex-1 truncate font-semibold text-hud-text",
                    wall ? "text-[13.5px]" : "text-[12.5px]"
                )}
                title={need.who}
            >
                {need.who}
            </span>
            <span
                className={cn(
                    "shrink-0 whitespace-nowrap font-mono tabular-nums",
                    wall ? "text-[12px]" : "text-[11px]",
                    need.late === true ? "text-warning" : "text-hud-muted"
                )}
            >
                {needAge(need, props.age)}
            </span>
        </div>
    );
}

/**
 * The row's buttons, then the note an act left when it did not settle the row. A row with none (a sent ask) says how
 * it stands instead (needHow).
 */
export function NeedButtons(props: { need: SidecarNeed; send: (act: SidecarAct) => void; wall?: boolean }) {
    const { need, send, wall } = props;
    const buttons = needButtons(need);
    return (
        <>
            {buttons.length === 0 ? (
                <span className={cn("font-mono text-hud-muted", wall ? "text-[12px]" : "text-[11px]")}>
                    {needHow(need)}
                </span>
            ) : (
                <div data-need-buttons className="mt-1 flex flex-wrap gap-1.5">
                    {buttons.map((b) => (
                        <button
                            key={b.key}
                            type="button"
                            data-need-act={b.key}
                            title={b.label}
                            onClick={(e) => {
                                own(e);
                                send(b.act);
                            }}
                            onDoubleClick={own}
                            onKeyDown={own}
                            className={cn(
                                "max-w-full truncate rounded-sm px-2 py-[2px] font-medium",
                                wall ? "text-[12.5px]" : "text-[11.5px]",
                                b.strong
                                    ? "bg-hud-glow text-hud-bg hover:opacity-90"
                                    : "border border-hud-line text-hud-text hover:border-hud-glow hover:text-hud-glow"
                            )}
                        >
                            {b.label}
                        </button>
                    ))}
                </div>
            )}
            {need.note != null && (
                <span data-need-note className="truncate text-[11px] text-error" title={need.note}>
                    {need.note}
                </span>
            )}
        </>
    );
}
