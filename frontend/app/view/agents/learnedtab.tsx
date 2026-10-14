// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Learned: every line the user accepted, grouped by skill and by project, apart from the shipped text.
// LearnedLine is also the row of the Skills rail's "Your additions" block, so a line reads and edits the same in both.

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
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
    if (groups.length === 0) {
        return (
            <div
                data-testid="learned-empty"
                className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted"
            >
                Nothing learned yet. When you correct an agent the same way in two sessions, it asks you here first.
            </div>
        );
    }
    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mx-auto flex max-w-[760px] flex-col gap-5">
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
            </div>
        </div>
    );
}
