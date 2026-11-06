// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New agent dialog's resume step reads the picked Claude session here, beside the session list: its last 5
// messages drawn as the transcript draws them, your message in a box and Claude's reply as formatted prose
// (docs/superpowers/specs/2026-11-06-launcher-session-peek-design.md, "The resume step"). The read, its states and the
// meta line are launcherpeek.ts; the dialog (launchermodal.tsx) owns when the step shows and which session it reads.
// The pane fills the step's height and scrolls inside with the app's shared scrollbar.

import { MOTION } from "@/app/element/motiontokens";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    PEEK_COUNT,
    PEEK_READING_DELAY_MS,
    peekMeta,
    peekView,
    type PeekMessage,
    type PeekState,
} from "./launcherpeek";
import { sessionTitle } from "./launcherresume";
import { MarkdownMessage } from "./markdownmessage";

interface LauncherPeekPaneProps {
    // the picked past session (New session keeps the three columns, so the pane never shows for it)
    session: SessionInfo;
    // the read of this session; loading until it answers
    peek: PeekState;
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

export function LauncherPeekPane({ session, peek }: LauncherPeekPaneProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [now, setNow] = useState(() => Date.now());
    const view = peekView(peek, now);
    const since = peek.status === "loading" ? peek.since : null;

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
    const result = peek.status === "done" ? peek.result : null;
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el != null) {
            el.scrollTop = el.scrollHeight;
        }
    }, [session.id, result]);

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
                    {peekMeta(session, Date.now())} · last {PEEK_COUNT} messages
                </span>
            </div>
            <div ref={scrollRef} data-peek-scroll className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-3">
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
                    {view.line != null ? (
                        <div data-peek-empty className="mt-3 text-[12px] text-muted">
                            {view.line}
                        </div>
                    ) : null}
                    {view.note != null ? (
                        <div data-peek-note className="mt-3 shrink-0 text-[11.5px] text-muted">
                            {view.note}
                        </div>
                    ) : null}
                    {view.messages.map((m, i) => (
                        <PeekRow key={i} m={m} />
                    ))}
                </motion.div>
            </div>
        </section>
    );
}
