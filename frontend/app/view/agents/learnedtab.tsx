// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Learned: every line the user accepted, grouped by skill and by project, apart from the shipped text, and the
// short messages the person sends often, which Chat's suggested replies offer word for word (pkg/chatsuggest habits).
// LearnedLine is also the row of the Skills rail's "Your additions" block, so a line reads and edits the same in both.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { isNewLine, learnedGroups, lineMeta, localDate, type LearnedEntry } from "./learnedmodel";
import { amendLearned, loadLearned, setupBusyAtom, setupLearnedAtom } from "./setupstore";

const LINE_BTN =
    "h-6 cursor-pointer rounded border border-edge-mid bg-surface-raised px-2 text-[11.5px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";

export function LearnedLine({ line }: { line: LearnedEntry }) {
    const busy = useAtomValue(setupBusyAtom);
    // the edit input's text while it is open; null when it is not
    const [draft, setDraft] = useState<string | null>(null);
    const isNew = isNewLine(line.learned, localDate(new Date()));
    const save = () => {
        const text = (draft ?? "").trim();
        if (text === "") {
            return;
        }
        setDraft(null);
        if (text !== line.text) {
            fireAndForget(() => amendLearned(line, { text }));
        }
    };
    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
        } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
        }
    };
    return (
        <div
            data-learned-line={line.id}
            className={cn("flex flex-col gap-1.5 border-l-2 border-accent py-2 pl-3 pr-2.5", isNew && "bg-accentbg")}
        >
            {draft != null ? (
                <input
                    data-testid="learned-edit-input"
                    aria-label="Edit this line"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    className="h-[30px] min-w-0 rounded-[7px] border border-edge-mid bg-background px-2.5 text-[13px] text-primary outline-none focus:border-accent"
                />
            ) : (
                <div className="text-[13px] leading-[1.45] text-secondary">{line.text}</div>
            )}
            <div className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-muted">{lineMeta(line)}</span>
                <span className="flex-1" />
                <button
                    type="button"
                    data-testid="learned-edit"
                    disabled={busy || draft != null}
                    onClick={() => setDraft(line.text)}
                    className={LINE_BTN}
                >
                    Edit
                </button>
                <button
                    type="button"
                    data-testid="learned-remove"
                    disabled={busy}
                    onClick={() => fireAndForget(() => amendLearned(line, { remove: true }))}
                    className={LINE_BTN}
                >
                    Remove
                </button>
            </div>
        </div>
    );
}

export function LearnedTab() {
    const accepted = useAtomValue(setupLearnedAtom);
    // re-read on every visit: an agent's proposal accepted from Needs you lands here
    useEffect(() => {
        fireAndForget(loadLearned);
    }, []);
    if (accepted == null) {
        return <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>;
    }
    const groups = learnedGroups(accepted);
    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mx-auto flex max-w-[760px] flex-col gap-5">
                {groups.length === 0 ? (
                    <div data-testid="learned-empty" className="px-6 py-10 text-center text-[13px] text-muted">
                        Nothing learned yet. When you correct an agent the same way in two sessions, it asks you here
                        first.
                    </div>
                ) : null}
                {groups.map((g) => (
                    <section key={g.key} aria-label={g.title} className="flex flex-col gap-2">
                        <div className="flex items-baseline gap-2">
                            <span className={cn(REGION_LABEL, "text-muted")}>{g.title}</span>
                            {g.subtitle != null ? (
                                <span title={g.subtitle} className="min-w-0 truncate text-[11px] text-muted">
                                    {g.subtitle}
                                </span>
                            ) : null}
                        </div>
                        <div className="flex flex-col gap-1">
                            {g.lines.map((l) => (
                                <LearnedLine key={l.id} line={l} />
                            ))}
                        </div>
                    </section>
                ))}
                <UsualReplies />
            </div>
        </div>
    );
}

// the habits are read from every Claude Code transcript of the month: a first read after an install takes a few seconds
const HABITS_TIMEOUT_MS = 60_000;

// The short messages the person sends often, counted over their Claude Code sessions of the last 30 days: Chat's
// suggested replies offer one word for word when it is the turn's next step. Taking one out keeps it out for good.
function UsualReplies() {
    const [habits, setHabits] = useState<ChatHabit[] | null>(null);
    const read = async () => {
        try {
            const rtn = await RpcApi.ChatHabitsCommand(TabRpcClient, { timeout: HABITS_TIMEOUT_MS });
            setHabits(rtn?.habits ?? []);
        } catch {
            setHabits([]);
        }
    };
    useEffect(() => {
        fireAndForget(read);
    }, []);
    const remove = (h: ChatHabit) => {
        setHabits((cur) => cur?.filter((x) => x.key !== h.key) ?? cur);
        // read again after: the next most used takes its place
        fireAndForget(async () => {
            await RpcApi.ChatHabitHideCommand(TabRpcClient, { key: h.key });
            await read();
        });
    };
    return (
        <section aria-label="Your usual replies" data-learned-habits="" className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
                <span className={cn(REGION_LABEL, "text-muted")}>Your usual replies</span>
                <span className="min-w-0 truncate text-[11px] text-muted">
                    sent 3 times or more in 30 days; Chat suggests one when it fits
                </span>
            </div>
            {habits == null ? (
                <div className="text-[12.5px] text-muted">Reading your sessions…</div>
            ) : habits.length === 0 ? (
                <div data-learned-habits-empty="" className="text-[12.5px] text-muted">
                    None yet. A short message you send three times shows up here.
                </div>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {habits.map((h) => (
                        <span
                            key={h.key}
                            data-learned-habit={h.key}
                            className="flex h-[28px] max-w-[340px] items-center gap-1.5 rounded-full border border-edge-mid bg-surface pl-[11px] pr-1 text-[12.5px] text-secondary"
                        >
                            <span className="min-w-0 truncate">{h.text}</span>
                            <span className="flex-none text-[11px] tabular-nums text-muted">{h.uses}×</span>
                            <button
                                type="button"
                                data-learned-habit-remove=""
                                aria-label={`Remove “${h.text}”`}
                                title="Remove: Chat no longer suggests it"
                                onClick={() => remove(h)}
                                className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                <X size={12} strokeWidth={2} aria-hidden />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </section>
    );
}
