// frontend/app/view/code/codediffview.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The open file against HEAD, the branch's merge-base, or the copy on disk, in the place you are
// editing it. The right-hand side is the DRAFT when there is one, so unsaved edits appear in the diff —
// which is the question a reader actually has ("what am I about to commit"), not "what did I last save".
//
// Split is gated on this pane's own measured width, not the window's: the app opens at 1000x700 and
// a 280px tree leaves about 45 columns a side, which is unreadable.

import { SurfaceEmptyState } from "@/app/view/agents/surfacescaffold";
import { cn, fireAndForget } from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import { useAtomValue } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { languageForPath } from "./codeclassify";
import {
    diffTargetLabel,
    diffUnchanged,
    headMatches,
    noChangesLabel,
    type DiffBase,
    type DiffTarget,
} from "./codedifftarget";
import {
    codeDiffBaseAtom,
    codeDiffTargetAtom,
    codeHeadAtom,
    DISK_REF,
    loadCommitted,
    loadDisk,
    probeDiffBase,
    showDiffTarget,
} from "./codestore";

const MonacoDiffViewer = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoDiffViewer })));
// a file not in HEAD: drawn with every line inserted and no removed one (monaco-inserted.tsx)
const MonacoInsertedText = lazy(() =>
    import("@/app/monaco/monaco-inserted").then((m) => ({ default: m.MonacoInsertedText }))
);

const SPLIT_MIN_PX = 900;

const NO_BASE = "Nothing is ahead of the default branch, so its base is HEAD itself.";

const FAIL_TITLE: Record<DiffTarget, string> = {
    head: "Cannot diff against HEAD",
    base: "Cannot diff against the branch base",
    disk: "Cannot read the copy on disk",
};

const OPTIONS = [
    { target: "head", label: "HEAD" },
    { target: "base", label: "Branch base" },
] as const;

// HEAD / Branch base. Neither reads as pressed on the disk target, which only the stale bar enters.
function DiffTargetPick({ target, base }: { target: DiffTarget; base: DiffBase | null }) {
    const noBase = base?.kind === "skip";
    return (
        <div className="flex flex-none items-center gap-0.5 rounded-[6px] border border-border p-[2px]">
            {OPTIONS.map((o) => {
                const off = o.target === "base" && noBase;
                return (
                    <button
                        key={o.target}
                        type="button"
                        data-code-diff-option={o.target}
                        aria-pressed={target === o.target}
                        disabled={off}
                        title={off ? NO_BASE : undefined}
                        onClick={() => fireAndForget(() => showDiffTarget(o.target))}
                        className={cn(
                            "cursor-pointer rounded-[4px] px-2 py-[1px] text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40",
                            target === o.target ? "bg-accent/10 text-accent-soft" : "text-muted hover:text-primary"
                        )}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

// fixedTarget pins the comparison and drops the pick, for a view that has only one honest answer (a
// file deleted in the working tree is only ever shown against HEAD).
export function CodeDiffView({
    path,
    text,
    wrap,
    fixedTarget,
}: {
    path: string;
    text: string;
    wrap: boolean;
    fixedTarget?: DiffTarget;
}) {
    const head = useAtomValue(codeHeadAtom);
    const chosen = useAtomValue(codeDiffTargetAtom);
    const target = fixedTarget ?? chosen;
    const base = useAtomValue(codeDiffBaseAtom);
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useResizeObserver(hostRef, (e) => setWidth(e.contentRect.width));

    const usable = base?.kind === "usable" ? base : null;
    // null while the base step has no commit to read: the base failed to resolve
    const ref = target === "head" ? "HEAD" : target === "disk" ? DISK_REF : (usable?.sha ?? null);
    const failTitle = FAIL_TITLE[target];

    useEffect(() => {
        if (ref === DISK_REF) {
            fireAndForget(() => loadDisk(path));
        } else if (ref != null) {
            fireAndForget(() => loadCommitted(path, ref));
        }
    }, [path, ref]);

    // asked up front so Branch base is disabled before a click rather than doing nothing on one
    useEffect(() => {
        if (fixedTarget == null) {
            fireAndForget(probeDiffBase);
        }
    }, [path, fixedTarget]);

    const options = useMemo<MonacoTypes.editor.IDiffEditorOptions>(
        () => ({
            readOnly: true,
            originalEditable: false,
            renderSideBySide: width >= SPLIT_MIN_PX,
            scrollBeyondLastLine: false,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            fontLigatures: true,
            minimap: { enabled: false },
            wordWrap: wrap ? "on" : "off",
            scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
        }),
        [width, wrap]
    );

    const matched = headMatches(head, path, ref) ? head : null;
    let body: React.ReactNode;
    if (target === "base" && base?.kind === "error") {
        body = <SurfaceEmptyState title={failTitle} body={base.message} />;
    } else if (target === "base" && base?.kind === "skip") {
        // the branch moved onto the default one since the base step was taken
        body = <SurfaceEmptyState title="No branch base" body={NO_BASE} />;
    } else if (matched?.kind === "error") {
        body = <SurfaceEmptyState title={failTitle} body={`${path} — ${matched.message}`} />;
    } else if (matched?.kind === "absent") {
        // not in the commit at all: a diff against an empty original draws an empty removed line above the
        // inserts, so the whole file is drawn as inserted instead
        body = (
            <Suspense fallback={null}>
                <MonacoInsertedText path={`code-new/${path}`} text={text} options={options} />
            </Suspense>
        );
    } else if (matched?.kind === "text" && fixedTarget == null && diffUnchanged(matched, text)) {
        body = <SurfaceEmptyState title={noChangesLabel(target)} body={path} />;
    } else if (matched?.kind === "text") {
        body = (
            <Suspense fallback={null}>
                <MonacoDiffViewer
                    // "code/" keeps these model URIs out of the Diff surface's namespace, and the
                    // extension stays last so Monaco still picks the language
                    path={`code/${path}`}
                    original={matched.text}
                    modified={text}
                    language={languageForPath(path)}
                    options={options}
                />
            </Suspense>
        );
    } else {
        const reading = target === "disk" ? "Reading the copy on disk…" : "Reading the committed copy…";
        body = <SurfaceEmptyState title={reading} body={path} />;
    }

    return (
        <div className="flex h-full w-full flex-col">
            <div
                data-code-diff-target={target}
                className="flex flex-none items-center gap-2 border-b border-border px-3 py-1 text-[11px] text-muted"
            >
                {fixedTarget == null ? <DiffTargetPick target={target} base={base} /> : null}
                <span className="min-w-0 truncate">{diffTargetLabel(target, usable ?? undefined)}</span>
            </div>
            <div ref={hostRef} className="min-h-0 flex-1">
                {body}
            </div>
        </div>
    );
}
