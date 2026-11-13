// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The terminal Code peek's one card: which path is open, in which mode, and its loaded file. It reads over the same RPCs
// as the Code surface but never writes a Code-surface atom; only Open in Code, through openRefInCode (the route a path
// link takes when its terminal has no panel), touches that surface.
//
// What it keeps while closed is nothing: the atoms are null and false, and the load token a number. While one is open it
// holds the file's text (at most the 2 MB text cap) and, in a repository, its HEAD copy.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { openRefInCode } from "../agents/agentrailstore";
import type { AgentsViewModel } from "../agents/agents";
import { parseGitChanges } from "../agents/gitstatus";
import { classifyFile, hasNulByte, HEAD_BINARY, HEAD_TOOLARGE, MAX_VIEW_BYTES } from "./codeclassify";
import {
    canOpenPeek,
    initialPeekMode,
    peekModes,
    type PeekChange,
    type PeekFile,
    type PeekGit,
    type PeekHead,
    type PeekMode,
} from "./codepeekmodel";

export type CodePeek = {
    blockId: string;
    // the link's last row in the terminal's buffer, and its first column: the card hangs from the row, and the pair
    // says whether a click is on the open card's link
    bufferLine: number;
    start: number;
    abs: string;
    // the folder the terminal runs in, the file's name in the header and where Open in Code roots it
    root: string | null;
    line: number | null;
    mode: PeekMode;
    file: PeekFile;
};

export const codePeekAtom = atom<CodePeek | null>(null) as PrimitiveAtom<CodePeek | null>;
// whether focus is inside the card (its own keys, Enter and Esc, are the card's: codepeekcard.tsx)
export const codePeekFocusedAtom = atom(false) as PrimitiveAtom<boolean>;

export type PeekRequest = Pick<CodePeek, "blockId" | "bufferLine" | "start" | "abs" | "root" | "line">;

// bumped by every open and close, so a load that a newer click superseded writes nothing
let loadToken = 0;

type Anchor = Pick<CodePeek, "blockId" | "bufferLine" | "start">;

function sameAnchor(p: Anchor, req: Anchor): boolean {
    return p.blockId === req.blockId && p.bufferLine === req.bufferLine && p.start === req.start;
}

function splitAbs(abs: string): { dir: string; base: string } {
    const i = Math.max(abs.lastIndexOf("\\"), abs.lastIndexOf("/"));
    const dir = abs.slice(0, i);
    // a file at a drive or POSIX root keeps the root's separator, or the dir would read as relative
    return { dir: dir === "" || /^[A-Za-z]:$/.test(dir) ? abs.slice(0, i + 1) : dir, base: abs.slice(i + 1) };
}

function headOf(res: CommandGitFileAtRefRtnData): PeekHead {
    if (res.missing) {
        return { kind: "absent" };
    }
    if (res.binary) {
        return { kind: "error", message: HEAD_BINARY };
    }
    if (res.toolarge) {
        return { kind: "error", message: HEAD_TOOLARGE };
    }
    return { kind: "text", text: res.content ?? "" };
}

// a numstat lookup is a nicety: when it fails or times out the card still opens, its stat reading "changes unknown"
// rather than "no changes". Run in the file's own folder, the changes come back scoped to it and relative to it
// (gitinfo.GetChanges), so the file's entry is its base name
async function changeOf(dir: string, base: string): Promise<PeekChange | null | "unknown"> {
    try {
        const res = await RpcApi.GitChangesCommand(TabRpcClient, { cwd: dir });
        const hit = parseGitChanges(res?.statusz ?? "", res?.numstat ?? "").files.find((f) => f.path === base);
        if (!hit) {
            return null;
        }
        return hit.note != null
            ? { adds: hit.adds, dels: hit.dels, note: hit.note }
            : { adds: hit.adds, dels: hit.dels };
    } catch (e) {
        console.warn("code peek: reading git changes failed", e);
        return "unknown";
    }
}

async function loadFile(abs: string, current: () => boolean): Promise<PeekFile | null> {
    const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
    if (!current()) {
        return null;
    }
    if (info == null || info.notfound) {
        return { kind: "missing" };
    }
    if (info.isdir) {
        // a link names a file, but a path can become a folder between the hover and the click
        return { kind: "error", message: `Not a file: ${abs}` };
    }
    const size = info.size ?? 0;
    const klass = classifyFile(size, info.mimetype ?? "");
    if (klass === "toolarge") {
        return { kind: "toolarge", size };
    }
    // an image and a PDF are for Code to draw, a binary is a binary
    if (klass !== "text") {
        return { kind: "binary", size };
    }
    const { dir, base } = splitAbs(abs);
    const [data, at] = await Promise.all([
        RpcApi.FileReadCommand(TabRpcClient, { info: { path: abs } }),
        RpcApi.GitFileAtRefCommand(TabRpcClient, { cwd: dir, ref: "HEAD", path: base, maxbytes: MAX_VIEW_BYTES }),
    ]);
    if (!current()) {
        return null;
    }
    const text = base64ToString(data?.data64 ?? "");
    if (hasNulByte(text)) {
        return { kind: "binary", size };
    }
    let git: PeekGit = { kind: "norepo" };
    if (at?.isrepo === true) {
        const change = await changeOf(dir, base);
        if (!current()) {
            return null;
        }
        git = { kind: "repo", head: headOf(at), change };
    }
    return { kind: "text", text, git };
}

export async function togglePeek(req: PeekRequest): Promise<void> {
    const prev = globalStore.get(codePeekAtom);
    if (prev != null && sameAnchor(prev, req)) {
        closePeek();
        return;
    }
    const token = ++loadToken;
    const current = () => loadToken === token;
    const peek: CodePeek = { ...req, mode: initialPeekMode(req.abs), file: { kind: "loading" } };
    globalStore.set(codePeekAtom, peek);
    let file: PeekFile | null;
    try {
        file = await loadFile(req.abs, current);
    } catch (e) {
        file = current() ? { kind: "error", message: e instanceof Error ? e.message : String(e) } : null;
    }
    if (file != null && current()) {
        globalStore.set(codePeekAtom, { ...peek, file });
    }
}

export function closePeek(): void {
    loadToken++;
    globalStore.set(codePeekAtom, null);
    globalStore.set(codePeekFocusedAtom, false);
}

export function setPeekMode(mode: PeekMode): void {
    const peek = globalStore.get(codePeekAtom);
    if (peek == null || !peekModes(peek.abs, peek.file)[mode].enabled) {
        return;
    }
    globalStore.set(codePeekAtom, { ...peek, mode });
}

export async function openPeekInCode(model: AgentsViewModel): Promise<void> {
    const peek = globalStore.get(codePeekAtom);
    if (peek == null || !canOpenPeek(peek.file)) {
        return;
    }
    await openRefInCode(model, { abs: peek.abs, root: peek.root, ...(peek.line != null ? { line: peek.line } : {}) });
    // a click that moved the card meanwhile owns it now, so only the card that was opened closes
    const now = globalStore.get(codePeekAtom);
    if (now != null && sameAnchor(now, peek)) {
        closePeek();
    }
}
