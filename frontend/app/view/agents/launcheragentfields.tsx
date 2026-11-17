// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's details for an agent row: one Task row (the task field, then icon buttons for flags, the worktree
// toggle and Command ›, with the enabled flags as chips under the field), with the branch row, the command strip and the
// notes under it. The task field is
// always there (it hid behind "+ Start with a task") so Tab lands in it. The command shows only while Command › is open,
// which is this component's state, so every opening of the dialog starts folded; a terminal has no task and shows it
// open. Whether the flag menu or the branch list is open lives in launcherstore, so the dialog's one key handler closes
// the open one on Escape wherever focus is, and the dialog stays.
//
// The task field is the editor Chat's box draws its text in (chateditor.tsx), with the core they share (promptbox.ts): an
// `@` lists the project's files and the agents, runs, councils, conversations and initiatives it can name, a `/` (for
// claude) Claude Code's commands, and a file pasted, dropped or picked (the paperclip, or Ctrl+U / Cmd+U) is a chip in the
// tray under the field, the same chips Chat's box shows (composerattachments.ts, kept under LAUNCHER_DRAFT).

import { composerReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatChordString } from "@/util/keysym";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, Flag, GitBranch, Paperclip, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type RefObject } from "react";
import { AttachmentTray } from "./attachmenttray";
import { ChatEditor, type EditorLike } from "./chateditor";
import { useComposerAttachments } from "./composerattachments";
import {
    RUNTIME_FLAGS,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    worktreeOutcome,
    type Runtime,
} from "./launch";
import { resumeLaunchSpec } from "./launcherresume";
import {
    LAUNCHER_DRAFT,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
} from "./launcherstore";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { usePromptBox } from "./promptbox";

// the Task box's editor: three lines when empty (13px at the editor's 1.9 line height), about ten before it scrolls
const TASK_MIN_H = 74;
const TASK_MAX_H = 240;

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
    // the picked project's name, which orders the runs, councils and initiatives an `@` can name; empty in Home
    projectName: string;
    // a letter typed in the Start column moves focus here
    taskRef: RefObject<EditorLike | null>;
}

export function AgentFields({
    runtime,
    currentBranch,
    branches,
    ramWarning,
    resume,
    home,
    filesRoot,
    projectName,
    taskRef,
}: AgentFieldsProps) {
    const task = useAtomValue(launcherTaskAtom);
    // the chips are a draft under LAUNCHER_DRAFT: a close keeps them, and the launch reads them (launchermodal.tsx)
    const att = useComposerAttachments({ keep: true, draftKey: LAUNCHER_DRAFT });
    // the core Chat's box shares (promptbox.ts): `@` for files and the agents, runs, councils, conversations and
    // initiatives, `/` for Claude Code's commands, and the attachments' paste, drop and file dialog
    const box = usePromptBox({
        text: task,
        setText: (t) => globalStore.set(launcherTaskAtom, t),
        name: "launcher",
        editorRef: taskRef,
        att,
        filesRoot,
        cwd: filesRoot || undefined,
        projectName,
        projectPath: filesRoot,
        // no agent yet for the list to leave out
        selfId: "",
        // the commands are Claude Code's; a pick puts `/name ` in the task, which the agent runs as its first prompt
        slash: { off: runtime !== "claude" },
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
        (resume ? "optional · sent as the next message · " : "optional · sent as the first prompt · ") +
        `${formatChordString("Shift:Enter")} for a new line · paste or drop files · @ to mention` +
        (runtime === "claude" ? " · / for commands" : "");
    const showTask = runtimeShowsTask(runtime);
    const showWorktree = runtimeSupportsWorktree(runtime) && resume == null && !home;
    const outcome = worktreeOutcome({ branch: effectiveBranch, currentBranch, branchNames });
    // a terminal has no Task row to hold the toggle, so its command is always shown
    const showCommand = !showTask || commandOpen;
    return (
        <>
            {showTask ? (
                // a drag of files over the row makes it the drop zone: its border says so
                <div
                    data-launcher-task-row
                    data-launcher-dragging={box.dragging ? "" : undefined}
                    {...box.dropProps}
                    className={cn(
                        "flex min-w-0 flex-col rounded-[10px] border bg-surface pl-3 focus-within:border-accent-700",
                        box.dragging ? "border-dashed border-accent-700" : "border-edge-mid"
                    )}
                >
                    <div className="flex min-w-0 items-start gap-1 py-[3px] pr-1">
                        <span
                            onClick={() => taskRef.current?.focus()}
                            className={cn(LAUNCHER_LABEL, "flex h-[31px] shrink-0 items-center pr-1")}
                        >
                            Task
                        </span>
                        {/* three lines when empty, the dialog's first thing; grows as the text wraps, up to about ten lines,
                        then scrolls. Enter launches: the dialog's key handler, which the key goes on to, does it */}
                        <div
                            data-launcher-task-hint={taskHint}
                            title={task === "" ? taskHint : undefined}
                            className="min-w-[140px] flex-1 px-1 py-[3px]"
                        >
                            <ChatEditor
                                ref={taskRef}
                                value={task}
                                outsideCaret={box.outsideCaret.current}
                                minHeight={TASK_MIN_H}
                                maxHeight={TASK_MAX_H}
                                placeholder={taskHint}
                                className="text-[13px] text-primary"
                                dataAttrs={{ id: "launcher-task", "data-launcher-task": "" }}
                                onChange={(t) => {
                                    if (t !== box.told.current) {
                                        box.told.current = t;
                                        globalStore.set(launcherTaskAtom, t);
                                    }
                                    const ed = taskRef.current;
                                    if (ed != null) {
                                        box.onCaret(ed);
                                    }
                                }}
                                onPasteFiles={box.onPasteFiles}
                                onKeyDown={(e) => {
                                    box.menuKeys(e);
                                    if (e.defaultPrevented || e.nativeEvent.isComposing) {
                                        return;
                                    }
                                    // Ctrl+U (Cmd+U on a Mac) is Add files, as in Chat's box
                                    if (
                                        e.key.toLowerCase() === "u" &&
                                        !e.altKey &&
                                        !e.shiftKey &&
                                        (isMacOS() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
                                    ) {
                                        e.preventDefault();
                                        box.attach();
                                        return;
                                    }
                                    // Enter (and Mod+Enter) launches, which the dialog does: the editor must not take it
                                    // as a new line. Shift+Enter is the new line.
                                    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
                                        e.preventDefault();
                                    }
                                }}
                            />
                        </div>
                        {/* the buttons are tabIndex -1, for the pointer: Tab goes from the Task box to the Project column */}
                        {/* icons only, so the hint keeps the row's width: the names are in their titles */}
                        <div className="flex h-[31px] shrink-0 items-center gap-0.5">
                            <button
                                type="button"
                                tabIndex={-1}
                                data-launcher-attach
                                aria-label="Attach files"
                                title={`Attach files (${formatChordString("Mod:u")})`}
                                onClick={box.attach}
                                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-mid hover:bg-surface-hover hover:text-primary"
                            >
                                <Paperclip size={14} strokeWidth={2} />
                            </button>
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
                    {att.attachments.length > 0 ? (
                        <div className="pb-2 pr-2">
                            <AttachmentTray items={att.attachments} onRemove={att.remove} onRetry={att.retry} />
                        </div>
                    ) : null}
                </div>
            ) : null}
            {showTask ? box.slash.list : null}
            {showTask ? box.mention.list : null}
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
