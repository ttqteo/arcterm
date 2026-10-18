// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// New project: pick one of the projects Claude Code already has sessions in, or once you type, a project folder
// found on disk near them, or, as the fallback, name a folder by hand (path field + the native picker). The list
// comes from wavesrv's ScanClaudeProjects each time the modal opens and the disk search (FindProjectFolders) runs
// on the first typed character; the rules for what they show are in newprojectmodel.ts.

import { FileIcon } from "@/app/element/fileicon";
import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo } from "./agentsviewmodel";
import { filterProjects, moveCursor, onDiskProjects, uniqueProjectName, unregisteredProjects } from "./newprojectmodel";
import { projectListAtom, registerProject } from "./projectsstore";

type Mode = "scan" | "manual";

const LABEL = "mb-[9px] text-[10px] font-semibold uppercase tracking-[0.1em] text-muted";
const FIELD =
    "w-full rounded border border-edge-mid bg-surface px-[13px] py-2.5 text-primary outline-none focus:border-accent-700";

export function NewProjectModal({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(model.newProjectOpenAtom);
    const rows = useAtomValue(projectListAtom);
    const [mode, setMode] = useState<Mode>("scan");
    // null while the scan runs
    const [scanned, setScanned] = useState<ClaudeProjectData[] | null>(null);
    // the scan failed (an older backend without the command), which an empty list must not pass for
    const [scanFailed, setScanFailed] = useState(false);
    // the disk search, asked once per opening on the first typed character: null until it answers
    const [onDisk, setOnDisk] = useState<ProjectFolderData[] | null>(null);
    const diskAsked = useRef(false);
    // which opening an answer belongs to, so one that lands after a close and reopen is dropped
    const openGen = useRef(0);
    const [query, setQuery] = useState("");
    const [cursor, setCursor] = useState(0);
    const [name, setName] = useState("");
    const [path, setPath] = useState("");
    const [error, setError] = useState<string | null>(null);
    const rowRefs = useRef(new Map<string, HTMLDivElement>());

    useEffect(() => {
        if (!open) {
            return;
        }
        let live = true;
        openGen.current++;
        setScanned(null);
        setScanFailed(false);
        setOnDisk(null);
        diskAsked.current = false;
        RpcApi.ScanClaudeProjectsCommand(TabRpcClient)
            .then((rtn) => live && setScanned(rtn.projects ?? []))
            .catch(() => {
                if (live) {
                    setScanned([]);
                    setScanFailed(true);
                }
            });
        return () => {
            live = false;
        };
    }, [open]);

    const typed = query.trim() !== "";
    useEffect(() => {
        if (!open || !typed || scanned == null || diskAsked.current) {
            return;
        }
        diskAsked.current = true;
        const gen = openGen.current;
        const near = [...scanned.map((p) => p.path), ...rows.map((r) => r.path)];
        RpcApi.FindProjectFoldersCommand(TabRpcClient, { near })
            .then((rtn) => gen === openGen.current && setOnDisk(rtn.folders ?? []))
            .catch(() => gen === openGen.current && setOnDisk([]));
    }, [open, typed, scanned, rows]);

    const candidates = filterProjects(unregisteredProjects(scanned ?? [], rows), query);
    const diskRows = onDiskProjects(onDisk ?? [], scanned ?? [], rows, query);
    // one cursor runs down both sections: the Claude Code rows, then the disk ones
    const options: { name: string; path: string }[] = [...candidates, ...diskRows];
    const picked = mode === "scan" ? options[cursor] : undefined;
    const pickedName = picked
        ? uniqueProjectName(
              picked.name,
              rows.map((r) => r.name)
          )
        : "";

    useEffect(() => {
        if (picked) {
            rowRefs.current.get(picked.path)?.scrollIntoView({ block: "nearest" });
        }
    }, [picked?.path]);

    const close = () => {
        globalStore.set(model.newProjectOpenAtom, false);
        setMode("scan");
        setQuery("");
        setCursor(0);
        setName("");
        setPath("");
        setError(null);
    };
    const canCreate = mode === "scan" ? picked != null : name.trim().length > 0 && path.trim().length > 0;
    const create = async () => {
        if (!canCreate) {
            return;
        }
        const [n, p] = mode === "scan" ? [pickedName, picked!.path] : [name.trim(), path.trim()];
        try {
            await registerProject(n, p);
            globalStore.set(model.projectFilterAtom, n);
            close();
        } catch (e) {
            setError(String(e));
        }
    };
    // Native OS folder picker (Tauri dialog plugin). Dynamic import keeps non-Tauri contexts (preview,
    // vitest) clean, mirroring fetchutil's plugin-http import. Auto-fills Name from the folder basename.
    const browse = async () => {
        try {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const picked = await open({ directory: true, multiple: false, title: "Select project folder" });
            if (typeof picked === "string" && picked) {
                setPath(picked);
                if (!name.trim()) {
                    const base =
                        picked
                            .replace(/[\\/]+$/, "")
                            .split(/[\\/]/)
                            .pop() ?? "";
                    if (base) {
                        setName(base);
                    }
                }
                setError(null);
            }
        } catch (e) {
            setError(String(e));
        }
    };
    const switchMode = (next: Mode) => {
        setMode(next);
        setError(null);
    };

    return (
        <ModalShell
            open={open}
            onClose={close}
            onSubmit={() => void create()}
            className="w-[min(560px,92vw)]"
            topClass="pt-[14vh]"
            dismissOnBackdrop={false}
        >
            {open ? (
                <>
                    <div className="flex items-center gap-[11px] border-b border-border px-[18px] py-[15px]">
                        <span className="flex-1 text-[15px] font-semibold text-primary">New project</span>
                        <span className="rounded-[5px] border border-edge-mid px-[7px] py-0.5 font-mono text-[10.5px] text-muted">
                            esc
                        </span>
                    </div>
                    {mode === "scan" ? (
                        <div className="flex flex-col gap-3 px-[18px] py-4">
                            <input
                                autoFocus
                                value={query}
                                data-new-project-search
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setCursor(0);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setCursor((c) => moveCursor(c, e.key === "ArrowDown" ? 1 : -1, options.length));
                                    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                                        e.preventDefault();
                                        void create();
                                    }
                                }}
                                placeholder="Search folders Claude Code has worked in, or on disk…"
                                className={cn(FIELD, "text-[13.5px]")}
                            />
                            <div>
                                <div className={LABEL}>From Claude Code</div>
                                <div
                                    role="listbox"
                                    aria-label="Folders Claude Code has sessions in"
                                    className={cn(
                                        "overflow-y-auto rounded border border-edge-mid",
                                        typed ? "max-h-[180px]" : "max-h-[300px]"
                                    )}
                                >
                                    {scanned == null ? (
                                        <div className="px-[13px] py-3 text-[12.5px] text-muted">Scanning…</div>
                                    ) : candidates.length === 0 ? (
                                        <div className="px-[13px] py-3 text-[12.5px] text-muted">
                                            {scanFailed
                                                ? "Couldn't read Claude Code's sessions. Choose a folder instead."
                                                : typed
                                                  ? "No Claude Code folder matches."
                                                  : "No unregistered folders found in Claude Code's sessions."}
                                        </div>
                                    ) : (
                                        candidates.map((p, i) => (
                                            <FolderRow
                                                key={p.path}
                                                name={p.name}
                                                path={p.path}
                                                meta={`${p.sessions} ${p.sessions === 1 ? "session" : "sessions"} · ${formatAgo(Date.now() - p.lastactivets)}`}
                                                selected={i === cursor}
                                                rowRefs={rowRefs.current}
                                                onPick={() => setCursor(i)}
                                                onOpen={() => void create()}
                                            />
                                        ))
                                    )}
                                </div>
                            </div>
                            {typed ? (
                                <div>
                                    <div className={LABEL}>Found on disk</div>
                                    <div
                                        role="listbox"
                                        aria-label="Project folders found on disk"
                                        className="max-h-[180px] overflow-y-auto rounded border border-edge-mid"
                                    >
                                        {onDisk == null ? (
                                            <div className="px-[13px] py-3 text-[12.5px] text-muted">
                                                Searching folders near your projects…
                                            </div>
                                        ) : diskRows.length === 0 ? (
                                            <div className="px-[13px] py-3 text-[12.5px] text-muted">
                                                No other project folder matches.
                                            </div>
                                        ) : (
                                            diskRows.map((f, j) => (
                                                <FolderRow
                                                    key={f.path}
                                                    name={f.name}
                                                    path={f.path}
                                                    meta={`${f.kind} · ${formatAgo(Date.now() - f.modts)}`}
                                                    selected={candidates.length + j === cursor}
                                                    rowRefs={rowRefs.current}
                                                    onPick={() => setCursor(candidates.length + j)}
                                                    onOpen={() => void create()}
                                                />
                                            ))
                                        )}
                                    </div>
                                </div>
                            ) : null}
                            {picked && pickedName !== picked.name ? (
                                <div className="text-[12px] text-muted">
                                    A project named {picked.name} exists, so this one registers as{" "}
                                    <span className="font-semibold text-secondary">{pickedName}</span>.
                                </div>
                            ) : null}
                            {error ? <div className="text-[12px] text-error">{error}</div> : null}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-[15px] px-[18px] py-4">
                            <div>
                                <div className={LABEL}>Name</div>
                                <input
                                    autoFocus
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="my-service"
                                    className={cn(FIELD, "text-[13.5px] font-medium")}
                                />
                            </div>
                            <div>
                                <div className={LABEL}>Local path</div>
                                <div className="flex items-center gap-2">
                                    <input
                                        value={path}
                                        onChange={(e) => setPath(e.target.value)}
                                        placeholder="~/code/my-service"
                                        className={cn(FIELD, "flex-1 text-[12.5px] text-secondary")}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void browse()}
                                        className="shrink-0 cursor-pointer rounded border border-edge-mid bg-surface px-[13px] py-2.5 text-[12.5px] font-semibold text-secondary hover:border-edge-strong hover:text-primary"
                                    >
                                        Browse…
                                    </button>
                                </div>
                            </div>
                            {error ? <div className="text-[12px] text-error">{error}</div> : null}
                        </div>
                    )}
                    <div className="flex items-center gap-3 border-t border-border px-[18px] py-[13px]">
                        <button
                            type="button"
                            data-new-project-mode={mode === "scan" ? "manual" : "scan"}
                            onClick={() => switchMode(mode === "scan" ? "manual" : "scan")}
                            className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-primary"
                        >
                            {mode === "scan" ? (
                                <>
                                    <FolderOpen size={13} aria-hidden />
                                    Choose a folder…
                                </>
                            ) : (
                                <>
                                    <ArrowLeft size={13} aria-hidden />
                                    Claude Code folders
                                </>
                            )}
                        </button>
                        <div className="flex-1" />
                        <DialogButton variant="secondary" hint="esc" onClick={close}>
                            Cancel
                        </DialogButton>
                        <DialogButton
                            variant="primary"
                            hint={formatChordString("Cmd:Enter")}
                            disabled={!canCreate}
                            onClick={() => void create()}
                        >
                            Create project
                        </DialogButton>
                    </div>
                </>
            ) : null}
        </ModalShell>
    );
}

// one folder in either section: a click selects it, a double-click registers it
function FolderRow({
    name,
    path,
    meta,
    selected,
    rowRefs,
    onPick,
    onOpen,
}: {
    name: string;
    path: string;
    meta: string;
    selected: boolean;
    rowRefs: Map<string, HTMLDivElement>;
    onPick: () => void;
    onOpen: () => void;
}) {
    return (
        <div
            ref={(el) => {
                if (el == null) {
                    rowRefs.delete(path);
                } else {
                    rowRefs.set(path, el);
                }
            }}
            role="option"
            aria-selected={selected}
            data-new-project-option={name}
            onClick={onPick}
            onDoubleClick={onOpen}
            className={cn(
                "flex cursor-pointer items-center gap-2.5 px-[13px] py-2",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <FileIcon path={name} dir size={16} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-primary">{name}</div>
                <div className="truncate text-[11.5px] text-muted" title={path}>
                    {path}
                </div>
            </div>
            <span className="flex-none text-[11px] tabular-nums text-muted">{meta}</span>
        </div>
    );
}
