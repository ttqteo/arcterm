// frontend/app/view/code/codediffview.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The open file against HEAD, in the place you are editing it. The right-hand side is the DRAFT
// when there is one, so unsaved edits appear in the diff — which is the question a reader actually
// has ("what am I about to commit"), not "what did I last save".
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
import { codeHeadAtom, loadHead } from "./codestore";

const MonacoDiffViewer = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoDiffViewer })));

const SPLIT_MIN_PX = 900;

export function CodeDiffView({ path, text, wrap }: { path: string; text: string; wrap: boolean }) {
    const head = useAtomValue(codeHeadAtom);
    const hostRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useResizeObserver(hostRef, (e) => setWidth(e.contentRect.width));

    useEffect(() => {
        fireAndForget(() => loadHead(path));
    }, [path]);

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

    let body: React.ReactNode;
    if (head.kind === "error" && head.path === path) {
        body = <SurfaceEmptyState title="Cannot diff against HEAD" body={`${path} — ${head.message}`} />;
    } else if ((head.kind === "text" || head.kind === "absent") && head.path === path) {
        body = (
            <Suspense fallback={null}>
                <MonacoDiffViewer
                    // "code/" keeps these model URIs out of the Diff surface's namespace, and the
                    // extension stays last so Monaco still picks the language
                    path={`code/${path}`}
                    original={head.kind === "absent" ? "" : head.text}
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
        <div ref={hostRef} className="h-full w-full">
            {body}
        </div>
    );
}
