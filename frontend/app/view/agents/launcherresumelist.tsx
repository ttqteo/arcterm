// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's Resume list: the picked agent's recent sessions in the picked project, under a first row that
// starts a new one (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Which sessions are offered
// is launcherresume.ts; the pick is launcherResumeAtom. The rows are one radio group with a roving tab stop, so Tab
// lands on the picked row and ↑↓ move the pick. Enter bubbles to the dialog, which launches from this zone.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useRef, type KeyboardEvent } from "react";
import { formatAge, formatTokens } from "./agentsviewmodel";
import { stepIndex } from "./launcher";
import { LAUNCHER_LABEL } from "./launcheragentfields";
import { launcherResumeAtom } from "./launcherstore";

const UNTITLED = "(untitled session)";

interface ResumeListProps {
    choices: SessionInfo[];
    // null is the "New session" row
    pickedId: string | null;
}

export function ResumeList({ choices, pickedId }: ResumeListProps) {
    const groupRef = useRef<HTMLDivElement>(null);
    if (choices.length === 0) {
        return null;
    }
    const now = Date.now();
    // row 0 is "New session", row i + 1 is choices[i]
    const picked = pickedId == null ? 0 : choices.findIndex((s) => s.id === pickedId) + 1;
    const pickRow = (row: number) => globalStore.set(launcherResumeAtom, row === 0 ? null : choices[row - 1].id);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
            return;
        }
        // the dialog's column navigation must not see these
        e.stopPropagation();
        e.preventDefault();
        const next = stepIndex(choices.length + 1, picked, e.key === "ArrowDown" ? 1 : -1);
        pickRow(next);
        groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
    };

    const rowClass = (on: boolean) =>
        cn(
            "flex cursor-pointer items-center gap-[10px] rounded-[7px] px-2.5 py-[7px] outline-none",
            "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-700",
            on ? "bg-accentbg" : "hover:bg-surface-hover"
        );
    const dot = (on: boolean) => (
        <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", on ? "bg-accent" : "bg-muted")} />
    );

    return (
        <div className="flex flex-col gap-2">
            <span id="launcher-resume-label" className={LAUNCHER_LABEL}>
                Resume
            </span>
            <div
                ref={groupRef}
                role="radiogroup"
                aria-labelledby="launcher-resume-label"
                data-launcher-resume
                onKeyDown={onKeyDown}
                className="flex flex-col gap-px rounded-[10px] border border-edge-mid bg-surface p-1"
            >
                <div
                    role="radio"
                    aria-checked={picked === 0}
                    tabIndex={picked === 0 ? 0 : -1}
                    data-resume-new
                    onClick={() => pickRow(0)}
                    className={rowClass(picked === 0)}
                >
                    {dot(picked === 0)}
                    <span
                        className={cn(
                            "text-[12.5px] font-semibold",
                            picked === 0 ? "text-primary" : "text-muted-foreground"
                        )}
                    >
                        New session
                    </span>
                </div>
                {choices.map((s, i) => {
                    const on = picked === i + 1;
                    return (
                        <div
                            key={s.id}
                            role="radio"
                            aria-checked={on}
                            tabIndex={on ? 0 : -1}
                            data-resume-id={s.id}
                            onClick={() => pickRow(i + 1)}
                            className={rowClass(on)}
                        >
                            {dot(on)}
                            <span className="flex min-w-0 flex-1 flex-col gap-px">
                                <span className="truncate text-[12.5px] font-semibold text-primary">
                                    {s.task || UNTITLED}
                                </span>
                                <span className="truncate text-[10.5px] text-muted">
                                    {s.branch || "—"} · {formatAge(now - s.lastactivets)} ·{" "}
                                    {formatTokens(s.tokenstotal)} tok
                                </span>
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
