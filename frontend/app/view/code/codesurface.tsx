// frontend/app/view/code/codesurface.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Code surface: read any file in a registered git project. Read-only, and deliberately unconnected
// to agents and runs — this answers "what does this code look like", not "what changed".

import { PopoverReveal } from "@/app/element/popoverreveal";
import { SkeletonLine } from "@/app/element/skeleton";
import { useSyncMonacoTheme } from "@/app/monaco/monacotheme";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { buildCodeBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { DivergenceBanner } from "@/app/view/agents/divergencebanner";
import { subjectDecision } from "@/app/view/agents/focussubject";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { SurfaceEmptyState, SurfaceError, SurfaceHeader } from "@/app/view/agents/surfacescaffold";
import { formatChordString } from "@/util/keysym";
import { sameRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import {
    ArrowRight,
    ChevronDown,
    FilePlus,
    FolderGit2,
    FolderPlus,
    FolderTree,
    GitCompareArrows,
    RotateCw,
    Save,
    Search,
    Undo2,
} from "lucide-react";
import { useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CodeChangedPane } from "./codechangedpane";
import { canBack, canForward } from "./codehistory";
import { CodePathBar } from "./codepathbar";
import { pickerRecents } from "./coderecents";
import { CodeSearchPane } from "./codesearchpane";
import { codeSearchModeAtom } from "./codesearchstore";
import {
    CODE_SIDEBAR_COMPACT_WIDTH,
    CODE_SIDEBAR_DEFAULT_WIDTHS,
    CODE_SIDEBAR_MIN_WIDTH,
    codeSidebarDragEndWidth,
    codeSidebarDragWidthForWorkspace,
    codeSidebarMaxWidth,
    codeSidebarPrefsJson,
    codeSidebarVisibility,
    codeSidebarWidthAfterPointer,
    codeSidebarWidthFor,
    nextCodeSidebarWidth,
    parseCodeSidebarPrefs,
    type CodeSidebarMode,
    type CodeSidebarPrefs,
} from "./codesidebar";
import { CodeStaleBar } from "./codestalebar";
import {
    canRestoreProject,
    checkStale,
    codeBodyPhase,
    codeDraftsAtom,
    codeFileAtom,
    codeHistoryAtom,
    codeIndexAtom,
    codeIndexErrorAtom,
    codeMutateErrorAtom,
    codePickerErrorAtom,
    codeProjectAtom,
    codeRecentsAtom,
    codeSaveAtom,
    codeWorktreesAtom,
    draftKey,
    goBack,
    goForward,
    lastCodeProjectAtom,
    openPickedPath,
    refreshIndex,
    registeredProjects,
    reloadFromDisk,
    revalidateIndex,
    revertDraft,
    saveCurrent,
    selectPath,
    selectProject,
    startCreate,
    type CodeProject,
} from "./codestore";
import { CodeTreePane } from "./codetreepane";
import { CodeViewer } from "./codeviewer";

export function CodeSurface({ model }: { model: AgentsViewModel }) {
    const registry = useAtomValue(projectsAtom);
    const project = useAtomValue(codeProjectAtom);
    const stored = useAtomValue(lastCodeProjectAtom);
    const index = useAtomValue(codeIndexAtom);
    const indexError = useAtomValue(codeIndexErrorAtom);
    const history = useAtomValue(codeHistoryAtom);
    const hasFocus = useAtomValue(atoms.documentHasFocus);
    const mutateError = useAtomValue(codeMutateErrorAtom);
    const worktrees = useAtomValue(codeWorktreesAtom);
    const recents = useAtomValue(codeRecentsAtom);
    const pickerError = useAtomValue(codePickerErrorAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [typedPath, setTypedPath] = useState("");

    // Code declares "subject" project posture. Compared by project NAME, not path: handoffProjectName
    // already establishes the registry name as the identity Code matches agents by, and a worktree's
    // path differs from its repo path while naming the same project.
    const decision = subjectDecision(project?.name ?? null, filter === "all" ? null : filter);

    // stable array: every run() reads live atoms, so it never needs rebuilding
    const codeBindings = useMemo(() => buildCodeBindings(), []);
    useKeybindings(codeBindings);
    useSyncMonacoTheme();

    const projects: CodeProject[] = registeredProjects(registry);
    // a lone main checkout would only repeat the selection
    const otherCheckouts = worktrees.length > 1 ? worktrees : [];
    const shownRecents = pickerRecents(recents, [
        ...projects.map((p) => p.path),
        ...otherCheckouts.map((wt) => wt.path),
    ]);
    const pick = (select: () => Promise<void>) => {
        setPickerOpen(false);
        fireAndForget(select);
    };
    const togglePicker = (open: boolean) => {
        globalStore.set(codePickerErrorAtom, null);
        setPickerOpen(open);
    };
    // unlike a listed project, a path can be refused, and the picker stays open to say why
    const openPicked = (path: string) =>
        fireAndForget(async () => {
            if (await openPickedPath(path)) {
                setPickerOpen(false);
                setTypedPath("");
            }
        });

    // the index survives an unmount in a module atom, but a project picked before this surface ever
    // loaded (or a cache cleared elsewhere) leaves the atom null — reload on mount when that happens.
    // A fresh launch starts with nothing selected at all; restore the last browsed project, but only
    // while the registry still knows it — a renamed or removed project must not silently reopen.
    useEffect(() => {
        if (project != null) {
            if (index == null && indexError == null) {
                fireAndForget(() => selectProject(project));
            }
            return;
        }
        if (stored != null && canRestoreProject(stored, registry)) {
            fireAndForget(() => selectProject(stored));
            return;
        }
        // Persisted pick → app-bar project → nothing. The persisted value keeps winning, which is the
        // whole point of keeping it; the seed only covers a first-ever visit, which used to land on an
        // empty picker while the rest of the cockpit was already on a project.
        if (decision.kind === "seed") {
            const seed = registeredProjects(registry).find((p) => p.name === decision.target);
            if (seed != null) {
                fireAndForget(() => selectProject(seed));
            }
        }
    }, [project, index, indexError, stored, registry, filter]);

    // the case that actually bites: an agent wrote while you were looking at another window
    useEffect(() => {
        if (hasFocus) {
            fireAndForget(checkStale);
        }
    }, [hasFocus]);

    // Every surface but Agent unmounts on nav switch, so a mount here means "switched back to Code":
    // re-read the file list and git status. A cold mount has nothing to revalidate — the effect above
    // is already loading it — and the open file is covered by the focus check above.
    useEffect(() => {
        if (globalStore.get(codeIndexAtom) != null) {
            fireAndForget(revalidateIndex);
        }
    }, []);

    return (
        <div className="relative flex h-full w-full flex-col">
            <SurfaceHeader
                compact
                title="Code"
                // the project's name is on the picker beside it; the path is what the row adds
                subtitle={project != null ? <span title={project.path}>{project.path}</span> : "No project selected"}
                actions={
                    <>
                        <div className="relative">
                            <button
                                type="button"
                                data-code-project-picker
                                onClick={() => togglePicker(!pickerOpen)}
                                className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-border bg-surface px-2.5 py-1 text-[12px] text-secondary hover:text-primary"
                            >
                                <FolderGit2 size={13} strokeWidth={1.8} />
                                <span>{project?.name ?? "Pick a project"}</span>
                                <ChevronDown size={13} strokeWidth={1.8} />
                            </button>
                            <PopoverReveal
                                open={pickerOpen}
                                origin="top right"
                                className="absolute right-0 top-[calc(100%+6px)] z-20 max-h-[70vh] min-w-[240px] overflow-y-auto rounded-[10px] border border-border bg-surface shadow-lg"
                            >
                                <PickerHeading first>Projects</PickerHeading>
                                {projects.length === 0 ? (
                                    <div className="px-3 py-2 text-[12px] text-muted">No registered projects</div>
                                ) : (
                                    projects.map((p) => (
                                        <PickerRow
                                            key={p.name}
                                            label={p.name}
                                            detail={p.path}
                                            current={p.path === project?.path}
                                            onClick={() => pick(() => selectProject(p))}
                                        />
                                    ))
                                )}
                                {otherCheckouts.length > 0 ? (
                                    <div data-code-picker-section="worktrees">
                                        <PickerHeading>Worktrees</PickerHeading>
                                        {otherCheckouts.map((wt) => (
                                            <PickerRow
                                                key={wt.path}
                                                label={wt.branch || "detached HEAD"}
                                                detail={wt.path}
                                                current={sameRepoPath(wt.path, project?.path ?? "")}
                                                onClick={() => pick(() => selectPath(wt.path))}
                                            />
                                        ))}
                                    </div>
                                ) : null}
                                {shownRecents.length > 0 ? (
                                    <div data-code-picker-section="recent">
                                        <PickerHeading>Recent</PickerHeading>
                                        {shownRecents.map((r) => (
                                            <PickerRow
                                                key={r.path}
                                                label={r.name}
                                                detail={r.path}
                                                current={sameRepoPath(r.path, project?.path ?? "")}
                                                onClick={() => openPicked(r.path)}
                                            />
                                        ))}
                                    </div>
                                ) : null}
                                <form
                                    data-code-picker-path
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        openPicked(typedPath);
                                    }}
                                    className="flex flex-col gap-1 border-t border-border p-2"
                                >
                                    <div className="flex items-center gap-1">
                                        <input
                                            value={typedPath}
                                            placeholder="Path to a directory"
                                            aria-label="Directory path"
                                            aria-invalid={pickerError != null}
                                            onChange={(e) => {
                                                setTypedPath(e.target.value);
                                                globalStore.set(codePickerErrorAtom, null);
                                            }}
                                            className={cn(
                                                "w-full rounded-[8px] border bg-surface px-2 py-1 text-[12px] text-primary outline-none placeholder:text-muted",
                                                pickerError != null ? "border-error" : "border-border"
                                            )}
                                        />
                                        <button
                                            type="submit"
                                            title="Open directory"
                                            aria-label="Open directory"
                                            className="flex flex-none cursor-pointer items-center rounded-[8px] border border-border px-1.5 py-1 text-secondary hover:text-primary"
                                        >
                                            <ArrowRight size={13} strokeWidth={1.8} />
                                        </button>
                                    </div>
                                    {pickerError != null ? (
                                        <div role="alert" className="text-[11.5px] text-error">
                                            {pickerError}
                                        </div>
                                    ) : null}
                                </form>
                            </PopoverReveal>
                        </div>
                        <SaveControls />
                        {/* the affordance for an empty or unfocused tree, where there is no row to
                            right-click */}
                        <HeaderButton label="New file (n)" onClick={() => startCreate(false)}>
                            <FilePlus size={13} strokeWidth={1.8} />
                        </HeaderButton>
                        <HeaderButton label="New folder (Shift+N)" onClick={() => startCreate(true)}>
                            <FolderPlus size={13} strokeWidth={1.8} />
                        </HeaderButton>
                        <HeaderButton label="Refresh index" onClick={() => fireAndForget(refreshIndex)}>
                            <RotateCw size={13} strokeWidth={1.8} />
                        </HeaderButton>
                        <HeaderButton label="Back" disabled={!canBack(history)} onClick={() => fireAndForget(goBack)}>
                            ←
                        </HeaderButton>
                        <HeaderButton
                            label="Forward"
                            disabled={!canForward(history)}
                            onClick={() => fireAndForget(goForward)}
                        >
                            →
                        </HeaderButton>
                    </>
                }
            />
            {indexError != null ? (
                <SurfaceError
                    message={`Could not list files: ${indexError}`}
                    onRetry={() => fireAndForget(refreshIndex)}
                />
            ) : null}
            {mutateError != null ? (
                <SurfaceError
                    message={mutateError}
                    actionLabel="Dismiss"
                    onRetry={() => globalStore.set(codeMutateErrorAtom, null)}
                />
            ) : null}
            <SaveBanner />
            {/* Not in CodePathBar (which the plan named): that bar early-returns with no open file, so
                the banner would be invisible on exactly the freshly-switched project that diverged. */}
            <DivergenceBanner
                decision={decision}
                onRejoin={() => {
                    const target = registeredProjects(registry).find((p) => p.name === filter);
                    if (target != null) {
                        fireAndForget(() => selectProject(target));
                    }
                }}
            />
            <div className="min-h-0 flex-1">
                <CodeBody model={model} onPickProject={() => togglePicker(true)} />
            </div>
        </div>
    );
}

function PickerHeading({ first, children }: { first?: boolean; children: React.ReactNode }) {
    return (
        <div className={cn("px-3 pb-1 pt-2 text-[10.5px] text-muted", !first && "border-t border-border")}>
            {children}
        </div>
    );
}

function PickerRow({
    label,
    detail,
    current,
    onClick,
}: {
    label: string;
    detail: string;
    current: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            data-code-picker-row={label}
            onClick={onClick}
            className={cn(
                "flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent/10",
                current && "bg-accent/10"
            )}
        >
            <span className="text-[12.5px] text-primary">{label}</span>
            <span className="text-[10.5px] text-muted">{detail}</span>
        </button>
    );
}

function HeaderButton({
    label,
    onClick,
    disabled,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[8px] border border-border bg-surface text-[12px] text-secondary hover:text-primary disabled:cursor-default disabled:opacity-40"
        >
            {children}
        </button>
    );
}

function useDirty(): boolean {
    const project = useAtomValue(codeProjectAtom);
    const file = useAtomValue(codeFileAtom);
    const drafts = useAtomValue(codeDraftsAtom);
    if (project == null || file.kind !== "text") {
        return false;
    }
    return drafts.has(draftKey(project, file.path));
}

function SaveControls() {
    const dirty = useDirty();
    const save = useAtomValue(codeSaveAtom);

    // the only steady-state feedback that a write landed; the banner is for the failures
    const status =
        save.kind === "saving" ? "Saving…" : save.kind === "saved" && !dirty ? "Saved" : dirty ? "Unsaved" : null;

    return (
        <>
            {status != null ? (
                <span className={cn("text-[11.5px]", dirty ? "text-accent-soft" : "text-muted")}>{status}</span>
            ) : null}
            <HeaderButton
                label="Save (Ctrl+S)"
                disabled={!dirty || save.kind === "saving"}
                onClick={() => fireAndForget(saveCurrent)}
            >
                <Save size={13} strokeWidth={1.8} />
            </HeaderButton>
            <HeaderButton label="Discard unsaved edits" disabled={!dirty} onClick={revertDraft}>
                <Undo2 size={13} strokeWidth={1.8} />
            </HeaderButton>
        </>
    );
}

// A refused save and a failed save are different things and say so. Both keep the draft: the button
// reloads from disk, which is the one action that throws typed text away, so it is never automatic.
function SaveBanner() {
    const save = useAtomValue(codeSaveAtom);
    if (save.kind === "conflict") {
        return (
            <SurfaceError
                message={`${save.path}: ${save.message}`}
                actionLabel="Reload from disk"
                onRetry={() => fireAndForget(reloadFromDisk)}
            />
        );
    }
    if (save.kind === "error") {
        return (
            <SurfaceError
                message={`Could not save ${save.path}: ${save.message}`}
                onRetry={() => fireAndForget(saveCurrent)}
            />
        );
    }
    return null;
}

function CodeBody({ model, onPickProject }: { model: AgentsViewModel; onPickProject: () => void }) {
    const registry = useAtomValue(projectsAtom);
    const project = useAtomValue(codeProjectAtom);
    const index = useAtomValue(codeIndexAtom);
    const indexError = useAtomValue(codeIndexErrorAtom);
    const stored = useAtomValue(lastCodeProjectAtom);

    switch (codeBodyPhase({ registry, project, stored, index, indexError })) {
        case "no-projects":
            return (
                <SurfaceEmptyState
                    title="No registered projects"
                    body="Register a project in Settings to browse its source here."
                />
            );
        case "no-project":
            return (
                <SurfaceEmptyState
                    title="No project selected"
                    body="Pick a project to browse its files."
                    action={{ label: "Pick a project", onClick: onPickProject }}
                />
            );
        case "error":
            return null; // the banner above already says it, and a second message would double up
        case "loading":
            return <CodePanesSkeleton />;
        case "not-repo":
            return <SurfaceEmptyState title="Not a git repository" body={project.path} />;
        case "ready":
            return <CodePanes model={model} />;
    }
}

// the file tree at its default width beside the editor, so the listing lands where the skeleton was
function CodePanesSkeleton() {
    return (
        <div aria-hidden="true" className="flex h-full">
            <div
                className="flex shrink-0 flex-col gap-2 border-r border-border px-3 pt-3"
                style={{ width: CODE_SIDEBAR_DEFAULT_WIDTHS.files }}
            >
                {["w-[70%]", "w-[55%]", "w-[80%]", "w-[45%]", "w-[65%]", "w-[50%]"].map((w, i) => (
                    <SkeletonLine key={i} className={cn("h-[11px]", w)} />
                ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-5">
                {["w-[60%]", "w-[85%]", "w-[75%]", "w-[40%]", "w-[90%]", "w-[70%]"].map((w, i) => (
                    <SkeletonLine key={i} className={cn("h-[11px]", w)} />
                ))}
            </div>
        </div>
    );
}

const CODE_SIDEBAR_PREFS_KEY = "code.sidebar.prefs";
const CODE_SIDEBAR_MODES: readonly CodeSidebarMode[] = ["files", "search", "changed"];
// icon tabs: the label is the accessible name and the tooltip, with the mode's binding (bindings.ts
// code:focus-tree, code:search) when it has one. Chords are formatted at render: the platform glyphs
// are not known at module load (keysym.ts).
const CODE_SIDEBAR_TABS: Record<CodeSidebarMode, { label: string; chord?: string; icon: React.ReactNode }> = {
    files: { label: "Files", chord: "Alt:t", icon: <FolderTree size={14} strokeWidth={1.8} /> },
    search: { label: "Search", chord: "Ctrl:Shift:f", icon: <Search size={14} strokeWidth={1.8} /> },
    changed: { label: "Changed files", icon: <GitCompareArrows size={14} strokeWidth={1.8} /> },
};

function codeSidebarTabTitle(m: CodeSidebarMode): string {
    const { label, chord } = CODE_SIDEBAR_TABS[m];
    return chord ? `${label} (${formatChordString(chord)})` : label;
}

function isCodeEditorFocused(element: Element | null): boolean {
    return (
        element instanceof HTMLElement &&
        (element.closest(".monaco-editor") != null || element.matches(".native-edit-context, textarea.inputarea"))
    );
}

function readCodeSidebarPrefs(): CodeSidebarPrefs {
    try {
        return parseCodeSidebarPrefs(window.localStorage.getItem(CODE_SIDEBAR_PREFS_KEY));
    } catch {
        return parseCodeSidebarPrefs(null);
    }
}

function CodePanes({ model }: { model: AgentsViewModel }) {
    const [mode, setMode] = useAtom(codeSearchModeAtom);
    const [prefs, setPrefs] = useState(readCodeSidebarPrefs);
    const [workspaceWidth, setWorkspaceWidth] = useState(0);
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const workspaceRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLElement>(null);
    const gripRef = useRef<HTMLDivElement>(null);
    const collapseRef = useRef<HTMLButtonElement>(null);
    const openerRef = useRef<HTMLButtonElement>(null);
    const dragRef = useRef<{
        pointerId: number;
        mode: CodeSidebarMode;
        startX: number;
        startWidth: number;
        width: number;
    } | null>(null);
    const wasCompactRef = useRef(false);
    const restoreFocusRef = useRef(false);
    const focusBeforeVisibilityRef = useRef<HTMLElement | null>(null);
    const visibility = codeSidebarVisibility(workspaceWidth, prefs.open);
    const compact = visibility.compact;
    const width =
        dragWidth == null
            ? codeSidebarWidthFor(mode, prefs.widths, workspaceWidth)
            : codeSidebarDragWidthForWorkspace(dragWidth, workspaceWidth);

    useEffect(() => {
        const workspace = workspaceRef.current;
        if (workspace == null) {
            return;
        }
        const measure = () => setWorkspaceWidth(workspace.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(workspace);
        return () => observer.disconnect();
    }, []);

    // Capture ownership before React applies the hidden classes. Once a focused control is hidden,
    // the browser can move focus to the document before a passive effect gets to inspect it.
    useInsertionEffect(() => {
        const active = document.activeElement;
        if (compact) {
            const sidebar = sidebarRef.current;
            focusBeforeVisibilityRef.current =
                active instanceof HTMLElement && (sidebar?.contains(active) || active === gripRef.current)
                    ? active
                    : null;
        } else if (wasCompactRef.current && active === openerRef.current) {
            restoreFocusRef.current = true;
        }
    }, [compact]);

    useLayoutEffect(() => {
        if (compact) {
            const ownedElement = focusBeforeVisibilityRef.current;
            focusBeforeVisibilityRef.current = null;
            if (ownedElement != null && !isCodeEditorFocused(document.activeElement)) {
                restoreFocusRef.current = true;
                openerRef.current?.focus();
            }
        } else if (wasCompactRef.current) {
            const shouldRestoreFocus = restoreFocusRef.current;
            restoreFocusRef.current = false;
            if (shouldRestoreFocus && !isCodeEditorFocused(document.activeElement)) {
                collapseRef.current?.focus();
            }
        }
        wasCompactRef.current = compact;
    }, [compact]);

    useEffect(() => {
        const drag = dragRef.current;
        if (drag == null) {
            return;
        }
        const nextWidth = codeSidebarDragWidthForWorkspace(drag.width, workspaceWidth);
        drag.width = nextWidth;
        setDragWidth(nextWidth);
    }, [workspaceWidth]);

    const persist = (next: CodeSidebarPrefs) => {
        setPrefs(next);
        try {
            window.localStorage.setItem(CODE_SIDEBAR_PREFS_KEY, codeSidebarPrefsJson(next));
        } catch {
            // localStorage can be unavailable in a restricted webview; the session state still works.
        }
    };

    const focusAfterRender = (ref: React.RefObject<HTMLElement>) => {
        window.requestAnimationFrame(() => ref.current?.focus());
    };

    const setOpen = (open: boolean) => {
        restoreFocusRef.current = false;
        persist({ ...prefs, open });
        focusAfterRender(open ? collapseRef : openerRef);
    };

    const endDrag = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
        const drag = dragRef.current;
        if (drag == null || drag.pointerId !== event.pointerId) {
            return;
        }
        dragRef.current = null;
        setDragWidth(null);
        if (gripRef.current?.hasPointerCapture(event.pointerId)) {
            gripRef.current.releasePointerCapture(event.pointerId);
        }
        const completedWidth = codeSidebarDragEndWidth(drag.width, workspaceWidth, commit);
        if (completedWidth != null) {
            persist({ ...prefs, widths: { ...prefs.widths, [drag.mode]: completedWidth } });
        }
    };

    const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => endDrag(event, true);
    const cancelDrag = (event: React.PointerEvent<HTMLDivElement>) => endDrag(event, false);

    const onGripKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End")
        ) {
            return;
        }
        event.preventDefault();
        const nextWidth = nextCodeSidebarWidth(
            codeSidebarWidthFor(mode, prefs.widths, workspaceWidth),
            event.key,
            event.shiftKey,
            codeSidebarMaxWidth(workspaceWidth)
        );
        persist({ ...prefs, widths: { ...prefs.widths, [mode]: nextWidth } });
    };

    const onGripPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (compact || gripRef.current == null) {
            return;
        }
        const startWidth = codeSidebarWidthFor(mode, prefs.widths, workspaceWidth);
        dragRef.current = {
            pointerId: event.pointerId,
            mode,
            startX: event.clientX,
            startWidth,
            width: startWidth,
        };
        gripRef.current.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const onGripPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag == null || drag.pointerId !== event.pointerId) {
            return;
        }
        const nextWidth = codeSidebarWidthAfterPointer(
            drag.startWidth,
            event.clientX - drag.startX,
            codeSidebarMaxWidth(workspaceWidth)
        );
        drag.width = nextWidth;
        setDragWidth(nextWidth);
    };

    return (
        <div ref={workspaceRef} className="flex h-full w-full">
            <aside
                ref={sidebarRef}
                aria-label="Code sidebar"
                className="flex flex-none flex-col overflow-hidden bg-surface"
                style={{ width: compact ? CODE_SIDEBAR_COMPACT_WIDTH : width }}
            >
                <div
                    className={cn(
                        "flex flex-none items-center gap-1 border-b border-border px-2 py-1",
                        compact && "hidden"
                    )}
                >
                    <div className="flex min-w-0 flex-1 gap-1">
                        {CODE_SIDEBAR_MODES.map((m) => (
                            <button
                                key={m}
                                type="button"
                                aria-pressed={m === mode}
                                data-code-column-tab={m}
                                onClick={() => {
                                    setDragWidth(null);
                                    setMode(m);
                                }}
                                aria-label={CODE_SIDEBAR_TABS[m].label}
                                title={codeSidebarTabTitle(m)}
                                className={cn(
                                    "flex size-6 cursor-pointer items-center justify-center rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                                    m === mode
                                        ? "bg-accent/10 text-accent-soft"
                                        : "text-muted hover:bg-surface-hover hover:text-primary"
                                )}
                            >
                                {CODE_SIDEBAR_TABS[m].icon}
                            </button>
                        ))}
                    </div>
                    <button
                        ref={collapseRef}
                        type="button"
                        aria-label="Collapse Code sidebar"
                        title="Collapse Code sidebar"
                        onClick={() => setOpen(false)}
                        className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-[6px] text-[14px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    >
                        ‹
                    </button>
                </div>
                <div className={cn("min-h-0 flex-1", compact && "hidden")}>
                    {mode === "files" ? (
                        <CodeTreePane model={model} />
                    ) : mode === "search" ? (
                        <CodeSearchPane model={model} />
                    ) : (
                        <CodeChangedPane model={model} />
                    )}
                </div>
                <button
                    ref={openerRef}
                    type="button"
                    aria-label={
                        visibility.temporary ? "Expand Code sidebar when window is wider" : "Expand Code sidebar"
                    }
                    aria-expanded={!compact}
                    title={visibility.temporary ? "Widen window to expand Code sidebar" : "Expand Code sidebar"}
                    onClick={() => {
                        if (visibility.temporary) {
                            if (!prefs.open) {
                                persist({ ...prefs, open: true });
                            }
                            return;
                        }
                        setOpen(true);
                    }}
                    className={cn(
                        "flex size-9 flex-none cursor-pointer items-center justify-center self-start rounded-[6px] text-[14px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                        !compact && "hidden"
                    )}
                >
                    ›
                </button>
            </aside>
            <div
                ref={gripRef}
                role="separator"
                tabIndex={compact ? -1 : 0}
                aria-orientation="vertical"
                aria-label="Resize Code sidebar"
                aria-valuemin={CODE_SIDEBAR_MIN_WIDTH}
                aria-valuemax={codeSidebarMaxWidth(workspaceWidth)}
                aria-valuenow={Math.round(width)}
                onKeyDown={onGripKeyDown}
                onPointerDown={onGripPointerDown}
                onPointerMove={onGripPointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
                className={cn(
                    "group relative z-10 flex w-2 flex-none cursor-col-resize items-center justify-center bg-transparent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    compact && "hidden"
                )}
            >
                <span className="h-full w-px bg-edge-mid group-hover:bg-accent group-focus-visible:bg-accent" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
                <CodePathBar />
                <CodeStaleBar />
                <div className="min-h-0 flex-1">
                    <CodeViewer model={model} />
                </div>
            </div>
        </div>
    );
}
