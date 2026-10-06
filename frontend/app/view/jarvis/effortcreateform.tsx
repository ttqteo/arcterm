// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Paste-and-tick effort creation: one line per chunk in the textarea, live checkbox rows below,
// ticked lines become status=done at save (two RPCs — the chunk seed carries no status field).

import { ModalShell } from "@/app/modals/modalshell";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { projectListAtom } from "@/app/view/agents/projectsstore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Fragment, useEffect, useState } from "react";
import { loadBriefingAsync, stateRpcTimeoutMs } from "./briefingstore";
import { briefUndo } from "./briefundo";
import { setEffortDetails, type EffortDetails } from "./effortstore";
import { ProjectChips } from "./projectchips";

export interface ParsedChunkLine {
    label: string;
    stage: string;
    checked: boolean;
}

// pure parse: one chunk per line, `Stage: chunk` groups it (split on the FIRST ": ", so a label may
// itself contain one after the stage). The preview shows stage headers, so a line that merely
// contains ": " is visible as a stage before anything is created. Ticks live in the form's state.
export function parseChunkLines(text: string): ParsedChunkLine[] {
    const lines: ParsedChunkLine[] = [];
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line === "") {
            continue;
        }
        const cut = line.indexOf(": ");
        const stage = cut > 0 ? line.slice(0, cut).trim() : "";
        const label = cut > 0 ? line.slice(cut + 2).trim() : line;
        lines.push({ label: label === "" ? line : label, stage: label === "" ? "" : stage, checked: false });
    }
    return lines;
}

const inputCls =
    "w-full rounded-[7px] border border-edge-mid bg-background px-2.5 py-1.5 text-[12px] text-primary placeholder:text-muted outline-none focus:border-accent/60";
const fieldLabel = "text-[10.5px] font-bold uppercase tracking-[.09em] text-ink-mid";

export function EffortCreateForm({
    onClose,
    edit,
}: {
    onClose: () => void;
    // details mode: the same fields over an existing initiative; its chunks are edited in the plan
    edit?: { oref: string; details: EffortDetails };
}) {
    const [title, setTitle] = useState(edit?.details.title ?? "");
    const [project, setProject] = useState(edit?.details.project ?? "");
    const [ticket, setTicket] = useState(edit?.details.ticket ?? "");
    const [parent, setParent] = useState(edit?.details.parent ?? "");
    const [text, setText] = useState("");
    const [lines, setLines] = useState<ParsedChunkLine[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [titleError, setTitleError] = useState<string | null>(null);
    const projects = useAtomValue(projectListAtom);

    // re-parse on text change, keeping ticks by label so a tick survives edits elsewhere in the list
    useEffect(() => {
        setLines((prev) => {
            const ticks = new Map(prev.map((l) => [l.label, l.checked]));
            return parseChunkLines(text).map((l) => ({ ...l, checked: ticks.get(l.label) ?? false }));
        });
    }, [text]);

    const ticked = lines.filter((l) => l.checked).length;
    const isDupe = (l: ParsedChunkLine, i: number) => lines.findIndex((x) => x.label === l.label) !== i;
    const dupes = lines.some(isDupe);
    const stages = new Set(lines.map((l) => l.stage)).size;
    const canSubmit = !submitting && title.trim() !== "" && (edit != null || !dupes);

    const submit = async (): Promise<void> => {
        setTitleError(title.trim() === "" ? "Title is required" : null);
        if (title.trim() === "") {
            return;
        }
        setError(null);
        setSubmitting(true);
        if (edit != null) {
            try {
                await setEffortDetails(edit.oref, edit.details, { title, project, ticket, parent });
                briefUndo.notify("Initiative updated");
                onClose();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setSubmitting(false);
            }
            return;
        }
        try {
            const parentOid = parent.trim().replace(/^effort:/, "");
            const rtn = await RpcApi.EffortCreateCommand(
                TabRpcClient,
                {
                    title: title.trim(),
                    project: project.trim() || undefined,
                    ticket: ticket.trim() || undefined,
                    parentoid: parentOid || undefined,
                    chunks: lines.map((l) => ({ label: l.label })),
                },
                { timeout: stateRpcTimeoutMs }
            );
            // the chunk seed carries neither status nor stage, so both land in one atomic follow-up batch
            const followOps: EffortOp[] = [
                ...lines
                    .filter((l) => l.stage !== "")
                    .map((l) => ({ op: "setChunkStage", chunk: l.label, stage: l.stage })),
                ...lines
                    .filter((l) => l.checked)
                    .map((l) => ({ op: "setChunkStatus", chunk: l.label, status: "done" })),
            ];
            if (followOps.length > 0) {
                await RpcApi.EffortMutateCommand(
                    TabRpcClient,
                    { effortoid: rtn.effortoid, ops: followOps, author: "you" },
                    { timeout: stateRpcTimeoutMs }
                );
            }
            void loadBriefingAsync();
            briefUndo.notify(`Created “${title.trim()}” · ${lines.length} chunks`);
            onClose();
        } catch (e) {
            // the effort may exist with all-pending chunks if the mutate failed — the documented fallback.
            setError(e instanceof Error ? e.message : String(e));
            setSubmitting(false);
        }
    };

    return (
        <ModalShell
            open
            onClose={onClose}
            onSubmit={() => void submit()}
            className="flex w-[min(580px,93vw)] flex-col"
        >
            <div className="flex shrink-0 items-center gap-[11px] border-b border-border px-[18px] py-[15px]">
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accentbg text-[10.5px] font-bold text-accent-soft">
                    ✦
                </div>
                <span className="flex-1 text-[15px] font-semibold text-primary">
                    {edit != null ? "Edit initiative" : "New initiative"}
                </span>
                <span className="rounded-[5px] border border-edge-mid px-[7px] py-0.5 text-[10.5px] text-ink-mid">
                    ctrl+⏎ to save
                </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-[13px] overflow-y-auto px-[18px] py-4">
                <div className="flex flex-col gap-1">
                    <span className={fieldLabel}>Title</span>
                    <input
                        autoFocus
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Scenario gate clearance"
                        className={cn(inputCls, "text-[12.5px]", titleError != null && "border-error/60")}
                    />
                    {titleError != null ? <span className="text-[11px] text-error">{titleError}</span> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                    <span className={fieldLabel}>Project</span>
                    {/* the project is optional, so pressing the picked chip again clears it */}
                    <ProjectChips
                        names={projects.map((p) => p.name)}
                        picked={project || null}
                        recent={null}
                        onPick={(name) => setProject((cur) => (cur === name ? "" : name))}
                        columns={1}
                        allowCustom
                    />
                </div>
                <div className="grid grid-cols-2 gap-[13px]">
                    <div className="flex flex-col gap-1">
                        <span className={fieldLabel}>Ticket</span>
                        <input
                            value={ticket}
                            onChange={(e) => setTicket(e.target.value)}
                            placeholder="optional"
                            className={inputCls}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className={fieldLabel}>Parent initiative</span>
                        <input
                            value={parent}
                            onChange={(e) => setParent(e.target.value)}
                            placeholder="optional · effort id"
                            className={cn(inputCls, "font-mono")}
                        />
                    </div>
                </div>
                {edit == null ? (
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-baseline gap-2">
                            <span className={fieldLabel}>Chunks · one per line</span>
                            <span className="text-[10.5px] text-muted">Stage: chunk to group</span>
                        </div>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={
                                "Phase 1: WAF posture scan\nPhase 1: Rule diff vs prod\nPhase 2: N1 box upgrade"
                            }
                            spellCheck={false}
                            className="min-h-[110px] w-full resize-y rounded-[7px] border border-edge-mid bg-background px-2.5 py-2 text-[11px] leading-[1.7] text-primary placeholder:text-muted outline-none focus:border-accent/60"
                        />
                        {lines.length > 0 ? (
                            <>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            "text-[10.5px] tabular-nums",
                                            dupes ? "text-error" : "text-ink-mid"
                                        )}
                                    >
                                        {dupes
                                            ? "duplicate chunk labels"
                                            : `${lines.length} chunks · ${stages} stage${stages === 1 ? "" : "s"} · ${ticked} done`}
                                    </span>
                                    <span className="flex-1" />
                                    <span className="text-[10.5px] text-muted">tick what's already done</span>
                                </div>
                                <div className="flex max-h-[170px] flex-col overflow-y-auto rounded-[7px] border border-edge-faint bg-surface px-2 py-1.5">
                                    {lines.map((l, i) => (
                                        <Fragment key={l.label + ":" + i}>
                                            {/* a header on every stage change, including the first unstaged
                                                line after a staged run (design L1672) */}
                                            {l.stage !== (i === 0 ? "" : lines[i - 1].stage) ? (
                                                <StageHeader label={l.stage || "unstaged"} />
                                            ) : null}
                                            <button
                                                type="button"
                                                aria-pressed={l.checked}
                                                onClick={() =>
                                                    setLines((prev) =>
                                                        prev.map((x, j) =>
                                                            j === i ? { ...x, checked: !x.checked } : x
                                                        )
                                                    )
                                                }
                                                className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-1 py-[3px] text-left hover:bg-surface-hover"
                                            >
                                                <span
                                                    className={cn(
                                                        "flex h-[13px] w-[13px] flex-none items-center justify-center rounded-[3px] border text-[10px] font-bold text-background",
                                                        l.checked ? "border-success bg-success" : "border-edge-strong"
                                                    )}
                                                >
                                                    {l.checked ? "✓" : ""}
                                                </span>
                                                <span
                                                    className={cn(
                                                        "min-w-0 flex-1 truncate text-[11.5px]",
                                                        l.checked ? "text-ink-mid line-through" : "text-primary"
                                                    )}
                                                >
                                                    {l.label}
                                                </span>
                                                {isDupe(l, i) ? (
                                                    <span className="flex-none text-[10.5px] text-error">
                                                        duplicate
                                                    </span>
                                                ) : null}
                                            </button>
                                        </Fragment>
                                    ))}
                                </div>
                            </>
                        ) : null}
                    </div>
                ) : (
                    <span className="text-[12px] text-ink-mid">
                        Chunks are edited in the plan: double-click to rename, the status pill to change status.
                    </span>
                )}
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-border px-[18px] py-3">
                {error != null ? (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-error">{error}</span>
                ) : (
                    <span className="flex-1 text-[10.5px] text-ink-mid">
                        {edit != null ? "changes apply immediately" : "ticked lines save as already done"}
                    </span>
                )}
                <button
                    type="button"
                    onClick={onClose}
                    className="cursor-pointer rounded-[7px] border border-border bg-surface-raised px-3.5 py-1.5 text-[11.5px] font-semibold text-secondary hover:text-primary"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={() => void submit()}
                    className="cursor-pointer rounded-[7px] bg-accent px-3.5 py-1.5 text-[11.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:bg-border disabled:text-muted"
                >
                    {edit != null ? "Save changes" : submitting ? "Creating…" : "Create initiative"}
                </button>
            </div>
        </ModalShell>
    );
}

function StageHeader({ label }: { label: string }) {
    return (
        <div className="px-1 pb-0.5 pt-1.5 text-[10.5px] font-bold uppercase tracking-[.08em] text-ink-mid">
            {label}
        </div>
    );
}
