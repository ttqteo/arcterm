// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import { registerProject } from "./projectsstore";

export function NewProjectModal({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(model.newProjectOpenAtom);
    const [name, setName] = useState("");
    const [path, setPath] = useState("");
    const [error, setError] = useState<string | null>(null);
    const close = () => {
        globalStore.set(model.newProjectOpenAtom, false);
        setName("");
        setPath("");
        setError(null);
    };
    const canCreate = name.trim().length > 0 && path.trim().length > 0;
    const create = async () => {
        if (!canCreate) {
            return;
        }
        try {
            await registerProject(name.trim(), path.trim());
            globalStore.set(model.projectFilterAtom, name.trim());
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
                    const base = picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
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
    return (
        <ModalShell open={open} onClose={close} onSubmit={() => void create()} className="w-[min(480px,92vw)]" topClass="pt-[14vh]" dismissOnBackdrop={false}>
            {open ? (
                <>
                <div className="flex items-center gap-[11px] border-b border-border px-[18px] py-[15px]">
                    <span className="flex-1 text-[15px] font-semibold text-primary">New project</span>
                    <span className="rounded-[5px] border border-edge-mid px-[7px] py-0.5 font-mono text-[10.5px] text-muted">
                        esc
                    </span>
                </div>
                <div className="flex flex-col gap-[15px] px-[18px] py-4">
                    <div>
                        <div className="mb-[9px] text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                            Name
                        </div>
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="my-service"
                            className="w-full rounded border border-edge-mid bg-surface px-[13px] py-2.5 text-[13.5px] font-medium text-primary outline-none focus:border-accent-700"
                        />
                    </div>
                    <div>
                        <div className="mb-[9px] text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                            Local path
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                value={path}
                                onChange={(e) => setPath(e.target.value)}
                                placeholder="~/code/my-service"
                                className="flex-1 rounded border border-edge-mid bg-surface px-[13px] py-2.5 text-[12.5px] text-secondary outline-none focus:border-accent-700"
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
                <div className="flex items-center gap-3 border-t border-border px-[18px] py-[13px]">
                    <div className="flex-1" />
                    <DialogButton variant="secondary" hint="esc" onClick={close}>
                        Cancel
                    </DialogButton>
                    <DialogButton variant="primary" hint="⌘⏎" disabled={!canCreate} onClick={() => void create()}>
                        Create project
                    </DialogButton>
                </div>
                </>
            ) : null}
        </ModalShell>
    );
}
