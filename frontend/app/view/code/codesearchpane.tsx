// frontend/app/view/code/codesearchpane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Content search results, in the left column rather than an overlay: results are read repeatedly
// while jumping between them, and an overlay that closes on each jump makes that a loop of
// reopening. Every result row goes through openInCode, the same primitive the finder and the two
// cockpit entry points use.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { groupMatches, stepRow, summarize, type SearchGroup } from "./codesearch";
import type { SearchOpts } from "./codesearchopts";
import {
    codeSearchAtom,
    codeSearchInvalidAtom,
    codeSearchOptsAtom,
    codeSearchQueryAtom,
    runSearch,
    type SearchState,
} from "./codesearchstore";
import { codeProjectAtom, openInCode } from "./codestore";

type SearchFlag = "caseSensitive" | "wholeWord" | "regex";

// the glyphs every editor's search box uses; the titles carry the words
const FLAGS: { key: SearchFlag; glyph: string; title: string }[] = [
    { key: "caseSensitive", glyph: "Aa", title: "Match case" },
    { key: "wholeWord", glyph: "\\b", title: "Match whole word" },
    { key: "regex", glyph: ".*", title: "Use regular expression" },
];

const FIELD_CLASS =
    "w-full rounded-[8px] border bg-surface px-2 py-1 text-[12px] text-primary outline-none placeholder:text-muted";
const SMALL_BUTTON_CLASS =
    "cursor-pointer rounded-[6px] px-1.5 py-[2px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function CodeSearchPane({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(codeProjectAtom);
    const [query, setQuery] = useAtom(codeSearchQueryAtom);
    const [opts, setOpts] = useAtom(codeSearchOptsAtom);
    const [invalid, setInvalid] = useAtom(codeSearchInvalidAtom);
    const state = useAtomValue(codeSearchAtom);
    const inputRef = useRef<HTMLInputElement>(null);
    const filteringPaths = opts.include.trim() !== "" || opts.exclude.trim() !== "";
    // starts open when a path filter is set, so a filter that empties the result is never hidden
    const [pathsOpen, setPathsOpen] = useState(filteringPaths);

    // the surface unmounts on nav switch, so this runs on every return to Search mode — which is
    // what you want: the query survives in an atom, the caret comes back to it
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const groups = useMemo(() => (state.kind === "done" ? groupMatches(state.matches) : []), [state]);

    const search = (next: SearchOpts) => {
        if (project != null) {
            fireAndForget(() => runSearch(project, query, next));
        }
    };
    const submit = () => search(opts);
    const submitOnEnter = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submit();
        }
    };

    // a flag changes what the query means, so results already on screen re-run rather than go stale
    const toggle = (key: SearchFlag) => {
        const next = { ...opts, [key]: !opts[key] };
        setOpts(next);
        if (state.kind !== "idle" || invalid) {
            search(next);
        }
    };

    // ArrowDown from the query walks into the results and ArrowUp from the first row walks back out.
    // Rows are buttons, so Enter opens one and Tab still leaves the list.
    const walkRows = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
            return;
        }
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-code-search-row]")];
        const at = rows.indexOf(document.activeElement as HTMLElement);
        if (at === -1 && document.activeElement !== inputRef.current) {
            return; // the path filter inputs keep their own arrows
        }
        e.preventDefault();
        const next = stepRow(at, e.key === "ArrowDown" ? 1 : -1, rows.length);
        if (next === -1) {
            inputRef.current?.focus();
        } else {
            rows[next].focus();
        }
    };

    return (
        <div className="flex h-full flex-col border-r border-border" onKeyDown={walkRows}>
            <div className="flex flex-none flex-col gap-1 px-2 py-2">
                <input
                    ref={inputRef}
                    data-code-search-input
                    value={query}
                    placeholder="Search file contents"
                    aria-invalid={invalid}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setInvalid(false);
                    }}
                    onKeyDown={submitOnEnter}
                    className={cn(FIELD_CLASS, invalid ? "border-error" : "border-border")}
                />
                <div className="flex items-center gap-1">
                    {FLAGS.map((f) => (
                        <button
                            key={f.key}
                            type="button"
                            aria-pressed={opts[f.key]}
                            aria-label={f.title}
                            title={f.title}
                            data-code-search-flag={f.key}
                            onClick={() => toggle(f.key)}
                            className={cn(
                                SMALL_BUTTON_CLASS,
                                "font-mono text-[11px]",
                                opts[f.key] ? "bg-accent/10 text-accent-soft" : "text-muted hover:text-primary"
                            )}
                        >
                            {f.glyph}
                        </button>
                    ))}
                    {invalid && <span className="text-[10.5px] text-error">Invalid pattern</span>}
                    <button
                        type="button"
                        aria-expanded={pathsOpen}
                        onClick={() => setPathsOpen(!pathsOpen)}
                        className={cn(
                            SMALL_BUTTON_CLASS,
                            "ml-auto text-[10.5px]",
                            filteringPaths ? "text-accent-soft" : "text-muted hover:text-primary"
                        )}
                    >
                        Filter paths
                    </button>
                </div>
                {pathsOpen && (
                    <>
                        <input
                            value={opts.include}
                            placeholder="Include, e.g. *.go, pkg"
                            aria-label="Include paths"
                            data-code-search-include
                            onChange={(e) => setOpts({ ...opts, include: e.target.value })}
                            onKeyDown={submitOnEnter}
                            className={cn(FIELD_CLASS, "border-border")}
                        />
                        <input
                            value={opts.exclude}
                            placeholder="Exclude, e.g. vendor, *_test.go"
                            aria-label="Exclude paths"
                            data-code-search-exclude
                            onChange={(e) => setOpts({ ...opts, exclude: e.target.value })}
                            onKeyDown={submitOnEnter}
                            className={cn(FIELD_CLASS, "border-border")}
                        />
                    </>
                )}
            </div>
            <SearchBody model={model} state={state} groups={groups} onRetry={submit} />
        </div>
    );
}

function SearchBody({
    model,
    state,
    groups,
    onRetry,
}: {
    model: AgentsViewModel;
    state: SearchState;
    groups: SearchGroup[];
    onRetry: () => void;
}) {
    const project = useAtomValue(codeProjectAtom);
    if (state.kind === "idle") {
        return <div className="px-3 py-2 text-[11.5px] text-muted">Type a string and press Enter.</div>;
    }
    if (state.kind === "searching") {
        return <div className="px-3 py-2 text-[11.5px] text-muted">Searching…</div>;
    }
    if (state.kind === "error") {
        return (
            <div className="px-3 py-2 text-[11.5px] text-muted">
                <p className="text-error">Search failed: {state.message}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-1 cursor-pointer rounded-[6px] border border-border px-2 py-[3px] text-[11px] hover:text-primary"
                >
                    Retry
                </button>
            </div>
        );
    }
    return (
        <>
            <div className="flex-none px-3 pb-1 text-[10.5px] text-muted">{summarize(groups, state.truncated)}</div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {groups.map((group) => (
                    <div key={group.path}>
                        <div className="sticky top-0 bg-surface px-2 py-1 text-[10.5px] text-muted">
                            {group.path}
                        </div>
                        {group.matches.map((match) => (
                            <button
                                key={`${match.path}:${match.line}`}
                                type="button"
                                data-code-search-row
                                onClick={() => {
                                    if (project != null) {
                                        fireAndForget(() =>
                                            openInCode(model, {
                                                projectPath: project.path,
                                                rel: match.path,
                                                line: match.line,
                                            })
                                        );
                                    }
                                }}
                                className="flex w-full cursor-pointer gap-2 px-3 py-[2px] text-left text-[11.5px] hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
                            >
                                <span className="w-[34px] flex-none text-right font-mono text-[10.5px] text-muted">
                                    {match.line}
                                </span>
                                <span className="min-w-0 truncate font-mono text-secondary">{match.text.trim()}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </>
    );
}
