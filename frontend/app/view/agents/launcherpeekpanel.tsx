// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New agent dialog's Quick look panel: a Claude session's last 5 messages, under the columns and over the footer
// (docs/superpowers/specs/2026-11-06-launcher-session-peek-design.md D3–D5, D8). The read, its states and the text
// split are launcherpeek.ts; the dialog (launchermodal.tsx) owns when the panel is open and which session it reads. The
// panel is a fixed ~170px and scrolls inside with the app's shared scrollbar; in a short window it gives its height up
// before the Task box and the columns do, down to about two messages.

import { cn } from "@/util/util";
import { Eye, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    PEEK_READING_DELAY_MS,
    peekMeta,
    peekView,
    splitFences,
    type PeekMessage,
    type PeekState,
} from "./launcherpeek";
import { sessionTitle } from "./launcherresume";

interface LauncherPeekPanelProps {
    session: SessionInfo;
    // the read of this session; loading until it answers
    peek: PeekState;
    // Open asleep is disabled when the footer's own launch would be (an image still writing, a launch under way)
    asleepDisabled: boolean;
    onAsleep: () => void;
    onClose: () => void;
}

function MessageText({ text }: { text: string }) {
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {splitFences(text).map((seg, i) =>
                seg.code ? (
                    <div
                        key={i}
                        className="whitespace-pre-wrap break-words rounded-[6px] bg-surface-code px-2 py-1.5 font-mono text-[11.5px] leading-[1.5] text-secondary"
                    >
                        {seg.text}
                    </div>
                ) : (
                    <div key={i} className="whitespace-pre-wrap break-words">
                        {seg.text}
                    </div>
                )
            )}
        </div>
    );
}

function PeekRow({ m }: { m: PeekMessage }) {
    const you = m.role === "user";
    return (
        <div data-peek-msg data-role={you ? "user" : "assistant"} className="flex shrink-0 gap-[10px]">
            <span
                className={cn("w-[52px] shrink-0 pt-px text-[11px] font-semibold", you ? "text-muted" : "text-accent")}
            >
                {you ? "You" : "Claude"}
            </span>
            <div className={cn("flex min-w-0 flex-1", you ? "text-secondary" : "text-primary")}>
                <MessageText text={m.text} />
            </div>
        </div>
    );
}

export function LauncherPeekPanel({ session, peek, asleepDisabled, onAsleep, onClose }: LauncherPeekPanelProps) {
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

    // on open, and on every session switch, the panel starts at the newest message (D5); a re-render of the same
    // answer leaves the scroll where the person put it
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
            className="mx-[18px] my-3 flex h-[170px] min-h-[100px] flex-col gap-2 overflow-hidden rounded-[10px] border border-edge-strong bg-surface px-[14px] py-[10px] [flex-shrink:100]"
        >
            <div className="flex shrink-0 items-center gap-2">
                <Eye size={14} strokeWidth={2} className="shrink-0 text-muted" />
                <span className="min-w-0 max-w-[45%] shrink-0 truncate text-[13px] font-semibold text-primary">
                    {sessionTitle(session)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                    {peekMeta(session, Date.now())}
                </span>
                <button
                    type="button"
                    data-peek-asleep
                    disabled={asleepDisabled}
                    title="Open it asleep: its transcript in the sidebar, started when you wake it or send a message"
                    onClick={onAsleep}
                    className="flex h-[26px] shrink-0 cursor-pointer items-center rounded-[7px] border border-edge-mid bg-surface-raised px-2.5 text-[12px] font-semibold text-secondary hover:bg-surface-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                >
                    Open asleep
                </button>
                <button
                    type="button"
                    tabIndex={-1}
                    data-peek-close
                    aria-label="Close Quick look"
                    title="Close Quick look (Esc)"
                    onClick={onClose}
                    className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary"
                >
                    <X size={13} strokeWidth={2} />
                </button>
            </div>
            <div
                ref={scrollRef}
                data-peek-scroll
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto text-[12.5px] leading-[1.55]"
            >
                {view.showReading ? (
                    <div data-peek-reading className="text-[12px] text-muted">
                        Reading…
                    </div>
                ) : null}
                {view.error != null ? (
                    <div data-peek-error title={view.error} className="truncate text-[12px] text-error">
                        Can't read this session: {view.error}
                    </div>
                ) : null}
                {view.line != null ? (
                    <div data-peek-empty className="text-[12px] text-muted">
                        {view.line}
                    </div>
                ) : null}
                {view.note != null ? (
                    <div data-peek-note className="shrink-0 text-[11.5px] text-muted">
                        {view.note}
                    </div>
                ) : null}
                {view.messages.map((m, i) => (
                    <PeekRow key={i} m={m} />
                ))}
            </div>
        </section>
    );
}
