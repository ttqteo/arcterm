// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One shell command line in colour, the way a terminal's highlighter draws it: the command in the keyword colour, its
// arguments and quoted strings in the string colour, flags and operators (`|`, `&&`, `;`, `>`) dim, variables and an
// assignment before the command (`FOO=1 cmd`) in the number colour, a comment to the end of the line. For Chat's bash
// box (chateditor.tsx) and a shell code block (codeblock.tsx). Classes are the design system's syntax tokens, never hex.
// Lexical heuristics, not a parser: a line, not a script, is what either one shows.

import type { CodeToken } from "./highlight";

const COMMAND = "text-syntax-keyword";
const ARG = "text-syntax-string";
const FLAG = "text-syntax-punct";
const OP = "text-syntax-punct";
const VAR = "text-syntax-number";
const COMMENT = "text-syntax-comment";
const SPACE = "text-syntax-ident";

// operators, longest first; after one of the first five a new command starts
const OPERATORS = ["&&", "||", ">>", "2>", "|", ";", "&", "(", ")", ">", "<"];
const STARTS_COMMAND = new Set(["&&", "||", "|", ";", "&", "("]);

// a quoted string from `i` (its closing quote included, or to the end of the line when it has none)
function quotedEnd(line: string, i: number): number {
    const q = line[i];
    let j = i + 1;
    while (j < line.length && line[j] !== q) {
        j += q === '"' && line[j] === "\\" ? 2 : 1;
    }
    return Math.min(j + 1, line.length);
}

// a word from `i`: up to whitespace or an operator, a quoted part inside it kept whole (`--msg="a b"`)
function wordEnd(line: string, i: number): number {
    let j = i;
    while (j < line.length && !/\s/.test(line[j]) && OPERATORS.every((op) => !line.startsWith(op, j))) {
        j = line[j] === '"' || line[j] === "'" ? quotedEnd(line, j) : j + 1;
    }
    return j;
}

export function shellLine(line: string): CodeToken[] {
    const out: CodeToken[] = [];
    let i = 0;
    let command = true;
    while (i < line.length) {
        const ch = line[i];
        if (/\s/.test(ch)) {
            let j = i;
            while (j < line.length && /\s/.test(line[j])) {
                j++;
            }
            out.push({ t: line.slice(i, j), cls: SPACE });
            i = j;
            continue;
        }
        if (ch === "#") {
            out.push({ t: line.slice(i), cls: COMMENT });
            break;
        }
        const op = OPERATORS.find((o) => line.startsWith(o, i));
        if (op != null) {
            out.push({ t: op, cls: OP });
            i += op.length;
            if (STARTS_COMMAND.has(op)) {
                command = true;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            const j = quotedEnd(line, i);
            out.push({ t: line.slice(i, j), cls: ARG });
            i = j;
            command = false;
            continue;
        }
        const j = wordEnd(line, i);
        const word = line.slice(i, j);
        if (word.startsWith("$")) {
            out.push({ t: word, cls: VAR });
        } else if (command && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
            // an assignment before the command: the command is still to come
            out.push({ t: word, cls: VAR });
        } else if (command) {
            out.push({ t: word, cls: COMMAND });
            command = false;
        } else {
            out.push({ t: word, cls: word.startsWith("-") ? FLAG : ARG });
        }
        i = j;
    }
    if (out.length === 0) {
        out.push({ t: " ", cls: SPACE });
    }
    return out;
}
