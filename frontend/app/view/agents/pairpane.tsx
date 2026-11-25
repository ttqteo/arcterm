// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pair's conversation, the centre column's `pair` mode (agentcenter.ts; board R1's centre, spec docs/superpowers/specs/
// 2026-11-25-agent-pair-judge-design.md): the working agent's messages lean left, a judge's right, the person's run across
// the width, in time order, every one in full. A message that answers another quotes its line at the top (a click scrolls
// there), Reply on hover answers that message, and a heavy command the hold refused is the dashed line in the message that
// held it, with Run now. One composer at the bottom talks to both, or to one with @worker / @judge. There are no rounds
// here: nothing counts them. The rows are pairmodel.ts's timelineRows; the words are pairpanemodel.ts's.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowUp, Reply, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type RefObject,
} from "react";
import { pairSelAtom, showTerminal } from "./agentcenter";
import { shortTabId } from "./agentrowmodel";
import type { AgentsViewModel } from "./agents";
import { CouncilText } from "./councilchat";
import { useNow } from "./narrationtimeline";
import { composerTarget, timelineRows, type PairRow } from "./pairmodel";
import { judgeStatus, messageClock, quoteLine } from "./pairpanemodel";
import { markPairSeen, pairScrollToAtom, usePairView } from "./pairstore";

const ROOT = "flex min-h-0 min-w-0 flex-1 flex-col bg-background text-[14px] text-primary";
const GHOST_BUTTON =
    "h-[26px] flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[12.5px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const PROSE = "text-[13.5px] leading-[1.55] text-ink-hi";

// the timeline keeps following new messages while the person is within this far of its end; scrolled up to read, it stays put
const STICK_PX = 80;
// how long the message a quote jumped to stays marked
const FLASH_MS = 1200;
const COMPOSER_MAX_PX = 168;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// a held command is told apart by its message and its text: one message holds a command once
const heldKey = (msgId: string, command: string) => `${msgId}\n${command}`;

export function PairPane({ model }: { model: AgentsViewModel }) {
    const pairId = useAtomValue(pairSelAtom);
    const view = usePairView(pairId);
    if (view == null) {
        // nothing is read yet (or the pair is gone): the way back stays, so the centre is never a dead end
        return (
            <section data-pair-pane aria-label="Pair conversation" className={ROOT}>
                <header className="flex h-[44px] flex-none items-center gap-[10px] border-b border-border bg-surface px-4 text-[13px]">
                    <button type="button" data-pair-back onClick={showTerminal} className={GHOST_BUTTON}>
                        Back to chat
                    </button>
                </header>
                <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
                    Loading the conversation…
                </div>
            </section>
        );
    }
    // keyed by the pair: another pair opens on a clean timeline and composer
    return <PairConversation key={view.id} model={model} view={view} />;
}

function PairConversation({ model, view }: { model: AgentsViewModel; view: PairView }) {
    const rows = useMemo(() => timelineRows(view), [view]);
    const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
    const reduced = useReducedMotion();
    const scroller = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const stick = useRef(true);
    const [flash, setFlash] = useState<string | null>(null);
    const [reply, setReply] = useState<PairRow | null>(null);
    // the held commands Run now is sending, or has let through: the let-through mark is kept until wavesrv's own (`runts`)
    // arrives with the next pair:update
    const [heldNow, setHeldNow] = useState<ReadonlyMap<string, "pending" | "through">>(new Map());
    const [unpairing, setUnpairing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ended = view.state === "ended";
    // the messages there when the conversation opened are drawn in place; one that arrives after it grows in
    const [openedWith] = useState(() => new Set(rows.map((r) => r.id)));
    const errorPart = usePartMotion(springReveal);

    // the person has it in front of them: what it holds counts as seen, and so does each message that arrives while it shows
    useEffect(() => {
        markPairSeen(view.id);
    }, [view.id, rows.length]);

    // follows the end of the timeline while the person is there: a message that grows in (or a block that draws late) moves
    // the end, so it is the content's size that is watched, not the message count
    useLayoutEffect(() => {
        const el = scroller.current;
        const inner = content.current;
        if (el == null || inner == null) {
            return;
        }
        const follow = () => {
            if (stick.current) {
                el.scrollTop = el.scrollHeight;
            }
        };
        follow();
        const ro = new ResizeObserver(follow);
        ro.observe(inner);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (flash == null) {
            return;
        }
        const t = setTimeout(() => setFlash(null), FLASH_MS);
        return () => clearTimeout(t);
    }, [flash]);

    const jumpTo = useCallback(
        (id: string) => {
            const el = scroller.current?.querySelector<HTMLElement>(`[data-pair-msg="${CSS.escape(id)}"]`);
            if (el == null) {
                return;
            }
            el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
            setFlash(id);
        },
        [reduced]
    );

    // an agreed item's link (the rail) names the message it was settled in: scroll there, once
    const scrollTo = useAtomValue(pairScrollToAtom);
    useEffect(() => {
        if (scrollTo == null) {
            return;
        }
        jumpTo(scrollTo);
        globalStore.set(pairScrollToAtom, null);
    }, [scrollTo, jumpTo]);

    const onScroll = () => {
        const el = scroller.current;
        if (el != null) {
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }
    };

    const startReply = (row: PairRow) => {
        setReply(row);
        input.current?.focus();
    };

    const setHeld = (key: string, state: "pending" | "through" | null) =>
        setHeldNow((prev) => {
            const next = new Map(prev);
            if (state == null) {
                next.delete(key);
            } else {
                next.set(key, state);
            }
            return next;
        });

    const runNow = async (row: PairRow, command: string) => {
        const key = heldKey(row.id, command);
        if (heldNow.has(key)) {
            return;
        }
        setHeld(key, "pending");
        try {
            await RpcApi.PairRunNowCommand(TabRpcClient, { pairid: view.id, msgid: row.id, command });
            setHeld(key, "through");
            setError(null);
        } catch (err) {
            console.error("pair: run now failed", err);
            setHeld(key, null);
            setError(`Run now failed: ${errorText(err)}`);
        }
    };

    const unpair = async () => {
        if (unpairing) {
            return;
        }
        setUnpairing(true);
        try {
            await RpcApi.PairUnpairCommand(TabRpcClient, { pairid: view.id });
            showTerminal();
        } catch (err) {
            console.error("pair: unpair failed", err);
            setError(`Unpair failed: ${errorText(err)}`);
            setUnpairing(false);
        }
    };

    return (
        <section data-pair-pane={view.id} aria-label="Pair conversation" className={ROOT}>
            <PairBar model={model} view={view} busy={unpairing} onUnpair={() => void unpair()} />
            <div
                ref={scroller}
                data-pair-timeline
                onScroll={onScroll}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-[18px]"
            >
                <div ref={content} className="flex flex-col gap-3">
                    {rows.length === 0 ? (
                        <div data-pair-empty className="py-6 text-center text-[13px] text-muted">
                            No messages yet.
                        </div>
                    ) : null}
                    {rows.map((row) => (
                        <PairMessage
                            key={row.id}
                            row={row}
                            quotedWho={row.quoteId != null ? (byId.get(row.quoteId)?.who ?? "") : ""}
                            enters={!openedWith.has(row.id)}
                            flashing={flash === row.id}
                            heldNow={heldNow}
                            onQuote={jumpTo}
                            onReply={startReply}
                            onRunNow={(command) => void runNow(row, command)}
                        />
                    ))}
                </div>
            </div>
            <AnimatePresence initial={false}>
                {error != null ? (
                    <motion.div key="error" {...errorPart} className="flex-none overflow-hidden">
                        <div role="alert" data-pair-error className="px-5 pb-1 text-[12.5px] text-error-soft">
                            {error}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
            {ended ? (
                <div data-pair-ended className="flex-none border-t border-border px-5 py-3 text-[13px] text-muted">
                    This pair has ended.
                </div>
            ) : (
                <PairComposer
                    view={view}
                    reply={reply}
                    inputRef={input}
                    onClearReply={() => setReply(null)}
                    onError={setError}
                />
            )}
        </section>
    );
}

// ---- top bar ----

function PairBar({
    model,
    view,
    busy,
    onUnpair,
}: {
    model: AgentsViewModel;
    view: PairView;
    busy: boolean;
    onUnpair: () => void;
}) {
    const focusId = useAtomValue(model.focusIdAtom);
    const judges = view.judges ?? [];
    // back goes to the Chat of the agent in focus: the working agent's when its Paired button opened this, a judge's when
    // the judge's header did, so the name on the button is the one whose Chat it returns to
    const back = [view.worker, ...judges].find((s) => s.tab === focusId) ?? view.worker;
    return (
        <header
            data-pair-bar
            className="flex h-[44px] flex-none items-center gap-[10px] border-b border-border bg-surface px-4 text-[13px]"
        >
            <button
                type="button"
                data-pair-back
                title={`Back to ${back.name}'s Chat`}
                onClick={showTerminal}
                className="min-w-0 max-w-[40%] flex-none cursor-pointer truncate rounded-[4px] text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
            >
                {back.name}
            </button>
            <span aria-hidden className="text-ink-faint">
                /
            </span>
            <span data-pair-title className="min-w-0 truncate font-semibold">
                {view.state === "ended" ? (
                    "Pair ended"
                ) : judges.length === 1 ? (
                    <>
                        Paired with judge{" "}
                        <span className="font-mono text-[11.5px] font-normal text-muted">
                            {shortTabId(judges[0].tab)}
                        </span>
                    </>
                ) : (
                    `Paired with ${judges.length} judges`
                )}
            </span>
            <div className="flex-1" />
            <JudgeStates model={model} judges={judges} />
            {view.state === "ended" ? null : (
                <button type="button" data-pair-unpair disabled={busy} onClick={onUnpair} className={GHOST_BUTTON}>
                    Unpair
                </button>
            )}
        </header>
    );
}

// each judge's state, read from the roster and ticking: its own component, so the second's tick redraws these words and
// not the conversation
function JudgeStates({ model, judges }: { model: AgentsViewModel; judges: PairSide[] }) {
    const roster = useAtomValue(model.agentsAtom);
    const now = useNow(judges.length > 0);
    const several = judges.length > 1;
    return (
        <span
            data-pair-judge-states
            className="flex min-w-0 items-center gap-3 overflow-hidden text-[12.5px] text-muted"
        >
            {judges.map((j) => (
                <span key={j.tab} data-pair-judge-state={j.tab} className="truncate tabular-nums">
                    {several ? `judge ${shortTabId(j.tab)} ` : "judge "}
                    {judgeStatus(
                        roster.find((a) => a.id === j.tab),
                        j,
                        now
                    )}
                </span>
            ))}
        </span>
    );
}

// ---- one message ----

type MessageProps = {
    row: PairRow;
    quotedWho: string;
    // it arrived after the conversation opened: it grows in on springReveal instead of being drawn in place
    enters: boolean;
    flashing: boolean;
    heldNow: ReadonlyMap<string, "pending" | "through">;
    onQuote: (id: string) => void;
    onReply: (row: PairRow) => void;
    onRunNow: (command: string) => void;
};

// the worker's block is the page's own surface, a judge's the raised one, the person's a stronger edge across the width
const BLOCK: Record<Exclude<PairRow["side"], "system">, string> = {
    left: "w-[70%] max-w-[760px] border-edge-mid bg-surface",
    right: "w-[70%] max-w-[760px] border-edge-mid bg-surface-raised",
    wide: "w-full border-edge-strong bg-pill",
};

function PairMessage({ row, quotedWho, enters, flashing, heldNow, onQuote, onReply, onRunNow }: MessageProps) {
    const part = usePartMotion(springReveal);
    const arrive = { ...part, initial: enters ? part.initial : (false as const) };
    if (row.side === "system") {
        return (
            <motion.div
                data-pair-msg={row.id}
                data-side="system"
                {...arrive}
                className="self-center overflow-hidden text-center text-[12px] leading-[1.5] text-muted"
            >
                {row.text}
                <span className="ml-2 tabular-nums text-ink-faint">{messageClock(row.ts)}</span>
            </motion.div>
        );
    }
    return (
        <motion.div
            data-pair-msg={row.id}
            data-side={row.side}
            {...arrive}
            className={cn("flex overflow-hidden", row.side === "right" ? "justify-end" : "justify-start")}
        >
            <article
                className={cn(
                    "group flex min-w-0 flex-col gap-[6px] rounded-[10px] border px-[13px] py-[11px] transition-colors duration-300 motion-reduce:transition-none",
                    BLOCK[row.side],
                    // the message a quote jumped to: its edge, which the wrapper's clip leaves whole (a ring would be cut)
                    flashing && "border-accent/60"
                )}
            >
                <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span className="min-w-0 truncate font-semibold text-primary" title={row.who}>
                        {row.who}
                    </span>
                    {row.judge != null ? (
                        <span data-pair-judge-name className="flex-none font-mono text-[11px]">
                            {row.judge}
                        </span>
                    ) : null}
                    {row.toLabel !== "" ? <span className="flex-none whitespace-nowrap">to {row.toLabel}</span> : null}
                    <span className="flex-none tabular-nums">{messageClock(row.ts)}</span>
                    {row.side === "wide" ? null : (
                        <button
                            type="button"
                            data-pair-reply
                            title="Reply to this message"
                            onClick={() => onReply(row)}
                            className="ml-auto flex cursor-pointer items-center gap-1 rounded-[5px] px-[6px] py-[2px] text-[12px] text-muted opacity-0 outline-none transition-opacity hover:bg-hover hover:text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 motion-reduce:transition-none"
                        >
                            <Reply size={12} strokeWidth={2} aria-hidden />
                            Reply
                        </button>
                    )}
                </div>
                {row.quote != null ? <Quote row={row} who={quotedWho} onQuote={onQuote} /> : null}
                <CouncilText text={row.text} className={PROSE} refs commands />
                {row.held.map((h) => {
                    const sending = heldNow.get(heldKey(row.id, h.command));
                    const through = h.runts != null || sending === "through";
                    return (
                        <div
                            key={h.command}
                            data-pair-held={through ? "through" : "held"}
                            className="flex items-center gap-2 rounded-[7px] border border-dashed border-edge-strong px-[9px] py-[6px] text-[12px] text-secondary"
                        >
                            <span className="min-w-0 flex-1 truncate" title={h.command}>
                                Held for the judge:{" "}
                                <span className="font-mono text-[11px] text-code-inline">{h.command}</span>
                            </span>
                            {through ? (
                                <span data-pair-through className="flex-none text-muted">
                                    let through
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    data-pair-run-now
                                    disabled={sending === "pending"}
                                    onClick={() => onRunNow(h.command)}
                                    className="flex-none cursor-pointer rounded-[4px] text-accent outline-none hover:text-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
                                >
                                    Run now
                                </button>
                            )}
                        </div>
                    );
                })}
            </article>
        </motion.div>
    );
}

// the line a message answers, at its top: a button to that message when it is in the conversation, plain text when not
function Quote({ row, who, onQuote }: { row: PairRow; who: string; onQuote: (id: string) => void }) {
    const body = (
        <>
            {who !== "" ? (
                <>
                    <span className="text-secondary">{who}</span>{" "}
                </>
            ) : null}
            {row.quote}
        </>
    );
    const base =
        "block w-full truncate rounded-[6px] bg-background px-[9px] py-[5px] text-left text-[12.5px] text-muted";
    return row.quoteId != null ? (
        <button
            type="button"
            data-pair-quote={row.quoteId}
            title="Go to the message this answers"
            onClick={() => onQuote(row.quoteId!)}
            className={cn(
                base,
                "cursor-pointer outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            )}
        >
            {body}
        </button>
    ) : (
        <div data-pair-quote="" className={base}>
            {body}
        </div>
    );
}

// ---- composer ----

type ComposerProps = {
    view: PairView;
    reply: PairRow | null;
    // the conversation holds the field's ref: a Reply on a message focuses it
    inputRef: RefObject<HTMLTextAreaElement | null>;
    onClearReply: () => void;
    onError: (message: string | null) => void;
};

function PairComposer({ view, reply, inputRef, onClearReply, onError }: ComposerProps) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const chipPart = usePartMotion(springReveal);
    // a bare @worker names a target and says nothing: nothing to send
    const target = composerTarget(text, view);
    const canSend = target.text !== "" && !busy;

    useLayoutEffect(() => {
        const el = inputRef.current;
        if (el != null) {
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
        }
    }, [text, inputRef]);

    const send = async () => {
        if (!canSend) {
            return;
        }
        setBusy(true);
        try {
            await RpcApi.PairSayCommand(TabRpcClient, {
                pairid: view.id,
                text: target.text,
                to: target.to,
                replyto: reply?.id ?? "",
            });
            setText("");
            onClearReply();
            onError(null);
        } catch (err) {
            console.error("pair: say failed", err);
            onError(`Not sent: ${errorText(err)}`);
        } finally {
            setBusy(false);
        }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) {
            return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
        } else if (e.key === "Escape" && reply != null) {
            e.preventDefault();
            e.stopPropagation();
            onClearReply();
        }
    };

    return (
        <div className="flex-none border-t border-border px-4 py-3">
            <div
                data-pair-composer-box
                className="flex flex-col rounded-[18px] border border-edge-mid bg-surface-raised py-[9px] pl-4 pr-[9px] focus-within:border-edge-strong"
            >
                {/* the chip opens and folds on springReveal, so the box grows by it instead of jumping; its gap to the field is
                    inside it, or it would be left behind when it folds */}
                <AnimatePresence initial={false}>
                    {reply != null ? (
                        <motion.div key="reply" {...chipPart} className="overflow-hidden">
                            <div
                                data-pair-reply-chip
                                className="flex items-center gap-2 pr-1 pb-[6px] text-[12px] text-muted"
                            >
                                <Reply size={12} strokeWidth={2} aria-hidden className="flex-none" />
                                <span className="min-w-0 flex-1 truncate">
                                    Replying to <span className="text-secondary">{reply.who}</span>:{" "}
                                    {quoteLine(reply.text)}
                                </span>
                                <button
                                    type="button"
                                    data-pair-reply-cancel
                                    aria-label="Cancel reply"
                                    onClick={onClearReply}
                                    className="flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-[4px] outline-none hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    <X size={12} strokeWidth={2} aria-hidden />
                                </button>
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
                <div className="flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        data-pair-composer
                        rows={1}
                        value={text}
                        placeholder="Talk to both… · @worker or @judge for one"
                        aria-label="Message the pair"
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={onKeyDown}
                        className="min-h-[24px] min-w-0 flex-1 resize-none bg-transparent py-[2px] text-[13.5px] leading-[1.5] text-primary outline-none placeholder:text-muted"
                    />
                    <button
                        type="button"
                        data-pair-send
                        aria-label="Send"
                        disabled={!canSend}
                        onClick={() => void send()}
                        className="flex size-[28px] flex-none cursor-pointer items-center justify-center rounded-full bg-primary text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised disabled:cursor-default disabled:opacity-30"
                    >
                        <ArrowUp size={15} strokeWidth={2.4} aria-hidden />
                    </button>
                </div>
            </div>
        </div>
    );
}
