// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Doc review's PDF tab, as pure functions: which panel a compile result shows, and the copy around it. The
// compile itself and its result per ask live in docpdfstore.ts; docpdfpane.tsx draws them.

import { formatRemoteUri } from "@/util/waveutil";

export type PdfPaneState = "compiling" | "ok" | "failed" | "noroot" | "noengine";

// The line the no-root panel suggests. A pattern, not a guess at where the root is: the user edits the path.
export const ROOT_HINT = "% !TEX root = ../main.tex";

// The server tells the states apart by order: no root comes back at once with no engine looked for, so it reads
// before "no engine". A rejected RPC is none of them, and shows as failed with its error. Before the first result
// lands there is nothing else to show than the compile that is about to run.
export function pdfPaneState(
    r: CommandDocCompileRtnData | null,
    pending: boolean,
    error?: string | null
): PdfPaneState {
    if (pending) {
        return "compiling";
    }
    if (error != null) {
        return "failed";
    }
    if (r == null) {
        return "compiling";
    }
    if (r.rootpath === "") {
        return "noroot";
    }
    if (r.engine === "") {
        return "noengine";
    }
    return r.ok ? "ok" : "failed";
}

// pages past the ask's `Pages: N`; 0 with no limit
export function overLimit(pages: number, limit?: number): number {
    if (limit == null || limit <= 0) {
        return 0;
    }
    return Math.max(0, pages - limit);
}

export function pagesLabel(pages: number): string {
    return `${pages} ${pages === 1 ? "page" : "pages"}`;
}

export function overLimitLabel(pages: number, limit: number): string {
    return `${pagesLabel(overLimit(pages, limit))} over the ${limit}-page limit`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// "compiled 14:06 · latexmk · 6.2 s": local 24-hour time the result landed
export function compiledMeta(r: CommandDocCompileRtnData, at: number): string {
    const d = new Date(at);
    return `compiled ${pad2(d.getHours())}:${pad2(d.getMinutes())} · ${r.engine} · ${(r.durationms / 1000).toFixed(1)} s`;
}

// a first compile doesn't know its engine yet; a recompile names the last one
export function compilingMeta(elapsedMs: number, engine?: string): string {
    const secs = `${Math.max(0, Math.floor(elapsedMs / 1000))} s`;
    return engine ? `compiling with ${engine} · ${secs}` : `compiling · ${secs}`;
}

const LOG_FALLBACK_LINES = 3;

// What the failed panel shows: the RPC's error when the call failed; else TeX's first `! ` line and its `l.<n>`
// line; else, for a failure that never reached TeX's format (a timeout, an engine that couldn't start), the end
// of the log, which then says why.
export function failureLines(r: CommandDocCompileRtnData | null, error?: string | null): string[] {
    const lines = (text: string | undefined) =>
        (text ?? "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l !== "");
    if (error != null) {
        return lines(error);
    }
    const first = lines(r?.firsterror);
    if (first.length > 0) {
        return first;
    }
    return lines(r?.logtail).slice(-LOG_FALLBACK_LINES);
}

const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

// What "Add to my answer" puts in the general note, which is one line: the file, its root when the reviewed file
// is a chapter of another, and the error.
export function errorForAnswer(r: CommandDocCompileRtnData, file: string): string {
    const root = baseName(r.rootpath ?? "");
    const where = root !== "" && root !== file ? `${file} didn't compile (root ${root})` : `${file} didn't compile`;
    const lines = failureLines(r);
    return lines.length > 0 ? `${where}: ${lines.join(" ")}` : `${where}.`;
}

export function appendNote(note: string, text: string): string {
    const kept = note.trim();
    if (kept === "") {
        return text;
    }
    return kept.includes(text) ? kept : `${kept} ${text}`;
}

// /wave/stream-file takes a wsh:// URI, as resolveRemoteFile in markdown-util.ts builds it. An iframe can't send
// the auth header, so the key rides in the query. `version` busts the cache: the route allows caching, and a
// recompile writes the same path again.
export function urlFor(path: string, endpoint: string, authKey: string, version?: number): string {
    const usp = new URLSearchParams();
    usp.set("path", formatRemoteUri(path, undefined));
    usp.set("authkey", authKey);
    if (version != null) {
        usp.set("v", String(version));
    }
    return `${endpoint}/wave/stream-file?${usp.toString()}`;
}
