// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's details for an agent row: one Task row (the task field, + Flag, the enabled flags, the worktree
// switch and a Command › toggle), with the branch row, the command strip and the notes under it. The task field is
// always there (it hid behind "+ Start with a task") so Tab lands in it. The command shows only while Command › is open,
// which is this component's state, so every opening of the dialog starts folded; a terminal has no task and shows it
// open. Whether the flag menu or the branch list is open lives in launcherstore, so the dialog's one key handler closes
// the open one on Escape wherever focus is, and the dialog stays. Images pasted or dropped into the task show as a row
// of tiles inside the Task row (launcherimages.ts holds the rules, launcherstore.ts the temp writes). An `@` typed in the
// task lists the project's files under the Task row, and a pick puts `@<path>` in the task (launchermention.ts).

import { FileIcon } from "@/app/element/fileicon";
import { composerReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { reloadFileIndex } from "@/app/view/code/codestore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, Loader2, Lock, Plus, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
    useEffect,
    useState,
    type ClipboardEvent,
    type DragEvent,
    type KeyboardEvent,
    type ReactNode,
    type RefObject,
} from "react";
import {
    ASK_SETTINGS_ARG,
    launcherFlagCatalog,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    worktreeOutcome,
    type Runtime,
} from "./launch";
import { imageFilesOf } from "./launcherimages";
import { fileMentionAt, fileMentionMatches, insertFileMention } from "./launchermention";
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
                                src={img.previewUrl}
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
                    src={shown.previewUrl}
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

interface FileMentionState {
    // the list under the Task row, or null when none shows
    list: ReactNode;
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    onCaret: (el: HTMLTextAreaElement) => void;
}

// The Task box's `@` picker. The project's files are read again on the first `@` of each opening of the dialog (it
// unmounts this on close): there is no watcher, and an agent creates files while it is closed. A query no file matches
// shows nothing, so an `@` meant as text never blocks Enter.
function useFileMention(task: string, filesRoot: string, taskRef: RefObject<HTMLTextAreaElement>): FileMentionState {
    const [caret, setCaret] = useState(0);
    const [pick, setPick] = useState(0);
    // the `@` whose list Escape closed; it stays closed until the caret leaves it
    const [dismissed, setDismissed] = useState(-1);
    const [listing, setListing] = useState<{ root: string; paths?: string[]; error?: boolean } | null>(null);
    const mention = filesRoot === "" ? null : fileMentionAt(task, caret);
    const open = mention != null && mention.start !== dismissed;
    useEffect(() => {
        if (!open || listing?.root === filesRoot) {
            return;
        }
        setListing({ root: filesRoot });
        reloadFileIndex(filesRoot).then(
            (idx) => setListing((cur) => (cur?.root === filesRoot ? { root: filesRoot, paths: idx.paths } : cur)),
            () => setListing((cur) => (cur?.root === filesRoot ? { root: filesRoot, error: true } : cur))
        );
    }, [open, filesRoot, listing?.root]);
    const own = listing?.root === filesRoot ? listing : null;
    const matches = open && own?.paths != null ? fileMentionMatches(mention.query, own.paths) : [];
    const note = !open
        ? null
        : own?.error
          ? "Could not list the project's files"
          : own?.paths == null
            ? "Listing files…"
            : null;
    const shown = note != null || matches.length > 0;
    const at = Math.min(pick, Math.max(matches.length - 1, 0));

    const choose = (path: string) => {
        const next = insertFileMention(task, mention.start, caret, path);
        globalStore.set(launcherTaskAtom, next.text);
        setCaret(next.caret);
        setPick(0);
        requestAnimationFrame(() => {
            taskRef.current?.focus();
            taskRef.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    // the picker's keys stop here: the dialog's own handler would launch on Enter, trap Tab and close on Escape
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!shown || e.nativeEvent.isComposing) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(mention.start);
            return;
        }
        if (matches.length === 0 || e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const n = matches.length;
            setPick((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            choose(matches[at]);
        }
    };
    // a keystroke or a click moves the caret and starts the list from its best match again; ↑↓ do not (the picker
    // takes them, so the caret stays)
    const onCaret = (el: HTMLTextAreaElement) => {
        setCaret(el.selectionStart);
        setPick(0);
        if (fileMentionAt(el.value, el.selectionStart) == null) {
            setDismissed(-1);
        }
    };

    const list = !shown ? null : (
        <ul
            role="listbox"
            data-launcher-mentions
            aria-label="Project files"
            className="m-0 flex shrink-0 list-none flex-col rounded-[10px] border border-edge-mid bg-surface p-1"
        >
            {note != null ? (
                <li className="px-2 py-[5px] text-[12px] text-muted">{note}</li>
            ) : (
                matches.map((path, i) => {
                    const slash = path.lastIndexOf("/");
                    return (
                        <li
                            key={path}
                            role="option"
                            aria-selected={i === at}
                            data-launcher-mention={path}
                            title={path}
                            onMouseDown={(e) => {
                                // keep focus in the Task box
                                e.preventDefault();
                                choose(path);
                            }}
                            onMouseMove={() => setPick(i)}
                            className={cn(
                                "flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] px-2 py-[5px]",
                                i === at && "bg-surface-hover"
                            )}
                        >
                            <FileIcon path={path} size={14} />
                            <span className="shrink-0 font-mono text-[12px] text-primary">{path.slice(slash + 1)}</span>
                            <span className="min-w-0 truncate font-mono text-[11px] text-muted">
                                {slash === -1 ? "" : path.slice(0, slash)}
                            </span>
                        </li>
                    );
                })
            )}
        </ul>
    );
    return { list, onKeyDown, onCaret };
}

interface AgentFieldsProps {
    runtime: Runtime;
    currentBranch: string;
    branches: BranchInfo[];
    ramWarning: string | null;
    // the session picked to resume in the Session column (null: a new session)
    resume: SessionInfo | null;
    // started in Home, the home folder outside any project: no worktree, and Claude Code runs ask-only
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
    const mention = useFileMention(task, filesRoot, taskRef);
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
    const flagCatalog = launcherFlagCatalog(runtime, home);
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
            ? "optional · sent as the next message · shift+enter for a new line · paste or drop images"
            : "optional · sent as the first prompt · shift+enter for a new line · paste or drop images") +
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
                        {/* tabIndex 0 on each button: WebKit's own Tab skips a button without one (Safari's default), so
                        a Tab the dialog's trap does not take still stops here before the Start column */}
                        <div className="flex min-h-[31px] min-w-0 flex-wrap items-center justify-end gap-1">
                            {flagCatalog.length > 0 ? (
                                <button
                                    type="button"
                                    tabIndex={0}
                                    aria-expanded={flagMenuOpen}
                                    title="Add a flag"
                                    onClick={() => setFlagMenuOpen(!flagMenuOpen)}
                                    className={cn(
                                        "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[11.5px] font-semibold",
                                        flagMenuOpen
                                            ? "bg-accentbg text-accent-soft"
                                            : "text-ink-mid hover:bg-surface-hover hover:text-primary"
                                    )}
                                >
                                    <Plus size={12} strokeWidth={2.2} />
                                    <span>Flag</span>
                                </button>
                            ) : null}
                            {enabledFlags.map((f) => (
                                <span
                                    key={f.id}
                                    data-launcher-flag-chip={f.flag}
                                    title={`${f.flag} · ${f.desc}`}
                                    className="flex min-w-0 max-w-[200px] items-center gap-0.5 rounded-[6px] border border-accent-700 bg-accentbg py-0.5 pl-2 pr-0.5"
                                >
                                    <span className="min-w-0 truncate font-mono text-[11px] font-semibold text-accent-soft">
                                        {f.flag}
                                    </span>
                                    <button
                                        type="button"
                                        tabIndex={0}
                                        aria-label={`Remove ${f.flag}`}
                                        onClick={() => setFlag(f.id, false)}
                                        className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:text-primary"
                                    >
                                        <X size={10} strokeWidth={2.4} />
                                    </button>
                                </span>
                            ))}
                            {showWorktree ? (
                                <button
                                    type="button"
                                    tabIndex={0}
                                    role="switch"
                                    aria-checked={worktreeOn}
                                    title="Run in an isolated git worktree"
                                    onClick={() => globalStore.set(launcherWorktreeAtom, (v) => !v)}
                                    className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 hover:bg-surface-hover"
                                >
                                    <span
                                        className={cn(
                                            "relative h-4 w-[26px] shrink-0 rounded-full transition-colors",
                                            worktreeOn ? "bg-accent" : "bg-edge-strong"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "absolute top-[3px] h-[10px] w-[10px] rounded-full bg-background transition-all",
                                                worktreeOn ? "left-[13px]" : "left-[3px]"
                                            )}
                                        />
                                    </span>
                                    <span className="whitespace-nowrap text-[11.5px] font-semibold text-ink-mid">
                                        Worktree
                                    </span>
                                </button>
                            ) : null}
                            <button
                                type="button"
                                tabIndex={0}
                                data-launcher-command-toggle
                                aria-expanded={commandOpen}
                                title="Show the command it runs"
                                onClick={() => setCommandOpen((v) => !v)}
                                className={cn(
                                    "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[11.5px] font-semibold",
                                    commandOpen
                                        ? "bg-surface-hover text-primary"
                                        : "text-ink-mid hover:bg-surface-hover hover:text-primary"
                                )}
                            >
                                <span>Command</span>
                                <ChevronRight
                                    size={11}
                                    strokeWidth={2.2}
                                    className={cn("transition-transform", commandOpen && "rotate-90")}
                                />
                            </button>
                        </div>
                    </div>
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
                            className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-[168px] overflow-y-auto rounded border border-edge-mid bg-modalbg py-1 shadow-popover"
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
            {home && runtime === "claude" ? (
                <span data-launcher-ask className="flex items-start gap-1.5 text-[11.5px] leading-normal text-muted">
                    <Lock size={12} strokeWidth={2} className="mt-[2px] shrink-0" />
                    <span>
                        Ask-only in Home: starts with{" "}
                        <span className="font-mono text-ink-mid">--settings {ASK_SETTINGS_ARG}</span>. No file edits,
                        every shell command asks first, secrets stay unreadable, and bypass and auto mode are off.
                    </span>
                </span>
            ) : null}
            {runtime === "terminal" ? (
                <span className="text-[11.5px] text-muted">
                    {home
                        ? "A plain shell in your home folder. A command typed above runs in it when it opens."
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
