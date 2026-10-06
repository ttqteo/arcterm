// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The plan document being approved, read from a gated phase's artifact and rendered inline (and
// editable) so a plan can be reviewed without leaving Runs. Extracted from runbody.tsx — it is a
// self-contained load/edit/save component used only by the review-gate card.

import { SkeletonLine } from "@/app/element/skeleton";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { useEffect, useState } from "react";
import { MarkdownMessage } from "./markdownmessage";
import { planDirty } from "./runmodel";
import { fileTextOf, useFileText } from "./usefiletext";

// Above this many lines, the plan preview starts collapsed (with a line-count hint) so a long plan
// (plans run to ~2000 lines) doesn't render its whole DOM eagerly on every gate — you expand on
// demand. Small plans stay open. The read itself is unbounded up to wshfs's 32MB transfer limit.
const PLAN_PREVIEW_COLLAPSE_LINES = 400;

// The plan document being approved, read from the gated phase's artifact and rendered inline so you
// can review it without leaving Runs. Read-only and non-blocking: a missing/unreadable file shows a
// subtle line and never disables the gate's actions. One read per gate (only one gate is ever live).
export function PlanPreview({ path, onEditorReady }: { path: string; onEditorReady?: (flush: () => Promise<void>) => void }) {
    const [load, setLoad] = useFileText(path);
    const [override, setOverride] = useState<boolean | null>(null); // user's explicit collapse toggle; null = auto
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [saveErr, setSaveErr] = useState(false);

    useEffect(() => {
        setOverride(null);
        setEditing(false);
        setSaveErr(false);
    }, [path]);

    const save = async () => {
        try {
            await RpcApi.FileWriteCommand(TabRpcClient, { info: { path }, data64: stringToBase64(draft) });
            setLoad(fileTextOf(draft));
            setSaveErr(false);
            setEditing(false);
        } catch {
            setSaveErr(true); // keep the edit in the textarea; never silently drop it
        }
    };

    // let the gate flush a pending edit before it advances the run
    useEffect(() => {
        onEditorReady?.(async () => {
            if (editing && planDirty(draft, load.text)) {
                await save();
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing, draft, load.text]);

    const large = load.status === "ok" && load.lines > PLAN_PREVIEW_COLLAPSE_LINES;
    const open = editing || (override ?? !large); // editing forces the section open
    const filename = path.split(/[/\\]/).pop() ?? path;
    return (
        <div className="border-b border-asking/20">
            <div className="flex w-full items-center gap-2 px-3.5 py-2">
                <button type="button" onClick={() => setOverride(!open)} className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80">
                    <span className="text-xxxs text-asking">{open ? "▼" : "▶"}</span>
                    <span className="text-[9px] font-semibold uppercase tracking-[.1em] text-asking">Plan</span>
                    <span className="truncate text-[10.5px] tabular-nums text-muted">
                        {filename}
                        {load.status === "ok" ? ` · ${load.lines} lines` : ""}
                    </span>
                </button>
                {load.status === "ok" && !editing ? (
                    <button
                        type="button"
                        onClick={() => {
                            setDraft(load.text);
                            setEditing(true);
                        }}
                        className="flex-none rounded-sm border border-edge-mid px-2 py-0.5 text-[10px] text-ink-mid hover:border-edge-strong"
                    >
                        Edit
                    </button>
                ) : null}
                {editing ? (
                    <button
                        type="button"
                        onClick={() => fireAndForget(save)}
                        className="flex-none rounded-sm border border-accent/50 bg-accentbg/40 px-2 py-0.5 text-[10px] text-accent-soft hover:bg-accentbg/60"
                    >
                        Save
                    </button>
                ) : null}
            </div>
            {open ? (
                <div className="sc max-h-[320px] overflow-y-auto px-3.5 pb-3">
                    {editing ? (
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="h-[300px] w-full resize-none rounded border border-edge-mid bg-background px-3 py-2 font-mono text-[12px] leading-[1.5] text-secondary focus:outline-none"
                        />
                    ) : load.status === "loading" ? (
                        <div aria-hidden="true" className="flex flex-col gap-2 pt-1">
                            {["w-[45%]", "w-[85%]", "w-[75%]", "w-[60%]"].map((w, i) => (
                                <SkeletonLine key={i} className={cn("h-[11px]", w)} />
                            ))}
                        </div>
                    ) : load.status === "error" ? (
                        <span className="text-[12px] text-muted">Couldn't read plan · {filename}</span>
                    ) : (
                        <MarkdownMessage text={load.text} className="text-[12.5px] leading-[1.55] text-secondary" />
                    )}
                    {saveErr ? <div className="mt-1.5 text-[11px] text-error">Couldn't save the plan — try again.</div> : null}
                </div>
            ) : null}
        </div>
    );
}
