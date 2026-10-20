// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Tools: the library of terminal tools (lazygit, yazi, btop…). The list is on the left, by category with each
// tool's status; the selected tool's detail is on the right, or the form that adds or edits a tool of the user's own.
// The pure parts (grouping, status words, the install panel, what a form writes) are toolslibrarymodel.ts; the status
// and the open / install actions are toolsstore.ts.

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { PLATFORM } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    Activity,
    BookOpen,
    Container,
    Folder,
    GitBranch,
    Plus,
    Search,
    Terminal,
    Wrench,
    X,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useReducer, useState, type ReactNode } from "react";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { appUrlFor, folderName, type ScriptSuggestion } from "./appsuggest";
import { suggestForFolder } from "./appsuggeststore";
import { railPinsAtom, setRailPinned } from "./railappsstore";
import type { ServiceTone } from "./servicesmodel";
import { ensureServicesFeed, restartService, servicesAtom, setServiceAutostart, stopService } from "./servicesstore";
import { Toggle } from "./settingsui";
import { installEndedAtom, selectedToolAtom, toolFormAtom, toolsSearchAtom, watchInstallEnds } from "./setupstore";
import { StateDot as ServiceStateDot } from "./terminalpaneheadview";
import {
    commandCheck,
    emptyForm,
    formFromTool,
    formKeywords,
    foundLine,
    foundRows,
    headerSummary,
    initialChoice,
    installPanel,
    libraryRows,
    needsRestartHint,
    OPENS_IN_OPTIONS,
    overrideKeywords,
    reduceChoice,
    selectedTool,
    SHOWS_OPTIONS,
    stateTone,
    statusLabel,
    toolRailPin,
    toolServiceStatus,
    uniqueToolId,
    validateNewTool,
    type LibraryGroup,
    type LibraryRow,
    type StateTone,
    type ToolForm,
} from "./toolslibrarymodel";
import { toolCommandLine, toolIcon, type ToolIconName } from "./toolsmodel";
import {
    addSuggestion,
    addUserTool,
    failedAtom,
    hiddenToolsAtom,
    hideSuggestion,
    installingAtom,
    installTool,
    loadTools,
    openTool,
    pinnedToolsAtom,
    removeUserTool,
    retryInstall,
    setToolPinned,
    showInstall,
    toolsErrorAtom,
    toolsStatusAtom,
    toolSuggestionsAtom,
    type InstallResult,
    type OpenToolResult,
} from "./toolsstore";

const SECTION_HEAD = cn(REGION_LABEL, "text-muted");
const BTN_SECONDARY =
    "h-[30px] cursor-pointer whitespace-nowrap rounded border border-edge-mid bg-surface-raised px-3 text-[12.5px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";
const BTN_PRIMARY =
    "h-[30px] cursor-pointer whitespace-nowrap rounded border-0 bg-accent px-[14px] text-[12.5px] font-bold text-background shadow-inset-highlight hover:bg-accenthover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent";
const INPUT =
    "h-[30px] min-w-0 flex-1 rounded-[7px] border border-edge-mid bg-background px-2.5 text-[13px] text-primary outline-none placeholder:text-muted focus:border-accent";
const INPUT_MONO = cn(INPUT, "bg-surface-code font-mono text-[12px]");

const TONE_DOT: Record<StateTone, string | null> = { ok: "bg-success", busy: "bg-working", error: null, none: null };
const TONE_TEXT: Record<StateTone, string> = {
    ok: "text-ink-mid",
    busy: "text-secondary",
    error: "text-error-soft",
    none: "text-muted",
};

// the words of a service's state, in the tone the Agent tree draws them in
const SERVICE_TEXT: Record<ServiceTone, string> = {
    working: "text-working",
    error: "text-error",
    warning: "text-warning",
    muted: "text-muted",
};

const ICONS: Record<ToolIconName, LucideIcon> = {
    "git-branch": GitBranch,
    folder: Folder,
    activity: Activity,
    container: Container,
    "book-open": BookOpen,
    wrench: Wrench,
    terminal: Terminal,
};

export function ToolIcon({ name, size = 16 }: { name: ToolIconName; size?: number }) {
    const Icon = ICONS[name];
    return <Icon size={size} strokeWidth={1.8} aria-hidden />;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// why an open or an install was refused, null when it went ahead; `in` narrows where the result's `ok` flag does not (the
// project is not strictNullChecks)
function refusal(r: OpenToolResult | InstallResult): string | null {
    return "reason" in r ? r.reason : null;
}

function StateDot({ tone }: { tone: StateTone }) {
    const dot = TONE_DOT[tone];
    return dot ? <span className={cn("h-1.5 w-1.5 flex-none rounded-full", dot)} /> : null;
}

// ---- header ----

export function ToolsHeader() {
    const statuses = useAtomValue(toolsStatusAtom);
    const found = foundRows(useAtomValue(toolSuggestionsAtom), useAtomValue(hiddenToolsAtom)).length;
    if (statuses == null) {
        return null;
    }
    return <span className="text-[12px] text-ink-mid">{headerSummary(statuses, PLATFORM, found)}</span>;
}

// ---- left list ----

function ToolList({
    groups,
    found,
    selected,
}: {
    groups: LibraryGroup[];
    found: ToolStatus[];
    selected: string | null;
}) {
    const query = useAtomValue(toolsSearchAtom);
    return (
        <aside aria-label="Tools" className="flex w-[300px] flex-none flex-col border-r border-border bg-surface">
            <div className="px-2.5 pb-1.5 pt-3">
                <label className="flex h-7 items-center gap-2 rounded-[7px] border border-edge-mid bg-background px-[9px] text-muted focus-within:ring-2 focus-within:ring-accent/25">
                    <Search size={13} strokeWidth={2} />
                    <input
                        data-tools-search
                        aria-label="Find a tool"
                        placeholder="Find a tool"
                        value={query}
                        onChange={(e) => globalStore.set(toolsSearchAtom, e.target.value)}
                        className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-muted"
                    />
                </label>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5">
                {groups.length === 0 && found.length === 0 ? (
                    <div className="px-2 py-3 text-[12.5px] text-muted">No tool matches.</div>
                ) : null}
                {found.length > 0 ? (
                    <div
                        role="group"
                        aria-label="Found on this machine"
                        data-tools-found
                        className="flex flex-col gap-px"
                    >
                        <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold text-ink-mid">
                            Found on this machine
                        </div>
                        {found.map((t) => (
                            <FoundRow key={t.id} tool={t} selected={t.id === selected} />
                        ))}
                    </div>
                ) : null}
                {groups.map((g) => (
                    <div key={g.category} role="group" aria-label={g.category} className="flex flex-col gap-px">
                        <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold text-ink-mid">{g.category}</div>
                        {g.rows.map((r) => (
                            <ToolRow key={r.tool.id} row={r} selected={r.tool.id === selected} />
                        ))}
                    </div>
                ))}
            </div>
            <div className="flex-none border-t border-border p-2.5">
                <button
                    type="button"
                    data-tool-add
                    onClick={() => globalStore.set(toolFormAtom, emptyForm())}
                    className={cn(BTN_SECONDARY, "flex w-full items-center justify-center gap-1.5")}
                >
                    <Plus size={13} strokeWidth={2} />
                    Add your own tool
                </button>
            </div>
        </aside>
    );
}

function ToolRow({ row, selected }: { row: LibraryRow; selected: boolean }) {
    const tone = stateTone(row.state);
    return (
        <button
            type="button"
            data-tools-row={row.tool.id}
            aria-current={selected ? "true" : undefined}
            onClick={() => {
                globalStore.set(toolFormAtom, null);
                globalStore.set(selectedToolAtom, row.tool.id);
            }}
            className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2 py-[7px] text-left outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset",
                selected ? "bg-surface-selected text-primary" : "bg-transparent text-secondary hover:bg-surface-hover"
            )}
        >
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", selected && "font-medium")}>
                {row.tool.name}
            </span>
            <StateDot tone={tone} />
            <span data-tools-status className={cn("flex-none text-[11px]", TONE_TEXT[tone])}>
                {row.word}
            </span>
        </button>
    );
}

// A suggestion: the name selects it (its detail shows the command and where it was found), Add puts it in the library,
// the cross hides it from this list.
function FoundRow({ tool, selected }: { tool: ToolStatus; selected: boolean }) {
    return (
        <div
            data-tools-row={tool.id}
            className={cn(
                "flex items-center gap-1 rounded-sm pr-1",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                    globalStore.set(toolFormAtom, null);
                    globalStore.set(selectedToolAtom, tool.id);
                }}
                className={cn(
                    "min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent px-2 py-[7px] text-left text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset",
                    selected ? "font-medium text-primary" : "text-secondary"
                )}
            >
                {tool.name}
            </button>
            <button
                type="button"
                data-tool-suggest-add
                onClick={() => fireAndForget(() => addSuggestion(tool))}
                className="flex-none cursor-pointer rounded-[4px] border-0 bg-transparent px-1.5 py-0.5 text-[11.5px] font-semibold text-accent-soft hover:bg-surface-raised hover:text-accent"
            >
                Add
            </button>
            <button
                type="button"
                data-tool-suggest-hide
                aria-label={`Hide ${tool.name}`}
                title="Hide"
                onClick={() => hideSuggestion(tool.id)}
                className="flex flex-none cursor-pointer items-center rounded-[4px] border-0 bg-transparent p-1 text-muted hover:bg-surface-raised hover:text-primary"
            >
                <X size={12} strokeWidth={2} />
            </button>
        </div>
    );
}

// ---- detail ----

function SettingRow({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
            <div className="flex w-[180px] flex-none flex-col gap-0.5">
                <span className="text-[13px] text-primary">{label}</span>
                <span className="text-[11.5px] text-muted">{sub}</span>
            </div>
            {children}
        </div>
    );
}

function Options({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: { id: string; label: string }[];
    value: string;
    onChange: (id: string) => void;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className="flex gap-0.5 rounded-sm border border-edge-mid bg-background p-0.5"
        >
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={value === o.id}
                    onClick={() => onChange(o.id)}
                    className={cn(
                        "cursor-pointer whitespace-nowrap rounded-[4px] border-0 px-2.5 py-1 text-[12.5px] transition-colors",
                        value === o.id
                            ? "bg-surface-selected font-semibold text-primary"
                            : "bg-transparent text-muted hover:text-primary"
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function showTerminalTab(model: AgentsViewModel, tabId: string): void {
    globalStore.set(model.focusIdAtom, tabId);
    globalStore.set(model.surfaceAtom, "agent");
    showTerminal();
}

// A suggestion's detail: what it is and what arcterm would run, before the user adds it.
function SuggestionDetail({ tool }: { tool: ToolStatus }) {
    const [notice, setNotice] = useState<string | null>(null);
    const add = async () => {
        setNotice(null);
        try {
            await addSuggestion(tool);
        } catch (e) {
            setNotice(errText(e));
        }
    };
    return (
        <div data-tools-detail={tool.id} className="flex min-w-0 flex-1 flex-col gap-[22px] overflow-y-auto px-8 py-6">
            <div className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[9px] bg-surface-raised text-ink-mid">
                    <ToolIcon name={toolIcon(tool)} size={20} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2.5">
                        <span className="truncate text-[18px] font-semibold text-primary">{tool.name}</span>
                        <span className="flex-none text-[12px] text-muted">Found on this machine</span>
                    </div>
                    <div className="text-[13px] leading-[19px] text-secondary">{tool.purpose}</div>
                    <div className="text-[12.5px] text-muted">
                        arcterm recognises {tool.name} but does not ship it. Add it to open it from Open a tool.
                    </div>
                </div>
                <button
                    type="button"
                    data-tool-suggest-hide
                    onClick={() => hideSuggestion(tool.id)}
                    className={BTN_SECONDARY}
                >
                    Hide
                </button>
                <button type="button" data-tool-suggest-add onClick={() => fireAndForget(add)} className={BTN_PRIMARY}>
                    Add to the library
                </button>
            </div>
            {notice ? (
                <div
                    role="alert"
                    className="rounded border border-error/30 bg-error/10 px-3 py-2 text-[12.5px] text-error-soft"
                >
                    {notice}
                </div>
            ) : null}
            <div className="flex flex-col rounded border border-edge-mid bg-surface">
                <SettingRow label="Command" sub="What arcterm would run">
                    <span className="min-w-0 flex-1 truncate rounded-[7px] border border-edge-mid bg-surface-code px-2.5 py-1.5 font-mono text-[12px] text-secondary">
                        {toolCommandLine(tool)}
                    </span>
                    <span title={tool.path} className="max-w-[45%] truncate text-[11.5px] text-muted">
                        {foundLine(tool)}
                    </span>
                </SettingRow>
            </div>
        </div>
    );
}

// The Status row of a tool with a page: what its service is doing in words, and Stop / Restart where its state allows
// them. A sleeping one has no button: Open in the header shows it, and showing it starts it. wavesrv's
// `services:changed` brings the result of a click; nothing here writes the row.
function ServiceStatusRow({
    model,
    toolId,
    onStop,
    onRestart,
}: {
    model: AgentsViewModel;
    toolId: string;
    onStop: () => void;
    onRestart: () => void;
}) {
    const service = useAtomValue(servicesAtom)?.find((s) => s.id === toolId);
    const now = useAtomValue(model.nowAtom);
    const status = toolServiceStatus(service, now);
    return (
        <SettingRow label="Status" sub="Whether the app runs now">
            <span className="flex min-w-0 flex-1 items-center gap-2">
                <ServiceStateDot tone={status.tone} dot={status.dot} />
                <span
                    data-tool-service-status
                    className={cn("min-w-0 truncate text-[12.5px] tabular-nums", SERVICE_TEXT[status.tone])}
                >
                    {status.words}
                </span>
            </span>
            {status.canStop ? (
                <button type="button" data-tool-service-stop onClick={onStop} className={BTN_SECONDARY}>
                    Stop
                </button>
            ) : null}
            {status.canRestart ? (
                <button type="button" data-tool-service-restart onClick={onRestart} className={BTN_SECONDARY}>
                    Restart
                </button>
            ) : null}
        </SettingRow>
    );
}

// A choice the detail makes (a switch, an option): the stored value comes back after the write, from wavesrv's reload of
// tools.json, and a value read before the pick can land after it. So the pick reads as made from the click until the
// stored value is it (reduceChoice), and `choose` runs the write, then settles the pick. A write that fails gives the
// pick up and says why in the notice.
function useHeldChoice<T>(stored: T, setNotice: (notice: string | null) => void) {
    const [state, dispatch] = useReducer(reduceChoice<T>, stored, initialChoice<T>);
    useEffect(() => dispatch({ type: "stored", value: stored }), [stored]);
    const choose = async (value: T, write: () => Promise<unknown>) => {
        setNotice(null);
        dispatch({ type: "click", value });
        try {
            await write();
            dispatch({ type: "settled", ok: true });
        } catch (e) {
            dispatch({ type: "settled", ok: false });
            setNotice(errText(e));
        }
    };
    return [state.shown, choose] as const;
}

function ToolDetail({ model, row }: { model: AgentsViewModel; row: LibraryRow }) {
    const { tool, state } = row;
    const isYours = tool.category === "Yours";
    const tone = stateTone(state);
    const terminals = useAtomValue(model.terminalsAtom).filter((t) => t.toolId === tool.id);
    const pinned = useAtomValue(pinnedToolsAtom).includes(tool.id);
    const ended = useAtomValue(installEndedAtom);
    const [notice, setNotice] = useState<string | null>(null);
    const [opensin, chooseOpensin] = useHeldChoice(tool.opensin, setNotice);
    const [shows, chooseShows] = useHeldChoice(tool.shows, setNotice);
    const hasPage = Boolean(tool.url || tool.port);
    // Keep running is read from the tool's tools.json entry in the config, which wavesrv sends as soon as the file is
    // reloaded; the status of the same change takes another read, and one begun before a click can land after it
    const configured = useAtomValue(atoms.fullConfigAtom)?.tools?.[tool.id];
    const [autostart, chooseAutostart] = useHeldChoice(
        configured != null ? configured.autostart === true : (tool.autostart ?? false),
        setNotice
    );
    // the services the Status row and the rail toggle read; the feed is idempotent, as in AgentTree
    useEffect(() => ensureServicesFeed(), []);
    const pinIds = useAtomValue(railPinsAtom);
    const services = useAtomValue(servicesAtom);
    const rail = toolRailPin(tool.id, pinIds, services);

    const guard = async (fn: () => Promise<string | null>) => {
        setNotice(null);
        try {
            setNotice(await fn());
        } catch (e) {
            setNotice(errText(e));
        }
    };
    const open = () =>
        guard(async () => {
            return refusal(await openTool(model, tool, { place: shows === "panel" ? "panel" : "centre" }));
        });
    const install = () =>
        guard(async () => {
            watchInstallEnds();
            return refusal(await installTool(model, tool));
        });
    const retry = () =>
        guard(async () => {
            watchInstallEnds();
            return refusal(await retryInstall(model, tool));
        });
    const openOutput = () =>
        guard(async () => (showInstall(model, tool.id) ? null : "There is no install terminal to show."));
    const change = (patch: { opensin?: string; shows?: string }) => {
        const current = globalStore.get(atoms.fullConfigAtom)?.tools?.[tool.id];
        return addUserTool(tool.id, overrideKeywords(tool, current, patch));
    };
    const toggleAutostart = () => {
        const next = !autostart;
        return chooseAutostart(next, () => setServiceAutostart(tool.id, next));
    };
    const stop = () =>
        guard(async () => {
            await stopService(tool.id);
            return null;
        });
    const restart = () =>
        guard(async () => {
            await restartService(tool.id);
            return null;
        });
    const reset = () =>
        guard(async () => {
            await removeUserTool(tool.id);
            return null;
        });

    const panel = installPanel(tool, state, PLATFORM);
    const hasInstall = panel.line != null || panel.note != null || panel.buttons.length > 0;
    return (
        <div data-tools-detail={tool.id} className="flex min-w-0 flex-1 flex-col gap-[22px] overflow-y-auto px-8 py-6">
            <div className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[9px] bg-surface-raised text-ink-mid">
                    <ToolIcon name={toolIcon(tool)} size={20} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2.5">
                        <span className="truncate text-[18px] font-semibold text-primary">{tool.name}</span>
                        <span className={cn("flex flex-none items-center gap-[5px] text-[12px]", TONE_TEXT[tone])}>
                            <StateDot tone={tone} />
                            {statusLabel(state)}
                        </span>
                    </div>
                    {tool.purpose ? (
                        <div className="text-[13px] leading-[19px] text-secondary">{tool.purpose}</div>
                    ) : null}
                    {!tool.found && isYours ? (
                        <div className="text-[12.5px] text-muted">
                            It will not open until its command is on PATH. Edit the command, or add an install command.
                        </div>
                    ) : null}
                </div>
                {isYours ? (
                    <button
                        type="button"
                        data-tool-edit
                        onClick={() => globalStore.set(toolFormAtom, formFromTool(tool, PLATFORM))}
                        className={BTN_SECONDARY}
                    >
                        Edit
                    </button>
                ) : null}
                {tool.found ? (
                    <button type="button" data-tool-open onClick={() => fireAndForget(open)} className={BTN_PRIMARY}>
                        Open {tool.name}
                    </button>
                ) : null}
            </div>

            {notice ? (
                <div
                    role="alert"
                    className="rounded border border-error/30 bg-error/10 px-3 py-2 text-[12.5px] text-error-soft"
                >
                    {notice}
                </div>
            ) : null}
            {needsRestartHint(tool, state, ended) ? (
                <div
                    role="status"
                    className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning-soft"
                >
                    arcterm has not found {tool.name} on PATH yet. If the install finished, restart arcterm: it reads
                    PATH once, when it starts.
                </div>
            ) : null}

            <div className="flex flex-col rounded border border-edge-mid bg-surface">
                {/* a folder of its own (a pinned app's) is where it runs: there is no choice left to make */}
                {tool.dir ? null : (
                    <SettingRow label="Opens in" sub="Its working folder">
                        <Options
                            label="Opens in"
                            options={OPENS_IN_OPTIONS}
                            value={opensin}
                            onChange={(id) => fireAndForget(() => chooseOpensin(id, () => change({ opensin: id })))}
                        />
                        <span className="text-[11.5px] text-muted">A worktree agent gives its worktree.</span>
                    </SettingRow>
                )}
                {/* a pinned app's page always takes the centre */}
                {hasPage ? null : (
                    <SettingRow label="Shows" sub="Where it appears on screen">
                        <Options
                            label="Shows"
                            options={SHOWS_OPTIONS}
                            value={shows}
                            onChange={(id) => fireAndForget(() => chooseShows(id, () => change({ shows: id })))}
                        />
                    </SettingRow>
                )}
                <SettingRow label="In Open a tool" sub="Listed at the top when on">
                    <Toggle
                        on={pinned}
                        onToggle={() => setToolPinned(tool.id, !pinned)}
                        label={`Pin ${tool.name} in Open a tool`}
                    />
                </SettingRow>
                {hasPage ? (
                    <SettingRow label="Page" sub="Shown once the command serves it">
                        <span
                            data-tool-page
                            className={cn(
                                "min-w-0 flex-1 truncate rounded-[7px] border border-edge-mid bg-surface-code px-2.5 py-1.5 text-[12px] text-secondary",
                                tool.url ? "font-mono" : "font-sans"
                            )}
                        >
                            {tool.url || "A free port, picked by arcterm"}
                        </span>
                        {tool.dir ? (
                            <span title={tool.dir} className="max-w-[45%] truncate text-[11.5px] text-muted">
                                in {tool.dir}
                            </span>
                        ) : null}
                    </SettingRow>
                ) : null}
                {hasPage ? (
                    <ServiceStatusRow
                        model={model}
                        toolId={tool.id}
                        onStop={() => fireAndForget(stop)}
                        onRestart={() => fireAndForget(restart)}
                    />
                ) : null}
                {hasPage ? (
                    <SettingRow
                        label="Keep running"
                        sub="Run it even when its page is not on screen, and start it with arcterm"
                    >
                        <Toggle
                            on={autostart}
                            onToggle={() => fireAndForget(toggleAutostart)}
                            label={`Keep ${tool.name} running`}
                        />
                    </SettingRow>
                ) : null}
                {hasPage ? (
                    <SettingRow label="On the rail" sub="Up to three apps, under Radar">
                        <Toggle
                            data-tool-rail-pin
                            on={rail.on}
                            onToggle={() => setRailPinned(tool.id, !rail.on)}
                            disabled={rail.disabled}
                            title={rail.title}
                            label={`Show ${tool.name} on the rail`}
                        />
                    </SettingRow>
                ) : null}
                <SettingRow label="Command" sub="What arcterm runs">
                    <span className="min-w-0 flex-1 truncate rounded-[7px] border border-edge-mid bg-surface-code px-2.5 py-1.5 font-mono text-[12px] text-secondary">
                        {toolCommandLine(tool)}
                    </span>
                    <span
                        title={tool.path}
                        className={cn(
                            "max-w-[45%] truncate text-[11.5px]",
                            tool.found ? "text-muted" : "text-error-soft"
                        )}
                    >
                        {foundLine(tool)}
                    </span>
                </SettingRow>
            </div>
            {!isYours && tool.user ? (
                <div className="-mt-3.5 flex items-center gap-2 text-[11.5px] text-muted">
                    {tool.detected ? "Added from Found on this machine." : "Changed from the built-in."}
                    <button
                        type="button"
                        data-tool-reset
                        onClick={() => fireAndForget(reset)}
                        className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-accent-soft hover:text-accent"
                    >
                        {tool.detected ? "Remove from the library" : "Reset to default"}
                    </button>
                </div>
            ) : null}

            {hasInstall ? (
                <div className="flex flex-col gap-2">
                    <div className={SECTION_HEAD}>Install</div>
                    <div className="flex items-center gap-3 rounded border border-edge-mid bg-surface px-4 py-3">
                        <span
                            title={panel.line}
                            className={cn(
                                "min-w-0 flex-1 truncate text-[12px]",
                                panel.line ? "font-mono text-secondary" : "text-muted"
                            )}
                        >
                            {panel.line ?? "No install command for this system"}
                        </span>
                        {panel.note ? <span className="flex-none text-[11.5px] text-muted">{panel.note}</span> : null}
                        {panel.buttons.map((b) =>
                            b === "install" || b === "update" ? (
                                <button
                                    key={b}
                                    type="button"
                                    data-tool-install
                                    onClick={() => fireAndForget(install)}
                                    className={BTN_SECONDARY}
                                >
                                    {b === "install" ? "Install" : "Update"}
                                </button>
                            ) : b === "open-output" ? (
                                <button
                                    key={b}
                                    type="button"
                                    data-tool-open-output
                                    onClick={() => fireAndForget(openOutput)}
                                    className={BTN_SECONDARY}
                                >
                                    Open output
                                </button>
                            ) : (
                                <button
                                    key={b}
                                    type="button"
                                    data-tool-retry
                                    onClick={() => fireAndForget(retry)}
                                    className={BTN_SECONDARY}
                                >
                                    Try again
                                </button>
                            )
                        )}
                    </div>
                    {state === "failed" ? (
                        <div className="text-[12px] text-error-soft">
                            The install did not finish. Its output is in the Install {tool.name} terminal.
                        </div>
                    ) : null}
                </div>
            ) : null}

            {terminals.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <div className={SECTION_HEAD}>Open now</div>
                    <div className="flex flex-col rounded border border-edge-mid bg-surface">
                        {terminals.map((t) => (
                            <div
                                key={t.id}
                                data-tool-open-now={t.id}
                                className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0"
                            >
                                <Terminal size={13} strokeWidth={2} className="flex-none text-muted" aria-hidden />
                                <span className="min-w-0 truncate text-[13px] text-secondary" title={t.cwd}>
                                    {t.project || "Home"}
                                </span>
                                <span className="flex-1" />
                                <button
                                    type="button"
                                    data-tool-show
                                    onClick={() => showTerminalTab(model, t.id)}
                                    className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-accent-soft hover:text-accent"
                                >
                                    Show
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

// ---- add and edit ----

function FormRow({ children }: { children: ReactNode }) {
    return <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3.5 last:border-b-0">{children}</div>;
}

const SUGGEST_DEBOUNCE_MS = 400;

const SUGGEST_CHIP =
    "flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-2.5 py-1 font-mono text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// The folder's scripts under its field: the servers as chips with their port, the rest folded under Other scripts.
// Nothing for a folder with no package.json, which is any folder that is not a Node project.
function FolderSuggestions({
    dir,
    loading,
    found,
    command,
    onPick,
}: {
    dir: string;
    loading: boolean;
    found: ScriptSuggestion[];
    command: string;
    onPick: (s: ScriptSuggestion) => void;
}) {
    const [others, setOthers] = useState(false);
    if (dir.trim() === "") {
        return (
            <div className="pl-[176px] text-[11.5px] text-muted">
                Optional. Where the command runs, in place of Opens in.
            </div>
        );
    }
    if (loading && found.length === 0) {
        return <div className="pl-[176px] text-[11.5px] text-muted">Reading the folder…</div>;
    }
    if (found.length === 0) {
        return (
            <div className="pl-[176px] text-[11.5px] text-muted">No package.json here, so no scripts to suggest.</div>
        );
    }
    const servers = found.filter((s) => s.server);
    const rest = found.filter((s) => !s.server);
    const chip = (s: ScriptSuggestion) => {
        const on = command.trim() === s.command;
        return (
            <button
                key={s.script}
                type="button"
                data-tool-suggest={s.script}
                aria-pressed={on}
                title={
                    s.port == null
                        ? s.command
                        : s.port.sure
                          ? `${s.command}, on port ${s.port.port}`
                          : `${s.command}, on port ${s.port.port}: a guess, its tool's default`
                }
                onClick={() => onPick(s)}
                className={cn(
                    SUGGEST_CHIP,
                    on
                        ? "border-accent bg-accentbg text-accent"
                        : "border-edge-mid bg-surface-raised text-secondary hover:border-edge-strong hover:text-primary"
                )}
            >
                {s.command}
                {s.port != null ? (
                    <span className="font-sans text-[11px] text-muted">
                        · {s.port.port}
                        {s.port.sure ? "" : "?"}
                    </span>
                ) : null}
            </button>
        );
    };
    return (
        <div data-tool-suggestions className="flex flex-col gap-1.5 pl-[176px]">
            <div className="text-[11.5px] text-muted">
                {servers.length > 0
                    ? "Runs a server: pick one to fill the command and the page."
                    : "No script here looks like a server. Pick one to fill the command."}
            </div>
            <div className="flex flex-wrap gap-1.5">{(servers.length > 0 ? servers : rest).map(chip)}</div>
            {servers.length > 0 && rest.length > 0 ? (
                <>
                    <button
                        type="button"
                        data-tool-suggest-others
                        aria-expanded={others}
                        onClick={() => setOthers(!others)}
                        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-accent-soft hover:text-accent"
                    >
                        {others ? "Hide other scripts" : `Other scripts (${rest.length})`}
                    </button>
                    {others ? <div className="flex flex-wrap gap-1.5">{rest.map(chip)}</div> : null}
                </>
            ) : null}
        </div>
    );
}

function ToolFormPane({ form, statuses }: { form: ToolForm; statuses: ToolStatus[] }) {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const existing = form.id != null ? (statuses.find((t) => t.id === form.id) ?? null) : null;
    const check = commandCheck(form.command, existing);
    const set = (patch: Partial<ToolForm>) => globalStore.set(toolFormAtom, { ...form, ...patch });
    const close = () => globalStore.set(toolFormAtom, null);
    const projectPaths = Object.entries(useAtomValue(atoms.fullConfigAtom)?.projects ?? {})
        .filter(([, p]) => !!p?.path)
        .map(([name, p]) => ({ name, path: p.path! }));
    // the folder's scripts, read a moment after its path stops changing; a read overtaken by a newer path is dropped
    const [suggest, setSuggest] = useState<{ dir: string; loading: boolean; list: ScriptSuggestion[] }>({
        dir: "",
        loading: false,
        list: [],
    });
    useEffect(() => {
        const dir = form.dir.trim();
        if (dir === "") {
            setSuggest({ dir, loading: false, list: [] });
            return;
        }
        let live = true;
        setSuggest((cur) => ({ ...cur, dir, loading: true }));
        const timer = setTimeout(() => {
            void suggestForFolder(dir).then((list) => {
                if (live) {
                    setSuggest({ dir, loading: false, list });
                }
            });
        }, SUGGEST_DEBOUNCE_MS);
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [form.dir]);
    // A picked script fills the command and, for a server whose port was read or guessed, the page; a new app with no
    // name yet takes its folder's. What was typed into the page is kept for a script with no port.
    const pickSuggestion = (s: ScriptSuggestion) =>
        set({
            command: s.command,
            url: s.port != null ? appUrlFor(s.port.port) : form.url,
            autoPort: s.port != null ? false : form.autoPort,
            name: form.name.trim() || folderName(form.dir),
        });

    const save = async () => {
        const invalid = validateNewTool(form);
        if (invalid != null) {
            setError(invalid);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const taken = [
                ...statuses.map((t) => t.id),
                ...Object.keys(globalStore.get(atoms.fullConfigAtom)?.tools ?? {}),
            ];
            const id = form.id ?? uniqueToolId(form.name, taken);
            await addUserTool(id, formKeywords(form, PLATFORM, existing?.install ?? {}));
            globalStore.set(selectedToolAtom, id);
            close();
        } catch (e) {
            setError(errText(e));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (form.id == null) {
            return;
        }
        setBusy(true);
        try {
            await removeUserTool(form.id);
            globalStore.set(selectedToolAtom, null);
            close();
        } catch (e) {
            setError(errText(e));
        } finally {
            setBusy(false);
        }
    };

    const editing = form.id != null;
    return (
        <div data-tool-form className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
            <div className="flex flex-col gap-1">
                <div className="text-[18px] font-semibold text-primary">
                    {editing ? `Edit ${existing?.name ?? form.name}` : "Add your own tool"}
                </div>
                <div className="text-[13px] text-muted">
                    Any program that runs in a terminal. arcterm keeps it in your settings and lists it under Yours. For
                    a project's web app, pick its folder first: arcterm suggests what to run and on which port.
                </div>
            </div>
            <div className="flex flex-col rounded border border-edge-mid bg-surface">
                <FormRow>
                    <div className="flex items-center gap-4">
                        <label htmlFor="tool-dir" className="w-[160px] flex-none text-[13px] text-primary">
                            Folder
                        </label>
                        <input
                            id="tool-dir"
                            data-tool-dir
                            value={form.dir}
                            spellCheck={false}
                            placeholder="~/code/my-app"
                            list="tool-dir-projects"
                            onChange={(e) => set({ dir: e.target.value })}
                            className={INPUT_MONO}
                        />
                    </div>
                    <datalist id="tool-dir-projects">
                        {projectPaths.map((p) => (
                            <option key={p.name} value={p.path}>
                                {p.name}
                            </option>
                        ))}
                    </datalist>
                    <FolderSuggestions
                        dir={form.dir}
                        loading={suggest.loading}
                        found={suggest.list}
                        command={form.command}
                        onPick={pickSuggestion}
                    />
                </FormRow>
                <FormRow>
                    <div className="flex items-center gap-4">
                        <label htmlFor="tool-name" className="w-[160px] flex-none text-[13px] text-primary">
                            Name
                        </label>
                        <input
                            id="tool-name"
                            data-tool-name
                            value={form.name}
                            onChange={(e) => set({ name: e.target.value })}
                            className={INPUT}
                        />
                    </div>
                </FormRow>
                <FormRow>
                    <div className="flex items-center gap-4">
                        <label htmlFor="tool-command" className="w-[160px] flex-none text-[13px] text-primary">
                            Command
                        </label>
                        <input
                            id="tool-command"
                            data-tool-command
                            value={form.command}
                            spellCheck={false}
                            onChange={(e) => set({ command: e.target.value })}
                            className={INPUT_MONO}
                        />
                    </div>
                    <div className="flex items-center gap-1.5 pl-[176px] text-[11.5px] text-muted">
                        {check != null ? (
                            <>
                                <StateDot tone={check.ok ? "ok" : "error"} />
                                <span className={check.ok ? undefined : "text-error-soft"}>{check.text}</span>
                            </>
                        ) : (
                            "arcterm looks for the program on PATH when you save."
                        )}
                    </div>
                </FormRow>
                <FormRow>
                    <div className="flex items-center gap-4">
                        <label htmlFor="tool-url" className="w-[160px] flex-none text-[13px] text-primary">
                            Page
                        </label>
                        <input
                            id="tool-url"
                            data-tool-url
                            value={form.autoPort ? "" : form.url}
                            disabled={form.autoPort}
                            spellCheck={false}
                            placeholder={form.autoPort ? "arcterm picks the port" : "http://127.0.0.1:3000"}
                            onChange={(e) => set({ url: e.target.value })}
                            className={cn(INPUT_MONO, form.autoPort && "opacity-50")}
                        />
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="w-[160px] flex-none" />
                        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-secondary">
                            <input
                                type="checkbox"
                                className="m-0 h-[13px] w-[13px] cursor-pointer accent-accent"
                                data-tool-autoport
                                checked={form.autoPort}
                                onChange={(e) => set({ autoPort: e.target.checked, url: "" })}
                            />
                            Pick a free port
                        </label>
                    </div>
                    <div className="pl-[176px] text-[11.5px] text-muted">
                        Optional, for a local web app: arcterm runs the command, waits for this page and shows it in
                        place of the terminal. Only http://127.0.0.1 pages.
                        {form.autoPort ? " The command gets the port as PORT." : null}
                    </div>
                </FormRow>
                {/* a folder of its own is where it runs, and a page always takes the centre */}
                {form.dir.trim() ? null : (
                    <FormRow>
                        <div className="flex items-center gap-4">
                            <span className="w-[160px] flex-none text-[13px] text-primary">Opens in</span>
                            <Options
                                label="Opens in"
                                options={OPENS_IN_OPTIONS}
                                value={form.opensin}
                                onChange={(id) => set({ opensin: id })}
                            />
                        </div>
                    </FormRow>
                )}
                {form.url.trim() || form.autoPort ? null : (
                    <FormRow>
                        <div className="flex items-center gap-4">
                            <span className="w-[160px] flex-none text-[13px] text-primary">Shows</span>
                            <Options
                                label="Shows"
                                options={SHOWS_OPTIONS}
                                value={form.shows}
                                onChange={(id) => set({ shows: id })}
                            />
                        </div>
                    </FormRow>
                )}
                <FormRow>
                    <div className="flex items-center gap-4">
                        <label htmlFor="tool-install" className="w-[160px] flex-none text-[13px] text-primary">
                            Install command
                        </label>
                        <input
                            id="tool-install"
                            data-tool-install-command
                            value={form.install}
                            spellCheck={false}
                            onChange={(e) => set({ install: e.target.value })}
                            className={INPUT_MONO}
                        />
                    </div>
                    <div className="pl-[176px] text-[11.5px] text-muted">
                        Optional. Without it, a tool that is missing says so instead of offering Install.
                    </div>
                </FormRow>
            </div>
            {error ? (
                <div role="alert" className="text-[12.5px] text-error-soft">
                    {error}
                </div>
            ) : null}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    data-tool-add-save
                    disabled={busy}
                    onClick={() => fireAndForget(save)}
                    className={BTN_PRIMARY}
                >
                    {editing ? "Save changes" : "Add tool"}
                </button>
                <button type="button" data-tool-add-cancel disabled={busy} onClick={close} className={BTN_SECONDARY}>
                    Cancel
                </button>
                {editing ? (
                    <button
                        type="button"
                        data-tool-remove
                        disabled={busy}
                        onClick={() => fireAndForget(remove)}
                        className={BTN_SECONDARY}
                    >
                        Remove
                    </button>
                ) : null}
                <span className="flex-1" />
                <span className="text-[11.5px] text-muted">Saved to</span>
                <span className="text-[11.5px] text-ink-mid">tools.json</span>
            </div>
        </div>
    );
}

// ---- the tab ----

export function ToolsLibrary({ model }: { model: AgentsViewModel }) {
    const statuses = useAtomValue(toolsStatusAtom);
    const suggestions = useAtomValue(toolSuggestionsAtom);
    const hidden = useAtomValue(hiddenToolsAtom);
    const error = useAtomValue(toolsErrorAtom);
    const installing = useAtomValue(installingAtom);
    const failed = useAtomValue(failedAtom);
    const query = useAtomValue(toolsSearchAtom);
    const selectedId = useAtomValue(selectedToolAtom);
    const form = useAtomValue(toolFormAtom);
    // re-read on every visit: a tool may have been installed from outside arcterm
    useEffect(() => {
        watchInstallEnds();
        fireAndForget(loadTools);
    }, []);

    const banner = error ? (
        <div
            role="alert"
            className="flex-none border-b border-error/30 bg-error/10 px-5 py-2 text-[12.5px] text-error-soft"
        >
            {error}
        </div>
    ) : null;
    if (statuses == null) {
        return (
            <div data-tools-library className="flex min-w-0 flex-1 flex-col">
                {banner}
                {error ? null : (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                )}
            </div>
        );
    }
    const rows = libraryRows(statuses, installing, failed).flatMap((g) => g.rows);
    // a selected suggestion shows its own detail; once added it is in the statuses and the same id selects its row
    const suggestion = foundRows(suggestions, hidden).find((t) => t.id === selectedId) ?? null;
    const tool = suggestion ? null : selectedTool(statuses, selectedId);
    const row = rows.find((r) => r.tool.id === tool?.id) ?? null;
    return (
        <div data-tools-library className="flex min-w-0 flex-1 flex-col">
            {banner}
            <div className="flex min-h-0 flex-1">
                <ToolList
                    groups={libraryRows(statuses, installing, failed, query)}
                    found={foundRows(suggestions, hidden, query)}
                    selected={suggestion?.id ?? row?.tool.id ?? null}
                />
                {form != null ? (
                    // keyed so that Add after Edit, or Edit of another tool, starts its own error and busy state
                    <ToolFormPane key={form.id ?? "new"} form={form} statuses={statuses} />
                ) : suggestion != null ? (
                    <SuggestionDetail key={suggestion.id} tool={suggestion} />
                ) : row != null ? (
                    <ToolDetail key={row.tool.id} model={model} row={row} />
                ) : (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">No tools yet.</div>
                )}
            </div>
        </div>
    );
}
