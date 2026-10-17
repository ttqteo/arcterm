// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The File tab's Diff view: a file from the agent's Files changed against the commit that list is measured from, so
// the change reads beside the agent's terminal instead of on the Diff surface. The working copy is the one the tab
// already read; only the committed side is read here.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { languageForPath } from "@/app/view/code/codeclassify";
import { fireAndForget } from "@/util/util";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { FileRef } from "./agentrailtabs";
import { MAX_DIFF_BYTES } from "./diffcontentstore";
import { savedScroll, saveScroll } from "./filescroll";

const MonacoDiffViewer = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoDiffViewer })));

type Base = { kind: "loading" } | { kind: "text"; text: string } | { kind: "none"; message: string };

// unified only: the panel is never wide enough for two readable columns
const OPTIONS: MonacoTypes.editor.IDiffEditorOptions = {
    readOnly: true,
    originalEditable: false,
    renderSideBySide: false,
    hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    lineNumbersMinChars: 3,
    scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
};

export function FileTabDiff({
    fileRef,
    abs,
    cwd,
    rel,
    base,
    modified,
    reread,
    wrap,
    editorRef,
}: {
    fileRef: FileRef; // whose place in the diff is kept (filescroll.ts)
    abs: string;
    cwd: string;
    rel: string;
    base: string; // "" is HEAD
    modified: string; // "" for a file deleted from the working tree
    reread?: number;
    wrap: boolean;
    // the working copy's editor while it is mounted, for the tab's Mod+F
    editorRef?: { current: MonacoTypes.editor.IStandaloneCodeEditor | null };
}) {
    const [orig, setOrig] = useState<Base>({ kind: "loading" });
    // the ref open now: reopening the file on screen keeps its editor, whose scroll is then that open's to keep
    const refNow = useRef(fileRef);
    refNow.current = fileRef;
    const options = useMemo(() => ({ ...OPTIONS, wordWrap: wrap ? ("on" as const) : ("off" as const) }), [wrap]);
    useEffect(() => {
        let live = true;
        setOrig({ kind: "loading" });
        fireAndForget(async () => {
            let next: Base;
            try {
                const r = await RpcApi.GitFileAtRefCommand(TabRpcClient, {
                    cwd,
                    ref: base || "HEAD",
                    path: rel,
                    maxbytes: MAX_DIFF_BYTES,
                });
                // missing is an added file: everything in it is new
                next = r.binary
                    ? { kind: "none", message: "The committed copy is a binary file." }
                    : r.toolarge
                      ? { kind: "none", message: "The committed copy is larger than 2 MB." }
                      : { kind: "text", text: r.content ?? "" };
            } catch (e) {
                next = { kind: "none", message: e instanceof Error ? e.message : String(e) };
            }
            if (live) {
                setOrig(next);
            }
        });
        return () => {
            live = false;
        };
    }, [cwd, rel, base, reread]);

    if (orig.kind === "loading") {
        return null;
    }
    if (orig.kind === "none") {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
                <div className="text-[13px] font-semibold text-ink-hi">Cannot show the diff</div>
                <div className="text-[12px] leading-[1.5] text-ink-mid">{orig.message}</div>
            </div>
        );
    }
    return (
        <div data-file-diff={abs} className="min-h-0 flex-1">
            <Suspense fallback={null}>
                <MonacoDiffViewer
                    key={abs}
                    // "filediff/" keeps these models apart from the Diff surface's and the Code surface's
                    path={`filediff/${abs}`}
                    original={orig.text}
                    modified={modified}
                    language={languageForPath(abs)}
                    options={options}
                    onMount={(diff) => {
                        // back where the reader left it, once the diff is computed too: its folded regions and
                        // removed lines change the height under the first restore
                        const ed = diff.getModifiedEditor();
                        if (editorRef != null) {
                            editorRef.current = ed;
                        }
                        const place = savedScroll(fileRef, "diff");
                        const restore = () => place != null && ed.setScrollTop(place);
                        restore();
                        const computed = diff.onDidUpdateDiff(() => {
                            computed.dispose();
                            restore();
                        });
                        const scrolled = ed.onDidScrollChange((e) => {
                            // a hidden editor lays out at no height and clamps to the top: not the reader's place
                            if (e.scrollTopChanged && ed.getLayoutInfo().height > 0) {
                                saveScroll(refNow.current, "diff", e.scrollTop);
                            }
                        });
                        return () => {
                            computed.dispose();
                            scrolled.dispose();
                            if (editorRef?.current === ed) {
                                editorRef.current = null;
                            }
                        };
                    }}
                />
            </Suspense>
        </div>
    );
}
