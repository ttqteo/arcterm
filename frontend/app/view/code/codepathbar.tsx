// frontend/app/view/code/codepathbar.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which file you are looking at, and its absolute path to copy. Until this existed the only clue was
// the tree highlight, and the only copy-path affordance was buried in the "file too large" empty
// state. Handing lines to an agent is the Diff surface's line review, not a control here.
//
// Save status stays in SurfaceHeader. Splitting identity from save state is a real cost, but moving
// working controls for tidiness is churn.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { joinRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Check, Columns2, Pin, WrapText } from "lucide-react";
import { useState } from "react";
import { resolveViewMode, viewModesFor } from "./codeclassify";
import { isPinned } from "./codepins";
import { isPreviewable } from "./codepreviewable";
import { closeSide } from "./codeside";
import {
    codeDraftsAtom,
    codeFileAtom,
    codePinsAtom,
    codePlainAtom,
    codeProjectAtom,
    codeTexPdfAtom,
    codeViewModeAtom,
    draftKey,
    NOT_TRACKED,
    openPath,
    refreshTexPdf,
    texPdfFor,
    toggleCodePin,
} from "./codestore";
import { toggleWrap, useWrap } from "./codewrap";
import { pathMenuItems } from "./pathmenu";

// Wrap and Pin are icons, and the path itself copies on click, as in the Agent panel's File tab (filetab.tsx); an on
// toggle takes the accent
const ICON_BTN =
    "flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary";
const ICON_ON = "text-accent-soft hover:text-accent-soft";

// `sideHidden`: the side column's file while the editor area is too narrow to show it; the chip opens it here instead
export function CodePathBar({ sideHidden }: { sideHidden?: string | null }) {
    const project = useAtomValue(codeProjectAtom);
    const file = useAtomValue(codeFileAtom);
    const drafts = useAtomValue(codeDraftsAtom);
    const [copied, setCopied] = useState(false);
    const shownAbs = project != null && file.kind !== "none" ? draftKey(project, file.path) : "";
    const wrap = useWrap(shownAbs);
    const hasPdf = texPdfFor(useAtomValue(codeTexPdfAtom), shownAbs) != null;
    const pins = useAtomValue(codePinsAtom);

    if (project == null || file.kind === "none") {
        return null;
    }
    const abs = joinRepoPath(project.path, file.path);
    const dirty = file.kind === "text" && drafts.has(draftKey(project, file.path));

    return (
        <div className="flex flex-none items-center gap-1.5 border-b border-border px-3 py-1">
            {/* the path is the copy button: a click copies the absolute path */}
            <button
                type="button"
                data-code-path={file.path}
                aria-label={copied ? "Copied" : `Copy path: ${abs}`}
                title={copied ? "Copied" : `${abs}\nClick to copy`}
                onClick={() => {
                    void navigator.clipboard?.writeText(abs);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                }}
                onContextMenu={(ev) =>
                    ContextMenuModel.getInstance().showContextMenu(pathMenuItems(abs, file.path), ev)
                }
                className="flex min-w-0 cursor-pointer items-center gap-1 rounded-[4px] border-0 bg-transparent px-1 py-[2px] text-left text-[11.5px] text-secondary hover:bg-surface-hover"
            >
                <span className="min-w-0 truncate">{file.path}</span>
                {copied ? <Check size={12} strokeWidth={2} aria-hidden className="flex-none text-accent-soft" /> : null}
            </button>
            {dirty ? (
                <span
                    aria-label="Unsaved edits"
                    title="Unsaved edits"
                    className="size-[6px] flex-none rounded-full bg-accent-soft"
                />
            ) : null}
            {file.kind === "text" ? (
                <ViewModeToggle
                    path={file.path}
                    abs={abs}
                    hasPdf={hasPdf}
                    previewable={isPreviewable(file.path, drafts.get(abs)?.text ?? file.text)}
                />
            ) : null}
            <div className="flex-1" />
            {sideHidden != null ? (
                <button
                    type="button"
                    data-code-side-hidden={sideHidden}
                    title="The side column needs a wider window. Click to open its file here."
                    onClick={() => {
                        closeSide();
                        fireAndForget(() => openPath(sideHidden));
                    }}
                    className="flex min-w-0 max-w-[200px] flex-none cursor-pointer items-center gap-1 rounded-[6px] border border-border px-2 py-[3px] text-[11px] text-muted hover:text-primary"
                >
                    <Columns2 size={11} strokeWidth={1.8} className="flex-none" />
                    <span className="truncate">Side: {sideHidden.split("/").pop()}</span>
                </button>
            ) : null}
            {file.kind === "text" ? <WrapToggle on={wrap} onToggle={() => toggleWrap(abs)} /> : null}
            <PinToggle on={isPinned(pins, project.path, file.path)} onToggle={() => toggleCodePin(file.path)} />
        </div>
    );
}

// Markdown and .tex files render as documents by default; Source is the escape back to the editable view and
// Diff shows the file against HEAD. Preview is for documents only — there is nothing to render for a Go
// file — while Source and Diff are offered for any text file. A .tex file with a built PDF also has PDF,
// which looks the PDF up again when chosen so a build made since opening the file shows.
function ViewModeToggle(p: { path: string; abs: string; hasPdf: boolean; previewable: boolean }) {
    const { path, abs, hasPdf, previewable } = p;
    const [chosen, setMode] = useAtom(codeViewModeAtom);
    const mode = resolveViewMode(path, chosen, hasPdf, previewable);
    const plain = useAtomValue(codePlainAtom);
    const modes = viewModesFor(path, hasPdf, previewable);
    return (
        <div className="flex flex-none items-center gap-0.5 rounded-[6px] border border-border p-[2px]">
            {modes.map((m) => (
                <button
                    key={m}
                    type="button"
                    data-code-view-mode={m}
                    disabled={plain && m === "diff"}
                    title={plain && m === "diff" ? NOT_TRACKED : undefined}
                    onClick={() => {
                        setMode(m);
                        if (m === "pdf") {
                            fireAndForget(() => refreshTexPdf(abs));
                        }
                    }}
                    className={cn(
                        "cursor-pointer rounded-[4px] px-2 py-[2px] text-[11px] capitalize disabled:cursor-default disabled:opacity-40",
                        m === mode ? "bg-accent/10 text-accent-soft" : "text-muted hover:text-primary"
                    )}
                >
                    {m === "pdf" ? "PDF" : m}
                </button>
            ))}
        </div>
    );
}

// pinned files list at the top of the Files tab (codetreepane.tsx PinnedFiles)
function PinToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            data-code-pin
            aria-pressed={on}
            aria-label="Pin"
            title={on ? "Unpin this file" : "Pin this file to the top of Files"}
            onClick={onToggle}
            className={cn(ICON_BTN, on && ICON_ON)}
        >
            <Pin size={13} fill={on ? "currentColor" : "none"} aria-hidden />
        </button>
    );
}

// Alt+Z does the same from anywhere on the surface, the editor included (bindings.ts code:wrap)
function WrapToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            data-code-wrap
            aria-pressed={on}
            aria-label="Wrap long lines"
            title={on ? "Stop wrapping long lines (Alt+Z)" : "Wrap long lines (Alt+Z)"}
            onClick={onToggle}
            className={cn(ICON_BTN, on && ICON_ON)}
        >
            <WrapText size={13} aria-hidden />
        </button>
    );
}
