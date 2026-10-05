// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The subagent interior: a child's transcript rendered as narration in the focused view's center pane,
// swapped in over the (kept-mounted) parent terminal. Tails the child's own transcript file via the
// shared livetranscript stream (keyed sub:<agentId>); breadcrumb / Esc returns to the parent.

import { MOTION } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useEffect } from "react";
import { liveEntriesByIdAtom, startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { NarrationTimeline } from "./narrationtimeline";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { focusSubagentAtom, type FocusSubagent } from "./subagentsstore";
import { TranscriptSkeleton } from "./transcriptskeleton";

export function SubagentInterior({ sub, parentName }: { sub: FocusSubagent; parentName: string }) {
    const streamId = `sub:${sub.agentId}`;
    useEffect(() => {
        startTranscriptStream(streamId, sub.transcriptPath, "claude");
        return () => stopTranscriptStream(streamId);
    }, [streamId, sub.transcriptPath]);

    // Esc-to-return lives in the global keybinding registry (subagent:back in bindings.ts) so it
    // respects the typing-guard and shares one mechanism; the breadcrumb button uses `back` directly.
    const back = () => globalStore.set(focusSubagentAtom, null);

    const entries = useAtomValue(liveEntriesByIdAtom)[streamId] ?? [];
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries);
    return (
        <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
        >
            <div className="flex shrink-0 items-center gap-2 border-b border-edge-mid bg-surface px-3 py-2 text-[11px]">
                <button type="button" onClick={back} title="Back to parent (Esc)" className="cursor-pointer text-muted hover:text-primary">
                    ◂ {parentName}
                </button>
                <span className="text-edge-strong">›</span>
                <span className="text-accent">{sub.label}</span>
            </div>
            <div className="relative min-h-0 flex-1">
                <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-2">
                    {entries.length > 0 ? (
                        <NarrationTimeline entries={entries} accentLatest active />
                    ) : (
                        <TranscriptSkeleton />
                    )}
                </div>
                {!atBottom ? <JumpToLatestPill onClick={jumpToBottom} /> : null}
            </div>
        </motion.div>
    );
}
