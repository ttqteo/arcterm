// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's Session column: the picked agent's recent sessions in the picked project, under a pinned first row
// that starts a new one (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Which sessions are
// offered is launcherresume.ts; the pick is launcherResumeAtom. A session row is one line, its title and how long ago it
// was last active, after its digit (docs/superpowers/specs/2026-10-28-new-launcher-declutter-design.md D4; no transcript
// read). The rows are one radio group with a roving tab stop, so
// Tab lands on the picked row. It keys by resumeListKey: a digit picks the nth row, ↑↓ move, ← steps back to Project;
// Enter and a letter bubble to the dialog, which launches from this zone, or moves the letter into the Task box (there
// is no session filter: an agent always has a Task box, and typing here means writing the task). The sessions scroll
// under New session, so a long list never makes the dialog taller. Older sessions load a page at a time as the scroll
// nears its end (launcherstore.ts).

import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { formatAge } from "./agentsviewmodel";
import { stepIndex } from "./launcher";
import { resumeListKey, sessionTitle } from "./launcherresume";
import { ColumnLabel, digitOf, Keycap, rowTone } from "./launcherrows";
import { launcherPageAtom, launcherResumeAtom, loadMoreLauncherSessions } from "./launcherstore";
import { nearListEnd } from "./listend";

interface ResumeListProps {
    choices: SessionInfo[];
    // the list's scope (launcherresume.ts resumeScopeKey): the paging counts only when it is its own
    scopeKey: string;
    // null is the "New session" row
    pickedId: string | null;
    // ← from the column: focus goes back to Project
    onBack: () => void;
}

export function ResumeList({ choices, scopeKey, pickedId, onBack }: ResumeListProps) {
    const groupRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [focused, setFocused] = useState(false);
    const page = useAtomValue(launcherPageAtom);
    const pageHere = page.key === scopeKey;
    const loading = pageHere && page.loading;
    const more = pageHere && page.cursor !== "";
    // row 0 is "New session", row i + 1 is choices[i]; -1 is a picked session no longer on offer
    const at = choices.findIndex((s) => s.id === pickedId);
    const picked = pickedId == null ? 0 : at < 0 ? -1 : at + 1;
    const rowCount = choices.length + 1;

    // the picked row stays in view as the keys move it down a long list
    useEffect(() => {
        groupRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    }, [pickedId]);

    // the next page when the scroll is near the end; also after a page lands, because a list that fits has no scroll
    // event to ask
    const loadIfNearEnd = () => {
        if (scrollRef.current != null && nearListEnd(scrollRef.current)) {
            fireAndForget(loadMoreLauncherSessions);
        }
    };
    useEffect(() => {
        if (more && !loading) {
            loadIfNearEnd();
        }
    }, [choices.length, more, loading]);

    const pickRow = (row: number) => {
        globalStore.set(launcherResumeAtom, row === 0 ? null : choices[row - 1].id);
        groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[row]?.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const action = resumeListKey({ key: e.key, mod: e.metaKey || e.ctrlKey || e.altKey }, { rows: rowCount });
        if (action.kind === "none") {
            return;
        }
        // the dialog's own keys must not see these: a digit there would pick a project
        e.stopPropagation();
        e.preventDefault();
        switch (action.kind) {
            case "pick":
                pickRow(action.index);
                return;
            case "move":
                pickRow(stepIndex(rowCount, picked < 0 ? 0 : picked, action.delta));
                return;
            case "back":
                onBack();
                return;
        }
    };

    const onBlur = (e: FocusEvent<HTMLDivElement>) => {
        if (!groupRef.current?.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
        }
    };

    const now = Date.now();
    let hint = `${choices.length}${more ? "+" : ""} · newest first`;
    if (focused) {
        hint = `↑↓ · 1–${Math.min(9, rowCount)}`;
    }
    const newOn = picked === 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ColumnLabel label="Session" hint={hint} focused={focused} />
            <span id="launcher-resume-label" className="sr-only">
                Session
            </span>
            <div
                ref={groupRef}
                role="radiogroup"
                aria-labelledby="launcher-resume-label"
                data-launcher-resume
                onKeyDown={onKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={onBlur}
                className="flex min-h-0 flex-1 flex-col gap-px"
            >
                <div
                    role="radio"
                    aria-checked={newOn}
                    tabIndex={newOn || picked < 0 ? 0 : -1}
                    data-resume-new
                    onClick={() => pickRow(0)}
                    className={cn(rowTone(newOn, focused), "shrink-0 gap-[10px] py-2 outline-none")}
                >
                    <Keycap k="1" lit={focused} />
                    <span
                        className={cn("text-[12.5px] font-semibold", newOn ? "text-primary" : "text-muted-foreground")}
                    >
                        New session
                    </span>
                </div>
                <div
                    ref={scrollRef}
                    onScroll={loadIfNearEnd}
                    className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto"
                >
                    {choices.map((s, i) => {
                        const on = picked === i + 1;
                        return (
                            <div
                                key={s.id}
                                role="radio"
                                aria-checked={on}
                                tabIndex={on ? 0 : -1}
                                data-resume-id={s.id}
                                title={`${sessionTitle(s)}${s.branch ? ` · ${s.branch}` : ""}`}
                                onClick={() => pickRow(i + 1)}
                                className={cn(rowTone(on, focused), "shrink-0 gap-[10px] py-2 outline-none")}
                            >
                                <Keycap k={digitOf(i + 1)} lit={focused} />
                                <span
                                    className={cn(
                                        "min-w-0 flex-1 truncate text-[12.5px]",
                                        on ? "font-semibold text-primary" : "text-muted-foreground"
                                    )}
                                >
                                    {sessionTitle(s)}
                                </span>
                                <span
                                    data-resume-age
                                    className="shrink-0 text-right text-[11px] tabular-nums text-muted"
                                >
                                    {formatAge(now - s.lastactivets)}
                                </span>
                            </div>
                        );
                    })}
                    {loading ? (
                        <span data-launcher-session-loading className="shrink-0 px-2 py-1.5 text-[12px] text-muted">
                            Loading older sessions…
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
