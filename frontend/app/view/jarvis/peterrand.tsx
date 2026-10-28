// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Somewhere to type. The panel used to say "ask me anything" in prose and offer no input at all, which is
// the same defect as a row that names its own remedy and no button.
//
// Its own file rather than more of petpeek.tsx: the reply streams, which means state and an effect, and the
// peek is a readout of things decided elsewhere.
//
// The destination is the composer's own control now, not a reading of the Jarvis surface — see
// petPeekDestAtom. It states where the reply lands exactly once: the old footer said it three times ("No
// channel selected", "Select a channel to ask Jarvis", "No destination") inside a 90px band.

import { useSettle } from "@/app/element/motionhooks";
import { composerReveal, viewFade } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { HarnessPicker } from "@/app/view/agents/harnesspicker";
import { harnessPreferenceAtom, harnessesAtom } from "@/app/view/agents/harnessstore";
import { MarkdownMessage } from "@/app/view/agents/markdownmessage";
import { channelProjectLabel } from "@/app/view/agents/projectlabel";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { sendErrand } from "./petactrun";
import { petErrandState } from "./peterrandmodel";
import { petErrandAtom, type PetErrand as PetErrandState } from "./petstore";

const REPLY_STATUS: Record<PetErrandState["status"], { dot: string; word: string }> = {
    streaming: { dot: "bg-working pulse-dot", word: "thinking" },
    done: { dot: "bg-success", word: "replied" },
    error: { dot: "bg-error", word: "failed" },
};

// The reply in its own inset box. Bounded and scrolling inside itself: a reply arriving into a popover must
// not grow the popover, and the queue above must keep its scroll position.
function ErrandReply({ errand }: { errand: PetErrandState }) {
    const status = REPLY_STATUS[errand.status];
    const streaming = errand.status === "streaming";
    const settling = useSettle(errand.status === "done");
    return (
        <motion.div
            variants={composerReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn(
                "relative overflow-hidden rounded-[8px] border border-border bg-surface px-[9px] py-[7px]",
                settling && "animate-[settle_0.5s_ease-out] motion-reduce:animate-none"
            )}
        >
            {/* the streaming flow bar, as on a working agent card: absolute so its leaving never moves the reply */}
            {streaming ? (
                <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden">
                    <div className="h-full w-[26%] bg-gradient-to-r from-transparent via-accent to-transparent animate-[flowBar_1.9s_linear_infinite] motion-reduce:animate-none" />
                </div>
            ) : null}
            <div className="mb-[3px] flex items-center gap-1.5 text-[9.5px] text-muted">
                <span className={cn("h-[5px] w-[5px] flex-none rounded-full transition-colors", status.dot)} />
                <span className="flex-1">
                    {errand.runtime} ·{" "}
                    <motion.span key={errand.status} variants={viewFade} initial="initial" animate="animate">
                        {status.word}
                    </motion.span>
                </span>
                {/* not while streaming: the next chunk would write the reply straight back */}
                {!streaming ? (
                    <button
                        type="button"
                        data-pet-errand-dismiss
                        aria-label="Dismiss reply"
                        onClick={() => globalStore.set(petErrandAtom, null)}
                        className="-my-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <X aria-hidden="true" size={12} strokeWidth={2} />
                    </button>
                ) : null}
            </div>
            <div className="max-h-[180px] overflow-y-auto text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">
                {errand.status === "error" ? (
                    <p className="whitespace-pre-wrap text-error">{errand.text}</p>
                ) : (
                    <>
                        <MarkdownMessage text={errand.text} />
                        {streaming ? <span className="pulse-soft font-mono text-accent">▍</span> : null}
                    </>
                )}
            </div>
        </motion.div>
    );
}

export function PetErrand({
    dest,
    channels,
    onPick,
    compact = false,
    showPrompt = false,
    askable = true,
}: {
    dest: Channel | null;
    channels: Channel[] | null;
    onPick: (oid: string) => void;
    compact?: boolean;
    // folded float: the chat shows what you asked above the reply
    showPrompt?: boolean;
    // false: no field, only a reply already under way (folded, where you look rather than ask)
    askable?: boolean;
}) {
    const errand = useAtomValue(petErrandAtom);
    const pref = useAtomValue(harnessPreferenceAtom);
    const harnesses = useAtomValue(harnessesAtom);
    const projects = useAtomValue(projectsAtom);
    const [draft, setDraft] = useState("");

    const busy = errand?.status === "streaming";
    const state = petErrandState({
        channel: dest != null,
        draft,
        busy,
        runtime: pref.route?.runtime ?? "",
        saving: pref.saving,
        harnesses,
    });
    const options = channels ?? [];
    const placeholder =
        dest == null ? "No project to send to yet" : busy ? "Jarvis is thinking" : "Ask Jarvis anything";
    // only a reason that BLOCKS a ready draft earns a line. An empty draft and a missing destination are
    // both already visible — the field is empty, the picker says where — and the harness chip already
    // reads "saving", so they render nothing.
    const blocker =
        state.reason != null &&
        !["empty draft", "no channel active", "busy", "saving harness preference…"].includes(state.reason)
            ? state.reason
            : null;

    const send = () => {
        const prompt = draft.trim();
        if (!prompt || state.submitDisabled || dest == null) {
            return;
        }
        setDraft("");
        fireAndForget(() => sendErrand(dest.oid, state.runtime, prompt));
    };

    if (!askable && errand == null) {
        return null;
    }

    return (
        <div data-pet-composer className="flex flex-none flex-col gap-1.5 border-t border-border p-2.5">
            {showPrompt && errand != null ? (
                <div className="max-w-[80%] self-end rounded-[10px] bg-surface-hover px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-primary [overflow-wrap:anywhere]">
                    {errand.prompt}
                </div>
            ) : null}
            {/* initial={false}: opening the peek on a standing reply shows it, only a new ask reveals one */}
            <AnimatePresence initial={false}>
                {errand != null ? <ErrandReply key="reply" errand={errand} /> : null}
            </AnimatePresence>

            {askable ? (
                <>
                    {/* The field gets the whole row: typing happens constantly, while the harness and the
                        destination are picked once and left alone, so they sit under it as one line of muted text
                        that only says where the question goes. */}
                    <div className="flex items-center gap-1.5">
                        <input
                            data-pet-errand-input
                            aria-label="Ask Jarvis"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    send();
                                }
                            }}
                            disabled={state.inputDisabled}
                            placeholder={placeholder}
                            className="h-8 min-w-0 flex-1 rounded-[8px] border border-border bg-background px-2.5 text-[11.5px] text-secondary placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-70"
                        />
                        <button
                            type="button"
                            onClick={send}
                            disabled={state.submitDisabled}
                            className="h-8 flex-none rounded-[8px] bg-accent px-3.5 text-[11px] font-bold text-background hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:bg-surface-hover disabled:text-muted"
                        >
                            Ask
                        </button>
                    </div>

                    <div className="-ml-1 flex min-w-0 items-center gap-0.5 text-[10.5px] text-muted">
                        <HarnessPicker operation="consult" placement="top-start" bare />
                        {options.length > 0 ? (
                            <>
                                <span aria-hidden>·</span>
                                <label className="relative flex min-w-0 items-center text-muted hover:text-primary">
                                    <select
                                        data-pet-errand-dest
                                        aria-label="Where the reply lands"
                                        // still titled: the longest per-task names outrun the line
                                        title={
                                            dest != null
                                                ? `Reply lands in ${channelProjectLabel(dest, projects)}`
                                                : undefined
                                        }
                                        value={dest?.oid ?? ""}
                                        onChange={(event) => onPick(event.target.value)}
                                        className={cn(
                                            "min-w-0 cursor-pointer appearance-none truncate rounded-[5px] bg-transparent py-0.5 pl-1 pr-4 font-medium text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                            compact ? "max-w-[142px]" : "max-w-[240px]"
                                        )}
                                    >
                                        {options.map((channel) => (
                                            <option key={channel.oid} value={channel.oid}>
                                                {channelProjectLabel(channel, projects)}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown
                                        size={11}
                                        aria-hidden
                                        className="pointer-events-none absolute right-1 flex-none"
                                    />
                                </label>
                            </>
                        ) : null}
                        {blocker != null ? (
                            <span className="ml-1 flex min-w-0 flex-1 items-center gap-[5px] text-warning-soft">
                                <span className="h-[5px] w-[5px] flex-none rounded-full bg-warning" />
                                <span className="truncate">{blocker}</span>
                            </span>
                        ) : null}
                    </div>
                </>
            ) : null}
        </div>
    );
}
