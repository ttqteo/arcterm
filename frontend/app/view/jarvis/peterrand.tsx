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

import { HarnessPicker } from "@/app/view/agents/harnesspicker";
import { harnessPreferenceAtom, harnessesAtom } from "@/app/view/agents/harnessstore";
import { MarkdownMessage } from "@/app/view/agents/markdownmessage";
import { channelProjectLabel } from "@/app/view/agents/projectlabel";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { sendErrand } from "./petactrun";
import { petErrandState } from "./peterrandmodel";
import { petErrandAtom, type PetErrand as PetErrandState } from "./petstore";

const REPLY_STATUS: Record<PetErrandState["status"], { dot: string; word: string }> = {
    streaming: { dot: "bg-accent", word: "thinking" },
    done: { dot: "bg-success", word: "replied" },
    error: { dot: "bg-error", word: "failed" },
};

// The reply in its own inset box. Bounded and scrolling inside itself: a reply arriving into a popover must
// not grow the popover, and the queue above must keep its scroll position.
function ErrandReply({ errand }: { errand: PetErrandState }) {
    const status = REPLY_STATUS[errand.status];
    return (
        <div className="rounded-[8px] border border-border bg-surface px-[9px] py-[7px]">
            <div className="mb-[3px] flex items-center gap-1.5 text-[9.5px] text-muted">
                <span className={cn("h-[5px] w-[5px] flex-none rounded-full", status.dot)} />
                {errand.runtime} · {status.word}
            </div>
            <div className="max-h-[180px] overflow-y-auto text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">
                {errand.status === "error" ? (
                    <p className="whitespace-pre-wrap text-error">{errand.text}</p>
                ) : (
                    <>
                        <MarkdownMessage text={errand.text} />
                        {errand.status === "streaming" ? <span className="text-accent">▍</span> : null}
                    </>
                )}
            </div>
        </div>
    );
}

export function PetErrand({
    dest,
    channels,
    onPick,
    compact = false,
    showPrompt = false,
}: {
    dest: Channel | null;
    channels: Channel[] | null;
    onPick: (oid: string) => void;
    compact?: boolean;
    // folded float: the chat shows what you asked above the reply
    showPrompt?: boolean;
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

    return (
        <div data-pet-composer className="flex flex-none flex-col gap-1.5 border-t border-border p-2.5">
            {showPrompt && errand != null ? (
                <div className="max-w-[80%] self-end rounded-[10px] bg-surface-hover px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-primary [overflow-wrap:anywhere]">
                    {errand.prompt}
                </div>
            ) : null}
            {errand != null ? <ErrandReply errand={errand} /> : null}

            {/* Two rows, by frequency rather than by symmetry. Typing happens constantly; the harness and
                the destination are picked once and then left alone. Sharing one row made the three compete
                for a 420px panel, and the field you use every time lost — it kept ~130px while a channel
                name like "git-compare-parity-81920" truncated to "#git-compa" anyway. The design drew them
                on one row against a 10-character "#wave-core", which real per-task names do not resemble. */}
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

            <div className="flex min-w-0 items-center gap-1.5">
                <HarnessPicker
                    operation="consult"
                    placement="top-start"
                    className={compact ? "min-w-0 max-w-[110px]" : undefined}
                />
                {options.length > 0 ? (
                    <select
                        data-pet-errand-dest
                        aria-label="Where the reply lands"
                        // still titled: the longest per-task names outrun even a full row
                        title={dest != null ? `Reply lands in ${channelProjectLabel(dest, projects)}` : undefined}
                        value={dest?.oid ?? ""}
                        onChange={(event) => onPick(event.target.value)}
                        className={cn(
                            "h-6 min-w-0 flex-none truncate rounded-[7px] border border-border bg-surface px-2 text-[10.5px] text-ink-mid hover:border-edge-mid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            compact ? "max-w-[142px]" : "max-w-[240px]"
                        )}
                    >
                        {/* no "→" glyph: the project name already reads as a destination and the arrow
                            only costs width */}
                        {options.map((channel) => (
                            <option key={channel.oid} value={channel.oid}>
                                {channelProjectLabel(channel, projects)}
                            </option>
                        ))}
                    </select>
                ) : null}
                {blocker != null ? (
                    <span className="flex min-w-0 flex-1 items-center gap-[5px] text-[10.5px] text-warning-soft">
                        <span className="h-[5px] w-[5px] flex-none rounded-full bg-warning" />
                        <span className="truncate">{blocker}</span>
                    </span>
                ) : null}
            </div>
        </div>
    );
}
