// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure parser for `git diff` / `git show` output into the edit view's EditFile shape. Hunk bodies are
// read by the counts in their @@ header, so an empty context line and a following commit header are
// told apart; text outside a file's hunks (commit headers, stats) is skipped.

import type { DiffLine, EditFile } from "./agentsviewmodel";

// a color a user's git config forces past --no-color would otherwise land in the text
// eslint-disable-next-line no-control-regex
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = (s: string): string => s.replace(CSI_RE, "");

const FILE_HEADER = /^diff --git a\/(.*?) b\/(.*)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkCount(s: string | undefined): number {
    return s == null ? 1 : Number(s);
}

export function parseUnifiedDiff(output: string): EditFile[] | null {
    const lines = stripAnsi(output).split(/\r?\n/);
    const files: EditFile[] = [];
    let file: EditFile | null = null;
    // lines still owed by the open hunk, old side and new side
    let oldLeft = 0;
    let newLeft = 0;
    // the next line number on each side, from the open hunk's header
    let oldNo = 0;
    let newNo = 0;
    for (const raw of lines) {
        if (oldLeft > 0 || newLeft > 0) {
            const sign = raw[0];
            if (sign === "\\") {
                continue;
            }
            let line: DiffLine;
            if (sign === "+") {
                newLeft--;
                file.adds++;
                line = { sign: "+", text: raw.slice(1), newNo: newNo++ };
            } else if (sign === "-") {
                oldLeft--;
                file.dels++;
                line = { sign: "-", text: raw.slice(1), oldNo: oldNo++ };
            } else {
                // a context line, or an empty one whose leading space was trimmed
                oldLeft--;
                newLeft--;
                line = { sign: "", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ };
            }
            file.lines.push(line);
            continue;
        }
        const head = FILE_HEADER.exec(raw);
        if (head) {
            file = { path: head[2], badge: "M", adds: 0, dels: 0, lines: [] };
            files.push(file);
            continue;
        }
        if (file == null) {
            continue;
        }
        if (raw.startsWith("new file mode")) {
            file.badge = "A";
            continue;
        }
        if (raw.startsWith("rename to ")) {
            file.path = raw.slice("rename to ".length);
            continue;
        }
        if (raw.startsWith("Binary files ") || raw === "GIT binary patch") {
            file.binary = true;
            continue;
        }
        const hunk = HUNK_HEADER.exec(raw);
        if (hunk) {
            oldNo = Number(hunk[1]);
            oldLeft = hunkCount(hunk[2]);
            newNo = Number(hunk[3]);
            newLeft = hunkCount(hunk[4]);
            file.lines.push({ sign: "", text: raw, hunk: true });
        }
    }
    return files.length > 0 ? files : null;
}
