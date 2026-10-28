// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's Session column: the picked agent's recent sessions in the picked project, under a pinned first row
// that starts a new one (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Which sessions are
// offered is launcherresume.ts; the pick is launcherResumeAtom. A session row is one line, its title and how long ago it
// was last active (docs/superpowers/specs/2026-10-28-new-launcher-declutter-design.md D4, D8: no keycaps, no key hints,
// no transcript read). The rows are one radio group with a roving tab stop, so
// Tab lands on the picked row. It keys as the Project column does (resumeListKey): a digit picks the nth visible row,
// letters filter, ↑↓ move, ← steps back to Project; Enter bubbles to the dialog, which launches from this zone. The
// sessions scroll under New session, so a long list never makes the dialog taller. Older sessions load a page at a time
// as the scroll nears its end (launcherstore.ts), and text typed here also asks the backend for matches among the pages
// not loaded yet.

import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { formatAge } from "./agentsviewmodel";
import { stepIndex } from "./launcher";
import { filterSessions, resumeListKey, sessionTitle, shownSessions } from "./launcherresume";
import { ColumnLabel, FilterLine, rowTone } from "./launcherrows";
import {
    findLauncherSessions,
    launcherFoundAtom,
    launcherPageAtom,
    launcherResumeAtom,
    loadMoreLauncherSessions,
} from "./launcherstore";
import { nearListEnd } from "./listend";

// how long typing pauses before the backend is asked for matches
const FIND_DELAY_MS = 150;

interface ResumeListProps {
    choices: SessionInfo[];
    // the list's scope (launcherresume.ts resumeScopeKey): the paging and the found rows count only when they are its own
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
    const [filter, setFilter] = useState("");
    const page = useAtomValue(launcherPageAtom);
    const found = useAtomValue(launcherFoundAtom);
    const pageHere = page.key === scopeKey;
    const loading = pageHere && page.loading;
    const more = pageHere && page.cursor !== "";
    const foundHere = found != null && found.key === scopeKey && found.query === filter.trim() ? found.sessions : null;
    const shown = shownSessions(choices, filter, foundHere);
    // row 0 is "New session", row i + 1 is shown[i]; -1 is a picked session the filter hides
    const at = shown.findIndex((s) => s.id === pickedId);
    const picked = pickedId == null ? 0 : at < 0 ? -1 : at + 1;
    const rowCount = shown.length + 1;

    // the picked row stays in view as the keys move it down a long list
    useEffect(() => {
        groupRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    }, [pickedId, filter]);

    // the next page when the scroll is near the end; also after a page lands, because a list that fits has no scroll
    // event to ask. A typed filter is served by the backend search, so only a scroll loads under it.
    const loadIfNearEnd = () => {
        if (scrollRef.current != null && nearListEnd(scrollRef.current)) {
            fireAndForget(loadMoreLauncherSessions);
        }
    };
    useEffect(() => {
        if (filter.trim() === "" && more && !loading) {
            loadIfNearEnd();
        }
    }, [choices.length, more, loading, filter]);

    useEffect(() => {
        if (filter.trim() === "") {
            return;
        }
        const t = setTimeout(() => fireAndForget(() => findLauncherSessions(filter)), FIND_DELAY_MS);
        return () => clearTimeout(t);
    }, [filter]);

    const pickRow = (row: number, list = shown) => {
        globalStore.set(launcherResumeAtom, row === 0 ? null : list[row - 1].id);
        groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[row]?.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const action = resumeListKey(
            { key: e.key, mod: e.metaKey || e.ctrlKey || e.altKey },
            { rows: rowCount, filter }
        );
        if (action.kind === "none") {
            return;
        }
        // the dialog's own keys must not see these; a handled Escape (a filter cleared) must not close it
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
            case "filter": {
                setFilter(action.next);
                // a pick the filter hides moves to the first match; with no match it stays, as the Project column's does
                const next = filterSessions(choices, action.next);
                if (pickedId != null && next.length > 0 && !next.some((s) => s.id === pickedId)) {
                    globalStore.set(launcherResumeAtom, next[0].id);
                }
                return;
            }
        }
    };

    // a list narrowed by a query you can no longer see reads as sessions gone missing
    const onBlur = (e: FocusEvent<HTMLDivElement>) => {
        if (!groupRef.current?.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
            setFilter("");
        }
    };

    const now = Date.now();
    // no key hint (D8): the keys still work, the label only counts
    const hint = `${choices.length}${more ? "+" : ""} · newest first`;
    const newOn = picked === 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ColumnLabel label="Session" hint={hint} focused={focused} />
            <span id="launcher-resume-label" className="sr-only">
                Session
            </span>
            {filter !== "" ? (
                <FilterLine
                    query={filter}
                    shown={shown.length}
                    total={choices.length}
                    attr="data-launcher-session-filter"
                />
            ) : null}
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
                    {shown.map((s, i) => {
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
                    {shown.length === 0 && filter !== "" ? (
                        <span data-launcher-session-nomatch className="px-2 py-1.5 text-[12px] text-muted">
                            No session matches “{filter}”. Esc clears the filter.
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
