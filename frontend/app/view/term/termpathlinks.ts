// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// File paths in terminal output as links (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md): candidates
// from pathlinks.ts, resolved against the block's cwd, underlined only once the file is known to exist. Ctrl+click
// (Cmd on macOS) opens one, the way a URL opens. A path too long for its row, which xterm wraps or an agent TUI breaks
// and indents, is joined back across the rows.

import type { FileRef } from "@/app/view/agents/agentrailtabs";
import { fileExists } from "@/app/view/agents/pathlinkroute";
import {
    findPathCandidates,
    findSpanningPaths,
    resolvePath,
    type RowCell,
    type TermRow,
} from "@/app/view/agents/pathlinks";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import type { IBufferRange, IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

export interface PathLinkHooks {
    cwd: () => string | null;
    activate: (ref: FileRef) => void;
    hover: (e: MouseEvent, ref: FileRef) => void;
    leave: () => void;
}

// a file comes into being while the terminal shows its name, so a miss is only trusted for a while
const CACHE_MS = 10_000;
const known = new Map<string, { ok: boolean; at: number }>();

async function exists(abs: string): Promise<boolean> {
    const hit = known.get(abs);
    if (hit != null && Date.now() - hit.at < CACHE_MS) {
        return hit.ok;
    }
    const ok = await fileExists(abs);
    known.set(abs, { ok, at: Date.now() });
    return ok;
}

export function isOpenGesture(e: MouseEvent): boolean {
    return PLATFORM === PlatformMacOS ? e.metaKey : e.ctrlKey;
}

export function hintFor(ref: FileRef): string {
    const name = ref.abs.split(/[\\/]/).pop() ?? ref.abs;
    return `open ${name}${ref.line != null ? ` at line ${ref.line}` : ""}`;
}

// the existing files a line names, as references
async function refsForLine(text: string, cwd: string | null) {
    const out: { text: string; start: number; end: number; ref: FileRef }[] = [];
    for (const c of findPathCandidates(text)) {
        const abs = resolvePath(cwd, c.path);
        if (abs == null || !(await exists(abs))) {
            continue;
        }
        out.push({
            text: c.text,
            start: c.start,
            end: c.end,
            ref: { abs, root: cwd, ...(c.line != null ? { line: c.line } : {}) },
        });
    }
    return out;
}

// how many rows either side of the hovered one a path broken across rows is looked for in
const SPAN_ROWS = 3;

// the existing files named by paths that run across rows and touch row `y` (0-based), with their ranges in buffer rows
async function spanningRefsAt(term: Terminal, y: number, cwd: string | null) {
    const buf = term.buffer.active;
    const from = Math.max(0, y - SPAN_ROWS);
    const to = Math.min(buf.length - 1, y + SPAN_ROWS);
    const rows: TermRow[] = [];
    for (let i = from; i <= to; i++) {
        const line = buf.getLine(i);
        rows.push({ text: line?.translateToString(true) ?? "", wrapped: line?.isWrapped ?? false });
    }
    const out: { text: string; start: RowCell; end: RowCell; ref: FileRef }[] = [];
    for (const s of findSpanningPaths(rows, term.cols)) {
        if (s.start.row + from > y || s.end.row + from < y) {
            continue;
        }
        const abs = resolvePath(cwd, s.path);
        if (abs == null || !(await exists(abs))) {
            continue;
        }
        out.push({
            text: s.text,
            start: { row: s.start.row + from, col: s.start.col },
            end: { row: s.end.row + from, col: s.end.col },
            ref: { abs, root: cwd, ...(s.line != null ? { line: s.line } : {}) },
        });
    }
    return out;
}

export function makePathLinkProvider(term: Terminal, hooks: PathLinkHooks): ILinkProvider {
    const link = (text: string, range: IBufferRange, ref: FileRef): ILink => ({
        range,
        text,
        decorations: { underline: true, pointerCursor: true },
        activate: (e) => {
            if (isOpenGesture(e)) {
                hooks.activate(ref);
            }
        },
        hover: (e) => hooks.hover(e, ref),
        leave: () => hooks.leave(),
    });
    return {
        provideLinks(y, callback) {
            const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
            if (text.trim() === "") {
                callback(undefined);
                return;
            }
            const cwd = hooks.cwd();
            void Promise.all([refsForLine(text, cwd), spanningRefsAt(term, y - 1, cwd)]).then(([found, spanning]) => {
                // xterm ranges are 1-based and inclusive
                const links: ILink[] = spanning.map((s) =>
                    link(
                        s.text,
                        { start: { x: s.start.col + 1, y: s.start.row + 1 }, end: { x: s.end.col, y: s.end.row + 1 } },
                        s.ref
                    )
                );
                for (const f of found) {
                    links.push(link(f.text, { start: { x: f.start + 1, y }, end: { x: f.end, y } }, f.ref));
                }
                callback(links.length > 0 ? links : undefined);
            });
        },
    };
}

// DEV only: lets a CDP scenario read a terminal's path links and follow one without aiming a mouse at a canvas
const devTerms = new Map<string, { term: Terminal; hooks: PathLinkHooks }>();

export function trackForDev(blockId: string, term: Terminal, hooks: PathLinkHooks): IDisposable {
    if (!import.meta.env.DEV) {
        return { dispose: () => {} };
    }
    devTerms.set(blockId, { term, hooks });
    (window as any).__arcTermPathLinks ??= {
        scan: async (id: string) => {
            const t = devTerms.get(id);
            if (t == null) {
                return null;
            }
            const buf = t.term.buffer.active;
            const found = [];
            for (let i = 0; i < buf.length; i++) {
                const text = buf.getLine(i)?.translateToString(true) ?? "";
                for (const f of await refsForLine(text, t.hooks.cwd())) {
                    found.push({ text: f.text, abs: f.ref.abs, line: f.ref.line ?? null });
                }
            }
            return found;
        },
        // where a link's text sits on screen (the middle of its third cell), so a scenario can hover and Ctrl+click it
        locate: (id: string, linkText: string) => {
            const t = devTerms.get(id);
            const screen = t?.term.element?.querySelector(".xterm-screen") as HTMLElement | null;
            if (t == null || screen == null) {
                return null;
            }
            const buf = t.term.buffer.active;
            const r = screen.getBoundingClientRect();
            const cw = r.width / t.term.cols;
            const ch = r.height / t.term.rows;
            for (let row = 0; row < t.term.rows; row++) {
                const text = buf.getLine(buf.viewportY + row)?.translateToString(true) ?? "";
                const c = findPathCandidates(text).find((c) => c.text === linkText);
                if (c != null) {
                    return {
                        x: r.left + (c.start + Math.min(2, c.end - c.start - 1) + 0.5) * cw,
                        y: r.top + (row + 0.5) * ch,
                    };
                }
            }
            return null;
        },
        // the line the cursor is on, up to the cursor and untrimmed, so a scenario reads what a drop typed: its trailing
        // space and quotes included. A line the terminal wrapped is one line to the shell, so the rows above the cursor's
        // that it continues are part of it
        cursorLine: (id: string) => {
            const t = devTerms.get(id);
            if (t == null) {
                return null;
            }
            const buf = t.term.buffer.active;
            let y = buf.baseY + buf.cursorY;
            let row = buf.getLine(y);
            if (row == null) {
                return null;
            }
            let text = row.translateToString(false).slice(0, buf.cursorX);
            while (row.isWrapped && y > 0) {
                y--;
                row = buf.getLine(y);
                if (row == null) {
                    break;
                }
                text = row.translateToString(false) + text;
            }
            return text;
        },
        open: async (id: string, linkText: string) => {
            const t = devTerms.get(id);
            if (t == null) {
                return false;
            }
            const buf = t.term.buffer.active;
            for (let i = buf.length - 1; i >= 0; i--) {
                const text = buf.getLine(i)?.translateToString(true) ?? "";
                const hit = (await refsForLine(text, t.hooks.cwd())).find((f) => f.text === linkText);
                if (hit != null) {
                    t.hooks.activate(hit.ref);
                    return true;
                }
            }
            return false;
        },
    };
    // a remount registers the block's new terminal before the old one disposes, so only drop our own entry
    return {
        dispose: () => {
            if (devTerms.get(blockId)?.term === term) {
                devTerms.delete(blockId);
            }
        },
    };
}
