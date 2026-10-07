// frontend/app/view/agents/gitdiff.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: turn `git diff HEAD -- <path>` output (or untracked file content) into the Files render
// model — old/new gutter line numbers + a sign column, faithful to the handoff diff list. No React.

export type DiffLineKind = "add" | "del" | "ctx" | "hunk";

export interface DiffLine {
    gOld: string; // old line number, or ""
    gNew: string; // new line number, or ""
    sign: string; // "+" | "−" | ""
    text: string;
    kind: DiffLineKind;
}

export interface FileView {
    isDiff: boolean;
    lines: DiffLine[];
    adds: number;
    dels: number;
    hunkLabel: string;
    // git said the file changed but emitted no text for it. Its one sentence is not a diff line, so
    // rendering it as context put a line number beside a sentence.
    binary: boolean;
    // set for a rename, so a file whose content did not change can say why it has nothing to show
    renamedFrom?: string;
    // bytes of the patch the server refused to send. Set only when it was refused, because zero lines
    // and zero lines are the same thing to the renderer and "too big to show" is not "no changes".
    tooLarge?: number;
}

const HEADER_PREFIXES = ["diff ", "index ", "--- ", "+++ ", "new file", "deleted file", "similarity ", "rename ", "old mode", "new mode"];
const RENAME_FROM = "rename from ";
const BINARY_LINE = "Binary files ";
const BINARY_PATCH = "GIT binary patch";

export function parseUnifiedDiff(diff: string): FileView {
    const lines: DiffLine[] = [];
    let oldN = 0;
    let newN = 0;
    let adds = 0;
    let dels = 0;
    let hunkLabel = "";
    let binary = false;
    let renamedFrom: string | undefined;

    // git's output ends with a newline and split keeps the empty element after it; rendering that
    // element as a context line puts a blank row, numbered as if it were real, under every diff.
    // plainFileView drops the same artifact for untracked files.
    const rawLines = diff.split("\n");
    if (rawLines.length && rawLines[rawLines.length - 1] === "") {
        rawLines.pop();
    }

    for (const raw of rawLines) {
        if (raw.startsWith(BINARY_LINE) || raw === BINARY_PATCH) {
            binary = true;
            continue; // git's sentence is not a line of the file; the pane says so in its own words
        }
        if (HEADER_PREFIXES.some((p) => raw.startsWith(p))) {
            if (raw.startsWith(RENAME_FROM)) {
                renamedFrom = raw.slice(RENAME_FROM.length);
            }
            continue;
        }
        if (raw.startsWith("@@")) {
            const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
            if (m) {
                oldN = parseInt(m[1], 10);
                newN = parseInt(m[2], 10);
                if (!hunkLabel) {
                    hunkLabel = raw;
                }
            }
            lines.push({ gOld: "", gNew: "", sign: "", text: raw, kind: "hunk" });
            continue;
        }
        if (raw.startsWith("\\")) {
            continue; // "\ No newline at end of file"
        }
        if (raw.startsWith("+")) {
            lines.push({ gOld: "", gNew: String(newN), sign: "+", text: raw.slice(1), kind: "add" });
            newN++;
            adds++;
            continue;
        }
        if (raw.startsWith("-")) {
            lines.push({ gOld: String(oldN), gNew: "", sign: "−", text: raw.slice(1), kind: "del" });
            oldN++;
            dels++;
            continue;
        }
        lines.push({ gOld: String(oldN), gNew: String(newN), sign: "", text: raw.startsWith(" ") ? raw.slice(1) : raw, kind: "ctx" });
        oldN++;
        newN++;
    }
    return { isDiff: true, lines, adds, dels, hunkLabel, binary, renamedFrom };
}

// A new (untracked) file has no HEAD blob, so `git diff` emits nothing and the backend hands us the
// raw content. Render it as an all-additions diff — every line a green "+" — so a new file reads as
// the diff it morally is (matching git/GitHub), not as flat, undecorated text.
export function plainFileView(content: string): FileView {
    // split never drops anything, so a trailing newline leaves a phantom empty final element — drop it
    // so we neither render nor count a blank added line.
    const raw = content === "" ? [] : content.split("\n");
    if (raw.length && raw[raw.length - 1] === "") {
        raw.pop();
    }
    const lines: DiffLine[] = raw.map((text, i) => ({
        gOld: "",
        gNew: String(i + 1),
        sign: "+",
        text,
        kind: "add" as const,
    }));
    return {
        isDiff: true,
        lines,
        adds: lines.length,
        dels: 0,
        hunkLabel: "New file",
        binary: false,
    };
}

// Where a jump into the Code surface should land: the first added line's new-side number. A
// deletion-only hunk has no added line, so its first numbered line — the context line the hunk
// starts on — is the closest honest answer.
export function firstChangedLine(view: FileView): number | undefined {
    const line = view.lines.find((l) => l.kind === "add") ?? view.lines.find((l) => l.gNew !== "");
    if (line == null) {
        return undefined;
    }
    const n = parseInt(line.gNew, 10);
    return Number.isFinite(n) ? n : undefined;
}

// A diff the server refused to send. Empty like the binary and pure-rename states, and drawn the same
// way, but carrying the size so the pane can name the number rather than just decline.
export function tooLargeFileView(size: number): FileView {
    return {
        isDiff: true,
        lines: [],
        adds: 0,
        dels: 0,
        hunkLabel: "",
        binary: false,
        tooLarge: size,
    };
}

// What a diff RPC's answer becomes. One place decides, because four call sites deciding separately is
// four chances for a refused patch to render as "nothing inside this file changed".
export function diffFileView(d: {
    diff?: string;
    content?: string;
    untracked?: boolean;
    toolarge?: boolean;
    size?: number;
}): FileView {
    if (d.toolarge) {
        return tooLargeFileView(d.size ?? 0);
    }
    return d.untracked ? plainFileView(d.content ?? "") : parseUnifiedDiff(d.diff ?? "");
}
