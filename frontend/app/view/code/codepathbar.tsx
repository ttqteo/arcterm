// frontend/app/view/code/codepathbar.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which file you are looking at, and its absolute path to copy. Until this existed the only clue was
// the tree highlight, and the only copy-path affordance was buried in the "file too large" empty
// state. Handing lines to an agent is the Diff surface's line review, not a control here.
//
// Save status stays in SurfaceHeader. Splitting identity from save state is a real cost, but moving
// working controls for tidiness is churn.

import { joinRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Check, Copy, WrapText } from "lucide-react";
import { useState } from "react";
import { resolveViewMode, viewModesFor } from "./codeclassify";
import {
    codeDraftsAtom,
    codeFileAtom,
    codeProjectAtom,
    codeTexPdfAtom,
    codeViewModeAtom,
    draftKey,
    refreshTexPdf,
    texPdfFor,
} from "./codestore";
import { toggleWrap, useWrap } from "./codewrap";

export function CodePathBar() {
    const project = useAtomValue(codeProjectAtom);
    const file = useAtomValue(codeFileAtom);
    const drafts = useAtomValue(codeDraftsAtom);
    const [copied, setCopied] = useState(false);
    const shownAbs = project != null && file.kind !== "none" ? draftKey(project, file.path) : "";
    const wrap = useWrap(shownAbs);
    const hasPdf = texPdfFor(useAtomValue(codeTexPdfAtom), shownAbs) != null;

    if (project == null || file.kind === "none") {
        return null;
    }
    const abs = joinRepoPath(project.path, file.path);
    const dirty = file.kind === "text" && drafts.has(draftKey(project, file.path));

    return (
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-1.5">
            <span data-code-path={file.path} className="min-w-0 truncate text-[11.5px] text-secondary">
                {file.path}
            </span>
            {dirty ? (
                <span
                    aria-label="Unsaved edits"
                    title="Unsaved edits"
                    className="size-[6px] flex-none rounded-full bg-accent-soft"
                />
            ) : null}
            {file.kind === "text" ? <ViewModeToggle path={file.path} abs={abs} hasPdf={hasPdf} /> : null}
            <div className="flex-1" />
            {file.kind === "text" ? <WrapToggle on={wrap} onToggle={() => toggleWrap(abs)} /> : null}
            <button
                type="button"
                aria-label="Copy absolute path"
                title={abs}
                onClick={() => {
                    void navigator.clipboard?.writeText(abs);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                }}
                className={cn(
                    "flex flex-none cursor-pointer items-center gap-1 rounded-[6px] border border-border px-2 py-[3px] text-[11px]",
                    copied ? "text-accent-soft" : "text-muted hover:text-primary"
                )}
            >
                {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.8} />}
                <span>{copied ? "Copied" : "Copy path"}</span>
            </button>
        </div>
    );
}

// Markdown and .tex files render as documents by default; Source is the escape back to the editable view and
// Diff shows the file against HEAD. Preview is for documents only — there is nothing to render for a Go
// file — while Source and Diff are offered for any text file. A .tex file with a built PDF also has PDF,
// which looks the PDF up again when chosen so a build made since opening the file shows.
function ViewModeToggle({ path, abs, hasPdf }: { path: string; abs: string; hasPdf: boolean }) {
    const [chosen, setMode] = useAtom(codeViewModeAtom);
    const mode = resolveViewMode(path, chosen, hasPdf);
    const modes = viewModesFor(path, hasPdf);
    return (
        <div className="flex flex-none items-center gap-0.5 rounded-[6px] border border-border p-[2px]">
            {modes.map((m) => (
                <button
                    key={m}
                    type="button"
                    data-code-view-mode={m}
                    onClick={() => {
                        setMode(m);
                        if (m === "pdf") {
                            fireAndForget(() => refreshTexPdf(abs));
                        }
                    }}
                    className={cn(
                        "cursor-pointer rounded-[4px] px-2 py-[2px] text-[11px] capitalize",
                        m === mode ? "bg-accent/10 text-accent-soft" : "text-muted hover:text-primary"
                    )}
                >
                    {m === "pdf" ? "PDF" : m}
                </button>
            ))}
        </div>
    );
}

// Alt+Z does the same from anywhere on the surface, the editor included (bindings.ts code:wrap)
function WrapToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            data-code-wrap
            aria-pressed={on}
            title={on ? "Stop wrapping long lines (Alt+Z)" : "Wrap long lines (Alt+Z)"}
            onClick={onToggle}
            className={cn(
                "flex flex-none cursor-pointer items-center gap-1 rounded-[6px] border px-2 py-[3px] text-[11px]",
                on ? "border-accent/40 text-accent-soft" : "border-border text-muted hover:text-primary"
            )}
        >
            <WrapText size={11} strokeWidth={1.8} />
            <span>Wrap</span>
        </button>
    );
}
