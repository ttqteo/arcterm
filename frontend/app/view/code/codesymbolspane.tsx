// frontend/app/view/code/codesymbolspane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The fourth column mode: the open file's outline. A row moves the editor to its line — the file is
// already open, so nothing is read. The outline is a per-language heuristic (codeoutline.ts), so each
// empty state names its reason rather than a bare "nothing here".

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { extOf, langOf } from "./codelang";
import { rankSymbols, type SymbolKind } from "./codeoutline";
import { stepRow } from "./codesearch";
import { codeFileAtom, codeOutlineAtom, goToLine, type CodeFile } from "./codestore";

const KIND_GLYPHS: Record<SymbolKind, { glyph: string; label: string }> = {
    func: { glyph: "ƒ", label: "function" },
    type: { glyph: "T", label: "type" },
    class: { glyph: "C", label: "class" },
    const: { glyph: "K", label: "constant" },
    var: { glyph: "v", label: "variable" },
    heading: { glyph: "#", label: "heading" },
};

const INDENT_PX = 12;
const ROW_PAD_PX = 12;

export function CodeSymbolsPane() {
    const file = useAtomValue(codeFileAtom);
    const outline = useAtomValue(codeOutlineAtom);
    const [filter, setFilter] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const shown = useMemo(() => rankSymbols(filter, outline), [filter, outline]);
    // a ranked list is no longer in file order, so its indentation would describe nothing
    const nested = filter.trim() === "";

    const empty = emptyReason(file, outline.length, shown.length, filter);

    // the search pane's walk: ArrowDown from the filter into the rows, ArrowUp from the first row back
    const walkRows = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
            return;
        }
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-code-symbol-row]")];
        const at = rows.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        const next = stepRow(at, e.key === "ArrowDown" ? 1 : -1, rows.length);
        if (next === -1) {
            inputRef.current?.focus();
        } else {
            rows[next].focus();
        }
    };

    return (
        <div data-code-symbols className="flex h-full flex-col border-r border-border" onKeyDown={walkRows}>
            <div className="flex-none px-2 py-2">
                <input
                    ref={inputRef}
                    data-code-symbols-filter
                    value={filter}
                    placeholder="Filter symbols"
                    aria-label="Filter symbols"
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full rounded-[8px] border border-border bg-surface px-2 py-1 text-[12px] text-primary outline-none placeholder:text-muted"
                />
            </div>
            {empty != null ? (
                <div data-code-symbols-empty className="px-3 py-2 text-[11.5px] text-muted">
                    {empty}
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                    {shown.map((sym) => {
                        const k = KIND_GLYPHS[sym.kind];
                        return (
                            <button
                                key={`${sym.line}:${sym.name}`}
                                type="button"
                                data-code-symbol-row={sym.name}
                                data-line={sym.line}
                                onClick={() => goToLine(sym.line)}
                                style={{ paddingLeft: ROW_PAD_PX + (nested ? sym.depth * INDENT_PX : 0) }}
                                className="flex w-full cursor-pointer items-center gap-2 py-[2px] pr-3 text-left text-[11.5px] hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                            >
                                <span
                                    title={k.label}
                                    className={cn(
                                        "w-[12px] flex-none text-center font-mono text-[10.5px]",
                                        sym.kind === "func" ? "text-accent-soft" : "text-muted"
                                    )}
                                >
                                    {k.glyph}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-mono text-secondary">{sym.name}</span>
                                <span className="flex-none font-mono text-[10.5px] text-muted">{sym.line}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function emptyReason(file: CodeFile, total: number, shown: number, filter: string): string | null {
    if (file.kind === "none") {
        return "No file open";
    }
    if (file.kind === "loading") {
        return "Opening…";
    }
    if (file.kind === "text" && langOf(file.path) === "unknown") {
        const ext = extOf(file.path);
        return `Outline is not available for this file type (${ext === "" ? "no extension" : `.${ext}`})`;
    }
    if (total === 0) {
        return "No symbols found in this file";
    }
    if (shown === 0) {
        return `No symbols match “${filter.trim()}”`;
    }
    return null;
}
