// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New run window's project field (ProjectPicker.dc.html variant 1). Its keys are local to the open
// list rather than keybindings.ts bindings: they only mean anything while the search box has focus.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { stepPick } from "./newrun";
import { homeFromInfo, pickerSections, projectWhere, recentNames } from "./projectpicker";

const GROUP_LABEL = "px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-[.08em] text-muted";

export function ProjectPicker({
    projects,
    recent,
    picked,
    onPick,
    onRegister,
}: {
    projects: { name: string; path: string }[];
    recent: string[];
    picked: string | null;
    onPick: (name: string) => void;
    onRegister: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState<string | null>(null);
    const [home, setHome] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);
    const fieldRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // read on mount, not on first open: the closed field already shows the picked project's where
    useEffect(() => {
        let live = true;
        fireAndForget(async () => {
            let next = "";
            try {
                next = homeFromInfo(await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: "~" } }));
            } catch (e) {
                console.error("project picker: could not read the home folder, showing full paths", e);
            }
            if (live) {
                setHome(next);
            }
        });
        return () => {
            live = false;
        };
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        const close = (e: Event) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    useEffect(() => {
        if (highlight == null) {
            return;
        }
        listRef.current
            ?.querySelector(`[data-project-option="${CSS.escape(highlight)}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [highlight]);

    const pathOf = new Map(projects.map((p) => [p.name, p.path]));
    const whereOf = (name: string) => projectWhere(pathOf.get(name) ?? "", home);
    const names = projects.map((p) => p.name);
    const sections = pickerSections(names, recentNames(names, recent), query, whereOf);
    const visible = [...sections.recent, ...sections.rest];

    const openList = () => {
        setQuery("");
        setHighlight(picked);
        setOpen(true);
    };
    const closeList = () => {
        setOpen(false);
        fieldRef.current?.focus();
    };
    const choose = (name: string) => {
        setOpen(false);
        onPick(name);
    };

    // Enter and Escape stop here: ModalShell listens on window, and neither key is the dialog's while the
    // list is open (Escape closes only the list; Enter is a pick, not "start the run").
    const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight(stepPick(visible, highlight, e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const next = highlight != null && visible.includes(highlight) ? highlight : visible[0];
            if (next != null) {
                choose(next);
            }
        }
    };
    const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
        if (open && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeList();
        }
    };

    const option = (name: string) => {
        const on = name === picked;
        return (
            <button
                key={name}
                type="button"
                role="option"
                aria-selected={on}
                data-project-option={name}
                title={pathOf.get(name)}
                onMouseEnter={() => setHighlight(name)}
                onClick={() => choose(name)}
                className={cn(
                    "flex w-full min-w-0 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left",
                    name === highlight ? "bg-surface-selected" : "bg-transparent"
                )}
            >
                <span className="w-3 flex-none text-[11px] text-accent-soft">{on ? "✓" : ""}</span>
                <span className="flex-none truncate text-[12.5px] font-medium text-ink-hi">{name}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-muted">
                    {whereOf(name)}
                </span>
            </button>
        );
    };

    return (
        <div ref={rootRef} onKeyDown={onRootKey} className="flex flex-col gap-0.5">
            <button
                ref={fieldRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => (open ? setOpen(false) : openList())}
                className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-[7px] border bg-surface px-2.5 py-[7px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    open ? "border-accent-700" : "border-edge-mid"
                )}
            >
                {picked != null ? (
                    <>
                        <span className="flex-none truncate text-[13px] font-semibold text-primary">{picked}</span>
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">
                            {whereOf(picked)}
                        </span>
                    </>
                ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">Pick a project</span>
                )}
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                    className="flex-none text-muted"
                >
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>
            {open ? (
                <div className="flex flex-col overflow-hidden rounded-[8px] border border-edge-strong bg-surface-raised shadow-popover-md">
                    <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
                        <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                            className="flex-none text-muted"
                        >
                            <circle cx="11" cy="11" r="7" />
                            <path d="m20 20-3.5-3.5" />
                        </svg>
                        <input
                            autoFocus
                            value={query}
                            aria-label="Search projects"
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={onSearchKey}
                            placeholder={`Search ${names.length} projects`}
                            className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-muted"
                        />
                    </div>
                    <div
                        ref={listRef}
                        role="listbox"
                        aria-label="Projects"
                        className="flex max-h-[240px] flex-col overflow-y-auto pb-1"
                    >
                        {sections.recent.length > 0 ? (
                            <>
                                <span className={GROUP_LABEL}>Recent</span>
                                {sections.recent.map(option)}
                            </>
                        ) : null}
                        <span className={GROUP_LABEL}>{sections.restLabel}</span>
                        {sections.rest.map(option)}
                        {visible.length === 0 ? (
                            <span className="px-3 py-1.5 text-[12px] text-muted">No project matches.</span>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-3.5 border-t border-border px-3 py-1.5 text-[10px] text-muted">
                        <span>↑↓ move</span>
                        <span>⏎ pick</span>
                        <span>esc close</span>
                        <span className="flex-1" />
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onRegister();
                            }}
                            className="cursor-pointer text-ink-mid hover:text-primary"
                        >
                            Register a project
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
