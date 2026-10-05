// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The design's project chips (design L864: a two-column grid with "last used"; L796: a wrapping row). The
// design shows four projects; a registry of a hundred cannot be four chips, so the last-used project and
// the next three ranked names are chips, and a search box reaches the rest.

import { cn } from "@/util/util";
import { useState, type KeyboardEvent } from "react";
import { rankProjects } from "./newrun";

const CHIP_COUNT = 4;
const SEARCH_RESULT_COUNT = 8;

export function ProjectChips({
    names,
    picked,
    recent,
    onPick,
    columns,
    allowCustom = false,
    onKeyDown,
}: {
    names: string[];
    picked: string | null;
    recent: string | null;
    onPick: (name: string) => void;
    columns: 1 | 2;
    // a free-text project (New initiative): a query nothing matches can be used as the value itself
    allowCustom?: boolean;
    // the search box's keys, with the chips it currently shows, so a caller can walk them with arrows
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>, visible: string[]) => void;
}) {
    const [query, setQuery] = useState("");
    const q = query.trim();
    const ranked = rankProjects(names, query);
    // picked stays a chip even off the registry, so a free-text value an initiative already carries shows
    const head =
        q === ""
            ? [
                  ...new Set(
                      [recent, picked, ...ranked].filter(
                          (n): n is string => n != null && n !== "" && (names.includes(n) || n === picked)
                      )
                  ),
              ].slice(0, CHIP_COUNT)
            : ranked.slice(0, SEARCH_RESULT_COUNT);
    const custom = allowCustom && q !== "" && ranked.length === 0 ? q : null;
    return (
        <div className="flex flex-col gap-1.5">
            {head.length > 0 || custom != null ? (
                <div className={cn(columns === 2 ? "grid grid-cols-2 gap-1.5" : "flex flex-wrap gap-1.5")}>
                    {head.map((name) => {
                        const on = name === picked;
                        return (
                            <button
                                key={name}
                                type="button"
                                title={name}
                                aria-pressed={on}
                                onClick={() => onPick(name)}
                                className={cn(
                                    "flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] border text-left text-[12px] font-medium hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    columns === 2 ? "px-2.5 py-[7px]" : "px-2.5 py-[5px]",
                                    on
                                        ? "border-accent/40 bg-accentbg text-accent-soft"
                                        : "border-border bg-surface-raised text-ink-mid"
                                )}
                            >
                                {columns === 2 ? (
                                    <span
                                        className={cn(
                                            "h-[7px] w-[7px] flex-none rounded-[2px]",
                                            name === recent ? "bg-asking" : "bg-success"
                                        )}
                                    />
                                ) : null}
                                <span className="min-w-0 flex-1 truncate">{name}</span>
                                {columns === 2 && name === recent ? (
                                    <span className="flex-none text-[10.5px] text-muted">last used</span>
                                ) : null}
                            </button>
                        );
                    })}
                    {custom != null ? (
                        <button
                            type="button"
                            aria-pressed={picked === custom}
                            onClick={() => onPick(custom)}
                            className={cn(
                                "min-w-0 cursor-pointer truncate rounded-[7px] border px-2.5 py-[5px] text-left text-[12px] font-medium hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                picked === custom
                                    ? "border-accent/40 bg-accentbg text-accent-soft"
                                    : "border-border bg-surface-raised text-ink-mid"
                            )}
                        >
                            Use “{custom}”
                        </button>
                    ) : null}
                </div>
            ) : q !== "" ? (
                <span className="px-2.5 py-[5px] text-[12px] text-muted">No project matches.</span>
            ) : null}
            {names.length > CHIP_COUNT || allowCustom ? (
                <input
                    value={query}
                    aria-label="Search projects"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown != null ? (e) => onKeyDown(e, head) : undefined}
                    placeholder={
                        names.length > CHIP_COUNT ? `Search ${names.length} projects…` : "Search or type a project…"
                    }
                    className="w-full rounded-[7px] border border-edge-mid bg-background px-2.5 py-1.5 text-[12px] text-primary outline-none placeholder:text-muted focus:border-accent/60"
                />
            ) : null}
        </div>
    );
}
