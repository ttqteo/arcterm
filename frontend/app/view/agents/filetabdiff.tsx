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
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { MAX_DIFF_BYTES } from "./diffcontentstore";

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
    abs,
    cwd,
    rel,
    base,
    modified,
    reread,
    wrap,
}: {
    abs: string;
    cwd: string;
    rel: string;
    base: string; // "" is HEAD
    modified: string; // "" for a file deleted from the working tree
    reread?: number;
    wrap: boolean;
}) {
    const [orig, setOrig] = useState<Base>({ kind: "loading" });
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
                />
            </Suspense>
        </div>
    );
}
