// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The File tab's view of Live output (a background task's output file, a server's log): its lines in their program's
// colours (outputlines.tsx), as the task's peek draws them, where Monaco would show the escape codes as text. It keeps
// to the end while followed and the reader is there, and is the tab's [data-md-doc], so Mod+F opens the find bar over it.

import { cn } from "@/util/util";
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { FileRef } from "./agentrailtabs";
import { outputTextLines } from "./ansitext";
import { savedScroll, saveScroll } from "./filescroll";
import { OutputLines } from "./outputlines";

const COLORS = { fg: "var(--color-secondary)", bg: "var(--color-surface-code)" };

export function LiveOutput({
    fileRef,
    text,
    wrap,
    following,
    stickRef,
}: {
    fileRef: FileRef;
    text: string;
    wrap: boolean;
    following: boolean;
    /** true while the view ends at the bottom: new output then keeps it there */
    stickRef: MutableRefObject<boolean>;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const lines = useMemo(() => outputTextLines(text), [text]);
    // opened: the end while followed, else where the reader left it
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el == null) {
            return;
        }
        const place = following ? undefined : savedScroll(fileRef, "source");
        el.scrollTop = place ?? el.scrollHeight;
    }, [fileRef]);
    // grown, or Live turned on: to the end while the reader is there
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el != null && following && stickRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [lines, following, stickRef]);
    const onScroll = () => {
        const el = scrollRef.current;
        // a hidden view lays out at no height and clamps to the top: not the reader's place
        if (el == null || el.clientHeight === 0) {
            return;
        }
        stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
        saveScroll(fileRef, "source", el.scrollTop);
    };
    return (
        <div
            ref={scrollRef}
            data-md-doc
            data-file-output={fileRef.abs}
            tabIndex={-1}
            onScroll={onScroll}
            className={cn(
                "min-h-0 flex-1 overflow-auto px-3.5 py-2.5 font-mono text-[12px] leading-[1.5] text-secondary outline-none",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
            )}
        >
            {lines.length === 0 ? <div className="text-muted">No output yet.</div> : null}
            <OutputLines lines={lines} colors={COLORS} />
        </div>
    );
}
