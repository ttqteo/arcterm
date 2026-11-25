// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pair read again, read-only (the board of docs/superpowers/specs/2026-11-25-ended-pairs-readable-design.md): a pair that
// ended, one synced from the other machine, or a live one opened off the Agent surface. Library places it (a detail pane or
// a full-width view), so it takes no Back row of its own. Left: the header (who, when, why, tokens), the thread as
// PairConversation draws it without its controls, and the foot line with a link to each agent's transcript. Right: the
// Decided list at the rail's width, read-only too. The thread and the list scroll on their own. The words are
// pairreadmodel.ts's and pairpanemodel.ts's.

import { useAtomValue } from "jotai";
import { useState } from "react";
import { RAIL_OVERVIEW_PX } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import { GHOST_BUTTON, PairConversation } from "./pairpane";
import { readFootLine } from "./pairpanemodel";
import { pairReadHeader, pairTranscripts } from "./pairreadmodel";
import { loadPair, pairViewErrorAtom, usePairView } from "./pairstore";
import { RailDecidedPane } from "./raildecidedpane";

const ROOT = "flex min-h-0 min-w-0 flex-1 bg-background text-[14px] text-primary";
const LINK =
    "cursor-pointer rounded-[3px] border-0 bg-transparent p-0 text-[12.5px] text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent";

/** One pair, read-only. `openSession` gets a transcript link's selection key (`<harness>:<session id>`): the caller says
 *  where a session opens. */
export function PairReadView({
    model,
    pairId,
    openSession,
}: {
    model: AgentsViewModel;
    pairId: string;
    openSession: (sel: string) => void;
}) {
    const view = usePairView(pairId);
    const error = useAtomValue(pairViewErrorAtom(pairId));
    const [retrying, setRetrying] = useState(false);

    if (view == null) {
        // a pair already on screen keeps its last read when a later one fails, so the error shows only before the first
        const retry = () => {
            setRetrying(true);
            // loadPair logs and never rejects
            void loadPair(pairId).finally(() => setRetrying(false));
        };
        return (
            <section
                data-pair-read={pairId}
                aria-label="Pair, read-only"
                className={`${ROOT} items-center justify-center`}
            >
                {error != null ? (
                    <div
                        role="alert"
                        data-pair-read-error
                        className="flex max-w-[480px] flex-col items-center gap-3 px-6 text-center text-[13px]"
                    >
                        <span className="break-words text-error-soft">This pair did not read: {error}</span>
                        <button type="button" disabled={retrying} onClick={retry} className={GHOST_BUTTON}>
                            Retry
                        </button>
                    </div>
                ) : (
                    <div data-pair-read-loading className="text-[13px] text-muted">
                        Loading the conversation…
                    </div>
                )}
            </section>
        );
    }

    const header = pairReadHeader(view);
    const links = pairTranscripts(view);
    return (
        <section data-pair-read={view.id} aria-label="Pair, read-only" className={ROOT}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <header
                    data-pair-read-header
                    className="flex h-[44px] flex-none items-center gap-[10px] border-b border-border bg-surface px-4 text-[13px]"
                >
                    <span data-pair-read-title className="min-w-0 truncate font-semibold" title={header.title}>
                        {header.title}
                    </span>
                    <span
                        data-pair-read-line
                        className="ml-auto min-w-0 truncate text-[12.5px] tabular-nums text-muted"
                        title={header.line}
                    >
                        {header.line}
                    </span>
                </header>
                {/* keyed by the pair: another pair opens on a clean timeline */}
                <PairConversation key={view.id} model={model} view={view} readOnly />
                <footer
                    data-pair-read-foot
                    className="flex flex-none flex-wrap items-center gap-x-[6px] gap-y-1 border-t border-border px-4 py-[10px] text-[12.5px] text-muted"
                >
                    <span>{readFootLine(view)}</span>
                    {links.length > 0 ? (
                        <>
                            <span>Transcripts:</span>
                            {links.map((l, i) => (
                                <span key={l.sel} className="flex items-center gap-[6px]">
                                    {i > 0 ? <span aria-hidden>·</span> : null}
                                    <button
                                        type="button"
                                        data-pair-read-transcript={l.sel}
                                        title="Open this agent's transcript"
                                        onClick={() => openSession(l.sel)}
                                        className={LINK}
                                    >
                                        {l.label}
                                    </button>
                                </span>
                            ))}
                        </>
                    ) : null}
                </footer>
            </div>
            <aside
                data-pair-read-decided
                style={{ width: RAIL_OVERVIEW_PX }}
                className="flex min-h-0 flex-none flex-col border-l border-border bg-background"
            >
                <h2 className="m-0 flex h-[44px] flex-none items-center border-b border-border px-[12px] text-[13px] font-semibold">
                    Decided
                </h2>
                <RailDecidedPane key={view.id} view={view} readOnly />
            </aside>
        </section>
    );
}
