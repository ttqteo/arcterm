// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import { projectsFromAgents } from "./agentsviewmodel";
import { projectListAtom, removeProject, switcherProjects } from "./projectsstore";
import { projectControlCopy } from "./surfacecontext";

// Project scope dropdown bound to projectFilterAtom. "bar" = the app-bar `/ name ▾` trigger;
// "header" = the cockpit-header bordered button. Both share one atom (spec D3).
export function ProjectSwitcher({ model, variant }: { model: AgentsViewModel; variant: "bar" | "header" }) {
    const agents = useAtomValue(model.agentsAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState<string | null>(null);
    const rows = useAtomValue(projectListAtom);
    const projects = switcherProjects(rows, projectsFromAgents(agents));
    const projectLabel = filter === "all" ? "All projects" : filter;
    const copy = projectControlCopy(variant === "header" ? "cockpit" : surface, projectLabel);
    const close = () => {
        setConfirming(null);
        setOpen(false);
    };
    const select = (v: string) => {
        globalStore.set(model.projectFilterAtom, v);
        close();
    };
    const remove = async (name: string) => {
        await removeProject(model, name);
        setConfirming(null);
    };
    return (
        <div className="relative">
            <button
                type="button"
                data-project-switcher={variant}
                title={copy.title}
                aria-label={`${copy.title}: ${projectLabel}`}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "flex cursor-pointer items-center gap-1.5",
                    variant === "bar"
                        ? "rounded-sm px-[7px] py-1 text-[13px] font-medium text-secondary hover:bg-surface-hover hover:text-primary"
                        : "rounded border border-edge-mid bg-surface-raised px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:border-edge-strong"
                )}
            >
                {copy.label}
                <ChevronDown size={12} aria-hidden className="text-muted" />
            </button>
            {open ? <div className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin="top left"
                className="absolute left-0 top-[calc(100%+7px)] z-[60] w-[268px] overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                        <div className="px-3 pb-1.5 pt-[9px]">
                            <span className={cn(REGION_LABEL, "text-muted")}>Switch project</span>
                        </div>
                        <div className="max-h-[46vh] overflow-y-auto px-1.5 pb-1.5">
                            <button
                                type="button"
                                data-project-option="all"
                                onClick={() => select("all")}
                                className={cn(
                                    "flex w-full cursor-pointer items-center gap-2.5 rounded px-2 py-2 text-left hover:bg-surface-hover",
                                    filter === "all" && "bg-accent/10"
                                )}
                            >
                                <span className="h-2 w-2 shrink-0 rounded-[3px] bg-muted" />
                                <span className="flex-1 truncate text-[13px] font-medium text-secondary">
                                    All projects
                                </span>
                                <span className="text-[11px] tabular-nums text-muted">{agents.length}</span>
                                <span className="w-5 shrink-0" />
                            </button>
                            {projects.map((p) => (
                                <div
                                    key={p.name}
                                    className={cn(
                                        "group flex items-center gap-2.5 rounded px-2 hover:bg-surface-hover",
                                        filter === p.name && "bg-accent/10"
                                    )}
                                >
                                    <button
                                        type="button"
                                        data-project-option={p.name}
                                        onClick={() => select(p.name)}
                                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-2 text-left"
                                    >
                                        <span
                                            className={cn(
                                                "h-2 w-2 shrink-0 rounded-[3px]",
                                                p.askingCount > 0 ? "bg-warning" : "bg-success"
                                            )}
                                        />
                                        <span className="flex-1 truncate text-[13px] font-medium text-secondary">
                                            {p.name}
                                        </span>
                                        {p.askingCount > 0 ? (
                                            <span className="text-[10.5px] font-semibold tabular-nums text-warning">
                                                {p.askingCount}
                                            </span>
                                        ) : null}
                                        <span className="text-[11px] tabular-nums text-muted">{p.agentCount}</span>
                                    </button>
                                    {confirming === p.name ? (
                                        <span className="flex shrink-0 items-center gap-1">
                                            <span className="text-[10.5px] font-medium text-muted">Remove?</span>
                                            <button
                                                type="button"
                                                title="Confirm remove"
                                                onClick={() => void remove(p.name)}
                                                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-[5px] text-error hover:bg-error/15"
                                            >
                                                <svg
                                                    width="13"
                                                    height="13"
                                                    viewBox="0 0 20 20"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                >
                                                    <polyline points="4 10 8 14 16 5" />
                                                </svg>
                                            </button>
                                            <button
                                                type="button"
                                                title="Cancel"
                                                onClick={() => setConfirming(null)}
                                                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary"
                                            >
                                                <svg
                                                    width="13"
                                                    height="13"
                                                    viewBox="0 0 20 20"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="1.7"
                                                    strokeLinecap="round"
                                                >
                                                    <line x1="5" y1="5" x2="15" y2="15" />
                                                    <line x1="15" y1="5" x2="5" y2="15" />
                                                </svg>
                                            </button>
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            title="Remove project"
                                            onClick={() => setConfirming(p.name)}
                                            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted opacity-0 hover:bg-error/15 hover:text-error group-hover:opacity-100"
                                        >
                                            <svg
                                                width="13"
                                                height="13"
                                                viewBox="0 0 20 20"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <line x1="3.5" y1="5.5" x2="16.5" y2="5.5" />
                                                <path d="M6 5.5V4h8v1.5" />
                                                <path d="M5 5.5l0.8 10.5h8.4L15 5.5" />
                                                <line x1="8.5" y1="8.5" x2="8.5" y2="13.5" />
                                                <line x1="11.5" y1="8.5" x2="11.5" y2="13.5" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                globalStore.set(model.newProjectOpenAtom, true);
                            }}
                            className="flex w-full cursor-pointer items-center gap-2 border-t border-border px-[15px] py-[11px] text-left text-accent-soft hover:bg-surface-hover"
                        >
                            <Plus size={14} aria-hidden />
                            <span className="text-[12.5px] font-semibold">New project</span>
                        </button>
            </PopoverReveal>
        </div>
    );
}
