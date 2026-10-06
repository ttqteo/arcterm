// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { composerReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, Plus, SquareTerminal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import {
    composeStartupCommand,
    deriveBranch,
    isRuntimeOffered,
    RUNTIME_FLAGS,
    runtimeLaunchLabel,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    worktreeOutcome,
    type Runtime,
} from "./launch";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { harnessPreferenceAtom, harnessesAtom, resolveDefaultRuntime } from "./harnessstore";
import { noteRecentProject, projectListAtom, recentFirst, recentProjectsAtom } from "./projectsstore";
import { RuntimeMark } from "./runtimemark";

const RUNTIMES: { id: Runtime; name: string }[] = [
    { id: "claude", name: "Claude Code" },
    { id: "codex", name: "Codex" },
    { id: "opencode", name: "OpenCode" },
    { id: "pi", name: "Pi" },
    { id: "terminal", name: "Terminal" },
];

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.1em] text-muted";

export function NewAgentModal({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(model.newAgentOpenAtom);
    const rows = useAtomValue(projectListAtom);
    const naFlags = useAtomValue(naFlagsAtom);
    const remember = useAtomValue(naRememberFlagsAtom);
    const recentProjects = useAtomValue(recentProjectsAtom);
    const harnesses = useAtomValue(harnessesAtom);
    const [runtime, setRuntime] = useState<Runtime>("claude");
    const [project, setProject] = useState<string>("");
    const [task, setTask] = useState("");
    const [taskOpen, setTaskOpen] = useState(false);
    const [startup, setStartup] = useState("claude");
    const [flagMenuOpen, setFlagMenuOpen] = useState(false);
    const [useWorktree, setUseWorktree] = useState(false);
    const [branch, setBranch] = useState("");
    const [branchEdited, setBranchEdited] = useState(false);
    const [currentBranch, setCurrentBranch] = useState("");
    const [branches, setBranches] = useState<BranchInfo[]>([]);
    const [branchListOpen, setBranchListOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reqIdRef = useRef(0);
    const launchingRef = useRef(false);
    const defaultAppliedRef = useRef(false);
    // Default the modal's runtime to the resolved harness preference on first open (Part A: Pi wins
    // for fresh installs / new sessions). Later opens keep whatever the user last picked in this modal.
    useEffect(() => {
        if (!open || defaultAppliedRef.current) {
            return;
        }
        defaultAppliedRef.current = true;
        const pref = globalStore.get(harnessPreferenceAtom).route?.runtime ?? "";
        const chosen = resolveDefaultRuntime(pref, globalStore.get(harnessesAtom));
        if (chosen) {
            setRuntime(chosen as Runtime);
            setStartup(runtimeStartupCommand(chosen as Runtime));
        }
    }, [open]);
    // the one project list, most recently used first so the last one is the default
    const candidates = useMemo(() => recentFirst(rows, recentProjects), [rows, recentProjects]);
    const offeredRuntimes = RUNTIMES.filter((r) => isRuntimeOffered(r.id, harnesses));
    const selectedProject = project || candidates[0]?.name || "";
    const selectedCandidate = candidates.find((c) => c.name === selectedProject);
    const selectedPath = selectedCandidate?.path ?? "";
    const branchNames = branches.map((b) => b.name);
    // The field shows the project's current branch until the user types/picks their own.
    const effectiveBranch = branchEdited ? branch : currentBranch;
    // Flags: the selected runtime's catalog and its enabled subset (shown as chips in the command
    // field). Flag state is scoped per runtime, so read/write only the selected runtime's subrecord.
    const flagCatalog = RUNTIME_FLAGS[runtime];
    const runtimeFlags = naFlags[runtime] ?? {};
    const enabledFlags = flagCatalog.filter((f) => runtimeFlags[f.id]);
    const setFlag = (id: string, on: boolean) =>
        globalStore.set(naFlagsAtom, (prev) => ({ ...prev, [runtime]: { ...prev[runtime], [id]: on } }));
    const wantsWorktree = useWorktree && runtimeSupportsWorktree(runtime);
    // git can't reuse the already-checked-out branch; branch a fresh one off it instead.
    const landingBranch = (chosen: string) =>
        chosen === currentBranch ? deriveBranch(currentBranch, branchNames) : chosen;
    const chosenBranch = effectiveBranch.trim();
    const footBranch = wantsWorktree
        ? chosenBranch && `worktree on ${landingBranch(chosenBranch)}`
        : currentBranch && `on ${currentBranch}`;
    const close = () => {
        globalStore.set(model.newAgentOpenAtom, false);
        setError(null);
        reqIdRef.current++;
    };
    // Pull the project's branches (recency-ordered) for the worktree-branch suggestions. Terminal
    // runtime and non-repo projects degrade to free-text (empty list).
    useEffect(() => {
        if (!open || runtime === "terminal" || !selectedPath) {
            setBranches([]);
            return;
        }
        let cancelled = false;
        RpcApi.ListBranchesCommand(TabRpcClient, { projectpath: selectedPath })
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
    }, [open, runtime, selectedPath]);
    // Current branch drives the worktree default + outcome hint; GitChanges returns it via rev-parse.
    useEffect(() => {
        if (!open || !selectedPath) {
            setCurrentBranch("");
            return;
        }
        let cancelled = false;
        RpcApi.GitChangesCommand(TabRpcClient, { cwd: selectedPath })
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
    }, [open, selectedPath]);
    // Switching projects re-defaults the branch field to the new project's current branch.
    useEffect(() => {
        setBranchEdited(false);
    }, [selectedPath]);
    useEffect(() => {
        reqIdRef.current++;
    }, [runtime, selectedProject]);
    const pickRuntime = (r: Runtime) => {
        setRuntime(r);
        setStartup(runtimeStartupCommand(r));
        setFlagMenuOpen(false);
    };
    const launch = async () => {
        // a held Enter on the focused Launch button repeats the click; one launch per open
        if (launchingRef.current) {
            return;
        }
        const c = candidates.find((p) => p.name === selectedProject);
        const path = c?.path ?? "";
        if (!c || !path) {
            setError("Couldn't find a folder for this project. Add it via + New project.");
            return;
        }
        let branchArg: string | undefined;
        if (wantsWorktree) {
            if (!chosenBranch) {
                setError("Enter a branch name or turn off the worktree option.");
                return;
            }
            branchArg = landingBranch(chosenBranch);
        }
        launchingRef.current = true;
        try {
            await launchAgent(model, {
                runtime,
                startupCommand: composeStartupCommand(startup, runtime, runtimeFlags),
                task: runtimeShowsTask(runtime) ? task : "",
                projectPath: path,
                projectName: c.name,
                branch: branchArg,
            });
            // "Remember" off: flags are single-use, cleared for the next agent.
            if (!globalStore.get(naRememberFlagsAtom)) {
                globalStore.set(naFlagsAtom, {});
            }
            noteRecentProject(c.name);
            setTask("");
            setTaskOpen(false);
            close();
        } catch (e) {
            setError(String(e));
        } finally {
            launchingRef.current = false;
        }
    };
    return (
        <ModalShell open={open} onClose={close} onSubmit={() => void launch()} className="flex flex-col w-[min(640px,93vw)] max-h-[86vh]" dismissOnBackdrop={false}>
            {open ? (
                <>
                <div className="flex shrink-0 items-center gap-[10px] border-b border-border py-[13px] pl-[18px] pr-3">
                    <h2 className="m-0 flex-1 text-[15px] font-semibold text-primary">New agent</h2>
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={close}
                        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary"
                    >
                        <X size={15} strokeWidth={2} />
                    </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <div className="grid shrink-0 grid-cols-[190px_minmax(0,1fr)] border-b border-border">
                        <div role="radiogroup" aria-label="Runtime" className="flex flex-col gap-px border-r border-border px-2 py-3">
                            <div className={cn(LABEL, "px-2 pb-[7px] pt-0.5")}>Runtime</div>
                            {offeredRuntimes.map((r) => {
                                const sel = runtime === r.id;
                                return (
                                    <button
                                        key={r.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={sel}
                                        onClick={() => pickRuntime(r.id)}
                                        className={cn(
                                            "flex cursor-pointer items-center gap-[9px] rounded-[7px] p-2 text-left",
                                            sel ? "bg-surface-selected" : "hover:bg-surface-hover"
                                        )}
                                    >
                                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                            {r.id === "terminal" ? (
                                                <SquareTerminal size={16} strokeWidth={1.8} className="text-ink-mid" />
                                            ) : (
                                                <RuntimeMark
                                                    runtime={r.id}
                                                    className="text-[12px] font-bold text-accent-soft"
                                                    imageClassName="h-4 w-4 rounded-[3px]"
                                                />
                                            )}
                                        </span>
                                        <span
                                            className={cn(
                                                "flex-1 text-[12.5px] font-semibold",
                                                sel ? "text-primary" : "text-muted-foreground"
                                            )}
                                        >
                                            {r.name}
                                        </span>
                                        {sel ? <Check size={14} strokeWidth={2.4} className="text-accent" /> : null}
                                    </button>
                                );
                            })}
                        </div>
                        <div role="radiogroup" aria-label="Project" className="flex min-w-0 flex-col gap-px px-2 py-3">
                            <div className="flex items-baseline gap-2 px-2 pb-[7px] pt-0.5">
                                <span className={cn(LABEL, "flex-1")}>Project</span>
                                {candidates.length > 1 ? (
                                    <span className="text-[10.5px] text-muted">last used first</span>
                                ) : null}
                            </div>
                            {candidates.length === 0 ? (
                                <div className="px-2 text-[12.5px] text-muted">
                                    No projects yet — add one from the project switcher (+ New project).
                                </div>
                            ) : (
                                <div className="flex max-h-[236px] flex-col gap-px overflow-y-auto">
                                    {candidates.map((p) => {
                                        const sel = selectedProject === p.name;
                                        return (
                                            <button
                                                key={p.name}
                                                type="button"
                                                role="radio"
                                                aria-checked={sel}
                                                onClick={() => setProject(p.name)}
                                                title={p.path}
                                                className={cn(
                                                    "flex cursor-pointer items-center gap-[10px] rounded-[7px] p-2 text-left",
                                                    sel ? "bg-surface-selected" : "hover:bg-surface-hover"
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        "min-w-0 flex-1 truncate text-[12.5px] font-semibold",
                                                        sel ? "text-primary" : "text-muted-foreground"
                                                    )}
                                                >
                                                    {p.name}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-[14px] px-[18px] pb-4 pt-[14px]">
                        <div>
                            <div className="mb-2 flex items-center gap-2">
                                <label htmlFor="na-cmd" className={cn(LABEL, "flex-1")}>
                                    Command
                                </label>
                                {flagCatalog.length > 0 ? (
                                    <label
                                        title="Reuse the enabled flags for every new agent"
                                        className="flex cursor-pointer items-center gap-[6px] text-[11.5px] text-muted"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={remember}
                                            onChange={() => globalStore.set(naRememberFlagsAtom, (v) => !v)}
                                            className="m-0 h-[13px] w-[13px] cursor-pointer accent-accent"
                                        />
                                        <span>Remember flags</span>
                                    </label>
                                ) : null}
                            </div>
                            <div className="flex min-h-[38px] flex-wrap items-center gap-[6px] rounded-[8px] border border-edge-mid bg-surface py-[5px] pl-3 pr-[6px] focus-within:border-accent-700">
                                <span className="font-mono text-[12.5px] font-semibold text-success">›</span>
                                <input
                                    id="na-cmd"
                                    value={startup}
                                    onChange={(e) => setStartup(e.target.value)}
                                    placeholder={runtime === "terminal" ? "default shell" : runtimeStartupCommand(runtime)}
                                    style={{ width: `${Math.max(startup.length + 1, runtime === "terminal" && !startup ? 14 : 4)}ch` }}
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
                                        onClick={() => setFlagMenuOpen((v) => !v)}
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
                                        className="mt-[6px] flex flex-col overflow-hidden rounded-[10px] border border-edge-mid bg-surface p-1"
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
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        {runtimeSupportsWorktree(runtime) ? (
                            <div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={useWorktree}
                                    onClick={() => setUseWorktree((v) => !v)}
                                    className="flex cursor-pointer items-center gap-[10px]"
                                >
                                    <span
                                        className={cn(
                                            "relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors",
                                            useWorktree ? "bg-accent" : "bg-edge-strong"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "absolute top-[3px] h-[14px] w-[14px] rounded-full bg-background transition-all",
                                                useWorktree ? "left-[18px]" : "left-[2px]"
                                            )}
                                        />
                                    </span>
                                    <span className="text-[12.5px] font-medium text-secondary">
                                        Run in an isolated git worktree
                                    </span>
                                </button>
                                {useWorktree ? (
                                    <div className="relative mt-[11px] pl-[44px]">
                                        <div className="flex items-center rounded-[8px] border border-edge-mid bg-surface focus-within:border-accent-700">
                                            <input
                                                aria-label="Branch"
                                                value={effectiveBranch}
                                                onChange={(e) => {
                                                    setBranch(e.target.value);
                                                    setBranchEdited(true);
                                                }}
                                                onFocus={() => setBranchListOpen(true)}
                                                placeholder={currentBranch || "feat/new-agent"}
                                                className="flex-1 bg-transparent px-3 py-2 text-[12.5px] text-secondary outline-none"
                                            />
                                            {branches.length > 0 ? (
                                                <button
                                                    type="button"
                                                    aria-label="Show branches"
                                                    onClick={() => setBranchListOpen((v) => !v)}
                                                    className="cursor-pointer px-3 py-2 text-[10px] text-muted hover:text-primary"
                                                >
                                                    ▾
                                                </button>
                                            ) : null}
                                        </div>
                                        <PopoverReveal
                                            open={branchListOpen && branches.length > 0}
                                            origin="bottom left"
                                            className="absolute bottom-full left-[44px] right-0 z-10 mb-1 max-h-[168px] overflow-y-auto rounded border border-edge-mid bg-modalbg py-1 shadow-popover"
                                        >
                                            {branches.map((b) => (
                                                <button
                                                    key={b.name}
                                                    type="button"
                                                    onClick={() => {
                                                        setBranch(b.name);
                                                        setBranchEdited(true);
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
                                        <div className="mt-[7px] text-[11.5px] text-muted">
                                            {worktreeOutcome({ branch: effectiveBranch, currentBranch, branchNames })}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                        {runtimeShowsTask(runtime) ? (
                            taskOpen ? (
                                <textarea
                                    aria-label="Task"
                                    autoFocus
                                    value={task}
                                    onChange={(e) => setTask(e.target.value)}
                                    placeholder="Sent as the first prompt…"
                                    className="block h-[72px] w-full resize-none rounded-[10px] border border-edge-mid bg-surface px-3 py-[10px] text-[13px] leading-normal text-primary outline-none focus:border-accent-700"
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setTaskOpen(true)}
                                    className="flex cursor-pointer items-center gap-[6px] self-start text-[12px] font-semibold text-ink-mid hover:text-primary"
                                >
                                    <Plus size={12} strokeWidth={2.2} />
                                    <span>Start with a task</span>
                                </button>
                            )
                        ) : null}
                        {error ? <div className="text-[12px] text-error">{error}</div> : null}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 border-t border-border px-[18px] py-[13px]">
                    <div title={selectedPath || undefined} className="min-w-0 flex-1 truncate text-[12px] text-muted">
                        Starts in <span className="text-[11px] text-ink-hi">{selectedPath || "—"}</span>
                        {footBranch ? ` · ${footBranch}` : null}
                    </div>
                    <DialogButton variant="secondary" hint="esc" onClick={close}>
                        Cancel
                    </DialogButton>
                    {/* focused on open, so a plain Enter launches with the defaults */}
                    <DialogButton
                        variant="primary"
                        autoFocus
                        hint={formatChordString("Cmd:Enter")}
                        onClick={() => void launch()}
                        className="focus:outline-2 focus:outline-offset-2 focus:outline-accent-300"
                    >
                        {runtimeLaunchLabel(runtime)}
                    </DialogButton>
                </div>
                </>
            ) : null}
        </ModalShell>
    );
}
