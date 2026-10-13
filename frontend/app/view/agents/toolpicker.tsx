// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// "Open a tool": the quick picker for the tool library, in the command palette's modal shell. It opens a tool in the
// folder the focused agent is in (or a project's root, from a folder's tool button), installs one that is missing and
// shows an install under way. Mounted once in the shell and driven by toolPickerAtom (toolsstore.ts); what it says and
// what a key does are toolpickermodel.ts.

import { ModalShell } from "@/app/modals/modalshell";
import { PLATFORM } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { GitBranch, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { liveBranches, notableBranch } from "./agentsidebarmodel";
import { projectsAtom } from "./projectsstore";
import { sessionsArchiveAtom } from "./sessionsarchivestore";
import { openSetupTool, watchInstallEnds } from "./setupstore";
import {
    flatRows,
    footerHints,
    openRefusal,
    pickerContext,
    pickerGroups,
    pickerKey,
    rowNote,
    rowOpensIn,
    selectedRow,
    type PickerAction,
    type PickerFocus,
    type PickerRow,
} from "./toolpickermodel";
import { ToolIcon } from "./toolslibrary";
import { installCommand, toolCommandLine, toolIcon } from "./toolsmodel";
import {
    closeToolPicker,
    failedAtom,
    installingAtom,
    installTool,
    loadTools,
    openTool,
    pinnedToolsAtom,
    retryInstall,
    showInstall,
    toolContext,
    toolPickerAtom,
    toolsErrorAtom,
    toolsStatusAtom,
    type InstallResult,
    type OpenToolResult,
} from "./toolsstore";

const KEY_CAP = "rounded-[5px] border border-edge-mid px-1.5 py-px font-mono text-[10.5px]";
const LINK = "cursor-pointer text-[12px] text-accent hover:text-accenthover";
const BTN =
    "h-[26px] cursor-pointer whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised px-2.5 text-[12px] text-muted hover:border-edge-strong hover:bg-surface-hover hover:text-primary";

// the result's reason, null when it went ahead; `in` narrows where `ok` does not (the project is not strictNullChecks)
function refusal(r: OpenToolResult | InstallResult): string | null {
    return "reason" in r ? r.reason : null;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// a button or link on a row acts on its row only: the row itself opens the tool
function onRow(fn: () => void) {
    return (e: MouseEvent) => {
        e.stopPropagation();
        fn();
    };
}

function Cmd({ children, selected }: { children: ReactNode; selected?: boolean }) {
    return <span className={cn("font-mono text-[11px]", selected ? "text-muted" : "text-ink-faint")}>{children}</span>;
}

interface RowProps {
    row: PickerRow;
    index: number;
    selected: boolean;
    onHover: (i: number) => void;
    onOpen: (row: PickerRow) => void;
    onInstall: (row: PickerRow) => void;
    onShow: (row: PickerRow) => void;
    onRetry: (row: PickerRow) => void;
    onEdit: (row: PickerRow) => void;
}

function ToolRow({ row, index, selected, onHover, onOpen, onInstall, onShow, onRetry, onEdit }: RowProps) {
    const { tool, state } = row;
    const note = rowNote(row, PLATFORM);
    // a running install is said on the right with its Show; the line under the name stays what the tool is for
    const second = note.tone === "busy" ? tool.purpose : note.text;
    const opensIn = rowOpensIn(tool);
    const install = installCommand(tool, PLATFORM);
    return (
        <div
            role="option"
            aria-selected={selected}
            data-idx={index}
            data-tool-picker-row={tool.id}
            data-tool-picker-state={state}
            onMouseMove={() => onHover(index)}
            onClick={() => onOpen(row)}
            className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-2",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <span
                className={cn(
                    "flex h-7 w-7 flex-none items-center justify-center rounded-[6px] bg-surface",
                    tool.found ? "text-secondary" : "text-ink-faint"
                )}
            >
                <ToolIcon name={toolIcon(tool)} size={15} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span
                    className={cn("truncate text-[13px] font-medium", tool.found ? "text-primary" : "text-secondary")}
                >
                    {tool.name}
                </span>
                <span className={cn("truncate text-[12px]", note.tone === "error" ? "text-error-soft" : "text-muted")}>
                    {second}
                </span>
            </div>
            {state === "installing" ? (
                <>
                    <span className="h-1.5 w-1.5 flex-none rounded-full bg-working" aria-hidden />
                    <span className="flex-none text-[12px] text-secondary">{note.text}</span>
                    <button type="button" data-tool-picker-show onClick={onRow(() => onShow(row))} className={LINK}>
                        Show
                    </button>
                </>
            ) : state === "failed" ? (
                <>
                    <button type="button" data-tool-picker-show onClick={onRow(() => onShow(row))} className={LINK}>
                        Open output
                    </button>
                    <button type="button" data-tool-picker-retry onClick={onRow(() => onRetry(row))} className={BTN}>
                        Try again
                    </button>
                </>
            ) : state === "not-installed" ? (
                <>
                    {install ? <Cmd>{install}</Cmd> : null}
                    {install ? (
                        <button
                            type="button"
                            data-tool-picker-install
                            onClick={onRow(() => onInstall(row))}
                            className={BTN}
                        >
                            Install
                        </button>
                    ) : null}
                </>
            ) : state === "not-on-path" ? (
                <button type="button" data-tool-picker-edit onClick={onRow(() => onEdit(row))} className={LINK}>
                    Edit
                </button>
            ) : (
                <>
                    {opensIn ? <span className="flex-none text-[11px] text-muted">{opensIn}</span> : null}
                    <Cmd selected={selected}>{toolCommandLine(tool)}</Cmd>
                    {selected ? <span className={cn(KEY_CAP, "border-edge-strong text-secondary")}>↵</span> : null}
                </>
            )}
        </div>
    );
}

export function ToolPicker({ model }: { model: AgentsViewModel }) {
    const picker = useAtomValue(toolPickerAtom);
    const open = picker.open;
    const statuses = useAtomValue(toolsStatusAtom);
    const error = useAtomValue(toolsErrorAtom);
    const pinned = useAtomValue(pinnedToolsAtom);
    const installing = useAtomValue(installingAtom);
    const failed = useAtomValue(failedAtom);
    const registered = useAtomValue(projectsAtom);
    const archive = useAtomValue(sessionsArchiveAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const [query, setQuery] = useState("");
    const [sel, setSel] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // each open starts clean, with the keyboard in the search box
    useEffect(() => {
        if (!open) {
            return;
        }
        setQuery("");
        setSel(0);
        setNotice(null);
        const raf = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(raf);
    }, [open]);

    // where the tool would open: the project's root from a folder's tool button, else the focused agent or terminal
    const focus = useMemo((): PickerFocus | undefined => {
        if (!open) {
            return undefined;
        }
        const ctx = toolContext(model, picker.project);
        if (picker.project) {
            return { project: ctx.project };
        }
        const agent = agents.find((a) => a.id === focusId);
        return {
            project: ctx.project,
            cwd: ctx.agentCwd,
            name: agent?.name,
            branch: agent ? notableBranch(liveBranches(archive, agents).get(agent.id)) : undefined,
        };
    }, [open, picker.project, model, agents, archive, focusId, terminals]);
    const roots = useMemo(() => {
        const out = new Map<string, string>();
        for (const [name, project] of Object.entries(registered ?? {})) {
            if (project?.path) {
                out.set(name, project.path);
            }
        }
        return out;
    }, [registered]);
    const context = pickerContext(focus, roots);

    const groups = useMemo(
        () => (statuses == null ? [] : pickerGroups(statuses, pinned, installing, failed, query)),
        [statuses, pinned, installing, failed, query]
    );
    const rows = useMemo(() => flatRows(groups), [groups]);
    const current = selectedRow(rows, sel);
    const selIndex = current ? rows.indexOf(current) : 0;
    const hints = footerHints(current);

    // the selection follows the arrows past the rows in view
    useEffect(() => {
        if (selIndex === 0) {
            listRef.current?.scrollTo({ top: 0 });
            return;
        }
        listRef.current?.querySelector(`[data-idx="${selIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }, [selIndex, rows.length]);

    const openRow = async (row: PickerRow, place: "centre" | "panel") => {
        const why = openRefusal(row, PLATFORM);
        if (why != null) {
            setNotice(why);
            return;
        }
        try {
            const r = await openTool(model, row.tool, { project: picker.project, place });
            const reason = refusal(r);
            if (reason != null) {
                setNotice(reason);
                return;
            }
            closeToolPicker();
        } catch (e) {
            setNotice(errText(e));
        }
    };

    // an install starts in a terminal of its own and the picker stays, so the row can be seen turning into Installing
    const installRow = async (row: PickerRow, retry: boolean) => {
        setNotice(null);
        watchInstallEnds();
        try {
            const r = retry ? await retryInstall(model, row.tool) : await installTool(model, row.tool);
            const reason = refusal(r);
            if (reason != null) {
                setNotice(reason);
            }
        } catch (e) {
            setNotice(errText(e));
        }
    };

    const showRow = (row: PickerRow) => {
        if (showInstall(model, row.tool.id)) {
            closeToolPicker();
        } else {
            setNotice(`${row.tool.name} has no install terminal open`);
        }
    };

    const editRow = (row: PickerRow | undefined) => {
        closeToolPicker();
        openSetupTool(model, row?.tool.id ?? "");
    };

    const act = (a: PickerAction) => {
        switch (a.kind) {
            case "move":
                setSel(a.sel);
                setNotice(null);
                break;
            case "open":
                if (current != null) {
                    void openRow(current, a.place);
                }
                break;
            case "install":
                if (current != null) {
                    void installRow(current, false);
                }
                break;
            case "close":
                closeToolPicker();
                break;
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const a = pickerKey({ sel: selIndex, rows }, e);
        if (a != null) {
            e.preventDefault();
            act(a);
        }
    };

    let index = 0;
    return (
        <ModalShell
            open={open}
            onClose={closeToolPicker}
            className="flex h-[min(640px,80vh)] w-[min(820px,93vw)] flex-col"
        >
            {open ? (
                <div data-tool-picker className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-2.5 px-4 pb-[9px] pt-[13px]">
                        <Search size={15} strokeWidth={2} aria-hidden className="shrink-0 text-muted" />
                        <span className="shrink-0 rounded-[5px] bg-accentbg px-[7px] py-px text-[12px] font-medium text-accent-soft">
                            Open a tool
                        </span>
                        <input
                            ref={inputRef}
                            data-tool-picker-input
                            aria-label="Find a tool"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setSel(0);
                                setNotice(null);
                            }}
                            onKeyDown={onKeyDown}
                            placeholder="Find a tool"
                            autoComplete="off"
                            spellCheck={false}
                            className="min-w-0 flex-1 bg-transparent text-[14px] text-primary outline-none placeholder:text-muted"
                        />
                        <span className={cn("shrink-0 text-muted", KEY_CAP)}>Esc</span>
                    </div>
                    <div
                        data-tool-picker-context
                        className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 pb-2.5 text-[12px] text-muted"
                    >
                        <span className="shrink-0">{context.text}</span>
                        {context.branch ? (
                            <span className="flex min-w-0 shrink-0 items-center gap-[3px] text-secondary">
                                <GitBranch size={11} strokeWidth={2.2} aria-hidden />
                                <span className="truncate">{context.branch}</span>
                            </span>
                        ) : null}
                        {context.path ? <span className="min-w-0 truncate">· {context.path}</span> : null}
                    </div>
                    {notice != null ? (
                        <div
                            role="alert"
                            data-tool-picker-notice
                            className="shrink-0 border-b border-error/30 bg-error/10 px-4 py-2 text-[12px] text-error-soft"
                        >
                            {notice}
                        </div>
                    ) : null}
                    <div
                        ref={listRef}
                        role="listbox"
                        aria-label="Tools"
                        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 pt-1"
                    >
                        {statuses == null ? (
                            <div className="px-4 py-8 text-center text-[13px] text-muted">
                                {error ? (
                                    <>
                                        Could not read the tools: {error}{" "}
                                        <button type="button" className={LINK} onClick={() => void loadTools()}>
                                            Try again
                                        </button>
                                    </>
                                ) : (
                                    "Reading the tools…"
                                )}
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="px-4 py-8 text-center text-[13px] text-muted">
                                {query.trim() === "" ? "No tools yet." : `Nothing matches “${query.trim()}”.`}
                            </div>
                        ) : (
                            groups.map((g) => (
                                <div key={g.key} role="group" aria-label={g.label}>
                                    <div
                                        className={cn(
                                            "px-2.5 pb-1 text-[10.5px] text-muted",
                                            g === groups[0] ? "pt-2" : "pt-3"
                                        )}
                                    >
                                        {g.label}
                                    </div>
                                    {g.rows.map((row) => {
                                        const i = index++;
                                        return (
                                            <ToolRow
                                                key={row.tool.id}
                                                row={row}
                                                index={i}
                                                selected={i === selIndex}
                                                onHover={setSel}
                                                onOpen={(r) => void openRow(r, "centre")}
                                                onInstall={(r) => void installRow(r, false)}
                                                onShow={showRow}
                                                onRetry={(r) => void installRow(r, true)}
                                                onEdit={editRow}
                                            />
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3.5 border-t border-border px-4 py-[9px] text-[12px] text-muted">
                        {hints.open ? (
                            <span className="flex items-center gap-1.5">
                                <span className={KEY_CAP}>↵</span>
                                {hints.open}
                            </span>
                        ) : null}
                        {hints.panel ? (
                            <span className="flex items-center gap-1.5">
                                <span className={KEY_CAP}>Shift ↵</span>
                                {hints.panel}
                            </span>
                        ) : null}
                        {hints.install ? (
                            <span className="flex items-center gap-1.5">
                                <span className={KEY_CAP}>Ctrl I</span>
                                Install
                            </span>
                        ) : null}
                        <span className="flex-1" />
                        <button
                            type="button"
                            data-tool-picker-settings
                            className={LINK}
                            onClick={() => editRow(current)}
                        >
                            Edit tools in settings
                        </button>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}
