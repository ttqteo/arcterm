// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// File paths in terminal output as links (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md): candidates
// from pathlinks.ts, resolved against the block's cwd, underlined only once the file is known to exist. Ctrl+click
// (Cmd on macOS) opens one, the way a URL opens.

import type { FileRef } from "@/app/view/agents/agentrailtabs";
import { fileExists } from "@/app/view/agents/pathlinkroute";
import { findPathCandidates, resolvePath } from "@/app/view/agents/pathlinks";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import type { IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

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

export function makePathLinkProvider(term: Terminal, hooks: PathLinkHooks): ILinkProvider {
    return {
        provideLinks(y, callback) {
            const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
            if (text.trim() === "") {
                callback(undefined);
                return;
            }
            void refsForLine(text, hooks.cwd()).then((found) => {
                const links: ILink[] = found.map((f) => ({
                    // xterm ranges are 1-based and inclusive
                    range: { start: { x: f.start + 1, y }, end: { x: f.end, y } },
                    text: f.text,
                    decorations: { underline: true, pointerCursor: true },
                    activate: (e) => {
                        if (isOpenGesture(e)) {
                            hooks.activate(f.ref);
                        }
                    },
                    hover: (e) => hooks.hover(e, f.ref),
                    leave: () => hooks.leave(),
                }));
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
