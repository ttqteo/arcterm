// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's details for an agent row: the task, the command with its flags, and the worktree. Moved out of
// the old New agent dialog. The task field is always there (it hid behind "+ Start with a task") so Tab lands in it.
// Whether the flag menu or the branch list is open lives in launcherstore, so the dialog's one key handler closes the
// open one on Escape wherever focus is, and the dialog stays. Images pasted or dropped into the task show as a row of
// tiles under it (launcherimages.ts holds the rules, launcherstore.ts the temp writes).

import { composerReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ClipboardEvent, type DragEvent } from "react";
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
import { ResumeList } from "./launcherresumelist";
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

function TaskImages() {
    const images = useAtomValue(launcherImagesAtom);
    if (images.length === 0) {
        return null;
    }
    return (
        <>
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
                                src={img.previewUrl}
                                alt=""
                                className={cn(
                                    "h-full w-full rounded-[8px] border object-cover",
                                    state === "error" ? "border-warning" : "border-edge-mid"
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
            {images.map((img) =>
                img.error != null ? (
                    <span key={img.id} data-task-image-error className="text-[12px] text-warning">
                        {img.error}
                    </span>
                ) : null
            )}
        </>
    );
}

interface AgentFieldsProps {
    runtime: Runtime;
    currentBranch: string;
    branches: BranchInfo[];
    ramWarning: string | null;
    // the picked agent's recent sessions in the picked project, and the one picked to resume (null: a new session)
    resumeChoices: SessionInfo[];
    resume: SessionInfo | null;
}

export function AgentFields({ runtime, currentBranch, branches, ramWarning, resumeChoices, resume }: AgentFieldsProps) {
    const task = useAtomValue(launcherTaskAtom);
    const commands = useAtomValue(launcherCommandAtom);
    const naFlags = useAtomValue(naFlagsAtom);
    const remember = useAtomValue(naRememberFlagsAtom);
    const worktreeOn = useAtomValue(launcherWorktreeAtom);
    const branchPick = useAtomValue(launcherBranchAtom);
    const flagMenuOpen = useAtomValue(launcherFlagMenuAtom);
    const branchListOpen = useAtomValue(launcherBranchListAtom);
    const setFlagMenuOpen = (open: boolean) => globalStore.set(launcherFlagMenuAtom, open);
    const setBranchListOpen = (open: boolean) => globalStore.set(launcherBranchListAtom, open);
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
    const taskHint = resume
        ? "optional · sent as the next message · paste or drop images"
        : "optional · sent as the first prompt · paste or drop images";
    // with sessions to resume, Task and Resume sit side by side so the dialog fits without scrolling
    const withResume = runtimeShowsTask(runtime) && resumeChoices.length > 0;
    return (
        <>
            {runtimeShowsTask(runtime) ? (
                <div className={cn(withResume && "grid grid-cols-2 gap-4")}>
                    <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex items-baseline gap-2">
                            <label htmlFor="launcher-task" className={LAUNCHER_LABEL}>
                                Task
                            </label>
                            <span title={taskHint} className="min-w-0 truncate text-[11px] text-muted">
                                {taskHint}
                            </span>
                        </div>
                        {/* grows with what is typed, up to about eleven lines, then scrolls; beside Resume it fills the row */}
                        <textarea
                            id="launcher-task"
                            value={task}
                            onChange={(e) => globalStore.set(launcherTaskAtom, e.target.value)}
                            onPaste={pasteIntoTask}
                            onDragOver={(e) => {
                                if (dragHasFiles(e.dataTransfer)) {
                                    e.preventDefault();
                                }
                            }}
                            onDrop={dropIntoTask}
                            placeholder="What should it work on? Leave empty to just open the session."
                            className="block field-sizing-content min-h-16 max-h-[240px] w-full grow resize-none overflow-y-auto rounded-[10px] border border-edge-mid bg-surface px-3 py-[10px] text-[13px] leading-normal text-primary outline-none placeholder:text-muted focus:border-accent-700"
                        />
                        <TaskImages />
                    </div>
                    {withResume ? <ResumeList choices={resumeChoices} pickedId={resume?.id ?? null} /> : null}
                </div>
            ) : null}
            <div className="flex flex-col gap-2">
                <label htmlFor="launcher-cmd" className={LAUNCHER_LABEL}>
                    Command
                </label>
                <div className="flex min-h-[38px] flex-wrap items-center gap-[6px] rounded-[8px] border border-edge-mid bg-surface py-[5px] pl-3 pr-[6px] focus-within:border-accent-700">
                    <span className="font-mono text-[12.5px] font-semibold text-success">›</span>
                    <input
                        id="launcher-cmd"
                        value={startup}
                        readOnly={resume != null}
                        onChange={(e) => setStartup(e.target.value)}
                        placeholder={runtime === "terminal" ? "default shell" : runtimeStartupCommand(runtime)}
                        style={{
                            width: `${Math.max(startup.length + 1, runtime === "terminal" && !startup ? 14 : 4)}ch`,
                        }}
                        className="bg-transparent font-mono text-[12.5px] text-secondary outline-none"
                    />
                    {enabledFlags.map((f) => (
                        <span
                            key={f.id}
                            title={f.desc}
                            className="flex items-center gap-0.5 rounded-[6px] border border-accent-700 bg-accentbg py-0.5 pl-2 pr-0.5"
                        >
                            <span className="font-mono text-[11.5px] font-semibold text-accent-soft">{f.flag}</span>
                            <button
                                type="button"
                                aria-label={`Remove ${f.flag}`}
                                onClick={() => setFlag(f.id, false)}
                                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:text-primary"
                            >
                                <X size={11} strokeWidth={2.4} />
                            </button>
                        </span>
                    ))}
                    <div className="flex-1" />
                    {flagCatalog.length > 0 ? (
                        <button
                            type="button"
                            aria-expanded={flagMenuOpen}
                            onClick={() => setFlagMenuOpen(!flagMenuOpen)}
                            className={cn(
                                "flex cursor-pointer items-center gap-[5px] rounded-[6px] px-2 py-1 text-[11.5px] font-semibold",
                                flagMenuOpen
                                    ? "bg-accentbg text-accent-soft"
                                    : "text-ink-mid hover:bg-surface-hover hover:text-primary"
                            )}
                        >
                            <Plus size={12} strokeWidth={2.2} />
                            <span>Flag</span>
                        </button>
                    ) : null}
                </div>
                <AnimatePresence>
                    {flagMenuOpen && flagCatalog.length > 0 && (
                        <motion.div
                            variants={composerReveal}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="flex flex-col overflow-hidden rounded-[10px] border border-edge-mid bg-surface p-1"
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
                                        <span className="flex-1 truncate text-right text-[11px] text-muted">
                                            {f.desc}
                                        </span>
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
            </div>
            {runtime === "terminal" ? (
                <span className="text-[11.5px] text-muted">
                    A plain shell in the project folder. A command typed above runs in it when it opens.
                </span>
            ) : null}
            {runtimeSupportsWorktree(runtime) && resume == null ? (
                <div className="flex flex-col gap-[7px]">
                    <div className="flex min-h-[34px] items-center gap-3">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={worktreeOn}
                            onClick={() => globalStore.set(launcherWorktreeAtom, (v) => !v)}
                            className="flex cursor-pointer items-center gap-[10px]"
                        >
                            <span
                                className={cn(
                                    "relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors",
                                    worktreeOn ? "bg-accent" : "bg-edge-strong"
                                )}
                            >
                                <span
                                    className={cn(
                                        "absolute top-[3px] h-[14px] w-[14px] rounded-full bg-background transition-all",
                                        worktreeOn ? "left-[18px]" : "left-[2px]"
                                    )}
                                />
                            </span>
                            <span className="whitespace-nowrap text-[12.5px] font-medium text-secondary">
                                Isolated git worktree
                            </span>
                        </button>
                        {worktreeOn ? (
                            <div className="relative flex min-w-0 flex-1 items-center gap-2">
                                <span className="text-[11.5px] text-muted">on branch</span>
                                <div className="flex min-w-0 flex-1 items-center rounded-[8px] border border-edge-mid bg-surface focus-within:border-accent-700">
                                    <input
                                        aria-label="Branch"
                                        value={effectiveBranch}
                                        onChange={(e) => globalStore.set(launcherBranchAtom, e.target.value)}
                                        onFocus={() => setBranchListOpen(true)}
                                        placeholder={currentBranch || "feat/new-agent"}
                                        className="min-w-0 flex-1 bg-transparent px-[10px] py-[7px] text-[12.5px] text-secondary outline-none"
                                    />
                                    {branches.length > 0 ? (
                                        <button
                                            type="button"
                                            aria-label="Show branches"
                                            onClick={() => setBranchListOpen(!branchListOpen)}
                                            className="cursor-pointer px-[10px] py-[7px] text-muted hover:text-primary"
                                        >
                                            <ChevronDown size={12} />
                                        </button>
                                    ) : null}
                                </div>
                                <PopoverReveal
                                    open={branchListOpen && branches.length > 0}
                                    origin="bottom left"
                                    className="absolute bottom-full left-[64px] right-0 z-10 mb-1 max-h-[168px] overflow-y-auto rounded border border-edge-mid bg-modalbg py-1 shadow-popover"
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
                                            {b.age ? (
                                                <span className="shrink-0 text-[10.5px] text-muted">{b.age}</span>
                                            ) : null}
                                        </button>
                                    ))}
                                </PopoverReveal>
                            </div>
                        ) : null}
                    </div>
                    {worktreeOn ? (
                        <span className="pl-[44px] text-[11.5px] text-muted">
                            {worktreeOutcome({ branch: effectiveBranch, currentBranch, branchNames })}
                        </span>
                    ) : null}
                </div>
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
