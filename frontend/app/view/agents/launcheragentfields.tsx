// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's details for an agent row: one Task row (the task field, then icon buttons for flags, the worktree
// toggle and Command ›, with the enabled flags as chips under the field), with the branch row, the command strip and the
// notes under it. The task field is
// always there (it hid behind "+ Start with a task") so Tab lands in it. The command shows only while Command › is open,
// which is this component's state, so every opening of the dialog starts folded; a terminal has no task and shows it
// open. Whether the flag menu or the branch list is open lives in launcherstore, so the dialog's one key handler closes
// the open one on Escape wherever focus is, and the dialog stays. Images pasted or dropped into the task show as a row
// of tiles inside the Task row (launcherimages.ts holds the rules, launcherstore.ts the temp writes). An `@` typed in the
// task lists the project's files under the Task row, and a pick puts `@<path>` in the task (filemention.tsx).

import { composerReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, Flag, GitBranch, Loader2, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ClipboardEvent, type DragEvent, type RefObject } from "react";
import { useFileMention } from "./filemention";
import {
    RUNTIME_FLAGS,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    worktreeOutcome,
    type Runtime,
} from "./launch";
import { imageFilesOf } from "./launcherimages";
import { resumeLaunchSpec } from "./launcherresume";
import {
    addTaskImages,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherImagesAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
    removeTaskImage,
} from "./launcherstore";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";

export const LAUNCHER_LABEL = "text-[10px] font-semibold uppercase tracking-[0.1em] text-muted";

// The project's branches, newest first, for the worktree field, and its checked-out branch for the field's default
// and the footer. A project that is not a repo reads as no branches and no current branch.
export function useProjectBranches(
    open: boolean,
    projectPath: string,
    wantList: boolean
): { currentBranch: string; branches: BranchInfo[] } {
    const [currentBranch, setCurrentBranch] = useState("");
    const [branches, setBranches] = useState<BranchInfo[]>([]);
    useEffect(() => {
        if (!open || !wantList || !projectPath) {
            setBranches([]);
            return;
        }
        let cancelled = false;
        RpcApi.ListBranchesCommand(TabRpcClient, { projectpath: projectPath })
            .then((rtn) => {
                if (!cancelled) {
                    setBranches(rtn.branches ?? []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setBranches([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, wantList, projectPath]);
    useEffect(() => {
        if (!open || !projectPath) {
            setCurrentBranch("");
            return;
        }
        let cancelled = false;
        RpcApi.GitChangesCommand(TabRpcClient, { cwd: projectPath })
            .then((rtn) => {
                if (!cancelled) {
                    setCurrentBranch(rtn?.branch ?? "");
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCurrentBranch("");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, projectPath]);
    return { currentBranch, branches };
}

// an OS file drag; the webview's own drag-drop is off, so a file dropped unhandled would navigate it to the file
const dragHasFiles = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes("Files");

// A pasted text is left to the browser; a paste that carries images takes them and inserts any text beside them.
function pasteIntoTask(e: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = imageFilesOf(e.clipboardData?.files);
    if (files.length === 0) {
        return;
    }
    e.preventDefault();
    addTaskImages(files, "paste");
    const text = e.clipboardData.getData("text/plain");
    if (text !== "") {
        const el = e.currentTarget;
        el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
        globalStore.set(launcherTaskAtom, el.value);
    }
}

function dropIntoTask(e: DragEvent<HTMLTextAreaElement>): void {
    if (!dragHasFiles(e.dataTransfer)) {
        return;
    }
    e.preventDefault();
    addTaskImages(imageFilesOf(e.dataTransfer.files), "drop");
}

// a click on a thumbnail shows that image larger under the row, another click (on either) shrinks it back
function TaskImages() {
    const images = useAtomValue(launcherImagesAtom);
    const [openId, setOpenId] = useState<string | null>(null);
    if (images.length === 0) {
        return null;
    }
    const shown = images.find((i) => i.id === openId);
    const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
    return (
        <div className="flex flex-col gap-2 pb-2 pr-2">
            <div className="flex flex-wrap gap-2">
                {images.map((img) => {
                    const state = img.error != null ? "error" : img.path != null ? "ready" : "pending";
                    return (
                        <div
                            key={img.id}
                            data-task-image
                            data-task-image-state={state}
                            className="relative h-12 w-12 shrink-0"
                        >
                            <img
                                // a parked launch's image has no preview until its file is read back (parkedstore.ts)
                                src={img.previewUrl || undefined}
                                alt=""
                                onClick={() => toggle(img.id)}
                                className={cn(
                                    "h-full w-full rounded-[8px] border object-cover",
                                    img.id === openId ? "cursor-zoom-out" : "cursor-zoom-in",
                                    state === "error"
                                        ? "border-warning"
                                        : img.id === openId
                                          ? "border-accent"
                                          : "border-edge-mid"
                                )}
                            />
                            {state === "pending" ? (
                                <span className="absolute inset-0 flex items-center justify-center rounded-[8px] bg-background/60">
                                    <Loader2
                                        size={14}
                                        className="animate-spin text-primary motion-reduce:animate-none"
                                    />
                                </span>
                            ) : null}
                            <button
                                type="button"
                                tabIndex={-1}
                                aria-label="Remove image"
                                onClick={() => removeTaskImage(img.id)}
                                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-edge-mid bg-surface text-muted hover:text-primary"
                            >
                                <X size={10} strokeWidth={2.4} />
                            </button>
                        </div>
                    );
                })}
            </div>
            {shown != null ? (
                <img
                    data-task-image-open
                    src={shown.previewUrl || undefined}
                    alt=""
                    onClick={() => setOpenId(null)}
                    className="max-h-[40vh] max-w-full cursor-zoom-out self-start rounded-[8px] border border-edge-mid object-contain"
                />
            ) : null}
            {images.map((img) =>
                img.error != null ? (
                    <span key={img.id} data-task-image-error className="text-[12px] text-warning">
                        {img.error}
                    </span>
                ) : null
            )}
        </div>
    );
}

interface AgentFieldsProps {
    runtime: Runtime;
    currentBranch: string;
    branches: BranchInfo[];
    ramWarning: string | null;
    // the session picked to resume in the Session column (null: a new session)
    resume: SessionInfo | null;
    // started in No folder, outside any project: no worktree to make
    home: boolean;
    // the picked project's folder, whose files an `@` in the task lists; empty in Home (too big to walk) or with none
    filesRoot: string;
    // a letter typed in the Start column moves focus here
    taskRef: RefObject<HTMLTextAreaElement>;
}

export function AgentFields({
    runtime,
    currentBranch,
    branches,
    ramWarning,
    resume,
    home,
    filesRoot,
    taskRef,
}: AgentFieldsProps) {
    const task = useAtomValue(launcherTaskAtom);
    const mention = useFileMention({
        text: task,
        setText: (t) => globalStore.set(launcherTaskAtom, t),
        filesRoot,
        inputRef: taskRef,
        name: "launcher",
    });
    const commands = useAtomValue(launcherCommandAtom);
    const naFlags = useAtomValue(naFlagsAtom);
    const remember = useAtomValue(naRememberFlagsAtom);
    const worktreeOn = useAtomValue(launcherWorktreeAtom);
    const branchPick = useAtomValue(launcherBranchAtom);
    const flagMenuOpen = useAtomValue(launcherFlagMenuAtom);
    const branchListOpen = useAtomValue(launcherBranchListAtom);
    const setFlagMenuOpen = (open: boolean) => globalStore.set(launcherFlagMenuAtom, open);
    const setBranchListOpen = (open: boolean) => globalStore.set(launcherBranchListAtom, open);
    // Command › is folded on every opening: the dialog unmounts this component when it closes
    const [commandOpen, setCommandOpen] = useState(false);
    // another runtime has other flags and maybe no worktree: start it with both popovers shut
    useEffect(() => {
        globalStore.set(launcherFlagMenuAtom, false);
        globalStore.set(launcherBranchListAtom, false);
    }, [runtime]);
    const setStartup = (value: string) =>
        globalStore.set(launcherCommandAtom, (prev) => ({ ...prev, [runtime]: value }));
    // flag state is per runtime: read and write only the picked runtime's record
    const flagCatalog = RUNTIME_FLAGS[runtime];
    const runtimeFlags = naFlags[runtime] ?? {};
    // a resume runs the session's own command, which the field previews and does not take edits to
    const startup = resume
        ? resumeLaunchSpec(resume, runtime, runtimeFlags).startupCommand
        : (commands[runtime] ?? runtimeStartupCommand(runtime));
    const enabledFlags = flagCatalog.filter((f) => runtimeFlags[f.id]);
    const setFlag = (id: string, on: boolean) =>
        globalStore.set(naFlagsAtom, (prev) => ({ ...prev, [runtime]: { ...prev[runtime], [id]: on } }));
    // the field shows the project's checked-out branch until one is typed or picked
    const effectiveBranch = branchPick ?? currentBranch;
    const branchNames = branches.map((b) => b.name);
    const taskHint =
        (resume
            ? `optional · sent as the next message · ${formatChordString("Shift:Enter")} for a new line · paste or drop images`
            : `optional · sent as the first prompt · ${formatChordString("Shift:Enter")} for a new line · paste or drop images`) +
        (filesRoot !== "" ? " · @ for a file" : "");
    const showTask = runtimeShowsTask(runtime);
    const showWorktree = runtimeSupportsWorktree(runtime) && resume == null && !home;
    const outcome = worktreeOutcome({ branch: effectiveBranch, currentBranch, branchNames });
    // a terminal has no Task row to hold the toggle, so its command is always shown
    const showCommand = !showTask || commandOpen;
    return (
        <>
            {showTask ? (
                <div
                    data-launcher-task-row
                    className="flex min-w-0 flex-col rounded-[10px] border border-edge-mid bg-surface pl-3 focus-within:border-accent-700"
                >
                    <div className="flex min-w-0 items-start gap-1 py-[3px] pr-1">
                        <label
                            htmlFor="launcher-task"
                            className={cn(LAUNCHER_LABEL, "flex h-[31px] shrink-0 items-center pr-1")}
                        >
                            Task
                        </label>
                        {/* three lines when empty, the dialog's first thing; grows as the text wraps, up to about eleven
                        lines, then scrolls */}
                        <textarea
                            ref={taskRef}
                            id="launcher-task"
                            rows={1}
                            value={task}
                            onChange={(e) => {
                                globalStore.set(launcherTaskAtom, e.target.value);
                                mention.onCaret(e.target);
                            }}
                            onSelect={(e) => mention.onCaret(e.currentTarget)}
                            onKeyDown={mention.onKeyDown}
                            onPaste={pasteIntoTask}
                            onDragOver={(e) => {
                                if (dragHasFiles(e.dataTransfer)) {
                                    e.preventDefault();
                                }
                            }}
                            onDrop={dropIntoTask}
                            placeholder={taskHint}
                            title={task === "" ? taskHint : undefined}
                            className={cn(
                                "block field-sizing-content max-h-[240px] min-w-[140px] flex-1 resize-none bg-transparent px-1 py-[6px] text-[13px] leading-[19px] text-primary outline-none placeholder:truncate placeholder:text-muted",
                                // the placeholder would size the field and wrap it; empty, it is three lines
                                task === "" ? "h-[69px] overflow-hidden" : "min-h-[69px] overflow-y-auto"
                            )}
                        />
                        {/* the buttons are tabIndex -1, for the pointer: Tab goes from the Task box to the Project column */}
                        {/* icons only, so the hint keeps the row's width: the names are in their titles */}
                        <div className="flex h-[31px] shrink-0 items-center gap-0.5">
                            {flagCatalog.length > 0 ? (
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    aria-expanded={flagMenuOpen}
                                    aria-label={
                                        enabledFlags.length > 0
                                            ? `Add a flag (${enabledFlags.length} on)`
                                            : "Add a flag"
                                    }
                                    title="Add a flag"
                                    onClick={() => setFlagMenuOpen(!flagMenuOpen)}
                                    className={cn(
                                        "relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px]",
                                        flagMenuOpen
                                            ? "bg-accentbg text-accent-soft"
                                            : enabledFlags.length > 0
                                              ? "text-accent-soft hover:bg-surface-hover"
                                              : "text-ink-mid hover:bg-surface-hover hover:text-primary"
                                    )}
                                >
                                    <Flag size={14} strokeWidth={2} />
                                    {enabledFlags.length > 0 ? (
                                        <span className="absolute right-0 top-px flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-accent-700 px-[3px] text-[9px] font-semibold tabular-nums text-primary">
                                            {enabledFlags.length}
                                        </span>
                                    ) : null}
                                </button>
                            ) : null}
                            {showWorktree ? (
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    role="switch"
                                    aria-checked={worktreeOn}
                                    aria-label="Worktree"
                                    title="Run in an isolated git worktree"
                                    onClick={() => globalStore.set(launcherWorktreeAtom, (v) => !v)}
                                    className={cn(
                                        "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px]",
                                        worktreeOn
                                            ? "bg-accentbg text-accent-soft"
                                            : "text-ink-mid hover:bg-surface-hover hover:text-primary"
                                    )}
                                >
                                    <GitBranch size={14} strokeWidth={2} />
                                </button>
                            ) : null}
                            <button
                                type="button"
                                tabIndex={-1}
                                data-launcher-command-toggle
                                aria-expanded={commandOpen}
                                aria-label="Command"
                                title="Show the command it runs"
                                onClick={() => setCommandOpen((v) => !v)}
                                className={cn(
                                    "flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-[6px] px-1.5",
                                    commandOpen
                                        ? "bg-surface-hover text-primary"
                                        : "text-ink-mid hover:bg-surface-hover hover:text-primary"
                                )}
                            >
                                <SquareTerminal size={14} strokeWidth={2} />
                                <ChevronRight
                                    size={10}
                                    strokeWidth={2.4}
                                    className={cn("transition-transform", commandOpen && "rotate-90")}
                                />
                            </button>
                        </div>
                    </div>
                    {enabledFlags.length > 0 ? (
                        <div data-launcher-flag-chips className="flex min-w-0 flex-wrap gap-1 pb-1.5 pr-1 pl-[38px]">
                            {enabledFlags.map((f) => (
                                <span
                                    key={f.id}
                                    data-launcher-flag-chip={f.flag}
                                    title={`${f.flag} · ${f.desc}`}
                                    className="flex min-w-0 max-w-[260px] items-center gap-0.5 rounded-[6px] border border-accent-700 bg-accentbg py-0.5 pl-2 pr-0.5"
                                >
                                    <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-accent-soft">
                                        {f.flag}
                                    </span>
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        aria-label={`Remove ${f.flag}`}
                                        onClick={() => setFlag(f.id, false)}
                                        className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:text-primary"
                                    >
                                        <X size={10} strokeWidth={2.4} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <TaskImages />
                </div>
            ) : null}
            {showTask ? mention.list : null}
            <AnimatePresence>
                {flagMenuOpen && flagCatalog.length > 0 && (
                    <motion.div
                        variants={composerReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="flex shrink-0 flex-col overflow-hidden rounded-[10px] border border-edge-mid bg-surface p-1"
                    >
                        {flagCatalog.map((f) => {
                            const on = !!runtimeFlags[f.id];
                            return (
                                <label
                                    key={f.id}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-[10px] rounded-[7px] px-2 py-[6px]",
                                        on ? "bg-accentbg" : "hover:bg-surface-hover"
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() => setFlag(f.id, !on)}
                                        className="m-0 h-[13px] w-[13px] cursor-pointer accent-accent"
                                    />
                                    <span
                                        className={cn(
                                            "shrink-0 font-mono text-[11.5px] font-semibold",
                                            on ? "text-accent-soft" : "text-muted-foreground"
                                        )}
                                    >
                                        {f.flag}
                                    </span>
                                    <span className="flex-1 truncate text-right text-[11px] text-muted">{f.desc}</span>
                                </label>
                            );
                        })}
                        <label className="-mx-1 -mb-1 mt-1 flex cursor-pointer items-center gap-1.5 border-t border-border px-3 py-[7px] text-[11.5px] text-muted">
                            <input
                                type="checkbox"
                                checked={remember}
                                onChange={() => globalStore.set(naRememberFlagsAtom, (v) => !v)}
                                className="m-0 h-[13px] w-[13px] cursor-pointer accent-accent"
                            />
                            <span>Remember these flags for the next agent</span>
                        </label>
                    </motion.div>
                )}
            </AnimatePresence>
            {showWorktree && worktreeOn ? (
                <div data-launcher-branch-row className="flex min-w-0 items-center gap-[10px]">
                    <label htmlFor="launcher-branch" className="shrink-0 text-[11.5px] text-muted">
                        Branch
                    </label>
                    <div className="relative flex w-[240px] flex-none items-center rounded-[8px] border border-edge-mid bg-surface focus-within:border-accent-700">
                        <input
                            id="launcher-branch"
                            aria-label="Branch"
                            value={effectiveBranch}
                            onChange={(e) => globalStore.set(launcherBranchAtom, e.target.value)}
                            onFocus={() => setBranchListOpen(true)}
                            placeholder={currentBranch || "feat/new-agent"}
                            className="min-w-0 flex-1 bg-transparent px-[10px] py-[6px] text-[12.5px] text-secondary outline-none"
                        />
                        {branches.length > 0 ? (
                            <button
                                type="button"
                                aria-label="Show branches"
                                onClick={() => setBranchListOpen(!branchListOpen)}
                                className="cursor-pointer px-[10px] py-[6px] text-muted hover:text-primary"
                            >
                                <ChevronDown size={12} />
                            </button>
                        ) : null}
                        <PopoverReveal
                            open={branchListOpen && branches.length > 0}
                            origin="bottom left"
                            className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-[168px] overflow-y-auto rounded border border-edge-mid frost py-1 shadow-popover"
                        >
                            {branches.map((b) => (
                                <button
                                    key={b.name}
                                    type="button"
                                    onClick={() => {
                                        globalStore.set(launcherBranchAtom, b.name);
                                        setBranchListOpen(false);
                                    }}
                                    className={cn(
                                        "flex w-full cursor-pointer items-center gap-2 px-3 py-[7px] text-left hover:bg-surface-hover",
                                        b.name === effectiveBranch ? "text-primary" : "text-secondary"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "h-[6px] w-[6px] shrink-0 rounded-full",
                                            b.name === effectiveBranch ? "bg-accent" : "bg-muted"
                                        )}
                                    />
                                    <span className="flex-1 truncate text-[12px]">{b.name}</span>
                                    {b.age ? <span className="shrink-0 text-[10.5px] text-muted">{b.age}</span> : null}
                                </button>
                            ))}
                        </PopoverReveal>
                    </div>
                    <span
                        data-launcher-branch-hint
                        title={outcome}
                        className="min-w-0 truncate text-[11.5px] text-muted"
                    >
                        {outcome}
                    </span>
                </div>
            ) : null}
            {showCommand ? (
                // The input is only as wide as its text, so a click anywhere on the strip's own surface focuses it.
                <div
                    data-launcher-command
                    onMouseDown={(e) => {
                        if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.cmdPrompt) {
                            return;
                        }
                        e.preventDefault();
                        const input = e.currentTarget.querySelector("input");
                        input?.focus();
                        input?.setSelectionRange(input.value.length, input.value.length);
                    }}
                    className="flex min-h-[34px] min-w-0 shrink-0 cursor-text flex-wrap items-center gap-[6px] rounded-[8px] border border-transparent bg-surface-code py-1 pl-3 pr-[6px] focus-within:border-accent-700"
                >
                    <span data-cmd-prompt="1" className="font-mono text-[12px] font-semibold text-success">
                        ›
                    </span>
                    <input
                        id="launcher-cmd"
                        aria-label="Command"
                        value={startup}
                        readOnly={resume != null}
                        onChange={(e) => setStartup(e.target.value)}
                        placeholder={runtime === "terminal" ? "default shell" : runtimeStartupCommand(runtime)}
                        style={{
                            width: `${Math.max(startup.length + 1, runtime === "terminal" && !startup ? 14 : 4)}ch`,
                        }}
                        className="max-w-full bg-transparent font-mono text-[12px] text-secondary outline-none"
                    />
                    {enabledFlags.map((f) => (
                        <span
                            key={f.id}
                            title={f.desc}
                            className="flex items-center gap-0.5 rounded-[6px] border border-accent-700 bg-accentbg py-0.5 pl-2 pr-0.5"
                        >
                            <span className="font-mono text-[11px] font-semibold text-accent-soft">{f.flag}</span>
                            <button
                                type="button"
                                aria-label={`Remove ${f.flag}`}
                                onClick={() => setFlag(f.id, false)}
                                className="flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[4px] text-muted hover:text-primary"
                            >
                                <X size={10} strokeWidth={2.4} />
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}
            {runtime === "terminal" ? (
                <span className="text-[11.5px] text-muted">
                    {home
                        ? "A plain shell in No folder, an empty folder of its own. A command typed above runs in it when it opens."
                        : "A plain shell in the project folder. A command typed above runs in it when it opens."}
                </span>
            ) : null}
            {ramWarning ? (
                <div data-ram-warn className="flex items-center gap-1.5 text-[12px] text-warning">
                    <TriangleAlert size={13} className="shrink-0" />
                    <span>{ramWarning}</span>
                </div>
            ) : null}
        </>
    );
}
