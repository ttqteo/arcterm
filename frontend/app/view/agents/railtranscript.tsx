// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail's Transcript tab: the agent's whole conversation, drawn beside its terminal
// (docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md). It reads the recent part of the transcript first,
// the last CHUNK_LINES lines, and the lines before them as the reader scrolls up or steps back through the compactions.
// While the agent works it appends the lines written since, by byte offset, never reading the file again. The decisions
// are railtranscriptmodel.ts's; the draw is CompactTranscript, which already draws earlier items on reaching the top.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { focusTerm } from "@/app/view/term/termpaste";
import { cn } from "@/util/util";
import { useAtomValue, type Atom } from "jotai";
import { FoldVertical } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { railTranscriptFocusAtom } from "./agentrailstore";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { groupCompact } from "./compacttimeline";
import { CompactTranscript } from "./compacttranscript";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { AgentPathLinks } from "./pathlinkcontext";
import { railVisibleAtom } from "./railstore";
import {
    appendLines,
    appendThrottle,
    compactionStep,
    firstWindow,
    keyOffsetAfter,
    prependChunk,
    shouldStream,
    showsCompactions,
    type LoadedWindow,
    type ReadAnswer,
} from "./railtranscriptmodel";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { projectorFor } from "./transcriptregistry";
import { TranscriptSkeleton } from "./transcriptskeleton";

// lines in the first read, and in each earlier chunk (Conversation History reads the same tail)
const CHUNK_LINES = 2000;
// a compaction marker scrolled to is left this far below the pinned prompt's band (or the top, with none), and the page
// settles for these many ms after: the band draws a frame after the scroll, and the items drawn above the marker can take
// the room it needs
const MARKER_GAP_PX = 8;
const MARKER_SETTLE_MS = [0, 120, 320];
const NO_ENTRIES: AgentEntry[] = [];

// the tab's loaded part and what is drawn from it. `entries` are the projection of every loaded line, `keyOffset` how many
// entries the loads have put in front of the first read's (CompactTranscript's keys and folds stay with their items), and
// `epoch` changes on each fresh read of the tail, which starts the draw over
interface View {
    path: string;
    win: LoadedWindow;
    entries: AgentEntry[];
    keyOffset: number;
    epoch: number;
    scroll?: { index: number; nonce: number };
}

// the focus bump the tab last handled, kept outside the component: the bump of a key press can land before the tab
// mounts (it was not showing), and a later mount from a plain tab click sees that same value and must not take focus
let handledFocusBump = 0;

function answerOf(rtn: CommandGetAgentTranscriptRtnData): ReadAnswer {
    return { lines: rtn.lines ?? [], start: rtn.start, total: rtn.total, end: rtn.end, partial: rtn.partial };
}

// pi's parent-linked active branch needs the whole file, so it reads it whole and never loads earlier (as livetranscript.ts)
function wholeFile(runtime: string | undefined, path: string): boolean {
    return runtime?.toLowerCase() === "pi" || path.replace(/\\/g, "/").includes("/.pi/agent/sessions/");
}

type Load = "loaded" | "reread" | "stale" | "failed";

function useTranscriptWindow(path: string, runtime: string | undefined) {
    const [view, setView] = useState<View | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [noEarlier, setNoEarlier] = useState(false);
    const viewRef = useRef<View | null>(null);
    const ctx = useRef({ path, runtime });
    ctx.current = { path, runtime };
    const token = useRef(0); // changes with the transcript: an answer for an older one is dropped
    const epoch = useRef(0);
    const nonce = useRef(0);
    const tailing = useRef(false);
    const appending = useRef(false);
    const stamped = useRef(false); // a stamp came while a read was in flight
    const lastReadAt = useRef<number | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const chunk = useRef<Promise<Load> | null>(null);
    const stepping = useRef(false);
    const lastShown = useRef<number | null>(null); // the key (entry index less keyOffset) of the marker the last press showed
    const latest = useRef<() => void>(() => {});

    const commit = (next: View | null) => {
        viewRef.current = next;
        setView(next);
    };
    const fail = (what: string, e: unknown) => {
        console.warn(`${what} ${ctx.current.path} failed`, e);
        setError(e instanceof Error ? e.message : String(e));
    };
    const project = (lines: string[]) => projectorFor(ctx.current.runtime, ctx.current.path).project(lines);

    // the recent part, from the end: the first read, and again when what follows cannot be joined to it
    async function readTail(mine: number): Promise<void> {
        const { path: at, runtime: rt } = ctx.current;
        tailing.current = true;
        lastReadAt.current = performance.now();
        try {
            const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, {
                path: at,
                maxlines: wholeFile(rt, at) ? -1 : CHUNK_LINES,
            });
            if (mine !== token.current) {
                return;
            }
            const win = firstWindow(answerOf(rtn));
            epoch.current += 1;
            lastShown.current = null;
            setNoEarlier(false);
            setError(null);
            commit({ path: at, win, entries: project(win.lines), keyOffset: 0, epoch: epoch.current });
        } catch (e) {
            if (mine === token.current) {
                fail("reading transcript", e);
            }
        } finally {
            if (mine === token.current) {
                tailing.current = false;
                if (stamped.current) {
                    stamped.current = false;
                    latest.current();
                }
            }
        }
    }

    // the lines before the loaded ones, put in front. One read at a time: callers that ask meanwhile share it
    function loadChunk(): Promise<Load> {
        if (chunk.current != null) {
            return chunk.current;
        }
        const mine = token.current;
        const run: Promise<Load> = (async (): Promise<Load> => {
            const cur = viewRef.current;
            if (cur == null || cur.win.start === 0) {
                return "stale";
            }
            try {
                const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, {
                    path: cur.path,
                    maxlines: CHUNK_LINES,
                    before: cur.win.start,
                });
                const now = viewRef.current;
                if (mine !== token.current || now == null) {
                    return "stale";
                }
                const next = prependChunk(now.win, answerOf(rtn));
                if (next === "reread") {
                    await readTail(mine);
                    return "reread";
                }
                const entries = project(next.lines);
                setError(null);
                commit({
                    ...now,
                    win: next,
                    entries,
                    keyOffset: keyOffsetAfter(now.keyOffset, now.entries.length, entries.length),
                });
                return "loaded";
            } catch (e) {
                if (mine === token.current) {
                    fail("reading earlier transcript", e);
                }
                return "failed";
            }
        })().finally(() => {
            if (chunk.current === run) {
                chunk.current = null;
            }
        });
        chunk.current = run;
        return run;
    }

    // CompactTranscript reached its first item. It asks once per item count, so keep loading until a chunk brings an item
    // (one that projects to nothing would not be asked for again) or the start of the file
    async function loadEarlier(): Promise<void> {
        for (;;) {
            const cur = viewRef.current;
            if (cur == null || cur.win.start === 0) {
                return;
            }
            const items = groupCompact(cur.entries).length;
            if ((await loadChunk()) !== "loaded") {
                return;
            }
            const now = viewRef.current;
            if (now == null || now.win.start === 0 || groupCompact(now.entries).length > items) {
                return;
            }
        }
    }

    // the lines the agent wrote since the window's end, by byte offset
    async function readAppend(mine: number): Promise<void> {
        const cur = viewRef.current;
        if (cur == null) {
            // the first read has not landed (or failed): read the tail now
            if (!tailing.current) {
                await readTail(mine);
            }
            return;
        }
        if (cur.win.end <= 0) {
            // nothing complete to read from (a file with no newline yet): the tail again
            await readTail(mine);
            return;
        }
        appending.current = true;
        lastReadAt.current = performance.now();
        try {
            const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, { path: cur.path, frombyte: cur.win.end });
            const now = viewRef.current;
            // a fresh read of the tail landed meanwhile: these lines are already in it
            if (mine !== token.current || now == null || now.epoch !== cur.epoch) {
                return;
            }
            const next = appendLines(now.win, { lines: rtn.lines ?? [], end: rtn.end, reset: rtn.reset });
            if (next === "reread") {
                await readTail(mine);
            } else if (next !== now.win) {
                commit({ ...now, win: next, entries: project(next.lines) });
            }
            setError(null);
        } catch (e) {
            if (mine === token.current) {
                fail("appending to transcript", e);
            }
        } finally {
            if (mine === token.current) {
                appending.current = false;
                if (stamped.current) {
                    stamped.current = false;
                    latest.current();
                }
            }
        }
    }

    // each activity stamp from the live stream asks for an append, at most one read in APPEND_INTERVAL_MS
    function requestAppend(): void {
        const mine = token.current;
        const decision = appendThrottle({
            lastReadAt: lastReadAt.current,
            inFlight: appending.current || tailing.current,
            now: performance.now(),
        });
        if (decision.do === "wait") {
            stamped.current = true;
        } else if (decision.do === "later") {
            if (timer.current == null) {
                timer.current = window.setTimeout(
                    () => {
                        timer.current = undefined;
                        latest.current();
                    },
                    Math.max(0, decision.at - performance.now())
                );
            }
        } else {
            void readAppend(mine);
        }
    }
    latest.current = requestAppend;

    // a press of Compactions: the next older marker, loading earlier chunks until one is in hand or the file starts
    async function stepCompaction(): Promise<void> {
        if (stepping.current) {
            return;
        }
        stepping.current = true;
        const mine = token.current;
        try {
            for (;;) {
                const cur = viewRef.current;
                if (cur == null) {
                    return;
                }
                const last = lastShown.current == null ? null : lastShown.current + cur.keyOffset;
                const step = compactionStep(cur.entries, last, cur.win.start === 0);
                if (typeof step === "number") {
                    lastShown.current = step - cur.keyOffset;
                    setNoEarlier(false);
                    nonce.current += 1;
                    commit({ ...cur, scroll: { index: step, nonce: nonce.current } });
                    return;
                }
                if (step === "none-left") {
                    setNoEarlier(true);
                    return;
                }
                if ((await loadChunk()) !== "loaded" || mine !== token.current) {
                    return;
                }
            }
        } finally {
            stepping.current = false;
        }
    }

    // a new transcript (or the first) starts over; leaving cancels what is in flight
    useEffect(() => {
        const mine = ++token.current;
        viewRef.current = null;
        setView(null);
        setError(null);
        setNoEarlier(false);
        chunk.current = null;
        appending.current = false;
        tailing.current = false;
        stamped.current = false;
        stepping.current = false;
        lastShown.current = null;
        lastReadAt.current = null;
        if (path) {
            void readTail(mine);
        }
        return () => {
            token.current += 1;
            if (timer.current != null) {
                window.clearTimeout(timer.current);
                timer.current = undefined;
            }
        };
    }, [path, runtime]);

    return {
        // the window belongs to its own transcript: right after a switch the old one is not shown
        view: view != null && view.path === path ? view : null,
        error,
        noEarlier,
        loadEarlier,
        stepCompaction,
        requestAppend,
    };
}

export function RailTranscript({ agent, surfaceAtom }: { agent: AgentVM; surfaceAtom: Atom<string> }) {
    const path = agent.transcriptPath ?? "";
    const surface = useAtomValue(surfaceAtom);
    const railOpen = useAtomValue(railVisibleAtom);
    // the tab is mounted only while it is the shown one
    const streaming = shouldStream({ surface, railOpen, shownTab: "transcript" });
    const { view, error, noEarlier, loadEarlier, stepCompaction, requestAppend } = useTranscriptWindow(
        path,
        agent.agent
    );
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(view?.entries ?? NO_ENTRIES);

    // the live stream only says the file grew: each stamp asks for an append read. It runs while the tab is seen, and
    // what was written while it was not is read when it is seen again
    const streamId = path ? `rail-transcript:${agent.id}:${path}` : "";
    useEffect(() => {
        if (!streaming || !streamId) {
            return;
        }
        startTranscriptStream(streamId, path, agent.agent);
        requestAppend();
        return () => stopTranscriptStream(streamId);
    }, [streaming, streamId]);
    const stamp = useAtomValue(activityAtomFor(streamId));
    useEffect(() => {
        if (stamp != null && streaming) {
            requestAppend();
        }
    }, [stamp]);

    // Mod+Shift+F: focus goes to the scroller, so PgUp and PgDn read the conversation
    const bump = useAtomValue(railTranscriptFocusAtom);
    useEffect(() => {
        if (bump !== handledFocusBump) {
            handledFocusBump = bump;
            scrollRef.current?.focus({ preventScroll: true });
        }
    }, [bump]);

    // CompactTranscript scrolls the marker to the scroller's top, where the pinned prompt's band covers it: scroll back
    // until it is below the band. The marker is the first one at or below the top, and a check that finds it clear does nothing
    const scrollNonce = view?.scroll?.nonce;
    useLayoutEffect(() => {
        if (scrollNonce == null) {
            return;
        }
        const clearBand = () => {
            const el = scrollRef.current;
            if (el == null) {
                return;
            }
            const top = el.getBoundingClientRect().top;
            const band = el.querySelector("[data-pinned-prompt] > div")?.getBoundingClientRect().bottom;
            const want = (band != null ? band - top : 0) + MARKER_GAP_PX;
            const marker = [...el.querySelectorAll<HTMLElement>("[data-compact-compaction]")]
                .map((m) => m.getBoundingClientRect().top - top)
                .find((offset) => offset >= -2);
            if (marker != null && marker < want) {
                el.scrollTop = Math.max(0, el.scrollTop - (want - marker));
            }
        };
        const frame = requestAnimationFrame(clearBand);
        const timers = MARKER_SETTLE_MS.map((ms) => window.setTimeout(clearBand, ms));
        return () => {
            cancelAnimationFrame(frame);
            timers.forEach((t) => window.clearTimeout(t));
        };
    }, [scrollNonce]);

    const showCompactions = view != null && showsCompactions(view.entries, view.win);
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {showCompactions ? (
                <div className="flex flex-none items-center gap-2 border-b border-edge-faint px-[18px] py-[6px]">
                    <button
                        type="button"
                        data-rail-compactions
                        title="Scroll to the next earlier compaction"
                        onClick={() => void stepCompaction()}
                        className="flex cursor-pointer items-center gap-[5px] rounded-[6px] border border-edge-mid bg-surface-raised px-[9px] py-[3px] text-[12px] text-secondary outline-none hover:border-edge-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <FoldVertical size={12} aria-hidden />
                        Compactions
                    </button>
                    {noEarlier ? (
                        <span data-rail-compactions-none className="text-[11.5px] text-muted">
                            No earlier compactions
                        </span>
                    ) : null}
                </div>
            ) : null}
            {error != null && view != null ? <ErrorLine reason={error} className="px-[18px]" /> : null}
            <div className="relative min-h-0 flex-1">
                <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    tabIndex={0}
                    // it handles its own keys (the arrows and PgUp / PgDn scroll it), so the surface's letter keys stand down
                    data-owns-keys
                    data-rail-transcript={agent.id}
                    data-loaded-start={view?.win.start}
                    data-loaded-lines={view?.win.lines.length}
                    onKeyDown={(e) => {
                        if (e.key === "Escape" && agent.blockId) {
                            e.preventDefault();
                            e.stopPropagation();
                            focusTerm(agent.blockId);
                        }
                    }}
                    // no top padding: the pinned prompt's band sticks at the padding edge, which let a line show above it
                    className="h-full overflow-y-auto px-[18px] pb-[12px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                    {view == null ? (
                        error != null ? (
                            <ErrorLine reason={error} />
                        ) : (
                            <TranscriptSkeleton className="pt-3" />
                        )
                    ) : view.entries.length > 0 ? (
                        <AgentPathLinks agent={agent}>
                            <CompactTranscript
                                key={`${view.path}:${view.epoch}`}
                                entries={view.entries}
                                active={false}
                                keyOffset={view.keyOffset}
                                scrollTo={view.scroll}
                                onReachStart={() => void loadEarlier()}
                            />
                        </AgentPathLinks>
                    ) : (
                        <div className="flex h-full items-center justify-center text-[12px] text-muted">
                            Nothing in this conversation yet.
                        </div>
                    )}
                </div>
                <JumpToLatestPill show={!atBottom} onClick={jumpToBottom} />
            </div>
        </div>
    );
}

// a read that failed, with the reason: the tab is never empty without a word
function ErrorLine({ reason, className }: { reason: string; className?: string }) {
    return (
        <div
            data-rail-transcript-error
            role="alert"
            className={cn("flex-none py-[8px] text-[12px] leading-[1.5] text-error", className)}
        >
            Could not read the transcript: {reason}
        </div>
    );
}
