// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's details for the Tool row (docs/superpowers/specs/2026-10-13-terminals-and-tools-design.md, "The New
// dialog"): where an agent row has Resume and Task, a Tool pick has the Tool list, the dialog's third Tab stop, picked
// by letters, and beside it an About card; under both, the command the tool runs. There is no Task, Flag or worktree
// toggle: a tool is a plain terminal that types its command at the first prompt (toolsstore openTool).

import { cn } from "@/util/util";
import type { RefObject } from "react";
import { toolAboutLine, toolRowNote } from "./launcher";
import { LAUNCHER_LABEL } from "./launcheragentfields";
import { toolCommandLine } from "./toolsmodel";

interface ToolFieldsProps {
    // the tools in pickerOrder; null until the first status read lands
    tools: ToolStatus[] | null;
    // why the status could not be read, while there is nothing to list
    error: string | null;
    // the tool on show
    tool: ToolStatus | null;
    // Home is picked, so the tool runs in the home folder
    atHome: boolean;
    // the list has focus, so its pick is the keyboard's cursor (the dialog's zone)
    focused: boolean;
    listRef: RefObject<HTMLDivElement>;
    onFocus: () => void;
    onBlur: () => void;
    onPick: (id: string) => void;
    // All tools in Setup
    onAll: () => void;
}

// a row's letter; the list can run past z, and a row with no letter is reached by the arrows and the mouse
function letterOf(i: number): string {
    return i < 26 ? String.fromCharCode(97 + i) : "";
}

export function ToolFields({
    tools,
    error,
    tool,
    atHome,
    focused,
    listRef,
    onFocus,
    onBlur,
    onPick,
    onAll,
}: ToolFieldsProps) {
    return (
        <>
            <div className="flex gap-4">
                <div className="flex w-[266px] shrink-0 flex-col gap-2">
                    <span className={cn(LAUNCHER_LABEL, focused && "text-secondary")}>Tool</span>
                    <div
                        className={cn(
                            "flex flex-col gap-0.5 rounded-[8px] border bg-surface p-1",
                            focused ? "border-accent-700" : "border-edge-mid"
                        )}
                    >
                        <div
                            ref={listRef}
                            role="listbox"
                            aria-label="Tool"
                            tabIndex={0}
                            data-launcher-tool-list
                            onFocus={onFocus}
                            onBlur={onBlur}
                            className="flex flex-col gap-0.5 outline-none"
                        >
                            {tools == null ? (
                                <span
                                    data-launcher-tool-status
                                    className={cn(
                                        "px-2 py-[7px] text-[12px]",
                                        error != null ? "text-error" : "text-muted"
                                    )}
                                >
                                    {error != null
                                        ? `Could not read the tool list: ${error}`
                                        : "Reading the tool list…"}
                                </span>
                            ) : (
                                tools.map((t, i) => {
                                    const selected = t.id === tool?.id;
                                    return (
                                        <div
                                            key={t.id}
                                            role="option"
                                            aria-selected={selected}
                                            data-launcher-tool={t.id}
                                            onClick={() => onPick(t.id)}
                                            className={cn(
                                                "flex cursor-pointer items-center gap-[9px] rounded-[6px] px-2 py-[7px]",
                                                selected ? "bg-surface-selected" : "hover:bg-surface-hover",
                                                // the picked row is the keyboard's cursor while the list has focus
                                                selected && focused && "ring-1 ring-inset ring-accent-700"
                                            )}
                                        >
                                            <span
                                                aria-hidden
                                                className={cn(
                                                    "w-[15px] shrink-0 font-mono text-[10.5px]",
                                                    selected ? "text-ink-hi" : "text-muted"
                                                )}
                                            >
                                                {letterOf(i)}
                                            </span>
                                            <span
                                                className={cn(
                                                    "min-w-0 flex-1 truncate text-[13px]",
                                                    selected ? "font-semibold text-primary" : "text-muted-foreground"
                                                )}
                                            >
                                                {t.name}
                                            </span>
                                            <span className="shrink-0 text-[11px] text-muted">{toolRowNote(t)}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                        <button
                            type="button"
                            data-launcher-tool-all
                            onClick={onAll}
                            className="flex cursor-pointer items-center rounded-[6px] py-[7px] pl-8 pr-2 text-left text-[12.5px] text-accent-soft hover:bg-surface-hover hover:text-accent"
                        >
                            All tools in Setup
                        </button>
                    </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className={LAUNCHER_LABEL}>About</span>
                    <div
                        data-launcher-tool-about
                        className="flex flex-1 flex-col gap-2 rounded-[8px] border border-edge-mid bg-surface px-[14px] py-3"
                    >
                        {tool != null ? (
                            <>
                                <span className="text-[13px] font-semibold text-primary">{tool.name}</span>
                                <span className="text-[12.5px] leading-[18px] text-secondary">{tool.purpose}</span>
                                <span className="text-[12px] leading-[17px] text-muted">
                                    {toolAboutLine(tool, atHome)}
                                </span>
                            </>
                        ) : (
                            <span className="text-[12px] text-muted">Pick a tool to read what it does.</span>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <span className={LAUNCHER_LABEL}>Command</span>
                <div
                    data-launcher-tool-command
                    className="flex min-h-[36px] items-center gap-2 rounded-[8px] border border-edge-mid bg-surface px-3"
                >
                    <span className="font-mono text-[12.5px] font-semibold text-success">›</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-secondary">
                        {tool != null ? toolCommandLine(tool) : ""}
                    </span>
                </div>
            </div>
        </>
    );
}
