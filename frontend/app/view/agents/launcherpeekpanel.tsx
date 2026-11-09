// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New agent dialog's resume step reads the picked Claude session here, beside the session list: its last 5
// messages drawn as the transcript draws them, your message in a box and Claude's reply as formatted prose
// (docs/superpowers/specs/2026-11-06-launcher-session-peek-design.md, "The resume step"); a scroll to the top reads the
// 10 before them, and so on back to the session's start. The read, its states, the older pages and the meta line are
// launcherpeek.ts; the dialog (launchermodal.tsx) owns when the step shows and which session it reads. The pane fills
// the step's height and scrolls inside with the app's shared scrollbar.

import { MOTION } from "@/app/element/motiontokens";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    PEEK_READING_DELAY_MS,
    peekMeta,
    peekOlderBegin,
    peekOlderFailed,
    peekOlderLoaded,
    peekOlderStart,
    peekOlderWanted,
    peekView,
    type PeekCursor,
    type PeekMessage,
    type PeekOlder,
    type PeekResult,
    type PeekState,
} from "./launcherpeek";
import { sessionTitle } from "./launcherresume";
import { MarkdownMessage } from "./markdownmessage";

interface LauncherPeekPaneProps {
    // the picked past session (New session keeps the three columns, so the pane never shows for it)
    session: SessionInfo;
    // the read of this session; loading until it answers
    peek: PeekState;
    // reads the page of messages before the cursor
    fetchOlder: (session: SessionInfo, cursor: PeekCursor) => Promise<PeekResult>;
}

function PeekRow({ m }: { m: PeekMessage }) {
    if (m.role === "user") {
        return (
            <div
                data-peek-msg
                data-role="user"
                className="mt-3 shrink-0 whitespace-pre-wrap break-words rounded-[8px] border border-accent/30 bg-accent/10 px-3 py-2 text-[13px] leading-[1.55] text-primary"
            >
                {m.text}
            </div>
        );
    }
    return (
        <div data-peek-msg data-role="assistant" className="mt-2.5 shrink-0 text-[13px] leading-[1.6] text-secondary">
            <MarkdownMessage text={m.text} />
        </div>
    );
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export function LauncherPeekPane({ session, peek, fetchOlder }: LauncherPeekPaneProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [now, setNow] = useState(() => Date.now());
    const result = peek.status === "done" ? peek.result : null;
    // the older pages belong to one first read: a new pick or a new read starts them again (set during render, so the
    // new session never draws a frame with the old one's pages)
    const [older, setOlder] = useState<{ base: PeekResult | null; id: string; o: PeekOlder }>(() => ({
        base: result,
        id: session.id,
        o: peekOlderStart(result),
    }));
    let current = older;
    if (older.base !== result || older.id !== session.id) {
        current = { base: result, id: session.id, o: peekOlderStart(result) };
        setOlder(current);
    }
    const view = peekView(peek, now, result != null ? current.o : null);
    const since = peek.status === "loading" ? peek.since : null;
    // the distance from the bottom before an older page lands, kept after it so the messages read stay in place
    const keepFromBottom = useRef<number | null>(null);

    // "Reading…" shows only once the read has taken the delay, so a fast one never flashes (D8): one re-render then. A
    // `now` older than `since` reads as not yet, so no re-render is needed at the start.
    useEffect(() => {
        if (since == null) {
            return;
        }
        const wait = Math.max(0, since + PEEK_READING_DELAY_MS - Date.now());
        const t = setTimeout(() => setNow(Date.now()), wait + 5);
        return () => clearTimeout(t);
    }, [since]);

    // every session switch starts at the newest message (D5); a re-render of the same answer leaves the scroll where the
    // person put it
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el != null) {
            el.scrollTop = el.scrollHeight;
        }
    }, [session.id, result]);

    // an older page landed above: the scroll keeps its distance from the bottom, so what was read does not jump
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el != null && keepFromBottom.current != null) {
            el.scrollTop = el.scrollHeight - keepFromBottom.current;
            keepFromBottom.current = null;
        }
    }, [current.o.messages]);

    const loadOlder = () => {
        const el = scrollRef.current;
        const o = current.o;
        if (el == null || result == null || o.cursor == null) {
            return;
        }
        if (!peekOlderWanted(o, { top: el.scrollTop, client: el.clientHeight, height: el.scrollHeight })) {
            return;
        }
        const key = { base: result, id: session.id };
        const cursor = o.cursor;
        setOlder({ ...key, o: peekOlderBegin(o) });
        // an answer for a pick or a read since replaced lands nowhere
        const apply = (next: (o: PeekOlder) => PeekOlder) =>
            setOlder((prev) => (prev.base === key.base && prev.id === key.id ? { ...prev, o: next(prev.o) } : prev));
        fetchOlder(session, cursor).then(
            (page) => {
                const at = scrollRef.current;
                keepFromBottom.current = at == null ? null : at.scrollHeight - at.scrollTop;
                apply((prev) => peekOlderLoaded(prev, page));
            },
            (e) => apply((prev) => peekOlderFailed(prev, errorText(e)))
        );
    };

    // messages that do not fill the pane leave nothing to scroll: it reads on by itself until they do, or the start
    useEffect(() => {
        loadOlder();
    }, [current.o, result]);

    return (
        <section
            aria-label="Quick look"
            data-launcher-peek
            data-peek-session={session.id}
            data-peek-state={view.state}
            className="flex min-h-0 min-w-0 flex-col bg-surface"
        >
            <div className="flex shrink-0 flex-col gap-px border-b border-border py-[9px] pl-[18px] pr-[14px]">
                <span className="truncate text-[13.5px] font-semibold text-primary">{sessionTitle(session)}</span>
                <span className="truncate text-[11.5px] text-muted">
                    {peekMeta(session, Date.now())}
                    {view.messages.length > 0
                        ? current.o.cursor != null
                            ? ` · last ${view.messages.length} messages, scroll up for more`
                            : ` · ${view.messages.length} messages`
                        : ""}
                </span>
            </div>
            <div
                ref={scrollRef}
                data-peek-scroll
                onScroll={loadOlder}
                className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-3"
            >
                {/* a new answer fades in, so moving between sessions reads as the pane following the pick */}
                <motion.div
                    key={`${session.id}:${view.state}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                    className="flex flex-col"
                >
                    {view.showReading ? (
                        <div data-peek-reading className="mt-3 text-[12px] text-muted">
                            Reading…
                        </div>
                    ) : null}
                    {view.error != null ? (
                        <div data-peek-error title={view.error} className="mt-3 truncate text-[12px] text-error">
                            Can't read this session: {view.error}
                        </div>
                    ) : null}
                    {view.top != null ? (
                        <div
                            data-peek-top
                            title={view.top}
                            className="mt-3 shrink-0 truncate text-center text-[11.5px] text-muted"
                        >
                            {view.top}
                        </div>
                    ) : null}
                    {view.line != null ? (
                        <div data-peek-empty className="mt-3 text-[12px] text-muted">
                            {view.line}
                        </div>
                    ) : null}
                    {/* keyed from the newest, so a page landing above leaves the rows below as they are */}
                    {view.messages.map((m, i) => (
                        <PeekRow key={view.messages.length - i} m={m} />
                    ))}
                </motion.div>
            </div>
        </section>
    );
}
