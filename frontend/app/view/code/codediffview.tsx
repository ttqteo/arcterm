// frontend/app/view/code/codediffview.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The open file against HEAD or the branch's merge-base, in the place you are editing it. The
// right-hand side is the DRAFT when there is one, so unsaved edits appear in the diff — which is the
// question a reader actually has ("what am I about to commit"), not "what did I last save".
//
// Split is gated on this pane's own measured width, not the window's: the app opens at 1000x700 and
// a 280px tree leaves about 45 columns a side, which is unreadable.

import { SurfaceEmptyState } from "@/app/view/agents/surfacescaffold";
import { fireAndForget } from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import { useAtomValue } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { languageForPath } from "./codeclassify";
import { diffTargetLabel, headMatches } from "./codedifftarget";
import { codeDiffBaseAtom, codeDiffTargetAtom, codeHeadAtom, loadCommitted } from "./codestore";

const MonacoDiffViewer = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoDiffViewer })));

const SPLIT_MIN_PX = 900;

export function CodeDiffView({ path, text, wrap }: { path: string; text: string; wrap: boolean }) {
    const head = useAtomValue(codeHeadAtom);
    const target = useAtomValue(codeDiffTargetAtom);
    const base = useAtomValue(codeDiffBaseAtom);
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useResizeObserver(hostRef, (e) => setWidth(e.contentRect.width));

    const usable = base?.kind === "usable" ? base : null;
    // null while the base step has no commit to read: the base failed to resolve
    const ref = target === "head" ? "HEAD" : (usable?.sha ?? null);
    const failTitle = target === "head" ? "Cannot diff against HEAD" : "Cannot diff against the branch base";

    useEffect(() => {
        if (ref != null) {
            fireAndForget(() => loadCommitted(path, ref));
        }
    }, [path, ref]);

    const options = useMemo<MonacoTypes.editor.IDiffEditorOptions>(
        () => ({
            readOnly: true,
            originalEditable: false,
            renderSideBySide: width >= SPLIT_MIN_PX,
            scrollBeyondLastLine: false,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
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
    } else if (matched?.kind === "error") {
        body = <SurfaceEmptyState title={failTitle} body={`${path} — ${matched.message}`} />;
    } else if (matched?.kind === "text" || matched?.kind === "absent") {
        body = (
            <Suspense fallback={null}>
                <MonacoDiffViewer
                    // "code/" keeps these model URIs out of the Diff surface's namespace, and the
                    // extension stays last so Monaco still picks the language
                    path={`code/${path}`}
                    original={matched.kind === "absent" ? "" : matched.text}
                    modified={text}
                    language={languageForPath(path)}
                    options={options}
                />
            </Suspense>
        );
    } else {
        body = <SurfaceEmptyState title="Reading the committed copy…" body={path} />;
    }

    return (
        <div className="flex h-full w-full flex-col">
            <div
                data-code-diff-target={target}
                className="flex-none truncate border-b border-border px-3 py-1 text-[11px] text-muted"
            >
                {diffTargetLabel(target, usable ?? undefined)}
            </div>
            <div ref={hostRef} className="min-h-0 flex-1">
                {body}
            </div>
        </div>
    );
}
