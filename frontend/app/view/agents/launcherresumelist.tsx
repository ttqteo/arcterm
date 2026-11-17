// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's Session column: the picked agent's recent sessions in the picked project, under a pinned first row
// that starts a new one (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Which sessions are
// offered is launcherresume.ts; the pick is launcherResumeAtom. A session row is one line, its title and how long ago it
// was last active, after its digit (docs/superpowers/specs/2026-10-28-new-launcher-declutter-design.md D4; no transcript
// read). The rows are one radio group with a roving tab stop, so
// Tab lands on the picked row. It keys by resumeListKey: a digit picks the nth row, ↑↓ move, ← steps back to Project;
// Enter and a letter bubble to the dialog, which launches from this zone, or moves the letter into the Task box (typing
// here means writing the task: an agent always has a Task box). The sessions scroll
// under New session, so a long list never makes the dialog taller. Older sessions load a page at a time as the scroll
// nears its end (launcherstore.ts).
//
// Search (docs/superpowers/specs/2026-11-17-session-search-design.md, board A): for claude and pi the header has a
// magnifier, and / opens the same box. With a query the sessions are filtered by title at once, then the sessions the
// content search found are added under "Matched by content", each with its snippet; the digits number across both
// groups and older pages stop loading, as the search reaches the whole window. The search's answer comes from the dialog
// (it asks once, so the answer survives the resume step drawing this list again somewhere else); the box's query is
// launcherSessionSearchAtom.

import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Fragment, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { formatAge } from "./agentsviewmodel";
import { stepIndex } from "./launcher";
import { resumeListKey, sessionTitle } from "./launcherresume";
import { ColumnLabel, digitOf, Keycap, rowTone, type ColumnSearch } from "./launcherrows";
import {
    closeSessionSearch,
    launcherPageAtom,
    launcherResumeAtom,
    launcherSearchedAtom,
    launcherSessionSearchAtom,
    loadMoreLauncherSessions,
    openSessionSearch,
    setSessionSearchQuery,
} from "./launcherstore";
import { nearListEnd } from "./listend";
import { SearchSnippet } from "./searchsnippet";
import { searchHint, snippetParts, splitSessionResults } from "./sessionsearch";
import type { SessionSearch } from "./sessionsearchstore";
import { findRanges, findTerms } from "./sessionsfind";

interface ResumeListProps {
    choices: SessionInfo[];
    // the list's scope (launcherresume.ts resumeScopeKey): the paging counts only when it is its own
    scopeKey: string;
    // null is the "New session" row
    pickedId: string | null;
    // ← from the column: focus goes back to Project
    onBack: () => void;
    // the picked agent's sessions can be searched by content (claude, pi): the magnifier shows
    searchable: boolean;
    // the search's answer for the box's query (useSessionSearch, asked by the dialog)
    answer: SessionSearch;
}

// a session's title with the words the search matched marked, as board A draws them
function MarkedTitle({ title, terms }: { title: string; terms: string[] }) {
    return (
        <>
            {snippetParts(title, findRanges(title, terms)).map((part, i) =>
                part.mark ? (
                    <mark key={i} data-search-mark className="rounded-sm bg-accentbg text-primary">
                        {part.text}
                    </mark>
                ) : (
                    <span key={i}>{part.text}</span>
                )
            )}
        </>
    );
}

export function ResumeList({ choices, scopeKey, pickedId, onBack, searchable, answer }: ResumeListProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const groupRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [focused, setFocused] = useState(false);
    const page = useAtomValue(launcherPageAtom);
    const box = useAtomValue(launcherSessionSearchAtom);
    const boxOpen = searchable && box.open;
    // a query with no words (empty, or a lone quote) searches nothing and leaves the list as it is
    const searching = boxOpen && findTerms(box.query.trim()).length > 0;
    const split = searching ? splitSessionResults(choices, answer.results, answer.terms) : null;
    // every session on offer in digit order: the title group, then the content group
    const rows = split != null ? [...split.title, ...split.content.map((c) => c.session)] : choices;
    const titleCount = split != null ? split.title.length : rows.length;
    const pageHere = page.key === scopeKey;
    const loading = pageHere && page.loading && !searching;
    const more = pageHere && page.cursor !== "" && !searching;
    // row 0 is "New session", row i + 1 is rows[i]; -1 is a picked session no longer on offer
    const at = rows.findIndex((s) => s.id === pickedId);
    const picked = pickedId == null ? 0 : at < 0 ? -1 : at + 1;
    const rowCount = rows.length + 1;

    // the picked row stays in view as the keys move it down a long list
    useEffect(() => {
        groupRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    }, [pickedId]);

    // the next page when the scroll is near the end; also after a page lands, because a list that fits has no scroll
    // event to ask
    const loadIfNearEnd = () => {
        if (!searching && scrollRef.current != null && nearListEnd(scrollRef.current)) {
            fireAndForget(loadMoreLauncherSessions);
        }
    };
    useEffect(() => {
        if (more && !loading) {
            loadIfNearEnd();
        }
    }, [rows.length, more, loading]);

    const pickRow = (row: number) => {
        const s = row === 0 ? null : rows[row - 1];
        globalStore.set(launcherResumeAtom, s?.id ?? null);
        // a session no loaded page holds must stay findable for the launch: the dialog looks it up here
        globalStore.set(launcherSearchedAtom, s != null && !choices.some((c) => c.id === s.id) ? s : null);
        groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[row]?.focus();
    };

    const focusBox = () => rootRef.current?.querySelector<HTMLInputElement>("[data-launcher-search] input")?.focus();
    // the box is drawn once the state lands, so its input takes focus a frame later
    const openBox = () => {
        if (box.open) {
            focusBox();
            return;
        }
        openSessionSearch();
        requestAnimationFrame(focusBox);
    };
    // Escape and the ×: the box and its query go, and focus returns to the column's picked row
    const closeBox = () => {
        closeSessionSearch();
        requestAnimationFrame(() =>
            groupRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus()
        );
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const action = resumeListKey(
            { key: e.key, mod: e.metaKey || e.ctrlKey || e.altKey },
            { rows: rowCount, searchable, searchOpen: boxOpen }
        );
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
            case "search":
                openBox();
                return;
            case "search-close":
                closeBox();
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
    const search: ColumnSearch | undefined = searchable
        ? {
              column: "session",
              open: boxOpen,
              query: box.query,
              hint: split != null ? searchHint(split.title.length, split.content.length, answer.incomplete) : "",
              label: "Search sessions",
              onOpen: openBox,
              onChange: setSessionSearchQuery,
              onClose: closeBox,
              // ↓ from the box goes to the first row: New session, which stays the list's top whatever the query
              onDown: () => groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[0]?.focus(),
          }
        : undefined;

    return (
        <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
            {/* the box is not the list: focus in it must not take the dialog into the resume step (the third column's
                onFocus), which would pull focus off the box to the picked row */}
            <div onFocus={(e) => e.stopPropagation()} className="shrink-0">
                <ColumnLabel label="Session" hint={hint} focused={focused} search={search} />
            </div>
            <span id="launcher-resume-label" className="sr-only">
                Session
            </span>
            {searching && answer.error != null ? (
                <span data-resume-search-error className="shrink-0 px-2 pb-1.5 text-[12px] text-muted">
                    Search failed: {answer.error}
                </span>
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
                    {rows.map((s, i) => {
                        const on = picked === i + 1;
                        const found = split != null && i >= titleCount ? split.content[i - titleCount] : null;
                        const hit = found?.result.hits?.[0];
                        const rowTitle = `${sessionTitle(s)}${s.branch ? ` · ${s.branch}` : ""}`;
                        const titleClass = cn(
                            "min-w-0 flex-1 truncate text-[12.5px]",
                            on ? "font-semibold text-primary" : "text-muted-foreground"
                        );
                        const age = (
                            <span data-resume-age className="shrink-0 text-right text-[11px] tabular-nums text-muted">
                                {formatAge(now - s.lastactivets)}
                            </span>
                        );
                        return (
                            <Fragment key={s.id}>
                                {found != null && i === titleCount ? (
                                    <span
                                        data-resume-content-label
                                        className="shrink-0 px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted"
                                    >
                                        Matched by content
                                    </span>
                                ) : null}
                                {found != null ? (
                                    // a content row: its title and age, and under them the first hit's snippet
                                    <div
                                        role="radio"
                                        aria-checked={on}
                                        tabIndex={on ? 0 : -1}
                                        data-resume-content-id={s.id}
                                        title={rowTitle}
                                        onClick={() => pickRow(i + 1)}
                                        className={cn(
                                            rowTone(on, focused),
                                            "shrink-0 items-start gap-[10px] py-2 outline-none"
                                        )}
                                    >
                                        <Keycap k={digitOf(i + 1)} lit={focused} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline gap-2">
                                                <span className={titleClass}>{sessionTitle(s)}</span>
                                                {age}
                                            </div>
                                            {hit != null ? <SearchSnippet hit={hit} /> : null}
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        role="radio"
                                        aria-checked={on}
                                        tabIndex={on ? 0 : -1}
                                        data-resume-id={s.id}
                                        title={rowTitle}
                                        onClick={() => pickRow(i + 1)}
                                        className={cn(rowTone(on, focused), "shrink-0 gap-[10px] py-2 outline-none")}
                                    >
                                        <Keycap k={digitOf(i + 1)} lit={focused} />
                                        <span className={titleClass}>
                                            {searching ? (
                                                <MarkedTitle title={sessionTitle(s)} terms={answer.terms} />
                                            ) : (
                                                sessionTitle(s)
                                            )}
                                        </span>
                                        {age}
                                    </div>
                                )}
                            </Fragment>
                        );
                    })}
                    {searching && answer.error == null && answer.results != null && rows.length === 0 ? (
                        <span data-resume-search-empty className="shrink-0 px-2 py-1.5 text-[12px] text-muted">
                            No sessions match
                        </span>
                    ) : null}
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
