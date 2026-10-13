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
    type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { Toggle } from "./settingsui";
import { installEndedAtom, selectedToolAtom, toolFormAtom, toolsSearchAtom, watchInstallEnds } from "./setupstore";
import {
    commandCheck,
    emptyForm,
    formFromTool,
    formKeywords,
    foundLine,
    headerSummary,
    installPanel,
    libraryRows,
    needsRestartHint,
    OPENS_IN_OPTIONS,
    overrideKeywords,
    selectedTool,
    SHOWS_OPTIONS,
    stateTone,
    statusLabel,
    uniqueToolId,
    validateNewTool,
    type LibraryGroup,
    type LibraryRow,
    type StateTone,
    type ToolForm,
} from "./toolslibrarymodel";
import { toolCommandLine, toolIcon, type ToolIconName } from "./toolsmodel";
import {
    addUserTool,
    failedAtom,
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
    if (statuses == null) {
        return null;
    }
    return <span className="text-[12px] text-ink-mid">{headerSummary(statuses, PLATFORM)}</span>;
}

// ---- left list ----

function ToolList({ groups, selected }: { groups: LibraryGroup[]; selected: string | null }) {
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
                {groups.length === 0 ? (
                    <div className="px-2 py-3 text-[12.5px] text-muted">No tool matches.</div>
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

function ToolDetail({ model, row }: { model: AgentsViewModel; row: LibraryRow }) {
    const { tool, state } = row;
    const isYours = tool.category === "Yours";
    const tone = stateTone(state);
    const terminals = useAtomValue(model.terminalsAtom).filter((t) => t.toolId === tool.id);
    const pinned = useAtomValue(pinnedToolsAtom).includes(tool.id);
    const ended = useAtomValue(installEndedAtom);
    const [notice, setNotice] = useState<string | null>(null);
    // the write reaches the config before the status shows it, so the choice is held here until the status agrees
    const [opensin, setOpensin] = useState(tool.opensin);
    const [shows, setShows] = useState(tool.shows);
    useEffect(() => setOpensin(tool.opensin), [tool.opensin]);
    useEffect(() => setShows(tool.shows), [tool.shows]);

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
    const change = async (patch: { opensin?: string; shows?: string }) => {
        setNotice(null);
        try {
            const current = globalStore.get(atoms.fullConfigAtom)?.tools?.[tool.id];
            await addUserTool(tool.id, overrideKeywords(tool, current, patch));
        } catch (e) {
            setOpensin(tool.opensin);
            setShows(tool.shows);
            setNotice(errText(e));
        }
    };
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
                <SettingRow label="Opens in" sub="Its working folder">
                    <Options
                        label="Opens in"
                        options={OPENS_IN_OPTIONS}
                        value={opensin}
                        onChange={(id) => {
                            setOpensin(id);
                            fireAndForget(() => change({ opensin: id }));
                        }}
                    />
                    <span className="text-[11.5px] text-muted">A worktree agent gives its worktree.</span>
                </SettingRow>
                <SettingRow label="Shows" sub="Where it appears on screen">
                    <Options
                        label="Shows"
                        options={SHOWS_OPTIONS}
                        value={shows}
                        onChange={(id) => {
                            setShows(id);
                            fireAndForget(() => change({ shows: id }));
                        }}
                    />
                </SettingRow>
                <SettingRow label="In Open a tool" sub="Listed at the top when on">
                    <Toggle
                        on={pinned}
                        onToggle={() => setToolPinned(tool.id, !pinned)}
                        label={`Pin ${tool.name} in Open a tool`}
                    />
                </SettingRow>
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
                    Changed from the built-in.
                    <button
                        type="button"
                        data-tool-reset
                        onClick={() => fireAndForget(reset)}
                        className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-accent-soft hover:text-accent"
                    >
                        Reset to default
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

function ToolFormPane({ form, statuses }: { form: ToolForm; statuses: ToolStatus[] }) {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const existing = form.id != null ? (statuses.find((t) => t.id === form.id) ?? null) : null;
    const check = commandCheck(form.command, existing);
    const set = (patch: Partial<ToolForm>) => globalStore.set(toolFormAtom, { ...form, ...patch });
    const close = () => globalStore.set(toolFormAtom, null);

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
                    Any program that runs in a terminal. arcterm keeps it in your settings and lists it under Yours.
                </div>
            </div>
            <div className="flex flex-col rounded border border-edge-mid bg-surface">
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
                        <span className="w-[160px] flex-none text-[13px] text-primary">Opens in</span>
                        <Options
                            label="Opens in"
                            options={OPENS_IN_OPTIONS}
                            value={form.opensin}
                            onChange={(id) => set({ opensin: id })}
                        />
                    </div>
                </FormRow>
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
                <span className="font-mono text-[11.5px] text-ink-mid">tools.json</span>
            </div>
        </div>
    );
}

// ---- the tab ----

export function ToolsLibrary({ model }: { model: AgentsViewModel }) {
    const statuses = useAtomValue(toolsStatusAtom);
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
    const tool = selectedTool(statuses, selectedId);
    const row = rows.find((r) => r.tool.id === tool?.id) ?? null;
    return (
        <div data-tools-library className="flex min-w-0 flex-1 flex-col">
            {banner}
            <div className="flex min-h-0 flex-1">
                <ToolList groups={libraryRows(statuses, installing, failed, query)} selected={row?.tool.id ?? null} />
                {form != null ? (
                    // keyed so that Add after Edit, or Edit of another tool, starts its own error and busy state
                    <ToolFormPane key={form.id ?? "new"} form={form} statuses={statuses} />
                ) : row != null ? (
                    <ToolDetail key={row.tool.id} model={model} row={row} />
                ) : (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">No tools yet.</div>
                )}
            </div>
        </div>
    );
}
