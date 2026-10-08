// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The sign-in dialog (cockpit/claude-signin-modal.tsx) runs `claude setup-token` in a helper terminal and
// reads the token out of its pty output, so the user never copies it. TokenScanner is fed the raw output
// chunk by chunk; setupTokenCommand picks what the helper terminal runs.

const PREFIX = "sk-ant-oat01-";
const MIN_TAIL = 8;
const KEEP = 8192;
const TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]*/g;
// setup-token prints the token with a margin, so a wrapped row may start (and end) with spaces
const TOKEN_LINE = /^\s*[A-Za-z0-9_-]+\s*$/;
const PARTIAL_TOKEN_LINE = /^\s*[A-Za-z0-9_-]*$/;
// ConPTY reaches the next printed row with a cursor move rather than a newline, and writes spaces as
// cursor-forward: read a move to another row as a line break and a move along the row as a space, so the
// text after the token is never glued onto it
// eslint-disable-next-line no-control-regex
const ROW_MOVE_RE = /\x1b\[[0-9;]*[HfABEFd]/g;
// eslint-disable-next-line no-control-regex
const COL_MOVE_RE = /\x1b\[[0-9;]*[CDG`]/g;
// CSI (colors, cursor moves), OSC (titles, links) and the two-byte charset/save escapes
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[78=>]/g;
// an escape sequence cut off at the end of a chunk: its \x1b must not read as the character ending a token
// eslint-disable-next-line no-control-regex
const PARTIAL_ANSI_RE = /\x1b(?:\[[0-9;?]*|\][^\x07\x1b]*|[()])?$/;

/**
 * Finds the setup-token token in a terminal's output. A token is reported only once a non-token character
 * follows it, so a half-printed one is never taken. A terminal wrap splits it across lines: a token that
 * reaches the end of a line continues onto the next only when that whole next line is token characters;
 * otherwise it ends at the line break.
 */
export class TokenScanner {
    private buf = "";
    private done = false;

    /** Adds a chunk of output; returns the token the first time a complete one is seen, else null. */
    push(chunk: string): string | null {
        if (this.done) {
            return null;
        }
        this.buf = (this.buf + chunk).slice(-KEEP);
        const text = this.buf
            .replace(ROW_MOVE_RE, "\n")
            .replace(COL_MOVE_RE, " ")
            .replace(ANSI_RE, "")
            .replace(PARTIAL_ANSI_RE, "")
            .replace(/\r/g, "");
        const token = findToken(text.split("\n"));
        if (token != null) {
            this.done = true;
            this.buf = "";
        }
        return token;
    }
}

function findToken(lines: string[]): string | null {
    for (let i = 0; i < lines.length; i++) {
        TOKEN_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = TOKEN_RE.exec(lines[i])) != null) {
            let token = m[0];
            if (m.index + token.length === lines[i].trimEnd().length) {
                if (i === lines.length - 1) {
                    // the token is the last thing printed: more of it may still come
                    return null;
                }
                // the token reaches the end of its line: join each following line that is all token characters
                let j = i + 1;
                for (; j < lines.length - 1 && TOKEN_LINE.test(lines[j]); j++) {
                    token += lines[j].trim();
                }
                if (j === lines.length - 1 && PARTIAL_TOKEN_LINE.test(lines[j])) {
                    // the line still being printed may yet turn out to be the token's continuation
                    return null;
                }
            }
            if (token.length >= PREFIX.length + MIN_TAIL) {
                return token;
            }
        }
    }
    return null;
}

const setupToken = () => ({ cmd: "claude", args: ["setup-token"] });

/**
 * What the sign-in terminal runs: `claude setup-token`, except that a dev build takes a JSON
 * `{ cmd, args }` override (localStorage "arc:dev:setuptoken-cmd") so a CDP scenario can drive the dialog
 * without opening a browser. A missing or malformed override falls back to claude.
 */
export function setupTokenCommand(isDev: boolean, override: string | null): { cmd: string; args: string[] } {
    if (!isDev || override == null) {
        return setupToken();
    }
    try {
        const v = JSON.parse(override);
        if (
            typeof v?.cmd === "string" &&
            Array.isArray(v.args) &&
            v.args.every((a: unknown) => typeof a === "string")
        ) {
            return { cmd: v.cmd, args: v.args };
        }
    } catch {
        // malformed JSON: run the real command
    }
    return setupToken();
}
