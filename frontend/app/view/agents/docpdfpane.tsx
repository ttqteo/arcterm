// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Doc review's PDF tab: the compiled paper in WebView2's own PDF viewer, or the panel that says why there is
// none (compiling, failed, no root file, no engine), and the toolbar's PDF side. Thin: the states and copy come
// from docpdf.ts, the compile and its result from docpdfstore.ts.

import { Skeleton } from "@/app/element/skeleton";
import { getApi } from "@/app/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
    appendNote,
    compiledMeta,
    compilingMeta,
    errorForAnswer,
    failureLines,
    overLimit,
    overLimitLabel,
    pagesLabel,
    pdfPaneState,
    ROOT_HINT,
    urlFor,
    type PdfPaneState,
} from "./docpdf";
import { docPdfAtom, startDocCompile, type DocPdfState } from "./docpdfstore";
import { setGeneralNote, type DocReviewState } from "./docreviewstore";

// the iframe can't send the auth header, so the URL carries the key (decision 3)
export function streamFileUrl(path: string, version?: number): string {
    return urlFor(path, getWebServerEndpoint(), getApi().getAuthKey(), version);
}

const PANEL =
    "flex min-h-0 flex-1 flex-col items-center justify-center gap-[10px] overflow-y-auto bg-surface-code p-[24px] text-center";
const TITLE = "flex items-center gap-2 text-[14px] font-semibold text-primary";
const BODY = "max-w-[460px] text-[13px] leading-[1.5] text-secondary";
const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex flex-none cursor-pointer items-center gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised text-[12.5px] font-semibold text-primary hover:border-edge-strong disabled:cursor-default disabled:opacity-50";
const META = "whitespace-nowrap text-[10.5px] text-muted";

const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

// this review's compile; a result kept for an older ask is not this one's
function usePdf(agentId: string, review: DocReviewState): { pdf: DocPdfState | null; state: PdfPaneState } {
    const kept = useAtomValue(docPdfAtom(agentId));
    const pdf = kept?.askId === review.askId ? kept : null;
    return { pdf, state: pdfPaneState(pdf?.result ?? null, pdf?.pending ?? false, pdf?.error) };
}

// ticks once a second while a compile runs, for its elapsed time
function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) {
            return;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [active]);
    return now;
}

function Recompile(p: { agentId: string; review: DocReviewState; pending: boolean; icon?: boolean }) {
    return (
        <button
            type="button"
            data-doc-review-recompile
            disabled={p.pending}
            onClick={() =>
                fireAndForget(() => startDocCompile(p.agentId, p.review.path, p.review.askId, { force: true }))
            }
            className={cn(SECONDARY_BTN, p.icon ? "px-[11px] py-[5px]" : "px-3 py-[6px]")}
        >
            {p.icon ? <RotateCw size={13} strokeWidth={2} aria-hidden /> : null}
            Recompile
        </button>
    );
}

// The toolbar's right side on the PDF tab: the page count, the over-limit chip, when it compiled, and Recompile;
// while compiling, the elapsed time. A panel that says why there is no PDF carries its own Recompile.
export function PdfToolbar(p: { agentId: string; review: DocReviewState; pageLimit?: number; narrow: boolean }) {
    const { pdf, state } = usePdf(p.agentId, p.review);
    const running = pdf?.pending === true;
    const now = useNow(running);
    if (state === "compiling") {
        return (
            <div className="flex flex-none items-center gap-[10px]">
                <span data-doc-review-pdf-meta className={META}>
                    {compilingMeta(running ? now - pdf.startedAt : 0, pdf?.result?.engine)}
                </span>
                <Recompile agentId={p.agentId} review={p.review} pending={running} icon />
            </div>
        );
    }
    const r = pdf?.result;
    if (state !== "ok" || r == null) {
        return null;
    }
    const over = overLimit(r.pages, p.pageLimit);
    return (
        // flex-none throughout: the file's folder, on the toolbar's left, is what gives way to a narrow pane
        <div className="flex flex-none items-center gap-[10px]">
            {r.pages > 0 ? (
                <span
                    data-doc-review-pdf-pages
                    className="flex-none whitespace-nowrap text-[11px] font-semibold text-secondary"
                >
                    {pagesLabel(r.pages)}
                </span>
            ) : null}
            {over > 0 ? (
                <span
                    data-doc-review-pdf-over
                    className="flex flex-none items-center gap-[6px] whitespace-nowrap rounded-[6px] border border-warning/45 bg-warning/12 px-2 py-[3px] text-[12px] font-semibold text-warning"
                >
                    <TriangleAlert size={13} strokeWidth={2} aria-hidden />
                    {overLimitLabel(r.pages, p.pageLimit)}
                </span>
            ) : null}
            {!p.narrow ? (
                <span data-doc-review-pdf-meta className={cn(META, "flex-none")}>
                    {compiledMeta(r, pdf.at)}
                </span>
            ) : null}
            <Recompile agentId={p.agentId} review={p.review} pending={false} icon />
        </div>
    );
}

// The PDF tab's body, in the place of the Changes view.
export function PdfPanel(p: { agentId: string; agentName: string; review: DocReviewState; sent: boolean }) {
    const { agentId, review } = p;
    const { pdf, state } = usePdf(agentId, review);
    const file = baseName(review.path);
    const r = pdf?.result ?? null;
    const recompile = <Recompile agentId={agentId} review={review} pending={pdf?.pending ?? false} />;
    if (state === "ok") {
        return (
            <div data-doc-review-pdf="ok" className="flex min-h-0 flex-1 flex-col bg-surface-code">
                {r?.pdfpath ? (
                    <iframe
                        data-doc-review-pdf-frame
                        title={`${baseName(r.pdfpath)}, compiled from ${baseName(r.rootpath)}`}
                        src={streamFileUrl(r.pdfpath, pdf.at)}
                        className="min-h-0 w-full flex-1 border-0"
                    />
                ) : (
                    <div className={PANEL}>
                        <span className={BODY}>The compile finished without a PDF.</span>
                        {recompile}
                    </div>
                )}
            </div>
        );
    }
    if (state === "compiling") {
        return (
            <div data-doc-review-pdf="compiling" aria-busy="true" className={cn(PANEL, "gap-3")}>
                <div
                    data-doc-review-pdf-skeleton
                    aria-hidden="true"
                    className="flex h-[190px] w-[150px] flex-col gap-[7px] rounded-[4px] bg-surface-raised px-4 py-[18px]"
                >
                    <Skeleton className="mx-auto mb-[6px] h-[7px] w-[80%] rounded-[2px]" />
                    {["w-full", "w-full", "w-[70%]", "w-full", "w-[55%]"].map((w, i) => (
                        <Skeleton key={i} className={cn("h-[4px] rounded-[2px]", w)} />
                    ))}
                </div>
                <span className={BODY}>
                    Compiling {r?.rootpath ? baseName(r.rootpath) : file}. The Changes tab is ready meanwhile.
                </span>
            </div>
        );
    }
    if (state === "noroot") {
        return (
            <div data-doc-review-pdf="noroot" className={PANEL}>
                <span className={TITLE}>No root file for {file}</span>
                <span className={BODY}>
                    It has no {"\\documentclass"}, and no file up to two folders above has one either. Name the root at
                    the top of {file}:
                </span>
                <code className="rounded-[6px] border border-edge-mid bg-background px-[10px] py-[6px] font-mono text-[12px] text-primary">
                    {ROOT_HINT}
                </code>
                <div className="mt-[4px]">{recompile}</div>
            </div>
        );
    }
    if (state === "noengine") {
        return (
            <div data-doc-review-pdf="noengine" className={PANEL}>
                <span className={TITLE}>
                    <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-error" />
                    No LaTeX engine found
                </span>
                <span className={BODY}>
                    Arc looked for latexmk and tectonic on PATH. Install one (MiKTeX or TeX Live include latexmk), then
                    recompile.
                </span>
                <div className="mt-[4px]">{recompile}</div>
            </div>
        );
    }
    return <FailedPanel {...p} pdf={pdf} file={file} recompile={recompile} />;
}

// A compile error goes back to the agent through the general note; a failed RPC is Arc's, so it only recompiles.
function FailedPanel(p: {
    agentId: string;
    agentName: string;
    review: DocReviewState;
    sent: boolean;
    pdf: DocPdfState | null;
    file: string;
    recompile: ReactNode;
}) {
    const r = p.pdf?.result ?? null;
    const rpcError = p.pdf?.error ?? null;
    const lines = failureLines(r, rpcError);
    // a log tail stands in for a missing first error: none of it is the error line
    const firstIsError = rpcError != null || (r?.firsterror ?? "") !== "";
    const answer = rpcError == null && r != null ? errorForAnswer(r, p.file) : null;
    const added = answer != null && p.review.generalNote.includes(answer);
    return (
        <div data-doc-review-pdf="failed" className={PANEL}>
            <span className={TITLE}>
                <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-error" />
                {p.file} didn't compile
            </span>
            {lines.length > 0 ? (
                <div
                    data-doc-review-pdf-error
                    className="w-[440px] max-w-full break-words rounded-[7px] border border-edge-mid bg-background px-3 py-[10px] text-left font-mono text-[12px] leading-[1.6]"
                >
                    {lines.map((line, i) => (
                        <div key={i} className={i === 0 && firstIsError ? "text-error" : "text-ink-mid"}>
                            {line}
                        </div>
                    ))}
                </div>
            ) : null}
            <span className={cn(BODY, "max-w-[440px]")}>
                {answer != null
                    ? `The Changes tab still works. Add the error to your answer so ${p.agentName} fixes it, or fix it yourself and recompile.`
                    : "Arc couldn't finish the compile. The Changes tab still works; recompile to try again."}
            </span>
            <div className="mt-[4px] flex gap-[10px]">
                {answer != null ? (
                    <button
                        type="button"
                        data-doc-review-add-error
                        // it only writes the note; the tray's buttons send
                        disabled={p.sent || added}
                        title={p.sent ? "The answer is already sent" : added ? "Already in your note" : undefined}
                        onClick={() => setGeneralNote(p.agentId, appendNote(p.review.generalNote, answer))}
                        className={ACCENT_BTN}
                    >
                        Add to my answer
                    </button>
                ) : null}
                {p.recompile}
            </div>
        </div>
    );
}
