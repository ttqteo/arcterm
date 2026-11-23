// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The File tab's Diff view: a file from the agent's Files changed against the commit that list is measured from, so
// the change reads beside the agent's terminal instead of on the Diff surface. The working copy is the one the tab
// already read; only the committed side is read here, unless the list ends at a commit (an agent's own edits, B..H):
// then both sides are that range's, as on the Diff surface, so another writer's later change to the file stays out.
// A file that matches HEAD (a Chat turn's edit already committed) shows the change of the newest commit that touched
// it instead, named above the diff, until it is edited again.

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

// `commit`: the committed copy matched the working copy, so this is the side before the newest commit that changed the
// file, and the diff shows that commit's change (a Chat turn's file whose edit is already committed)
type Base =
    | { kind: "loading" }
    // `end`: the end commit's copy, which stands in for the working copy
    | { kind: "text"; text: string; commit?: { hash: string; subject: string; head: string }; end?: string }
    | { kind: "none"; message: string };

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
    fontLigatures: true,
    lineNumbersMinChars: 3,
    scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
};

export function FileTabDiff({
    fileRef,
    abs,
    cwd,
    rel,
    base,
    end,
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
    end?: string; // the commit the change ends at; absent, the working copy
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
    // the working copy as the read finds it: compared, not a reason to read again (the tab rereads on its own)
    const modifiedNow = useRef(modified);
    modifiedNow.current = modified;
    const options = useMemo(() => ({ ...OPTIONS, wordWrap: wrap ? ("on" as const) : ("off" as const) }), [wrap]);
    useEffect(() => {
        let live = true;
        setOrig({ kind: "loading" });
        fireAndForget(async () => {
            let next: Base;
            try {
                const read = (ref: string) =>
                    RpcApi.GitFileAtRefCommand(TabRpcClient, { cwd, ref, path: rel, maxbytes: MAX_DIFF_BYTES });
                const [r, e] = await Promise.all([read(base || "HEAD"), end ? read(end) : undefined]);
                // missing is an added file: everything in it is new
                next = r.binary
                    ? { kind: "none", message: "The committed copy is a binary file." }
                    : r.toolarge
                      ? { kind: "none", message: "The committed copy is larger than 2 MB." }
                      : { kind: "text", text: r.content ?? "" };
                // missing at the end is a file the agent deleted: everything in it is gone
                if (next.kind === "text" && e != null) {
                    next =
                        e.binary || e.toolarge
                            ? {
                                  kind: "none",
                                  message: `The agent's copy is ${e.binary ? "a binary file" : "larger than 2 MB"}.`,
                              }
                            : { ...next, end: e.content ?? "" };
                }
                // nothing changed since HEAD: the change is committed, so show the newest commit's change to the file
                if (
                    next.kind === "text" &&
                    !end &&
                    next.text === modifiedNow.current &&
                    (base === "" || base === "HEAD")
                ) {
                    const last = await RpcApi.GitFileAtRefCommand(TabRpcClient, {
                        cwd,
                        ref: "HEAD",
                        path: rel,
                        maxbytes: MAX_DIFF_BYTES,
                        lastchange: true,
                    });
                    if (last.commit && !last.binary && !last.toolarge) {
                        next = {
                            kind: "text",
                            text: last.content ?? "",
                            commit: { hash: last.commit, subject: last.subject ?? "", head: next.text },
                        };
                    }
                }
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
    }, [cwd, rel, base, end, reread]);

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
    // the side the change ends at: the end commit's copy, else the working copy
    const after = orig.end ?? modified;
    // the commit's change while the working copy still matches HEAD; edited since, the diff against HEAD again
    const shown = orig.commit != null && orig.commit.head !== modified ? { text: orig.commit.head } : orig;
    const commit = shown === orig ? orig.commit : undefined;
    // no commit changed it and nothing differs (an undone edit): a diff with every line folded away reads as broken
    if (commit == null && shown.text === after && (base === "" || base === "HEAD")) {
        return (
            <div
                data-file-diff-same={abs}
                className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center"
            >
                <div className="text-[13px] font-semibold text-ink-hi">No change since the last commit</div>
                <div className="text-[12px] leading-[1.5] text-ink-mid">
                    The file matches its last commit: Open in Diff shows the commits.
                </div>
            </div>
        );
    }
    return (
        <div data-file-diff={abs} className="flex min-h-0 flex-1 flex-col">
            {commit != null ? (
                // the working copy matches HEAD: this is the change the newest commit made to the file
                <div
                    data-file-diff-commit={commit.hash}
                    title={[commit.hash, commit.subject].join(" · ")}
                    className="flex min-w-0 flex-none items-baseline gap-1.5 border-b border-edge-faint px-3 py-1.5 text-[11.5px] text-muted"
                >
                    <span className="flex-none">Committed in</span>
                    <span className="flex-none font-mono text-ink-mid">{commit.hash.slice(0, 9)}</span>
                    <span className="min-w-0 truncate">{commit.subject}</span>
                </div>
            ) : null}
            <div className="min-h-0 flex-1">
                <Suspense fallback={null}>
                    <MonacoDiffViewer
                        key={abs}
                        // "filediff/" keeps these models apart from the Diff surface's and the Code surface's
                        path={`filediff/${abs}`}
                        original={shown.text}
                        modified={after}
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
        </div>
    );
}
